'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getQueueWaitMinutes } from '@/lib/wait-time'
import EmptyBoard from './EmptyBoard'
import Image from 'next/image'
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
    const poll = setInterval(fetchParties, 15000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [])

  async function fetchParties() {
    const res = await fetch('/api/parties')
    const data = await res.json()
    setParties(data)
  }

  if (parties.length === 0) return <EmptyBoard />

  const totalWait = Math.round(getQueueWaitMinutes(parties, avgMinPerHole))

  return (
    <div className="min-h-screen bg-rc-navy flex flex-col items-center px-8 py-10 gap-8">
      {/* Logo */}
      <Image
        src="/rc-logo.png"
        alt="River Club Glen Arbor"
        width={340}
        height={150}
        className="object-contain"
      />

      {/* Wait time hero */}
      <div className="w-full bg-rc-green/10 border-2 border-rc-green rounded-3xl py-8 px-6 text-center">
        <p className="text-white/60 text-2xl uppercase tracking-widest mb-2">Current Wait</p>
        <p className="text-rc-green font-black leading-none" style={{ fontSize: '7rem' }}>
          {totalWait}
          <span className="text-4xl font-normal text-white/70 ml-3">min</span>
        </p>
      </div>

      {/* Queue header */}
      <div className="w-full grid grid-cols-[1fr_6rem] gap-4 text-rc-green text-lg uppercase tracking-widest border-b-2 border-rc-green/40 pb-3 px-4">
        <span>Par-Tee</span>
        <span className="text-right">Wait</span>
      </div>

      {/* Queue rows */}
      <div className="w-full flex flex-col gap-3">
        {parties.slice(0, 10).map((party, i) => {
          const waitAhead = parties
            .slice(0, i)
            .reduce((sum, p) => sum + avgMinPerHole * p.party_size, 0)
          const wait = Math.round(waitAhead)

          return (
            <div
              key={party.id}
              className={`grid grid-cols-[1fr_6rem] gap-4 items-center py-5 px-4 rounded-2xl
                ${i === 0 ? 'bg-rc-green/20 border-2 border-rc-green' : 'bg-white/5'}`}
            >
              <span className="text-white text-4xl font-bold truncate">
                {party.first_name} {party.last_initial}.
              </span>
              <span className="text-right text-3xl font-bold">
                {wait === 0 ? (
                  <span className="text-rc-green animate-pulse">Now!</span>
                ) : (
                  <span className="text-white/80">{wait}m</span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Tagline footer */}
      <div className="mt-auto pt-4">
        <p className="text-rc-green/60 text-xl font-bold tracking-widest uppercase text-center">
          putt · party · eat · repeat
        </p>
      </div>
    </div>
  )
}
