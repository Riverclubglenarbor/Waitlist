import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PinGate from '@/components/ui/PinGate'

beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ admin_pin: '1234' }),
    ok: true,
  })
})

describe('PinGate', () => {
  it('shows PIN form when not verified', () => {
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    expect(screen.getByPlaceholderText('Enter PIN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter' })).toBeInTheDocument()
  })

  it('does not show children when not verified', () => {
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument()
  })

  it('shows children after correct PIN is entered', async () => {
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    fireEvent.change(screen.getByPlaceholderText('Enter PIN'), {
      target: { value: '1234' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }))
    await waitFor(() => {
      expect(screen.getByText('Secret Content')).toBeInTheDocument()
    })
  })

  it('shows error state when wrong PIN is entered', async () => {
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    fireEvent.change(screen.getByPlaceholderText('Enter PIN'), {
      target: { value: '9999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }))
    await waitFor(() => {
      const input = screen.getByPlaceholderText('Enter PIN')
      expect(input).toHaveClass('border-red-500')
    })
  })

  it('clears the input after wrong PIN is entered', async () => {
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    fireEvent.change(screen.getByPlaceholderText('Enter PIN'), {
      target: { value: '9999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter PIN')).toHaveValue('')
    })
  })

  it('shows children immediately when already verified via sessionStorage', async () => {
    sessionStorage.setItem('rc_pin_verified', 'true')
    render(
      <PinGate>
        <div>Secret Content</div>
      </PinGate>
    )
    await waitFor(() => {
      expect(screen.getByText('Secret Content')).toBeInTheDocument()
    })
    expect(screen.queryByPlaceholderText('Enter PIN')).not.toBeInTheDocument()
  })
})
