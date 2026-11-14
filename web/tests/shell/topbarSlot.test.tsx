import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TopbarActions } from '../../src/shell/Topbar'
import { setTopbarSlot, useTopbarSlot } from '../../src/shell/topbarSlot'

afterEach(() => act(() => setTopbarSlot(null)))

describe('top bar slot', () => {
  function Probe() {
    return <div data-testid="slot">{useTopbarSlot() ? 'mounted' : 'none'}</div>
  }

  it('is null until the top bar registers its element', () => {
    render(<Probe />)
    expect(screen.getByTestId('slot')).toHaveTextContent('none')
    act(() => setTopbarSlot(document.createElement('div')))
    expect(screen.getByTestId('slot')).toHaveTextContent('mounted')
    act(() => setTopbarSlot(null))
    expect(screen.getByTestId('slot')).toHaveTextContent('none')
  })

  it('TopbarActions renders nothing without a slot', () => {
    render(
      <TopbarActions>
        <button>Export</button>
      </TopbarActions>,
    )
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('TopbarActions renders its children inside the slot, also when the slot appears later', () => {
    render(
      <>
        <TopbarActions>
          <button>Export</button>
        </TopbarActions>
        <div data-testid="bar" ref={setTopbarSlot} />
      </>,
    )
    expect(screen.getByTestId('bar')).toContainElement(screen.getByRole('button', { name: 'Export' }))
  })

  it('the actions go away with the screen that put them there', () => {
    const { rerender } = render(
      <>
        <div data-testid="bar" ref={setTopbarSlot} />
        <TopbarActions>
          <button>Export</button>
        </TopbarActions>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    rerender(<div data-testid="bar" ref={setTopbarSlot} />)
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })
})
