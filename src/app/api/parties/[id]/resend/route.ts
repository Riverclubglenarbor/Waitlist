import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendSms } from '@/lib/twilio'
import { interpolate } from '@/lib/sms-templates'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('*')
    .eq('id', params.id)
    .single()

  if (partyError || !party) {
    return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  }

  if (!party.phone) {
    return NextResponse.json({ error: 'Party has no phone on file' }, { status: 400 })
  }

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')

  const settingsMap = Object.fromEntries(
    (settings ?? []).map((s: { key: string; value: string }) => [s.key, s.value])
  )

  const template = settingsMap.notification_sms_template ??
    "Hey {name}, come grab your putters — your tee time is almost here! ⛳"

  const body = interpolate(template, { name: party.first_name })

  try {
    await sendSms(party.phone, body)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'SMS failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
