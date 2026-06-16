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
    expect(calculateWaitMinutes([], 5, 7)).toBe(0)
  })

  it('charges the flat small-group rate regardless of party size', () => {
    const parties = [makeParty({ party_size: 4 })]
    expect(calculateWaitMinutes(parties, 5, 7)).toBe(5)
  })

  it('charges the flat small-group rate for a single golfer', () => {
    const parties = [makeParty({ party_size: 1 })]
    expect(calculateWaitMinutes(parties, 5, 7)).toBe(5)
  })

  it('charges the flat large-group rate for 5+ golfers', () => {
    const parties = [makeParty({ party_size: 5 })]
    expect(calculateWaitMinutes(parties, 5, 7)).toBe(7)
  })

  it('charges the flat large-group rate for 6 golfers', () => {
    const parties = [makeParty({ party_size: 6 })]
    expect(calculateWaitMinutes(parties, 5, 7)).toBe(7)
  })

  it('sums flat rates across multiple parties, ignoring their individual sizes', () => {
    const parties = [
      makeParty({ party_size: 2 }), // small -> 5
      makeParty({ party_size: 6 }), // large -> 7
    ]
    expect(calculateWaitMinutes(parties, 5, 7)).toBe(12)
  })
})

describe('getQueueWaitMinutes', () => {
  it('returns 0 when no active parties', () => {
    const parties = [
      makeParty({ status: 'playing' }),
      makeParty({ status: 'removed' }),
    ]
    expect(getQueueWaitMinutes(parties, 5, 7)).toBe(0)
  })

  it('counts waiting and notified parties only, flat per group', () => {
    const parties = [
      makeParty({ party_size: 2, status: 'waiting' }),
      makeParty({ party_size: 2, status: 'notified' }),
      makeParty({ party_size: 2, status: 'playing' }),
    ]
    expect(getQueueWaitMinutes(parties, 5, 7)).toBe(10)
  })
})
