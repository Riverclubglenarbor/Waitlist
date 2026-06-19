import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartyPosition } from '@/lib/wait-time'

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

  const party = (allParties ?? []).find(p => p.id === params.id)
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  }

  const position = getPartyPosition(party, allParties ?? [])
  if (position !== 1) {
    return NextResponse.json({ error: 'Not your turn yet' }, { status: 409 })
  }

  const { error: updateError } = await supabase
    .from('parties')
    .update({ status: 'playing' })
    .eq('id', params.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
