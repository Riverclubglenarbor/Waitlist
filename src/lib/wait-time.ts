import type { Party } from '@/types'

const LARGE_PARTY_THRESHOLD = 5

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
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
  largeRate: number
): number {
  const ahead = allParties.filter(
    p =>
      (p.status === 'waiting' || p.status === 'notified') &&
      p.checked_in_at < party.checked_in_at
  )
  return calculateWaitMinutes(ahead, smallRate, largeRate)
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
