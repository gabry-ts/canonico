import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Schemas } from '../../src/api/client'
import Conflicts from '../../src/screens/Conflicts'
import { api, fail } from '../helpers/api'
import { auditEvent, conflict, fact, me, MEMBERS, topic } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const OPEN = conflict()
const RESOLVED = conflict({
  id: 'C-2',
  topic: 'onboarding-target',
  status: 'resolved',
  summary: 'Two onboarding targets.',
  facts: [
    fact({ id: 'M-106', value: '3–4 weeks', doc_id: '07-documents/report-final', date: '2025-11-28' }),
    fact({ id: 'M-105', value: '6 weeks', doc_id: '01-scope/project-brief', date: '2025-08-22', status: 'retired' }),
  ],
  resolution: { winning_fact_id: 'M-106', reason: 'The final report is the signed-off version.', actor: 'mem-sara', resolved_at: '2026-11-14T11:00:00Z' },
})

/** Answers GET /conflicts by its `status` query, the way the backend does. */
function conflicts(list: Schemas['Conflict'][]) {
  api.get('/conflicts', (req) => list.filter((c) => c.status === (req.query.get('status') ?? 'open')))
}

const card = (id: string) => within(screen.getByText(id).closest('article')!)

beforeEach(() => {
  conflicts([OPEN, RESOLVED])
  api.get('/topics', [topic({ id: 'audit-turnaround', label: 'Audit turnaround' })])
  api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
  api.get('/audit', [])
})

describe('Conflicts', () => {
  it('loads open and resolved conflicts of the project and counts them on the tabs', async () => {
    renderWithApp(<Conflicts />)
    expect(await screen.findByRole('tab', { name: 'Open1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Resolved1' })).toBeInTheDocument()
    const calls = api.callsTo('GET', '/conflicts')
    expect(calls.map((c) => c.query.get('status')).sort()).toEqual(['open', 'resolved'])
    expect(calls.every((c) => c.query.get('project_id') === 'proj-clearpath')).toBe(true)
  })

  it('asks for every project in organisation scope', async () => {
    renderWithApp(<Conflicts />, { scope: 'org', pid: undefined })
    await screen.findByText('C-1')
    expect(api.callsTo('GET', '/conflicts').every((c) => !c.query.has('project_id'))).toBe(true)
  })

  it('shows an open conflict with its topic, summary, when it was detected and both sides', async () => {
    renderWithApp(<Conflicts />)
    await screen.findByText('C-1')
    const c = card('C-1')
    expect(c.getByText('open')).toHaveClass('badge', 'conflict')
    expect(await c.findByRole('heading', { name: 'Audit turnaround' })).toBeInTheDocument()
    expect(c.getByText('Two active facts give a different turnaround.')).toBeInTheDocument()
    expect(c.getByText('Detected 14 Nov, 09:30')).toBeInTheDocument()
    expect(c.getByText('3–4 business days')).toBeInTheDocument()
    expect(c.getByText('5 business days')).toBeInTheDocument()
    expect(c.getAllByRole('button', { name: 'Resolve: keep this one' })).toHaveLength(2)
    expect(screen.queryByText('C-2')).not.toBeInTheDocument()
  })

  it('names a topic without a label from its id', async () => {
    api.get('/topics', [])
    renderWithApp(<Conflicts />)
    await screen.findByText('C-1')
    expect(card('C-1').getByRole('heading', { name: 'audit turnaround' })).toBeInTheDocument()
  })

  it('says when nothing is open and when nothing is resolved', async () => {
    conflicts([])
    const { user } = renderWithApp(<Conflicts />)
    expect(await screen.findByText('No open conflicts')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open0' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Resolved0' }))
    expect(screen.getByText('Nothing resolved yet')).toBeInTheDocument()
  })

  it('shows the error and loads again on retry', async () => {
    api.get('/conflicts', fail(500, 'database is locked'))
    const { user } = renderWithApp(<Conflicts />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open' })).toBeInTheDocument()

    conflicts([OPEN])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('C-1')).toBeInTheDocument()
  })

  describe('resolving', () => {
    const openDialog = async (over = {}) => {
      const view = renderWithApp(<Conflicts />, over)
      await screen.findByText('C-1')
      await view.user.click(card('C-1').getAllByRole('button', { name: 'Resolve: keep this one' })[0])
      return view
    }

    it('asks to confirm, naming the fact to keep, its source and how many will be retired', async () => {
      await openDialog()
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Keep “3–4 business days”?' })).toBeInTheDocument()
      expect(dialog.getByText('From the final presentation, 20 Nov 2025. The other fact will be retired. Nothing is deleted.')).toBeInTheDocument()
    })

    it('counts the other facts of a three-way conflict', async () => {
      conflicts([conflict({ facts: [...OPEN.facts, fact({ id: 'M-203', value: '1 week' })] })])
      await openDialog()
      expect(screen.getByText(/The other 2 facts will be retired/)).toBeInTheDocument()
    })

    it('needs a reason', async () => {
      api.post('/conflicts/:id/resolve', {})
      const { user } = await openDialog()
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))
      expect(screen.getByText('Add a reason so others can see why.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/conflicts/:id/resolve')).toHaveLength(0)
    })

    it('sends the winner, the reason and who decided, then shows the resolved tab', async () => {
      api.post('/conflicts/:id/resolve', {})
      const { user, app } = await openDialog()
      await user.type(screen.getByLabelText('Reason'), 'Confirmed by the audit lead')
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))

      expect(await screen.findByText('Conflict resolved. The next answer follows your decision.')).toBeInTheDocument()
      const sent = api.last('POST', '/conflicts/:id/resolve')!
      expect(sent.params.id).toBe('C-1')
      expect(sent.body).toEqual({ winning_fact_id: 'M-201', reason: 'Confirmed by the audit lead', actor: 'Giulia' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Resolved1' })).toHaveAttribute('aria-selected', 'true')
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('keeps the second fact when that button is used', async () => {
      api.post('/conflicts/:id/resolve', {})
      const { user } = renderWithApp(<Conflicts />)
      await screen.findByText('C-1')
      await user.click(card('C-1').getAllByRole('button', { name: 'Resolve: keep this one' })[1])
      await user.type(screen.getByLabelText('Reason'), 'x')
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))
      await waitFor(() => expect(api.last('POST', '/conflicts/:id/resolve')?.body).toMatchObject({ winning_fact_id: 'M-202' }))
    })

    it('offers Undo in the toast for the audit events the resolution created', async () => {
      let resolved = false
      api.post('/conflicts/:id/resolve', () => {
        resolved = true
        return {}
      })
      api.get('/audit', () => (resolved ? [auditEvent({ id: 'A-9', action: 'resolve', fact_id: 'M-201' }), auditEvent({ id: 'A-1', action: 'retire' })] : [auditEvent({ id: 'A-1', action: 'retire' })]))
      api.post('/audit/:id/undo', {})
      const { user, app } = await openDialog()
      await user.type(screen.getByLabelText('Reason'), 'x')
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))

      const toast = within((await screen.findByText('Conflict resolved. The next answer follows your decision.')).closest('.toast') as HTMLElement)
      await user.click(toast.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-9'])
      expect(app.refresh).toHaveBeenCalledTimes(2)
    })

    it('has no Undo in the toast when no audit event was found', async () => {
      api.post('/conflicts/:id/resolve', {})
      const { user } = await openDialog()
      await user.type(screen.getByLabelText('Reason'), 'x')
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))
      const toast = (await screen.findByText('Conflict resolved. The next answer follows your decision.')).closest('.toast') as HTMLElement
      expect(within(toast).queryByRole('button')).not.toBeInTheDocument()
    })

    it('says why when the backend refuses and keeps the dialog open', async () => {
      api.post('/conflicts/:id/resolve', fail(409, 'Conflict C-1 is already resolved.'))
      const { user, app } = await openDialog()
      await user.type(screen.getByLabelText('Reason'), 'x')
      await user.click(screen.getByRole('button', { name: 'Keep this one' }))
      expect(await screen.findByText('That did not work. Conflict C-1 is already resolved.')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Open1' })).toHaveAttribute('aria-selected', 'true')
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('Cancel closes the dialog without resolving', async () => {
      const { user } = await openDialog()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/conflicts/:id/resolve')).toHaveLength(0)
    })

    it('a viewer cannot resolve: the button is greyed out and only explains', async () => {
      const { user } = renderWithApp(<Conflicts />, { me: me({ as: MEMBERS.luca }) })
      await screen.findByText('C-1')
      const keep = card('C-1').getAllByRole('button', { name: 'Resolve: keep this one' })[0]
      expect(keep).toHaveAttribute('aria-disabled', 'true')
      expect(keep).toHaveAttribute('data-tip', 'Requires editor')
      await user.click(keep)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
    })
  })

  describe('resolved conflicts', () => {
    const showResolved = async (over = {}) => {
      const view = renderWithApp(<Conflicts />, over)
      await view.user.click(await screen.findByRole('tab', { name: 'Resolved1' }))
      return view
    }

    it('show the winner, the loser, who decided, when and why', async () => {
      await showResolved()
      const c = card('C-2')
      expect(c.getByText('resolved')).toHaveClass('badge', 'ok')
      expect(c.getByText('Binding')).toBeInTheDocument()
      expect(c.getByText('Retired')).toBeInTheDocument()
      expect(c.getByText('6 weeks')).toHaveClass('strike')
      expect(c.queryByRole('button', { name: 'Resolve: keep this one' })).not.toBeInTheDocument()
      expect(await c.findByText('Sara Conti')).toBeInTheDocument()
      expect(c.getByText(/kept 3–4 weeks from the final report/)).toBeInTheDocument()
      expect(c.getByText('14 Nov 2026')).toBeInTheDocument()
      expect(c.getByText('The final report is the signed-off version.')).toBeInTheDocument()
    })

    it('Undo undoes the events that closed the conflict, written within the same five seconds', async () => {
      api.get('/audit', [
        auditEvent({ id: 'A-12', action: 'resolve', fact_id: 'M-106', at: '2026-11-14T11:00:02Z' }),
        auditEvent({ id: 'A-11', action: 'retire', fact_id: 'M-105', at: '2026-11-14T11:00:00Z' }),
        auditEvent({ id: 'A-10', action: 'pin', fact_id: 'M-106', at: '2026-11-14T11:00:01Z' }),
        auditEvent({ id: 'A-05', action: 'retire', fact_id: 'M-105', at: '2026-11-13T08:00:00Z' }),
        auditEvent({ id: 'A-04', action: 'resolve', fact_id: 'M-999', at: '2026-11-14T11:00:02Z' }),
        auditEvent({ id: 'A-03', action: 'ingest', fact_id: null, at: '2026-11-14T11:00:02Z' }),
      ])
      api.post('/audit/:id/undo', {})
      const { user, app } = await showResolved()
      await user.click(card('C-2').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-12', 'A-11'])
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('Undo points to the audit log when it cannot find the change', async () => {
      api.post('/audit/:id/undo', {})
      const { user } = await showResolved()
      await user.click(card('C-2').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Could not find the change to undo. Use the audit log.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo')).toHaveLength(0)
    })

    it('Undo says why when it fails', async () => {
      api.get('/audit', [auditEvent({ id: 'A-12', action: 'resolve', fact_id: 'M-106' })])
      api.post('/audit/:id/undo', fail(409, 'Already undone'))
      const { user } = await showResolved()
      await user.click(card('C-2').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('That did not work. Already undone')).toBeInTheDocument()
    })

    it('a viewer cannot undo', async () => {
      api.get('/audit', [auditEvent({ id: 'A-12', action: 'resolve', fact_id: 'M-106' })])
      const { user } = await showResolved({ me: me({ as: MEMBERS.luca }) })
      const undo = card('C-2').getByRole('button', { name: 'Undo' })
      expect(undo).toHaveAttribute('aria-disabled', 'true')
      await user.click(undo)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      expect(api.callsTo('GET', '/audit')).toHaveLength(0)
    })

    it('copes with a winner that is not among the facts and a missing date', async () => {
      conflicts([{ ...RESOLVED, resolution: { winning_fact_id: 'M-000', reason: '', actor: 'mem-sara' } }])
      const { user } = renderWithApp(<Conflicts />)
      await user.click(await screen.findByRole('tab', { name: 'Resolved1' }))
      const c = card('C-2')
      expect(await c.findByText('Sara Conti')).toBeInTheDocument()
      expect(c.queryByText(/kept/)).not.toBeInTheDocument()
      expect(c.queryByText('Binding')).not.toBeInTheDocument()
    })
  })
})
