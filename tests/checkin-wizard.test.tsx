import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CheckinWizard from '@/components/checkin/CheckinWizard'

const noop = () => {}

function mockFetch(settingsOverride: Record<string, string> = { sms_enabled: 'true' }) {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const u = url.toString()
    if (u.includes('/api/settings')) {
      return Promise.resolve({ json: async () => settingsOverride, ok: true })
    }
    if (u.includes('/api/parties') && init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'party-1', first_name: 'Alex', last_initial: 'S', party_size: 2, checked_in_at: new Date().toISOString(), status: 'waiting' },
        ],
      })
    }
    return Promise.resolve({ json: async () => ({}), ok: true })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.resetAllMocks()
  mockFetch()
})

describe('CheckinWizard', () => {
  it('starts on the name step', () => {
    render(<CheckinWizard onSuccess={noop} />)
    expect(screen.getByText('First Name?')).toBeInTheDocument()
  })

  it('advances to initial step after entering a name', async () => {
    render(<CheckinWizard onSuccess={noop} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('Last Initial, Alex?')).toBeInTheDocument()
    })
  })

  it('can navigate back from initial step to name step', async () => {
    render(<CheckinWizard onSuccess={noop} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByText('First Name?')).toBeInTheDocument()
    })
  })

  it('advances to size step after entering a last initial', async () => {
    render(<CheckinWizard onSuccess={noop} />)
    // Name step
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Initial step
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
  })

  it('advances to phone step after selecting a party size', async () => {
    render(<CheckinWizard onSuccess={noop} />)
    // Name step
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Initial step
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Size step
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => {
      expect(screen.getByText('Phone Number for Texts?')).toBeInTheDocument()
    })
  })

  it('shows a QR code after successful submit and only resets when Done is clicked', async () => {
    const onSuccess = vi.fn()
    const { container } = render(<CheckinWizard onSuccess={onSuccess} />)
    // Name step
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Initial step
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Size step
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    // Phone step
    await waitFor(() => {
      expect(screen.getByText('Phone Number for Texts?')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('(231) 555-0100'), {
      target: { value: '2315550100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to queue/i }))
    await waitFor(() => {
      expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('svg').length).toBe(1)

    // Does not auto-reset (old behavior used a 1.5s timer)
    await new Promise(resolve => setTimeout(resolve, 1600))
    expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()

    // Resets only after Done is clicked
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    await waitFor(() => {
      expect(screen.getByText('First Name?')).toBeInTheDocument()
    })
  })
})

describe('CheckinWizard with SMS disabled', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetch({ sms_enabled: 'false' })
  })

  it('skips the phone step and submits directly after selecting a party size', async () => {
    const onSuccess = vi.fn()
    render(<CheckinWizard onSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('Party Size?')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => {
      expect(screen.getByText('Par-Tee Added!')).toBeInTheDocument()
    })
    expect(screen.queryByText('Phone Number for Texts?')).not.toBeInTheDocument()
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('posts without a phone field when SMS is disabled', async () => {
    render(<CheckinWizard onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Alex' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText(/Last Initial/))
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText('Party Size?'))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => screen.getByText('Par-Tee Added!'))

    const postCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      call => call[0].toString().includes('/api/parties') && call[1]?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall![1].body)
    expect(body.phone).toBeUndefined()
    expect(body.first_name).toBe('Alex')
  })
})

describe('CheckinWizard multi-group confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      const u = url.toString()
      if (u.includes('/api/settings')) {
        return Promise.resolve({ json: async () => ({ sms_enabled: 'false' }), ok: true })
      }
      if (u.includes('/api/parties') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 'group-1', first_name: 'Big Group 1', last_initial: 'S', party_size: 6, checked_in_at: new Date().toISOString(), status: 'waiting' },
            { id: 'group-2', first_name: 'Big Group 2', last_initial: 'S', party_size: 2, checked_in_at: new Date().toISOString(), status: 'waiting' },
          ],
        })
      }
      return Promise.resolve({ json: async () => ({}), ok: true })
    }) as unknown as typeof fetch
  })

  it('shows one QR code per split group', async () => {
    const { container } = render(<CheckinWizard onSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah'), {
      target: { value: 'Big Group' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText(/Last Initial/))
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => screen.getByText('Party Size?'))
    fireEvent.click(screen.getByRole('button', { name: '8' }))
    await waitFor(() => screen.getByText('Par-Tee Added!'))
    expect(container.querySelectorAll('svg').length).toBe(2)
    expect(screen.getByText('Group 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Group 2 of 2')).toBeInTheDocument()
  })
})
