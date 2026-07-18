import { describe, it, expect, beforeEach, vi } from 'vitest'

let settingsRows: { key: string; value: string }[] = []
const upsertMock = vi.fn(() => Promise.resolve({ error: null }))

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: settingsRows, error: null }),
      upsert: upsertMock,
    }),
  }),
}))

// Imported after the mock so the route picks up the mocked supabase client.
import { POST } from '@/app/api/settings/subtract-time/route'

beforeEach(() => {
  upsertMock.mockClear()
  upsertMock.mockResolvedValue({ error: null } as never)
  settingsRows = []
})

describe('POST /api/settings/subtract-time', () => {
  it('subtracts 5 minutes from both per-hole rates', async () => {
    settingsRows = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(json.avg_min_per_hole_small).toBe(5)
    expect(json.avg_min_per_hole_large).toBe(7)
    expect(json.clamped).toBe(false)
    expect(upsertMock).toHaveBeenCalledWith([
      { key: 'avg_min_per_hole_small', value: '5' },
      { key: 'avg_min_per_hole_large', value: '7' },
    ])
  })

  it('clamps rates at the 1-minute floor instead of going to zero or negative', async () => {
    settingsRows = [
      { key: 'avg_min_per_hole_small', value: '3' },
      { key: 'avg_min_per_hole_large', value: '4' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(1)
    expect(json.clamped).toBe(true)
  })

  it('clamps a rate already at the floor and still returns 200', async () => {
    settingsRows = [
      { key: 'avg_min_per_hole_small', value: '1' },
      { key: 'avg_min_per_hole_large', value: '1' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(1)
    expect(json.clamped).toBe(true)
  })

  it('falls back to avg_min_per_hole when small/large rates are unset', async () => {
    settingsRows = [{ key: 'avg_min_per_hole', value: '6' }]

    const res = await POST()
    const json = await res.json()

    // small falls back to 6, large falls back to 7 (fallback + 1)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(2)
  })
})
