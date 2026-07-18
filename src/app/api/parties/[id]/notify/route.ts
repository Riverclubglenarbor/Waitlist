import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartyPosition } from '@/lib/wait-time'
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'
import { findSiblings, compareQueueOrder } from '@/lib/party-siblings'
import type { Party, Settings } from '@/types'

export const dynamic = 'force-dynamic'

// Staff-triggered "Notify Now": marks the front-of-queue party as called-up
// (status 'notified') while they stay visible on every board. From this
// moment their rate no longer counts toward anyone else's wait — the epoch
// advance below compensates so nobody's number jumps. Reversible only via
// the dedicated undo-notify route.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const { data: allParties, error } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const active = (allParties ?? []) as Party[]
  const party = active.find(p => p.id === params.id)
  if (!party) return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  if (party.status !== 'waiting') {
    return NextResponse.json({ error: 'Already notified or checked in' }, { status: 409 })
  }

  // Must be the front of the waiting queue — except that any row of a
  // split party counts as "front" if one of its siblings is, since the
  // whole split group is notified together.
  const position = getPartyPosition(party, active)
  if (position !== 1) {
    const groupIsFront = findSiblings(party, active).some(
      s => s.status === 'waiting' && getPartyPosition(s, active) === 1
    )
    if (!groupIsFront) {
      return NextResponse.json({ error: 'Not at the front of the queue' }, { status: 409 })
    }
  }

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))

  // The whole split group (or just this party, the common case) is
  // notified front-to-back so each member is correctly "the front" at the
  // moment its own epoch advance runs — the epoch moves by each member's
  // own rate, keeping everyone else's wait perfectly smooth.
  const group = [party, ...findSiblings(party, active).filter(s => s.status === 'waiting')].sort(
    compareQueueOrder
  )

  let primaryUpdated: Party | null = null
  try {
    for (const member of group) {
      const { data: freshActive } = await supabase
        .from('parties')
        .select('*')
        .in('status', ['waiting', 'notified'])
      const { data: updated, error: updateError } = await supabase
        .from('parties')
        .update({ status: 'notified', notified_at: new Date().toISOString() })
        .eq('id', member.id)
        .eq('status', 'waiting') // race guard
        .select()
        .single()
      if (updateError || !updated) {
        if (updateError && updateError.code !== 'PGRST116') {
          return NextResponse.json({ error: updateError.message }, { status: 500 })
        }
        continue // a racing request already transitioned this member
      }
      if (member.id === party.id) primaryUpdated = updated as Party
      await advanceQueueEpochIfFront(supabase, member, (freshActive ?? []) as Party[], smallRate, largeRate)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'queue epoch update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!primaryUpdated) {
    return NextResponse.json({ error: 'Already notified or checked in' }, { status: 409 })
  }
  return NextResponse.json(primaryUpdated)
}
