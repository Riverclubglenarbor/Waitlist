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

  const [{ data: active }, { data: settingsRows }, { data: partyBeingDeleted }] = await Promise.all([
    supabase.from('parties').select('*').in('status', ['waiting', 'notified']),
    supabase.from('settings').select('*'),
    supabase.from('parties').select('*').eq('id', params.id).single(),
  ])

  const { error } = await supabase.from('parties').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deleted = partyBeingDeleted as Party | null
  if (deleted && (deleted.status === 'waiting' || deleted.status === 'notified')) {
    const { smallRate, largeRate } = parseRates(settingsRows)
    try {
      await advanceQueueEpochIfFront(supabase, deleted, (active ?? []) as Party[], smallRate, largeRate)

      // Cascade removal across split siblings, front-to-back (see PATCH).
      const siblings = findSiblings(deleted, (active ?? []) as Party[]).sort(compareQueueOrder)
      for (const sibling of siblings) {
        const { data: freshActive } = await supabase
          .from('parties')
          .select('*')
          .in('status', ['waiting', 'notified'])
        const stillActive = ((freshActive ?? []) as Party[]).find(p => p.id === sibling.id)
        if (!stillActive) continue
        const { error: sibError } = await supabase.from('parties').delete().eq('id', sibling.id)
        if (sibError) continue
        await advanceQueueEpochIfFront(
          supabase,
          stillActive,
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
