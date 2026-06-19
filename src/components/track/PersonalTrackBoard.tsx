'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getPartyPosition, getWaitMinutesForParty } from '@/lib/wait-time'
import { buzzerColor } from '@/lib/buzzer-color'
import type { Party } from '@/types'

export default function PersonalTrackBoard({ id }: { id: string }) {
  const [parties, setParties] = useState<Party[]>([])
  const [self, setSelf] = useState<Party | null | undefined>(undefined)
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)
  const [confirming, setConfirming] = useState(false)
  const [readyError, setReadyError] = useState('')
  const [done, setDone] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      const [partiesRes, settingsRes, selfRes] = await Promise.all([
        fetch('/api/parties'),
        fetch('/api/settings'),
        fetch(`/api/parties/${id}`),
      ])
      const partiesData = await partiesRes.json()
      const settingsData = await settingsRes.json()
      if (Array.isArray(partiesData)) setParties(partiesData)
      const fallback = parseFloat(settingsData.avg_min_per_hole ?? '4')
      setSmallRate(parseFloat(settingsData.avg_min_per_hole_small ?? String(fallback)))
      setLargeRate(parseFloat(settingsData.avg_min_per_hole_large ?? String(fallback + 1)))
      if (selfRes.ok) {
        const selfData = await selfRes.json()
        setSelf(selfData)
      } else {
        setSelf(null)
      }
    } catch (e) {
      console.error('fetchAll failed', e)
    }
  }, [id])

  useEffect(() => {
    fetchAll()
    const supabase = createClient()
    const channel = supabase
      .channel('personal-track-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchAll())
      .subscribe()
    const poll = setInterval(() => fetchAll(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchAll])

  async function handleReady() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setReadyError('')
    try {
      const res = await fetch(`/api/parties/${id}/ready`, { method: 'POST' })
      if (res.ok) {
        setDone(true)
        return
      }
      const data = await res.json().catch(() => ({}))
      setReadyError(data.error ?? 'Something went wrong')
    } catch {
      setReadyError('Network error — check connection')
    } finally {
      setConfirming(false)
    }
  }

  // Wait for the initial per-id fetch before deciding which state to render,
  // so we don't briefly flash the "expired" state before data arrives.
  if (self === undefined) {
    return <div className="min-h-screen bg-rc-navy" />
  }

  const isPlaying = done || self?.status === 'playing'
  const isGone = !self || self.status === 'no_show' || self.status === 'removed'

  if (isPlaying) {
    return (
      <div className="min-h-screen bg-rc-green flex items-center justify-center px-6 text-center">
        <p className="text-white text-3xl font-black">You&apos;re all set — enjoy your round! ⛳</p>
      </div>
    )
  }

  if (isGone) {
    return (
      <div className="min-h-screen bg-rc-navy flex items-center justify-center px-6 text-center">
        <p className="text-white/70 text-xl">This link has expired. Check with the front desk.</p>
      </div>
    )
  }

  const party = self
  const position = getPartyPosition(party, parties)
  const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate))
  const bgColor = buzzerColor(position)

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-4 transition-colors duration-[600ms] ease-out motion-reduce:transition-none"
      style={{ backgroundColor: bgColor }}
    >
      <p className="text-white/70 text-lg uppercase tracking-widest">{party.first_name} {party.last_initial}.</p>
      {position === 1 ? (
        <>
          <p key="ready-headline" className="text-white text-3xl font-black max-w-xs animate-pop-in">Grab your putters, hole 1 is ready!</p>
          <button
            onClick={handleReady}
            className="bg-white text-rc-navy px-8 py-4 rounded-xl text-xl font-bold mt-2
                       transition-all duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            {confirming ? 'Tap again to confirm' : "I'm Ready for the Course"}
          </button>
          {readyError && <p className="text-white text-sm">{readyError}</p>}
        </>
      ) : (
        <>
          <p className="text-white/60 text-xl uppercase tracking-widest">Position</p>
          <p key={position} className="text-white text-6xl font-black animate-pop-in motion-reduce:animate-none">#{position}</p>
          <p className="text-white/80 text-2xl font-bold">~{wait} min</p>
        </>
      )}
    </div>
  )
}
