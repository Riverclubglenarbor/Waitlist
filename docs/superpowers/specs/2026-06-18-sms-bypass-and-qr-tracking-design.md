# SMS Bypass + QR Tracking — Design

## Why

Twilio's 10DLC campaign for the River Club number was never approved, and SMS costs money. Ben wants to stop collecting phone numbers and stop attempting to send texts for now, without deleting the SMS code — he plans to flip it back on later once it's worth paying for. Separately, since guests won't get a text when their tee time is close, he wants a way for them to self-check their position: a QR code on the public board that links to a mobile-friendly live queue view.

## Part 1: SMS bypass via settings toggle

### `sms_enabled` setting

A new boolean setting, stored as `"true"` / `"false"` text in the existing `settings` key-value table, defaulting to `"false"`. Surfaced in `/admin` (`SettingsForm.tsx`) as a checkbox rather than a text/textarea field — this requires a small render-type branch in the existing `FIELD_LABELS`-driven form (checkbox when key === `'sms_enabled'`, text/textarea otherwise, same pattern as the existing `template`/`empty_board_message` branch).

### Checkin wizard (`CheckinWizard.tsx`, `PhoneStep.tsx`, `PartySizeStep.tsx`)

`CheckinWizard` fetches `/api/settings` on mount (same pattern already used in `QueueView`/`WaitlistBoard`) and stores `smsEnabled: boolean`.

- When `smsEnabled` is `true`: unchanged — `PartySizeStep` → `PhoneStep` → submit.
- When `smsEnabled` is `false`: `PartySizeStep`'s `onNext` submits the party directly (no `'phone'` step), with `phone` omitted from the POST body.

`PhoneStep.tsx` itself is untouched — it's just not reached when the toggle is off, so re-enabling later is a one-line behavior flip, not a rebuild.

### Database

`parties.phone` is currently `text not null` (`supabase/migrations/001_initial.sql`). New migration `003_phone_optional.sql`:

```sql
alter table parties alter column phone drop not null;
```

This is a production schema change — confirm with Ben how he wants to apply it (Supabase CLI `supabase db push`, or pasting the SQL into the Supabase dashboard's SQL editor) before running it, since this repo's local dev currently points at the same Supabase project as production (no separate dev DB).

### `POST /api/parties` (`src/app/api/parties/route.ts`)

- Drop `phone` from the required-fields check (line 29) — only `first_name`, `last_initial`, `party_size` remain required.
- Insert `phone: phone ?? null`.
- Welcome SMS block (lines 84–98): only attempt `sendSms` when `phone` is truthy. Already wrapped in try/catch, so this is an `if (phone)` guard, not a rewrite.

### `sms-dispatch` edge function (`supabase/functions/sms-dispatch/index.ts`)

Current bug (pre-existing, surfaced by this change): status transitions (`waiting`→`notified`, `notified`→`no_show`) only happen *inside* the `try` block, after `sendSms` succeeds. If `sendSms` throws — which it always will for a party with no phone — the party never transitions and silently sits in `waiting` forever, permanently inflating the queue and the "Current Wait" calculation for everyone behind them.

Fix: decouple status transition from send success. For both the pre-tee notification and the no-show follow-up:
1. Compute whether the transition condition is met (lead time reached / no-show timeout reached) — unchanged logic.
2. Update status unconditionally once the condition is met.
3. Attempt `sendSms` only if `party.phone` is present; failures (missing phone, Twilio error) are caught and logged but never block the status update.

This means phoneless parties flow through the queue lifecycle exactly like phoned parties always have — they just don't get a text.

### Resend button (`QueueView.tsx`)

The "Resend" button is disabled (not hidden, to keep the row layout stable) when `party.phone` is falsy, instead of calling an endpoint guaranteed to fail. Auto-resend (`autoResend`, triggered at -2min) gets the same `if (!party.phone) return` guard.

### Types (`src/types/index.ts`)

`Party.phone: string` → `Party.phone: string | null`.

## Part 2: QR code + mobile tracking page

### `/track` page (new)

A new route, `src/app/track/page.tsx`, rendering a new component (e.g. `src/components/track/TrackBoard.tsx`) sized for a normal phone viewport — not the oversized TV typography used by `/waitlist`. Shows the same live queue: position, first name + last initial, party size, estimated wait — pulled from the existing public `GET /api/parties` (no new backend, no auth, matches what's already shown on the TV). Polls every 3s, same pattern as `QueueView`/`WaitlistBoard`. No per-party personalization (no individual links) since we no longer capture an identifier (phone) at checkin.

### QR code on the active board

`WaitlistBoard.tsx` renders a QR code (bottom corner, near the motto) linking to `https://river-club-waitlist.vercel.app/track`, with a small caption: "Scan to track your spot." Rendered client-side via the `qrcode.react` package (new dependency — small, no runtime network call to a third-party QR image service, so it keeps working offline-of-internet-services beyond Supabase itself).

Not shown on `EmptyBoard.tsx` — only appears once there's an actual queue to track, matching "the page where names pop up."

## Testing

- Checkin flow: with `sms_enabled` off, confirm a party can be added with no phone step and lands in the queue.
- `sms-dispatch`: confirm a phoneless party still transitions `waiting`→`notified`→`no_show` on schedule (can be tested by inserting a test row with `notified_at` backdated past the no-show timeout, phone null, and invoking the function locally).
- `/track`: confirm it renders the same parties/order/wait as `/waitlist` and `/checkin`'s queue view, at a phone viewport width.
- Resend button: confirm it's disabled for a phoneless party row.

## Out of scope

- Re-enabling SMS (the toggle and underlying code make this trivial later, but flipping it on is not part of this work).
- Per-party tracking links (would require capturing some identifier again).
- Removing Twilio/SMS code, templates, or admin UI for editing them.
