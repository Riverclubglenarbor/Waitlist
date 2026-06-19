# Personal Phone Buzzer — Design

## Why

SMS is paused for cost reasons ([[2026-06-18-sms-bypass-and-qr-tracking-design]]). Without texts, guests have no way to know when their tee time is close except watching the TV board at the caddyshack. Ben wants each checked-in party to get a personal, phone-based "buzzer" — like a restaurant pager, but a QR code and a web page instead of hardware — that shows their live position and turns from navy to green as they near the front, with a self-service "I'm Ready for the Course" action once they're first in line.

This is additive to, not a replacement for, the existing public board and its QR (`/waitlist` → `/track`, the full scrollable queue list) — that stays exactly as it is for anyone glancing at the physical board outside the caddyshack. This is a second, independent mechanism: a personal link generated per check-in.

## Part 1: Personal tracking page (`/track/[id]`)

### Route

New dynamic route, `src/app/track/[id]/page.tsx`, rendering a new component `src/components/track/PersonalTrackBoard.tsx`. `id` is the party's existing UUID primary key from the `parties` table — already unique and unguessable, no new identifier scheme needed. One row in `parties` = one page = one QR code, always, including for split groups (see Part 2).

### Data and polling

Same pattern as `WaitlistBoard`/`TrackBoard`: fetch `/api/parties` and `/api/settings`, poll every 3s, plus a Supabase realtime subscription on the `parties` table for faster updates. Find this party by `id` in the response; if not found (removed/expired), or its `status` is `no_show`/`removed`/`playing`, render a closing state instead of the live tracker:
- `playing` → "You're all set — enjoy your round! ⛳"
- `no_show` / `removed` / not found → "This link has expired. Check with the front desk."

### Position calculation (shared, not duplicated)

New helper in `src/lib/wait-time.ts`:

```typescript
export function getPartyPosition(party: Party, allParties: Party[]): number {
  const active = allParties
    .filter(p => p.status === 'waiting' || p.status === 'notified')
    .sort((a, b) => {
      const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
    })
  return active.findIndex(p => p.id === party.id) + 1 // 1-based; -1+1=0 if not found/active
}
```

The `id` tiebreaker guarantees a strict total order — no two parties can ever compute the same position, even if `checked_in_at` collides to the millisecond. This same function is used by both the tracking page (Part 1) and the ready-up endpoint (Part 3), so "what position does the phone show" and "what position does the server enforce" can never drift apart.

### Display and color gradient

Shows: party name, position (`getPartyPosition`), and estimated wait (existing `getWaitMinutesForParty`). Background color is computed by linearly blending navy `#1E3A5F` → green `#6DC04B` as position improves, clamped between position 8 (full navy) and position 1 (full green) — independent of total queue length, so "how close am I" feels consistent whether the queue is 4 deep or 20 deep. The blend transitions with CSS so it animates smoothly as position updates rather than jumping.

```typescript
function buzzerColor(position: number): string {
  const t = 1 - Math.min(Math.max(position - 1, 0), 7) / 7 // 0 at pos 8+, 1 at pos 1
  return blendHex('#1E3A5F', '#6DC04B', t)
}
```

(`blendHex` is a small new utility — linear interpolation per RGB channel.)

### Ready-up button

The button only ever appears at position 1 — at any other position the page shows the wait-time display from the previous section, nothing else. The instant a party's `getPartyPosition` reaches 1, the wait-time display is replaced with the headline **"Grab your putters, hole 1 is ready!"** (matching the voice of the existing `notification_sms_template` copy) and an **"I'm Ready for the Course"** button below it. First tap changes the button to "Tap again to confirm" (a lightweight guard against accidental taps, given the action is irreversible); second tap calls `POST /api/parties/[id]/ready` (Part 3). On success, the page transitions to the `playing` closing state.

## Part 2: Checkin flow — QR display after adding a party

### Current behavior

`CheckinWizard.tsx` shows a checkmark + "Par-Tee Added!" for 1.5s after a successful `POST /api/parties`, then auto-resets to the name step. Too fast to scan anything.

### New behavior

Replace the auto-dismissing confirmation with a QR screen that waits for explicit staff dismissal:

- `submitParty` already receives the full `inserted` array back from `POST /api/parties` (one row per split group, for parties of 7+). Store this array in component state instead of discarding it.
- Render one `QRCodeSVG` per row, each encoding `https://river-club-waitlist.vercel.app/track/{row.id}`. For a single-group party this is one QR; for a split party of e.g. 13 (split into groups of 6/6/1) it's three, laid out side by side, each labeled "Group 1 of 3" etc. using the row's `first_name` (which already carries the "Sarah 1" / "Sarah 2" split-group naming).
- A **"Done"** button replaces the timer-based reset — tapping it clears the wizard back to the name step for the next party. No auto-dismiss.

## Part 3: Self-service "Ready for the Course" endpoint

New route: `src/app/api/parties/[id]/ready/route.ts`.

```typescript
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerClient()

  const { data: allParties } = await supabase
    .from('parties')
    .select('*')
    .in('status', ['waiting', 'notified'])

  const party = (allParties ?? []).find(p => p.id === params.id)
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  }

  const position = getPartyPosition(party, allParties ?? [])
  if (position !== 1) {
    return NextResponse.json({ error: 'Not your turn yet' }, { status: 409 })
  }

  const { error } = await supabase
    .from('parties')
    .update({ status: 'playing' })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

This is the same `status: 'playing'` transition staff's existing "✓ Check In" button performs in `QueueView.tsx` — no new queue states, it plugs directly into logic that already exists. The position check is recomputed server-side from the database, not trusted from the client, so a customer can't jump the line by holding an old link or guessing another party's ID — the worst a stale/wrong link can do is get a 409 and nothing changes. A double-tap (or two browser tabs) is harmless: the second call either finds the party no longer in `waiting`/`notified` (404) or, if somehow still eligible, simply re-applies the same update — no duplicate side effects.

## Testing

- `getPartyPosition` / `buzzerColor`: pure functions, unit tested directly (no mocking needed) — same pattern as the existing `wait-time.test.ts`.
- `PersonalTrackBoard`: rendered with mocked `fetch`/`supabase-browser` (same pattern as `TrackBoard`'s and `QueueView`'s tests this session) — verify position/color/button-at-position-1 against fixture data.
- `/api/parties/[id]/ready`: no existing precedent for testing Next.js route handlers in this repo (verified earlier this session — only pure functions and client components have test coverage). Verify manually via `curl` against local dev, same as the other route changes this session: confirm position-1 party succeeds, confirm a position-2 party gets 409, confirm a second call after success gets 404.
- `CheckinWizard` QR screen: extend the existing `checkin-wizard.test.tsx` — assert the QR screen renders one `QRCodeSVG`-equivalent element per row in a multi-group response, and that it only resets to the name step after "Done" is clicked (not automatically).

## Out of scope

- The public board QR and the generic `/track` full-queue page — untouched, stay exactly as they are.
- Printing the QR (e.g., a receipt printer) — phone screen only, customer scans the iPad display.
- Any change to the staff-side "✓ Check In" button or its meaning — "Ready for the Course" is a new, separate customer-facing action that happens to perform the same status transition.
