import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendSms } from '@/lib/twilio'
import { interpolate } from '@/lib/sms-templates'
import { getQueueWaitMinutes } from '@/lib/wait-time'
import type { Party, Settings } from '@/types'

export const dynamic = 'force-dynamic'

const MAX_GROUP_SIZE = 6

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

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )

  // Get current queue for wait time calc
  const { data: activeParties } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
  const avgMinPerHole = parseFloat(settings.avg_min_per_hole ?? '2.5')
  const allActive: Party[] = activeParties ?? []
  const waitMinutes = Math.round(getQueueWaitMinutes(allActive, avgMinPerHole))

  // Split party into groups of MAX_GROUP_SIZE
  const groups: { size: number; label: string }[] = []
  const totalSize = Number(party_size)
  if (totalSize <= MAX_GROUP_SIZE) {
    groups.push({ size: totalSize, label: first_name })
  } else {
    let remaining = totalSize
    let groupNum = 1
    while (remaining > 0) {
      const size = Math.min(remaining, MAX_GROUP_SIZE)
      groups.push({ size, label: `${first_name} ${groupNum}` })
      remaining -= size
      groupNum++
    }
  }

  // Insert all groups
  const inserted: Party[] = []
  for (const group of groups) {
    const { data: party, error } = await supabase
      .from('parties')
      .insert({
        first_name: group.label,
        last_initial,
        party_size: group.size,
        phone,
        notes,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    inserted.push(party)
  }

  // Send one welcome SMS (mention split if multiple groups)
  try {
    let welcomeMsg: string
    if (groups.length > 1) {
      welcomeMsg = `Welcome to River Club! 🏌️ Your party of ${totalSize} has been split into ${groups.length} groups (max 6 per tee time). Est. wait: ~${waitMinutes} min. We'll text you when it's time!`
    } else {
      welcomeMsg = interpolate(settings.welcome_sms_template, {
        name: first_name,
        wait: waitMinutes,
      })
    }
    await sendSms(phone, welcomeMsg)
  } catch (smsError) {
    console.error('Welcome SMS failed:', smsError)
  }

  return NextResponse.json(inserted, { status: 201 })
}
