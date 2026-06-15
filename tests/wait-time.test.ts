import { describe, it, expect } from 'vitest'
import { calculateWaitMinutes, getQueueWaitMinutes } from '@/lib/wait-time'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1',
  first_name: 'Jane',
  last_initial: 'D',
  party_size: 2,
  phone: '+12345678900',
  checked_in_at: new Date().toISOString(),
  status: 'waiting',
  ...overrides,
})

describe('calculateWaitMinutes', () => {
  it('returns 0 for empty queue', () => {
    expect(calculateWaitMinutes([], 2.5)).toBe(0)
  })

  it('calculates wait for single party', () => {
    const parties = [makeParty({ party_size: 4 })]
    expect(calculateWaitMinutes(parties, 2.5)).toBe(10)
  })

  it('sums wait for multiple parties', () => {
    const parties = [
      makeParty({ party_size: 2 }),
      makeParty({ party_size: 3 }),
    ]
    expect(calculateWaitMinutes(parties, 2.5)).toBe(12.5)
  })

  it('uses avgMinPerHole correctly', () => {
    const parties = [makeParty({ party_size: 1 })]
    expect(calculateWaitMinutes(parties, 3)).toBe(3)
  })
})

describe('getQueueWaitMinutes', () => {
  it('returns 0 when no active parties', () => {
    const parties = [
      makeParty({ status: 'playing' }),
      makeParty({ status: 'removed' }),
    ]
    expect(getQueueWaitMinutes(parties, 2.5)).toBe(0)
  })

  it('counts waiting and notified parties', () => {
    const parties = [
      makeParty({ party_size: 2, status: 'waiting' }),
      makeParty({ party_size: 2, status: 'notified' }),
      makeParty({ party_size: 2, status: 'playing' }),
    ]
    expect(getQueueWaitMinutes(parties, 2.5)).toBe(10)
  })
})
