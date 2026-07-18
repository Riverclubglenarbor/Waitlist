import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import CheckinPage from '@/app/checkin/page'

// Keep the page's children inert — this test only cares about the header
// Add Time / Speed Up controls and their confirm modals.
vi.mock('@/components/checkin/CheckinWizard', () => ({
  default: () => <div data-testid="checkin-wizard" />,
}))
vi.mock('@/components/checkin/QueueView', () => ({
  default: () => <div data-testid="queue-view" />,
}))
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}))

beforeEach(() => {
  vi.resetAllMocks()
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({}) })
  ) as unknown as typeof fetch
})

function callsTo(path: string) {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(call =>
    call[0].toString().includes(path)
  )
}

describe('CheckinPage double-tap protection on confirm modals', () => {
  // Regression test for the live production bug (2026-07-18): a single tap on
  // the confirm modal's "Yes" button on the iPad produced a +10/-10 change —
  // two POSTs fired from one intended tap. The two click events land in the
  // same tick, before React re-renders, so both clicks must be dispatched in
  // the same synchronous block (no await between them) to reproduce it.

  it('fires /api/settings/add-time only once when Add Time "Yes" is double-clicked in the same tick', async () => {
    render(<CheckinPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Time' }))
    const yes = screen.getByRole('button', { name: 'Yes' })

    await act(async () => {
      fireEvent.click(yes)
      fireEvent.click(yes)
    })

    expect(callsTo('/api/settings/add-time')).toHaveLength(1)
  })

  it('fires /api/settings/subtract-time only once when Speed Up "Yes" is double-clicked in the same tick', async () => {
    render(<CheckinPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Speed Up' }))
    const yes = screen.getByRole('button', { name: 'Yes' })

    await act(async () => {
      fireEvent.click(yes)
      fireEvent.click(yes)
    })

    expect(callsTo('/api/settings/subtract-time')).toHaveLength(1)
  })
})
