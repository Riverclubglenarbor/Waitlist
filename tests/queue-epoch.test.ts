import { describe, it, expect } from 'vitest'
import { wasFrontOfQueue, parseEpochMs, QUEUE_EPOCH_SETTINGS_KEY } from '@/lib/queue-epoch'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1', first_name: 'Jane', last_initial: 'D', party_size: 2, phone: null,
  paid: false, checked_in_at: new Date().toISOString(), status: 'waiting', ...overrides,
})

describe('wasFrontOfQueue', () => {
  it('is true for the party with the earliest checked_in_at', () => {
    const now = Date.now()
    const a = makeParty({ id: 'a', checked_in_at: new Date(now).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(now + 1000).toISOString() })
    expect(wasFrontOfQueue(a, [a, b])).toBe(true)
    expect(wasFrontOfQueue(b, [a, b])).toBe(false)
  })

  it('breaks identical-timestamp ties by id, matching getPartyPosition', () => {
    const sameTime = new Date().toISOString()
    const a = makeParty({ id: 'aaa', checked_in_at: sameTime })
    const b = makeParty({ id: 'bbb', checked_in_at: sameTime })
    expect(wasFrontOfQueue(a, [b, a])).toBe(true)
    expect(wasFrontOfQueue(b, [b, a])).toBe(false)
  })

  it('is false when the active list is empty', () => {
    const a = makeParty({ id: 'a' })
    expect(wasFrontOfQueue(a, [])).toBe(false)
  })

  it('only considers waiting parties — a notified party earlier in line does not block the real front', () => {
    const now = Date.now()
    const notified = makeParty({ id: 'n', status: 'notified', checked_in_at: new Date(now - 60_000).toISOString() })
    const waiting = makeParty({ id: 'w', status: 'waiting', checked_in_at: new Date(now).toISOString() })
    expect(wasFrontOfQueue(waiting, [notified, waiting])).toBe(true)
    expect(wasFrontOfQueue(notified, [notified, waiting])).toBe(false)
  })

  it('does not throw when the party is the only waiting one among notified/playing parties (Fix 2)', () => {
    const now = Date.now()
    const notified = makeParty({ id: 'n', status: 'notified', checked_in_at: new Date(now - 120_000).toISOString() })
    const playing = makeParty({ id: 'p', status: 'playing', checked_in_at: new Date(now - 60_000).toISOString() })
    const lastWaiting = makeParty({ id: 'w', status: 'waiting', checked_in_at: new Date(now).toISOString() })
    expect(() => wasFrontOfQueue(lastWaiting, [notified, playing, lastWaiting])).not.toThrow()
    expect(wasFrontOfQueue(lastWaiting, [notified, playing, lastWaiting])).toBe(true)
  })

  it('is false when no waiting parties remain in the snapshot at all', () => {
    const notified = makeParty({ id: 'n', status: 'notified' })
    expect(wasFrontOfQueue(notified, [notified])).toBe(false)
  })
})

describe('parseEpochMs', () => {
  it('falls back to the given default when the setting is missing', () => {
    const fallback = Date.now()
    expect(parseEpochMs({}, fallback)).toBe(fallback)
  })

  it('parses a stored ISO timestamp', () => {
    const stored = new Date('2026-07-18T12:00:00.000Z')
    expect(parseEpochMs({ [QUEUE_EPOCH_SETTINGS_KEY]: stored.toISOString() }, Date.now())).toBe(stored.getTime())
  })

  it('falls back on an unparseable stored value instead of throwing', () => {
    const fallback = Date.now()
    expect(parseEpochMs({ [QUEUE_EPOCH_SETTINGS_KEY]: 'not-a-date' }, fallback)).toBe(fallback)
  })
})
