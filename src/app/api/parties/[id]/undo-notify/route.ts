import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { revertQueueEpochForUndoNotify } from '@/lib/queue-epoch-server'
import { findSiblings } from '@/lib/party-siblings'
import type { Party, Settings } from '@/types'

export const dynamic = 'force-dynamic'

// The only sanctioned way to reverse a Notify. Symmetric to the notify
// route: flips 'notified' back to 'waiting' AND rolls the queue epoch back
// by the party's own rate, so notify + undo-notify is a perfect no-op pair
// and nobody's wait jumps in either direction. (The generic PATCH route
// rejects notified -> waiting precisely so this can't happen without the
// epoch rollback.)
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const { data: partyRow } = await supabase
    .from('parties')
    .select('*')
    .eq('id', params.id)
    .single()
  const party = partyRow as Party | null
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  if (party.status !== 'notified') {
    return NextResponse.json({ error: 'Party is not in the notified state' }, { status: 409 })
  }

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))

  const { data: updated, error: updateError } = await supabase
    .from('parties')
    .update({ status: 'waiting', notified_at: null })
    .eq('id', params.id)
    .eq('status', 'notified') // race guard
    .select()
    .single()
  if (updateError || !updated) {
    if (updateError && updateError.code === 'PGRST116') {
      return NextResponse.json({ error: 'Party is no longer notified' }, { status: 409 })
    }
    return NextResponse.json({ error: updateError?.message ?? 'Update failed' }, { status: 500 })
  }

  try {
    await revertQueueEpochForUndoNotify(supabase, updated as Party, smallRate, largeRate)

    // A Notify cascades across split siblings, so its undo does too — each
    // sibling's revert subtracts that sibling's own rate, mirroring the
    // advance each one made when notified.
    const { data: activeNow } = await supabase
      .from('parties')
      .select('*')
      .in('status', ['waiting', 'notified'])
    const siblings = findSiblings(updated as Party, (activeNow ?? []) as Party[]).filter(
      s => s.status === 'notified'
    )
    for (const sibling of siblings) {
      const { data: sibUpdated, error: sibError } = await supabase
        .from('parties')
        .update({ status: 'waiting', notified_at: null })
        .eq('id', sibling.id)
        .eq('status', 'notified')
        .select()
        .single()
      if (sibError || !sibUpdated) continue // racing request got there first
      await revertQueueEpochForUndoNotify(supabase, sibUpdated as Party, smallRate, largeRate)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'queue epoch update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json(updated)
}
