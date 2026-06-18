# SMS Bypass + QR Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop collecting phone numbers / sending SMS by default (toggleable later via a settings flag), without deleting any Twilio code, and add a QR code on the live board linking to a new mobile-friendly queue-tracking page.

**Architecture:** A new `sms_enabled` boolean setting (stored in the existing `settings` key-value table, default `"false"`) gates whether the checkin wizard asks for a phone number. All SMS-sending call sites (welcome SMS, pre-tee notification, no-show follow-up, resend) become conditional on the party actually having a phone, rather than being deleted. The `parties.phone` column becomes nullable. A new `/track` page mirrors the existing `/api/parties` queue data in a phone-sized layout, linked to via a QR code rendered on the active waitlist board.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Supabase (Postgres + Deno edge functions), Vitest + Testing Library, Tailwind CSS, `qrcode.react` (new dependency).

---

## Part 1: SMS bypass

### Task 1: Make `Party.phone` nullable in types

**Files:**
- Modify: `src/types/index.ts:8`

- [ ] **Step 1: Change the type**

In `src/types/index.ts`, change:

```typescript
  phone: string
```

to:

```typescript
  phone: string | null
```

- [ ] **Step 2: Run the type checker to see what it surfaces**

Run: `npx tsc --noEmit`
Expected: One or more errors where `party.phone` is passed somewhere requiring a non-null `string` (e.g. `sendSms(party.phone, ...)` in the resend route). These errors are expected — later tasks fix each one. Note the file/line numbers reported; you'll touch them in Tasks 4 and 5.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Allow Party.phone to be null"
```

---

### Task 2: Database migration — make `phone` nullable

**Files:**
- Create: `supabase/migrations/003_phone_optional.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table parties alter column phone drop not null;
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/003_phone_optional.sql
git commit -m "Add migration to make parties.phone nullable"
```

- [ ] **Step 3: Apply it to the database (manual — confirm with Ben first)**

This repo's local dev environment points at the same Supabase project as production (no separate dev DB), so this migration must be applied carefully. Two ways to apply it:

- Supabase CLI: `npx supabase db push` (requires the project to be linked — check `npx supabase status` first)
- Or paste the SQL directly into the Supabase dashboard's SQL Editor for this project and run it once

**Do not apply this automatically — confirm with Ben which method he wants, then run it, then verify with:**

```sql
select column_name, is_nullable from information_schema.columns where table_name = 'parties' and column_name = 'phone';
```

Expected: `is_nullable` = `YES`.

---

### Task 3: `POST /api/parties` — phone becomes optional

**Files:**
- Modify: `src/app/api/parties/route.ts:27-31`, `:65-98`

- [ ] **Step 1: Drop phone from the required-fields check**

In `src/app/api/parties/route.ts`, change:

```typescript
  const { first_name, last_initial, party_size, phone, notes } = body

  if (!first_name || !last_initial || !party_size || !phone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
```

to:

```typescript
  const { first_name, last_initial, party_size, phone, notes } = body

  if (!first_name || !last_initial || !party_size) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
```

- [ ] **Step 2: Insert phone as nullable and only attempt SMS when present**

Change the insert (around line 70-77) — `phone` is already passed through as-is, so no change needed there since `phone` will simply be `undefined`/`null` when omitted from the request body and Supabase will store that as `null` once Task 2's migration is applied.

Change the welcome-SMS block:

```typescript
  // Send one welcome SMS (mention split if multiple groups)
  try {
    let welcomeMsg: string
    if (groups.length > 1) {
      welcomeMsg = `Welcome to River Club! 🏌️ Your party of ${totalSize} has been split into ${groups.length} groups (max 6 per tee time). Est. wait: ~${waitMinutes} min. We'll text you when it's time!`
    } else {
      welcomeMsg = interpolate(settings.welcome_sms_template, {
        name: first_name,
        wait: waitMinutes,
      })
    }
    await sendSms(phone, welcomeMsg)
  } catch (smsError) {
    console.error('Welcome SMS failed:', smsError)
  }
```

to:

```typescript
  // Send one welcome SMS (mention split if multiple groups) — only if a phone was provided
  if (phone) {
    try {
      let welcomeMsg: string
      if (groups.length > 1) {
        welcomeMsg = `Welcome to River Club! 🏌️ Your party of ${totalSize} has been split into ${groups.length} groups (max 6 per tee time). Est. wait: ~${waitMinutes} min. We'll text you when it's time!`
      } else {
        welcomeMsg = interpolate(settings.welcome_sms_template, {
          name: first_name,
          wait: waitMinutes,
        })
      }
      await sendSms(phone, welcomeMsg)
    } catch (smsError) {
      console.error('Welcome SMS failed:', smsError)
    }
  }
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/parties -H "Content-Type: application/json" \
  -d '{"first_name":"TestNoPhone","last_initial":"Q","party_size":2}' | head -c 500
```

Expected: `201` response with the inserted party, `"phone":null`, no error. Then clean up the test row from the `parties` table via the Supabase dashboard or `/admin` if needed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/parties/route.ts
git commit -m "Make phone optional when adding a party to the queue"
```

---

### Task 4: Resend route — guard against missing phone

**Files:**
- Modify: `src/app/api/parties/[id]/resend/route.ts`

- [ ] **Step 1: Add the guard**

In `src/app/api/parties/[id]/resend/route.ts`, after the existing party-not-found check, add a phone check before building/sending the SMS:

```typescript
  if (partyError || !party) {
    return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  }

  if (!party.phone) {
    return NextResponse.json({ error: 'Party has no phone on file' }, { status: 400 })
  }
```

- [ ] **Step 2: Run the type checker — this should resolve one of the errors from Task 1**

Run: `npx tsc --noEmit`
Expected: The error previously reported at this file's `sendSms(party.phone, body)` call is now gone, since `party.phone` is narrowed to `string` after the guard.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/parties/[id]/resend/route.ts
git commit -m "Return 400 from resend endpoint when party has no phone"
```

---

### Task 5: `sms-dispatch` edge function — decouple status transitions from SMS success

**Files:**
- Modify: `supabase/functions/sms-dispatch/index.ts:111-151`

This fixes a real bug: today, if `sendSms` throws (which it always will for a party with no phone), the `catch` block swallows the error and the status update on the lines right after it never runs — so a phoneless party gets permanently stuck in `waiting`, inflating everyone's wait time behind them forever. The fix: decide the status transition first, apply it unconditionally, then attempt the SMS only if a phone exists.

- [ ] **Step 1: Replace the dispatch loop**

Replace:

```typescript
  for (const party of parties) {
    const estimatedTeeTime = getEstimatedTeeTime(party, parties, smallRate, largeRate)
    const minutesUntilTee = (estimatedTeeTime.getTime() - now.getTime()) / 60_000

    if (party.status === 'waiting' && minutesUntilTee <= leadMinutes) {
      try {
        const msg = interpolate(settings.notification_sms_template, {
          name: party.first_name,
          wait: Math.max(0, Math.round(minutesUntilTee)),
        })
        await sendSms(party.phone, msg)
        await supabase
          .from('parties')
          .update({ status: 'notified', notified_at: now.toISOString() })
          .eq('id', party.id)
        results.push(`notified:${party.id}`)
      } catch (err) {
        console.error(`Pre-notify SMS failed for ${party.id}:`, err)
      }
    }

    if (party.status === 'notified' && party.notified_at) {
      const minutesSinceNotify =
        (now.getTime() - new Date(party.notified_at).getTime()) / 60_000
      if (minutesSinceNotify >= noShowMinutes && !party.followup_sent_at) {
        try {
          const msg = interpolate(settings.followup_sms_template, {
            name: party.first_name,
          })
          await sendSms(party.phone, msg)
          await supabase
            .from('parties')
            .update({ status: 'no_show', followup_sent_at: now.toISOString() })
            .eq('id', party.id)
          results.push(`no_show:${party.id}`)
        } catch (err) {
          console.error(`Follow-up SMS failed for ${party.id}:`, err)
        }
      }
    }
  }
```

with:

```typescript
  for (const party of parties) {
    const estimatedTeeTime = getEstimatedTeeTime(party, parties, smallRate, largeRate)
    const minutesUntilTee = (estimatedTeeTime.getTime() - now.getTime()) / 60_000

    if (party.status === 'waiting' && minutesUntilTee <= leadMinutes) {
      if (party.phone) {
        try {
          const msg = interpolate(settings.notification_sms_template, {
            name: party.first_name,
            wait: Math.max(0, Math.round(minutesUntilTee)),
          })
          await sendSms(party.phone, msg)
        } catch (err) {
          console.error(`Pre-notify SMS failed for ${party.id}:`, err)
        }
      }
      await supabase
        .from('parties')
        .update({ status: 'notified', notified_at: now.toISOString() })
        .eq('id', party.id)
      results.push(`notified:${party.id}`)
    }

    if (party.status === 'notified' && party.notified_at) {
      const minutesSinceNotify =
        (now.getTime() - new Date(party.notified_at).getTime()) / 60_000
      if (minutesSinceNotify >= noShowMinutes && !party.followup_sent_at) {
        if (party.phone) {
          try {
            const msg = interpolate(settings.followup_sms_template, {
              name: party.first_name,
            })
            await sendSms(party.phone, msg)
          } catch (err) {
            console.error(`Follow-up SMS failed for ${party.id}:`, err)
          }
        }
        await supabase
          .from('parties')
          .update({ status: 'no_show', followup_sent_at: now.toISOString() })
          .eq('id', party.id)
        results.push(`no_show:${party.id}`)
      }
    }
  }
```

- [ ] **Step 2: Update the `Party` interface in this file to match**

This file has its own local `Party` interface (it's a separate Deno project, not sharing `src/types`). Change:

```typescript
interface Party {
  id: string
  first_name: string
  phone: string
  party_size: number
  checked_in_at: string
  notified_at?: string
  followup_sent_at?: string
  status: PartyStatus
}
```

to:

```typescript
interface Party {
  id: string
  first_name: string
  phone: string | null
  party_size: number
  checked_in_at: string
  notified_at?: string
  followup_sent_at?: string
  status: PartyStatus
}
```

- [ ] **Step 3: Verify manually (no automated test — this is a separate Deno runtime outside the Vitest/tsconfig setup, same as the rest of this file)**

If the Supabase CLI is linked and Docker is available:

```bash
npx supabase functions serve sms-dispatch
```

In another terminal, insert a test party directly via the Supabase dashboard with `status='waiting'`, `phone=null`, `checked_in_at` set far enough in the past that `minutesUntilTee <= leadMinutes`, then invoke:

```bash
curl -s -X POST http://localhost:54321/functions/v1/sms-dispatch -H "Authorization: Bearer <local-anon-key>"
```

Expected: response includes `"notified:<that-party-id>"` and the row's `status` becomes `notified` in the dashboard, with no thrown error despite `phone` being null. Delete the test row afterward.

If Docker/local Supabase functions aren't set up, skip the live invocation and instead just re-read the diff carefully to confirm the status-update calls are no longer nested inside the `try` blocks — that structural change is the entire fix.

- [ ] **Step 4: Deploy the updated edge function (manual — confirm with Ben first)**

```bash
npx supabase functions deploy sms-dispatch
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sms-dispatch/index.ts
git commit -m "Decouple queue status transitions from SMS send success"
```

---

### Task 6: `CheckinWizard` — skip the phone step when SMS is disabled

**Files:**
- Modify: `src/components/checkin/CheckinWizard.tsx`
- Test: `tests/checkin-wizard.test.tsx`

- [ ] **Step 1: Update the two existing tests that exercise the phone step to explicitly enable SMS**

These two tests currently assume the phone step always shows. Once the wizard defaults to skipping it, they'll fail unless the mocked settings response says `sms_enabled` is on. In `tests/checkin-wizard.test.tsx`, replace the blanket `beforeEach` mock:

```typescript
beforeEach(() => {
  vi.resetAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({}),
    ok: true,
  })
})
```

with a URL-aware mock that defaults `sms_enabled` to `'true'` (each test can override per-call by reassigning `global.fetch` again, as the "bypass" tests in Step 3 will do):

```typescript
function mockFetch(settingsOverride: Record<string, string> = { sms_enabled: 'true' }) {
  global.fetch = vi.fn((url: string) => {
    if (url.toString().includes('/api/settings')) {
      return Promise.resolve({ json: async () => settingsOverride, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.resetAllMocks()
  mockFetch()
})
```

- [ ] **Step 2: Run the existing tests to confirm they still pass with no wizard changes yet**

Run: `npx vitest run tests/checkin-wizard.test.tsx`
Expected: All existing tests still PASS (the wizard hasn't changed yet — only the mock did, and it defaults to SMS enabled, preserving today's behavior).

- [ ] **Step 3: Write the new failing tests for the bypass path**

Add to `tests/checkin-wizard.test.tsx`:

```typescript
describe('CheckinWizard with SMS disabled', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetch({ sms_enabled: 'false' })
  })

  it('skips the phone step and submits directly after selecting a party size', async () => {
    const onSuccess = vi.fn()
    render(<CheckinWizard onSuccess={onSuccess} />)
    // Name step
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Initial step
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    // Size step
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    // Should skip straight to confirmation — no phone step
    await waitFor(() => {
      expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()
    })
    expect(screen.queryByText('Phone Number for Texts?')).not.toBeInTheDocument()
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('posts without a phone field when SMS is disabled', async () => {
    render(<CheckinWizard onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText(/Last Initial/))
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    await waitFor(() => screen.getByText('Party Size?'))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => screen.getByText('Par-Tee Added!'))

    const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0].toString().includes('/api/parties') && call[1]?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1].body)
    expect(body.phone).toBeUndefined()
    expect(body.first_name).toBe('Alex')
  })
})
```

- [ ] **Step 4: Run the new tests to confirm they fail**

Run: `npx vitest run tests/checkin-wizard.test.tsx`
Expected: FAIL — the wizard still always shows the phone step today, so `Phone Number for Texts?` will be found instead of `Par-Tee Added!`.

- [ ] **Step 5: Implement the bypass in `CheckinWizard.tsx`**

Replace the full file:

```typescript
'use client'
import { useState, useEffect } from 'react'
import NameStep from './NameStep'
import InitialStep from './InitialStep'
import PartySizeStep from './PartySizeStep'
import PhoneStep from './PhoneStep'

type Step = 'name' | 'initial' | 'size' | 'phone'

interface WizardState {
  firstName: string
  lastInitial: string
  partySize: number
}

interface CheckinWizardProps {
  onSuccess: () => void
}

export default function CheckinWizard({ onSuccess }: CheckinWizardProps) {
  const [step, setStep] = useState<Step>('name')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [state, setState] = useState<WizardState>({
    firstName: '',
    lastInitial: '',
    partySize: 1,
  })

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(settings => setSmsEnabled(settings.sms_enabled === 'true'))
      .catch(() => {})
  }, [])

  async function submitParty(phone?: string) {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: state.firstName,
          last_initial: state.lastInitial,
          party_size: state.partySize,
          ...(phone ? { phone } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErrorMsg(data.error ?? 'Failed to add party')
        return
      }
      setConfirmed(true)
      onSuccess()
      setTimeout(() => {
        setConfirmed(false)
        setStep('name')
        setState({ firstName: '', lastInitial: '', partySize: 1 })
      }, 1500)
    } catch {
      setErrorMsg('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  if (confirmed) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-rc-green text-6xl mb-4">✓</div>
          <div className="text-rc-navy text-2xl font-bold">Par-Tee Added!</div>
        </div>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="text-red-500 text-5xl">⚠️</div>
        <p className="text-rc-navy text-xl font-semibold text-center max-w-xs">{errorMsg}</p>
        <button
          onClick={() => { setErrorMsg(''); setStep('name'); setState({ firstName: '', lastInitial: '', partySize: 1 }) }}
          className="bg-rc-green text-white px-8 py-3 rounded-xl font-bold"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="h-full p-8">
      {step === 'name' && (
        <NameStep
          onNext={firstName => {
            setState(s => ({ ...s, firstName }))
            setStep('initial')
          }}
        />
      )}
      {step === 'initial' && (
        <InitialStep
          firstName={state.firstName}
          onNext={lastInitial => {
            setState(s => ({ ...s, lastInitial }))
            setStep('size')
          }}
          onBack={() => setStep('name')}
        />
      )}
      {step === 'size' && (
        <PartySizeStep
          onNext={partySize => {
            setState(s => ({ ...s, partySize }))
            if (smsEnabled) {
              setStep('phone')
            } else {
              submitParty()
            }
          }}
          onBack={() => setStep('initial')}
        />
      )}
      {step === 'phone' && (
        <PhoneStep
          onSubmit={phone => submitParty(phone)}
          onBack={() => setStep('size')}
          loading={loading}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run all checkin-wizard tests to confirm everything passes**

Run: `npx vitest run tests/checkin-wizard.test.tsx`
Expected: All tests PASS — both the original phone-step tests (now explicitly opted into `sms_enabled: 'true'`) and the two new bypass tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/checkin/CheckinWizard.tsx tests/checkin-wizard.test.tsx
git commit -m "Skip phone step in checkin wizard when SMS is disabled"
```

---

### Task 7: `QueueView` — disable Resend when a party has no phone

**Files:**
- Modify: `src/components/checkin/QueueView.tsx`
- Test: `tests/queue-view-resend.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/queue-view-resend.test.tsx`:

```typescript
import { render, screen, waitFor, within } from '@testing-library/react'
import QueueView from '@/components/checkin/QueueView'

vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

const parties = [
  {
    id: '1',
    first_name: 'Sarah',
    last_initial: 'D',
    party_size: 2,
    phone: '+12315550100',
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
  {
    id: '2',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 3,
    phone: null,
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  global.fetch = vi.fn((url: string) => {
    if (url.toString().includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
})

describe('QueueView resend button', () => {
  it('enables Resend for a party with a phone on file', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const row = screen.getByText('Sarah D.').closest('div.bg-white')!
    const resendButton = within(row).getByRole('button', { name: /resend/i })
    expect(resendButton).toBeEnabled()
  })

  it('disables Resend for a party with no phone on file', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    const row = screen.getByText('Mike T.').closest('div.bg-white')!
    const resendButton = within(row).getByRole('button', { name: /resend/i })
    expect(resendButton).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/queue-view-resend.test.tsx`
Expected: FAIL on the "disables Resend" assertion — today's Resend button has no disabled state tied to phone presence (it's only disabled while any action is loading).

- [ ] **Step 3: Implement the guard in `QueueView.tsx`**

Change the `resend` and `autoResend` functions:

```typescript
  async function resend(id: string) {
    setLoading({ id, type: 'resend' })
    const res = await fetch(`/api/parties/${id}/resend`, { method: 'POST' })
    setLoading(null)
    if (res.ok) showFlash(id, 'success', 'Text sent!')
    else showFlash(id, 'error', 'Failed to send')
  }

  async function autoResend(id: string) {
    if (autoResentRef.current.has(id)) return
    autoResentRef.current.add(id)
    await fetch(`/api/parties/${id}/resend`, { method: 'POST' })
    showFlash(id, 'success', 'Auto-text sent!')
  }
```

to:

```typescript
  async function resend(id: string) {
    setLoading({ id, type: 'resend' })
    const res = await fetch(`/api/parties/${id}/resend`, { method: 'POST' })
    setLoading(null)
    if (res.ok) showFlash(id, 'success', 'Text sent!')
    else showFlash(id, 'error', 'Failed to send')
  }

  async function autoResend(id: string, phone: string | null) {
    if (!phone) return
    if (autoResentRef.current.has(id)) return
    autoResentRef.current.add(id)
    await fetch(`/api/parties/${id}/resend`, { method: 'POST' })
    showFlash(id, 'success', 'Auto-text sent!')
  }
```

Then update the call site (around line 143) and the button (around line 207-215):

```typescript
        // Trigger auto-resend at -2 min
        if (isCritical) autoResend(party.id)
```

to:

```typescript
        // Trigger auto-resend at -2 min
        if (isCritical) autoResend(party.id, party.phone)
```

and:

```typescript
                <button
                  onClick={() => resend(party.id)}
                  disabled={!!loading}
                  className="border border-rc-navy text-rc-navy text-sm font-semibold
                             px-3 py-2 rounded-xl transition-all duration-150
                             hover:bg-rc-navy hover:text-white active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'resend' ? '…' : '↩ Resend'}
                </button>
```

to:

```typescript
                <button
                  onClick={() => resend(party.id)}
                  disabled={!!loading || !party.phone}
                  className="border border-rc-navy text-rc-navy text-sm font-semibold
                             px-3 py-2 rounded-xl transition-all duration-150
                             hover:bg-rc-navy hover:text-white active:scale-[0.97] disabled:opacity-40"
                >
                  {isLoading && loading?.type === 'resend' ? '…' : '↩ Resend'}
                </button>
```

- [ ] **Step 4: Run the type checker — this resolves another Task 1 error**

Run: `npx tsc --noEmit`
Expected: No errors remaining related to `party.phone`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/queue-view-resend.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `npm run test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/checkin/QueueView.tsx tests/queue-view-resend.test.tsx
git commit -m "Disable Resend button and auto-resend for parties with no phone on file"
```

---

### Task 8: `SettingsForm` — add the `sms_enabled` toggle

**Files:**
- Modify: `src/components/admin/SettingsForm.tsx`

- [ ] **Step 1: Add the label and a checkbox render branch**

Add to `FIELD_LABELS`:

```typescript
const FIELD_LABELS: Record<string, string> = {
  sms_enabled: 'Collect Phone Number & Send SMS',
  avg_min_per_hole_small: 'Min Per Hole — Small Group (1–4 players)',
  avg_min_per_hole_large: 'Min Per Hole — Large Group (5–6 players)',
  notification_lead_minutes: 'SMS Lead Time (min before tee)',
  no_show_timeout_minutes: 'No-Show Timeout (min after notify)',
  queue_close_time: 'Queue Close Time (HH:MM)',
  daily_reset_time: 'Daily Reset Time (HH:MM)',
  admin_pin: 'Admin PIN',
  welcome_sms_template: 'Welcome SMS',
  notification_sms_template: 'Pre-Tee SMS ("Come grab your putters")',
  followup_sms_template: 'No-Show Follow-Up SMS',
  ...Object.fromEntries(
    EMPTY_BOARD_SLIDES.map((s, i) => [
      s.key,
      `Empty Board — Message ${i + 1}${s.image ? ' (Gringo Loco promo)' : ''}`,
    ])
  ),
}
```

Add `sms_enabled` to `FIELD_DEFAULTS`:

```typescript
const FIELD_DEFAULTS: Record<string, string> = {
  sms_enabled: 'false',
  ...Object.fromEntries(
    EMPTY_BOARD_SLIDES.map(s => [s.key, s.defaultText])
  ),
}
```

Change the field-rendering branch from:

```typescript
          {key.includes('template') || key.includes('empty_board_message') ? (
            <textarea
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              rows={3}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green resize-none"
            />
          ) : (
            <input
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green"
            />
          )}
```

to:

```typescript
          {key === 'sms_enabled' ? (
            <input
              type="checkbox"
              checked={(settings[key] ?? FIELD_DEFAULTS[key]) === 'true'}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked ? 'true' : 'false' }))}
              className="w-6 h-6 accent-rc-green self-start"
            />
          ) : key.includes('template') || key.includes('empty_board_message') ? (
            <textarea
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              rows={3}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green resize-none"
            />
          ) : (
            <input
              value={settings[key] ?? FIELD_DEFAULTS[key] ?? ''}
              onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
              className="bg-white/10 text-white rounded-xl p-3 border border-white/20 outline-none focus:border-rc-green"
            />
          )}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/admin`, enter the PIN, confirm a checkbox labeled "Collect Phone Number & Send SMS" appears, unchecked by default. Check it, click Save, reload the page, confirm it's still checked. Uncheck it, Save, reload, confirm it's unchecked again.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/SettingsForm.tsx
git commit -m "Add SMS enabled toggle to admin settings"
```

---

## Part 2: QR code + mobile tracking page

### Task 9: Add the `qrcode.react` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
cd /Users/bencoughlin/river-club-waitlist && npm install qrcode.react
```

- [ ] **Step 2: Verify**

Run: `grep qrcode.react package.json`
Expected: A line under `"dependencies"` showing the installed version.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add qrcode.react dependency"
```

---

### Task 10: `/track` page — mobile-friendly queue view

**Files:**
- Create: `src/components/track/TrackBoard.tsx`
- Create: `src/app/track/page.tsx`
- Test: `tests/track-board.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/track-board.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import TrackBoard from '@/components/track/TrackBoard'

vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

const parties = [
  {
    id: '1',
    first_name: 'Sarah',
    last_initial: 'D',
    party_size: 2,
    phone: null,
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
  {
    id: '2',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 5,
    phone: null,
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  global.fetch = vi.fn((url: string) => {
    if (url.toString().includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    if (url.toString().includes('/api/settings')) {
      return Promise.resolve({
        json: async () => ({ avg_min_per_hole_small: '5', avg_min_per_hole_large: '7' }),
        ok: true,
      })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
})

describe('TrackBoard', () => {
  it('lists each party with their position and wait time', async () => {
    render(<TrackBoard />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.getByText('Mike T.')).toBeInTheDocument()
    // Sarah is first in line -> 0 min wait ahead of her
    expect(screen.getByText('Now!')).toBeInTheDocument()
    // Mike is behind Sarah's small-group rate of 5 min
    expect(screen.getByText('5m')).toBeInTheDocument()
  })

  it('shows an empty-queue message when there are no parties', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.toString().includes('/api/parties')) {
        return Promise.resolve({ json: async () => [], ok: true })
      }
      return Promise.resolve({ json: async () => ({}), ok: true })
    }) as unknown as typeof fetch
    render(<TrackBoard />)
    await waitFor(() => screen.getByText(/no wait/i))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/track-board.test.tsx`
Expected: FAIL with a module-not-found error for `@/components/track/TrackBoard` — it doesn't exist yet.

- [ ] **Step 3: Implement `TrackBoard.tsx`**

Create `src/components/track/TrackBoard.tsx`:

```typescript
'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getWaitMinutesForParty } from '@/lib/wait-time'
import type { Party } from '@/types'

function formatName(firstName: string, lastInitial: string): string {
  return `${firstName} ${lastInitial}.`
}

export default function TrackBoard() {
  const [parties, setParties] = useState<Party[]>([])
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)

  const fetchAll = useCallback(async () => {
    try {
      const [partiesRes, settingsRes] = await Promise.all([
        fetch('/api/parties'),
        fetch('/api/settings'),
      ])
      const partiesData = await partiesRes.json()
      const settingsData = await settingsRes.json()
      if (Array.isArray(partiesData)) setParties(partiesData)
      const fallback = parseFloat(settingsData.avg_min_per_hole ?? '4')
      setSmallRate(parseFloat(settingsData.avg_min_per_hole_small ?? String(fallback)))
      setLargeRate(parseFloat(settingsData.avg_min_per_hole_large ?? String(fallback + 1)))
    } catch (e) {
      console.error('fetchAll failed', e)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const supabase = createClient()
    const channel = supabase
      .channel('track-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchAll())
      .subscribe()
    const poll = setInterval(() => fetchAll(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchAll])

  return (
    <div className="min-h-screen bg-rc-navy flex flex-col items-center px-4 py-8">
      <h1 className="text-rc-green text-2xl font-black uppercase tracking-wide mb-6">River Club Queue</h1>

      {parties.length === 0 ? (
        <p className="text-white/70 text-lg text-center mt-12">No wait — the course is open!</p>
      ) : (
        <div className="w-full max-w-md flex flex-col gap-3">
          {parties.map((party, i) => {
            const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate))
            return (
              <div
                key={party.id}
                className={`flex items-center gap-3 rounded-xl px-4 py-3
                  ${i === 0 ? 'bg-rc-green/20 border border-rc-green' : 'bg-white/5'}`}
              >
                <span className={`text-xl font-black w-6 shrink-0 ${i === 0 ? 'text-rc-green' : 'text-white/40'}`}>
                  {i + 1}
                </span>
                <span className="flex-1 text-white font-bold truncate">
                  {formatName(party.first_name, party.last_initial)}
                </span>
                <span className="font-bold">
                  {wait === 0 ? (
                    <span className="text-rc-green">Now!</span>
                  ) : (
                    <span className="text-white/70">{wait}m</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/track-board.test.tsx`
Expected: PASS

- [ ] **Step 5: Create the page route**

Create `src/app/track/page.tsx`:

```typescript
import TrackBoard from '@/components/track/TrackBoard'

export const dynamic = 'force-dynamic'

export default function TrackPage() {
  return <TrackBoard />
}
```

- [ ] **Step 6: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/track` in a browser sized to a phone viewport (e.g. Chrome DevTools device toolbar). Confirm it renders readably without the giant TV typography.

- [ ] **Step 7: Commit**

```bash
git add src/components/track/TrackBoard.tsx src/app/track/page.tsx tests/track-board.test.tsx
git commit -m "Add mobile-friendly /track page for self-service queue tracking"
```

---

### Task 11: QR code on the active waitlist board

**Files:**
- Modify: `src/components/waitlist/WaitlistBoard.tsx`

- [ ] **Step 1: Add the QR code**

In `src/components/waitlist/WaitlistBoard.tsx`, add the import:

```typescript
import { QRCodeSVG } from 'qrcode.react'
```

Change the closing motto block from:

```typescript
      <p className="text-rc-green/60 text-[2.5rem] font-bold tracking-widest uppercase text-center shrink-0">
        putt · party · eat · repeat
      </p>
    </div>
  )
}
```

to:

```typescript
      <div className="w-full flex items-end justify-between shrink-0">
        <div className="w-[120px]" />
        <p className="text-rc-green/60 text-[2.5rem] font-bold tracking-widest uppercase text-center flex-1">
          putt · party · eat · repeat
        </p>
        <div className="w-[120px] flex flex-col items-center gap-1">
          <QRCodeSVG value="https://river-club-waitlist.vercel.app/track" size={96} bgColor="#1E3A5F" fgColor="#ffffff" />
          <span className="text-white/60 text-[0.65rem] uppercase tracking-wide text-center">Scan to track your spot</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify visually**

Start the dev server, mock 1-2 parties (the same temporary local-only state-seeding approach used earlier in this project for screenshotting — do not commit the mock), screenshot `/waitlist` at 1920x1080, and confirm:
- The QR code renders in the bottom-right corner, doesn't overlap the motto or queue list
- Scanning it (or manually visiting the encoded URL) lands on `/track` and shows the same queue

Revert any temporary mock-data changes before committing — only the `WaitlistBoard.tsx` QR addition should be committed.

- [ ] **Step 3: Commit**

```bash
git add src/components/waitlist/WaitlistBoard.tsx
git commit -m "Add QR code linking to /track on the active waitlist board"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npm run test
```
Expected: All tests pass.

- [ ] **Run the type checker**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Run the linter**

```bash
npm run lint
```
Expected: No errors.

- [ ] **Manual end-to-end check on `/checkin`**

With `sms_enabled` off (the default): add a party through the wizard, confirm no phone step appears, confirm it shows up in the queue view. Flip `sms_enabled` on in `/admin`, add another party, confirm the phone step appears again and the old flow still works.
