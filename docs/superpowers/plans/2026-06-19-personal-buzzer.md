# Personal Phone Buzzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each checked-in party a personal, phone-based "buzzer" — a QR code shown on the iPad after checkin that links to a page showing their live queue position, a navy→green color gradient as they approach the front, and a self-service "I'm Ready for the Course" button at position 1 that removes them from the active queue.

**Architecture:** Two new pure-function helpers (`getPartyPosition`, `buzzerColor`) are shared between a new personal tracking page (`/track/[id]`) and a new self-service API endpoint (`/api/parties/[id]/ready`) that independently re-validates position server-side before honoring the request. `CheckinWizard` is changed to show QR code(s) — one per split group — on an explicit "Done"-dismissed confirmation screen instead of an auto-resetting one.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Supabase, `qrcode.react` (already a dependency), Vitest + Testing Library.

---

### Task 1: `getPartyPosition` helper

**Files:**
- Modify: `src/lib/wait-time.ts`
- Test: `tests/wait-time.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/wait-time.test.ts` (after the existing `getQueueWaitMinutes` describe block):

```typescript
import { getPartyPosition } from '@/lib/wait-time'

describe('getPartyPosition', () => {
  it('returns 1 for the only active party', () => {
    const party = makeParty({ id: 'a', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(party, [party])).toBe(1)
  })

  it('orders by checked_in_at ascending', () => {
    const first = makeParty({ id: 'a', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const second = makeParty({ id: 'b', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(first, [first, second])).toBe(1)
    expect(getPartyPosition(second, [first, second])).toBe(2)
  })

  it('breaks ties in checked_in_at using id so positions never collide', () => {
    const sameTime = new Date().toISOString()
    const a = makeParty({ id: 'aaa', checked_in_at: sameTime })
    const b = makeParty({ id: 'bbb', checked_in_at: sameTime })
    expect(getPartyPosition(a, [b, a])).toBe(1) // 'aaa' sorts before 'bbb'
    expect(getPartyPosition(b, [b, a])).toBe(2)
  })

  it('ignores parties that are not waiting or notified', () => {
    const playing = makeParty({ id: 'a', status: 'playing', checked_in_at: new Date(Date.now() - 2000).toISOString() })
    const waiting = makeParty({ id: 'b', status: 'waiting', checked_in_at: new Date(Date.now() - 1000).toISOString() })
    expect(getPartyPosition(waiting, [playing, waiting])).toBe(1)
  })
})
```

Note: this file already has `import { calculateWaitMinutes, getQueueWaitMinutes } from '@/lib/wait-time'` at the top — add `getPartyPosition` to that same import line instead of a second import line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wait-time.test.ts`
Expected: FAIL — `getPartyPosition` is not exported yet.

- [ ] **Step 3: Implement `getPartyPosition`**

Add to `src/lib/wait-time.ts` (after `getWaitMinutesForParty`):

```typescript
export function getPartyPosition(party: Party, allParties: Party[]): number {
  const active = allParties
    .filter(p => p.status === 'waiting' || p.status === 'notified')
    .sort((a, b) => {
      const byTime = a.checked_in_at.localeCompare(b.checked_in_at)
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
    })
  return active.findIndex(p => p.id === party.id) + 1
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/wait-time.test.ts`
Expected: PASS, all `getPartyPosition` tests plus the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/bencoughlin/river-club-waitlist
git add src/lib/wait-time.ts tests/wait-time.test.ts
git commit -m "Add getPartyPosition helper with stable tie-breaking"
```

---

### Task 2: `buzzerColor` gradient helper

**Files:**
- Create: `src/lib/buzzer-color.ts`
- Test: `tests/buzzer-color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/buzzer-color.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buzzerColor } from '@/lib/buzzer-color'

describe('buzzerColor', () => {
  it('is full green at position 1', () => {
    expect(buzzerColor(1)).toBe('#6dc04b')
  })

  it('is full navy at position 8', () => {
    expect(buzzerColor(8)).toBe('#1e3a5f')
  })

  it('stays full navy beyond position 8', () => {
    expect(buzzerColor(12)).toBe('#1e3a5f')
  })

  it('blends proportionally at a midpoint position', () => {
    expect(buzzerColor(4)).toBe('#4b8754')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/buzzer-color.test.ts`
Expected: FAIL with a module-not-found error for `@/lib/buzzer-color`.

- [ ] **Step 3: Implement `buzzerColor`**

Create `src/lib/buzzer-color.ts`:

```typescript
const NAVY = '#1E3A5F'
const GREEN = '#6DC04B'
const GRADIENT_START_POSITION = 8 // position at/beyond which the color is full navy

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHexChannel(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0')
}

export function blendHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const r = a.r + (b.r - a.r) * t
  const g = a.g + (b.g - a.g) * t
  const blue = a.b + (b.b - a.b) * t
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(blue)}`
}

export function buzzerColor(position: number): string {
  const clamped = Math.min(Math.max(position, 1), GRADIENT_START_POSITION)
  const t = 1 - (clamped - 1) / (GRADIENT_START_POSITION - 1)
  return blendHex(NAVY, GREEN, t)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/buzzer-color.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/buzzer-color.ts tests/buzzer-color.test.ts
git commit -m "Add buzzerColor navy-to-green gradient helper"
```

---

### Task 3: Self-service "Ready for the Course" endpoint

**Files:**
- Create: `src/app/api/parties/[id]/ready/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/parties/[id]/ready/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { getPartyPosition } from '@/lib/wait-time'

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
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already processed' }, { status: 404 })
  }

  const position = getPartyPosition(party, allParties ?? [])
  if (position !== 1) {
    return NextResponse.json({ error: 'Not your turn yet' }, { status: 409 })
  }

  const { error: updateError } = await supabase
    .from('parties')
    .update({ status: 'playing' })
    .eq('id', params.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verify the type checker is clean**

Run: `npx tsc --noEmit 2>&1 | grep -v "^tests/"`
Expected: no output (the `tests/` filter excludes pre-existing, unrelated vitest-globals noise — see note in Task 5's verification step).

- [ ] **Step 3: Verify manually against local dev**

There's no existing precedent in this repo for testing Next.js route handlers directly (only pure functions and client components have test coverage) — verify with `curl` instead, same pattern used for the resend route earlier this project.

```bash
npm run dev
```

In another terminal, find an active party's id (or add one via the `/checkin` UI), then:

```bash
# Replace <id> with a party NOT in position 1 — expect 409
curl -s -X POST http://localhost:3000/api/parties/<id>/ready
# Expected: {"error":"Not your turn yet"}

# Replace <id> with the party actually in position 1 — expect success
curl -s -X POST http://localhost:3000/api/parties/<id>/ready
# Expected: {"ok":true}

# Calling it again on the same id — expect 404 (no longer waiting/notified)
curl -s -X POST http://localhost:3000/api/parties/<id>/ready
# Expected: {"error":"Party not found or already processed"}
```

If you don't want to mutate real queue data, add a throwaway test party via `/checkin`, run the three checks above, then remove it from the queue via the QueueView "Remove" button.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/parties/[id]/ready/route.ts"
git commit -m "Add self-service ready-up endpoint with server-side position check"
```

---

### Task 4: Personal tracking page (`/track/[id]`)

**Files:**
- Create: `src/components/track/PersonalTrackBoard.tsx`
- Create: `src/app/track/[id]/page.tsx`
- Test: `tests/personal-track-board.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/personal-track-board.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import PersonalTrackBoard from '@/components/track/PersonalTrackBoard'

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
    id: 'first',
    first_name: 'Sarah',
    last_initial: 'D',
    party_size: 2,
    phone: null,
    checked_in_at: new Date(Date.now() - 2000).toISOString(),
    status: 'waiting',
  },
  {
    id: 'second',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 5,
    phone: null,
    checked_in_at: new Date(Date.now() - 1000).toISOString(),
    status: 'waiting',
  },
]

function mockFetch(readyResponse: { ok: boolean; body?: object } = { ok: true }) {
  global.fetch = vi.fn((url: string) => {
    const u = url.toString()
    if (u.includes('/ready')) {
      return Promise.resolve({ ok: readyResponse.ok, json: async () => readyResponse.body ?? {} })
    }
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    if (u.includes('/api/settings')) {
      return Promise.resolve({
        json: async () => ({ avg_min_per_hole_small: '5', avg_min_per_hole_large: '7' }),
        ok: true,
      })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.resetAllMocks()
  mockFetch()
})

describe('PersonalTrackBoard', () => {
  it('shows position and wait time when not first in line', async () => {
    render(<PersonalTrackBoard id="second" />)
    await waitFor(() => screen.getByText('#2'))
    expect(screen.getByText('Mike T.')).toBeInTheDocument()
    expect(screen.queryByText(/ready for the course/i)).not.toBeInTheDocument()
  })

  it('shows the ready headline and button when first in line', async () => {
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByText(/grab your putters/i))
    expect(screen.getByRole('button', { name: /ready for the course/i })).toBeInTheDocument()
  })

  it('requires a second tap before calling the ready endpoint', async () => {
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /ready for the course/i }))
    expect(screen.getByRole('button', { name: /tap again to confirm/i })).toBeInTheDocument()
    const readyCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      c => c[0].toString().includes('/ready')
    )
    expect(readyCalls.length).toBe(0)
  })

  it('calls the ready endpoint and shows the success state on the second tap', async () => {
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => screen.getByText(/enjoy your round/i))
  })

  it('shows an expired message for an unknown party id', async () => {
    render(<PersonalTrackBoard id="does-not-exist" />)
    await waitFor(() => screen.getByText(/expired/i))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/personal-track-board.test.tsx`
Expected: FAIL — `@/components/track/PersonalTrackBoard` doesn't exist yet.

- [ ] **Step 3: Implement `PersonalTrackBoard.tsx`**

Create `src/components/track/PersonalTrackBoard.tsx`:

```typescript
'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { getPartyPosition, getWaitMinutesForParty } from '@/lib/wait-time'
import { buzzerColor } from '@/lib/buzzer-color'
import type { Party } from '@/types'

export default function PersonalTrackBoard({ id }: { id: string }) {
  const [parties, setParties] = useState<Party[]>([])
  const [smallRate, setSmallRate] = useState(4)
  const [largeRate, setLargeRate] = useState(5)
  const [confirming, setConfirming] = useState(false)
  const [readyError, setReadyError] = useState('')
  const [done, setDone] = useState(false)

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
      .channel('personal-track-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parties' }, () => fetchAll())
      .subscribe()
    const poll = setInterval(() => fetchAll(), 3000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [fetchAll])

  async function handleReady() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setReadyError('')
    const res = await fetch(`/api/parties/${id}/ready`, { method: 'POST' })
    if (res.ok) {
      setDone(true)
    } else {
      const data = await res.json()
      setReadyError(data.error ?? 'Something went wrong')
      setConfirming(false)
    }
  }

  const party = parties.find(p => p.id === id)

  if (done) {
    return (
      <div className="min-h-screen bg-rc-green flex items-center justify-center px-6 text-center">
        <p className="text-white text-3xl font-black">You're all set — enjoy your round! ⛳</p>
      </div>
    )
  }

  if (!party) {
    return (
      <div className="min-h-screen bg-rc-navy flex items-center justify-center px-6 text-center">
        <p className="text-white/70 text-xl">This link has expired. Check with the front desk.</p>
      </div>
    )
  }

  const position = getPartyPosition(party, parties)
  const wait = Math.round(getWaitMinutesForParty(party, parties, smallRate, largeRate))
  const bgColor = buzzerColor(position)

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-4 transition-colors duration-700"
      style={{ backgroundColor: bgColor }}
    >
      <p className="text-white/70 text-lg uppercase tracking-widest">{party.first_name} {party.last_initial}.</p>
      {position === 1 ? (
        <>
          <p className="text-white text-3xl font-black max-w-xs">Grab your putters, hole 1 is ready!</p>
          <button
            onClick={handleReady}
            className="bg-white text-rc-navy px-8 py-4 rounded-xl text-xl font-bold mt-2"
          >
            {confirming ? 'Tap again to confirm' : "I'm Ready for the Course"}
          </button>
          {readyError && <p className="text-white text-sm">{readyError}</p>}
        </>
      ) : (
        <>
          <p className="text-white/60 text-xl uppercase tracking-widest">Position</p>
          <p className="text-white text-6xl font-black">#{position}</p>
          <p className="text-white/80 text-2xl font-bold">~{wait} min</p>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create the route**

Create `src/app/track/[id]/page.tsx`:

```typescript
import PersonalTrackBoard from '@/components/track/PersonalTrackBoard'

export const dynamic = 'force-dynamic'

export default function PersonalTrackPage({ params }: { params: { id: string } }) {
  return <PersonalTrackBoard id={params.id} />
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/personal-track-board.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/track/PersonalTrackBoard.tsx src/app/track/[id]/page.tsx tests/personal-track-board.test.tsx
git commit -m "Add personal tracking page with position-based color gradient and ready-up button"
```

---

### Task 5: `CheckinWizard` — QR confirmation screen

**Files:**
- Modify: `src/components/checkin/CheckinWizard.tsx`
- Modify: `tests/checkin-wizard.test.tsx`

- [ ] **Step 1: Update the test mock to return a real party array from the POST call**

In `tests/checkin-wizard.test.tsx`, replace the `mockFetch` helper:

```typescript
function mockFetch(settingsOverride: Record<string, string> = { sms_enabled: 'true' }) {
  global.fetch = vi.fn((url: string) => {
    if (url.toString().includes('/api/settings')) {
      return Promise.resolve({ json: async () => settingsOverride, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}
```

with:

```typescript
function mockFetch(settingsOverride: Record<string, string> = { sms_enabled: 'true' }) {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const u = url.toString()
    if (u.includes('/api/settings')) {
      return Promise.resolve({ json: async () => settingsOverride, ok: true })
    }
    if (u.includes('/api/parties') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'party-1', first_name: 'Alex', last_initial: 'S', party_size: 2, checked_in_at: new Date().toISOString(), status: 'waiting' },
        ],
      })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}
```

- [ ] **Step 2: Update the existing confirmation test and add the multi-group test**

Replace the `it('shows confirmation after successful submit', ...)` test with:

```typescript
  it('shows a QR code after successful submit and only resets when Done is clicked', async () => {
    const onSuccess = vi.fn()
    const { container } = render(<CheckinWizard onSuccess={onSuccess} />)
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
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Size step
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    // Phone step
    await waitFor(() => {
      expect(screen.getByText('Phone Number for Texts?')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('(231) 555-0100'), {
      target: { value: '2315550100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    await waitFor(() => {
      expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('svg').length).toBe(1)

    // Does not auto-reset (old behavior used a 1.5s timer)
    await new Promise(resolve => setTimeout(resolve, 1600))
    expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()

    // Resets only after Done is clicked
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => {
      expect(screen.getByText('First Name?')).toBeInTheDocument()
    })
  })
```

Then add a new top-level describe block at the end of the file, after the `'CheckinWizard with SMS disabled'` block:

```typescript
describe('CheckinWizard multi-group confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('/api/settings')) {
        return Promise.resolve({ json: async () => ({ sms_enabled: 'false' }), ok: true })
      }
      if (u.includes('/api/parties') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'group-1', first_name: 'Big Group 1', last_initial: 'S', party_size: 6, checked_in_at: new Date().toISOString(), status: 'waiting' },
            { id: 'group-2', first_name: 'Big Group 2', last_initial: 'S', party_size: 2, checked_in_at: new Date().toISOString(), status: 'waiting' },
          ],
        })
      }
      return Promise.resolve({ json: async () => ({}), ok: true })
    }) as unknown as typeof fetch
  })

  it('shows one QR code per split group', async () => {
    const { container } = render(<CheckinWizard onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Big Group' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText(/Last Initial/))
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText('Party Size?'))
    fireEvent.click(screen.getByRole('button', { name: '8' }))
    await waitFor(() => screen.getByText('Par-Tee Added!'))
    expect(container.querySelectorAll('svg').length).toBe(2)
    expect(screen.getByText('Group 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Group 2 of 2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/checkin-wizard.test.tsx`
Expected: FAIL — the component still auto-resets after 1.5s and shows no QR code.

- [ ] **Step 4: Implement the QR confirmation screen in `CheckinWizard.tsx`**

Replace the full file:

```typescript
'use client'
import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import NameStep from './NameStep'
import InitialStep from './InitialStep'
import PartySizeStep from './PartySizeStep'
import PhoneStep from './PhoneStep'
import type { Party } from '@/types'

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
  const [confirmedParties, setConfirmedParties] = useState<Party[] | null>(null)
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
      const inserted: Party[] = await res.json()
      setConfirmedParties(inserted)
      onSuccess()
    } catch {
      setErrorMsg('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  function handleDone() {
    setConfirmedParties(null)
    setStep('name')
    setState({ firstName: '', lastInitial: '', partySize: 1 })
  }

  if (confirmedParties) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div className="text-rc-green text-6xl">✓</div>
        <div className="text-rc-navy text-2xl font-bold">Par-Tee Added!</div>
        <div className="flex flex-wrap items-start justify-center gap-6">
          {confirmedParties.map((party, i) => (
            <div key={party.id} className="flex flex-col items-center gap-2">
              {confirmedParties.length > 1 && (
                <span className="text-rc-navy text-sm font-semibold">
                  Group {i + 1} of {confirmedParties.length}
                </span>
              )}
              <QRCodeSVG value={`https://river-club-waitlist.vercel.app/track/${party.id}`} size={140} />
            </div>
          ))}
        </div>
        <p className="text-slate-400 text-sm text-center max-w-xs">
          Have the customer scan to track their spot
        </p>
        <button
          onClick={handleDone}
          className="bg-rc-green text-white px-8 py-3 rounded-xl font-bold"
        >
          Done
        </button>
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/checkin-wizard.test.tsx`
Expected: PASS, all tests including the new QR/multi-group ones. The "does not auto-reset" assertion takes ~1.6s real time — that's expected and fine.

- [ ] **Step 6: Commit**

```bash
git add src/components/checkin/CheckinWizard.tsx tests/checkin-wizard.test.tsx
git commit -m "Show personal QR code(s) on checkin confirmation, dismissed by staff via Done"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npm run test
```
Expected: all tests pass (31 pre-existing + new ones from this plan).

- [ ] **Run the type checker**

```bash
npx tsc --noEmit 2>&1 | grep -v "^tests/"
```
Expected: no output. (The `tests/` filter excludes a pre-existing, unrelated issue: this repo's `tsconfig.json` doesn't declare Vitest's global types, so `tsc` reports false positives like "Cannot find name 'describe'" across every test file. This is not something this plan introduces or needs to fix — `npm run test` is the real, type-aware test runner.)

- [ ] **Run the linter**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Manual end-to-end check on `/checkin`**

1. With `sms_enabled` off (the default), add a party through the wizard. Confirm: no phone step, a single QR code appears with no "Group X of Y" label, the screen does not auto-dismiss.
2. Scan the QR (or copy its encoded URL) and confirm it opens `/track/<that party's id>` showing their position and a navy-leaning background (assuming other parties are ahead of them, or the green "ready" state if they're the only one in queue).
3. Click "Done" on the iPad — confirm it returns to the name step.
4. Add a party with size 8 (forces a 6+2 split) — confirm two QR codes appear, each labeled "Group 1 of 2" / "Group 2 of 2", each pointing to a different `/track/<id>`.
5. Clean up: remove any test parties added during this check via the QueueView "Remove" button so they don't linger in the real queue.
