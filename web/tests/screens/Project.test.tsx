import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import Project from '../../src/screens/Project'
import { api, deferred, fail } from '../helpers/api'
import { auditEvent, me, member, MEMBERS, project, source, stats } from '../helpers/fixtures'
import { item, mailConfig, mailRule, projectMail, projectMember } from '../helpers/home'
import { goto, renderWithApp } from '../helpers/render'

const DOCS = source({ last_synced_at: '2026-11-10T09:12:00Z' })
const GH = source({ id: 'src-github', type: 'github', label: 'acme/handbook', config: { repo_url: 'https://github.com/acme/handbook', include: ['issues'] } })
const MEETING = item({ id: 'I-1', title: 'Steering committee', type: 'meeting', source_id: DOCS.id })
const NOTE = item({ id: 'I-2', title: 'Budget note', type: 'note', source_id: null })
const VIEWER = { me: me({ as: MEMBERS.luca }) }
const EDITOR = { me: me({ as: MEMBERS.sara }) }

/** The card under a section title. */
const card = (title: string) => within(screen.getByRole('heading', { name: title }).closest<HTMLElement>('.card')!)
const dd = (scope: ReturnType<typeof within>, term: string) => scope.getByText(term, { selector: 'dt' }).nextElementSibling!
const paramOf = (path: string) => api.last('GET', path)!.params.project_id
const mailCalls = () => api.callsTo('GET', '/projects/:project_id/mail')

beforeEach(() => {
  api.get('/projects/:project_id', (req) => project({ id: req.params.project_id, name: req.params.project_id === 'proj-internal' ? 'Internal' : 'ClearPath engagement' }))
  api.get('/stats', stats({ answers: { binding: 6, contested: 3, no_answer: 1 } }))
  api.get('/projects/:project_id/sources', [DOCS, GH])
  api.get('/projects/:project_id/items', (req) => [MEETING, NOTE].filter((i) => !req.query.get('type') || i.type === req.query.get('type')))
  api.get('/sources/:source_id/documents', [])
  api.get('/items/:item_id', (req) => ({ ...MEETING, id: req.params.item_id }))
  api.get('/documents/:doc_id/facts', [])
  api.get('/maintenance/queue', [])
  api.get('/conflicts', [])
  api.get('/open-questions', [])
  api.get('/audit', [auditEvent({ actor: 'Giulia Ferri', reason: 'Out of date' })])
  api.get('/projects/:project_id/members', [projectMember()])
  api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
  api.get('/projects/:project_id/mail', projectMail())
  api.get('/org/mail/rules', { items: [mailRule()], total: 1 })
  // What the two dialogs ask for when they open.
  api.get('/tags', [])
  api.get('/topics', [])
})

/** Every card of the page has its data. */
async function loaded(name = 'ClearPath engagement') {
  await screen.findByRole('heading', { name })
  await screen.findByText('src-clearpath-docs')
  await screen.findByText('2 of 2')
  await screen.findByText('Nothing needs a person here.')
  await screen.findByText('Out of date')
  await screen.findByText('giulia@meridianlabs.org')
  await screen.findByText('Routing rules to this project')
  await screen.findByText('Binding')
}

describe('Project', () => {
  describe('which project', () => {
    it('shows the current project when the route names none, and asks everything for it', async () => {
      const { app } = renderWithApp(<Project />)
      await loaded()
      expect(paramOf('/projects/:project_id')).toBe('proj-clearpath')
      expect(Object.fromEntries(api.last('GET', '/stats')!.query)).toEqual({ project_id: 'proj-clearpath' })
      for (const path of ['/projects/:project_id/sources', '/projects/:project_id/items', '/projects/:project_id/members', '/projects/:project_id/mail']) expect(paramOf(path)).toBe('proj-clearpath')
      expect(api.last('GET', '/conflicts')!.query.get('project_id')).toBe('proj-clearpath')
      expect(api.last('GET', '/audit')!.query.get('project_id')).toBe('proj-clearpath')
      expect(app.setProjectId).not.toHaveBeenCalled()
      expect(api.unhandled).toEqual([])
    })

    it('shows the project of the route and makes it the current one', async () => {
      goto('projects/proj-internal')
      const { app } = renderWithApp(<Project />)
      await loaded('Internal')
      expect(paramOf('/projects/:project_id')).toBe('proj-internal')
      expect(Object.fromEntries(api.last('GET', '/stats')!.query)).toEqual({ project_id: 'proj-internal' })
      for (const path of ['/projects/:project_id/sources', '/projects/:project_id/items', '/projects/:project_id/members', '/projects/:project_id/mail']) expect(paramOf(path)).toBe('proj-internal')
      expect(api.last('GET', '/open-questions')!.query.get('project_id')).toBe('proj-internal')
      expect(app.setProjectId).toHaveBeenCalledWith('proj-internal')
    })

    it('does not switch when the route names the current project', async () => {
      goto('projects/proj-clearpath')
      const { app } = renderWithApp(<Project />)
      await loaded()
      expect(app.setProjectId).not.toHaveBeenCalled()
    })

    it('does not make current a project the organisation does not have', async () => {
      goto('projects/proj-archived')
      api.get('/projects/:project_id', project({ id: 'proj-archived', name: 'Archived engagement' }))
      const { app } = renderWithApp(<Project />)
      await loaded('Archived engagement')
      expect(paramOf('/projects/:project_id')).toBe('proj-archived')
      expect(app.setProjectId).not.toHaveBeenCalled()
    })

    it('opens the source named after the project in the route', async () => {
      goto('projects/proj-clearpath/src-github')
      renderWithApp(<Project />)
      await loaded()
      expect(screen.getByText('src-github').closest('button')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('src-clearpath-docs').closest('button')).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('https://github.com/acme/handbook')).toBeInTheDocument()
    })

    it('follows the route when it changes', async () => {
      const { app } = renderWithApp(<Project />)
      await loaded()
      goto('projects/proj-internal')
      expect(await screen.findByRole('heading', { name: 'Internal' })).toBeInTheDocument()
      expect(app.setProjectId).toHaveBeenCalledWith('proj-internal')
      await waitFor(() => expect(paramOf('/projects/:project_id/sources')).toBe('proj-internal'))
      await loaded('Internal')
    })
  })

  describe('header', () => {
    it('shows name and description, and links to Ask, Sources, Audit log and Members', async () => {
      renderWithApp(<Project />)
      await loaded()
      expect(screen.getByText('Consulting engagement for ClearPath.')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Ask this project' })).toHaveAttribute('href', '#/app')
      expect(card('Sources').getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '#/sources')
      expect(card('Recent changes').getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '#/audit')
      expect(card('Members').getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '#/settings/members')
    })

    it('shows the rest of the page while the project itself loads', async () => {
      const gate = deferred()
      api.get('/projects/:project_id', () => gate.promise)
      renderWithApp(<Project />)
      await screen.findByText('src-clearpath-docs')
      expect(screen.queryByRole('heading', { name: 'ClearPath engagement' })).not.toBeInTheDocument()
      expect(screen.queryByText('Consulting engagement for ClearPath.')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled()

      gate.resolve(project({ description: null }))
      expect(await screen.findByRole('heading', { name: 'ClearPath engagement' })).toBeInTheDocument()
      // No description: no line under the name.
      expect(screen.queryByText('Consulting engagement for ClearPath.')).not.toBeInTheDocument()
      await loaded()
    })

    it('shows only the error when the project cannot be loaded, and loads again on retry', async () => {
      api.get('/projects/:project_id', fail(404, 'No such project'))
      const { user } = renderWithApp(<Project />)
      expect(await screen.findByText('Could not load this. No such project')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Members' })).not.toBeInTheDocument()

      api.get('/projects/:project_id', project())
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await loaded()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })
  })

  describe('upload and add source', () => {
    it('opens the upload dialog for the project, and closes it', async () => {
      const { user } = renderWithApp(<Project />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Upload' }))
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
      await waitFor(() => expect(api.last('GET', '/tags')?.query.get('project_id')).toBe('proj-clearpath'))

      await user.click(dialog.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('clears the item filters once an upload went through, so that the new item is listed', async () => {
      api.post('/projects/:project_id/items', { item_id: 'I-9', project_id: 'proj-clearpath', routed_by: 'project_id', rule_id: null, document_id: 'doc-new', facts_created: [], supersedes_created: [], audit_event_id: null, duplicate: false })
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter items by type' }), 'Note')
      await screen.findByText('1 of 2')

      await user.click(screen.getByRole('button', { name: 'Upload' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fill sample' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upload' }))

      expect(await within(screen.getByRole('dialog')).findByRole('heading', { name: 'Upload processed' })).toBeInTheDocument()
      expect(api.last('POST', '/projects/:project_id/items')!.params.project_id).toBe('proj-clearpath')
      expect(screen.getByRole('combobox', { name: 'Filter items by type' })).toHaveValue('all')
      expect(await screen.findByText('2 of 2')).toBeInTheDocument()
      await waitFor(() => expect(app.refresh).toHaveBeenCalled())
    })

    it('opens the add source dialog for the project, and closes it with Escape', async () => {
      const { user } = renderWithApp(<Project />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Add source' }))
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      expect(dialog.getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
      await waitFor(() => expect(mailCalls()).toHaveLength(2))

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('opens the add source dialog from a project without sources', async () => {
      api.get('/projects/:project_id/sources', [])
      const { user } = renderWithApp(<Project />)
      await screen.findByText('No sources yet')
      await user.click(card('Sources').getByRole('button', { name: 'Add source' }))
      expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      await waitFor(() => expect(mailCalls()).toHaveLength(2))
      await screen.findByText('Routing rules to this project')
    })

    it('a viewer sees both buttons greyed out and a click only explains why', async () => {
      const { user } = renderWithApp(<Project />, VIEWER)
      await loaded()
      const upload = screen.getByRole('button', { name: 'Upload' })
      const add = screen.getByRole('button', { name: 'Add source' })
      expect(upload).toHaveAttribute('aria-disabled', 'true')
      expect(upload).toHaveAttribute('data-tip', 'Requires editor')
      expect(add).toHaveAttribute('aria-disabled', 'true')
      expect(add).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(upload)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      await user.click(add)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('an editor can upload but not add a source', async () => {
      const { user } = renderWithApp(<Project />, EDITOR)
      await loaded()
      expect(screen.getByRole('button', { name: 'Upload' })).not.toHaveAttribute('aria-disabled')
      expect(screen.getByRole('button', { name: 'Add source' })).toHaveAttribute('aria-disabled', 'true')

      await user.click(screen.getByRole('button', { name: 'Add source' }))
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Upload' }))
      expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/tags')).toHaveLength(1))
      await waitFor(() => expect(api.callsTo('GET', '/topics')).toHaveLength(1))
    })
  })

  describe('received items', () => {
    const itemRow = (title: string) => card('Received items').getByRole('button', { name: new RegExp(title) })

    it('names the source an item came from', async () => {
      renderWithApp(<Project />)
      await loaded()
      expect(within(itemRow('Steering committee')).getByText('ClearPath documents')).toBeInTheDocument()
      expect(within(itemRow('Budget note')).getByText('Manual upload')).toBeInTheDocument()
    })

    it('opens an item on click', async () => {
      const { user } = renderWithApp(<Project />)
      await loaded()
      await user.click(itemRow('Budget note'))
      expect(itemRow('Budget note')).toHaveAttribute('aria-expanded', 'true')
      expect(await card('Received items').findByText('Received')).toBeInTheDocument()
      expect(api.last('GET', '/items/:item_id')!.params.item_id).toBe('I-2')
    })

    it('from a recent item of a source: clears the filters, opens the item below and scrolls to it', async () => {
      const { user } = renderWithApp(<Project />)
      await loaded()
      // Filter the items so that the meeting is not listed.
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter items by type' }), 'Note')
      await screen.findByText('1 of 2')
      expect(card('Received items').queryByText('Steering committee')).not.toBeInTheDocument()

      await user.click(screen.getByText('src-clearpath-docs'))
      await user.click(await card('Sources').findByRole('button', { name: /Steering committee/ }))

      expect(screen.getByRole('combobox', { name: 'Filter items by type' })).toHaveValue('all')
      expect(await screen.findByText('2 of 2')).toBeInTheDocument()
      expect(itemRow('Steering committee')).toHaveAttribute('aria-expanded', 'true')
      expect(await card('Received items').findByText('Received')).toBeInTheDocument()
      expect(location.hash).toBe('')

      const scroll = vi.mocked(Element.prototype.scrollIntoView)
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }))
      expect(scroll.mock.contexts[0]).toBe(document.getElementById('item-I-1'))
    })
  })

  describe('members', () => {
    const line = (name: string) => within(card('Members').getByText(name).closest('li')!)

    it('lists who is on the project, with role and where the role comes from', async () => {
      api.get('/projects/:project_id/members', [
        projectMember(),
        projectMember({ member_id: 'mem-sara', role: 'admin', inherited: false }),
        projectMember({ member_id: 'mem-new', role: 'viewer', inherited: true }),
        projectMember({ member_id: 'mem-gone', role: 'editor', inherited: false }),
      ])
      api.get('/org/members', { items: [...Object.values(MEMBERS), member({ id: 'mem-new', name: 'Elena Bassi', email: 'elena@meridianlabs.org', org_role: 'viewer', status: 'invited' })], total: 5 })
      renderWithApp(<Project />)
      await loaded()

      expect(line('Giulia Ferri').getByText('giulia@meridianlabs.org')).toBeInTheDocument()
      expect(line('Giulia Ferri').getByText('owner')).toBeInTheDocument()
      expect(line('Giulia Ferri').getByText('inherited')).toHaveClass('badge')

      expect(line('Sara Conti').getByText('admin')).toBeInTheDocument()
      expect(line('Sara Conti').getByText('project role')).toHaveClass('badge', 'line')

      expect(line('Elena Bassi').getByText('elena@meridianlabs.org · invited')).toBeInTheDocument()
      expect(line('Elena Bassi').getByText('viewer')).toBeInTheDocument()

      // Not a member of the organisation any more: the id stands in for the name.
      expect(line('mem-gone').getByText('editor')).toBeInTheDocument()
      expect(card('Members').getAllByRole('listitem')).toHaveLength(4)
    })

    it('accepts the project members wrapped in { items } and the organisation members as a bare array', async () => {
      api.get('/projects/:project_id/members', { items: [projectMember({ member_id: 'mem-marco', role: 'admin' })] })
      api.get('/org/members', Object.values(MEMBERS))
      renderWithApp(<Project />)
      expect(await card('Members').findByText('Marco Fiore')).toBeInTheDocument()
      expect(card('Members').getByText('marco@meridianlabs.org')).toBeInTheDocument()
      await screen.findByText('Routing rules to this project')
    })

    it('says when the project has no members', async () => {
      api.get('/projects/:project_id/members', [])
      renderWithApp(<Project />)
      expect(await card('Members').findByText('No members yet')).toBeInTheDocument()
      expect(card('Members').queryByRole('listitem')).not.toBeInTheDocument()
      await screen.findByText('Routing rules to this project')
    })

    it('shows nothing while loading', async () => {
      const gate = deferred()
      api.get('/org/members', () => gate.promise)
      renderWithApp(<Project />)
      await screen.findByText('Routing rules to this project')
      expect(card('Members').queryByText('No members yet')).not.toBeInTheDocument()
      expect(card('Members').queryByRole('listitem')).not.toBeInTheDocument()

      gate.resolve({ items: Object.values(MEMBERS), total: 4 })
      expect(await card('Members').findByText('Giulia Ferri')).toBeInTheDocument()
    })

    it.each(['/projects/:project_id/members', '/org/members'])('shows the error when %s fails and loads again on retry', async (path) => {
      api.get(path, fail(500, 'directory offline'))
      const { user } = renderWithApp(<Project />)
      expect(await card('Members').findByText('Could not load this. directory offline')).toBeInTheDocument()
      // The rest of the page is there.
      expect(await screen.findByText('Routing rules to this project')).toBeInTheDocument()

      api.get(path, path === '/org/members' ? { items: Object.values(MEMBERS) } : [projectMember()])
      await user.click(card('Members').getByRole('button', { name: 'Try again' }))
      expect(await card('Members').findByText('Giulia Ferri')).toBeInTheDocument()
    })
  })

  describe('mail', () => {
    const mail = () => card('Mail')
    const putCalls = () => api.callsTo('PUT', '/projects/:project_id/mail')

    it('shows the organisation mailbox the project inherits, and the rules that route to it', async () => {
      api.get('/org/mail/rules', { items: [mailRule(), mailRule({ id: 'rule-2', value: '@internal.org', project_id: 'proj-internal' }), mailRule({ id: 'rule-3', value: '@acme.io' })] })
      renderWithApp(<Project />)
      await loaded()
      expect(mail().getByText('Inherited')).toHaveClass('badge')
      expect(dd(mail(), 'Mode')).toHaveTextContent('IMAP mailbox')
      expect(dd(mail(), 'Inbound')).toHaveTextContent('brain@inbound.meridianlabs.org')
      expect(dd(mail(), 'Set on')).toHaveTextContent('Meridian Labs')
      expect(mail().getByRole('button', { name: 'Override for this project' })).toBeEnabled()
      expect(mail().queryByRole('button', { name: 'Revert to organisation' })).not.toBeInTheDocument()

      const rules = mail().getAllByRole('listitem')
      expect(rules.map((li) => li.textContent)).toEqual(['@clearpath.comClearPath engagement', '@acme.ioClearPath engagement'])
      expect(mail().queryByText('@internal.org')).not.toBeInTheDocument()
    })

    it('shows the own mailbox of a project that overrides', async () => {
      api.get('/projects/:project_id/mail', projectMail({ overridden: true, effective_mail_config: mailConfig({ mode: 'webhook', inbound_address: 'clearpath@inbound.meridianlabs.org' }) }))
      renderWithApp(<Project />)
      await loaded()
      expect(mail().getByText('Overridden')).toHaveClass('badge', 'line')
      expect(dd(mail(), 'Mode')).toHaveTextContent('Inbound webhook')
      expect(dd(mail(), 'Inbound')).toHaveTextContent('clearpath@inbound.meridianlabs.org')
      expect(dd(mail(), 'Set on')).toHaveTextContent('This project')
      expect(mail().getByRole('button', { name: 'Revert to organisation' })).toBeEnabled()
      expect(mail().queryByRole('button', { name: 'Override for this project' })).not.toBeInTheDocument()
    })

    it('shows a dash for a mailbox without an inbound address', async () => {
      api.get('/projects/:project_id/mail', projectMail({ effective_mail_config: mailConfig({ inbound_address: null }) }))
      renderWithApp(<Project />)
      await loaded()
      expect(dd(mail(), 'Inbound')).toHaveTextContent('—')
    })

    it('says when no rule routes to the project', async () => {
      api.get('/org/mail/rules', [mailRule({ project_id: 'proj-internal' })])
      renderWithApp(<Project />)
      expect(await mail().findByText('None. Emails reach this project only through its own inbound address.')).toBeInTheDocument()
      expect(mail().queryByRole('listitem')).not.toBeInTheDocument()
      await loaded()
    })

    it('accepts the rules as a bare array', async () => {
      api.get('/org/mail/rules', [mailRule({ value: '@bare.org' })])
      renderWithApp(<Project />)
      expect(await mail().findByText('@bare.org')).toBeInTheDocument()
      await loaded()
    })

    it('still shows the mailbox when the rules cannot be loaded', async () => {
      api.get('/org/mail/rules', fail(403, 'Requires admin'))
      renderWithApp(<Project />)
      expect(await mail().findByText('None. Emails reach this project only through its own inbound address.')).toBeInTheDocument()
      expect(dd(mail(), 'Inbound')).toHaveTextContent('brain@inbound.meridianlabs.org')
      expect(mail().queryByText('Something went wrong')).not.toBeInTheDocument()
      await loaded()
    })

    it('shows nothing while loading', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/mail', () => gate.promise)
      renderWithApp(<Project />)
      await screen.findByText('giulia@meridianlabs.org')
      expect(mail().queryByText('Inherited')).not.toBeInTheDocument()
      expect(mail().queryByRole('button')).not.toBeInTheDocument()

      gate.resolve(projectMail())
      expect(await mail().findByText('Inherited')).toBeInTheDocument()
    })

    it('shows the error and loads again on retry', async () => {
      api.get('/projects/:project_id/mail', fail(500, 'mail service offline'))
      const { user } = renderWithApp(<Project />)
      expect(await mail().findByText('Could not load this. mail service offline')).toBeInTheDocument()
      expect(mail().queryByText('Inherited')).not.toBeInTheDocument()

      api.get('/projects/:project_id/mail', projectMail())
      await user.click(mail().getByRole('button', { name: 'Try again' }))
      expect(await mail().findByText('Inherited')).toBeInTheDocument()
    })

    it('overrides with an address named after the project on the domain of the organisation', async () => {
      api.put('/projects/:project_id/mail', () => {
        api.get('/projects/:project_id/mail', projectMail({ overridden: true, effective_mail_config: mailConfig({ inbound_address: 'clearpath@inbound.meridianlabs.org' }) }))
        return projectMail({ overridden: true })
      })
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.click(mail().getByRole('button', { name: 'Override for this project' }))

      expect(await screen.findByText('This project now has its own inbound address.')).toBeInTheDocument()
      expect(putCalls()).toHaveLength(1)
      expect(putCalls()[0].params.project_id).toBe('proj-clearpath')
      expect(putCalls()[0].body).toEqual({ mode: 'imap_mock', imap_host: 'imap.meridianlabs.org', imap_user: 'brain', inbound_address: 'clearpath@inbound.meridianlabs.org', poll_interval_s: 30 })
      // The card loads again and shows the new state.
      expect(await mail().findByText('Overridden')).toBeInTheDocument()
      expect(dd(mail(), 'Inbound')).toHaveTextContent('clearpath@inbound.meridianlabs.org')
      expect(await mail().findByRole('button', { name: 'Revert to organisation' })).toBeEnabled()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.unhandled).toEqual([])
    })

    it('falls back to the Canonico domain and a one minute poll when the organisation mailbox says neither', async () => {
      goto('projects/proj-internal')
      const bare = { mode: 'webhook' } as Schemas['MailConfig']
      api.get('/projects/:project_id/mail', projectMail({ project_id: 'proj-internal', effective_mail_config: bare }))
      api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
      const { user, app } = renderWithApp(<Project />)
      await loaded('Internal')
      await user.click(mail().getByRole('button', { name: 'Override for this project' }))

      expect(await screen.findByText('This project now has its own inbound address.')).toBeInTheDocument()
      expect(putCalls()[0].params.project_id).toBe('proj-internal')
      expect(putCalls()[0].body).toEqual({ mode: 'webhook', imap_host: null, imap_user: null, inbound_address: 'internal@inbound.canonico.app', poll_interval_s: 60 })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('disables the button while the override is being saved', async () => {
      const gate = deferred()
      api.put('/projects/:project_id/mail', () => gate.promise)
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.click(mail().getByRole('button', { name: 'Override for this project' }))
      await waitFor(() => expect(mail().getByRole('button', { name: 'Override for this project' })).toBeDisabled())

      gate.resolve(projectMail({ overridden: true }))
      await waitFor(() => expect(mail().getByRole('button', { name: 'Override for this project' })).toBeEnabled())
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(putCalls()).toHaveLength(1)
    })

    it('says why when the override is refused, and changes nothing', async () => {
      api.put('/projects/:project_id/mail', fail(409, 'Address already in use'))
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.click(mail().getByRole('button', { name: 'Override for this project' }))

      expect(await screen.findByText('That did not work. Address already in use')).toBeInTheDocument()
      await waitFor(() => expect(mail().getByRole('button', { name: 'Override for this project' })).toBeEnabled())
      expect(mail().getByText('Inherited')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(mailCalls()).toHaveLength(1)
    })

    it('reverts to the organisation mailbox', async () => {
      api.get('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.delete('/projects/:project_id/mail', () => {
        api.get('/projects/:project_id/mail', projectMail())
        return projectMail()
      })
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.click(mail().getByRole('button', { name: 'Revert to organisation' }))

      expect(await screen.findByText('This project uses the organisation mailbox again.')).toBeInTheDocument()
      expect(api.callsTo('DELETE', '/projects/:project_id/mail')).toHaveLength(1)
      expect(api.last('DELETE', '/projects/:project_id/mail')!.params.project_id).toBe('proj-clearpath')
      expect(await mail().findByText('Inherited')).toBeInTheDocument()
      expect(await mail().findByRole('button', { name: 'Override for this project' })).toBeEnabled()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('says why when the revert is refused', async () => {
      api.get('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.delete('/projects/:project_id/mail', fail(500, 'mail service offline'))
      const { user, app } = renderWithApp(<Project />)
      await loaded()
      await user.click(mail().getByRole('button', { name: 'Revert to organisation' }))

      expect(await screen.findByText('That did not work. mail service offline')).toBeInTheDocument()
      await waitFor(() => expect(mail().getByRole('button', { name: 'Revert to organisation' })).toBeEnabled())
      expect(mail().getByText('Overridden')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it.each([
      ['Override for this project', false],
      ['Revert to organisation', true],
    ])('an editor sees "%s" greyed out and a click only explains why', async (name, overridden) => {
      api.get('/projects/:project_id/mail', projectMail({ overridden }))
      api.put('/projects/:project_id/mail', projectMail())
      api.delete('/projects/:project_id/mail', projectMail())
      const { user } = renderWithApp(<Project />, EDITOR)
      await loaded()
      const button = mail().getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(button)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(putCalls()).toHaveLength(0)
      expect(api.callsTo('DELETE', '/projects/:project_id/mail')).toHaveLength(0)
    })
  })

  describe('answers', () => {
    it('counts the answers given in the project', async () => {
      renderWithApp(<Project />)
      await loaded()
      expect(card('Answers').getByText('Binding').closest('li')).toHaveTextContent(/^Binding6$/)
      expect(card('Answers').getByText('Contested').closest('li')).toHaveTextContent(/^Contested3$/)
      expect(card('Answers').getByText('No answer').closest('li')).toHaveTextContent(/^No answer1$/)
    })

    it('shows no figures when the stats cannot be loaded', async () => {
      api.get('/stats', fail(500, 'stats offline'))
      renderWithApp(<Project />)
      await screen.findByText('Routing rules to this project')
      await screen.findByText('giulia@meridianlabs.org')
      await screen.findByText('2 of 2')
      expect(card('Answers').queryByText('Binding')).not.toBeInTheDocument()
    })

    it('shows the error with a retry instead of a placeholder when the stats cannot be loaded, and the figures on retry', async () => {
      api.get('/stats', fail(500, 'stats offline'))
      const { user } = renderWithApp(<Project />)
      expect(await card('Answers').findByText('Could not load this. stats offline')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Answers' }).closest('.card')!.querySelector('.skel')).not.toBeInTheDocument()

      api.get('/stats', stats({ answers: { binding: 6, contested: 3, no_answer: 1 } }))
      await user.click(card('Answers').getByRole('button', { name: 'Try again' }))
      expect(await card('Answers').findByText('Binding')).toBeInTheDocument()
      expect(card('Answers').queryByText('Could not load this. stats offline')).not.toBeInTheDocument()
    })
  })
})
