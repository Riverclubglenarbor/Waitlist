import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const ADD_MINUTES = 5

// Bumps the per-hole pace (flat per group, not scaled by party size) so every
// group currently in the queue is pushed back — used when the course is
// running slower than the configured rate. The new-checkin minimum-wait
// floor is intentionally untouched by this: the first party in an empty
// queue should always start at a flat 10 min.
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

  const newSmallRate = smallRate + ADD_MINUTES
  const newLargeRate = largeRate + ADD_MINUTES

  const { error: writeError } = await supabase.from('settings').upsert([
    { key: 'avg_min_per_hole_small', value: String(newSmallRate) },
    { key: 'avg_min_per_hole_large', value: String(newLargeRate) },
  ])
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 })

  return NextResponse.json({
    avg_min_per_hole_small: newSmallRate,
    avg_min_per_hole_large: newLargeRate,
  })
}
