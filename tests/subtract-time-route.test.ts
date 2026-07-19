import { describe, it, expect, beforeEach } from 'vitest'

// A faithful-enough fake of the two Supabase calls these routes make:
// select() (a snapshot, fixed per test) and update()/upsert() chains that
// operate against a SEPARATE "live" table — so a test can simulate a
// concurrent writer having already changed a row between this route's read
// and its write, exactly like two staff devices racing on Speed Up.
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
        // Applies the update as soon as it's resolved, whether that
        // happens via an explicit .select() (as the routes do on their
        // primary writes) or by the chain itself being awaited directly
        // with no .select() (as the rollback write does) — real
        // supabase-js executes on await either way; .select() only
        // controls whether rows come back, not whether the write happens.
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
import { POST } from '@/app/api/settings/subtract-time/route'

beforeEach(() => {
  selectSnapshot = []
  liveRows = []
})

describe('POST /api/settings/subtract-time', () => {
  it('subtracts 5 minutes from both per-hole rates', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    expect(json.avg_min_per_hole_small).toBe(5)
    expect(json.avg_min_per_hole_large).toBe(7)
    expect(json.clamped).toBe(false)
    expect(findLive('avg_min_per_hole_small')?.value).toBe('5')
    expect(findLive('avg_min_per_hole_large')?.value).toBe('7')
  })

  it('clamps rates at the 1-minute floor instead of going to zero or negative', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '3' },
      { key: 'avg_min_per_hole_large', value: '4' },
    ]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(1)
    expect(json.clamped).toBe(true)
  })

  it('clamps a rate already at the floor and still returns 200', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '1' },
      { key: 'avg_min_per_hole_large', value: '1' },
    ]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(1)
    expect(json.clamped).toBe(true)
  })

  it('falls back to avg_min_per_hole when small/large rates are unset', async () => {
    selectSnapshot = [{ key: 'avg_min_per_hole', value: '6' }]
    liveRows = selectSnapshot.map(r => ({ ...r }))

    const res = await POST()
    const json = await res.json()

    // small falls back to 6, large falls back to 7 (fallback + 1)
    expect(json.avg_min_per_hole_small).toBe(1)
    expect(json.avg_min_per_hole_large).toBe(2)
  })

  // Bug found 2026-07-18 during the post-incident audit: this route used to
  // do a blind read-then-upsert with no check that the rate hadn't changed
  // since the read. Two racing requests (two staff devices tapping Speed
  // Up near-simultaneously, or a client double-fire that slipped past the
  // button's own busy-guard) both reading rate=10 and both writing "10 - 5"
  // would silently lose one of the two -5s, landing at 5 instead of 0 — the
  // exact same class of bug as the live "Speed Up" incident, just from a
  // second concurrent writer instead of one double-tap.
  it('returns a 409 conflict instead of a lost update when the rate changed since the read', async () => {
    // This request read rate=10/12...
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    // ...but a racing request already landed and changed the live small
    // rate to 5 before this one gets to write.
    liveRows = [
      { key: 'avg_min_per_hole_small', value: '5' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/changed by someone else/i)
    // Must NOT have applied a partial/stale write on top of the race winner.
    expect(findLive('avg_min_per_hole_small')?.value).toBe('5')
    expect(findLive('avg_min_per_hole_large')?.value).toBe('12')
  })

  it('rolls back the small-rate write if the large-rate write loses the race, leaving neither half-applied', async () => {
    selectSnapshot = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '12' },
    ]
    // The small write will succeed (live matches the read)...
    // ...but the large rate was already changed by a racing request.
    liveRows = [
      { key: 'avg_min_per_hole_small', value: '10' },
      { key: 'avg_min_per_hole_large', value: '3' },
    ]

    const res = await POST()
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/changed by someone else/i)
    // Small rate must be rolled back to its original value, not left at 5.
    expect(findLive('avg_min_per_hole_small')?.value).toBe('10')
    // The racing request's large-rate write is untouched.
    expect(findLive('avg_min_per_hole_large')?.value).toBe('3')
  })
})
