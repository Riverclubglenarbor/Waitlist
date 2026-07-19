import type { SupabaseClient } from '@supabase/supabase-js'

interface RateWriteResult {
  ok: boolean
  conflict?: boolean
  error?: string
}

async function conditionalWrite(
  supabase: SupabaseClient,
  key: string,
  oldValue: string,
  newValue: string,
  existed: boolean
) {
  if (!existed) {
    // No row yet (first-ever call before the settings table has been
    // seeded) — nothing persisted to race against, so a plain upsert is
    // safe here.
    return supabase.from('settings').upsert([{ key, value: newValue }]).select()
  }
  return supabase
    .from('settings')
    .update({ value: newValue })
    .eq('key', key)
    .eq('value', oldValue)
    .select()
}

// Applies both per-hole rate writes (small + large) as a matched pair, each
// conditioned on the exact value just read — so two racing requests (two
// staff devices tapping Add Time / Speed Up near-simultaneously, or a
// client double-fire that slipped past the button's own busy-guard) can
// never both read the same stale rate and silently stomp one another's
// +5/-5 (a classic lost-update race). Prod-adjacent bug found 2026-07-18:
// this route used to do a blind read-then-upsert with no conditional check
// at all — the exact same class of bug as the live "Speed Up" incident
// earlier tonight, just triggered by two concurrent writers instead of one
// double-tap. If either row changed since the read, the whole pair is
// rolled back rather than left half-applied, and the caller gets
// `conflict: true` so it can ask the user to retry.
export async function writeRatesIfUnchanged(
  supabase: SupabaseClient,
  rowExisted: { small: boolean; large: boolean },
  oldValues: { small: string; large: string },
  newValues: { small: string; large: string }
): Promise<RateWriteResult> {
  const { data: smallUpdated, error: smallError } = await conditionalWrite(
    supabase, 'avg_min_per_hole_small', oldValues.small, newValues.small, rowExisted.small
  )
  if (smallError) return { ok: false, error: smallError.message }
  if (!smallUpdated || smallUpdated.length === 0) return { ok: false, conflict: true }

  const { data: largeUpdated, error: largeError } = await conditionalWrite(
    supabase, 'avg_min_per_hole_large', oldValues.large, newValues.large, rowExisted.large
  )
  if (largeError || !largeUpdated || largeUpdated.length === 0) {
    // Roll back the small write so the pair is never left half-applied.
    await supabase
      .from('settings')
      .update({ value: oldValues.small })
      .eq('key', 'avg_min_per_hole_small')
      .eq('value', newValues.small)
    if (largeError) return { ok: false, error: largeError.message }
    return { ok: false, conflict: true }
  }

  return { ok: true }
}
