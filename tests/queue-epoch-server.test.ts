import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { advanceQueueEpochIfFront, revertQueueEpochForUndoNotify } from '@/lib/queue-epoch-server'
import { getWaitMinutesForParty, getRawWaitMinutesForParty } from '@/lib/wait-time'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1', first_name: 'Jane', last_initial: 'D', party_size: 2, phone: null,
  paid: false, checked_in_at: new Date().toISOString(), status: 'waiting', ...overrides,
})

// Fake Supabase client that implements the advance_queue_epoch Postgres
// function's exact semantics (see supabase/migrations/*advance_queue_epoch*)
// in memory: read current epoch (defaulting to now() when unset), add
// delta_minutes, store. The real thing is a single atomic statement; the
// fake just needs to be behaviorally identical for these tests.
function makeFakeSupabase(initialSettings: Record<string, string>, opts: { failRpc?: boolean } = {}) {
  const settings = { ...initialSettings }
  const rpcCalls: { name: string; args: { delta_minutes: number } }[] = []
  const client = {
    rpc: (name: string, args: { delta_minutes: number }) => {
      rpcCalls.push({ name, args })
      if (opts.failRpc) return Promise.resolve({ data: null, error: { message: 'boom' } })
      if (name !== 'advance_queue_epoch') {
        return Promise.resolve({ data: null, error: { message: `unknown function ${name}` } })
      }
      const raw = settings['queue_epoch_at']
      const currentMs = raw ? new Date(raw).getTime() : Date.now()
      const nextIso = new Date(currentMs + args.delta_minutes * 60_000).toISOString()
      settings['queue_epoch_at'] = nextIso
      return Promise.resolve({ data: nextIso, error: null })
    },
  }
  return { client: client as unknown as SupabaseClient, rpcCalls, settings }
}

describe('advanceQueueEpochIfFront — proves the zero-jump property', () => {
  it('leaves every other active party\'s wait mathematically unchanged the instant the front is dequeued, even when the front sat far longer than its own rate', async () => {
    const t0 = new Date('2026-07-18T09:00:00.000Z').getTime()
    const small = 4, large = 5
    const A = makeParty({ id: 'A', party_size: 2, checked_in_at: new Date(t0).toISOString(), status: 'waiting' })
    const B = makeParty({ id: 'B', party_size: 2, checked_in_at: new Date(t0 + 25 * 60_000).toISOString(), status: 'waiting' })
    const activeBeforeChange = [A, B]

    const dequeueAt = t0 + 30 * 60_000 // staff finally checks A in, 30 min after A arrived
    const { client, rpcCalls, settings } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    const epochBefore = t0
    const rawBefore = getRawWaitMinutesForParty(B, activeBeforeChange, small, large, epochBefore, dequeueAt)
    const clampedBefore = getWaitMinutesForParty(B, activeBeforeChange, small, large, epochBefore, dequeueAt)

    await advanceQueueEpochIfFront(client, A, activeBeforeChange, small, large)

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('advance_queue_epoch')
    expect(rpcCalls[0].args.delta_minutes).toBe(small) // A is a small group
    const epochAfter = new Date(settings['queue_epoch_at']).getTime()
    expect(epochAfter).toBe(epochBefore + small * 60_000) // advanced by exactly A's rate (4 min), not reset

    const Aplaying = { ...A, status: 'playing' as const }
    const activeAfterChange = [Aplaying, B]
    // Evaluated at the same instant, B's wait must be exactly what it was —
    // the epoch advance precisely cancels A's rate leaving the ahead-sum.
    const rawAfter = getRawWaitMinutesForParty(B, activeAfterChange, small, large, epochAfter, dequeueAt)
    const clampedAfter = getWaitMinutesForParty(B, activeAfterChange, small, large, epochAfter, dequeueAt)
    expect(rawAfter).toBe(rawBefore) // the whole point: no jump, proven unclamped
    expect(clampedAfter).toBe(clampedBefore)
  })

  it('does not touch the epoch when the dequeued party was not the front', async () => {
    const t0 = Date.now()
    const A = makeParty({ id: 'A', checked_in_at: new Date(t0).toISOString() })
    const B = makeParty({ id: 'B', checked_in_at: new Date(t0 + 1000).toISOString() })
    const { client, rpcCalls } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    await advanceQueueEpochIfFront(client, B, [A, B], 4, 5)

    expect(rpcCalls).toHaveLength(0)
  })

  it('initializes from now if no epoch is stored yet (queue just started)', async () => {
    const A = makeParty({ id: 'A' })
    const { client, settings } = makeFakeSupabase({})
    const before = Date.now()

    await advanceQueueEpochIfFront(client, A, [A], 4, 5)

    const epochAfter = new Date(settings['queue_epoch_at']).getTime()
    expect(epochAfter).toBeGreaterThanOrEqual(before + 4 * 60_000)
  })

  it('uses the large rate for a large dequeued party', async () => {
    const t0 = Date.now()
    const A = makeParty({ id: 'A', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const { client, rpcCalls } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    await advanceQueueEpochIfFront(client, A, [A], 4, 5)

    expect(rpcCalls[0].args.delta_minutes).toBe(5)
  })

  it('advances the epoch exactly once across notify-then-checkin of the same party', async () => {
    const t0 = Date.now()
    const A = makeParty({ id: 'A', party_size: 2, checked_in_at: new Date(t0).toISOString() })
    const B = makeParty({ id: 'B', party_size: 2, checked_in_at: new Date(t0 + 60_000).toISOString() })
    const { client, rpcCalls, settings } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    // Staff notifies A (front of the waiting queue) — epoch advances.
    await advanceQueueEpochIfFront(client, A, [A, B], 4, 5)
    expect(rpcCalls).toHaveLength(1)
    const epochAfterNotify = settings['queue_epoch_at']

    // A later checks in at the counter — by then their status is
    // 'notified', so they are no longer in the waiting-only front check
    // and the epoch must NOT advance again.
    const Anotified = { ...A, status: 'notified' as const }
    await advanceQueueEpochIfFront(client, Anotified, [Anotified, B], 4, 5)
    expect(rpcCalls).toHaveLength(1)
    expect(settings['queue_epoch_at']).toBe(epochAfterNotify)
  })

  it('surfaces an RPC failure instead of swallowing it', async () => {
    const A = makeParty({ id: 'A' })
    const { client } = makeFakeSupabase({}, { failRpc: true })
    await expect(advanceQueueEpochIfFront(client, A, [A], 4, 5)).rejects.toThrow(/advance_queue_epoch/)
  })
})

describe('revertQueueEpochForUndoNotify — exact inverse of a notify', () => {
  it('returns the epoch and every other party\'s wait to exactly their pre-notify values', async () => {
    const t0 = new Date('2026-07-18T10:00:00.000Z').getTime()
    const small = 4, large = 5
    const A = makeParty({ id: 'A', party_size: 6, checked_in_at: new Date(t0).toISOString() })
    const B = makeParty({ id: 'B', party_size: 2, checked_in_at: new Date(t0 + 5 * 60_000).toISOString() })
    const now = t0 + 12 * 60_000
    const { client, settings } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    const waitPreNotify = getRawWaitMinutesForParty(B, [A, B], small, large, t0, now)

    // Notify A (front, large group -> +5 min on the epoch).
    await advanceQueueEpochIfFront(client, A, [A, B], small, large)
    const Anotified = { ...A, status: 'notified' as const }
    const epochAfterNotify = new Date(settings['queue_epoch_at']).getTime()
    expect(epochAfterNotify).toBe(t0 + large * 60_000)

    // Undo — epoch must come back to exactly t0.
    await revertQueueEpochForUndoNotify(client, Anotified, small, large)
    const epochAfterUndo = new Date(settings['queue_epoch_at']).getTime()
    expect(epochAfterUndo).toBe(t0)

    const Arestored = { ...A, status: 'waiting' as const }
    const waitPostUndo = getRawWaitMinutesForParty(B, [Arestored, B], small, large, epochAfterUndo, now)
    expect(waitPostUndo).toBe(waitPreNotify)
  })

  it('surfaces an RPC failure instead of swallowing it', async () => {
    const A = makeParty({ id: 'A', status: 'notified' })
    const { client } = makeFakeSupabase({}, { failRpc: true })
    await expect(revertQueueEpochForUndoNotify(client, A, 4, 5)).rejects.toThrow(/advance_queue_epoch/)
  })
})
