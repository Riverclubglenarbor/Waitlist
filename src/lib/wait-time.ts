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
  return parties.reduce((total, p) => total + rateForParty(p.party_size, smallRate, largeRate) * p.party_size, 0)
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

export function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number
): Date {
  const waitMs = getWaitMinutesForParty(party, allParties, smallRate, largeRate) * 60_000
  return new Date(Date.now() + waitMs)
}
