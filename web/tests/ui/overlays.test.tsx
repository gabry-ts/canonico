import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, Drawer, Empty, Menu, Skeleton, Tips } from '../../src/ui/overlays'

const rect = (r: Partial<DOMRect>) => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect

describe('Dialog', () => {
  it('shows title, subtitle, content and footer in a modal dialog', () => {
    render(
      <Dialog title="Retire this fact" sub="Nothing is deleted." onClose={() => {}} footer={<button>Retire</button>}>
        <p>Body</p>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'Retire this fact' })).toBeInTheDocument()
    expect(screen.getByText('Nothing is deleted.')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument()
  })

  it('leaves out the subtitle and the footer when not given', () => {
    render(
      <Dialog title="T" onClose={() => {}}>
        Body
      </Dialog>,
    )
    expect(screen.getByRole('dialog').querySelector('p')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('closes with the close button, the scrim and Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <Dialog title="T" onClose={onClose}>
        Body
      </Dialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(container.querySelector('.scrim')!)
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('other keys and clicks inside do not close it', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <Dialog title="T" onClose={onClose}>
        <input aria-label="reason" />
      </Dialog>,
    )
    await user.type(screen.getByLabelText('reason'), 'why{Enter}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once closed', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(
      <Dialog title="T" onClose={onClose}>
        Body
      </Dialog>,
    )
    unmount()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Drawer', () => {
  it('is a labelled modal that closes with the scrim and Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <Drawer onClose={onClose} label="Fact M-106">
        <p>Detail</p>
      </Drawer>,
    )
    expect(screen.getByRole('dialog', { name: 'Fact M-106' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Detail')).toBeInTheDocument()
    await user.click(container.querySelector('.scrim')!)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Menu', () => {
  const setup = (props: Partial<Parameters<typeof Menu>[0]> = {}) => {
    const user = userEvent.setup()
    const pick = vi.fn()
    render(
      <>
        <Menu trigger={(toggle, open) => <button onClick={toggle}>{open ? 'close menu' : 'open menu'}</button>} {...props}>
          <div className="menu-label">Theme</div>
          <button className="menu-item" role="menuitem" onClick={() => pick('dark')}>
            <span>Dark</span>
          </button>
        </Menu>
        <button>outside</button>
      </>,
    )
    return { user, pick }
  }

  it('is closed until the trigger is clicked, and the trigger knows the state', async () => {
    const { user } = setup()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'close menu' })).toBeInTheDocument()
  })

  it('the trigger toggles it', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    await user.click(screen.getByRole('button', { name: 'close menu' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('choosing an item runs it and closes the menu, also when the click lands inside the item', async () => {
    const { user, pick } = setup()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    await user.click(screen.getByText('Dark'))
    expect(pick).toHaveBeenCalledWith('dark')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('a click on something that is not an item keeps it open', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    await user.click(screen.getByText('Theme'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes on a click outside', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape, and only on Escape', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'open menu' }))
    await user.keyboard('a')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('gives render-prop children a way to close it', async () => {
    const user = userEvent.setup()
    render(
      <Menu trigger={(toggle) => <button onClick={toggle}>open</button>}>
        {(close) => (
          <button onClick={close} role="menuitem">
            done
          </button>
        )}
      </Menu>,
    )
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.click(screen.getByRole('menuitem', { name: 'done' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  describe('position', () => {
    // jsdom has no layout: give the trigger and the menu a box and the window a size.
    const layout = (trigger: Partial<DOMRect>, menu = { w: 200, h: 120 }, win = { w: 1000, h: 700 }) => {
      vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(trigger))
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(menu.w)
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(menu.h)
      vi.stubGlobal('innerWidth', win.w)
      vi.stubGlobal('innerHeight', win.h)
    }
    const open = async (props?: Partial<Parameters<typeof Menu>[0]>) => {
      const { user } = setup(props)
      await user.click(screen.getByRole('button', { name: 'open menu' }))
      return screen.getByRole('menu')
    }

    it('opens under the trigger, aligned to its left edge', async () => {
      layout({ left: 100, right: 140, top: 10, bottom: 42 })
      const menu = await open()
      expect(menu.style.left).toBe('100px')
      expect(menu.style.top).toBe('48px')
    })

    it('aligns to the right edge of the trigger when asked', async () => {
      layout({ left: 700, right: 740, top: 10, bottom: 42 })
      const menu = await open({ align: 'right' })
      expect(menu.style.left).toBe('540px')
    })

    it('stays inside the window on both sides', async () => {
      layout({ left: 950, right: 990, top: 10, bottom: 42 })
      expect((await open()).style.left).toBe('792px')
    })

    it('does not go past the left edge', async () => {
      layout({ left: 20, right: 60, top: 10, bottom: 42 })
      expect((await open({ align: 'right' })).style.left).toBe('8px')
    })

    it('opens above the trigger when there is no room below', async () => {
      layout({ left: 100, right: 140, top: 640, bottom: 672 })
      expect((await open()).style.top).toBe('514px')
    })

    it('never starts above the window', async () => {
      layout({ left: 100, right: 140, top: 60, bottom: 92 }, { w: 200, h: 120 }, { w: 1000, h: 150 })
      expect((await open()).style.top).toBe('8px')
    })
  })
})

describe('Tips', () => {
  it('shows the data-tip of the element under the pointer and hides it elsewhere', () => {
    render(
      <>
        <button data-tip="Requires editor">
          <span>Retire</span>
        </button>
        <button>Plain</button>
        <Tips />
      </>,
    )
    const tip = screen.getByRole('tooltip')
    expect(tip).not.toHaveClass('show')

    fireEvent.mouseOver(screen.getByText('Retire'))
    expect(tip).toHaveClass('show')
    expect(tip).toHaveTextContent('Requires editor')

    fireEvent.mouseOver(screen.getByRole('button', { name: 'Plain' }))
    expect(tip).not.toHaveClass('show')
  })

  it('hides on scroll and on mouse down', () => {
    render(
      <>
        <button data-tip="Theme">T</button>
        <Tips />
      </>,
    )
    const tip = screen.getByRole('tooltip')
    fireEvent.mouseOver(screen.getByRole('button'))
    fireEvent.scroll(document)
    expect(tip).not.toHaveClass('show')
    fireEvent.mouseOver(screen.getByRole('button'))
    fireEvent.mouseDown(document.body)
    expect(tip).not.toHaveClass('show')
  })

  it('ignores an empty tip', () => {
    render(
      <>
        <button data-tip="">T</button>
        <Tips />
      </>,
    )
    fireEvent.mouseOver(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).not.toHaveClass('show')
  })

  it('centres above the element, and goes below it near the top of the window', () => {
    render(
      <>
        <button data-tip="Theme">T</button>
        <Tips />
      </>,
    )
    const tip = screen.getByRole('tooltip')
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24)
    vi.stubGlobal('innerWidth', 1000)
    const box = vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect')

    box.mockReturnValue(rect({ left: 500, width: 40, top: 300, bottom: 332 }))
    fireEvent.mouseOver(screen.getByRole('button'))
    expect(tip.style.left).toBe('480px')
    expect(tip.style.top).toBe('268px')

    box.mockReturnValue(rect({ left: 0, width: 40, top: 10, bottom: 42 }))
    fireEvent.mouseOver(screen.getByRole('button'))
    expect(tip.style.left).toBe('8px')
    expect(tip.style.top).toBe('50px')
  })

  it('stops listening when removed', () => {
    const { unmount } = render(<Tips />)
    const remove = vi.spyOn(document, 'removeEventListener')
    unmount()
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['mousedown', 'mouseover', 'scroll'])
  })
})

describe('Skeleton', () => {
  it('renders three rows by default, hidden from assistive technology', () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelectorAll('.skel.h-10')).toHaveLength(3)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes a row count and a size', () => {
    const { container } = render(<Skeleton rows={5} className="h-14" />)
    expect(container.querySelectorAll('.skel.h-14')).toHaveLength(5)
  })
})

describe('Empty', () => {
  it('shows a title, and help text when given', () => {
    const { rerender } = render(<Empty title="No events yet" />)
    expect(screen.getByText('No events yet')).toBeInTheDocument()
    rerender(<Empty title="Nothing here">Try another filter.</Empty>)
    expect(screen.getByText('Try another filter.')).toBeInTheDocument()
  })
})
