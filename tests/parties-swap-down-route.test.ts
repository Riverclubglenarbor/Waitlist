import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'
import type { Party } from '@/types'

let fake: FakeSupabase

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => fake.client,
}))

import { POST as swapDown } from '@/app/api/parties/[id]/swap-down/route'

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

describe('POST /api/parties/[id]/swap-down', () => {
  it('swaps checked_in_at with the party directly behind and sets moved_up_notice_at on the mover-up only', async () => {
    const a = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    const c = makeParty({ id: 'c', checked_in_at: new Date(t0 + 120_000).toISOString() })
    fake = makeFakeSupabase([a, b, c], baseSettings)

    const res = await swapDown(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)

    const rowA = fake.db.parties.find(p => p.id === 'a')!
    const rowB = fake.db.parties.find(p => p.id === 'b')!
    const rowC = fake.db.parties.find(p => p.id === 'c')!
    expect(rowA.checked_in_at).toBe(b.checked_in_at)
    expect(rowB.checked_in_at).toBe(a.checked_in_at)
    expect(rowB.moved_up_notice_at).toBeTruthy()
    expect(rowA.moved_up_notice_at).toBeUndefined()
    expect(rowC.checked_in_at).toBe(c.checked_in_at)
    expect(rowC.moved_up_notice_at).toBeUndefined()
  })

  it('swaps with the next WAITING party, skipping past notified rows entirely', async () => {
    // n was notified while at the front — its timestamp is earliest, but it
    // must never be a swap target for anyone.
    const n = makeParty({ id: 'n', status: 'notified', checked_in_at: new Date(t0 - 60_000).toISOString() })
    const a = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([n, a, b], baseSettings)

    const res = await swapDown(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)
    expect(fake.db.parties.find(p => p.id === 'a')!.checked_in_at).toBe(b.checked_in_at)
    expect(fake.db.parties.find(p => p.id === 'b')!.checked_in_at).toBe(a.checked_in_at)
    expect(fake.db.parties.find(p => p.id === 'n')!.checked_in_at).toBe(n.checked_in_at)
    expect(fake.db.parties.find(p => p.id === 'n')!.moved_up_notice_at).toBeUndefined()
  })

  it('404s an unknown party', async () => {
    fake = makeFakeSupabase([makeParty({ id: 'a' })], baseSettings)
    const res = await swapDown(req(), { params: { id: 'ghost' } })
    expect(res.status).toBe(404)
  })

  it('409s a notified caller — you cannot un-jump after being called up', async () => {
    const a = makeParty({ id: 'a', status: 'notified', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([a, b], baseSettings)

    const res = await swapDown(req(), { params: { id: 'a' } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/not eligible/i)
    expect(fake.db.parties.find(p => p.id === 'b')!.checked_in_at).toBe(b.checked_in_at)
  })

  it('409s the last party in the waiting list — no one behind to swap with', async () => {
    const a = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([a, b], baseSettings)

    const res = await swapDown(req(), { params: { id: 'b' } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/no one behind/i)
    expect(fake.db.parties.find(p => p.id === 'a')!.checked_in_at).toBe(a.checked_in_at)
    expect(fake.db.parties.find(p => p.id === 'b')!.checked_in_at).toBe(b.checked_in_at)
  })

  it('rolls back the first update and 409s when the target row changed underneath the request', async () => {
    const a = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([a, b], baseSettings)

    // Simulate a racing request landing between this route's fetch and its
    // second conditional update: the moment the second update() is issued,
    // b's checked_in_at has already been changed by someone else.
    const racedAt = new Date(t0 + 999_000).toISOString()
    const client = fake.client as { from: (table: string) => Record<string, unknown> }
    const realFrom = client.from.bind(client)
    let updateCount = 0
    client.from = (table: string) => {
      const builder = realFrom(table) as { update: (vals: Record<string, unknown>) => unknown }
      const realUpdate = builder.update.bind(builder)
      builder.update = (vals: Record<string, unknown>) => {
        updateCount++
        if (updateCount === 2) {
          fake.db.parties.find(p => p.id === 'b')!.checked_in_at = racedAt
        }
        return realUpdate(vals)
      }
      return builder as Record<string, unknown>
    }

    const res = await swapDown(req(), { params: { id: 'a' } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/line changed/i)

    // No half-swapped pair: a's original timestamp was restored by the
    // rollback, and nobody got a moved-up notice.
    expect(fake.db.parties.find(p => p.id === 'a')!.checked_in_at).toBe(a.checked_in_at)
    expect(fake.db.parties.find(p => p.id === 'a')!.moved_up_notice_at).toBeUndefined()
    expect(fake.db.parties.find(p => p.id === 'b')!.moved_up_notice_at).toBeUndefined()
  })

  it('never touches queue_epoch_at — byte-for-byte identical before and after a successful swap', async () => {
    const a = makeParty({ id: 'a', checked_in_at: new Date(t0).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(t0 + 60_000).toISOString() })
    fake = makeFakeSupabase([a, b], baseSettings)
    const epochBefore = fake.getSetting('queue_epoch_at')

    const res = await swapDown(req(), { params: { id: 'a' } })
    expect(res.status).toBe(200)

    expect(fake.getSetting('queue_epoch_at')).toBe(epochBefore)
    expect(fake.rpcCalls).toHaveLength(0)
  })
})
