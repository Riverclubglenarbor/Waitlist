import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'
import type { Party } from '@/types'

let fake: FakeSupabase

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => fake.client,
}))

import { POST } from '@/app/api/parties/[id]/ready/route'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1', first_name: 'Jane', last_initial: 'D', party_size: 2, phone: null,
  paid: false, checked_in_at: new Date().toISOString(), status: 'waiting', ...overrides,
})

const t0 = new Date('2026-07-18T09:00:00.000Z').getTime()
const baseSettings = {
  avg_min_per_hole_small: '4',
  avg_min_per_hole_large: '5',
  queue_epoch_at: new Date(t0).toISOString(),
}

const req = () => new Request('http://localhost', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/parties/[id]/ready', () => {
  it('lets the front waiting party check in and advances the epoch by their rate', async () => {
    const front = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await POST(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)
    expect(fake.db.parties.find(p => p.id === 'a')!.status).toBe('playing')
    expect(fake.rpcCalls).toHaveLength(1)
    expect(fake.rpcCalls[0].args.delta_minutes).toBe(4)
  })

  it('still 409s a waiting party who is not first in line', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await POST(req(), { params: { id: 'b' } })
    expect(res.status).toBe(409)
    expect(fake.db.parties.find(p => p.id === 'b')!.status).toBe('waiting')
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('lets a notified party self-checkin even though their numeric position is 0, without double-advancing the epoch', async () => {
    // Fix 1: a notified party no longer occupies a numbered position, but
    // being notified IS being called up — they must keep their ready button.
    const notified = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(t0).toISOString() })
    const waiting = makeParty({ id: 'b', status: 'waiting', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([notified, waiting], baseSettings)

    const res = await POST(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)
    expect(fake.db.parties.find(p => p.id === 'a')!.status).toBe('playing')
    // Epoch already advanced when they were notified — must NOT advance again.
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('returns 500 when the epoch RPC fails instead of reporting success', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings, { failRpc: true })

    const res = await POST(req(), { params: { id: 'a' } })
    expect(res.status).toBe(500)
  })

  it('404s a party that is no longer active', async () => {
    fake = makeFakeSupabase([], baseSettings)
    const res = await POST(req(), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  // Bug found 2026-07-18 (post-incident audit): the route used to fire the
  // status update without checking how many rows it matched, then advance
  // the epoch unconditionally. A double-tapped "I'm at the tee" button
  // fires two near-simultaneous requests that BOTH read the party as
  // waiting-front; the loser's update silently matched zero rows but its
  // epoch advance still ran — advancing the epoch twice for one departure
  // and permanently inflating everyone's wait by the party's rate. Same
  // lost-update class as the live Speed Up incident. The fake's thenables
  // execute at each await, so Promise.all interleaves the two requests
  // exactly like the real race: both reads happen before either write.
  it('double-fired ready taps advance the epoch exactly once', async () => {
    const front = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const [res1, res2] = await Promise.all([
      POST(req(), { params: { id: 'a' } }),
      POST(req(), { params: { id: 'a' } }),
    ])

    // Both taps report success to the guest (the loser sees the party is
    // already playing and treats it as a duplicate of its own action)...
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(fake.db.parties.find(p => p.id === 'a')!.status).toBe('playing')
    // ...but the epoch advanced exactly ONCE, by the party's own rate.
    expect(fake.rpcCalls).toHaveLength(1)
    expect(fake.rpcCalls[0].args.delta_minutes).toBe(4)
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + 4 * 60_000)
  })

  it('409s (without touching the epoch) when the status changed between read and write for a reason other than a duplicate tap', async () => {
    const front = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings)

    // Simulate staff notifying the party in the window between this
    // request's read and its conditional write: patch the fake so the first
    // parties read returns the stale 'waiting' row while the live table
    // already says 'notified'.
    const liveRow = fake.db.parties.find(p => p.id === 'a')!
    const client = fake.client as { from: (t: string) => unknown }
    const realFrom = client.from.bind(client)
    let firstPartiesRead = true
    client.from = (table: string) => {
      if (table === 'parties' && firstPartiesRead) {
        firstPartiesRead = false
        liveRow.status = 'notified' // flips AFTER the stale read is built below
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [{ ...liveRow, status: 'waiting' }], error: null }),
          }),
        }
      }
      return realFrom(table)
    }

    const res = await POST(req(), { params: { id: 'a' } })
    expect(res.status).toBe(409)
    // The party keeps its (raced-in) notified status and the epoch is
    // untouched — the notify that won the race owns that bookkeeping.
    expect(fake.db.parties.find(p => p.id === 'a')!.status).toBe('notified')
    expect(fake.rpcCalls).toHaveLength(0)
  })
})
