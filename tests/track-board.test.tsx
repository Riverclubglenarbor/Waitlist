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
    checked_in_at: new Date(Date.now() - 60_000).toISOString(),
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
