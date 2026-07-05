import { describe, it, expect } from 'vitest'
import { calculateWaitMinutes, getQueueWaitMinutes, getPartyPosition, getWaitMinutesForParty } from '@/lib/wait-time'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1',
  first_name: 'Jane',
  last_initial: 'D',
  party_size: 2,
  phone: '+12345678900',
  paid: false,
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

describe('getPartyPosition', () => {
  it('returns 1 for the only active party', () => {
    const party = makeParty({ id: 'a', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(party, [party])).toBe(1)
  })

  it('orders by checked_in_at ascending', () => {
    const first = makeParty({ id: 'a', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(first, [first, second])).toBe(1)
    expect(getPartyPosition(second, [first, second])).toBe(2)
  })

  it('breaks ties in checked_in_at using id so positions never collide', () => {
    const sameTime = new Date().toISOString()
    const a = makeParty({ id: 'aaa', checked_in_at: sameTime })
    const b = makeParty({ id: 'bbb', checked_in_at: sameTime })
    expect(getPartyPosition(a, [b, a])).toBe(1) // 'aaa' sorts before 'bbb'
    expect(getPartyPosition(b, [b, a])).toBe(2)
  })

  it('ignores parties that are not waiting or notified', () => {
    const playing = makeParty({ id: 'a', status: 'playing', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const waiting = makeParty({ id: 'b', status: 'waiting', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(waiting, [playing, waiting])).toBe(1)
  })
})

describe('getWaitMinutesForParty — minimum wait floor', () => {
  it('floors a freshly checked-in first-in-line party at 10 min instead of 0', () => {
    const now = Date.now()
    const party = makeParty({ id: 'a', checked_in_at: new Date(now).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, 0, now)).toBe(10)
  })

  it('counts the floor down as real time passes since check-in', () => {
    const now = Date.now()
    const party = makeParty({ id: 'a', checked_in_at: new Date(now - 4 * 60_000).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, 0, now)).toBe(6)
  })

  it('stops applying the floor once 10 minutes have actually elapsed', () => {
    const now = Date.now()
    const party = makeParty({ id: 'a', checked_in_at: new Date(now - 11 * 60_000).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, 0, now)).toBe(0)
  })

  it('never lowers a wait that is already above the floor from real queue depth', () => {
    const now = Date.now()
    const ahead1 = makeParty({ id: 'a', party_size: 6, checked_in_at: new Date(now - 20 * 60_000).toISOString() })
    const ahead2 = makeParty({ id: 'b', party_size: 6, checked_in_at: new Date(now - 19 * 60_000).toISOString() })
    const party = makeParty({ id: 'c', checked_in_at: new Date(now).toISOString() })
    // Two large-group parties ahead (7 min each = 14) already exceed the 10-min floor.
    expect(getWaitMinutesForParty(party, [ahead1, ahead2, party], 5, 7, 0, now)).toBe(14)
  })

  it('raises the floor by the accumulated Add Time bump', () => {
    const now = Date.now()
    const party = makeParty({ id: 'a', checked_in_at: new Date(now).toISOString() })
    // Base floor (10) + two Add Time clicks worth of extra floor (10) = 20.
    expect(getWaitMinutesForParty(party, [party], 5, 7, 10, now)).toBe(20)
  })
})
