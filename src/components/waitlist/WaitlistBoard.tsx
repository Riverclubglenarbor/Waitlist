'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getWaitMinutesForParty } from '@/lib/wait-time'
import { parseEpochMs } from '@/lib/queue-epoch'
import EmptyBoard from './EmptyBoard'
import OdometerNumber from './OdometerNumber'
import Image from 'next/image'
import { QRCodeSVG } from 'qrcode.react'
import type { Party } from '@/types'

function formatName(firstName: string, lastInitial: string): string {
  const parts = firstName.trim().split(' ')
  const last = parts[parts.length - 1]
  const isGroupNum = parts.length > 1 && /^\d+$/.test(last)
  if (isGroupNum) {
    const base = parts.slice(0, -1).join(' ')
    return `${base} ${lastInitial}. ${last}`
  }
  return `${firstName} ${lastInitial}.`
}

export default function WaitlistBoard() {
  const [parties, setParties] = useState<Party[]>([])
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)
  const [epochMs, setEpochMs] = useState(() => Date.now())

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
      setEpochMs(parseEpochMs(settingsData, Date.now()))
    } catch (e) {
      console.error('fetchAll failed', e)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const supabase = createClient()
    const channel = supabase
      .channel('waitlist-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchAll())
      .subscribe()
    const poll = setInterval(() => fetchAll(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchAll])

  if (parties.length === 0) return <EmptyBoard />

  // The hero number is the wait of the most recently checked-in party — a
  // real guest's actual number — not getQueueWaitMinutes's hypothetical
  // "what would a brand-new arrival wait" estimate. /api/parties returns
  // parties ordered by checked_in_at ascending, so the last element is the
  // newest active party.
  const lastParty = parties[parties.length - 1]
  const totalWait = Math.round(getWaitMinutesForParty(lastParty, parties, smallRate, largeRate, epochMs))

  return (
    <div className="h-screen bg-rc-navy flex flex-col items-center px-8 py-10" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
      <Image
        src="/rc-logo.png"
        alt="River Club Glen Arbor"
        width={680}
        height={300}
        className="object-contain shrink-0"
      />

      <div className="flex-1 w-full flex flex-col items-center gap-8 overflow-hidden py-8 min-h-0">
        <div className="w-full bg-rc-green/10 border-2 border-rc-green rounded-3xl py-8 px-6 text-center shrink-0">
          <p className="text-white/60 text-2xl uppercase tracking-widest mb-2">Current Wait</p>
          <div className="flex items-end justify-center gap-3">
            <OdometerNumber value={totalWait} />
            <span className="text-4xl font-normal text-white/70 pb-4">min</span>
          </div>
        </div>

        <div className="w-full grid grid-cols-[1fr_6rem] gap-4 text-rc-green text-lg uppercase tracking-widest border-b-2 border-rc-green/40 pb-3 px-4 shrink-0">
          <span>Par-Tee</span>
          <span className="text-right">Wait</span>
        </div>

        <div className="w-full flex flex-col gap-3 overflow-y-auto">
          {parties.slice(0, 10).map((party, i) => {
            const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate, epochMs))

            return (
              <div
                key={party.id}
                className={`grid grid-cols-[1fr_6rem] gap-4 items-center py-5 px-4 rounded-2xl animate-pop-in
                  ${i === 0 ? 'bg-rc-green/20 border-2 border-rc-green' : 'bg-white/5'}`}
              >
                <span className="text-white text-4xl font-bold truncate">
                  {formatName(party.first_name, party.last_initial)}
                </span>
                <span className="text-right text-3xl font-bold">
                  {party.status === 'notified' ? (
                    <span className="text-rc-green animate-pulse text-2xl">Come in!</span>
                  ) : wait === 0 ? (
                    <span className="text-rc-green animate-pulse">Now!</span>
                  ) : (
                    <span className="text-white/80">{wait}m</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="w-full flex items-end justify-between shrink-0">
        <div className="w-[120px]" />
        <p className="text-rc-green/60 text-[2.5rem] font-bold tracking-widest uppercase text-center flex-1">
          putt · party · eat · repeat
        </p>
        <div className="w-[120px] flex flex-col items-center gap-1">
          <QRCodeSVG value="https://river-club-waitlist.vercel.app/track" size={96} bgColor="#1E3A5F" fgColor="#ffffff" />
          <span className="text-white/60 text-[0.65rem] uppercase tracking-wide text-center">Scan to track your spot</span>
        </div>
      </div>
    </div>
  )
}
