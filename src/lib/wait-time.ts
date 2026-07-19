import type { Party } from '@/types'

const LARGE_PARTY_THRESHOLD = 5

// The whole active queue shares one 10-minute processing floor, measured
// from the persisted queue epoch (`queue_epoch_at` in the settings table —
// see src/lib/queue-epoch.ts). Every party counts down from base + their
// own queue-ahead total, together, in real time — not a floor recalculated
// per party. The epoch is managed server-side (queue-epoch-server.ts): it
// is initialized when the queue goes empty -> non-empty and only ever
// advances by the departing front party's own rate on a front dequeue, so
// no one's wait ever jumps when the front of the line changes.
const MINIMUM_WAIT_MINUTES = 10

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
}

// Parties still consuming a place in line for wait-math purposes. Once a
// party is 'notified' they're still shown on every board (GET /api/parties
// keeps returning waiting + notified), but they've been told to come —
// their rate no longer counts against anyone behind them, and the
// queue-epoch logic treats them the same as if they'd already left. Only
// an actual checkin/removal/no-show takes a party off the boards entirely.
function queuedParties(allParties: Party[]): Party[] {
  return allParties.filter(p => p.status === 'waiting')
}

function elapsedSinceEpoch(epochMs: number, now: number): number {
  return Math.max(0, (now - epochMs) / 60_000)
}

// Same tie-break as getPartyPosition/wasFrontOfQueue/compareQueueOrder
// (checked_in_at asc, ties broken by id) — kept as one shared predicate so
// "who's ahead of whom" can never drift between the position math and the
// wait-time math. Bug 2026-07-18: getRawWaitMinutesForParty used to compare
// checked_in_at with plain `<`, so two parties sharing an identical
// timestamp (e.g. an auto-split large party inserted in the same request)
// were BOTH treated as having nobody ahead of them for wait purposes, even
// though getPartyPosition correctly gave them distinct positions via the id
// tiebreak — silently undercounting the id-later party's wait by exactly
// the id-earlier party's rate.
function isAheadOf(a: Pick<Party, 'checked_in_at' | 'id'>, party: Pick<Party, 'checked_in_at' | 'id'>): boolean {
  const byTime = a.checked_in_at.localeCompare(party.checked_in_at)
  return byTime !== 0 ? byTime < 0 : a.id.localeCompare(party.id) < 0
}

export function calculateWaitMinutes(
  parties: Pick<Party, 'party_size'>[],
  smallRate: number,
  largeRate: number
): number {
  return parties.reduce((total, p) => total + rateForParty(p.party_size, smallRate, largeRate), 0)
}

export function getQueueWaitMinutes(
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number,
  now: number = Date.now()
): number {
  const queued = queuedParties(allParties)
  const elapsed = elapsedSinceEpoch(epochMs, now)
  return Math.max(0, MINIMUM_WAIT_MINUTES + calculateWaitMinutes(queued, smallRate, largeRate) - elapsed)
}

// Unclamped version of getWaitMinutesForParty's math — goes negative once a
// party is overdue, which staff views use to drive urgency states. Customer-
// facing views should use getWaitMinutesForParty instead, which floors at 0.
export function getRawWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number,
  now: number = Date.now()
): number {
  const ahead = queuedParties(allParties).filter(p => isAheadOf(p, party))
  const elapsed = elapsedSinceEpoch(epochMs, now)
  return MINIMUM_WAIT_MINUTES + calculateWaitMinutes(ahead, smallRate, largeRate) - elapsed
}

export function getWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number,
  now: number = Date.now()
): number {
  return Math.max(0, getRawWaitMinutesForParty(party, allParties, smallRate, largeRate, epochMs, now))
}

// Returns the party's 1-based position among the still-WAITING queue, or 0
// if the party isn't counted (already notified, playing, or removed). A
// notified party's row still renders on the boards — just with a
// "notified" badge instead of a number; that's a UI-layer decision, not a
// position concern.
export function getPartyPosition(party: Party, allParties: Party[]): number {
  const waiting = allParties
    .filter(p => p.status === 'waiting')
    .sort((a, b) => {
      const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
    })
  return waiting.findIndex(p => p.id === party.id) + 1
}

export function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number
): Date {
  const waitMs = getWaitMinutesForParty(party, allParties, smallRate, largeRate, epochMs) * 60_000
  return new Date(Date.now() + waitMs)
}
