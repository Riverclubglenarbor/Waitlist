'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getPartyPosition, getWaitMinutesForParty } from '@/lib/wait-time'
import { parseEpochMs } from '@/lib/queue-epoch'
import { buzzerColor, NAVY, GREEN } from '@/lib/buzzer-color'
import { useReadyAlert } from '@/lib/use-ready-alert'
import type { Party } from '@/types'

export default function PersonalTrackBoard({ id }: { id: string }) {
  const [parties, setParties] = useState<Party[]>([])
  const [self, setSelf] = useState<Party | null | undefined>(undefined)
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)
  const [epochMs, setEpochMs] = useState(() => Date.now())
  const [confirming, setConfirming] = useState(false)
  const [readyError, setReadyError] = useState('')
  const [done, setDone] = useState(false)
  const [confirmingMoveDown, setConfirmingMoveDown] = useState(false)
  const [moveDownError, setMoveDownError] = useState('')
  const [showMovedUp, setShowMovedUp] = useState(false)
  const [swappingDown, setSwappingDown] = useState(false)
  // Synchronous re-entrancy guard, same pattern as checkin/page.tsx's
  // addTimeBusy/subtractTimeBusy — `swappingDown` alone only blocks after a
  // re-render, so two taps in the same event tick would both slip through
  // and double-swap this guest two spots instead of one.
  const swapDownBusy = useRef(false)

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
      setEpochMs(parseEpochMs(settingsData, Date.now()))
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

  // One-time "You got moved up!" notice: shown once per distinct
  // moved_up_notice_at value (the swap-down route stamps a fresh timestamp
  // on the beneficiary each time), tracked in localStorage the same way
  // use-ready-alert.ts stores the sound preference, so it never reappears
  // on subsequent polls with the same value — but a later swap's new value
  // shows it again.
  const movedUpAt = self?.moved_up_notice_at
  useEffect(() => {
    if (!movedUpAt) return
    const key = `river-club-moved-up-shown:${id}`
    if (window.localStorage.getItem(key) === movedUpAt) return
    window.localStorage.setItem(key, movedUpAt)
    setShowMovedUp(true)
    const timer = setTimeout(() => setShowMovedUp(false), 6000)
    return () => clearTimeout(timer)
  }, [movedUpAt, id])

  async function handleMoveDownYes() {
    if (swappingDown || swapDownBusy.current) return
    swapDownBusy.current = true
    setConfirmingMoveDown(false)
    setMoveDownError('')
    setSwappingDown(true)
    try {
      const res = await fetch(`/api/parties/${id}/swap-down`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMoveDownError(data.error ?? 'Something went wrong')
      }
      await fetchAll()
    } catch {
      setMoveDownError('Network error — check connection')
    }
    swapDownBusy.current = false
    setSwappingDown(false)
  }

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

  const isPlaying = self !== undefined && (done || self?.status === 'playing')
  const isGone = self !== undefined && (!self || self.status === 'no_show' || self.status === 'removed')
  const themeColor = self === undefined
    ? NAVY
    : isPlaying
      ? GREEN
      : isGone
        ? NAVY
        : buzzerColor(getPartyPosition(self, parties))

  // Keep the browser/OS chrome (iOS status bar, Safari's toolbar) in sync
  // with the page background. Without this, Safari only re-tints its own
  // chrome on a real navigation — since this page's background changes
  // entirely via client-side state (position improving, or flipping to the
  // done/expired screens), the chrome would otherwise stay stuck on
  // whatever color was present at the very first page load.
  useEffect(() => {
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', themeColor)
  }, [themeColor])

  // Ready computation is hoisted above the early returns below so
  // useReadyAlert can be called unconditionally on every render (rules of
  // hooks — the early returns must not change the hook count between
  // renders). trackedParty is only non-null in the normal "still in line"
  // state that renders the board.
  const trackedParty = self && !isPlaying && !isGone ? self : null
  const position = trackedParty ? getPartyPosition(trackedParty, parties) : 0
  const wait = trackedParty
    ? Math.round(getWaitMinutesForParty(trackedParty, parties, smallRate, largeRate, epochMs))
    : 0
  // A notified party has been called up — that IS "your turn", regardless
  // of the numeric position (which no longer counts notified parties).
  // This MUST stay identical to the ready-screen condition in the JSX
  // below, so the chime fires at the same moment the screen flips.
  const isReady = trackedParty !== null
    && ((wait <= 0 && position === 1) || trackedParty.status === 'notified')
  const { showPrompt, choose } = useReadyAlert(id, isReady)

  // Wait for the initial per-id fetch before deciding which state to render,
  // so we don't briefly flash the "expired" state before data arrives.
  if (self === undefined) {
    return <div className="fixed inset-0 bg-rc-navy" />
  }

  if (isPlaying) {
    return (
      <div className="fixed inset-0 bg-rc-green flex items-center justify-center px-6 text-center">
        <p className="text-white text-3xl font-black">You&apos;re all set — enjoy your round! ⛳</p>
      </div>
    )
  }

  if (isGone) {
    return (
      <div className="fixed inset-0 bg-rc-navy flex items-center justify-center px-6 text-center">
        <p className="text-white/70 text-xl">This link has expired. Check with the front desk.</p>
      </div>
    )
  }

  const party = self

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-6 text-center gap-4 transition-colors duration-[600ms] ease-out motion-reduce:transition-none"
      style={{ backgroundColor: themeColor }}
    >
      {showPrompt && (
        <div className="fixed top-0 inset-x-0 bg-white text-rc-navy px-6 py-4 flex flex-col items-center gap-3 shadow-lg z-10 animate-pop-in">
          <p className="text-base font-semibold text-center">Play a sound when it&apos;s your turn?</p>
          <div className="flex gap-3">
            <button
              onClick={() => choose('no')}
              className="border border-slate-300 text-slate-600 font-bold px-6 py-2 rounded-xl"
            >
              No
            </button>
            <button
              onClick={() => choose('yes')}
              className="bg-rc-green text-white font-bold px-6 py-2 rounded-xl"
            >
              Yes
            </button>
          </div>
        </div>
      )}
      {showMovedUp && (
        <button
          onClick={() => setShowMovedUp(false)}
          className="bg-white text-rc-navy text-lg font-black px-6 py-3 rounded-2xl shadow-lg animate-pop-in"
        >
          You got moved up! 🎉
        </button>
      )}
      <p className="text-white/70 text-lg uppercase tracking-widest">{party.first_name} {party.last_initial}.</p>
      {isReady ? (
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
          {party.status === 'waiting' && wait > 0 && (
            <button
              onClick={() => { setMoveDownError(''); setConfirmingMoveDown(true) }}
              className="text-white/70 text-sm underline underline-offset-4 mt-2"
            >
              Running behind? Move down 1 spot
            </button>
          )}
          {moveDownError && <p className="text-white text-sm">{moveDownError}</p>}
        </>
      )}
      {confirmingMoveDown && (
        <div className="fixed inset-0 bg-black/60 z-20 flex items-center justify-center px-6">
          <div className="bg-white text-rc-navy rounded-2xl p-6 flex flex-col items-center gap-4 w-full max-w-sm shadow-xl animate-pop-in">
            <p className="text-lg font-semibold text-center">Would you like to move down 1 spot on the waitlist?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmingMoveDown(false)}
                disabled={swappingDown}
                className="border border-slate-300 text-slate-600 font-bold px-6 py-2 rounded-xl disabled:opacity-50"
              >
                No
              </button>
              <button
                onClick={handleMoveDownYes}
                disabled={swappingDown}
                className="bg-rc-green text-white font-bold px-6 py-2 rounded-xl disabled:opacity-50"
              >
                {swappingDown ? '…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
