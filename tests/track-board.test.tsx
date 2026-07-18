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
    checked_in_at: new Date(Date.now() + 1000).toISOString(),
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
    // Sarah is first in line -> flat 10-min queue floor
    expect(screen.getByText('10m')).toBeInTheDocument()
    // Mike is behind Sarah's small-group rate (5) on top of that same floor -> 15
    expect(screen.getByText('15m')).toBeInTheDocument()
  })

  it('shows "Now!" only for the front party when a stale epoch clamps every wait to 0', async () => {
    // Prod bug 2026-07-18 (same class as the QueueView incident): the queue
    // epoch had gone stale, so every party's clamped wait hit 0 at once and
    // the customer-facing board flashed "Now!" on every row. Only the front
    // of the waiting line may show "Now!" — everyone behind shows "0m".
    const staleEpoch = new Date(Date.now() - 30 * 60_000).toISOString()
    global.fetch = vi.fn((url: string) => {
      if (url.toString().includes('/api/parties')) {
        return Promise.resolve({ json: async () => parties, ok: true })
      }
      if (url.toString().includes('/api/settings')) {
        return Promise.resolve({
          json: async () => ({
            avg_min_per_hole_small: '5',
            avg_min_per_hole_large: '7',
            queue_epoch_at: staleEpoch,
          }),
          ok: true,
        })
      }
      return Promise.resolve({ json: async () => ({}), ok: true })
    }) as unknown as typeof fetch
    render(<TrackBoard />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.getAllByText('Now!')).toHaveLength(1)
    expect(screen.getByText('0m')).toBeInTheDocument()
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
