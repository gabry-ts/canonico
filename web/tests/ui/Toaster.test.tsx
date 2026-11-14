import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast, toastError, Toaster } from '../../src/ui/toast'

describe('Toaster', () => {
  afterEach(() => {
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('announces toasts politely', () => {
    const { container } = render(<Toaster />)
    expect(container.firstElementChild).toHaveAttribute('aria-live', 'polite')
  })

  it('shows a toast raised from anywhere, then removes it', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => toast('Fact retired'))
    expect(screen.getByText('Fact retired')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3400))
    expect(screen.queryByText('Fact retired')).not.toBeInTheDocument()
  })

  it('starts the leaving animation just before the toast goes', () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => toast('Saved'))
    const el = screen.getByText('Saved').closest('.toast')!
    act(() => vi.advanceTimersByTime(3400 - 221))
    expect(el).not.toHaveClass('out')
    act(() => vi.advanceTimersByTime(1))
    expect(el).toHaveClass('out')
  })

  it('stacks toasts in order', () => {
    render(<Toaster />)
    act(() => {
      toast('first')
      toast('second')
    })
    expect([...document.querySelectorAll('.toast')].map((t) => t.textContent)).toEqual(['first', 'second'])
  })

  it('colours the icon by kind', () => {
    render(<Toaster />)
    act(() => {
      toast('ok')
      toastError('failed')
      toast('locked', { icon: 'lock' })
    })
    const tone = (text: string) => screen.getByText(text).closest('.toast')!.querySelector('span')!
    expect(tone('ok')).toHaveClass('text-success')
    expect(tone('failed')).toHaveClass('text-destructive')
    expect(tone('locked')).toHaveClass('text-muted-foreground')
  })

  it('runs the action of a toast', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<Toaster />)
    act(() => toast('Fact retired', { action: { label: 'Undo', run } }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('has no button without an action', () => {
    render(<Toaster />)
    act(() => toast('Saved'))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders rich content', () => {
    render(<Toaster />)
    act(() =>
      toast(
        <>
          Kept <b>3–4 weeks</b>
        </>,
      ),
    )
    expect(screen.getByText('3–4 weeks').tagName).toBe('B')
  })
})
