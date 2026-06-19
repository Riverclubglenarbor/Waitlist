import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import QueueView from '@/components/checkin/QueueView'

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
    paid: false,
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
  {
    id: '2',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 3,
    phone: null,
    paid: true,
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
]

let patchCalls: { id: string; body: unknown }[]

beforeEach(() => {
  vi.resetAllMocks()
  patchCalls = []
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const u = url.toString()
    if (init?.method === 'PATCH') {
      const idMatch = u.match(/\/api\/parties\/([^/]+)$/)
      patchCalls.push({ id: idMatch ? idMatch[1] : '', body: JSON.parse(init.body as string) })
      return Promise.resolve({ json: async () => ({}), ok: true })
    }
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
})

describe('QueueView paid toggle', () => {
  it('shows "Not Paid" for a party that has not paid', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const row = screen.getByText('Sarah D.').closest('div.bg-white') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Not Paid' })).toBeInTheDocument()
  })

  it('shows "✓ Paid" for a party that has paid', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    const row = screen.getByText('Mike T.').closest('div.bg-white') as HTMLElement
    expect(within(row).getByRole('button', { name: '✓ Paid' })).toBeInTheDocument()
  })

  it('does not show a "No Show" button anywhere', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    expect(screen.queryByRole('button', { name: /no show/i })).not.toBeInTheDocument()
  })

  it('toggles paid to true when clicked on an unpaid party', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const row = screen.getByText('Sarah D.').closest('div.bg-white') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Not Paid' }))
    await waitFor(() => expect(patchCalls.length).toBe(1))
    expect(patchCalls[0]).toEqual({ id: '1', body: { paid: true } })
  })

  it('toggles paid to false when clicked on a paid party', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    const row = screen.getByText('Mike T.').closest('div.bg-white') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '✓ Paid' }))
    await waitFor(() => expect(patchCalls.length).toBe(1))
    expect(patchCalls[0]).toEqual({ id: '2', body: { paid: false } })
  })
})
