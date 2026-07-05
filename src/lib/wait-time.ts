import type { Party } from '@/types'

const LARGE_PARTY_THRESHOLD = 5

// A newly checked-in party's public link shouldn't jump straight to "ready"
// just because the queue is empty — staff still need this long to get them
// to the tee, so every party's displayed wait floors at this value until
// that much real time has actually passed since they checked in.
const MINIMUM_WAIT_MINUTES = 10

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
}

function minutesSince(isoTime: string, now: number): number {
  return (now - new Date(isoTime).getTime()) / 60_000
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
  largeRate: number
): number {
  const active = allParties.filter(
    p => p.status === 'waiting' || p.status === 'notified'
  )
  return calculateWaitMinutes(active, smallRate, largeRate)
}

export function getWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  now: number = Date.now()
): number {
  const ahead = allParties.filter(
    p =>
      (p.status === 'waiting' || p.status === 'notified') &&
      p.checked_in_at < party.checked_in_at
  )
  const queueWait = calculateWaitMinutes(ahead, smallRate, largeRate)
  const floorRemaining = MINIMUM_WAIT_MINUTES - minutesSince(party.checked_in_at, now)
  return Math.max(queueWait, floorRemaining)
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
