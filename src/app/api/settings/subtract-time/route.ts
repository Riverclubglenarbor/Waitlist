import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const SUBTRACT_MINUTES = 5

// Floor for the per-hole rates. src/lib/wait-time.ts's queue-pacing formula
// assumes every party ahead in line contributes a positive number of
// minutes — a zero or negative rate would make the queue stop advancing (or
// run backwards) for everyone behind the front. 1 min/hole is the lowest
// pace that still means something as a golf pace; clamp here instead of
// letting a rate hit 0 or go negative.
const MIN_RATE = 1

// Inverse of /api/settings/add-time: used when the course is running faster
// than the configured pace, so every group in the queue gets pulled
// forward. Flat per group, not scaled by party size, matching the existing
// small/large rate model. Like add-time, this deliberately does NOT touch
// the 10-min new-checkin floor (MINIMUM_WAIT_MINUTES in wait-time.ts) — the
// first party in an empty queue always starts at a flat 10.
export async function POST() {
  const supabase = createServerClient()
  const { data: settingsRows, error: readError } = await supabase.from('settings').select('*')
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

  const settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))

  const newSmallRate = Math.max(MIN_RATE, smallRate - SUBTRACT_MINUTES)
  const newLargeRate = Math.max(MIN_RATE, largeRate - SUBTRACT_MINUTES)
  const clamped = newSmallRate === MIN_RATE || newLargeRate === MIN_RATE

  const { error: writeError } = await supabase.from('settings').upsert([
    { key: 'avg_min_per_hole_small', value: String(newSmallRate) },
    { key: 'avg_min_per_hole_large', value: String(newLargeRate) },
  ])
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 })

  return NextResponse.json({
    avg_min_per_hole_small: newSmallRate,
    avg_min_per_hole_large: newLargeRate,
    clamped,
  })
}
