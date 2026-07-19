import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'
import { findSiblings, compareQueueOrder } from '@/lib/party-siblings'
import type { Party, Settings } from '@/types'

function parseRates(settingsRows: { key: string; value: string }[] | null) {
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  return {
    smallRate: parseFloat(settings.avg_min_per_hole_small ?? String(fallback)),
    largeRate: parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1)),
  }
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const body = await request.json()
  const allowedFields = ['status', 'notes', 'paid']
  const update = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([k]) => allowedFields.includes(k))
  )

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // A Notify advanced the queue epoch by this party's rate; silently
  // flipping them back to 'waiting' here would re-add their rate to
  // everyone's math without rolling the epoch back — a permanent wrong
  // jump. Only the dedicated undo-notify route may reverse a Notify.
  if (update.status === 'waiting') {
    const { data: current } = await supabase
      .from('parties')
      .select('*')
      .eq('id', params.id)
      .single()
    if (current && (current as Party).status === 'notified') {
      return NextResponse.json(
        { error: 'Use /api/parties/[id]/undo-notify to reverse a Notify' },
        { status: 400 }
      )
    }
  }

  const isDequeue =
    update.status === 'playing' || update.status === 'no_show' || update.status === 'removed'
  let activeBeforeChange: Party[] = []
  let smallRate = 4
  let largeRate = 5
  if (isDequeue) {
    const [{ data: active }, { data: settingsRows }] = await Promise.all([
      supabase.from('parties').select('*').in('status', ['waiting', 'notified']),
      supabase.from('settings').select('*'),
    ])
    activeBeforeChange = (active ?? []) as Party[]
    const rates = parseRates(settingsRows)
    smallRate = rates.smallRate
    largeRate = rates.largeRate
  }

  const { data, error } = await supabase
    .from('parties')
    .update(update)
    .eq('id', params.id)
    .in('status', ['waiting', 'notified']) // race guard: only succeeds if still active
    .select()
    .single()

  if (error) {
    // No row matched the conditional filter (already dequeued by a racing
    // request) — not a real error, just nothing left to do.
    if (error.code === 'PGRST116') {
      const { data: fallbackData } = await supabase
        .from('parties')
        .select('*')
        .eq('id', params.id)
        .single()
      return fallbackData
        ? NextResponse.json(fallbackData)
        : NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (isDequeue && data) {
    try {
      await advanceQueueEpochIfFront(supabase, data as Party, activeBeforeChange, smallRate, largeRate)

      // Cascade the same transition across split-party siblings ("Sarah 1"
      // / "Sarah 2") so half a split never lingers as a phantom front of
      // the queue. Processed front-to-back so each sibling is correctly
      // "the front" at the moment its own epoch check runs.
      const siblings = findSiblings(data as Party, activeBeforeChange).sort(compareQueueOrder)
      for (const sibling of siblings) {
        const { data: freshActive } = await supabase
          .from('parties')
          .select('*')
          .in('status', ['waiting', 'notified'])
        const { data: sibUpdated, error: sibError } = await supabase
          .from('parties')
          .update({ status: update.status })
          .eq('id', sibling.id)
          .in('status', ['waiting', 'notified'])
          .select()
          .single()
        if (sibError || !sibUpdated) continue // already transitioned by a racing request
        await advanceQueueEpochIfFront(
          supabase,
          sibUpdated as Party,
          (freshActive ?? []) as Party[],
          smallRate,
          largeRate
        )
      }
    } catch (e) {
      // Epoch RPC failed — surface it. Reporting success here would let the
      // board silently drift, the exact failure mode this design removes.
      const message = e instanceof Error ? e.message : 'queue epoch update failed'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const [{ data: active }, { data: settingsRows }] = await Promise.all([
    supabase.from('parties').select('*').in('status', ['waiting', 'notified']),
    supabase.from('settings').select('*'),
  ])

  // .select() so we get back the row THIS request actually deleted — and
  // its status at that exact moment. Bug found 2026-07-18 (post-incident
  // audit): this used to delete blind and advance the epoch off a
  // pre-delete snapshot; a delete matching zero rows is not an error, so a
  // double-fired Remove (two requests both snapshotting the party as
  // waiting-front) advanced the epoch TWICE for one departure — permanent
  // wait inflation for the whole queue, same lost-update class as the live
  // Speed Up incident. Only the request whose delete really removed the row
  // may advance.
  const { data: deletedRows, error } = await supabase
    .from('parties')
    .delete()
    .eq('id', params.id)
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deleted = ((deletedRows ?? [])[0] ?? null) as Party | null
  if (deleted && (deleted.status === 'waiting' || deleted.status === 'notified')) {
    const { smallRate, largeRate } = parseRates(settingsRows)
    try {
      // Advance only if the row was still WAITING when we deleted it. If a
      // racing Notify flipped it to 'notified' after our snapshot, that
      // notify already advanced the epoch for this party — advancing here
      // too (as the old snapshot-based check did) would double-count them.
      if (deleted.status === 'waiting') {
        await advanceQueueEpochIfFront(supabase, deleted, (active ?? []) as Party[], smallRate, largeRate)
      }

      // Cascade removal across split siblings, front-to-back (see PATCH).
      const siblings = findSiblings(deleted, (active ?? []) as Party[]).sort(compareQueueOrder)
      for (const sibling of siblings) {
        const { data: freshActive } = await supabase
          .from('parties')
          .select('*')
          .in('status', ['waiting', 'notified'])
        const stillActive = ((freshActive ?? []) as Party[]).find(p => p.id === sibling.id)
        if (!stillActive) continue
        const { data: sibDeletedRows, error: sibError } = await supabase
          .from('parties')
          .delete()
          .eq('id', sibling.id)
          .select()
        if (sibError) continue
        const sibDeleted = ((sibDeletedRows ?? [])[0] ?? null) as Party | null
        // Same guard as the primary: only a delete that actually removed a
        // still-waiting row advances the epoch for that sibling.
        if (!sibDeleted || sibDeleted.status !== 'waiting') continue
        await advanceQueueEpochIfFront(
          supabase,
          sibDeleted,
          (freshActive ?? []) as Party[],
          smallRate,
          largeRate
        )
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'queue epoch update failed'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  return new NextResponse(null, { status: 204 })
}
