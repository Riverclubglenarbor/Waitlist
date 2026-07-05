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
    // Past the 10-minute minimum-wait floor, so it reads as actually ready.
    checked_in_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    status: 'waiting',
  },
  {
    id: 'second',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 5,
    phone: null,
    checked_in_at: new Date(Date.now() - 11 * 60_000 + 1000).toISOString(),
    status: 'waiting',
  },
]

function mockFetch(
  readyResponse: { ok: boolean; body?: object } = { ok: true },
  options: { partyById?: Record<string, { ok: boolean; body?: object }> } = {}
) {
  global.fetch = vi.fn((url: string) => {
    const u = url.toString()
    if (u.includes('/ready')) {
      return Promise.resolve({ ok: readyResponse.ok, json: async () => readyResponse.body ?? {} })
    }
    const singleMatch = u.match(/\/api\/parties\/([^/]+)$/)
    if (singleMatch) {
      const partyId = singleMatch[1]
      const override = options.partyById?.[partyId]
      if (override) {
        return Promise.resolve({ ok: override.ok, json: async () => override.body ?? {} })
      }
      const found = parties.find(p => p.id === partyId)
      if (found) {
        return Promise.resolve({ ok: true, json: async () => found })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Party not found' }) })
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

  it('shows a countdown instead of the ready screen for a freshly checked-in first-in-line party', async () => {
    const brandNew = {
      id: 'brandnew',
      first_name: 'Alex',
      last_initial: 'R',
      party_size: 2,
      phone: null,
      checked_in_at: new Date().toISOString(),
      status: 'waiting',
    }
    global.fetch = vi.fn((url: string) => {
      const u = url.toString()
      if (u.endsWith('/api/parties/brandnew')) return Promise.resolve({ ok: true, json: async () => brandNew })
      if (u.includes('/api/parties')) return Promise.resolve({ ok: true, json: async () => [brandNew] })
      if (u.includes('/api/settings')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ avg_min_per_hole_small: '5', avg_min_per_hole_large: '7' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }) as unknown as typeof fetch

    render(<PersonalTrackBoard id="brandnew" />)
    await waitFor(() => screen.getByText('#1'))
    expect(screen.queryByText(/grab your putters/i)).not.toBeInTheDocument()
    expect(screen.getByText('~10 min')).toBeInTheDocument()
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

  it('shows the success message when staff completes checkout before the customer taps Ready', async () => {
    // The party has already transitioned to "playing" via staff's Check In button,
    // so it is absent from the polled /api/parties list, but the per-id GET reflects
    // its true current status.
    mockFetch(
      { ok: true },
      { partyById: { first: { ok: true, body: { ...parties[0], status: 'playing' } } } }
    )
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByText(/enjoy your round/i))
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
  })

  it('shows the expired message when staff marks the party a no-show', async () => {
    mockFetch(
      { ok: true },
      { partyById: { first: { ok: true, body: { ...parties[0], status: 'no_show' } } } }
    )
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByText(/expired/i))
  })

  it('shows the expired message when staff removes the party', async () => {
    mockFetch(
      { ok: true },
      { partyById: { first: { ok: true, body: { ...parties[0], status: 'removed' } } } }
    )
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByText(/expired/i))
  })

  it('syncs the theme-color meta tag to the displayed background so Safari chrome matches', async () => {
    // position 1 -> buzzerColor(1) is full green, matching the page background.
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByText(/grab your putters/i))
    const meta = document.querySelector('meta[name="theme-color"]')
    expect(meta).not.toBeNull()
    expect(meta!.getAttribute('content')).toBe('#6dc04b')
  })

  it('updates the theme-color meta tag when the page transitions to the done state', async () => {
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => screen.getByText(/enjoy your round/i))
    const meta = document.querySelector('meta[name="theme-color"]')
    expect(meta!.getAttribute('content')).toBe('#6DC04B')
  })

  it('sets the theme-color meta tag to navy for the expired state', async () => {
    render(<PersonalTrackBoard id="does-not-exist" />)
    await waitFor(() => screen.getByText(/expired/i))
    const meta = document.querySelector('meta[name="theme-color"]')
    expect(meta!.getAttribute('content')).toBe('#1E3A5F')
  })

  it('shows a network error and resets the confirm state when the ready call rejects', async () => {
    render(<PersonalTrackBoard id="first" />)
    await waitFor(() => screen.getByRole('button', { name: /ready for the course/i }))
    fireEvent.click(screen.getByRole('button', { name: /ready for the course/i }))

    global.fetch = vi.fn((url: string) => {
      if (url.toString().includes('/ready')) return Promise.reject(new Error('network down'))
      return Promise.resolve({ json: async () => parties, ok: true })
    }) as unknown as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /tap again to confirm/i }))
    await waitFor(() => screen.getByText(/network error/i))
    expect(screen.getByRole('button', { name: /ready for the course/i })).toBeInTheDocument()
  })
})
