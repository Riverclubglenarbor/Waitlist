'use client'
import { useEffect, useState } from 'react'
import type { AnalyticsData } from '@/types'

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetch(`/api/analytics?date=${date}`)
      .then(r => r.json())
      .then(setData)
  }, [date])

  if (!data) return <p className="text-white/60">Loading…</p>

  const stats = [
    { label: 'Par-Tees Served', value: data.total_served },
    { label: 'Avg Wait', value: `${data.avg_wait_minutes} min` },
    { label: 'Busiest Hour', value: data.busiest_hour !== null ? `${data.busiest_hour}:00` : '—' },
  ]

  return (
    <div className="flex flex-col gap-8">
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="bg-white/10 text-white rounded-xl p-3 border border-white/20 w-48 outline-none"
      />
      <div className="grid grid-cols-3 gap-6">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-white/10 rounded-2xl p-6">
            <p className="text-rc-green text-sm uppercase tracking-wider mb-2">{label}</p>
            <p className="text-white text-4xl font-black">{value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white/10 rounded-2xl p-6">
        <p className="text-rc-green text-sm uppercase tracking-wider mb-4">By Status</p>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(data.by_status).map(([status, count]) => (
            <div key={status}>
              <span className="text-white/60 text-sm capitalize">{status}: </span>
              <span className="text-white font-bold">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
