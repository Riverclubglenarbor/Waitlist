import { describe, it, expect, beforeEach } from 'vitest'

let upsertedRows: { key: string; value: string }[] | null = null
const upsertMock = vi.fn((rows: { key: string; value: string }[]) => {
  upsertedRows = rows
  return Promise.resolve({ error: null })
})

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: () => ({
      upsert: upsertMock,
    }),
  }),
}))

// Imported after the mock so the route picks up the mocked supabase client.
import { PUT } from '@/app/api/settings/route'

function makeRequest(body: Record<string, string>): Request {
  return new Request('http://localhost/api/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  upsertMock.mockClear()
  upsertedRows = null
})

// Bug found 2026-07-18 during the post-incident audit: this route used to
// upsert whatever the admin form's plain-text <input> sent, completely
// unvalidated — including avg_min_per_hole_small/_large, which feed
// directly into src/lib/wait-time.ts's queue-pacing math. A blank field or
// a stray non-numeric character would silently poison every wait
// calculation app-wide until someone noticed and manually fixed it.
describe('PUT /api/settings', () => {
  it('saves a normal batch of valid values', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: '5',
      avg_min_per_hole_large: '7',
      admin_pin: '1234',
    }))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith([
      { key: 'avg_min_per_hole_small', value: '5' },
      { key: 'avg_min_per_hole_large', value: '7' },
      { key: 'admin_pin', value: '1234' },
    ])
  })

  it('rejects a blank per-hole rate instead of writing an empty string', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: '',
      avg_min_per_hole_large: '7',
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/avg_min_per_hole_small/)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric per-hole rate instead of writing garbage that parses to NaN', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: 'five',
      avg_min_per_hole_large: '7',
    }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('rejects a per-hole rate below the 1-minute floor', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: '0',
      avg_min_per_hole_large: '7',
    }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('rejects a negative per-hole rate', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: '-3',
      avg_min_per_hole_large: '7',
    }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('is all-or-nothing: one bad field in the batch rejects the whole save, including the otherwise-valid fields', async () => {
    const res = await PUT(makeRequest({
      avg_min_per_hole_small: '5',
      avg_min_per_hole_large: 'not a number',
      admin_pin: '9999',
    }))
    expect(res.status).toBe(400)
    // Nothing in the batch was written -- the admin_pin change didn't
    // silently slip through while the bad rate got rejected.
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('does not require the numeric fields to be present at all (partial saves of unrelated fields still work)', async () => {
    const res = await PUT(makeRequest({ admin_pin: '4321' }))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith([{ key: 'admin_pin', value: '4321' }])
  })

  it('allows 0 for non-rate numeric fields like notification_lead_minutes', async () => {
    const res = await PUT(makeRequest({ notification_lead_minutes: '0' }))
    expect(res.status).toBe(200)
  })

  // Bug found 2026-07-19 (adversarial audit): GET /api/settings returns
  // every row including the server-managed queue_epoch_at, SettingsForm
  // holds the whole map in state and PUTs it all back on save — so a save
  // from a Settings tab that had been open a while wrote a STALE epoch
  // back, rewinding every advance the notify/check-in flow made since the
  // tab loaded. That collapses the entire board's waits toward "Now!" in
  // one click, no race required. The write boundary must simply never
  // accept the epoch key.
  it('silently strips the server-managed queue_epoch_at instead of writing a stale epoch back', async () => {
    const res = await PUT(makeRequest({
      queue_epoch_at: '2026-07-19T08:00:00.000Z', // stale echo from page load
      admin_pin: '1234',
    }))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith([{ key: 'admin_pin', value: '1234' }])
  })

  it('skips the write entirely when only server-managed keys were sent', async () => {
    const res = await PUT(makeRequest({ queue_epoch_at: '2026-07-19T08:00:00.000Z' }))
    expect(res.status).toBe(200)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
