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

function mockFetch(parties: unknown[]) {
  global.fetch = vi.fn((url: string) => {
    const u = url.toString()
    if (u.includes('/resend')) {
      return Promise.resolve({ json: async () => ({}), ok: true })
    }
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

describe('QueueView countdown', () => {
  it('never shows a negative minute count for the first party in queue, no matter how long they have waited', async () => {
    // First party in queue has zero wait-ahead by construction, so their
    // computed "tee time" equals their own check-in moment. 90 seconds after
    // checking in, this should still read as "ready now", not "-1m".
    mockFetch([
      {
        id: '1',
        first_name: 'Sarah',
        last_initial: 'D',
        party_size: 2,
        phone: null,
        paid: false,
        checked_in_at: new Date(Date.now() - 90_000).toISOString(),
        status: 'waiting',
      },
    ])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.queryByText(/-\d+m/)).not.toBeInTheDocument()
    expect(screen.getByText(/now/i)).toBeInTheDocument()
  })

  it('never shows a negative minute count even when significantly overdue (critical)', async () => {
    mockFetch([
      {
        id: '1',
        first_name: 'Sarah',
        last_initial: 'D',
        party_size: 2,
        phone: null,
        paid: false,
        checked_in_at: new Date(Date.now() - 150_000).toISOString(),
        status: 'waiting',
      },
    ])
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
        party_size: 6, // large group -> larger per-hole rate, pushes tee time into the future
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
        checked_in_at: new Date().toISOString(),
        status: 'waiting',
      },
    ])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    // Mike is second in line behind a large group, so his countdown should
    // be a normal positive minute value, not "now".
    expect(screen.getByText(/^\d+m$/)).toBeInTheDocument()
  })
})
