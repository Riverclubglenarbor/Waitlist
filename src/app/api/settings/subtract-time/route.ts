import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { writeRatesIfUnchanged } from '@/lib/settings-rate-write'
import { MIN_RATE } from '@/lib/rate-limits'

export const dynamic = 'force-dynamic'

const SUBTRACT_MINUTES = 5

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
  const currentSmallRaw = settings.avg_min_per_hole_small ?? String(fallback)
  const currentLargeRaw = settings.avg_min_per_hole_large ?? String(fallback + 1)
  const smallRate = parseFloat(currentSmallRaw)
  const largeRate = parseFloat(currentLargeRaw)

  const newSmallRate = Math.max(MIN_RATE, smallRate - SUBTRACT_MINUTES)
  const newLargeRate = Math.max(MIN_RATE, largeRate - SUBTRACT_MINUTES)
  const clamped = newSmallRate === MIN_RATE || newLargeRate === MIN_RATE

  const result = await writeRatesIfUnchanged(
    supabase,
    {
      small: (settingsRows ?? []).some(r => r.key === 'avg_min_per_hole_small'),
      large: (settingsRows ?? []).some(r => r.key === 'avg_min_per_hole_large'),
    },
    { small: currentSmallRaw, large: currentLargeRaw },
    { small: String(newSmallRate), large: String(newLargeRate) }
  )
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
  if (result.conflict) {
    return NextResponse.json(
      { error: 'Rate changed by someone else — try again' },
      { status: 409 }
    )
  }

  return NextResponse.json({
    avg_min_per_hole_small: newSmallRate,
    avg_min_per_hole_large: newLargeRate,
    clamped,
  })
}
