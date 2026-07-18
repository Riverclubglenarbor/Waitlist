import type { Party } from '@/types'

// Matches the split-labeling convention from POST /api/parties: same
// last_initial, and first_name of the form "<base> <N>" sharing the same
// <base> — e.g. "Sarah 1" and "Sarah 2" are siblings of the same original
// check-in. A party whose first_name has no trailing " <number>" has no
// siblings (the common case: nobody split).
function splitBaseName(firstName: string): string | null {
  const match = firstName.match(/^(.*) (\d+)$/)
  return match ? match[1] : null
}

export function findSiblings(party: Party, allParties: Party[]): Party[] {
  const base = splitBaseName(party.first_name)
  if (!base) return []
  return allParties.filter(p =>
    p.id !== party.id &&
    p.last_initial === party.last_initial &&
    splitBaseName(p.first_name) === base
  )
}

// Queue-order comparator (checked_in_at asc, tie-broken by id) — cascading
// a transition across split siblings must process them front-to-back so
// each one is "the front" at the moment its own epoch check runs; see the
// notify/checkin/remove cascades in the API routes.
export function compareQueueOrder(a: Party, b: Party): number {
  const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
}
