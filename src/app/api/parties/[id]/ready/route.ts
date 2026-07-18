import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartyPosition } from '@/lib/wait-time'
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'
import type { Party, Settings } from '@/types'

export const dynamic = 'force-dynamic'

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

  const party = ((allParties ?? []) as Party[]).find(p => p.id === params.id)
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  }

  // A notified party has already been called up — they may self-checkin
  // regardless of the numeric position (which no longer counts them at
  // all). Everyone else must actually be first among the waiting queue.
  const position = getPartyPosition(party, (allParties ?? []) as Party[])
  if (party.status !== 'notified' && position !== 1) {
    return NextResponse.json({ error: 'Not your turn yet' }, { status: 409 })
  }

  const { error: updateError } = await supabase
    .from('parties')
    .update({ status: 'playing' })
    .eq('id', params.id)
    .in('status', ['waiting', 'notified']) // race guard

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))

  try {
    // If the party was 'notified', the epoch already advanced at notify
    // time and wasFrontOfQueue correctly returns false here — no double
    // advance. Only a front-of-waiting-queue self-checkin advances it.
    await advanceQueueEpochIfFront(supabase, party, (allParties ?? []) as Party[], smallRate, largeRate)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'queue epoch update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
