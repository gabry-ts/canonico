import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FactCard, PageShell, ReasonDialog, Tabs } from '../../../src/screens/review/views'
import { deferred } from '../../helpers/api'
import { fact } from '../../helpers/fixtures'
import { renderI18n, renderWithApp } from '../../helpers/render'

describe('PageShell', () => {
  it('lays out title, subtitle, tabs and content', () => {
    render(
      <PageShell title="Conflicts" sub="Active facts that disagree." tabs={<div>tabs</div>}>
        <p>content</p>
      </PageShell>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Conflicts' })).toBeInTheDocument()
    expect(screen.getByText('Active facts that disagree.')).toBeInTheDocument()
    expect(screen.getByText('tabs')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})

describe('Tabs', () => {
  const items: [string, string, number | undefined][] = [
    ['open', 'Open', 2],
    ['resolved', 'Resolved', 0],
    ['other', 'Other', undefined],
  ]

  it('marks the selected tab and shows the counts it has, zero included', () => {
    render(<Tabs value="open" onChange={() => {}} items={items} />)
    expect(screen.getByRole('tab', { name: 'Open2' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Open2' })).toHaveClass('on')
    expect(screen.getByRole('tab', { name: 'Resolved0' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Other' })).toBeInTheDocument()
  })

  it('reports the tab that was clicked', async () => {
    const onChange = vi.fn()
    render(<Tabs value="open" onChange={onChange} items={items} />)
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Resolved0' }))
    expect(onChange).toHaveBeenCalledWith('resolved')
  })
})

describe('FactCard', () => {
  const f = fact({ id: 'M-201', value: '3–4 business days', doc_id: '05-meetings/meeting-005-final-presentation', date: '2025-11-20', quote: 'Turnaround is three to four business days.' })

  it('shows the value, where it comes from, the date and the verbatim quote', () => {
    renderWithApp(<FactCard fact={f} />)
    expect(screen.getByText('3–4 business days')).toBeInTheDocument()
    expect(screen.getByText(/final presentation/)).toBeInTheDocument()
    expect(screen.getByText('M-201')).toBeInTheDocument()
    expect(screen.getByText('20 Nov 2025')).toBeInTheDocument()
    expect(screen.getByText('“Turnaround is three to four business days.”')).toBeInTheDocument()
    expect(screen.getByText('05-meetings/meeting-005-final-presentation')).toBeInTheDocument()
  })

  it('opens the fact drawer', async () => {
    const { user, app } = renderWithApp(<FactCard fact={f} />)
    await user.click(screen.getByText('3–4 business days'))
    expect(app.openFact).toHaveBeenCalledWith('M-201')
  })

  it('badges the state of the fact', () => {
    const { rerender } = renderWithApp(<FactCard fact={f} />)
    expect(screen.getByText('Active')).toHaveClass('badge', 'ok')
    rerender(<FactCard fact={f} binding />)
    expect(screen.getByText('Binding')).toHaveClass('badge', 'binding')
    rerender(<FactCard fact={{ ...f, status: 'retired' }} binding />)
    expect(screen.getByText('Retired')).toHaveClass('badge', 'retired')
    rerender(<FactCard fact={{ ...f, superseded_by: 'M-999' }} />)
    expect(screen.getByText('Still active')).toHaveClass('badge', 'conflict')
  })

  it('strikes through the value of a fact that no longer counts', () => {
    const { rerender } = renderWithApp(<FactCard fact={{ ...f, status: 'retired' }} />)
    expect(screen.getByText('3–4 business days')).toHaveClass('strike')
    rerender(<FactCard fact={f} />)
    expect(screen.getByText('3–4 business days')).not.toHaveClass('strike')
  })

  it('highlights the winner and fades the loser', () => {
    const { container, rerender } = renderWithApp(<FactCard fact={f} win />)
    expect(container.firstElementChild).toHaveClass('bg-primary-soft/50')
    rerender(<FactCard fact={f} lose />)
    expect(container.firstElementChild).toHaveClass('opacity-80')
    rerender(<FactCard fact={f} />)
    expect(container.firstElementChild).not.toHaveClass('opacity-80')
    expect(container.firstElementChild).not.toHaveClass('bg-primary-soft/50')
  })

  it('renders the button it is given', () => {
    renderWithApp(<FactCard fact={f} button={<button>Resolve: keep this one</button>} />)
    expect(screen.getByRole('button', { name: 'Resolve: keep this one' })).toBeInTheDocument()
  })
})

describe('ReasonDialog', () => {
  const props = { title: 'Keep “3–4 weeks”?', sub: 'The other fact will be retired.', label: 'Reason', placeholder: 'Why this one?', confirm: 'Keep this one' }

  it('shows its texts and labels the reason box', () => {
    renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={async () => {}} />)
    expect(screen.getByRole('heading', { name: 'Keep “3–4 weeks”?' })).toBeInTheDocument()
    expect(screen.getByText('The other fact will be retired.')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveAttribute('placeholder', 'Why this one?')
  })

  it('asks for a reason before submitting, and clears the error on typing', async () => {
    const onSubmit = vi.fn(async () => {})
    const { user } = renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Add a reason so others can see why.')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveClass('invalid')

    await user.type(screen.getByLabelText('Reason'), 'N')
    expect(screen.queryByText('Add a reason so others can see why.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).not.toHaveClass('invalid')
  })

  it('a reason of only spaces is no reason', async () => {
    const onSubmit = vi.fn(async () => {})
    const { user } = renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Reason'), '   ')
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed reason', async () => {
    const onSubmit = vi.fn(async () => {})
    const { user } = renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Reason'), '  Newer and signed off  ')
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).toHaveBeenCalledWith('Newer and signed off')
  })

  it('submits an empty reason when it is optional', async () => {
    const onSubmit = vi.fn(async () => {})
    const { user } = renderI18n(<ReasonDialog {...props} required={false} onClose={() => {}} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).toHaveBeenCalledWith('')
  })

  it('cannot be submitted twice while the first submit is running', async () => {
    const gate = deferred<void>()
    const onSubmit = vi.fn(() => gate.promise)
    const { user } = renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Reason'), 'Because')
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(screen.getByRole('button', { name: 'Keep this one' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    gate.resolve()
  })

  it('shows why a submit failed and lets the person try again', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Role viewer lacks permission resolve_conflict.')).mockResolvedValueOnce(undefined)
    const { user } = renderI18n(<ReasonDialog {...props} onClose={() => {}} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Reason'), 'Because')
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(await screen.findByText('That did not work. Role viewer lacks permission resolve_conflict.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep this one' })).toBeEnabled()
    expect(screen.getByLabelText('Reason')).toHaveValue('Because')
    await user.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('Cancel, the close button and Escape close it without submitting', async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn(async () => {})
    const { user } = renderI18n(<ReasonDialog {...props} onClose={onClose} onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders extra content above the reason', () => {
    renderI18n(<ReasonDialog {...props} extra={<div>Pick a fact</div>} onClose={() => {}} onSubmit={async () => {}} />)
    const extra = screen.getByText('Pick a fact')
    expect(extra.compareDocumentPosition(screen.getByLabelText('Reason')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
