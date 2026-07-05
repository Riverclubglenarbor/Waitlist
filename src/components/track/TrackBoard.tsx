'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getWaitMinutesForParty } from '@/lib/wait-time'
import type { Party } from '@/types'

function formatName(firstName: string, lastInitial: string): string {
  return `${firstName} ${lastInitial}.`
}

export default function TrackBoard() {
  const [parties, setParties] = useState<Party[]>([])
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)

  const fetchAll = useCallback(async () => {
    try {
      const [partiesRes, settingsRes] = await Promise.all([
        fetch('/api/parties'),
        fetch('/api/settings'),
      ])
      const partiesData = await partiesRes.json()
      const settingsData = await settingsRes.json()
      if (Array.isArray(partiesData)) setParties(partiesData)
      const fallback = parseFloat(settingsData.avg_min_per_hole ?? '4')
      setSmallRate(parseFloat(settingsData.avg_min_per_hole_small ?? String(fallback)))
      setLargeRate(parseFloat(settingsData.avg_min_per_hole_large ?? String(fallback + 1)))
    } catch (e) {
      console.error('fetchAll failed', e)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const supabase = createClient()
    const channel = supabase
      .channel('track-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchAll())
      .subscribe()
    const poll = setInterval(() => fetchAll(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchAll])

  return (
    <div className="min-h-screen bg-rc-navy flex flex-col items-center px-4 py-8">
      <h1 className="text-rc-green text-2xl font-black uppercase tracking-wide mb-6">River Club Queue</h1>

      {parties.length === 0 ? (
        <p className="text-white/70 text-lg text-center mt-12">No wait — the course is open!</p>
      ) : (
        <div className="w-full max-w-md flex flex-col gap-3">
          {parties.map((party, i) => {
            const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate))
            return (
              <div
                key={party.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3
                  ${i === 0 ? 'bg-rc-green/20 border border-rc-green' : 'bg-white/5'}`}
              >
                <span className={`text-xl font-black w-6 shrink-0 ${i === 0 ? 'text-rc-green' : 'text-white/40'}`}>
                  {i + 1}
                </span>
                <span className="flex-1 text-white font-bold truncate">
                  {formatName(party.first_name, party.last_initial)}
                </span>
                <span className="font-bold">
                  {wait === 0 ? (
                    <span className="text-rc-green">Now!</span>
                  ) : (
                    <span className="text-white/70">{wait}m</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
