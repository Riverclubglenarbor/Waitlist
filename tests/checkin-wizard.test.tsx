import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CheckinWizard from '@/components/checkin/CheckinWizard'

const noop = () => {}

beforeEach(() => {
  vi.resetAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({}),
    ok: true,
  })
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
    // Initial step — typing a letter immediately triggers onNext
    await waitFor(() => {
      expect(screen.getByText(/Last Initial/)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. D'), {
      target: { value: 'S' },
    })
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
