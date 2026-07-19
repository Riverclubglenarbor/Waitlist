import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { MIN_RATE } from '@/lib/rate-limits'
import { QUEUE_EPOCH_SETTINGS_KEY } from '@/lib/queue-epoch'

// Keys the server owns and clients must never write through this route.
// Bug found 2026-07-19 (adversarial audit): GET returns EVERY settings row
// — including queue_epoch_at — and SettingsForm PUTs its entire state map
// back on save. Every notify/check-in advances the epoch server-side, so
// an admin who left the Settings page open for a while and then hit Save
// wrote the STALE epoch back, rewinding it by however long the tab sat
// open — which instantly collapses every wait on the board (the whole
// queue flips toward "Now!"), with no race or double-tap required.
// Stripped (not rejected) because well-behaved clients legitimately echo
// back everything GET gave them.
const SERVER_MANAGED_KEYS = [QUEUE_EPOCH_SETTINGS_KEY]

export const dynamic = 'force-dynamic'

// Settings keys that MUST hold a finite number, and the minimum each is
// allowed to hold. Bug found 2026-07-18 during the post-incident audit:
// this route used to upsert whatever the admin form's plain-text <input>
// sent, completely unvalidated. avg_min_per_hole_small/_large in
// particular feed directly into src/lib/wait-time.ts's queue-pacing math —
// a blank field (an easy select-all-and-type slip) or a stray non-numeric
// character would write straight to the DB, and unlike every other read
// site in this app (which only fall back to a default on a MISSING key via
// `?? fallback`), a stored empty string or "NaN" is a *defined* value, so
// parseFloat('') -> NaN silently poisons every wait calculation, for every
// guest, on every board, until someone notices and manually retypes a
// valid number. Validating at this single write boundary closes the hole
// for every entry point (admin form today, anything else that ever PUTs
// here later) without having to defensively re-check NaN at every one of
// the many places that read these settings.
const NUMERIC_FIELD_MINIMUMS: Record<string, number> = {
  avg_min_per_hole: MIN_RATE,
  avg_min_per_hole_small: MIN_RATE,
  avg_min_per_hole_large: MIN_RATE,
  notification_lead_minutes: 0,
  no_show_timeout_minutes: 0,
  add_time_total_minutes: 0,
}

export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('settings').select('*')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const settings = Object.fromEntries(data.map((r: { key: string; value: string }) => [r.key, r.value]))
  return NextResponse.json(settings)
}

export async function PUT(request: Request) {
  const supabase = createServerClient()
  const updates: Record<string, string> = await request.json()

  // All-or-nothing: a bad field anywhere in the batch rejects the whole
  // save rather than silently applying the good fields and dropping the
  // bad one (which would leave the admin thinking everything saved).
  for (const [key, min] of Object.entries(NUMERIC_FIELD_MINIMUMS)) {
    if (!(key in updates)) continue
    const raw = updates[key]
    const parsed = parseFloat(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < min) {
      return NextResponse.json(
        { error: `${key} must be a number >= ${min} (got "${raw}")` },
        { status: 400 }
      )
    }
  }

  const upserts = Object.entries(updates)
    .filter(([key]) => !SERVER_MANAGED_KEYS.includes(key))
    .map(([key, value]) => ({ key, value }))
  if (upserts.length > 0) {
    const { error } = await supabase.from('settings').upsert(upserts)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
