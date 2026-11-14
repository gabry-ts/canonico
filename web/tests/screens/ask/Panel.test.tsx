import { screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { viewOf } from '../../../src/screens/ask/model'
import Panel from '../../../src/screens/ask/Panel'
import { AUDIT, auditChain, chain, chainFact, contestedResponse, ONBOARDING, retiredPreview } from '../../helpers/ask'
import { me, MEMBERS } from '../../helpers/fixtures'
import { renderWithApp } from '../../helpers/render'

type Props = ComponentProps<typeof Panel>

const DEFAULT_REASON = 'The final report sets 3–4 weeks. The 4-week figure was a verbal preview.'
const VIEWER = { me: me({ as: MEMBERS.luca }) }

/** Props of a revealed panel on the onboarding topic, with spies for every callback. */
function props(over: Partial<Props> = {}): Props {
  const c = 'chain' in over ? over.chain : chain()
  return {
    chain: c,
    view: viewOf(c),
    loading: false,
    error: null,
    revealed: true,
    onReveal: vi.fn(),
    contested: null,
    form: null,
    setForm: vi.fn(),
    busy: false,
    onRetire: vi.fn(),
    onRestore: vi.fn(),
    ...over,
  }
}

/** The onboarding topic after M-105 was retired. */
const retiredChain = (over: Parameters<typeof retiredPreview>[0] = {}) => chain({ facts: [ONBOARDING.brief, ONBOARDING.kickoff, retiredPreview(over), ONBOARDING.report] })

const bindingCard = () => screen.getByRole('button', { name: /from the final report/ })
const stillActiveHead = () => screen.getByRole('button', { name: /^4 weeks/ })
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('Panel', () => {
  describe('heading', () => {
    it('names the topic, the project and the topic id', () => {
      renderWithApp(<Panel {...props()} />)
      expect(screen.getByRole('heading', { name: 'What the AI believes' })).toBeInTheDocument()
      expect(screen.getByText('Onboarding target · ClearPath engagement')).toBeInTheDocument()
      expect(screen.getByText('onboarding-target')).toBeInTheDocument()
    })

    it('shows only the project while the topic is not loaded', () => {
      renderWithApp(<Panel {...props({ chain: undefined, loading: true })} />)
      expect(screen.getByText('ClearPath engagement')).toBeInTheDocument()
      expect(screen.queryByText('onboarding-target')).not.toBeInTheDocument()
    })
  })

  describe('before it is revealed', () => {
    it('shows only a placeholder, even when the topic is loaded', () => {
      renderWithApp(<Panel {...props({ revealed: false })} />)
      expect(screen.getByText('The memory behind every answer')).toBeInTheDocument()
      expect(screen.getByText('Which fact is binding now, which versions it replaced, and anything still active that disagrees with it.')).toBeInTheDocument()
      expect(screen.queryByText('3–4 weeks')).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('asks to be revealed from its button', async () => {
      const p = props({ revealed: false })
      const { user } = renderWithApp(<Panel {...p} />)
      await user.click(screen.getByRole('button', { name: 'Show what the AI believes' }))
      expect(p.onReveal).toHaveBeenCalledTimes(1)
    })
  })

  describe('without the topic', () => {
    it('shows skeletons while it loads', () => {
      const { container } = renderWithApp(<Panel {...props({ chain: undefined, loading: true })} />)
      expect(container.querySelectorAll('.skel').length).toBeGreaterThan(0)
      expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('says why it could not be loaded', () => {
      const { container } = renderWithApp(<Panel {...props({ chain: undefined, error: 'database is locked' })} />)
      expect(screen.getByText('The memory for this topic could not be loaded. database is locked')).toBeInTheDocument()
      expect(container.querySelector('.skel')).not.toBeInTheDocument()
    })
  })

  describe('binding fact', () => {
    it('shows the binding value with its document, source and date', () => {
      renderWithApp(<Panel {...props()} />)
      const card = within(bindingCard())
      expect(card.getByText('binding')).toHaveClass('badge', 'binding')
      expect(card.getByText('3–4 weeks')).toBeInTheDocument()
      expect(card.getByText('07-documents/report-final')).toBeInTheDocument()
      expect(card.getByText('28 Nov 2025')).toBeInTheDocument()
      expect(card.getByText('binding').querySelector('svg')).not.toBeInTheDocument()
    })

    it('opens the binding fact on click', async () => {
      const { user, app } = renderWithApp(<Panel {...props()} />)
      await user.click(bindingCard())
      expect(app.openFact).toHaveBeenCalledWith('M-106')
    })

    it('marks a pinned binding fact with a pin', () => {
      const pinned = chain({ facts: [ONBOARDING.kickoff, { ...ONBOARDING.report, pinned: true }] })
      renderWithApp(<Panel {...props({ chain: pinned })} />)
      expect(within(bindingCard()).getByText('binding').querySelector('svg')).toBeInTheDocument()
    })

    it('says when the topic has no binding fact', () => {
      const none = chain({ facts: [ONBOARDING.brief, ONBOARDING.kickoff] })
      renderWithApp(<Panel {...props({ chain: none })} />)
      expect(screen.getByText('No binding fact on this topic yet.')).toBeInTheDocument()
      expect(screen.queryByText('binding')).not.toBeInTheDocument()
    })
  })

  describe('replaced versions', () => {
    it('lists the versions the binding fact replaced, struck through', () => {
      renderWithApp(<Panel {...props()} />)
      expect(screen.getByRole('heading', { name: 'The 2 versions it replaced' })).toBeInTheDocument()
      const brief = within(screen.getByRole('button', { name: /^≈6 weeks/ }))
      expect(brief.getByText('≈6 weeks')).toHaveClass('strike')
      expect(brief.getByText('22 Aug 2025')).toBeInTheDocument()
      expect(brief.getByText(/project brief/)).toBeInTheDocument()
      const kickoff = within(screen.getByRole('button', { name: /^5 weeks/ }))
      expect(kickoff.getByText('12 Sep 2025')).toBeInTheDocument()
      expect(kickoff.getByText(/kickoff/)).toBeInTheDocument()
    })

    it('uses the singular for one version', () => {
      renderWithApp(<Panel {...props({ chain: chain({ facts: [ONBOARDING.kickoff, ONBOARDING.report] }) })} />)
      expect(screen.getByRole('heading', { name: 'The 1 version it replaced' })).toBeInTheDocument()
    })

    it('has no section when nothing was replaced', () => {
      renderWithApp(<Panel {...props({ chain: chain({ facts: [ONBOARDING.report] }) })} />)
      expect(screen.queryByRole('heading', { name: /it replaced/ })).not.toBeInTheDocument()
    })

    it('opens a replaced version on click', async () => {
      const { user, app } = renderWithApp(<Panel {...props()} />)
      await user.click(screen.getByRole('button', { name: /^≈6 weeks/ }))
      expect(app.openFact).toHaveBeenCalledWith('M-101')
    })
  })

  describe('an old fact that is still active', () => {
    it('flags it and explains why plain retrieval still returns it', () => {
      renderWithApp(<Panel {...props()} />)
      const head = within(stillActiveHead())
      expect(head.getByText('4 weeks')).not.toHaveClass('strike')
      expect(head.getByText('20 Nov 2025')).toBeInTheDocument()
      expect(head.getByText(/final presentation/)).toBeInTheDocument()
      expect(screen.getByText('still active')).toHaveClass('badge', 'conflict')
      expect(screen.getByText('Nothing links it to the final report, so plain retrieval still returns it.')).toBeInTheDocument()
    })

    it('opens the fact from its value', async () => {
      const { user, app } = renderWithApp(<Panel {...props()} />)
      await user.click(stillActiveHead())
      expect(app.openFact).toHaveBeenCalledWith('M-105')
    })

    it('leaves the explanation out when no fact is binding', () => {
      const view = { binding: null, replaced: [], stillActive: [ONBOARDING.preview], retired: [] }
      renderWithApp(<Panel {...props({ view })} />)
      expect(screen.getByText('still active')).toBeInTheDocument()
      expect(screen.getByText('No binding fact on this topic yet.')).toBeInTheDocument()
      expect(screen.queryByText(/so plain retrieval still returns it/)).not.toBeInTheDocument()
    })

    it('opens the retire form with the suggested reason', async () => {
      const p = props()
      const { user } = renderWithApp(<Panel {...p} />)
      expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retire' }))
      expect(p.setForm).toHaveBeenCalledWith({ id: 'M-105', reason: DEFAULT_REASON, error: false })
    })

    it('a viewer sees Retire greyed out and a click only explains why', async () => {
      const p = props()
      const { user } = renderWithApp(<Panel {...p} />, VIEWER)
      const retire = screen.getByRole('button', { name: 'Retire' })
      expect(retire).toHaveAttribute('aria-disabled', 'true')
      expect(retire).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(retire)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      expect(p.setForm).not.toHaveBeenCalled()
    })

    it('an editor can retire', () => {
      renderWithApp(<Panel {...props()} />, { me: me({ as: MEMBERS.sara }) })
      const retire = screen.getByRole('button', { name: 'Retire' })
      expect(retire).not.toHaveAttribute('aria-disabled')
      expect(retire).not.toHaveAttribute('data-tip')
    })

    it('keeps the form closed when the open form belongs to another fact', () => {
      renderWithApp(<Panel {...props({ form: { id: 'M-999', reason: 'Other', error: false } })} />)
      expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument()
    })
  })

  describe('retire form', () => {
    const open = (over: Partial<Props> = {}) => props({ form: { id: 'M-105', reason: 'Out of date', error: false }, ...over })

    it('shows the reason and replaces the Retire button', () => {
      renderWithApp(<Panel {...open()} />)
      expect(screen.getByLabelText('Reason')).toHaveValue('Out of date')
      expect(screen.getByLabelText('Reason')).not.toHaveClass('invalid')
      expect(screen.getByText('Kept in history and in the audit log. Nothing is deleted.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument()
    })

    it('reports every edit of the reason and clears the error', async () => {
      const p = open({ form: { id: 'M-105', reason: 'Out of date', error: true } })
      const { user } = renderWithApp(<Panel {...p} />)
      await user.type(screen.getByLabelText('Reason'), '!')
      expect(p.setForm).toHaveBeenCalledWith({ id: 'M-105', reason: 'Out of date!', error: false })
    })

    it('marks the reason as invalid and says a reason is needed', () => {
      renderWithApp(<Panel {...open({ form: { id: 'M-105', reason: '', error: true } })} />)
      expect(screen.getByLabelText('Reason')).toHaveClass('invalid')
      expect(screen.getByText('Add a reason so the next person knows why.')).toBeInTheDocument()
      expect(screen.queryByText('Kept in history and in the audit log. Nothing is deleted.')).not.toBeInTheDocument()
    })

    it('closes on Cancel', async () => {
      const p = open()
      const { user } = renderWithApp(<Panel {...p} />)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(p.setForm).toHaveBeenCalledWith(null)
      expect(p.onRetire).not.toHaveBeenCalled()
    })

    it('retires the fact with the reason on Confirm', async () => {
      const p = open()
      const { user } = renderWithApp(<Panel {...p} />)
      await user.click(screen.getByRole('button', { name: 'Confirm retire' }))
      expect(p.onRetire).toHaveBeenCalledTimes(1)
      expect(p.onRetire).toHaveBeenCalledWith(ONBOARDING.preview, 'Out of date')
    })

    it('locks both buttons and spins while the retirement is sent', async () => {
      const p = open({ busy: true })
      const { user } = renderWithApp(<Panel {...p} />)
      const confirm = screen.getByRole('button', { name: 'Confirm retire' })
      expect(confirm).toBeDisabled()
      expect(confirm.querySelector('.spin')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

      await user.click(confirm)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(p.onRetire).not.toHaveBeenCalled()
      expect(p.setForm).not.toHaveBeenCalled()
    })

    it('does not spin when idle', () => {
      renderWithApp(<Panel {...open()} />)
      expect(screen.getByRole('button', { name: 'Confirm retire' }).querySelector('.spin')).not.toBeInTheDocument()
    })

    it('a viewer cannot confirm', async () => {
      const p = open()
      const { user } = renderWithApp(<Panel {...p} />, VIEWER)
      const confirm = screen.getByRole('button', { name: 'Confirm retire' })
      expect(confirm).toHaveAttribute('aria-disabled', 'true')
      expect(confirm).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(confirm)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      expect(p.onRetire).not.toHaveBeenCalled()
    })
  })

  describe('a retired fact', () => {
    const card = () => within(screen.getByText('retired').closest('.rounded-\\[12px\\]') as HTMLElement)

    it('is struck through and says who retired it today', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: 'Sara' }) })} />)
      expect(screen.getByText('retired')).toHaveClass('badge', 'retired')
      expect(within(stillActiveHead()).getByText('4 weeks')).toHaveClass('strike')
      expect(card().getByText('retired by Sara · today')).toBeInTheDocument()
      expect(screen.queryByText('still active')).not.toBeInTheDocument()
    })

    it('shows the date when it was retired on another day', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: 'Sara', retired_at: '2026-09-03T10:00:00Z' }) })} />)
      expect(card().getByText('retired by Sara · 3 Sep 2026')).toBeInTheDocument()
    })

    it('shows the display name when the current person retired it, by id or by full name', () => {
      const first = renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: 'mem-giulia' }) })} />)
      expect(card().getByText('retired by Giulia · today')).toBeInTheDocument()
      first.unmount()

      renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: 'Giulia Ferri' }) })} />)
      expect(card().getByText('retired by Giulia · today')).toBeInTheDocument()
    })

    it('shows the stored actor when nobody is signed in', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: 'mem-giulia' }) })} />, { me: null })
      expect(card().getByText('retired by mem-giulia · today')).toBeInTheDocument()
    })

    it('leaves the name out when it is not known', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain({ retired_by: null, retired_at: '2026-11-03T10:00:00Z' }) })} />)
      expect(card().getByText('retired · 3 Nov 2026')).toBeInTheDocument()
    })

    it('restores it on Restore', async () => {
      const c = retiredChain()
      const p = props({ chain: c })
      const { user } = renderWithApp(<Panel {...p} />)
      await user.click(screen.getByRole('button', { name: 'Restore' }))
      expect(p.onRestore).toHaveBeenCalledTimes(1)
      expect(p.onRestore).toHaveBeenCalledWith(c.facts[2])
    })

    it('locks Restore while another change is sent', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain(), busy: true })} />)
      expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
    })

    it('a viewer sees Restore greyed out and a click only explains why', async () => {
      const p = props({ chain: retiredChain() })
      const { user } = renderWithApp(<Panel {...p} />, VIEWER)
      const restore = screen.getByRole('button', { name: 'Restore' })
      expect(restore).toHaveAttribute('aria-disabled', 'true')
      expect(restore).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(restore)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      expect(p.onRestore).not.toHaveBeenCalled()
    })

    it('opens the fact from its value', async () => {
      const { user, app } = renderWithApp(<Panel {...props({ chain: retiredChain() })} />)
      await user.click(stillActiveHead())
      expect(app.openFact).toHaveBeenCalledWith('M-105')
    })
  })

  describe('document by document', () => {
    it('lists every fact of the topic, oldest first, with date, document and value', () => {
      renderWithApp(<Panel {...props()} />)
      expect(screen.getByRole('heading', { name: 'Onboarding target, document by document' })).toBeInTheDocument()
      expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Date', 'Document', 'Says', ''])
      expect(rows().map((r) => within(r).getAllByRole('cell').slice(0, 3).map((td) => td.textContent))).toEqual([
        ['22 Aug', 'project brief', '≈6 weeks'],
        ['12 Sep', 'kickoff', '5 weeks'],
        ['20 Nov', 'final presentation', '4 weeks'],
        ['28 Nov', 'final report', '3–4 weeks'],
      ])
    })

    it('highlights the binding row and strikes the superseded ones', () => {
      renderWithApp(<Panel {...props()} />)
      const [brief, , preview, report] = rows()
      expect(report).toHaveClass('bg-primary-soft')
      expect(preview).not.toHaveClass('bg-primary-soft')
      expect(within(brief).getByText('≈6 weeks')).toHaveClass('strike')
      expect(within(preview).getByText('4 weeks')).not.toHaveClass('strike')
      expect(within(report).getByText('3–4 weeks')).not.toHaveClass('strike')
    })

    it('marks the stale fact as the answer of the AI while it is still active', () => {
      renderWithApp(<Panel {...props()} />)
      const [, , preview, report] = rows()
      expect(within(preview).getByText('the AI’s answer')).toHaveClass('badge', 'conflict')
      expect(within(report).queryByText('the AI’s answer')).not.toBeInTheDocument()
    })

    it('marks the binding fact as the answer of the AI once the stale one is retired', () => {
      renderWithApp(<Panel {...props({ chain: retiredChain() })} />)
      const [, , preview, report] = rows()
      expect(within(report).getByText('the AI’s answer')).toHaveClass('badge', 'binding')
      expect(within(preview).queryByText('the AI’s answer')).not.toBeInTheDocument()
      expect(within(preview).getByText('4 weeks')).toHaveClass('strike')
    })

    it('marks no row when the topic has no binding fact', () => {
      renderWithApp(<Panel {...props({ chain: chain({ facts: [ONBOARDING.brief, ONBOARDING.kickoff] }) })} />)
      expect(screen.queryByText('the AI’s answer')).not.toBeInTheDocument()
    })

    it('opens a fact from its row', async () => {
      const { user, app } = renderWithApp(<Panel {...props()} />)
      await user.click(within(rows()[1]).getByText('kickoff'))
      expect(app.openFact).toHaveBeenCalledWith('M-103')
    })

    it('says how many times the value changed', () => {
      renderWithApp(<Panel {...props({ chain: chain({ changes: 3 }) })} />)
      expect(screen.getByText('changed 3 times')).toBeInTheDocument()
    })

    it('uses the singular for one change', () => {
      renderWithApp(<Panel {...props({ chain: chain({ changes: 1 }) })} />)
      expect(screen.getByText('changed 1 time')).toBeInTheDocument()
    })

    it('counts the changes from the facts when the backend does not say', () => {
      const first = renderWithApp(<Panel {...props({ chain: chain({ changes: undefined }) })} />)
      expect(screen.getByText('changed 3 times')).toBeInTheDocument()
      first.unmount()

      renderWithApp(<Panel {...props({ chain: chain({ changes: undefined, facts: [] }) })} />)
      expect(screen.getByText('changed 0 times')).toBeInTheDocument()
    })

    it('uses the title of a mail document as its label', () => {
      const email = chainFact({ id: 'E-301', value: '5 weeks', doc_id: 'mail/msg-301', doc_title: 'Email: Onboarding target confirmed', date: '2026-11-14', supersedes: 'M-106' })
      const withEmail = chain({ facts: [{ ...ONBOARDING.report, type: 'SUPERSEDED', superseded_by: 'E-301' }, email] })
      renderWithApp(<Panel {...props({ chain: withEmail })} />)
      expect(within(rows()[1]).getByText('email · Onboarding target confirmed')).toBeInTheDocument()
      expect(screen.getByText('from the email · Onboarding target confirmed')).toBeInTheDocument()
    })

    it('links to the memory', () => {
      renderWithApp(<Panel {...props()} />)
      expect(screen.getByRole('link', { name: 'Browse every fact on this topic in Memory' })).toHaveAttribute('href', '#/memory')
    })
  })

  describe('a contested topic', () => {
    const contested = (over: Partial<Props> = {}) => props({ chain: auditChain(), contested: contestedResponse(), ...over })

    it('says no value is binding and how many estimates disagree', () => {
      renderWithApp(<Panel {...contested()} />)
      expect(screen.getByText('Audit turnaround · ClearPath engagement')).toBeInTheDocument()
      expect(screen.getByText('contested')).toHaveClass('badge', 'contested')
      expect(screen.getByText('no binding value')).toBeInTheDocument()
      expect(screen.getByText('3 different estimates and no measurement, so no version is binding.')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Browse every fact on this topic in Memory' })).not.toBeInTheDocument()
    })

    it('uses the singular for one estimate', () => {
      renderWithApp(<Panel {...contested({ contested: contestedResponse({ conflicts: [AUDIT.marco] }) })} />)
      expect(screen.getByText('1 estimate and no measurement, so no version is binding.')).toBeInTheDocument()
    })

    it('shows each estimate with the name of who gave it, without the job title', () => {
      renderWithApp(<Panel {...contested()} />)
      const marco = screen.getByRole('button', { name: /^3–4 business days/ })
      expect(within(marco).getByText('Marco Fiore')).toBeInTheDocument()
      expect(marco).not.toHaveTextContent('audit team lead')
      expect(within(screen.getByRole('button', { name: /^5–7 business days/ })).getByText('Sara Conti')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^2 business days/ })).toHaveTextContent(/^2 business days$/)
    })

    it('opens an estimate on click', async () => {
      const { user, app } = renderWithApp(<Panel {...contested()} />)
      await user.click(screen.getByRole('button', { name: /^5–7 business days/ }))
      expect(app.openFact).toHaveBeenCalledWith('M-202')
    })

    it('shows the open question of the topic and opens it', async () => {
      const { user, app } = renderWithApp(<Panel {...contested()} />)
      expect(screen.getByRole('heading', { name: 'Open question' })).toBeInTheDocument()
      const question = screen.getByRole('button', { name: /Was the queue time ever measured\?/ })
      expect(within(question).getByText('open')).toHaveClass('badge', 'open')
      expect(within(question).getByText(/steering/)).toBeInTheDocument()
      expect(within(question).getByText('20 Oct 2025')).toBeInTheDocument()

      await user.click(question)
      expect(app.openFact).toHaveBeenCalledWith('M-204')
    })

    it('lists the other active facts of the topic, not the estimates, the questions or the retired ones', async () => {
      const { user, app } = renderWithApp(<Panel {...contested()} />)
      expect(screen.getByRole('heading', { name: 'Also on this topic' })).toBeInTheDocument()
      const other = screen.getByRole('button', { name: /The queue is reviewed every Friday/ })
      expect(within(other).getByText(/audit policy/)).toBeInTheDocument()
      expect(within(other).getByText('1 Sep 2025')).toBeInTheDocument()
      expect(screen.queryByText('10 business days')).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(5)

      await user.click(other)
      expect(app.openFact).toHaveBeenCalledWith('M-205')
    })

    it('has no extra sections when the topic holds only the estimates', () => {
      renderWithApp(<Panel {...contested({ chain: auditChain({ facts: [AUDIT.marco, AUDIT.sara, AUDIT.sample, { ...AUDIT.open, status: 'retired' }] }) })} />)
      expect(screen.queryByRole('heading', { name: 'Open question' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Also on this topic' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(3)
    })

    it('links to the open questions', () => {
      renderWithApp(<Panel {...contested()} />)
      expect(screen.getByRole('link', { name: 'Review in Open questions' })).toHaveAttribute('href', '#/open-questions')
    })

    it('stays hidden behind the placeholder until revealed', () => {
      renderWithApp(<Panel {...contested({ revealed: false })} />)
      expect(screen.getByText('The memory behind every answer')).toBeInTheDocument()
      expect(screen.queryByText('contested')).not.toBeInTheDocument()
    })
  })
})
