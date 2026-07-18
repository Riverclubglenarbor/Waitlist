import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReadyAlert } from '@/lib/use-ready-alert'

class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn(() => Promise.resolve())
  createOscillator = vi.fn(() => ({
    frequency: { value: 0 }, type: '', connect: vi.fn().mockReturnThis(),
    start: vi.fn(), stop: vi.fn(),
  }))
  createGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  ;(window as any).AudioContext = FakeAudioContext
  ;(navigator as any).vibrate = vi.fn()
})

describe('useReadyAlert', () => {
  it('shows the prompt when no preference is stored for this party', () => {
    const { result } = renderHook(() => useReadyAlert('party-1', false))
    expect(result.current.showPrompt).toBe(true)
  })

  it('hides the prompt and remembers "yes" after choosing it', () => {
    const { result, rerender } = renderHook(() => useReadyAlert('party-1', false))
    act(() => result.current.choose('yes'))
    rerender()
    expect(result.current.showPrompt).toBe(false)
    expect(window.localStorage.getItem('river-club-ready-alert:party-1')).toBe('yes')
  })

  it('does not show the prompt when a preference is already stored from a previous visit', () => {
    window.localStorage.setItem('river-club-ready-alert:party-1', 'no')
    const { result } = renderHook(() => useReadyAlert('party-1', false))
    expect(result.current.showPrompt).toBe(false)
  })

  it('fires the chime and vibration exactly once on the false-to-true ready transition when opted in', () => {
    const { result, rerender } = renderHook(
      ({ isReady }) => useReadyAlert('party-1', isReady),
      { initialProps: { isReady: false } }
    )
    act(() => result.current.choose('yes'))
    rerender({ isReady: true })
    expect((navigator.vibrate as any)).toHaveBeenCalledTimes(1)
    rerender({ isReady: true }) // stays ready — must not fire again
    expect((navigator.vibrate as any)).toHaveBeenCalledTimes(1)
  })

  it('never vibrates or plays sound if the guest opted out', () => {
    const { result, rerender } = renderHook(
      ({ isReady }) => useReadyAlert('party-1', isReady),
      { initialProps: { isReady: false } }
    )
    act(() => result.current.choose('no'))
    rerender({ isReady: true })
    expect((navigator.vibrate as any)).not.toHaveBeenCalled()
  })
})
