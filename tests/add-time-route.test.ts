import { describe, it, expect, beforeEach } from 'vitest'

// See tests/subtract-time-route.test.ts for the full rationale on this
// fake — select() is a fixed snapshot, update()/upsert() operate on a
// separate "live" table so a test can simulate a concurrent writer having
// already changed a row between this route's read and its write.
let selectSnapshot: { key: string; value: string }[] = []
let liveRows: { key: string; value: string }[] = []

function findLive(key: string) {
  return liveRows.find(r => r.key === key)
}

vi.mock('@/lib/supabase-server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: selectSnapshot, error: null }),
      update: (fields: Record<string, string>) => {
        const filters: [string, unknown][] = []
        // See tests/subtract-time-route.test.ts for why this needs to be
        // thenable directly, not just via .select().
        function applyAndGet() {
          const matched = liveRows.filter(r => filters.every(([col, val]) => (r as never)[col] === val))
          matched.forEach(r => Object.assign(r, fields))
          return { data: matched.map(r => ({ ...r })), error: null }
        }
        const builder = {
          eq(col: string, val: unknown) {
            filters.push([col, val])
            return builder
          },
          select: () => Promise.resolve(applyAndGet()),
          then(resolve: (v: { data: unknown; error: null }) => void) {
            resolve(applyAndGet())
          },
        }
        return builder
      },
      upsert: (rows: { key: string; value: string }[]) => ({
        select: () =>
          Promise.resolve({
            data: rows.map(nr => {
              const existing = findLive(nr.key)
              if (existing) existing.value = nr.value
              else liveRows.push({ ...nr })
              return { ...nr }
            }),
            error: null,
          }),
      }),
    }),
  }),
}))

// Imported after the mock so the route picks up the mocked supabase client.
import { POST } from '@/app/api/settings/add-time/route'

beforeEach(() => {
  selectSnapshot = []
  liveRows = []
})

describe('POST /api/settings/add-time', () => {
  it('adds 5 minutes to both per-hole rates', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    expect(json.avg_min_per_hole_small).toBe(15)
    expect(json.avg_min_per_hole_large).toBe(17)
    expect(findLive('avg_min_per_hole_small')?.value).toBe('15')
    expect(findLive('avg_min_per_hole_large')?.value).toBe('17')
  })

  it('falls back to avg_min_per_hole when small/large rates are unset', async () => {
    selectSnapshot = [{ key: 'avg_min_per_hole', value: '6' }]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    // small falls back to 6 (+5 = 11), large falls back to 7 (+5 = 12)
    expect(json.avg_min_per_hole_small).toBe(11)
    expect(json.avg_min_per_hole_large).toBe(12)
  })

  // Same lost-update race this route shares with subtract-time — see that
  // file's comment for the full incident context. Two racing Add Time taps
  // both reading the same stale rate must not silently collapse into a
  // single +5 instead of +10.
  it('returns a 409 conflict instead of a lost update when the rate changed since the read', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    liveRows = [
      { key: 'avg_min_per_hole_small', value: '15' }, // a racing request already applied its own +5
      { key: 'avg_min_per_hole_large', value: '12' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/changed by someone else/i)
    expect(findLive('avg_min_per_hole_small')?.value).toBe('15')
    expect(findLive('avg_min_per_hole_large')?.value).toBe('12')
  })

  it('rolls back the small-rate write if the large-rate write loses the race, leaving neither half-applied', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    liveRows = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '17' }, // racing request already applied its own +5
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/changed by someone else/i)
    expect(findLive('avg_min_per_hole_small')?.value).toBe('10')
    expect(findLive('avg_min_per_hole_large')?.value).toBe('17')
  })
})
