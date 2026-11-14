import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import Dashboard from '../../src/screens/Dashboard'
import { api, deferred, fail } from '../helpers/api'
import { auditEvent, conflict, me, MEMBERS, project, source, stats } from '../helpers/fixtures'
import { item, projectMail } from '../helpers/home'
import { renderWithApp } from '../helpers/render'

const STATS = stats({
  time_to_fix_seconds: { median: 95, samples: 3 },
  answers: { binding: 6, contested: 3, no_answer: 1, since: '2026-11-10' },
  needs_attention: { stale_active: 5 },
})
const DOCS = source({ last_synced_at: '2026-11-10T09:12:00Z' })
const ORG = { scope: 'org' } as const

const scopeButton = (name: string) => within(screen.getByRole('group', { name: 'Scope' })).getByRole('button', { name })
const query = (path: string) => Object.fromEntries(api.last('GET', path)!.query)

beforeEach(() => {
  api.get('/stats', STATS)
  api.get('/maintenance/queue', [])
  api.get('/conflicts', [conflict()])
  api.get('/open-questions', [])
  api.get('/audit', [auditEvent({ actor: 'Giulia Ferri', reason: 'Out of date' })])
  api.get('/projects/:project_id/sources', [DOCS])
  api.get('/projects/:project_id/items', [item({ source_id: DOCS.id, title: 'Steering committee' })])
  api.get('/sources/:source_id/documents', [])
  api.get('/projects/:project_id/mail', projectMail())
})

/** Everything the dashboard loads has arrived. */
async function loaded() {
  await screen.findByText('1 min 35 s')
  await screen.findByText('Audit turnaround')
  await screen.findByText('Out of date')
  await screen.findByText('ClearPath documents')
}

describe('Dashboard', () => {
  describe('in project scope', () => {
    it('is about the current project and asks everything for it', async () => {
      renderWithApp(<Dashboard />)
      await loaded()
      expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement. What needs a person, and what changed.')).toBeInTheDocument()
      expect(scopeButton('Project')).toHaveClass('on')
      expect(scopeButton('Organisation')).not.toHaveClass('on')

      expect(query('/stats')).toEqual({ project_id: 'proj-clearpath' })
      expect(query('/conflicts')).toEqual({ project_id: 'proj-clearpath', status: 'open' })
      expect(query('/maintenance/queue')).toEqual({ project_id: 'proj-clearpath', status: 'pending', limit: '50' })
      expect(query('/open-questions')).toEqual({ project_id: 'proj-clearpath', status: 'open' })
      expect(query('/audit')).toEqual({ project_id: 'proj-clearpath', limit: '8' })
      expect(api.last('GET', '/projects/:project_id/sources')!.params.project_id).toBe('proj-clearpath')
      expect(api.unhandled).toEqual([])
    })

    it('follows the project the app is on', async () => {
      renderWithApp(<Dashboard />, { projectId: 'proj-internal' })
      await loaded()
      expect(screen.getByText('Internal. What needs a person, and what changed.')).toBeInTheDocument()
      expect(query('/stats')).toEqual({ project_id: 'proj-internal' })
      expect(api.last('GET', '/projects/:project_id/sources')!.params.project_id).toBe('proj-internal')
      expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '#/projects/proj-internal')
    })

    it('switches to the organisation on request', async () => {
      const { user, app } = renderWithApp(<Dashboard />)
      await loaded()
      await user.click(scopeButton('Organisation'))
      expect(app.setScope).toHaveBeenCalledWith('org')
    })
  })

  describe('in organisation scope', () => {
    it('is about every project and asks everything without a project', async () => {
      renderWithApp(<Dashboard />, ORG)
      await loaded()
      expect(screen.getByText('Meridian Labs · all 2 projects. What needs a person, and what changed.')).toBeInTheDocument()
      expect(scopeButton('Organisation')).toHaveClass('on')
      expect(scopeButton('Project')).not.toHaveClass('on')

      expect(query('/stats')).toEqual({})
      expect(query('/conflicts')).toEqual({ status: 'open' })
      expect(query('/maintenance/queue')).toEqual({ status: 'pending', limit: '50' })
      expect(query('/open-questions')).toEqual({ status: 'open' })
      expect(query('/audit')).toEqual({ limit: '8' })
    })

    it('still lists the sources of the current project, by name', async () => {
      renderWithApp(<Dashboard />, ORG)
      await loaded()
      expect(screen.getByRole('heading', { name: 'Sources · ClearPath engagement' })).toBeInTheDocument()
      expect(api.last('GET', '/projects/:project_id/sources')!.params.project_id).toBe('proj-clearpath')
      expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '#/projects/proj-clearpath')
    })

    it('uses the singular for an organisation with one project', async () => {
      renderWithApp(<Dashboard />, { ...ORG, projects: [project()] })
      await loaded()
      expect(screen.getByText('Meridian Labs · 1 project. What needs a person, and what changed.')).toBeInTheDocument()
    })

    it('switches back to the project on request', async () => {
      const { user, app } = renderWithApp(<Dashboard />, ORG)
      await loaded()
      await user.click(scopeButton('Project'))
      expect(app.setScope).toHaveBeenCalledWith('project')
    })
  })

  describe('cards', () => {
    it('shows what needs attention, what changed, the figures and the sources', async () => {
      renderWithApp(<Dashboard />)
      await loaded()
      expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
      expect(screen.getByText('Audit turnaround').closest('a')).toHaveAttribute('href', '#/conflicts')

      expect(screen.getByRole('heading', { name: 'What changed recently' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '#/audit')
      expect(screen.getByText('Out of date').closest('li')).toHaveTextContent('Giulia retired M-105')

      expect(screen.getByText('Median of 3 tests')).toBeInTheDocument()
      expect(screen.getByText('since 10 Nov')).toBeInTheDocument()
      expect(screen.getByText('Binding', { selector: 'li span' }).closest('li')).toHaveTextContent(/^Binding6$/)
      expect(screen.getByText('1,234 facts · 46 documents · 12 topics')).toBeInTheDocument()
      expect(screen.getByText('Superseded, still active', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^5$/)

      expect(screen.getByText('ClearPath documents').closest('tr')).toHaveTextContent('46 documents')
    })

    it('shows no figures until the stats arrive, and the rest of the page meanwhile', async () => {
      const gate = deferred()
      api.get('/stats', () => gate.promise)
      renderWithApp(<Dashboard />)
      await screen.findByText('ClearPath documents')
      await screen.findByText('Audit turnaround')
      expect(screen.queryByText('1 min 35 s')).not.toBeInTheDocument()
      expect(screen.queryByText('By status')).not.toBeInTheDocument()
      expect(screen.queryByText('Binding', { selector: 'li span' })).not.toBeInTheDocument()

      gate.resolve(STATS)
      expect(await screen.findByText('1 min 35 s')).toBeInTheDocument()
      expect(screen.getByText('By status')).toBeInTheDocument()
    })

    it('shows the error with a retry in place of the figures when the stats cannot be loaded, and the figures on retry', async () => {
      api.get('/stats', fail(500, 'stats offline'))
      const { user } = renderWithApp(<Dashboard />)
      await screen.findByText('ClearPath documents')
      await waitFor(() => expect(screen.getAllByText('Could not load this. stats offline')).toHaveLength(3))
      expect(screen.queryByText('not measured')).not.toBeInTheDocument()
      expect(screen.queryByText('Not measured yet')).not.toBeInTheDocument()
      for (const title of ['Time to fix a wrong fact', 'Answers', 'Memory health']) {
        const card = screen.getByRole('heading', { name: title }).closest('.card')!
        expect(card.querySelector('.skel')).not.toBeInTheDocument()
      }

      api.get('/stats', STATS)
      await user.click(screen.getAllByRole('button', { name: 'Try again' })[0])
      expect(await screen.findByText('1 min 35 s')).toBeInTheDocument()
      expect(screen.getByText('By status')).toBeInTheDocument()
      expect(screen.getByText('Binding', { selector: 'li span' })).toBeInTheDocument()
      expect(screen.queryByText('Could not load this. stats offline')).not.toBeInTheDocument()
    })

    it('opens the fact drawer from a change', async () => {
      const { user, app } = renderWithApp(<Dashboard />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'M-105' }))
      expect(app.openFact).toHaveBeenCalledWith('M-105')
    })

    it('goes to the project page from a recent item of a source', async () => {
      const { user } = renderWithApp(<Dashboard />)
      await loaded()
      await user.click(screen.getByText('ClearPath documents'))
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(location.hash).toBe('#/projects/proj-clearpath')
    })

    it('keeps the other cards when one of them fails', async () => {
      api.get('/audit', fail(500, 'audit log offline'))
      renderWithApp(<Dashboard />)
      expect(await screen.findByText('Could not load this. audit log offline')).toBeInTheDocument()
      expect(await screen.findByText('Audit turnaround')).toBeInTheDocument()
      expect(await screen.findByText('ClearPath documents')).toBeInTheDocument()
      expect(await screen.findByText('1 min 35 s')).toBeInTheDocument()
    })
  })

  describe('adding a source', () => {
    beforeEach(() => {
      api.get('/projects/:project_id/sources', [])
    })

    it('opens the dialog for the current project from the empty table, and closes it', async () => {
      const { user } = renderWithApp(<Dashboard />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: 'Add source' }))

      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      expect(dialog.getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/mail')).toHaveLength(1))
      expect(api.last('GET', '/projects/:project_id/mail')!.params.project_id).toBe('proj-clearpath')

      await user.click(dialog.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('an editor gets the reason instead of the dialog', async () => {
      const { user } = renderWithApp(<Dashboard />, { me: me({ as: MEMBERS.sara }) })
      const add = await screen.findByRole('button', { name: 'Add source' })
      expect(add).toHaveAttribute('aria-disabled', 'true')
      await user.click(add)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
