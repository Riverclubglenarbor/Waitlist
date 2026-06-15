import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendSms } from '@/lib/twilio'
import { interpolate } from '@/lib/sms-templates'
import { getEstimatedTeeTime } from '@/lib/wait-time'
import type { Party, Settings } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createServerClient()

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const avgMinPerHole = parseFloat(settings.avg_min_per_hole ?? '2.5')
  const leadMinutes = parseFloat(settings.notification_lead_minutes ?? '3')
  const noShowMinutes = parseFloat(settings.no_show_timeout_minutes ?? '10')

  const { data: allParties } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
    .order('checked_in_at', { ascending: true })

  const parties: Party[] = allParties ?? []
  const now = new Date()

  // Daily reset check
  const [resetHour, resetMin] = (settings.daily_reset_time ?? '23:00').split(':').map(Number)
  const resetTime = new Date()
  resetTime.setHours(resetHour, resetMin, 0, 0)
  if (now >= resetTime) {
    await supabase
      .from('parties')
      .update({ status: 'removed' })
      .in('status', ['waiting', 'notified'])
    return NextResponse.json({ ok: true, action: 'daily_reset' })
  }

  const results: string[] = []

  for (const party of parties) {
    const estimatedTeeTime = getEstimatedTeeTime(party, parties, avgMinPerHole)
    const minutesUntilTee = (estimatedTeeTime.getTime() - now.getTime()) / 60_000

    if (party.status === 'waiting' && minutesUntilTee <= leadMinutes) {
      try {
        const msg = interpolate(settings.notification_sms_template, {
          name: party.first_name,
          wait: Math.max(0, Math.round(minutesUntilTee)),
        })
        await sendSms(party.phone, msg)
        await supabase
          .from('parties')
          .update({ status: 'notified', notified_at: now.toISOString() })
          .eq('id', party.id)
        results.push(`notified:${party.id}`)
      } catch (err) {
        console.error(`Pre-notify SMS failed for ${party.id}:`, err)
      }
    }

    if (party.status === 'notified' && party.notified_at) {
      const minutesSinceNotify =
        (now.getTime() - new Date(party.notified_at).getTime()) / 60_000
      if (minutesSinceNotify >= noShowMinutes && !party.followup_sent_at) {
        try {
          const msg = interpolate(settings.followup_sms_template, {
            name: party.first_name,
          })
          await sendSms(party.phone, msg)
          await supabase
            .from('parties')
            .update({
              status: 'no_show',
              followup_sent_at: now.toISOString(),
            })
            .eq('id', party.id)
          results.push(`no_show:${party.id}`)
        } catch (err) {
          console.error(`Follow-up SMS failed for ${party.id}:`, err)
        }
      }
    }
  }

  return NextResponse.json({ ok: true, results })
}
