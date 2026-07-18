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
})
