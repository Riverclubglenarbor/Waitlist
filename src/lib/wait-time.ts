import type { Party } from '@/types'

export function calculateWaitMinutes(
  parties: Pick<Party, 'party_size'>[],
  avgMinPerHole: number
): number {
  return parties.reduce((total, p) => total + avgMinPerHole * p.party_size, 0)
}

export function getQueueWaitMinutes(
  allParties: Party[],
  avgMinPerHole: number
): number {
  const active = allParties.filter(
    p => p.status === 'waiting' || p.status === 'notified'
  )
  return calculateWaitMinutes(active, avgMinPerHole)
}

export function getWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  avgMinPerHole: number
): number {
  const ahead = allParties.filter(
    p =>
      (p.status === 'waiting' || p.status === 'notified') &&
      p.checked_in_at < party.checked_in_at
  )
  return calculateWaitMinutes(ahead, avgMinPerHole)
}

export function getEstimatedTeeTime(
  party: Party,
  allParties: Party[],
  avgMinPerHole: number
): Date {
  const waitMs = getWaitMinutesForParty(party, allParties, avgMinPerHole) * 60_000
  return new Date(Date.now() + waitMs)
}
