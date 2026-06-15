import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!

type PartyStatus = 'waiting' | 'notified' | 'no_show' | 'playing' | 'removed'

interface Party {
  id: string
  first_name: string
  phone: string
  party_size: number
  checked_in_at: string
  notified_at?: string
  followup_sent_at?: string
  status: PartyStatus
}

type Settings = Record<string, string>

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  )
}

function calculateWaitMinutes(
  parties: Pick<Party, 'party_size'>[],
  smallRate: number,
  largeRate: number
): number {
  return parties.reduce((total, p) => total + (p.party_size >= 5 ? largeRate : smallRate) * p.party_size, 0)
}

function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number
): Date {
  const ahead = allParties.filter(
    p =>
      (p.status === 'waiting' || p.status === 'notified') &&
      p.checked_in_at < party.checked_in_at
  )
  const waitMs = calculateWaitMinutes(ahead, smallRate, largeRate) * 60_000
  return new Date(Date.now() + waitMs)
}

async function sendSms(to: string, body: string): Promise<void> {
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: body }).toString(),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio error: ${err}`)
  }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Load settings
  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings: Settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? settings.avg_min_per_hole ?? '4')
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? settings.avg_min_per_hole ?? '5')
  const leadMinutes = parseFloat(settings.notification_lead_minutes ?? '3')
  const noShowMinutes = parseFloat(settings.no_show_timeout_minutes ?? '10')

  // Load active parties
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
    return new Response(JSON.stringify({ ok: true, action: 'daily_reset' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results: string[] = []

  for (const party of parties) {
    const estimatedTeeTime = getEstimatedTeeTime(party, parties, smallRate, largeRate)
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
            .update({ status: 'no_show', followup_sent_at: now.toISOString() })
            .eq('id', party.id)
          results.push(`no_show:${party.id}`)
        } catch (err) {
          console.error(`Follow-up SMS failed for ${party.id}:`, err)
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
