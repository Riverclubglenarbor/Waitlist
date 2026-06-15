import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendSms } from '@/lib/twilio'

export const dynamic = 'force-dynamic'
import { interpolate } from '@/lib/sms-templates'
import { getQueueWaitMinutes } from '@/lib/wait-time'
import type { Party, Settings } from '@/types'

export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
    .order('checked_in_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = createServerClient()
  const body = await request.json()
  const { first_name, last_initial, party_size, phone, notes } = body

  if (!first_name || !last_initial || !party_size || !phone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Check queue close time
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )

  const now = new Date()
  const [closeHour, closeMin] = settings.queue_close_time.split(':').map(Number)
  const closeTime = new Date()
  closeTime.setHours(closeHour, closeMin, 0, 0)
  if (now >= closeTime) {
    return NextResponse.json({ error: 'Queue is closed for the day' }, { status: 403 })
  }

  // Insert party
  const { data: party, error } = await supabase
    .from('parties')
    .insert({ first_name, last_initial, party_size, phone, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Calculate current wait for welcome SMS
  const { data: activeParties } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
  const avgMinPerHole = parseFloat(settings.avg_min_per_hole ?? '2.5')
  const allActive: Party[] = activeParties ?? []
  const waitMinutes = Math.round(
    getQueueWaitMinutes(allActive.filter(p => p.id !== party.id), avgMinPerHole)
  )

  // Send welcome SMS
  try {
    const welcomeMsg = interpolate(settings.welcome_sms_template, {
      name: first_name,
      wait: waitMinutes,
    })
    await sendSms(phone, welcomeMsg)
  } catch (smsError) {
    console.error('Welcome SMS failed:', smsError)
    // Don't fail the request if SMS fails
  }

  return NextResponse.json(party, { status: 201 })
}
