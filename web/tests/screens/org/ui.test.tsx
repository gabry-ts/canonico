import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardHead, CopyField, FieldErr, Loading, PageHead, PageWrap } from '../../../src/screens/org/ui'
import { renderI18n } from '../../helpers/render'

describe('PageWrap', () => {
  it('limits the width of the page', () => {
    const { container, rerender } = render(<PageWrap>content</PageWrap>)
    expect(container.querySelector<HTMLElement>('.mx-auto')!.style.maxWidth).toBe('1120px')
    rerender(<PageWrap max={1180}>content</PageWrap>)
    expect(container.querySelector<HTMLElement>('.mx-auto')!.style.maxWidth).toBe('1180px')
  })
})

describe('PageHead', () => {
  it('shows the title, and the subtitle and right side when given', () => {
    const { rerender } = render(<PageHead title="Settings" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    expect(document.querySelector('.page-sub')).toBeNull()
    rerender(<PageHead title="Settings" sub="Meridian Labs" right={<button>Invite</button>} />)
    expect(screen.getByText('Meridian Labs')).toHaveClass('page-sub')
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument()
  })
})

describe('CardHead', () => {
  it('shows the title, the subtitle and the right side', () => {
    render(<CardHead title="Members" sub="4 people" right={<button>Add</button>} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Members' })).toBeInTheDocument()
    expect(screen.getByText('4 people')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })
})

describe('FieldErr', () => {
  it('shows the message, or nothing without one', () => {
    const { container, rerender } = render(<FieldErr msg="Enter an email" />)
    expect(screen.getByText('Enter an email')).toHaveClass('err')
    rerender(<FieldErr msg={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FieldErr msg="" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FieldErr />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Loading', () => {
  it('marks the area as busy', () => {
    const { container } = render(<Loading />)
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
  })
})

describe('CopyField', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the value read-only and selects it on focus', async () => {
    const { user } = renderI18n(<CopyField value="https://api.test/hooks/in/abc" />)
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input).toHaveValue('https://api.test/hooks/in/abc')
    expect(input).toHaveAttribute('readonly')
    await user.click(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  it('copies the value, says so, and goes back to "Copy" after a moment', async () => {
    const { user } = renderI18n(<CopyField value="secret-1" />)
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith('secret-1')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(screen.getAllByText('Copied')).toHaveLength(2)
    expect(await screen.findByRole('button', { name: 'Copy' }, { timeout: 2500 })).toBeInTheDocument()
  })

  it('falls back to a hidden textarea when the clipboard API refuses', async () => {
    const { user } = renderI18n(<CopyField value="secret-1" />)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const copied: string[] = []
    document.execCommand = vi.fn(() => {
      copied.push(document.querySelector<HTMLTextAreaElement>('body > textarea')!.value)
      return true
    })
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(copied).toEqual(['secret-1'])
    expect(document.querySelector('textarea')).toBeNull()
  })
})
