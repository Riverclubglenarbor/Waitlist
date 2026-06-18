import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CheckinWizard from '@/components/checkin/CheckinWizard'

const noop = () => {}

function mockFetch(settingsOverride: Record<string, string> = { sms_enabled: 'true' }) {
  global.fetch = vi.fn((url: string) => {
    if (url.toString().includes('/api/settings')) {
      return Promise.resolve({ json: async () => settingsOverride, ok: true })
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

  it('shows confirmation after successful submit', async () => {
    const onSuccess = vi.fn()
    render(<CheckinWizard onSuccess={onSuccess} />)
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
