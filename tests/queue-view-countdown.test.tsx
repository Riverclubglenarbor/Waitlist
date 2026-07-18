import { render, screen, waitFor } from '@testing-library/react'
import QueueView from '@/components/checkin/QueueView'

vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

function mockFetch(parties: unknown[], settings: Record<string, string> = {}) {
  global.fetch = vi.fn((url: string) => {
    const u = url.toString()
    if (u.includes('/resend')) {
      return Promise.resolve({ json: async () => ({}), ok: true })
    }
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    if (u.includes('/api/settings')) {
      return Promise.resolve({ json: async () => settings, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

describe('QueueView countdown', () => {
  it('never shows a negative minute count for the first party in queue, no matter how long they have waited', async () => {
    // First party has zero wait-ahead, so their whole countdown is the
    // shared 10-min floor. The queue epoch started 20 minutes ago, well
    // past that, so this should read as "ready now", not a literal
    // negative number.
    const epoch = new Date(Date.now() - 20 * 60_000).toISOString()
    mockFetch([
      {
        id: '1',
        first_name: 'Sarah',
        last_initial: 'D',
        party_size: 2,
        phone: null,
        paid: false,
        checked_in_at: epoch,
        status: 'waiting',
      },
    ], { queue_epoch_at: epoch })
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.queryByText(/-\d+m/)).not.toBeInTheDocument()
    expect(screen.getByText(/now/i)).toBeInTheDocument()
  })

  it('never shows a negative minute count even when significantly overdue (critical)', async () => {
    const epoch = new Date(Date.now() - 25 * 60_000).toISOString()
    mockFetch([
      {
        id: '1',
        first_name: 'Sarah',
        last_initial: 'D',
        party_size: 2,
        phone: null,
        paid: false,
        checked_in_at: epoch,
        status: 'waiting',
      },
    ], { queue_epoch_at: epoch })
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.queryByText(/-\d+m/)).not.toBeInTheDocument()
    expect(screen.getByText(/now/i)).toBeInTheDocument()
  })

  it('still shows a normal positive countdown for a party not yet due', async () => {
    mockFetch([
      {
        id: '1',
        first_name: 'Sarah',
        last_initial: 'D',
        party_size: 6, // large group -> larger per-hole rate, pushes Mike's tee time further out
        phone: null,
        paid: false,
        checked_in_at: new Date().toISOString(),
        status: 'waiting',
      },
      {
        id: '2',
        first_name: 'Mike',
        last_initial: 'T',
        party_size: 2,
        phone: null,
        paid: false,
        checked_in_at: new Date(Date.now() + 1000).toISOString(),
        status: 'waiting',
      },
    ])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    // Settings fetch isn't mocked here, so rates fall back to the
    // component defaults (small=4, large=5). Mike is second in line behind
    // a large group: floor (10) + that group's rate (5) = 15.
    expect(screen.getByText('15m')).toBeInTheDocument()
  })
})
