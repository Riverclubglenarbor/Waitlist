import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { compareQueueOrder } from '@/lib/party-siblings'
import type { Party } from '@/types'

export const dynamic = 'force-dynamic'

// Guest self-service "move down 1 spot": voluntarily swap places with
// whoever is directly behind in the WAITING queue, from the guest's own
// tracking page.
//
// This route must NEVER touch queue_epoch_at. The whole Phase 2 design
// makes that safe: elapsed time comes purely from the persisted epoch (not
// from any party's checked_in_at), and calculateWaitMinutes's sum over the
// parties ahead is order-independent — so exchanging two adjacent waiting
// parties' checked_in_at values provably cannot change any other party's
// wait. Proven, not assumed: see tests/wait-time-invariants.property.test.ts
// (swap-down event) and tests/parties-swap-down-route.test.ts.
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
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  }
  // A party staff already called up must not be able to un-jump themselves.
  if (party.status !== 'waiting') {
    return NextResponse.json(
      { error: 'Not eligible to move — already notified or checked in' },
      { status: 409 }
    )
  }

  // Same comparator as getPartyPosition/wasFrontOfQueue (checked_in_at asc,
  // tie-broken by id) — reused, not re-derived. Notified parties are
  // excluded here, so a guest can never accidentally swap with someone
  // staff already called up.
  const waitingOrdered = active.filter(p => p.status === 'waiting').sort(compareQueueOrder)
  const index = waitingOrdered.findIndex(p => p.id === party.id)
  if (index === waitingOrdered.length - 1) {
    return NextResponse.json({ error: 'No one behind you to swap with' }, { status: 409 })
  }
  const nextParty = waitingOrdered[index + 1]

  // Swap checked_in_at between the two rows with conditional updates
  // guarding that neither row changed since the fetch above. If the second
  // update misses (a racing request already moved one of them), roll the
  // first update back rather than leaving a half-swapped pair.
  const { data: firstUpdated, error: firstError } = await supabase
    .from('parties')
    .update({ checked_in_at: nextParty.checked_in_at })
    .eq('id', party.id)
    .eq('status', 'waiting')
    .eq('checked_in_at', party.checked_in_at)
    .select()
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })
  if (!firstUpdated || firstUpdated.length === 0) {
    return NextResponse.json({ error: 'Line changed — try again' }, { status: 409 })
  }

  const { data: secondUpdated, error: secondError } = await supabase
    .from('parties')
    .update({
      checked_in_at: party.checked_in_at,
      // The one who moves up gets the on-screen notice — same write, not a
      // separate round trip, so a successful swap is never missing it.
      moved_up_notice_at: new Date().toISOString(),
    })
    .eq('id', nextParty.id)
    .eq('status', 'waiting')
    .eq('checked_in_at', nextParty.checked_in_at)
    .select()

  if (secondError || !secondUpdated || secondUpdated.length === 0) {
    // Roll back the first update so the pair is never left half-swapped.
    const { error: rollbackError } = await supabase
      .from('parties')
      .update({ checked_in_at: party.checked_in_at })
      .eq('id', party.id)
      .eq('checked_in_at', nextParty.checked_in_at)
    if (rollbackError) {
      return NextResponse.json(
        { error: `Swap failed and rollback failed: ${rollbackError.message}` },
        { status: 500 }
      )
    }
    if (secondError) return NextResponse.json({ error: secondError.message }, { status: 500 })
    return NextResponse.json({ error: 'Line changed — try again' }, { status: 409 })
  }

  // Deliberately NO queue_epoch_at / advance_queue_epoch call anywhere in
  // this route — a swap dequeues no one, so the shared queue clock must not
  // move.
  return NextResponse.json({ ok: true })
}
