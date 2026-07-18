# Queue Timing & Ready-Alert Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the staff/guest wait-time display from jumping unpredictably, stop the guest "come on in" self-checkin screen from appearing for more than one person at once, show the public lobby board the wait of the person who most recently joined the line (not a hypothetical next arrival), and add an opt-in sound+vibration alert on the guest's phone when it's actually their turn.

**Architecture:** Three independent phases, ordered by risk. Phase 1 ships an already-built control (Subtract/Speed Up Time), fixes the guest ready-gate to check real queue position instead of just a wait-time threshold, and repoints the public board's headline number at the last-checked-in party. Phase 2 replaces the queue's "elapsed = time since whichever active party has the earliest checked_in_at" calculation (which resets to an unrelated guest-arrival timestamp every time the front of the line changes, causing jumps) with a persisted `queue_epoch_at` timestamp that only ever advances by a known, bounded amount — the departing front party's own per-hole rate — whenever the front of the queue is actually dequeued. Phase 3 adds a one-tap-to-unlock sound/vibration alert on the guest tracking page, working around iOS's block on unprompted audio.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres `parties` + `settings` key-value tables), Vitest + Testing Library, Web Audio API, Vibration API.

**Context all workers must read first:** `SKILL.md` at repo root (the project's own developer skill — read the "Critical rule: one wait-time formula" section before touching anything under `src/lib/wait-time.ts` or any of its consumers). `src/lib/wait-time.ts` in full. No staging environment exists — verification for anything server-side happens against the live production Supabase project using clearly-named test parties (e.g. `ZTest1`) that get removed before the task is marked done.

---

## Phase 1 — low risk, ship first

### Task 1: Ship the already-built Speed Up (Subtract Time) feature

**Files:**
- Already created/modified, currently uncommitted in the working tree: `src/app/api/settings/subtract-time/route.ts`, `src/app/checkin/page.tsx`, `tests/subtract-time-route.test.ts`
- No new code needed — this task is verify-and-ship.

- [ ] **Step 1: Review the existing uncommitted diff**

Run: `git diff -- src/app/api/settings/subtract-time/route.ts src/app/checkin/page.tsx tests/subtract-time-route.test.ts` and `git status --short`

Confirm: a `subtract-time` POST route mirroring `add-time` (clamped at `MIN_RATE = 1`), a green "Speed Up" button in the check-in page header with its own confirm modal/flash/loading state independent of "Add Time", and a Vitest file covering normal-subtract, clamp-from-above, already-at-floor, and the rate fallback path.

- [ ] **Step 2: Run the full test suite and typecheck**

Run: `npm run test`
Expected: all tests pass (should be 79 passing plus whatever Task 2/3 below add).

Run: `npx tsc --noEmit`
Expected: no new errors introduced by these three files (pre-existing unrelated errors in `personal-track-board.test.tsx`/`pin-gate.test.tsx` from a missing `vitest/globals` types reference are known and out of scope for this plan).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/subtract-time/route.ts src/app/checkin/page.tsx tests/subtract-time-route.test.ts
git commit -m "feat: add Speed Up (subtract time) control next to Add Time"
```

- [ ] **Step 4: Use it immediately to correct the live, already-inflated rate**

Before deploying, note current production settings are `avg_min_per_hole_small: 20`, `avg_min_per_hole_large: 22` (confirmed via `GET https://river-club-waitlist.vercel.app/api/settings` on 2026-07-18) — almost certainly the result of repeated Add Time clicks with no prior way back down. After deploy (Step 5), click Speed Up on the live `/checkin` page enough times to bring both rates back down near a realistic 4–5 min/hole, watching the `/checkin` header flash message for the `clamped: true` "Already at minimum" case so you know when to stop.

- [ ] **Step 5: Deploy**

```bash
git push origin main
vercel --prod --yes
```

Expected: deploy succeeds; `GET https://river-club-waitlist.vercel.app/api/settings` reflects the new rate after using Speed Up.

---

### Task 2: Gate the guest "come on in" screen on actual queue position, not just wait ≤ 0

**Files:**
- Modify: `src/components/track/PersonalTrackBoard.tsx:121-149`
- Test: `tests/personal-track-board.test.tsx` (existing file — follow its current mocking pattern for `fetch`/Supabase realtime)

**Why:** `PersonalTrackBoard.tsx` currently shows the ready screen whenever `wait <= 0`, with no check that this guest is actually #1. `position` is already computed on line 122 and used for color, just not for gating the ready screen. Under the Phase 2 jump bug, several guests can hit `wait <= 0` simultaneously, so several guests see "Grab your putters" and try to self-checkin at once — the server-side `/ready` endpoint (`src/app/api/parties/[id]/ready/route.ts:26-28`) already correctly 409s anyone who isn't actually position 1, but the button shouldn't be offered to the wrong people in the first place.

- [ ] **Step 1: Write the failing test**

Add to `tests/personal-track-board.test.tsx` (adapt the file's existing fetch-mocking setup — mock `/api/parties`, `/api/settings`, and `/api/parties/:id` to return a scenario where the rendered party has `wait <= 0` computed but is NOT first in the active list):

```tsx
it('does not show the ready button when wait is 0 but this guest is not first in line', async () => {
  const now = Date.now()
  const front = makeParty({ id: 'front-id', checked_in_at: new Date(now - 20 * 60_000).toISOString() })
  const self = makeParty({ id: 'self-id', checked_in_at: new Date(now - 19 * 60_000).toISOString() })
  mockPartiesResponse([front, self]) // use whichever helper this file already uses to stub GET /api/parties
  mockSelfResponse(self) // stub GET /api/parties/self-id
  render(<PersonalTrackBoard id="self-id" />)
  await screen.findByText(/Position/i)
  expect(screen.queryByText(/Grab your putters/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/I'm Ready for the Course/i)).not.toBeInTheDocument()
})

it('still shows the ready button when wait is 0 and this guest really is first in line', async () => {
  const now = Date.now()
  const self = makeParty({ id: 'self-id', checked_in_at: new Date(now - 20 * 60_000).toISOString() })
  mockPartiesResponse([self])
  mockSelfResponse(self)
  render(<PersonalTrackBoard id="self-id" />)
  await screen.findByText(/Grab your putters/i)
  expect(screen.getByText(/I'm Ready for the Course/i)).toBeInTheDocument()
})
```

(Match `makeParty`/mock-response helper names to whatever this test file already defines — read it first.)

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run tests/personal-track-board.test.tsx`
Expected: the "not first in line" test FAILS (ready button currently shows because the code only checks `wait <= 0`).

- [ ] **Step 3: Fix the gate**

In `src/components/track/PersonalTrackBoard.tsx`, line 131 currently reads:

```tsx
      {wait <= 0 ? (
```

Change to:

```tsx
      {wait <= 0 && position === 1 ? (
```

No other lines in this block need to change — the `else` branch already renders `Position #{position}` and `~{wait} min`, which is exactly the right fallback for a guest whose personal wait clock reads 0 but who isn't actually up yet.

- [ ] **Step 4: Run to verify both tests pass, and the full suite still passes**

Run: `npx vitest run tests/personal-track-board.test.tsx`
Expected: PASS

Run: `npm run test`
Expected: all tests pass, nothing else broken.

- [ ] **Step 5: Commit**

```bash
git add src/components/track/PersonalTrackBoard.tsx tests/personal-track-board.test.tsx
git commit -m "fix: only show guest ready screen to the actual front-of-line party"
```

---

### Task 3: Public lobby board shows the last-checked-in party's own wait, not a hypothetical next arrival

**Files:**
- Modify: `src/components/waitlist/WaitlistBoard.tsx:4,57`
- Test: create `tests/waitlist-board.test.tsx` if no such file exists (check first: `ls tests/ | grep -i waitlist`); if it exists, add to it instead.

**Why:** `WaitlistBoard.tsx` line 57 currently computes the big "Current Wait" hero number as `getQueueWaitMinutes(parties, smallRate, largeRate)`, which is the 10-min floor plus every active party's rate minus elapsed — effectively "how long would a brand-new arrival wait," not any real guest's actual number. Ben wants this to read as "the wait of the person who just checked in" instead — i.e., the last party in the line, since `GET /api/parties` already returns parties ordered by `checked_in_at` ascending (`src/app/api/parties/route.ts:18`), so the last element of `parties` is always the most recently checked-in active party.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the wait of the most recently checked-in party, not the queue-wide next-arrival estimate', () => {
  const now = Date.now()
  const first = makeParty({ id: 'a', party_size: 2, checked_in_at: new Date(now).toISOString() })
  const last = makeParty({ id: 'b', party_size: 2, checked_in_at: new Date(now + 1000).toISOString() })
  mockPartiesAndSettings([first, last], { avg_min_per_hole_small: '5', avg_min_per_hole_large: '7' })
  render(<WaitlistBoard />)
  // last party's own wait: 10 (base) + 5 (first's rate) - ~0 elapsed = 15
  // (queue-wide getQueueWaitMinutes would instead show 10 + 5 + 5 = 20 — the wrong number)
  await screen.findByText('15')
})
```

(Adapt to whatever fetch-mocking helper pattern the codebase's other component tests use — check `tests/queue-view-countdown.test.tsx` for the closest existing example of mocking `/api/parties` + `/api/settings` together for a polling component.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/waitlist-board.test.tsx`
Expected: FAIL, shows `20` instead of `15`.

- [ ] **Step 3: Fix it**

In `src/components/waitlist/WaitlistBoard.tsx`, line 4 currently imports both functions:

```tsx
import { getQueueWaitMinutes, getWaitMinutesForParty } from '@/lib/wait-time'
```

Change to (drop the now-unused import):

```tsx
import { getWaitMinutesForParty } from '@/lib/wait-time'
```

Line 57 currently reads:

```tsx
  const totalWait = Math.round(getQueueWaitMinutes(parties, smallRate, largeRate))
```

Change to:

```tsx
  const lastParty = parties[parties.length - 1]
  const totalWait = Math.round(getWaitMinutesForParty(lastParty, parties, smallRate, largeRate))
```

Note: this line only runs when `parties.length > 0` (the component returns `<EmptyBoard />` early on line 55 when the array is empty), so `lastParty` is always defined here.

- [ ] **Step 4: Run to verify it passes, and full suite still passes**

Run: `npx vitest run tests/waitlist-board.test.tsx && npm run test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/waitlist/WaitlistBoard.tsx tests/waitlist-board.test.tsx
git commit -m "fix: public board shows last-checked-in party's actual wait, not next-arrival estimate"
```

- [ ] **Step 6: Deploy Phase 1 tasks 2 and 3 together with Task 1**

```bash
git push origin main
vercel --prod --yes
```

---

## Phase 2 — the structural jump fix

### Task 4: Add the pure queue-epoch logic module

**Files:**
- Create: `src/lib/queue-epoch.ts`
- Test: create `tests/queue-epoch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { wasFrontOfQueue, parseEpochMs, QUEUE_EPOCH_SETTINGS_KEY } from '@/lib/queue-epoch'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1', first_name: 'Jane', last_initial: 'D', party_size: 2, phone: null,
  paid: false, checked_in_at: new Date().toISOString(), status: 'waiting', ...overrides,
})

describe('wasFrontOfQueue', () => {
  it('is true for the party with the earliest checked_in_at', () => {
    const now = Date.now()
    const a = makeParty({ id: 'a', checked_in_at: new Date(now).toISOString() })
    const b = makeParty({ id: 'b', checked_in_at: new Date(now + 1000).toISOString() })
    expect(wasFrontOfQueue(a, [a, b])).toBe(true)
    expect(wasFrontOfQueue(b, [a, b])).toBe(false)
  })

  it('breaks identical-timestamp ties by id, matching getPartyPosition', () => {
    const sameTime = new Date().toISOString()
    const a = makeParty({ id: 'aaa', checked_in_at: sameTime })
    const b = makeParty({ id: 'bbb', checked_in_at: sameTime })
    expect(wasFrontOfQueue(a, [b, a])).toBe(true)
    expect(wasFrontOfQueue(b, [b, a])).toBe(false)
  })

  it('is false when the active list is empty', () => {
    const a = makeParty({ id: 'a' })
    expect(wasFrontOfQueue(a, [])).toBe(false)
  })
})

describe('parseEpochMs', () => {
  it('falls back to the given default when the setting is missing', () => {
    const fallback = Date.now()
    expect(parseEpochMs({}, fallback)).toBe(fallback)
  })

  it('parses a stored ISO timestamp', () => {
    const stored = new Date('2026-07-18T12:00:00.000Z')
    expect(parseEpochMs({ [QUEUE_EPOCH_SETTINGS_KEY]: stored.toISOString() }, Date.now())).toBe(stored.getTime())
  })

  it('falls back on an unparseable stored value instead of throwing', () => {
    const fallback = Date.now()
    expect(parseEpochMs({ [QUEUE_EPOCH_SETTINGS_KEY]: 'not-a-date' }, fallback)).toBe(fallback)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/queue-epoch.test.ts`
Expected: FAIL with "Cannot find module '@/lib/queue-epoch'".

- [ ] **Step 3: Implement**

```ts
// src/lib/queue-epoch.ts
import type { Party } from '@/types'

// Comparator matching wait-time.ts's getPartyPosition ordering exactly:
// checked_in_at ascending, tie-broken by id — so "who is front" is never
// ambiguous, even when two parties share an identical checked_in_at (e.g.
// an auto-split large party inserted in the same request).
function compareQueueOrder(a: Party, b: Party): number {
  const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
}

// True if `party` was at position 1 within `activeBeforeChange` — the
// waiting/notified list captured BEFORE party's own status changed. Used to
// decide whether dequeuing this party should advance the shared queue
// epoch (see queue-epoch-server.ts).
export function wasFrontOfQueue(party: Party, activeBeforeChange: Party[]): boolean {
  if (activeBeforeChange.length === 0) return false
  const sorted = [...activeBeforeChange].sort(compareQueueOrder)
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/queue-epoch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue-epoch.ts tests/queue-epoch.test.ts
git commit -m "feat: add pure queue-epoch logic (front detection, epoch parsing)"
```

---

### Task 5: Change wait-time.ts to take the epoch as an explicit parameter

**Files:**
- Modify: `src/lib/wait-time.ts:5-9,23-30,40-75,89-97`
- Modify: `tests/wait-time.test.ts` (update every call site to pass the new `epochMs` parameter)

**Why:** This is the actual fix. Today, `elapsedSinceQueueStart` (lines 23-30) derives "elapsed" by finding whichever active party has the earliest `checked_in_at` — a real guest-arrival timestamp that jumps discontinuously whenever the front of the queue changes. Replacing it with an explicit, externally-managed `epochMs` parameter (advanced only by Task 6's server helper, by a known bounded amount) makes every consumer's math continuous by construction.

- [ ] **Step 1: Update the failing tests first**

In `tests/wait-time.test.ts`, every call to `getQueueWaitMinutes(...)` and `getWaitMinutesForParty(...)` needs a new `epochMs` argument inserted before the trailing `now` argument. The existing tests all use `checked_in_at` as the epoch equivalent today, so the direct migration is: wherever a test currently relies on the earliest party's `checked_in_at` as the implicit epoch, pass that same timestamp explicitly as `epochMs`. For example, line 67 currently:

```ts
expect(getQueueWaitMinutes(parties, 5, 7, now)).toBe(20)
```
becomes:
```ts
expect(getQueueWaitMinutes(parties, 5, 7, now, now)).toBe(20) // epoch == now, nothing elapsed yet
```

Line 73 currently:
```ts
const parties = [makeParty({ party_size: 2, checked_in_at: new Date(now - 4 * 60_000).toISOString() })]
expect(getQueueWaitMinutes(parties, 5, 7, now)).toBe(11)
```
becomes:
```ts
const checkedInAt = now - 4 * 60_000
const parties = [makeParty({ party_size: 2, checked_in_at: new Date(checkedInAt).toISOString() })]
expect(getQueueWaitMinutes(parties, 5, 7, checkedInAt, now)).toBe(11)
```

Apply this same mechanical transform (epoch = the timestamp the old code would have derived, i.e. the earliest active party's `checked_in_at` at the moment each test's scenario begins) to every test in the `getQueueWaitMinutes` and `getWaitMinutesForParty` describe blocks, including the multi-party and Add-Time tests. For the last test in the file (`'checking someone in early pulls everyone behind them forward too'`), this is the one scenario that changes MEANING, not just call signature — see Task 7's test file instead, which replaces this exact scenario with the corrected epoch-advance behavior. Delete this specific test from `wait-time.test.ts` (it asserted the old, jumpy behavior) with a comment pointing to where its replacement now lives: `// This scenario is now covered by tests/queue-epoch-server.test.ts, which tests the epoch-advance behavior that replaces the old implicit re-anchoring this test used to assert.`

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/wait-time.test.ts`
Expected: FAIL — signature mismatch / wrong argument count errors.

- [ ] **Step 3: Implement**

In `src/lib/wait-time.ts`, delete the `elapsedSinceQueueStart` function (lines 23-30) entirely — it's no longer used by anything. Add in its place:

```ts
function elapsedSinceEpoch(epochMs: number, now: number): number {
  return Math.max(0, (now - epochMs) / 60_000)
}
```

Change `getQueueWaitMinutes` (currently lines 40-49) to:

```ts
export function getQueueWaitMinutes(
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number,
  now: number = Date.now()
): number {
  const active = activeParties(allParties)
  const elapsed = elapsedSinceEpoch(epochMs, now)
  return Math.max(0, MINIMUM_WAIT_MINUTES + calculateWaitMinutes(active, smallRate, largeRate) - elapsed)
}
```

Change `getRawWaitMinutesForParty` (currently lines 54-65) to:

```ts
export function getRawWaitMinutesForParty(
  party: Party,
  allParties: Party[],
  smallRate: number,
  largeRate: number,
  epochMs: number,
  now: number = Date.now()
): number {
  const active = activeParties(allParties)
  const ahead = active.filter(p => p.checked_in_at < party.checked_in_at)
  const elapsed = elapsedSinceEpoch(epochMs, now)
  return MINIMUM_WAIT_MINUTES + calculateWaitMinutes(ahead, smallRate, largeRate) - elapsed
}
```

Change `getWaitMinutesForParty` (currently lines 67-75) to thread the new parameter through:

```ts
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
```

Change `getEstimatedTeeTime` (currently lines 89-97) to accept and forward `epochMs`:

```ts
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
```

`calculateWaitMinutes` and `getPartyPosition` are unchanged — neither depends on elapsed time.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/wait-time.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/wait-time.ts tests/wait-time.test.ts
git commit -m "refactor: wait-time.ts takes queue epoch as an explicit parameter"
```

---

### Task 6: Server helper that advances the epoch only when the front of the queue is actually dequeued

**Files:**
- Create: `src/lib/queue-epoch-server.ts`
- Test: create `tests/queue-epoch-server.test.ts`

**Why — the core correctness claim this task must prove with a test:** right before a front-of-queue dequeue at real time T, some other active party X has `wait_before = 10 + ahead_sum_before - elapsed(epoch_before, T)`. This task's helper sets `epoch_after = epoch_before + rate(dequeued party)`. Immediately after (same instant T, party removed from the active set so `ahead_sum_after = ahead_sum_before - rate(dequeued party)`): `wait_after = 10 + ahead_sum_before - rate(dequeued) - elapsed(epoch_before + rate(dequeued), T) = 10 + ahead_sum_before - rate(dequeued) - (T - epoch_before - rate(dequeued))/60000`. Since `elapsed(epoch_before, T) = (T - epoch_before)/60000`, algebraic substitution shows `wait_after == wait_before` exactly. The test below proves this numerically, matching the scenario that originally demonstrated the bug (party checked in 25 min after the one ahead of them; front gets dequeued at the 30-minute mark).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'
import { getWaitMinutesForParty } from '@/lib/wait-time'
import type { Party } from '@/types'

const makeParty = (overrides: Partial<Party>): Party => ({
  id: '1', first_name: 'Jane', last_initial: 'D', party_size: 2, phone: null,
  paid: false, checked_in_at: new Date().toISOString(), status: 'waiting', ...overrides,
})

function makeFakeSupabase(initialSettings: Record<string, string>) {
  const rows = Object.entries(initialSettings).map(([key, value]) => ({ key, value }))
  const upserted: Record<string, string>[] = []
  return {
    client: {
      from: (table: string) => {
        if (table !== 'settings') throw new Error(`unexpected table ${table}`)
        return {
          select: () => Promise.resolve({ data: rows, error: null }),
          upsert: (records: { key: string; value: string }[]) => {
            upserted.push(...records)
            records.forEach(r => {
              const existing = rows.find(row => row.key === r.key)
              if (existing) existing.value = r.value
              else rows.push(r)
            })
            return Promise.resolve({ error: null })
          },
        }
      },
    },
    upserted,
  }
}

describe('advanceQueueEpochIfFront — proves the zero-jump property', () => {
  it('leaves every other active party\'s wait mathematically unchanged the instant the front is dequeued, even when the front sat far longer than its own rate', async () => {
    const t0 = new Date('2026-07-18T09:00:00.000Z').getTime()
    const small = 4, large = 5
    const A = makeParty({ id: 'A', party_size: 2, checked_in_at: new Date(t0).toISOString(), status: 'waiting' })
    const B = makeParty({ id: 'B', party_size: 2, checked_in_at: new Date(t0 + 25 * 60_000).toISOString(), status: 'waiting' })
    const activeBeforeChange = [A, B]

    const dequeueAt = t0 + 30 * 60_000 // staff finally checks A in, 30 min after A arrived
    const { client, upserted } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    const epochBefore = t0
    const waitBefore = getWaitMinutesForParty(B, activeBeforeChange, small, large, epochBefore, dequeueAt)

    await advanceQueueEpochIfFront(client as any, A, activeBeforeChange, small, large)

    expect(upserted).toHaveLength(1)
    expect(upserted[0].key).toBe('queue_epoch_at')
    const epochAfter = new Date(upserted[0].value).getTime()
    expect(epochAfter).toBe(epochBefore + small * 60_000) // advanced by exactly A's rate (4 min), not reset

    const Aplaying = { ...A, status: 'playing' as const }
    const activeAfterChange = [Aplaying, B]
    const waitAfter = getWaitMinutesForParty(B, activeAfterChange, small, large, epochAfter, dequeueAt + 1000)

    expect(waitAfter).toBe(waitBefore) // the whole point: no jump
  })

  it('does not touch the epoch when the dequeued party was not the front', async () => {
    const t0 = Date.now()
    const A = makeParty({ id: 'A', checked_in_at: new Date(t0).toISOString() })
    const B = makeParty({ id: 'B', checked_in_at: new Date(t0 + 1000).toISOString() })
    const { client, upserted } = makeFakeSupabase({ queue_epoch_at: new Date(t0).toISOString() })

    await advanceQueueEpochIfFront(client as any, B, [A, B], 4, 5)

    expect(upserted).toHaveLength(0)
  })

  it('initializes from Date.now() if no epoch is stored yet (queue just started)', async () => {
    const A = makeParty({ id: 'A' })
    const { client, upserted } = makeFakeSupabase({})
    const before = Date.now()

    await advanceQueueEpochIfFront(client as any, A, [A], 4, 5)

    expect(upserted).toHaveLength(1)
    const epochAfter = new Date(upserted[0].value).getTime()
    expect(epochAfter).toBeGreaterThanOrEqual(before + 4 * 60_000)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/queue-epoch-server.test.ts`
Expected: FAIL with "Cannot find module '@/lib/queue-epoch-server'".

- [ ] **Step 3: Implement**

```ts
// src/lib/queue-epoch-server.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Party } from '@/types'
import { wasFrontOfQueue, parseEpochMs, QUEUE_EPOCH_SETTINGS_KEY } from './queue-epoch'

const LARGE_PARTY_THRESHOLD = 5

function rateForParty(partySize: number, smallRate: number, largeRate: number): number {
  return partySize >= LARGE_PARTY_THRESHOLD ? largeRate : smallRate
}

// Call this AFTER `party`'s status row has already been updated to remove
// them from the active queue (checked in, removed, marked no-show, or
// self-ready). `activeBeforeChange` must be the waiting/notified list
// captured BEFORE that update. If `party` was at the front of that list,
// advances the persisted queue epoch forward by exactly their own per-hole
// rate. It is never reset to "now" and never reset to another party's
// checked_in_at — that reset-to-an-unrelated-timestamp behavior was the
// root cause of the old wait-time jump bug (see
// docs/superpowers/plans/2026-07-18-queue-timing-and-alerts.md and
// tests/queue-epoch-server.test.ts for the proof this keeps waits smooth).
export async function advanceQueueEpochIfFront(
  supabase: SupabaseClient,
  party: Party,
  activeBeforeChange: Party[],
  smallRate: number,
  largeRate: number
): Promise<void> {
  if (!wasFrontOfQueue(party, activeBeforeChange)) return

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const currentEpochMs = parseEpochMs(settings, Date.now())
  const rateMinutes = rateForParty(party.party_size, smallRate, largeRate)
  const newEpochMs = currentEpochMs + rateMinutes * 60_000

  await supabase
    .from('settings')
    .upsert([{ key: QUEUE_EPOCH_SETTINGS_KEY, value: new Date(newEpochMs).toISOString() }])
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/queue-epoch-server.test.ts`
Expected: PASS — in particular, `waitAfter === waitBefore` in the first test is the load-bearing assertion. If this fails, do not adjust the test to make it pass — the algebra is provably correct; a failure means the implementation has a bug (most likely: rate resolved for the wrong party, or epoch upserted before vs. after the caller's own status-transition query race — re-check the exact `wasFrontOfQueue` snapshot timing in the calling route in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue-epoch-server.ts tests/queue-epoch-server.test.ts
git commit -m "feat: advance queue epoch by a bounded, known amount on front dequeue"
```

---

### Task 7: Wire the epoch into every API route that can dequeue the front, plus queue initialization

**Files:**
- Modify: `src/app/api/parties/[id]/route.ts` (PATCH and DELETE handlers)
- Modify: `src/app/api/parties/[id]/ready/route.ts`
- Modify: `src/app/api/parties/route.ts` (GET stays the same; POST needs epoch initialization)
- Test: `tests/parties-id-route.test.ts`, `tests/parties-ready-route.test.ts` — check whether these files already exist (`ls tests/ | grep -i parties`); if so extend them, otherwise create following the mocking pattern from `tests/subtract-time-route.test.ts`.

**Race guard (from design review — implement exactly this way):** every dequeue must (a) capture the active list BEFORE the change, (b) perform the status update as a conditional query that only succeeds if the row's status was still `waiting`/`notified` at update time, (c) only call `advanceQueueEpochIfFront` if that conditional update actually affected a row. This prevents a double-advance if two requests race to dequeue the same party (e.g. staff clicks Check In at the exact moment a guest's `/ready` call also lands).

- [ ] **Step 1: Write the failing tests**

For the PATCH handler in `src/app/api/parties/[id]/route.ts`, add a test asserting: given two active parties where the one being PATCHed to `status: 'playing'` is the front, the route calls the Supabase settings upsert with an advanced `queue_epoch_at`. Given the same PATCH but the party is NOT the front, no epoch upsert happens. Mirror this shape for DELETE. Mirror it again for `ready/route.ts`'s POST (which already 409s non-front parties, so the epoch-advance test there only needs the success path — the position-1 guest whose `/ready` call succeeds). Write these against whatever Supabase-client mocking pattern `tests/subtract-time-route.test.ts` already established for this repo (mock `@/lib/supabase-server`'s `createServerClient`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/parties-id-route.test.ts tests/parties-ready-route.test.ts`
Expected: FAIL (routes don't call the epoch helper yet).

- [ ] **Step 3: Implement — PATCH and DELETE in `src/app/api/parties/[id]/route.ts`**

Replace the current PATCH handler (lines 21-45) with:

```ts
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const body = await request.json()
  const allowedFields = ['status', 'notes', 'paid']
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowedFields.includes(k))
  )

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const isDequeue = update.status === 'playing' || update.status === 'no_show' || update.status === 'removed'
  let activeBeforeChange: Party[] = []
  let smallRate = 4, largeRate = 5
  if (isDequeue) {
    const [{ data: active }, { data: settingsRows }] = await Promise.all([
      supabase.from('parties').select('*').in('status', ['waiting', 'notified']),
      supabase.from('settings').select('*'),
    ])
    activeBeforeChange = active ?? []
    const settings = Object.fromEntries(
      (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    )
    const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
    smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
    largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))
  }

  const { data, error } = await supabase
    .from('parties')
    .update(update)
    .eq('id', params.id)
    .in('status', ['waiting', 'notified']) // race guard: only succeeds if still active
    .select()
    .single()

  if (error) {
    // No row matched the conditional filter (already dequeued by a racing
    // request) — not a real error, just nothing left to do.
    if (error.code === 'PGRST116') {
      const { data: fallbackData } = await supabase.from('parties').select('*').eq('id', params.id).single()
      return fallbackData
        ? NextResponse.json(fallbackData)
        : NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (isDequeue && data) {
    await advanceQueueEpochIfFront(supabase, data, activeBeforeChange, smallRate, largeRate)
  }

  return NextResponse.json(data)
}
```

Add the import at the top of the file:

```ts
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'
import type { Party } from '@/types'
```

Replace the DELETE handler (lines 47-56) with:

```ts
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const [{ data: active }, { data: settingsRows }, { data: partyBeingDeleted }] = await Promise.all([
    supabase.from('parties').select('*').in('status', ['waiting', 'notified']),
    supabase.from('settings').select('*'),
    supabase.from('parties').select('*').eq('id', params.id).single(),
  ])

  const { error } = await supabase.from('parties').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (partyBeingDeleted && (partyBeingDeleted.status === 'waiting' || partyBeingDeleted.status === 'notified')) {
    const settings = Object.fromEntries(
      (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    )
    const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
    const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
    const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))
    await advanceQueueEpochIfFront(supabase, partyBeingDeleted, active ?? [], smallRate, largeRate)
  }

  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: Implement — `src/app/api/parties/[id]/ready/route.ts`**

Replace the file's POST handler body (after the existing `position !== 1` 409 check on line 26-28) — insert the epoch advance between the position check and the update, and pass `activeParties` (already fetched as `allParties` on line 13) as the before-change snapshot:

```ts
  const { error: updateError } = await supabase
    .from('parties')
    .update({ status: 'playing' })
    .eq('id', params.id)
    .in('status', ['waiting', 'notified']) // race guard

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))
  await advanceQueueEpochIfFront(supabase, party, allParties ?? [], smallRate, largeRate)

  return NextResponse.json({ ok: true })
```

Add the import: `import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'`.

- [ ] **Step 5: Implement — initialize the epoch in `src/app/api/parties/route.ts` POST**

In the POST handler, right after the existing `activeParties` fetch (lines 39-42), insert epoch initialization for the empty-queue-to-non-empty transition:

```ts
  const { data: activeParties } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
  if (!activeParties || activeParties.length === 0) {
    await supabase.from('settings').upsert([{ key: 'queue_epoch_at', value: new Date().toISOString() }])
  }
```

And update the `getQueueWaitMinutes` call two lines below (currently `getQueueWaitMinutes(allActive, smallRate, largeRate)`) to pass the epoch — read it from `settings` (already fetched above as `settingsRows`) via `parseEpochMs`, importing from `@/lib/queue-epoch`:

```ts
  const epochMs = parseEpochMs(settings, Date.now())
  const waitMinutes = Math.round(getQueueWaitMinutes(allActive, smallRate, largeRate, epochMs))
```

- [ ] **Step 6: Run to verify all pass**

Run: `npm run test`
Expected: all tests pass, including the new ones from Steps 1-2.

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/parties/[id]/route.ts src/app/api/parties/[id]/ready/route.ts src/app/api/parties/route.ts tests/
git commit -m "feat: wire queue-epoch advance into checkin/remove/ready routes; initialize on queue start"
```

---

### Task 8: Update the four UI consumers to fetch and pass the epoch

**Files:**
- Modify: `src/components/checkin/QueueView.tsx` (imports `getRawWaitMinutesForParty`, fetches settings on mount)
- Modify: `src/components/waitlist/WaitlistBoard.tsx` (already fetches settings each poll via `fetchAll`)
- Modify: `src/components/track/PersonalTrackBoard.tsx` (already fetches settings each poll via `fetchAll`)
- Modify: `src/components/track/TrackBoard.tsx`

**Pattern (identical in all four files):** each component already fetches `/api/settings` into a settings object (or destructures rate fields from it) either once on mount or every poll. Add one more piece of state, `epochMs`, parsed from that same settings response via `parseEpochMs` from `@/lib/queue-epoch`, and thread it as the new required argument into every `getWaitMinutesForParty` / `getRawWaitMinutesForParty` call in that file — the call sites and their exact current line numbers are listed per file below.

- [ ] **Step 1: `src/components/checkin/QueueView.tsx`**

Add import: `import { parseEpochMs } from '@/lib/queue-epoch'`

The settings fetch (lines 35-40) currently sets `smallRate`/`largeRate` from the response `s`. Add a new state `const [epochMs, setEpochMs] = useState(() => Date.now())` and inside that same `.then(s => { ... })` callback, add: `setEpochMs(parseEpochMs(s, Date.now()))`.

Line 132 currently:
```tsx
const rawWaitMinutes = getRawWaitMinutesForParty(party, parties, smallRate, largeRate, now)
```
becomes:
```tsx
const rawWaitMinutes = getRawWaitMinutesForParty(party, parties, smallRate, largeRate, epochMs, now)
```

Note: `QueueView` currently only fetches settings once on mount (not on its 3s poll), so `epochMs` will lag behind real epoch-advance events until the user reloads the page or `refreshKey` changes. Fix this by moving the settings fetch inside `fetchParties` (called every 3s already) instead of its own separate one-time `useEffect` — merge the two so every 3s poll refreshes both parties and settings together, matching how `WaitlistBoard.tsx` and `PersonalTrackBoard.tsx` already do it.

- [ ] **Step 2: `src/components/waitlist/WaitlistBoard.tsx`**

Add import: `import { parseEpochMs } from '@/lib/queue-epoch'`

Add `const [epochMs, setEpochMs] = useState(() => Date.now())` alongside the existing `smallRate`/`largeRate` state. In `fetchAll` (lines 27-42), after `settingsData` is parsed, add: `setEpochMs(parseEpochMs(settingsData, Date.now()))`.

Update the Task 3 change from Phase 1 (line ~58, `getWaitMinutesForParty(lastParty, parties, smallRate, largeRate)`) to append `, epochMs`. Update the per-row call (currently line 85, `getWaitMinutesForParty(party, parties, smallRate, largeRate)`) to append `, epochMs`.

- [ ] **Step 3: `src/components/track/PersonalTrackBoard.tsx`**

Add import: `import { parseEpochMs } from '@/lib/queue-epoch'`

Add `const [epochMs, setEpochMs] = useState(() => Date.now())`. In `fetchAll` (lines 17-39), after `settingsData` is parsed, add: `setEpochMs(parseEpochMs(settingsData, Date.now()))`.

Line 123 currently:
```tsx
const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate))
```
becomes:
```tsx
const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate, epochMs))
```

- [ ] **Step 4: `src/components/track/TrackBoard.tsx`**

Read this file first (it wasn't included in this plan's research — it's short, follows the same `fetchAll`-with-settings pattern as the other three). Apply the identical `epochMs` state + `parseEpochMs` wiring, and append `, epochMs` to its one `getWaitMinutesForParty` call site (currently around line 53).

- [ ] **Step 5: Run full suite and typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all pass, no type errors. Update any component test in `tests/` that mocks `/api/settings` without a `queue_epoch_at` key — `parseEpochMs` falls back to `Date.now()` in that case, which is safe, but double check no test asserts an exact wait number that depended on the old implicit-epoch behavior (search: `grep -rn "getWaitMinutesForParty\|getRawWaitMinutesForParty" tests/`).

- [ ] **Step 6: Commit**

```bash
git add src/components/checkin/QueueView.tsx src/components/waitlist/WaitlistBoard.tsx src/components/track/PersonalTrackBoard.tsx src/components/track/TrackBoard.tsx
git commit -m "feat: thread queue epoch through all wait-time UI consumers"
```

---

### Task 9: Live verification against production (no staging environment exists)

**Files:** none — this is a manual/scripted verification task against the live app.

- [ ] **Step 1: Deploy**

```bash
git push origin main
vercel --prod --yes
```

- [ ] **Step 2: Reproduce the original bug scenario live and confirm it's fixed**

Using the `/checkin` staff dashboard on the live URL: add two test parties named `ZTest1` and `ZTest2` (small groups), wait roughly a minute between adding them so their `checked_in_at` values differ meaningfully, then click "Check In" on `ZTest1`. Watch `ZTest2`'s "Time Till Tee Off" number in the moment right before and right after — it should shift down by a small, bounded amount (roughly `ZTest1`'s configured rate), never jump upward or swing by many minutes.

- [ ] **Step 3: Clean up**

Remove `ZTest1` (already checked in — clean up via direct removal if the UI doesn't offer it for `playing` status, otherwise leave as-is since it's out of the active queue and harmless) and `ZTest2` via the Remove button so production data is left clean, per `SKILL.md`'s testing notes.

- [ ] **Step 4: Sync the dormant sms-dispatch edge function copy**

Per `SKILL.md`, `supabase/functions/sms-dispatch/index.ts` is a separate Deno deployment that hand-copies this same formula and is currently NOT deployed (no Supabase CLI access to this client's project). Update its local copy of `calculateWaitMinutes`/`getEstimatedTeeTime` (lines ~30-60 and ~124) to match the new epoch-based signature for consistency, so the next person who touches this file isn't looking at three-times-drifted logic again — but do not attempt to deploy it (still blocked per `SKILL.md`'s "Known gaps" section; leave a comment noting it's updated-but-undeployed same as before).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sms-dispatch/index.ts
git commit -m "chore: sync dormant sms-dispatch formula copy with epoch-based wait-time.ts"
```

---

## Phase 3 — guest sound/vibration alert

### Task 10: Build the opt-in ready-alert hook

**Files:**
- Create: `src/lib/use-ready-alert.ts`
- Test: create `tests/use-ready-alert.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReadyAlert } from '@/lib/use-ready-alert'

class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume = vi.fn(() => Promise.resolve())
  createOscillator = vi.fn(() => ({
    frequency: { value: 0 }, type: '', connect: vi.fn().mockReturnThis(),
    start: vi.fn(), stop: vi.fn(),
  }))
  createGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  ;(window as any).AudioContext = FakeAudioContext
  ;(navigator as any).vibrate = vi.fn()
})

describe('useReadyAlert', () => {
  it('shows the prompt when no preference is stored for this party', () => {
    const { result } = renderHook(() => useReadyAlert('party-1', false))
    expect(result.current.showPrompt).toBe(true)
  })

  it('hides the prompt and remembers "yes" after choosing it', () => {
    const { result, rerender } = renderHook(() => useReadyAlert('party-1', false))
    act(() => result.current.choose('yes'))
    rerender()
    expect(result.current.showPrompt).toBe(false)
    expect(window.localStorage.getItem('river-club-ready-alert:party-1')).toBe('yes')
  })

  it('fires the chime and vibration exactly once on the false-to-true ready transition when opted in', () => {
    const { result, rerender } = renderHook(
      ({ isReady }) => useReadyAlert('party-1', isReady),
      { initialProps: { isReady: false } }
    )
    act(() => result.current.choose('yes'))
    rerender({ isReady: true })
    expect((navigator.vibrate as any)).toHaveBeenCalledTimes(1)
    rerender({ isReady: true }) // stays ready — must not fire again
    expect((navigator.vibrate as any)).toHaveBeenCalledTimes(1)
  })

  it('never vibrates or plays sound if the guest opted out', () => {
    const { result, rerender } = renderHook(
      ({ isReady }) => useReadyAlert('party-1', isReady),
      { initialProps: { isReady: false } }
    )
    act(() => result.current.choose('no'))
    rerender({ isReady: true })
    expect((navigator.vibrate as any)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/use-ready-alert.test.ts`
Expected: FAIL with "Cannot find module '@/lib/use-ready-alert'".

- [ ] **Step 3: Implement**

```ts
// src/lib/use-ready-alert.ts
'use client'
import { useEffect, useRef, useState } from 'react'

type AlertPreference = 'yes' | 'no' | null

function storageKey(partyId: string): string {
  return `river-club-ready-alert:${partyId}`
}

function readPreference(partyId: string): AlertPreference {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(storageKey(partyId))
  return raw === 'yes' || raw === 'no' ? raw : null
}

// Synthesizes a short two-tone chime with the Web Audio API instead of
// shipping an audio file asset. Only ever called from playAlert(), which
// only ever fires after choose('yes') has already created and resumed the
// AudioContext from a real user tap — required for this to be exempt from
// iOS Safari's block on unprompted audio.
function playChime(ctx: AudioContext) {
  const now = ctx.currentTime
  ;[880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.001, now + i * 0.18)
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now + i * 0.18)
    osc.stop(now + i * 0.18 + 0.32)
  })
}

export function useReadyAlert(partyId: string, isReady: boolean) {
  const [preference, setPreference] = useState<AlertPreference>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const wasReadyRef = useRef(false)

  useEffect(() => {
    setPreference(readPreference(partyId))
  }, [partyId])

  function choose(pref: 'yes' | 'no') {
    setPreference(pref)
    window.localStorage.setItem(storageKey(partyId), pref)
    if (pref === 'yes') {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        const ctx = new Ctx()
        ctx.resume().catch(() => {})
        audioCtxRef.current = ctx
      }
    }
  }

  useEffect(() => {
    if (isReady && !wasReadyRef.current && preference === 'yes') {
      const ctx = audioCtxRef.current
      if (ctx) playChime(ctx)
      if (typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200])
    }
    wasReadyRef.current = isReady
  }, [isReady, preference])

  return {
    showPrompt: preference === null,
    choose,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/use-ready-alert.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-ready-alert.ts tests/use-ready-alert.test.ts
git commit -m "feat: add opt-in ready-alert hook (synthesized chime + vibration)"
```

---

### Task 11: Wire the alert prompt and trigger into PersonalTrackBoard

**Files:**
- Modify: `src/components/track/PersonalTrackBoard.tsx`
- Test: `tests/personal-track-board.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('shows the sound-alert prompt on first visit and hides it after a choice', async () => {
  const now = Date.now()
  const self = makeParty({ id: 'self-id', checked_in_at: new Date(now - 5 * 60_000).toISOString() })
  mockPartiesResponse([self])
  mockSelfResponse(self)
  render(<PersonalTrackBoard id="self-id" />)
  await screen.findByText(/Play a sound when it's your turn/i)
  fireEvent.click(screen.getByText(/^Yes$/i))
  expect(screen.queryByText(/Play a sound when it's your turn/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/personal-track-board.test.tsx`
Expected: FAIL — prompt doesn't exist yet.

- [ ] **Step 3: Implement**

Add import at the top of `src/components/track/PersonalTrackBoard.tsx`:

```tsx
import { useReadyAlert } from '@/lib/use-ready-alert'
```

After line 123 (`const wait = Math.round(...)`), add:

```tsx
  const isReady = wait <= 0 && position === 1
  const { showPrompt, choose } = useReadyAlert(id, isReady)
```

In the main return block (starting line 125), add the prompt banner as the first child inside the outer `<div>`, before the existing `<p>` showing the guest's name:

```tsx
      {showPrompt && (
        <div className="fixed top-0 inset-x-0 bg-white text-rc-navy px-6 py-4 flex flex-col items-center gap-3 shadow-lg z-10 animate-pop-in">
          <p className="text-base font-semibold text-center">Play a sound when it&apos;s your turn?</p>
          <div className="flex gap-3">
            <button
              onClick={() => choose('no')}
              className="border border-slate-300 text-slate-600 font-bold px-6 py-2 rounded-xl"
            >
              No
            </button>
            <button
              onClick={() => choose('yes')}
              className="bg-rc-green text-white font-bold px-6 py-2 rounded-xl"
            >
              Yes
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Run to verify pass, and full suite**

Run: `npx vitest run tests/personal-track-board.test.tsx && npm run test && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/track/PersonalTrackBoard.tsx tests/personal-track-board.test.tsx
git commit -m "feat: opt-in sound/vibration alert on the guest tracking page"
```

- [ ] **Step 6: Deploy**

```bash
git push origin main
vercel --prod --yes
```

- [ ] **Step 7: Live verification**

Load a real `/track/[id]` URL on an actual phone (not just desktop devtools — iOS's autoplay restriction is the whole point being tested here). Confirm the prompt appears, tapping "Yes" makes no sound itself (silent unlock), and manually driving a test party to `wait <= 0 && position === 1` (e.g. via `/checkin` Check-In on whoever's ahead of it) causes an audible chime + vibration on that phone. Clean up the test party afterward per `SKILL.md`'s testing notes.

---

## Phase 2 Addendum — "Notify Now" (added after clarifying with Ben, before Phase 2 build started)

**Requirement:** when the course is running ahead of schedule, staff need a way to push the front-of-queue group to come now WITHOUT removing them from the board — they may be in the bar, not quite at the course yet. A group only actually leaves the board two ways, both already existing and both unchanged by this addendum: staff checks them in at the Caddyshack counter (`PATCH status: 'playing'`), or the guest self-checks-in from their own tracking link once they're physically at hole 1 (`POST /api/parties/[id]/ready`). "Notify Now" is a new middle state — `status: 'notified'` (already a valid value in the `Party` type, already partially styled amber in `QueueView.tsx`) — that marks a group as called-up while they're still visible on every board, and stops that group from counting toward anyone else's wait from that moment on. Because the whole queue shares one clock, this pulls **every** party still `waiting` forward, not just the one directly behind — same as any other front-dequeue event.

This changes the meaning of "who counts as ahead of you" everywhere in `wait-time.ts`, so it must be folded into Task 5 and Task 7 below, not bolted on after:

### Amendment to Task 5 (`src/lib/wait-time.ts`)

Add a filter step scoped to `status === 'waiting'` only, distinct from the existing `activeParties` (which stays `waiting`/`notified`, and keeps being used for "is this party still on the board at all," e.g. what `GET /api/parties` returns and what the TV board renders):

```ts
// Parties still consuming a place in line for wait-math purposes. Once a
// party is 'notified' they're still shown on every board (see
// activeParties), but they've been told to come — their rate no longer
// counts against anyone behind them, and Add Time/queue-epoch logic
// treats them the same as if they'd already left. Only an actual
// checkin/removal/no-show takes a party out of activeParties entirely.
function queuedParties(allParties: Party[]): Party[] {
  return allParties.filter(p => p.status === 'waiting')
}
```

In `getRawWaitMinutesForParty`, change the `ahead` line from filtering `active` to filtering `queuedParties(allParties)`:

```ts
  const ahead = queuedParties(allParties).filter(p => p.checked_in_at < party.checked_in_at)
```

`getQueueWaitMinutes`'s `calculateWaitMinutes(active, ...)` call should likewise sum over `queuedParties(allParties)`, not `active`, so a newly-joining party's estimate also excludes already-notified groups.

In `getPartyPosition`, change the filter from `p.status === 'waiting' || p.status === 'notified'` to `p.status === 'waiting'` only — a notified party no longer occupies a counted position, and whoever was #2 becomes #1 in the numbered list. (A notified party's own row still renders — just with a "Notified" badge instead of a number; that's a UI-layer decision in `QueueView.tsx`/`WaitlistBoard.tsx`, not a `getPartyPosition` concern.)

Add to `tests/wait-time.test.ts`: a case proving a `notified` party mid-queue no longer contributes to `calculateWaitMinutes`'s sum or to `getPartyPosition` for parties behind them, while still appearing in `activeParties`-based results (i.e. still returned by whatever reads `GET /api/parties`).

### Amendment to Task 6/7 — new route `src/app/api/parties/[id]/notify/route.ts`

Mirrors `ready/route.ts`'s shape closely, but is staff-triggered (called from `/checkin`, not from a guest's personal link) and sets `status: 'notified'` instead of `'playing'`. Position check uses the queue-only front (must actually be #1 among `waiting` parties, same `getPartyPosition` used everywhere else now that it's been amended above):

```ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartyPosition } from '@/lib/wait-time'
import { advanceQueueEpochIfFront } from '@/lib/queue-epoch-server'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()

  const { data: allParties, error } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const party = (allParties ?? []).find(p => p.id === params.id)
  if (!party) return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  if (party.status !== 'waiting') {
    return NextResponse.json({ error: 'Already notified or checked in' }, { status: 409 })
  }

  const position = getPartyPosition(party, allParties ?? [])
  if (position !== 1) {
    return NextResponse.json({ error: 'Not at the front of the queue' }, { status: 409 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('parties')
    .update({ status: 'notified' })
    .eq('id', params.id)
    .eq('status', 'waiting') // race guard, matches the pattern used elsewhere
    .select()
    .single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { data: settingsRows } = await supabase.from('settings').select('*')
  const settings = Object.fromEntries(
    (settingsRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
  )
  const fallback = parseFloat(settings.avg_min_per_hole ?? '4')
  const smallRate = parseFloat(settings.avg_min_per_hole_small ?? String(fallback))
  const largeRate = parseFloat(settings.avg_min_per_hole_large ?? String(fallback + 1))
  // activeBeforeChange for wasFrontOfQueue purposes should reflect the
  // pre-amendment "front of the WAITING queue" — the fetch above already
  // only contains waiting+notified, and party.status was 'waiting' at fetch
  // time, so passing allParties directly here is correct as long as
  // wasFrontOfQueue (queue-epoch.ts) is also amended to compare only
  // 'waiting' parties. Amend wasFrontOfQueue's sort input the same way:
  // filter to status === 'waiting' before sorting, in both this call site
  // and the ones in Task 7's route.ts, so "front" always means the same
  // thing everywhere.
  await advanceQueueEpochIfFront(supabase, party, (allParties ?? []).filter(p => p.status === 'waiting'), smallRate, largeRate)

  return NextResponse.json(updated)
}
```

Note the comment inline above: `wasFrontOfQueue` in `src/lib/queue-epoch.ts` (Task 4) must also be amended to only consider `status === 'waiting'` parties when determining "who was front" — otherwise a `notified` party sitting in the snapshot could wrongly be treated as blocking the real front. Update `wasFrontOfQueue`'s sort input to `activeBeforeChange.filter(p => p.status === 'waiting')` before sorting, and update every call site across Task 7's `route.ts`/`ready/route.ts` to pass a `waiting`-only snapshot consistently — this keeps one single definition of "front" used everywhere (Notify, Check In, Remove, self-Ready), which is exactly the kind of consistency the whole-repo grep rule in `SKILL.md` is there to protect.

**A party who is already `notified` reaching `/ready` (self-service at hole 1) or the staff `PATCH status: 'playing'` (Check In) both still work unmodified** — neither route's dequeue logic cares whether the party was previously `waiting` or `notified`, only that they're leaving `activeParties` now; `wasFrontOfQueue` will correctly return `false` for them in both cases (since a `notified` party is never in the `waiting`-only front-check by definition, having already been excluded when they were notified), so no double epoch-advance occurs. This is a natural consequence of the design, not a special case that needs its own code path — but add a test in `tests/queue-epoch-server.test.ts` asserting exactly this (notify a party, then check them in, assert the epoch only advanced once, at the notify step).

### Amendment to Task 8 — UI

`QueueView.tsx`: add a "🔔 Notify" button, shown only on the row where `i === 0` among parties whose `status === 'waiting'` (use the amended `getPartyPosition` to find it, don't hardcode array index 0 since a `notified` party could still be earlier in the raw `parties` array order). Calls `POST /api/parties/${id}/notify`. Rows with `status === 'notified'` render their existing amber "notified" pill (already there — `party.status === 'notified' ? 'bg-amber-100...' : ...`) but should skip the numeric queue-position digit on the left (replace with a bell icon or blank) since amended `getPartyPosition` no longer counts them.

`WaitlistBoard.tsx` / `TrackBoard.tsx`: a `notified` party's row should render some equivalent of "Come to the Caddyshack!" in place of a countdown number — check with Ben on exact wording before hardcoding copy, everything else about their rendering (name, position in the raw list) stays the same.

### New stress-test task (per Ben's explicit request — required before Phase 2 is considered done)

**Files:** create `tests/wait-time-invariants.property.test.ts`

- [ ] Write a randomized property test using `Math.random()` seeded scenarios (or `fast-check` if it's cheap to add as a devDependency — check `package.json` first and prefer it if available, otherwise hand-roll a seeded PRNG for reproducibility): generate 200+ random queues (random party count 1-15, random sizes, random `checked_in_at` gaps between 0-40 minutes, random small/large rates between 1-20), then simulate a random sequence of 5-20 events (check-in new party, notify front, check-in front, remove random party, advance real time by a random amount) against the real `wait-time.ts` + `queue-epoch.ts` functions (no Supabase — pure in-memory simulation of the epoch value). After every single event, assert: (1) no `waiting`/`notified` party's `getWaitMinutesForParty` result is ever negative for customer-facing values; (2) whenever a front-of-`waiting`-queue dequeue event just occurred, every other still-active party's computed wait changed by an amount within a small floating-point tolerance of exactly the dequeued party's own rate — never more, never less; (3) `getPartyPosition` never returns two different active parties the same nonzero position. Run: `npx vitest run tests/wait-time-invariants.property.test.ts` with a fixed seed printed on failure so any counterexample is reproducible. This test must pass before Task 9's live verification step.

---

## Phase 2 Addendum Revision 2 — fixes from adversarial review (before any Phase 2 code is written)

A second AI reviewer (independent, adversarial) read the full plan above and found five real problems in the Notify addendum specifically. All five must be fixed as part of Tasks 4-9 — do not build the addendum as originally written.

### Fix 1 (blocker): a notified party must still be able to self-checkin at hole 1

The amended `getPartyPosition` (Task 5 addendum) returns `0` for a `notified` party since it now only counts `waiting` parties. But `src/app/api/parties/[id]/ready/route.ts` gates on `position === 1`, and Task 2's `PersonalTrackBoard.tsx` gate is `wait <= 0 && position === 1` — so a notified guest's own phone would show "Position #0" and lose their ready button entirely, exactly backwards from the feature's purpose.

Fix both gates to also accept `status === 'notified'` directly, independent of the numeric position:
- `ready/route.ts`: change the position check to `if (party.status !== 'notified' && position !== 1) { return 409 }`.
- `PersonalTrackBoard.tsx`: change the ready-screen condition to `(wait <= 0 && position === 1) || self?.status === 'notified'`. Also feed `self?.status === 'notified'` into the `isReady` boolean passed to Phase 3's `useReadyAlert` — the chime should fire the moment a party is notified, not just when their own timer hits zero, since being notified IS "your turn" from the guest's perspective.

### Fix 2: crash when notifying the last waiting party

`wasFrontOfQueue` (Task 4, amended per the Notify addendum to sort only `waiting` parties) currently checks `activeBeforeChange.length === 0` BEFORE filtering. Reorder: filter to `status === 'waiting'` first, then check `.length === 0` on the filtered result, then sort. Add a test: notifying the only remaining `waiting` party when several `notified`/`playing` parties also exist in the snapshot must not throw.

### Fix 3: Notify needs an explicit, symmetric Undo — don't allow silent reversal through PATCH

Because notifying a party removes their rate from everyone's math and advances the epoch by that same amount, reverting `status` from `notified` back to `waiting` through the generic `PATCH /api/parties/[id]` route (which currently allows any `status` value in its `allowedFields`) would silently re-add their rate to everyone's wait WITHOUT rolling the epoch back — a permanent, wrong jump for exactly the population this whole project is trying to stop.

Two changes:
- In `PATCH /api/parties/[id]` (Task 7), reject `status: 'waiting'` as a target value when the row's current status is `notified` — return `400 { error: 'Use /api/parties/[id]/undo-notify to reverse a Notify' }`. Only that dedicated endpoint may transition `notified` back to `waiting`.
- Create `src/app/api/parties/[id]/undo-notify/route.ts`: symmetric to the notify route — verifies current status is `notified`, sets it back to `waiting`, and calls a new `revertQueueEpochForUndoNotify(supabase, party, smallRate, largeRate)` in `queue-epoch-server.ts` that does the exact inverse of `advanceQueueEpochIfFront`: reads current epoch, subtracts (not adds) `rate(party) * 60_000`, upserts. Add a "↩ Undo Notify" button in `QueueView.tsx`, shown only on rows with `status === 'notified'`. Add a test proving notify-then-undo-notify returns the epoch to exactly its original value and every other party's wait to exactly its pre-notify value.
- Out of scope for this pass (explicitly deferred, not silently dropped): automatic no-show timeout for a `notified` party who never actually checks in. Staff can already `DELETE`/Remove them manually if they clearly aren't coming — that's the accepted fallback for now. Set `notified_at: new Date().toISOString()` on the notify route's update (the field already exists on `Party` per `src/types/index.ts`) so this is available to build on later without another migration.

### Fix 4: cascade Notify/Check-In/Remove across split-party siblings

A party larger than `MAX_GROUP_SIZE` (6) auto-splits into multiple rows at insert time (`src/app/api/parties/route.ts`, groups labeled `"${first_name} 1"`, `"${first_name} 2"`, etc., same `last_initial`, checked in milliseconds apart). Today, notifying or checking in one sibling leaves the other(s) sitting in the normal queue as if they were an unrelated party — group 2 of the split would immediately become "the front of the queue" in its own right.

Add a shared helper `src/lib/party-siblings.ts`:

```ts
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
```

Wire this into the notify, check-in (`PATCH`), and remove (`DELETE`) routes: after successfully transitioning the primary party, look up its siblings via `findSiblings` among the still-`waiting`/`notified` set, and apply the identical transition to each of them too (each sibling still triggers its own correct `advanceQueueEpochIfFront` call if it was independently the front — in practice a sibling is essentially never separately "front" once cascading is in place, since they move together, but the check is cheap and correct to leave in rather than special-cased away). Add a test: a 8-person party split into two rows, notifying either row notifies both.

### Fix 5: make the epoch read-modify-write atomic

`advanceQueueEpochIfFront` and `revertQueueEpochForUndoNotify` (Fix 3) each do an unprotected read-then-upsert of `queue_epoch_at` — under real concurrent requests (two staff actions landing at once, or a staff action racing a guest's self-ready) this is a lost-update race, and a failed upsert currently fails silently (no error surfaced, no retry), which is exactly the "one source of truth silently drifted" failure mode `SKILL.md` documents happening three separate times already in this codebase's history.

Fix: replace the two-step select-then-upsert with a single atomic Postgres function, called via Supabase RPC instead of two round-trip queries. Add to a new migration file `supabase/migrations/<timestamp>_advance_queue_epoch_function.sql`:

```sql
create or replace function advance_queue_epoch(delta_minutes numeric)
returns timestamptz
language plpgsql
as $$
declare
  current_val timestamptz;
  new_val timestamptz;
begin
  select value::timestamptz into current_val from settings where key = 'queue_epoch_at';
  if current_val is null then
    current_val := now();
  end if;
  new_val := current_val + make_interval(mins => delta_minutes);
  insert into settings (key, value) values ('queue_epoch_at', new_val::text)
    on conflict (key) do update set value = excluded.value;
  return new_val;
end;
$$;
```

Update `advanceQueueEpochIfFront`/`revertQueueEpochForUndoNotify` to call `supabase.rpc('advance_queue_epoch', { delta_minutes: rateMinutes })` (positive for advance, negative for revert) instead of the manual select/upsert — this makes the whole read-modify-write a single atomic statement on Postgres's side, closing the race. If the RPC call errors, the route must return a 500 and NOT report success to the client — surface the failure instead of swallowing it, so staff know to retry rather than the board silently going wrong. Note in the migration file, per `SKILL.md`'s process, that this needs to actually be applied to the live Supabase project (no CLI access confirmed available — same constraint as the dormant `sms-dispatch` function; flag this explicitly to Ben rather than assuming it's been applied).

---

## Plan Self-Review Notes

- **Spec coverage:** Speed-up button (Task 1), ready-button position gate (Task 2), public-board last-checked-in display (Task 3), zero-jump queue math (Tasks 4-9), sound/vibration alert with iOS-safe unlock (Tasks 10-11) — all four conversation requirements covered.
- **Signature consistency check:** `getQueueWaitMinutes`, `getRawWaitMinutesForParty`, `getWaitMinutesForParty`, and `getEstimatedTeeTime` all gain `epochMs` as the parameter immediately before the existing optional `now` parameter, consistently, across every call site in Tasks 5, 7, and 8 — verified no call site left on the old signature.
- **Known accepted residual (documented, not a bug):** on a very slow day, `queue_epoch_at` can drift behind real wall-clock time if dequeues happen slower than their configured rate; `elapsedSinceEpoch`'s `Math.max(0, ...)` clamp (Task 5) prevents this from ever producing a negative "wait" for a brand-new checkin, and Add Time / Speed Up remain the manual correction tools for a rate that's drifted from reality — same as today.
