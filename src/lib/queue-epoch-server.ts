import type { SupabaseClient } from '@supabase/supabase-js'
import type { Party } from '@/types'
import { wasFrontOfQueue } from './queue-epoch'

const LARGE_PARTY_THRESHOLD = 5

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
}

// The epoch read-modify-write lives in a single atomic Postgres function
// (advance_queue_epoch — see supabase/migrations/*advance_queue_epoch*),
// called via RPC, so two racing requests can never interleave a
// select-then-upsert and lose an update. If the RPC fails we THROW — the
// calling route must surface a 500 rather than report success while the
// board silently drifts (the exact failure mode SKILL.md documents
// happening three times already in this codebase).
async function callAdvanceEpochRpc(supabase: SupabaseClient, deltaMinutes: number): Promise<void> {
  const { error } = await supabase.rpc('advance_queue_epoch', { delta_minutes: deltaMinutes })
  if (error) {
    throw new Error(`advance_queue_epoch RPC failed: ${error.message}`)
  }
}

// Call this AFTER `party`'s status row has already been updated to remove
// them from the waiting queue (checked in, removed, marked no-show,
// notified, or self-ready). `activeBeforeChange` must be the
// waiting/notified list captured BEFORE that update. If `party` was at the
// front of the still-WAITING queue in that snapshot, advances the persisted
// queue epoch forward by exactly their own per-hole rate. It is never reset
// to "now" and never reset to another party's checked_in_at — that
// reset-to-an-unrelated-timestamp behavior was the root cause of the old
// wait-time jump bug (see docs/superpowers/plans/
// 2026-07-18-queue-timing-and-alerts.md and tests/queue-epoch-server.test.ts
// for the proof this keeps waits smooth).
export async function advanceQueueEpochIfFront(
  supabase: SupabaseClient,
  party: Party,
  activeBeforeChange: Party[],
  smallRate: number,
  largeRate: number
): Promise<void> {
  if (!wasFrontOfQueue(party, activeBeforeChange)) return
  const rateMinutes = rateForParty(party.party_size, smallRate, largeRate)
  await callAdvanceEpochRpc(supabase, rateMinutes)
}

// Exact inverse of the epoch advance a Notify performed: subtracts the
// party's own rate from the epoch. Only the dedicated undo-notify route may
// use this (reverting notified -> waiting through the generic PATCH is
// rejected there), so notify + undo-notify is always a perfect no-op pair
// and nobody's wait jumps in either direction.
export async function revertQueueEpochForUndoNotify(
  supabase: SupabaseClient,
  party: Party,
  smallRate: number,
  largeRate: number
): Promise<void> {
  const rateMinutes = rateForParty(party.party_size, smallRate, largeRate)
  await callAdvanceEpochRpc(supabase, -rateMinutes)
}
