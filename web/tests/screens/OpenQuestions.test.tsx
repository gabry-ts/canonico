import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Schemas } from '../../src/api/client'
import OpenQuestions from '../../src/screens/OpenQuestions'
import { api, fail } from '../helpers/api'
import { auditEvent, fact, me, MEMBERS, openQuestion, topic } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const OPEN = openQuestion({ note: 'Raised in the kickoff, never settled.' })
const CLOSED = openQuestion({
  id: 'Q-2',
  topic: 'audit-turnaround',
  question: 'Who signs off the audit?',
  fact_id: 'M-302',
  status: 'closed',
  closed_at: '2026-11-14T11:00:00Z',
  answer_fact_id: 'M-201',
  note: 'The audit team lead.',
})

const FACTS: Record<string, Schemas['Fact']> = {
  'M-301': fact({ id: 'M-301', topic: 'pilot-size', type: 'OPEN', value: 'Pilot size not agreed', doc_id: '05-meetings/meeting-001-kickoff', date: '2025-09-12' }),
  'M-302': fact({ id: 'M-302', topic: 'audit-turnaround', type: 'OPEN', value: 'Sign-off owner unclear' }),
  'M-201': fact({ id: 'M-201', topic: 'audit-turnaround', value: 'Marco Fiore signs off', doc_id: '07-documents/report-final' }),
}
const CANDIDATES = [
  FACTS['M-301'],
  fact({ id: 'M-310', topic: 'pilot-size', value: '8 consultants', doc_id: '07-documents/proposal-initial', date: '2025-09-01' }),
  fact({ id: 'M-311', topic: 'pilot-size', value: '12 consultants', doc_id: '07-documents/report-final', date: '2025-11-28' }),
]

function questions(list: Schemas['OpenQuestion'][]) {
  api.get('/open-questions', (req) => list.filter((q) => q.status === (req.query.get('status') ?? 'open')))
}
const card = (id: string) => within(screen.getByText(id).closest('article')!)

// `useFact` caches by data version and fact id for the whole file, so every test uses its own version.
let version = 500

beforeEach(() => {
  version++
  questions([OPEN, CLOSED])
  api.get('/topics', [topic({ id: 'pilot-size', label: 'Pilot size' })])
  api.get('/facts/:id', (req) => FACTS[req.params.id] ?? fail(404, 'Fact not found'))
  api.get('/facts', { items: CANDIDATES, total: CANDIDATES.length, limit: 100, offset: 0 })
  api.get('/audit', [])
})

describe('OpenQuestions', () => {
  it('loads open and closed questions of the project and counts them on the tabs', async () => {
    renderWithApp(<OpenQuestions />, { version })
    expect(await screen.findByRole('tab', { name: 'Open1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Closed1' })).toBeInTheDocument()
    const calls = api.callsTo('GET', '/open-questions')
    expect(calls.map((c) => c.query.get('status')).sort()).toEqual(['closed', 'open'])
    expect(calls.every((c) => c.query.get('project_id') === 'proj-clearpath')).toBe(true)
  })

  it('shows an open question with its topic, note, the fact it came from and its source', async () => {
    renderWithApp(<OpenQuestions />, { version })
    await screen.findByText('Q-1')
    const c = card('Q-1')
    expect(c.getByRole('heading', { name: 'How many consultants join the pilot?' })).toBeInTheDocument()
    expect(c.getByText('open')).toHaveClass('badge', 'open')
    expect(await c.findByText('Pilot size')).toBeInTheDocument()
    expect(c.getByText('Raised in the kickoff, never settled.')).toBeInTheDocument()
    expect(await c.findByText('Pilot size not agreed')).toBeInTheDocument()
    expect(c.getByText('Open question')).toHaveClass('badge')
    expect(c.getByRole('button', { name: 'Close with answer' })).toBeInTheDocument()
    expect(c.queryByText(/^Closed /)).not.toBeInTheDocument()
  })

  it('shows a closed question with when it was closed and the fact that answers it', async () => {
    const { user } = renderWithApp(<OpenQuestions />, { version })
    await user.click(await screen.findByRole('tab', { name: 'Closed1' }))
    const c = card('Q-2')
    expect(c.getByText('closed')).toHaveClass('badge', 'ok')
    expect(c.getByText('Closed 14 Nov 2026')).toBeInTheDocument()
    expect(c.getByText('The audit team lead.')).toBeInTheDocument()
    expect(await c.findByText('Answered by')).toBeInTheDocument()
    expect(c.getByText('Marco Fiore signs off')).toBeInTheDocument()
    expect(c.getByText('Binding')).toBeInTheDocument()
    expect(c.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(screen.queryByText('Q-1')).not.toBeInTheDocument()
  })

  it('a closed question without an answering fact shows no "Answered by"', async () => {
    questions([{ ...CLOSED, answer_fact_id: null }])
    const { user } = renderWithApp(<OpenQuestions />, { version })
    await user.click(await screen.findByRole('tab', { name: 'Closed1' }))
    await card('Q-2').findByText('Sign-off owner unclear')
    expect(card('Q-2').queryByText('Answered by')).not.toBeInTheDocument()
  })

  it('says when there are no open and no closed questions', async () => {
    questions([])
    const { user } = renderWithApp(<OpenQuestions />, { version })
    expect(await screen.findByText('No open questions')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Closed0' }))
    expect(screen.getByText('No closed questions yet')).toBeInTheDocument()
  })

  it('shows the error and loads again on retry', async () => {
    api.get('/open-questions', fail(500, 'database is locked'))
    const { user } = renderWithApp(<OpenQuestions />, { version })
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    questions([OPEN])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Q-1')).toBeInTheDocument()
  })

  describe('closing', () => {
    const openDialog = async (over = {}) => {
      const view = renderWithApp(<OpenQuestions />, { version, ...over })
      await screen.findByText('Q-1')
      await view.user.click(card('Q-1').getByRole('button', { name: 'Close with answer' }))
      return { ...view, dialog: within(screen.getByRole('dialog')) }
    }

    it('offers the other active facts of the topic as the answer', async () => {
      const { dialog } = await openDialog()
      expect(dialog.getByRole('heading', { name: 'Close this question' })).toBeInTheDocument()
      expect(dialog.getByText('How many consultants join the pilot?')).toBeInTheDocument()
      expect(await dialog.findByRole('radio', { name: /8 consultants/ })).not.toBeChecked()
      expect(dialog.getByRole('radio', { name: /12 consultants/ })).toBeInTheDocument()
      // The question's own fact is not a candidate.
      expect(dialog.getAllByRole('radio')).toHaveLength(2)
      const q = api.last('GET', '/facts')!.query
      expect(Object.fromEntries(q)).toEqual({ project_id: 'proj-clearpath', topic: 'pilot-size', status: 'active', limit: '100' })
    })

    it('says when there is nothing to pick', async () => {
      api.get('/facts', { items: [FACTS['M-301']], total: 1, limit: 100, offset: 0 })
      const { dialog } = await openDialog()
      expect(await dialog.findByText('No other active facts on this topic. Write the answer below.')).toBeInTheDocument()
    })

    it('needs a note when no fact is picked', async () => {
      api.post('/open-questions/:id/close', {})
      const { user, dialog } = await openDialog()
      await dialog.findByRole('radio', { name: /8 consultants/ })
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      expect(dialog.getByText('Add an answer or a note.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/open-questions/:id/close')).toHaveLength(0)
    })

    it('closes with a note only', async () => {
      api.post('/open-questions/:id/close', {})
      const { user, dialog, app } = await openDialog()
      await user.type(dialog.getByLabelText('Answer or note'), 'Eight, confirmed by email.')
      await user.click(dialog.getByRole('button', { name: 'Close question' }))

      expect(await screen.findByText('Question closed. It is now part of memory.')).toBeInTheDocument()
      const sent = api.last('POST', '/open-questions/:id/close')!
      expect(sent.params.id).toBe('Q-1')
      expect(sent.body).toEqual({ actor: 'Giulia', note: 'Eight, confirmed by email.' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Closed1' })).toHaveAttribute('aria-selected', 'true')
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('closes with a picked fact and no note', async () => {
      api.post('/open-questions/:id/close', {})
      const { user, dialog } = await openDialog()
      await user.click(await dialog.findByRole('radio', { name: /12 consultants/ }))
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      await waitFor(() => expect(api.last('POST', '/open-questions/:id/close')?.body).toEqual({ actor: 'Giulia', answer_fact_id: 'M-311' }))
    })

    it('closes with a picked fact and a note', async () => {
      api.post('/open-questions/:id/close', {})
      const { user, dialog } = await openDialog()
      await user.click(await dialog.findByRole('radio', { name: /8 consultants/ }))
      await user.type(dialog.getByLabelText('Answer or note'), 'As in the proposal.')
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      await waitFor(() => expect(api.last('POST', '/open-questions/:id/close')?.body).toEqual({ actor: 'Giulia', answer_fact_id: 'M-310', note: 'As in the proposal.' }))
    })

    it('clearing the selection makes the note required again', async () => {
      api.post('/open-questions/:id/close', {})
      const { user, dialog } = await openDialog()
      await user.click(await dialog.findByRole('radio', { name: /8 consultants/ }))
      expect(dialog.getByRole('radio', { name: /8 consultants/ })).toBeChecked()
      await user.click(dialog.getByRole('button', { name: 'Clear selection' }))
      expect(dialog.getByRole('radio', { name: /8 consultants/ })).not.toBeChecked()
      expect(dialog.queryByRole('button', { name: 'Clear selection' })).not.toBeInTheDocument()
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      expect(dialog.getByText('Add an answer or a note.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/open-questions/:id/close')).toHaveLength(0)
    })

    it('offers Undo in the toast for the close event', async () => {
      let closed = false
      api.post('/open-questions/:id/close', () => {
        closed = true
        return {}
      })
      api.get('/audit', () => (closed ? [auditEvent({ id: 'A-7', action: 'close', fact_id: 'M-301' })] : []))
      api.post('/audit/:id/undo', {})
      const { user, dialog } = await openDialog()
      await user.type(dialog.getByLabelText('Answer or note'), 'Eight.')
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      const toast = within((await screen.findByText('Question closed. It is now part of memory.')).closest('.toast') as HTMLElement)
      await user.click(toast.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.last('POST', '/audit/:id/undo')!.params.id).toBe('A-7')
    })

    it('says why when the backend refuses and keeps the dialog open', async () => {
      api.post('/open-questions/:id/close', fail(409, 'Question Q-1 is already closed.'))
      const { user, dialog, app } = await openDialog()
      await user.type(dialog.getByLabelText('Answer or note'), 'Eight.')
      await user.click(dialog.getByRole('button', { name: 'Close question' }))
      expect(await screen.findByText('That did not work. Question Q-1 is already closed.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('a viewer cannot close a question', async () => {
      const { user } = renderWithApp(<OpenQuestions />, { version, me: me({ as: MEMBERS.luca }) })
      await screen.findByText('Q-1')
      const close = card('Q-1').getByRole('button', { name: 'Close with answer' })
      expect(close).toHaveAttribute('aria-disabled', 'true')
      await user.click(close)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
    })
  })

  describe('reopening', () => {
    const showClosed = async (over = {}) => {
      const view = renderWithApp(<OpenQuestions />, { version, ...over })
      await view.user.click(await screen.findByRole('tab', { name: 'Closed1' }))
      return view
    }

    it('undoes the close event of the question', async () => {
      api.get('/audit', [
        auditEvent({ id: 'A-8', action: 'close', fact_id: 'M-302' }),
        auditEvent({ id: 'A-6', action: 'close', fact_id: 'M-302' }),
        auditEvent({ id: 'A-5', action: 'close', fact_id: 'M-301' }),
        auditEvent({ id: 'A-4', action: 'retire', fact_id: 'M-302' }),
      ])
      api.post('/audit/:id/undo', {})
      const { user, app } = await showClosed()
      await user.click(card('Q-2').getByRole('button', { name: 'Reopen' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-8'])
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('points to the audit log when it cannot find the close event', async () => {
      const { user } = await showClosed()
      await user.click(card('Q-2').getByRole('button', { name: 'Reopen' }))
      expect(await screen.findByText('Could not find the change to undo. Use the audit log.')).toBeInTheDocument()
    })

    it('says why when it fails', async () => {
      api.get('/audit', fail(500, 'database is locked'))
      const { user } = await showClosed()
      await user.click(card('Q-2').getByRole('button', { name: 'Reopen' }))
      expect(await screen.findByText('That did not work. database is locked')).toBeInTheDocument()
    })

    it('a viewer cannot reopen', async () => {
      const { user } = await showClosed({ me: me({ as: MEMBERS.luca }) })
      const reopen = card('Q-2').getByRole('button', { name: 'Reopen' })
      expect(reopen).toHaveAttribute('data-tip', 'Requires editor')
      await user.click(reopen)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      expect(api.callsTo('GET', '/audit')).toHaveLength(0)
    })
  })
})
