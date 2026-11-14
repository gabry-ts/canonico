import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CardHead, ChipsInput, CodeBlock, CopyField, ErrorBox, PageHead, SrcStatus, TagChip } from '../../../src/screens/home/sharedViews'
import { renderI18n } from '../../helpers/render'

describe('TagChip', () => {
  it('marks topic tags', () => {
    render(
      <>
        <TagChip tag="weekly" />
        <TagChip tag="topic:onboarding" />
      </>,
    )
    expect(screen.getByText('weekly')).toHaveClass('tag')
    expect(screen.getByText('weekly')).not.toHaveClass('topic')
    expect(screen.getByText('topic:onboarding')).toHaveClass('tag', 'topic')
  })
})

describe('PageHead and CardHead', () => {
  it('PageHead shows title, subtitle and right side', () => {
    render(<PageHead title="Home" sub="ClearPath engagement" right={<button>Scope</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument()
    expect(screen.getByText('ClearPath engagement')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scope' })).toBeInTheDocument()
  })

  it('CardHead shows a subtitle of zero, which is a real count', () => {
    render(<CardHead title="Items" sub={0} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Items' })).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('CardHead leaves out a missing subtitle', () => {
    const { container } = render(<CardHead title="Items" sub={null} />)
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })
})

describe('ErrorBox', () => {
  it('shows the message and retries', async () => {
    const retry = vi.fn()
    const { user } = renderI18n(<ErrorBox message="database is locked" onRetry={retry} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Could not load this. database is locked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('has no retry button when there is nothing to retry', () => {
    renderI18n(<ErrorBox message="boom" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CopyField and CodeBlock', () => {
  it('CopyField shows the value read-only and copies it', async () => {
    const { user } = renderI18n(<CopyField value="brain@inbound.meridianlabs.org" />)
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    const input = screen.getByRole('textbox', { name: 'Value to copy' })
    expect(input).toHaveValue('brain@inbound.meridianlabs.org')
    expect(input).toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith('brain@inbound.meridianlabs.org')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('CodeBlock shows the code as written and copies it', async () => {
    const code = 'curl -X POST http://api.test \\\n  -d \'{"a": 1}\''
    const { user, container } = renderI18n(<CodeBlock value={code} />)
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    expect(container.querySelector('pre')!.textContent).toBe(code)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith(code)
  })
})

describe('ChipsInput', () => {
  function Harness({ initial = [], onChange }: { initial?: string[]; onChange?: (v: string[]) => void }) {
    const [tags, setTags] = useState(initial)
    return (
      <>
        <ChipsInput
          id="tags"
          value={tags}
          onChange={(v) => {
            onChange?.(v)
            setTags(v)
          }}
        />
        <button>elsewhere</button>
      </>
    )
  }
  const input = () => screen.getByRole('textbox', { name: 'Add tag' })
  const chips = () => [...document.querySelectorAll('.chips .tag')].map((el) => el.textContent)

  it('adds a tag on Enter and on comma, and clears the box', async () => {
    const { user } = renderI18n(<Harness />)
    await user.type(input(), 'weekly{Enter}')
    await user.type(input(), 'audit,')
    expect(chips()).toEqual(['weekly', 'audit'])
    expect(input()).toHaveValue('')
  })

  it('normalises what is typed: lower case, dashes for spaces, no commas', async () => {
    const { user } = renderI18n(<Harness />)
    await user.type(input(), '  Weekly   Sync {Enter}')
    expect(chips()).toEqual(['weekly-sync'])
  })

  it('ignores an empty tag and a duplicate', async () => {
    const onChange = vi.fn()
    const { user } = renderI18n(<Harness initial={['weekly']} onChange={onChange} />)
    await user.type(input(), '   {Enter}')
    await user.type(input(), 'Weekly{Enter}')
    expect(chips()).toEqual(['weekly'])
    expect(onChange).not.toHaveBeenCalled()
    expect(input()).toHaveValue('')
  })

  it('adds what is left in the box when focus moves away', async () => {
    const { user } = renderI18n(<Harness />)
    await user.type(input(), 'kickoff')
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(chips()).toEqual(['kickoff'])
  })

  it('Backspace in an empty box removes the last tag, in a non-empty box it edits the text', async () => {
    const { user } = renderI18n(<Harness initial={['a', 'b']} />)
    await user.type(input(), 'xy{Backspace}')
    expect(chips()).toEqual(['a', 'b'])
    expect(input()).toHaveValue('x')
    await user.type(input(), '{Backspace}{Backspace}')
    expect(chips()).toEqual(['a'])
  })

  it('Backspace with no tags does nothing', async () => {
    const onChange = vi.fn()
    const { user } = renderI18n(<Harness onChange={onChange} />)
    await user.type(input(), '{Backspace}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes a tag with its button', async () => {
    const { user } = renderI18n(<Harness initial={['a', 'b', 'c']} />)
    await user.click(screen.getByRole('button', { name: 'Remove tag b' }))
    expect(chips()).toEqual(['a', 'c'])
  })

  it('marks topic tags', () => {
    renderI18n(<Harness initial={['topic:onboarding', 'weekly']} />)
    expect(screen.getByText('topic:onboarding')).toHaveClass('topic')
    expect(screen.getByText('weekly')).not.toHaveClass('topic')
  })

  it('a click anywhere in the field focuses the box', async () => {
    const { user } = renderI18n(<Harness initial={['a']} />)
    await user.click(document.querySelector('.chips')!)
    expect(input()).toHaveFocus()
  })

  it('hints how to add tags only while there are none', async () => {
    const { user } = renderI18n(<Harness />)
    const hint = input().getAttribute('placeholder')
    await user.type(input(), 'a{Enter}')
    expect(input()).toHaveAttribute('placeholder', 'Add tag')
    expect(hint).not.toBe('Add tag')
  })
})

describe('SrcStatus', () => {
  it.each([
    ['syncing', 'Syncing…'],
    ['error', 'Failed'],
    ['idle', 'Not synced yet'],
    ['ok', 'Synced'],
  ])('labels the status %s', (status, label) => {
    renderI18n(<SrcStatus status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('uses a different look for each status, and treats an unknown one as ok', () => {
    const html = (status: string) => renderI18n(<SrcStatus status={status} />).container.querySelector('span')!.outerHTML
    const [syncing, error, idle, ok, other] = ['syncing', 'error', 'idle', 'ok', 'whatever'].map(html)
    expect(new Set([syncing, error, idle, ok]).size).toBe(4)
    expect(other).toBe(ok)
    expect(error).toContain('text-destructive')
    expect(syncing).toContain('dot sync')
  })
})
