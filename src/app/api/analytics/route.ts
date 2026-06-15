import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`

  const { data: parties, error } = await supabase
    .from('parties')
    .select('*')
    .gte('checked_in_at', dayStart)
    .lte('checked_in_at', dayEnd)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const served = parties.filter((p: { status: string }) => p.status === 'playing' || p.status === 'removed')
  const notifiedServed = served.filter((p: { notified_at?: string }) => p.notified_at)
  const avgWait =
    notifiedServed.length > 0
      ? notifiedServed.reduce((sum: number, p: { checked_in_at: string; notified_at: string }) => {
          return (
            sum +
            (new Date(p.notified_at).getTime() - new Date(p.checked_in_at).getTime()) /
              60_000
          )
        }, 0) / notifiedServed.length
      : 0

  const hourCounts: Record<number, number> = {}
  for (const p of parties) {
    const hour = new Date(p.checked_in_at).getHours()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
  }
  const busiestHour =
    Object.keys(hourCounts).length > 0
      ? Number(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0])
      : null

  const byStatus = parties.reduce(
    (acc: Record<string, number>, p: { status: string }) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1
      return acc
    },
    {}
  )

  return NextResponse.json({
    total_served: served.length,
    avg_wait_minutes: Math.round(avgWait * 10) / 10,
    busiest_hour: busiestHour,
    by_status: byStatus,
  })
}
