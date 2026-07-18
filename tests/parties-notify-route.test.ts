import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'
import type { Party } from '@/types'

let fake: FakeSupabase

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => fake.client,
}))

import { POST as notify } from '@/app/api/parties/[id]/notify/route'
import { POST as undoNotify } from '@/app/api/parties/[id]/undo-notify/route'

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

describe('POST /api/parties/[id]/notify', () => {
  it('marks the front waiting party notified (with notified_at) and advances the epoch by their rate', async () => {
    const front = makeParty({ id: 'a', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await notify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)

    const row = fake.db.parties.find(p => p.id === 'a')!
    expect(row.status).toBe('notified')
    expect(row.notified_at).toBeTruthy()
    expect(fake.rpcCalls).toHaveLength(1)
    expect(fake.rpcCalls[0].args.delta_minutes).toBe(5) // large-group rate
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + 5 * 60_000)
  })

  it('409s a party that is not at the front of the waiting queue', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await notify(req(), { params: { id: 'b' } })
    expect(res.status).toBe(409)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('409s an already-notified party', async () => {
    const notified = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([notified], baseSettings)

    const res = await notify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(409)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('does not throw when notifying the only waiting party while notified parties remain (Fix 2)', async () => {
    const alreadyNotified = makeParty({ id: 'n', status: 'notified', checked_in_at: new Date(t0 - 60_000).toISOString() })
    const lastWaiting = makeParty({ id: 'w', status: 'waiting', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([alreadyNotified, lastWaiting], baseSettings)

    const res = await notify(req(), { params: { id: 'w' } })
    expect(res.status).toBe(200)
    expect(fake.db.parties.find(p => p.id === 'w')!.status).toBe('notified')
    expect(fake.rpcCalls).toHaveLength(1)
  })

  it('cascades a notify across split siblings — notifying either row notifies both, epoch advancing once per row', async () => {
    const s1 = makeParty({ id: 's1', first_name: 'Sarah 1', last_initial: 'D', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const s2 = makeParty({ id: 's2', first_name: 'Sarah 2', last_initial: 'D', party_size: 2, checked_in_at: new Date(t0 + 5).toISOString() })
    const mike = makeParty({ id: 'm', first_name: 'Mike', last_initial: 'T', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([s1, s2, mike], baseSettings)

    // Notify the SECOND row of the split — the group as a whole is front.
    const res = await notify(req(), { params: { id: 's2' } })
    expect(res.status).toBe(200)

    expect(fake.db.parties.find(p => p.id === 's1')!.status).toBe('notified')
    expect(fake.db.parties.find(p => p.id === 's2')!.status).toBe('notified')
    expect(fake.db.parties.find(p => p.id === 'm')!.status).toBe('waiting')
    expect(fake.rpcCalls).toHaveLength(2)
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + (5 + 4) * 60_000)
  })

  it('returns 500 when the epoch RPC fails', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings, { failRpc: true })

    const res = await notify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/parties/[id]/undo-notify', () => {
  it('returns the party to waiting and rolls the epoch back to exactly its pre-notify value', async () => {
    const front = makeParty({ id: 'a', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    await notify(req(), { params: { id: 'a' } })
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + 5 * 60_000)

    const res = await undoNotify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)

    const row = fake.db.parties.find(p => p.id === 'a')!
    expect(row.status).toBe('waiting')
    expect(row.notified_at).toBeNull()
    // Perfect inverse: epoch is back to exactly where it started.
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0)
  })

  it('409s a party that is not currently notified', async () => {
    const waiting = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([waiting], baseSettings)

    const res = await undoNotify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(409)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('cascades the undo across split siblings, restoring the epoch fully', async () => {
    const s1 = makeParty({ id: 's1', first_name: 'Sarah 1', last_initial: 'D', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const s2 = makeParty({ id: 's2', first_name: 'Sarah 2', last_initial: 'D', party_size: 2, checked_in_at: new Date(t0 + 5).toISOString() })
    fake = makeFakeSupabase([s1, s2], baseSettings)

    await notify(req(), { params: { id: 's1' } })
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + 9 * 60_000)

    const res = await undoNotify(req(), { params: { id: 's2' } })
    expect(res.status).toBe(200)

    expect(fake.db.parties.find(p => p.id === 's1')!.status).toBe('waiting')
    expect(fake.db.parties.find(p => p.id === 's2')!.status).toBe('waiting')
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0)
  })

  it('returns 500 when the epoch RPC fails', async () => {
    const notified = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([notified], baseSettings, { failRpc: true })

    const res = await undoNotify(req(), { params: { id: 'a' } })
    expect(res.status).toBe(500)
  })
})
