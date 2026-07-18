import type { Party } from '@/types'

// Comparator matching wait-time.ts's getPartyPosition ordering exactly:
// checked_in_at ascending, tie-broken by id — so "who is front" is never
// ambiguous, even when two parties share an identical checked_in_at (e.g.
// an auto-split large party inserted in the same request).
function compareQueueOrder(a: Party, b: Party): number {
  const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
}

// True if `party` was at position 1 among the still-WAITING parties within
// `activeBeforeChange` — the snapshot captured BEFORE party's own status
// changed. Used to decide whether dequeuing (or notifying) this party
// should advance the shared queue epoch (see queue-epoch-server.ts).
//
// Only `status === 'waiting'` parties are considered: once a party is
// 'notified' their rate has already been removed from everyone's math (and
// the epoch already advanced), so they can never be "the front" again for
// epoch purposes. NOTE the ordering here — filter first, THEN check for
// emptiness — so notifying/dequeuing the last waiting party while
// notified/playing parties still sit in the snapshot cannot throw.
export function wasFrontOfQueue(party: Party, activeBeforeChange: Party[]): boolean {
  const waiting = activeBeforeChange.filter(p => p.status === 'waiting')
  if (waiting.length === 0) return false
  const sorted = [...waiting].sort(compareQueueOrder)
  return sorted[0].id === party.id
}

export const QUEUE_EPOCH_SETTINGS_KEY = 'queue_epoch_at'

// Reads the persisted queue epoch (an ISO timestamp string in the settings
// key-value table) and returns it as epoch milliseconds. Falls back to
// `fallbackNowMs` when unset or unparseable — this covers both "queue was
// just created and no epoch exists yet" and any bad data defensively.
export function parseEpochMs(settings: Record<string, string>, fallbackNowMs: number): number {
  const raw = settings[QUEUE_EPOCH_SETTINGS_KEY]
  if (!raw) return fallbackNowMs
  const parsed = new Date(raw).getTime()
  return Number.isFinite(parsed) ? parsed : fallbackNowMs
}
