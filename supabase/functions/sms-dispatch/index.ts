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
  phone: string | null
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

// Kept in sync by hand with src/lib/wait-time.ts + src/lib/queue-epoch.ts —
// this Deno edge function is a separate deployment target and can't import
// those modules directly. If you change the wait formula there, mirror it
// here too, or the auto-notify/no-show timers will drift out of sync with
// what customers and staff actually see (this happened once already).
//
// NOTE (2026-07-18): updated to the epoch-based model (elapsed time comes
// from the persisted queue_epoch_at setting, and only still-'waiting'
// parties count toward anyone's wait — 'notified' parties have already
// been called up). This copy is STILL NOT DEPLOYED — no Supabase CLI
// access to this client's project (see SKILL.md "Known gaps"). Before ever
// re-enabling this cron, also note its auto-notify status flip now calls
// the advance_queue_epoch RPC (see below), which requires the
// *advance_queue_epoch_function.sql migration to be applied first.
const MINIMUM_WAIT_MINUTES = 10

function calculateWaitMinutes(
  parties: Pick<Party, 'party_size'>[],
  smallRate: number,
  largeRate: number
): number {
  return parties.reduce((total, p) => total + (p.party_size >= 5 ? largeRate : smallRate), 0)
}

// Mirrors src/lib/queue-epoch.ts parseEpochMs.
function parseEpochMs(settings: Settings, fallbackNowMs: number): number {
  const raw = settings.queue_epoch_at
  if (!raw) return fallbackNowMs
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : fallbackNowMs
}

// Mirrors src/lib/queue-epoch.ts wasFrontOfQueue (waiting-only front).
function wasFrontOfQueue(party: Party, activeBeforeChange: Party[]): boolean {
  const waiting = activeBeforeChange.filter(p => p.status === 'waiting')
  if (waiting.length === 0) return false
  const sorted = [...waiting].sort((a, b) => {
    const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })
  return sorted[0].id === party.id
}

function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number
): Date {
  // Only still-'waiting' parties consume a place in line; 'notified'
  // parties have been told to come and no longer count (mirrors
  // wait-time.ts queuedParties).
  const queued = allParties.filter(p => p.status === 'waiting')
  const ahead = queued.filter(p => p.checked_in_at < party.checked_in_at)
  const elapsedMinutes = Math.max(0, (Date.now() - epochMs) / 60_000)
  const waitMinutes = Math.max(
    0,
    MINIMUM_WAIT_MINUTES + calculateWaitMinutes(ahead, smallRate, largeRate) - elapsedMinutes
  )
  return new Date(Date.now() + waitMinutes * 60_000)
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
  const epochMs = parseEpochMs(settings, Date.now())

  for (const party of parties) {
    const estimatedTeeTime = getEstimatedTeeTime(party, parties, smallRate, largeRate, epochMs)
    const minutesUntilTee = (estimatedTeeTime.getTime() - now.getTime()) / 60_000

    if (party.status === 'waiting' && minutesUntilTee <= leadMinutes) {
      if (party.phone) {
        try {
          const msg = interpolate(settings.notification_sms_template, {
            name: party.first_name,
            wait: Math.max(0, Math.round(minutesUntilTee)),
          })
          await sendSms(party.phone, msg)
        } catch (err) {
          console.error(`Pre-notify SMS failed for ${party.id}:`, err)
        }
      }
      await supabase
        .from('parties')
        .update({ status: 'notified', notified_at: now.toISOString() })
        .eq('id', party.id)
        .eq('status', 'waiting') // race guard, matches the app's notify route
      // Flipping a party to 'notified' removes their rate from everyone
      // else's math — the shared epoch must advance by their own rate when
      // they were the front, exactly like POST /api/parties/[id]/notify,
      // or every wait behind them jumps. Uses the same atomic RPC.
      if (wasFrontOfQueue(party, parties)) {
        const rate = party.party_size >= 5 ? largeRate : smallRate
        const { error: epochError } = await supabase.rpc('advance_queue_epoch', {
          delta_minutes: rate,
        })
        if (epochError) console.error(`advance_queue_epoch failed for ${party.id}:`, epochError)
      }
      // Keep the local snapshot honest so a later party notified in this
      // same cron run sees this one as already-notified (front check +
      // ahead-of-me math both depend on it).
      party.status = 'notified'
      results.push(`notified:${party.id}`)
    }

    if (party.status === 'notified' && party.notified_at) {
      const minutesSinceNotify =
        (now.getTime() - new Date(party.notified_at).getTime()) / 60_000
      if (minutesSinceNotify >= noShowMinutes && !party.followup_sent_at) {
        if (party.phone) {
          try {
            const msg = interpolate(settings.followup_sms_template, {
              name: party.first_name,
            })
            await sendSms(party.phone, msg)
          } catch (err) {
            console.error(`Follow-up SMS failed for ${party.id}:`, err)
          }
        }
        await supabase
          .from('parties')
          .update({ status: 'no_show', followup_sent_at: now.toISOString() })
          .eq('id', party.id)
        results.push(`no_show:${party.id}`)
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
