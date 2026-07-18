import { describe, it, expect } from 'vitest'
import {
  getWaitMinutesForParty,
  getRawWaitMinutesForParty,
  getPartyPosition,
} from '@/lib/wait-time'
import { wasFrontOfQueue } from '@/lib/queue-epoch'
import type { Party } from '@/types'

// Property-based stress test (per Ben's explicit request): 220 randomized
// queue scenarios, each driven through a random sequence of real events
// (new check-in, notify front, check-in front, check-in a notified party,
// remove a random party, advance time) against the REAL wait-time.ts +
// queue-epoch.ts functions, with the queue epoch simulated in memory using
// the exact semantics of the advance_queue_epoch Postgres RPC and the API
// routes that call it.
//
// The invariants asserted after EVERY event:
//  (1) no customer-facing wait is ever negative;
//  (2) no still-waiting party's wait ever jumps UPWARD when the front of
//      the waiting queue is dequeued/notified, and it never drops by more
//      than the departing party's own rate — and outside the epoch's
//      clamp window (i.e. once real elapsed time exceeds the departing
//      rate) the change is EXACTLY zero. This is the zero-jump property
//      the whole Phase 2 redesign exists to guarantee; the clamped edge
//      (epoch momentarily ahead of the wall clock right after a fast
//      dequeue) can only ever move waits DOWN, never up.
//      Checking in an already-notified party must change nothing at all.
//  (3) getPartyPosition never assigns two active parties the same nonzero
//      position, and positions of waiting parties are exactly 1..N.
//
// Reproducibility: a seeded PRNG drives everything; any failure message
// includes the scenario seed so the exact counterexample can be replayed.

const LARGE_PARTY_THRESHOLD = 5
const TOL = 1e-9

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Sim {
  rand: () => number
  parties: Party[]
  epochMs: number
  nowMs: number
  lastArrivalMs: number
  nextId: number
  smallRate: number
  largeRate: number
}

function rateOf(sim: Sim, p: Party): number {
  return p.party_size >= LARGE_PARTY_THRESHOLD ? sim.largeRate : sim.smallRate
}

function active(sim: Sim): Party[] {
  return sim.parties.filter(p => p.status === 'waiting' || p.status === 'notified')
}

function waiting(sim: Sim): Party[] {
  return sim.parties.filter(p => p.status === 'waiting')
}

function frontOfWaiting(sim: Sim): Party | undefined {
  return waiting(sim).find(p => getPartyPosition(p, sim.parties) === 1)
}

function randint(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1))
}

function addParty(sim: Sim): void {
  const wasEmpty = active(sim).length === 0
  sim.lastArrivalMs = Math.max(sim.lastArrivalMs + 1, sim.nowMs)
  const p: Party = {
    id: `p${String(sim.nextId++).padStart(4, '0')}`,
    first_name: 'Rand',
    last_initial: 'Q',
    party_size: randint(sim.rand, 1, 8),
    phone: null,
    paid: false,
    checked_in_at: new Date(sim.lastArrivalMs).toISOString(),
    status: 'waiting',
  }
  sim.parties.push(p)
  // Mirrors POST /api/parties: an empty -> non-empty transition restarts
  // the queue clock.
  if (wasEmpty) sim.epochMs = sim.nowMs
}

// Mirrors advanceQueueEpochIfFront + the advance_queue_epoch RPC.
function advanceEpochIfFront(sim: Sim, party: Party, activeBefore: Party[]): void {
  if (!wasFrontOfQueue(party, activeBefore)) return
  sim.epochMs += rateOf(sim, party) * 60_000
}

type EventKind = 'add' | 'notifyFront' | 'checkinFront' | 'checkinNotified' | 'removeRandom' | 'advanceTime'

function snapshotRawWaits(sim: Sim, parties: Party[], epochMs: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const p of parties.filter(x => x.status === 'waiting')) {
    map.set(p.id, getRawWaitMinutesForParty(p, parties, sim.smallRate, sim.largeRate, epochMs, sim.nowMs))
  }
  return map
}

function checkGlobalInvariants(sim: Sim, seed: number): void {
  const act = active(sim)
  // (1) customer-facing waits never negative
  for (const p of act) {
    const w = getWaitMinutesForParty(p, sim.parties, sim.smallRate, sim.largeRate, sim.epochMs, sim.nowMs)
    if (w < 0) throw new Error(`seed ${seed}: negative customer-facing wait ${w} for ${p.id}`)
  }
  // (3) positions: waiting parties get exactly 1..N, no collisions; others 0
  const seen = new Set<number>()
  const waits = waiting(sim)
  for (const p of act) {
    const pos = getPartyPosition(p, sim.parties)
    if (p.status === 'waiting') {
      if (pos < 1 || pos > waits.length) throw new Error(`seed ${seed}: waiting party ${p.id} has out-of-range position ${pos}`)
      if (seen.has(pos)) throw new Error(`seed ${seed}: duplicate position ${pos}`)
      seen.add(pos)
    } else if (pos !== 0) {
      throw new Error(`seed ${seed}: notified party ${p.id} holds numbered position ${pos}`)
    }
  }
}

function runScenario(seed: number): { events: number; waitChecks: number } {
  const rand = mulberry32(seed)
  const t0 = new Date('2026-07-18T08:00:00.000Z').getTime()
  const sim: Sim = {
    rand,
    parties: [],
    epochMs: t0,
    nowMs: t0,
    lastArrivalMs: t0 - 1,
    nextId: 0,
    smallRate: randint(rand, 1, 20),
    largeRate: randint(rand, 1, 20),
  }

  // Initial queue: 1-15 parties arriving with random 0-40 min gaps.
  const initialCount = randint(rand, 1, 15)
  for (let i = 0; i < initialCount; i++) {
    addParty(sim)
    sim.nowMs += Math.floor(rand() * 40 * 60_000)
  }

  let waitChecks = 0
  const eventCount = randint(rand, 5, 20)
  for (let e = 0; e < eventCount; e++) {
    const kinds: EventKind[] = ['add', 'notifyFront', 'checkinFront', 'checkinNotified', 'removeRandom', 'advanceTime']
    let kind = kinds[randint(rand, 0, kinds.length - 1)]
    if (kind === 'notifyFront' && waiting(sim).length === 0) kind = 'add'
    if (kind === 'checkinFront' && waiting(sim).length === 0) kind = 'add'
    if (kind === 'checkinNotified' && !sim.parties.some(p => p.status === 'notified')) kind = 'advanceTime'
    if (kind === 'removeRandom' && active(sim).length === 0) kind = 'add'

    const activeBefore = active(sim).map(p => ({ ...p }))
    const epochBefore = sim.epochMs
    const before = snapshotRawWaits(sim, activeBefore, epochBefore)

    if (kind === 'add') {
      addParty(sim)
      // Existing waiting parties must be completely unaffected by a new
      // arrival behind them (when the queue wasn't empty).
      if (activeBefore.length > 0) {
        const after = snapshotRawWaits(sim, active(sim), sim.epochMs)
        for (const [id, w] of before) {
          const w2 = after.get(id)
          if (w2 === undefined) continue
          waitChecks++
          if (Math.abs(w2 - w) > TOL) throw new Error(`seed ${seed}: new arrival changed ${id}'s wait by ${w2 - w}`)
        }
      }
    } else if (kind === 'advanceTime') {
      const dtMs = Math.floor(rand() * 15 * 60_000)
      sim.nowMs += dtMs
      const after = snapshotRawWaits(sim, active(sim), sim.epochMs)
      for (const [id, w] of before) {
        const w2 = after.get(id)
        if (w2 === undefined) continue
        waitChecks++
        const delta = w2 - w
        // Time passing can only ever count waits DOWN, by at most dt.
        if (delta > TOL || delta < -(dtMs / 60_000) - TOL) {
          throw new Error(`seed ${seed}: advancing time by ${dtMs / 60_000}min changed ${id}'s wait by ${delta}`)
        }
      }
    } else if (kind === 'checkinNotified') {
      const notified = sim.parties.filter(p => p.status === 'notified')
      const target = notified[randint(rand, 0, notified.length - 1)]
      target.status = 'playing'
      advanceEpochIfFront(sim, { ...target, status: 'notified' }, activeBefore) // mirrors ready route; always a no-op for notified
      if (sim.epochMs !== epochBefore) throw new Error(`seed ${seed}: epoch moved on notified checkin`)
      const after = snapshotRawWaits(sim, active(sim), sim.epochMs)
      for (const [id, w] of before) {
        if (id === target.id) continue
        const w2 = after.get(id)
        if (w2 === undefined) continue
        waitChecks++
        if (Math.abs(w2 - w) > TOL) throw new Error(`seed ${seed}: notified checkin changed ${id}'s wait by ${w2 - w}`)
      }
    } else {
      // notifyFront / checkinFront / removeRandom — a party leaves the
      // waiting pool (or the board entirely).
      let target: Party
      if (kind === 'removeRandom') {
        const act = active(sim)
        target = act[randint(rand, 0, act.length - 1)]
      } else {
        target = frontOfWaiting(sim)!
      }
      const targetWasNotified = target.status === 'notified'
      const targetWasFront = wasFrontOfQueue(target, activeBefore)
      const targetRate = rateOf(sim, target)
      const targetSnapshot = { ...target }

      if (kind === 'notifyFront') target.status = 'notified'
      else if (kind === 'checkinFront') target.status = 'playing'
      else target.status = 'removed'

      advanceEpochIfFront(sim, targetSnapshot, activeBefore)

      const after = snapshotRawWaits(sim, active(sim), sim.epochMs)
      const clampWindow = sim.nowMs - epochBefore < targetRate * 60_000
      for (const [id, w] of before) {
        if (id === target.id) continue
        const w2 = after.get(id)
        if (w2 === undefined) continue
        waitChecks++
        const delta = w2 - w
        if (targetWasNotified) {
          // Dequeuing an already-notified party must change nothing.
          if (Math.abs(delta) > TOL) throw new Error(`seed ${seed}: dequeue of notified ${target.id} changed ${id}'s wait by ${delta}`)
        } else if (targetWasFront) {
          // THE zero-jump invariant. Never up; never down by more than the
          // departing party's own rate; exactly zero outside the epoch's
          // startup clamp window.
          if (delta > TOL) throw new Error(`seed ${seed}: front dequeue made ${id}'s wait JUMP UP by ${delta}`)
          if (delta < -targetRate - TOL) throw new Error(`seed ${seed}: front dequeue dropped ${id}'s wait by ${-delta} (> rate ${targetRate})`)
          if (!clampWindow && Math.abs(delta) > TOL) {
            throw new Error(`seed ${seed}: front dequeue changed ${id}'s wait by ${delta} outside the clamp window — expected exactly 0`)
          }
        } else {
          // Mid-queue removal: parties ahead of the removed one are
          // untouched; parties behind drop by exactly the removed rate.
          const expected = targetSnapshot.checked_in_at < activeBefore.find(p => p.id === id)!.checked_in_at ? -targetRate : 0
          if (Math.abs(delta - expected) > TOL) {
            throw new Error(`seed ${seed}: mid-queue removal of ${target.id} changed ${id}'s wait by ${delta}, expected ${expected}`)
          }
        }
      }
    }

    checkGlobalInvariants(sim, seed)
  }
  return { events: eventCount, waitChecks }
}

describe('wait-time zero-jump invariants (property-based)', () => {
  it('holds across 220 randomized queue scenarios with random event sequences', () => {
    const SCENARIOS = 220
    let totalEvents = 0
    let totalWaitChecks = 0
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const { events, waitChecks } = runScenario(seed)
      totalEvents += events
      totalWaitChecks += waitChecks
    }
    // eslint-disable-next-line no-console
    console.log(
      `[property test] ${SCENARIOS} scenarios, ${totalEvents} events simulated, ${totalWaitChecks} per-party wait assertions — all invariants held`
    )
    expect(totalEvents).toBeGreaterThan(1000)
    expect(totalWaitChecks).toBeGreaterThan(5000)
  })
})
