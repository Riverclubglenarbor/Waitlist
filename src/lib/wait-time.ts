import type { Party } from '@/types'

const LARGE_PARTY_THRESHOLD = 5

// The whole active queue shares one 10-minute processing floor, starting
// when its current front (the oldest still-waiting party) checked in. Every
// party in the queue counts down from base + their own queue-ahead total,
// together, in real time — not a floor recalculated per party.
const MINIMUM_WAIT_MINUTES = 10

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
}

function minutesSince(isoTime: string, now: number): number {
  return (now - new Date(isoTime).getTime()) / 60_000
}

function activeParties(allParties: Party[]): Party[] {
  return allParties.filter(p => p.status === 'waiting' || p.status === 'notified')
}

function elapsedSinceQueueStart(active: Party[], now: number): number {
  if (active.length === 0) return 0
  const earliest = active.reduce(
    (min, p) => (p.checked_in_at < min ? p.checked_in_at : min),
    active[0].checked_in_at
  )
  return minutesSince(earliest, now)
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
  now: number = Date.now()
): number {
  const active = activeParties(allParties)
  const elapsed = elapsedSinceQueueStart(active, now)
  return Math.max(0, MINIMUM_WAIT_MINUTES + calculateWaitMinutes(active, smallRate, largeRate) - elapsed)
}

// Unclamped version of getWaitMinutesForParty's math — goes negative once a
// party is overdue, which staff views use to drive urgency states. Customer-
// facing views should use getWaitMinutesForParty instead, which floors at 0.
export function getRawWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  now: number = Date.now()
): number {
  const active = activeParties(allParties)
  const ahead = active.filter(p => p.checked_in_at < party.checked_in_at)
  const elapsed = elapsedSinceQueueStart(active, now)
  return MINIMUM_WAIT_MINUTES + calculateWaitMinutes(ahead, smallRate, largeRate) - elapsed
}

export function getWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  now: number = Date.now()
): number {
  return Math.max(0, getRawWaitMinutesForParty(party, allParties, smallRate, largeRate, now))
}

// Returns the party's 1-based position in the active queue, or 0 if the
// party isn't present in allParties (e.g. already removed or playing).
export function getPartyPosition(party: Party, allParties: Party[]): number {
  const active = allParties
    .filter(p => p.status === 'waiting' || p.status === 'notified')
    .sort((a, b) => {
      const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
    })
  return active.findIndex(p => p.id === party.id) + 1
}

export function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number
): Date {
  const waitMs = getWaitMinutesForParty(party, allParties, smallRate, largeRate) * 60_000
  return new Date(Date.now() + waitMs)
}
