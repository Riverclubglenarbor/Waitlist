import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'
import type { Party } from '@/types'

let fake: FakeSupabase

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => fake.client,
}))

// Imported after the mock so the route picks up the mocked supabase client.
import { PATCH, DELETE } from '@/app/api/parties/[id]/route'

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

function patchRequest(body: object): Request {
  return new Request('http://localhost/api/parties/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/parties/[id]', () => {
  it('advances the queue epoch by the front party\'s own rate when the front is checked in', async () => {
    const front = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 6, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await PATCH(patchRequest({ status: 'playing' }), { params: { id: 'a' } })
    expect(res.status).toBe(200)

    expect(fake.rpcCalls).toHaveLength(1)
    expect(fake.rpcCalls[0].args.delta_minutes).toBe(4) // small-group rate
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + 4 * 60_000)
    expect(fake.db.parties.find(p => p.id === 'a')!.status).toBe('playing')
  })

  it('does not touch the epoch when a non-front party is checked in', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await PATCH(patchRequest({ status: 'playing' }), { params: { id: 'b' } })
    expect(res.status).toBe(200)

    expect(fake.rpcCalls).toHaveLength(0)
    expect(fake.getSetting('queue_epoch_at')).toBe(baseSettings.queue_epoch_at)
  })

  it('does not touch the epoch for non-status updates like the paid toggle', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings)

    const res = await PATCH(patchRequest({ paid: true }), { params: { id: 'a' } })
    expect(res.status).toBe(200)
    expect(fake.rpcCalls).toHaveLength(0)
    expect(fake.db.parties[0].paid).toBe(true)
  })

  it('rejects reverting a notified party to waiting — that path must go through undo-notify', async () => {
    const notified = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([notified], baseSettings)

    const res = await PATCH(patchRequest({ status: 'waiting' }), { params: { id: 'a' } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/undo-notify/)
    expect(fake.db.parties[0].status).toBe('notified')
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('cascades a check-in across split-party siblings, advancing the epoch for each in turn', async () => {
    const s1 = makeParty({ id: 's1', first_name: 'Sarah 1', last_initial: 'D', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const s2 = makeParty({ id: 's2', first_name: 'Sarah 2', last_initial: 'D', party_size: 2, checked_in_at: new Date(t0 + 5).toISOString() })
    const mike = makeParty({ id: 'm', first_name: 'Mike', last_initial: 'T', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([s1, s2, mike], baseSettings)

    const res = await PATCH(patchRequest({ status: 'playing' }), { params: { id: 's1' } })
    expect(res.status).toBe(200)

    expect(fake.db.parties.find(p => p.id === 's1')!.status).toBe('playing')
    expect(fake.db.parties.find(p => p.id === 's2')!.status).toBe('playing')
    expect(fake.db.parties.find(p => p.id === 'm')!.status).toBe('waiting')
    // Epoch advanced once per sibling, each by its own rate: 5 (large) + 4 (small).
    expect(fake.rpcCalls).toHaveLength(2)
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + (5 + 4) * 60_000)
  })

  it('returns the current row without advancing the epoch when a racing request already dequeued the party', async () => {
    const front = makeParty({ id: 'a', status: 'playing', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings)

    const res = await PATCH(patchRequest({ status: 'playing' }), { params: { id: 'a' } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('playing')
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('returns 500 and does not report success when the epoch RPC fails', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    fake = makeFakeSupabase([front], baseSettings, { failRpc: true })

    const res = await PATCH(patchRequest({ status: 'playing' }), { params: { id: 'a' } })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/advance_queue_epoch/)
  })
})

describe('DELETE /api/parties/[id]', () => {
  it('advances the epoch when the front waiting party is removed', async () => {
    const front = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await DELETE(new Request('http://localhost'), { params: { id: 'a' } })
    expect(res.status).toBe(204)

    expect(fake.rpcCalls).toHaveLength(1)
    expect(fake.rpcCalls[0].args.delta_minutes).toBe(4)
    expect(fake.db.parties.find(p => p.id === 'a')).toBeUndefined()
  })

  it('does not touch the epoch when a mid-queue party is removed', async () => {
    const front = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([front, second], baseSettings)

    const res = await DELETE(new Request('http://localhost'), { params: { id: 'b' } })
    expect(res.status).toBe(204)
    expect(fake.rpcCalls).toHaveLength(0)
  })

  it('cascades removal across split siblings', async () => {
    const s1 = makeParty({ id: 's1', first_name: 'Sarah 1', last_initial: 'D', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const s2 = makeParty({ id: 's2', first_name: 'Sarah 2', last_initial: 'D', party_size: 2, checked_in_at: new Date(t0 + 5).toISOString() })
    const mike = makeParty({ id: 'm', first_name: 'Mike', last_initial: 'T', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([s1, s2, mike], baseSettings)

    const res = await DELETE(new Request('http://localhost'), { params: { id: 's1' } })
    expect(res.status).toBe(204)

    expect(fake.db.parties.find(p => p.id === 's1')).toBeUndefined()
    expect(fake.db.parties.find(p => p.id === 's2')).toBeUndefined()
    expect(fake.db.parties.find(p => p.id === 'm')).toBeDefined()
    expect(fake.rpcCalls).toHaveLength(2)
    expect(new Date(fake.getSetting('queue_epoch_at')!).getTime()).toBe(t0 + (5 + 4) * 60_000)
  })
})
