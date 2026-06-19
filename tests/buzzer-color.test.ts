import { describe, it, expect } from 'vitest'
import { buzzerColor } from '@/lib/buzzer-color'

describe('buzzerColor', () => {
  it('is full green at position 1', () => {
    expect(buzzerColor(1)).toBe('#6dc04b')
  })

  it('is full navy at position 8', () => {
    expect(buzzerColor(8)).toBe('#1e3a5f')
  })

  it('stays full navy beyond position 8', () => {
    expect(buzzerColor(12)).toBe('#1e3a5f')
  })

  it('blends proportionally at a midpoint position', () => {
    expect(buzzerColor(4)).toBe('#4b8754')
  })

  it('clamps to full green for position 0 (getPartyPosition\'s not-found sentinel)', () => {
    expect(buzzerColor(0)).toBe('#6dc04b')
  })
})
