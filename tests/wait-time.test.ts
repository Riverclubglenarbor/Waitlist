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
  it('is just the 10-min base when no active parties are queued', () => {
    const now = Date.now()
    const parties = [
      makeParty({ status: 'playing' }),
      makeParty({ status: 'removed' }),
    ]
    expect(getQueueWaitMinutes(parties, 5, 7, now, now)).toBe(10)
  })

  it('adds the 10-min base to the flat per-group total, counting only still-waiting parties', () => {
    const now = Date.now()
    const parties = [
      makeParty({ party_size: 2, status: 'waiting', checked_in_at: new Date(now).toISOString() }),
      // notified parties have been told to come — their rate no longer
      // counts toward anyone's estimate (Notify Now design)
      makeParty({ party_size: 2, status: 'notified', checked_in_at: new Date(now).toISOString() }),
      makeParty({ party_size: 2, status: 'playing', checked_in_at: new Date(now).toISOString() }),
    ]
    expect(getQueueWaitMinutes(parties, 5, 7, now, now)).toBe(15)
  })

  it('decays with real time since the queue epoch', () => {
    const now = Date.now()
    const epochMs = now - 4 * 60_000
    const parties = [makeParty({ party_size: 2, checked_in_at: new Date(epochMs).toISOString() })]
    expect(getQueueWaitMinutes(parties, 5, 7, epochMs, now)).toBe(11)
  })

  it('never treats a future epoch as negative elapsed time', () => {
    const now = Date.now()
    // Epoch can momentarily sit ahead of the wall clock right after a very
    // fast dequeue — elapsed must clamp at 0, not go negative.
    const epochMs = now + 3 * 60_000
    const parties = [makeParty({ party_size: 2, checked_in_at: new Date(now).toISOString() })]
    expect(getQueueWaitMinutes(parties, 5, 7, epochMs, now)).toBe(15)
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

  it('ignores parties that are not waiting', () => {
    const playing = makeParty({ id: 'a', status: 'playing', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const waiting = makeParty({ id: 'b', status: 'waiting', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(waiting, [playing, waiting])).toBe(1)
  })

  it('no longer counts a notified party — whoever was #2 becomes #1', () => {
    const notified = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const waiting = makeParty({ id: 'b', status: 'waiting', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(waiting, [notified, waiting])).toBe(1)
    expect(getPartyPosition(notified, [notified, waiting])).toBe(0)
  })
})

describe('getWaitMinutesForParty — shared queue floor', () => {
  it('starts a lone first-in-line party at exactly 10 min', () => {
    const now = Date.now()
    const party = makeParty({ id: 'a', checked_in_at: new Date(now).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, now, now)).toBe(10)
  })

  it('counts that 10 min down as real time passes, going below 10', () => {
    const now = Date.now()
    const epochMs = now - 4 * 60_000
    const party = makeParty({ id: 'a', checked_in_at: new Date(epochMs).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, epochMs, now)).toBe(6)
  })

  it('clamps at 0 (ready) once the base and queue-ahead time have both elapsed', () => {
    const now = Date.now()
    const epochMs = now - 11 * 60_000
    const party = makeParty({ id: 'a', checked_in_at: new Date(epochMs).toISOString() })
    expect(getWaitMinutesForParty(party, [party], 5, 7, epochMs, now)).toBe(0)
  })

  it('starts the second party (small group ahead) at 15 — base 10 + that group\'s rate', () => {
    const now = Date.now()
    const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(now).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(now + 1000).toISOString() })
    expect(getWaitMinutesForParty(second, [first, second], 5, 7, now, now)).toBe(15)
  })

  it('starts the second party at 17 when the group ahead of them is large', () => {
    const now = Date.now()
    const first = makeParty({ id: 'a', party_size: 6, checked_in_at: new Date(now).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(now + 1000).toISOString() })
    expect(getWaitMinutesForParty(second, [first, second], 5, 7, now, now)).toBe(17)
  })

  it('decays the first and second party together, in lockstep, off the same shared clock', () => {
    const now = Date.now()
    const epochMs = now - 4 * 60_000
    const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(epochMs).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(epochMs + 1000).toISOString() })
    expect(getWaitMinutesForParty(first, [first, second], 5, 7, epochMs, now)).toBe(6)
    expect(getWaitMinutesForParty(second, [first, second], 5, 7, epochMs, now)).toBe(11)
  })

  it('raising the rate via Add Time raises everyone queued behind it', () => {
    const now = Date.now()
    const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(now).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(now + 1000).toISOString() })
    // Before Add Time: 15. After one +5 click on the small rate (5 -> 10): 20.
    expect(getWaitMinutesForParty(second, [first, second], 5, 7, now, now)).toBe(15)
    expect(getWaitMinutesForParty(second, [first, second], 10, 7, now, now)).toBe(20)
  })

  it('compounds the Add Time bump for parties with multiple groups ahead of them', () => {
    const now = Date.now()
    const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(now).toISOString() })
    const second = makeParty({ id: 'b', party_size: 6, checked_in_at: new Date(now + 1000).toISOString() })
    const third = makeParty({ id: 'c', party_size: 2, checked_in_at: new Date(now + 2000).toISOString() })
    const all = [first, second, third]
    // Before: 10 + 5 + 7 = 22. After +5 on both rates: 10 + 10 + 12 = 32 (+10, not +5).
    expect(getWaitMinutesForParty(third, all, 5, 7, now, now)).toBe(22)
    expect(getWaitMinutesForParty(third, all, 10, 12, now, now)).toBe(32)
  })

  // The old "checking someone in early pulls everyone behind them forward"
  // test that used to live here asserted the implicit re-anchoring behavior
  // this plan removed (the root cause of the wait-time jump bug). That
  // scenario is now covered by tests/queue-epoch-server.test.ts, which tests
  // the epoch-advance behavior that replaces it.

  it('a notified party mid-queue no longer counts toward the wait of parties behind them', () => {
    const now = Date.now()
    const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(now).toISOString() })
    const second = makeParty({ id: 'b', party_size: 6, status: 'notified', checked_in_at: new Date(now + 1000).toISOString() })
    const third = makeParty({ id: 'c', party_size: 2, checked_in_at: new Date(now + 2000).toISOString() })
    const all = [first, second, third]
    // third only pays for first's rate (5), not the notified large group's 7.
    expect(getWaitMinutesForParty(third, all, 5, 7, now, now)).toBe(15)
    // ...but the notified party still gets its own wait computed (it is
    // still on every board — only removal/checkin takes it off entirely).
    expect(getWaitMinutesForParty(second, all, 5, 7, now, now)).toBe(15)
  })
})
