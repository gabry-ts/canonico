import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar, Ic, Logo } from '../../src/ui/Icon'
import { SRC_ICON } from '../../src/ui/srcIcon'
import { ITEM_ICON } from '../../src/screens/home/sharedLib'

const drawn = (name: string) => render(<Ic n={name} />).container.querySelector('svg')!.innerHTML !== ''

describe('Ic', () => {
  it('draws the named icon, hidden from assistive technology', () => {
    const svg = render(<Ic n="search" />).container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(svg.querySelector('circle')).not.toBeNull()
  })

  it('adds the size and utility classes', () => {
    const svg = render(<Ic n="check" className="sm text-muted-foreground" />).container.querySelector('svg')!
    expect(svg).toHaveClass('i', 'sm', 'text-muted-foreground')
  })

  it('draws nothing for a name it does not know, without failing', () => {
    expect(drawn('no-such-icon')).toBe(false)
  })

  it('has a drawing for every source type and every item type', () => {
    for (const name of [...Object.values(SRC_ICON), ...Object.values(ITEM_ICON)]) expect(drawn(name), name).toBe(true)
  })
})

describe('Logo', () => {
  it('scales with its size', () => {
    const svg = render(<Logo size={30} />).container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '30')
    expect(svg).toHaveAttribute('height', '30')
    expect(render(<Logo />).container.querySelector('svg')).toHaveAttribute('width', '22')
  })
})

describe('Avatar', () => {
  it('shows the initial of the name, in capitals', () => {
    expect(render(<Avatar name="giulia ferri" />).container.querySelector('.avatar')).toHaveTextContent('G')
    expect(render(<Avatar name="  marco" />).container.querySelector('.avatar')).toHaveTextContent('M')
  })

  it.each([undefined, null, '', 'system'])('shows the system avatar for %o', (name) => {
    const el = render(<Avatar name={name} />).container.querySelector('.avatar')!
    expect(el).toHaveClass('sys')
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el).toHaveTextContent('')
  })

  it('is decorative', () => {
    expect(render(<Avatar name="Giulia" />).container.querySelector('.avatar')).toHaveAttribute('aria-hidden', 'true')
  })
})
