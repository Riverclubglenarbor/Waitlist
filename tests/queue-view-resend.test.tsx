import { render, screen, waitFor, within } from '@testing-library/react'
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
    phone: '+12315550100',
    checked_in_at: new Date().toISOString(),
    status: 'waiting',
  },
  {
    id: '2',
    first_name: 'Mike',
    last_initial: 'T',
    party_size: 3,
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
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
})

describe('QueueView resend button', () => {
  it('enables Resend for a party with a phone on file', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Sarah D.'))
    const row = screen.getByText('Sarah D.').closest('div.bg-white')!
    const resendButton = within(row).getByRole('button', { name: /resend/i })
    expect(resendButton).toBeEnabled()
  })

  it('disables Resend for a party with no phone on file', async () => {
    render(<QueueView />)
    await waitFor(() => screen.getByText('Mike T.'))
    const row = screen.getByText('Mike T.').closest('div.bg-white')!
    const resendButton = within(row).getByRole('button', { name: /resend/i })
    expect(resendButton).toBeDisabled()
  })
})
