import { describe, it, expect, beforeEach, vi } from 'vitest'
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

const now = Date.now()

const waitingFront = {
  id: '1',
  first_name: 'Sarah',
  last_initial: 'D',
  party_size: 2,
  phone: null,
  paid: false,
  checked_in_at: new Date(now - 60_000).toISOString(),
  status: 'waiting',
}

const waitingSecond = {
  id: '2',
  first_name: 'Mike',
  last_initial: 'T',
  party_size: 2,
  phone: null,
  paid: false,
  checked_in_at: new Date(now).toISOString(),
  status: 'waiting',
}

let postCalls: string[]

function mockFetch(parties: unknown[]) {
  postCalls = []
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const u = url.toString()
    if (init?.method === 'POST') {
      postCalls.push(u)
      return Promise.resolve({ json: async () => ({}), ok: true })
    }
    if (u.includes('/api/parties')) {
      return Promise.resolve({ json: async () => parties, ok: true })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('QueueView notify controls', () => {
  it('shows the Notify button only on the front waiting row', async () => {
    mockFetch([waitingFront, waitingSecond])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const frontRow = screen.getByText('Sarah D.').closest('div.bg-white') as HTMLElement
    const secondRow = screen.getByText('Mike T.').closest('div.bg-white') as HTMLElement
    expect(within(frontRow).getByRole('button', { name: /notify/i })).toBeInTheDocument()
    expect(within(secondRow).queryByRole('button', { name: /notify/i })).not.toBeInTheDocument()
  })

  it('calls the notify endpoint when clicked', async () => {
    mockFetch([waitingFront, waitingSecond])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const frontRow = screen.getByText('Sarah D.').closest('div.bg-white') as HTMLElement
    fireEvent.click(within(frontRow).getByRole('button', { name: /🔔 Notify/i }))
    await waitFor(() => expect(postCalls).toContain('/api/parties/1/notify'))
  })

  it('shows Undo Notify (and no numbered position) on a notified row, and the next waiting party becomes #1', async () => {
    const notified = { ...waitingFront, status: 'notified' }
    mockFetch([notified, waitingSecond])
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const notifiedRow = screen.getByText('Sarah D.').closest('div.bg-white') as HTMLElement
    const nextRow = screen.getByText('Mike T.').closest('div.bg-white') as HTMLElement
    expect(within(notifiedRow).getByRole('button', { name: /undo notify/i })).toBeInTheDocument()
    expect(within(notifiedRow).getByText('🔔')).toBeInTheDocument()
    // Mike inherits position 1 now that Sarah no longer counts.
    expect(within(nextRow).getByText('1')).toBeInTheDocument()

    fireEvent.click(within(notifiedRow).getByRole('button', { name: /undo notify/i }))
    await waitFor(() => expect(postCalls).toContain('/api/parties/1/undo-notify'))
  })
})
