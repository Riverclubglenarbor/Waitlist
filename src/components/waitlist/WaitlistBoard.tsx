'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getQueueWaitMinutes } from '@/lib/wait-time'
import EmptyBoard from './EmptyBoard'
import RcLogo from '@/components/ui/RcLogo'
import type { Party } from '@/types'

interface WaitlistBoardProps {
  avgMinPerHole: number
}

export default function WaitlistBoard({ avgMinPerHole }: WaitlistBoardProps) {
  const [parties, setParties] = useState<Party[]>([])

  useEffect(() => {
    fetchParties()
    const supabase = createClient()
    const channel = supabase
      .channel('waitlist-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, fetchParties)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchParties() {
    const res = await fetch('/api/parties')
    const data = await res.json()
    setParties(data)
  }

  if (parties.length === 0) return <EmptyBoard />

  const totalWait = Math.round(getQueueWaitMinutes(parties, avgMinPerHole))

  return (
    <div className="h-screen bg-rc-navy flex flex-col px-16 py-10 gap-8">
      <div className="flex items-center justify-between">
        <RcLogo variant="mark-only" className="text-4xl" />
        <div className="text-center">
          <p className="text-white/60 text-xl uppercase tracking-widest">Current Wait Time</p>
          <p className="text-rc-green text-8xl font-black leading-none">
            {totalWait}
            <span className="text-4xl font-normal text-white/70 ml-2">min</span>
          </p>
        </div>
        <p className="text-rc-green text-xl font-bold italic">putt · party · eat · repeat</p>
      </div>

      <div className="grid grid-cols-3 gap-8 text-rc-green text-xl uppercase tracking-widest border-b-2 border-rc-green/40 pb-4">
        <span>#</span>
        <span>Par-Tee</span>
        <span>Est. Wait</span>
      </div>

      <div className="flex flex-col gap-4 overflow-hidden">
        {parties.slice(0, 8).map((party, i) => {
          const waitAhead = parties
            .slice(0, i)
            .reduce((sum, p) => sum + avgMinPerHole * p.party_size, 0)
          const wait = Math.round(waitAhead)

          return (
            <div
              key={party.id}
              className={`grid grid-cols-3 gap-8 py-4 rounded-2xl px-6
                ${i === 0 ? 'bg-rc-green/20 border border-rc-green' : 'bg-white/5'}`}
            >
              <span className="text-rc-green text-5xl font-black">{i + 1}</span>
              <span className="text-white text-5xl font-bold">
                {party.first_name} {party.last_initial}.
              </span>
              <span className="text-white text-5xl font-bold">
                {wait === 0 ? (
                  <span className="text-rc-green animate-pulse">Now! ⛳</span>
                ) : (
                  `${wait} min`
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
