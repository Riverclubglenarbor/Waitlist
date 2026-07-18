'use client'
import { useEffect, useRef, useState } from 'react'

type AlertPreference = 'yes' | 'no' | null

function storageKey(partyId: string): string {
  return `river-club-ready-alert:${partyId}`
}

function readPreference(partyId: string): AlertPreference {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(storageKey(partyId))
  return raw === 'yes' || raw === 'no' ? raw : null
}

// Synthesizes a short two-tone chime with the Web Audio API instead of
// shipping an audio file asset. Only ever called from the ready-transition
// effect below, which only ever fires after choose('yes') has already
// created and resumed the AudioContext from a real user tap — required for
// this to be exempt from iOS Safari's block on unprompted audio.
function playChime(ctx: AudioContext) {
  const now = ctx.currentTime
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.001, now + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.32)
  })
}

// Opt-in "it's your turn" alert for the guest tracking page. Shows a
// one-tap prompt on first visit (per party, remembered in localStorage);
// tapping Yes silently unlocks audio for later, and the chime + vibration
// then fire exactly once on each false→true transition of `isReady`.
// `isReady` must match the tracking page's real ready-screen condition —
// including the status === 'notified' path from Phase 2's Notify feature —
// so the sound lands at the same moment the "Grab your putters" screen does.
export function useReadyAlert(partyId: string, isReady: boolean) {
  const [preference, setPreference] = useState<AlertPreference>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const wasReadyRef = useRef(false)

  useEffect(() => {
    setPreference(readPreference(partyId))
  }, [partyId])

  function unlockAudio(): AudioContext | null {
    if (audioCtxRef.current) return audioCtxRef.current
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    ctx.resume().catch(() => {})
    audioCtxRef.current = ctx
    return ctx
  }

  function choose(pref: 'yes' | 'no') {
    setPreference(pref)
    window.localStorage.setItem(storageKey(partyId), pref)
    if (pref === 'yes') unlockAudio()
  }

  // Re-arm case: preference was already 'yes' from an earlier visit (this
  // tab reloaded, or iOS evicted a backgrounded tab during the wait — both
  // routine on a page someone has open for 10-40 minutes), so there was no
  // fresh tap THIS load to unlock audio. Grab the next real tap/touch
  // anywhere on the page as that unlock instead of waiting for one that
  // will never come from the (already-dismissed) prompt.
  useEffect(() => {
    if (preference !== 'yes' || audioCtxRef.current) return
    const onFirstInteraction = () => unlockAudio()
    document.addEventListener('pointerdown', onFirstInteraction, { once: true })
    return () => document.removeEventListener('pointerdown', onFirstInteraction)
  }, [preference])

  useEffect(() => {
    if (isReady && !wasReadyRef.current && preference === 'yes') {
      const ctx = audioCtxRef.current
      if (ctx) {
        // iOS suspends the context on lock/background; resume before
        // playing rather than assuming it's still running from unlock time.
        if (ctx.state !== 'running') {
          ctx.resume().then(() => playChime(ctx)).catch(() => {})
        } else {
          playChime(ctx)
        }
      }
      if (typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200])
    }
    wasReadyRef.current = isReady
  }, [isReady, preference])

  return {
    showPrompt: preference === null,
    choose,
  }
}
