---
name: river-club-waitlist
description: River Club Glen Arbor's golf waitlist/buzzer system (Next.js 14 + Supabase + Twilio). Use this skill whenever working on ~/Projects/river-club-waitlist — the staff checkin dashboard, the customer personal tracking link, the lobby TV board, wait-time/pacing math, the Add Time control, or the SMS auto-notify cron. Read this before touching anything in src/lib/wait-time.ts or any of its four consumers — that math has drifted out of sync three separate times already.
---

# River Club Waitlist — Developer Skill

> Golf course waitlist app for River Club Glen Arbor. Guests check in at the front desk, get a personal tracking link (no login), and staff run the queue from a checkin dashboard. A lobby TV shows the live board. No staging environment — testing happens directly against the production Supabase project via the live app.

**Repo:** `~/Projects/river-club-waitlist`, github.com/Riverclubglenarbor/Waitlist
**Stack:** Next.js 14 (App Router), Supabase (Postgres + realtime + edge functions), Twilio (SMS, currently phased out), Tailwind, Vitest
**Deploy:** `git push origin main` (repo) + `vercel --prod --yes` (manual promote — not confirmed to auto-deploy from GitHub)
**Live:** https://river-club-waitlist.vercel.app
**Vercel project:** `river-club-waitlist` (prj_PXbmaoA9kGvnC2ZvBQVDUJ1R9OXI)
**Full stack/package details:** see `STACK.md` in this repo

---

## Critical rule: one wait-time formula, one source of truth

**`src/lib/wait-time.ts` is the only place the wait/queue-pacing math should ever live.** As of 2026-07-05, three separate hand-written copies of this logic existed across the codebase and had silently drifted apart, causing a real bug: staff saw "3m" for a party while that same guest's phone showed "~12 min" for the identical wait. Found via live Playwright testing against production, not by reading code.

The three places this has happened:
1. `WaitlistBoard.tsx` had its own inline per-row calc instead of importing the shared function — no good reason, pure oversight. Fixed.
2. `QueueView.tsx` (staff dashboard) had a completely different "absolute tee time anchored to first check-in" model that never got the 10-min floor. Fixed by sharing the same formula via a new `getRawWaitMinutesForParty` (unclamped, so staff-only overdue/critical states still work) alongside the existing clamped `getWaitMinutesForParty` (customer-facing).
3. `supabase/functions/sms-dispatch/index.ts` — a **Supabase Edge Function**, a separate Deno deployment that cannot `import` from `src/lib/wait-time.ts` across that runtime boundary. It had its own hand-copied formula, also missing the floor. Fixed the source (2026-07-05), **but it is not deployed** — see "Known gaps" below. Verified empirically that its cron isn't currently firing against production (a test party sat 13+ minutes without the auto-notify status flip that would happen under the old buggy math), so this was dormant, not live guest harm — but fix it before ever re-enabling SMS.

**If you touch the wait-time formula, grep for `calculateWaitMinutes`, `getWaitMinutesForParty`, `getRawWaitMinutesForParty`, and `getQueueWaitMinutes` across the whole repo (not just `src/`) before considering the change done** — the edge function copy won't show up in a `src/`-scoped search.

### The current model (as of 2026-07-05)

- The whole active queue shares **one 10-minute processing floor**, starting when the current front of the queue (oldest still-`waiting`/`notified` party) checked in.
- Every party's wait = `10 (base) + sum of per-hole rates for parties ahead of them - minutes elapsed since the queue's front checked in`, clamped to ≥0 for customer-facing views.
- This means a solo first-in-line party starts at exactly 10 min and counts down in real time; a second party (small group ahead) starts at 15; behind a large group, 17. All parties in the queue decay together, off the same shared clock — not independent per-party floors.
- Fully stateless/recomputed fresh on every poll (3s interval in every consuming component) from whichever parties are currently active — so early check-ins (removing someone from the active list) automatically and correctly pull everyone behind them forward, symmetric to how Add Time pushes them back. No special-case code needed for that; it's an emergent property of recomputing from current state every time.
- **Add Time** (`POST /api/settings/add-time`, red button top of `/checkin`) bumps `avg_min_per_hole_small`/`avg_min_per_hole_large` by +5 each click — flat per group, not scaled by party size, matching the existing small/large rate model. This compounds with queue depth (someone with 2 groups ahead gets +10, not +5). **It deliberately does NOT touch the 10-min floor** — the first-in-line party always starts at a flat 10, regardless of how many times Add Time has been hit. This was a deliberate design correction on 2026-07-05 after initially wiring Add Time into the floor too; don't re-couple them without explicit instruction.
- `getWaitMinutesForParty` (clamped ≥0) is for anything a guest sees. `getRawWaitMinutesForParty` (can go negative) is for staff views that need to know *how* overdue someone is, e.g. `QueueView.tsx`'s critical/red state at -2 min (which also triggers an auto-resend SMS).

---

## Known gaps / pending work

- **`sms-dispatch` edge function fix is committed but not deployed.** No Supabase CLI is set up locally for this project (`which supabase` → not found, no `supabase/.temp/project-ref`), and the `claude.ai Supabase` MCP connector only has access to Ben's own Baynes org projects (`dreggwinegtirxxanntv`, `qwtbgusqfoypvehnungr`) — this is a different client's Supabase project entirely, not reachable that way. To deploy: `supabase functions deploy sms-dispatch` after linking the project, or grant Claude Supabase CLI credentials for this specific project.
- SMS/phone collection is currently off in the live checkin flow (`CheckinWizard` doesn't ask for a phone number) — the whole notify/no-show cron path is effectively dormant. Confirm this is still true before assuming SMS behavior either way; it's a settings/product decision, not a code constant.

---

## Routes

| Route | Purpose |
|---|---|
| `/checkin` | Staff dashboard — `QueueView` (live queue + actions) + `CheckinWizard` (add a party) + "Add Time" button |
| `/track/[id]` | Guest's personal tracking link (no login) — `PersonalTrackBoard` |
| `/track` | Simple TV queue list — `TrackBoard` |
| `/waitlist` | Main lobby TV board — `WaitlistBoard` (falls back to `EmptyBoard` when queue is empty, which shows a static "0 min" welcome screen) |
| `/admin` | PIN-gated settings + analytics (`SettingsForm`, `AnalyticsDashboard`) |

## Key files

```
src/lib/wait-time.ts          — THE shared formula (see above). Read before touching.
src/lib/supabase-server.ts    — shared server-side Supabase client. MUST keep the
                                 `cache: 'no-store'` override (see gotcha below).
src/components/checkin/QueueView.tsx        — staff dashboard queue list + actions
src/components/checkin/CheckinWizard.tsx    — add-party flow (name → initial → size → paid)
src/components/track/PersonalTrackBoard.tsx — guest's own link; position 1 + wait<=0 → "ready" screen
src/components/track/TrackBoard.tsx         — simple TV list
src/components/waitlist/WaitlistBoard.tsx   — main lobby TV board
src/components/waitlist/EmptyBoard.tsx      — shown when queue is empty (hardcoded 0 min)
src/app/api/settings/add-time/route.ts      — Add Time endpoint (+5 to both per-hole rates)
supabase/functions/sms-dispatch/index.ts    — cron (pg_cron, every minute) — auto-notify/no-show.
                                                Separate Deno deployment, hand-synced copy of the
                                                wait formula (see Known gaps).
```

## Gotcha: Next.js on Vercel silently caches server-side Supabase reads

`src/lib/supabase-server.ts`'s `createServerClient()` passes a custom `fetch` that forces `cache: 'no-store'`. This is load-bearing — without it, Next.js's patched global `fetch` caches the Supabase client's requests even inside `export const dynamic = 'force-dynamic'` route handlers. The symptom (found 2026-07-05): a `POST` to `/api/settings/add-time` would correctly write and return the new value, but the very next `GET /api/settings` kept returning the old value — writes succeeded, reads didn't see them. Confirmed via a raw REST query with the service-role key bypassing the app entirely (showed fresh data) vs. the same query through the app's route handler (showed stale data). If this bug ever reappears, check this override hasn't been removed before chasing anything more exotic.

## Testing notes

- No staging environment — Vitest unit/component tests run locally against mocked fetch, but end-to-end verification happens directly against the live production app and its real Supabase project. When doing that: use clearly-named test parties (e.g. `ZTest1`), verify via the real UI/Playwright, and remove/check-in the test parties before finishing so production is left clean. Don't mutate live settings (rates, Add Time) without explicit go-ahead each time — that's genuinely shared production data, not local test fixtures.
- Time-dependent tests must pass an explicit `now` and use fixed `checked_in_at` offsets in whole minutes (not seconds) — fractional-minute offsets produce non-integer expected values that are flaky against real wall-clock drift during test execution. See `tests/wait-time.test.ts` for the pattern.
