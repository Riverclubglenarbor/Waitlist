import { render, screen } from '@testing-library/react'
import WaitlistBoard from '@/components/waitlist/WaitlistBoard'

vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

// OdometerNumber renders every digit 0-9 inside each rolling slot, so the
// hero number can't be asserted on via plain text queries. Replace it with
// a passthrough that exposes the value directly.
vi.mock('@/components/waitlist/OdometerNumber', () => ({
  default: ({ value }: { value: number }) => <div data-testid="hero-wait">{value}</div>,
}))

function mockPartiesAndSettings(parties: unknown[], settings: Record<string, string>) {
  global.fetch = vi.fn((url: string) => {
    const u = url.toString()
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    if (u.includes('/api/settings')) {
      return Promise.resolve({ json: async () => settings, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('WaitlistBoard hero number', () => {
  it('shows the wait of the most recently checked-in party, not the queue-wide next-arrival estimate', async () => {
    const now = Date.now()
    const first = {
      id: 'a',
      first_name: 'Sarah',
      last_initial: 'D',
      party_size: 2,
      phone: null,
      paid: false,
      checked_in_at: new Date(now).toISOString(),
      status: 'waiting',
    }
    const last = {
      id: 'b',
      first_name: 'Mike',
      last_initial: 'T',
      party_size: 2,
      phone: null,
      paid: false,
      checked_in_at: new Date(now + 1000).toISOString(),
      status: 'waiting',
    }
    mockPartiesAndSettings([first, last], {
      avg_min_per_hole_small: '5',
      avg_min_per_hole_large: '7',
    })
    render(<WaitlistBoard />)
    // EmptyBoard also renders an OdometerNumber (hardcoded 0) before the
    // parties fetch resolves, so wait for the real queue rows first.
    await screen.findByText('Mike T.')
    // last party's own wait: 10 (base) + 5 (first's rate) - ~0 elapsed = 15.
    // The old queue-wide getQueueWaitMinutes would instead show
    // 10 + 5 + 5 = 20 — a hypothetical next arrival's wait, not any real guest's.
    expect(screen.getByTestId('hero-wait')).toHaveTextContent('15')
  })

  it('shows "Now!" only for the front party when a stale epoch clamps every wait to 0', async () => {
    // Prod bug 2026-07-18 (same class as the QueueView incident): the queue
    // epoch had gone stale, so every party's clamped wait hit 0 at once and
    // the lobby board flashed "Now!" on every row. Only the front of the
    // waiting line may show "Now!" — everyone behind shows "0m".
    const now = Date.now()
    const staleEpoch = new Date(now - 30 * 60_000).toISOString()
    mockPartiesAndSettings(
      [
        {
          id: 'a',
          first_name: 'Sarah',
          last_initial: 'D',
          party_size: 2,
          phone: null,
          paid: false,
          checked_in_at: new Date(now - 60_000).toISOString(),
          status: 'waiting',
        },
        {
          id: 'b',
          first_name: 'Mike',
          last_initial: 'T',
          party_size: 2,
          phone: null,
          paid: false,
          checked_in_at: new Date(now).toISOString(),
          status: 'waiting',
        },
      ],
      {
        avg_min_per_hole_small: '5',
        avg_min_per_hole_large: '7',
        queue_epoch_at: staleEpoch,
      }
    )
    render(<WaitlistBoard />)
    await screen.findByText('Mike T.')
    expect(screen.getAllByText('Now!')).toHaveLength(1)
    expect(screen.getByText('0m')).toBeInTheDocument()
  })
})
