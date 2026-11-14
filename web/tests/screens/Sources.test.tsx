import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import { I18nProvider } from '../../src/i18n'
import { AppContext, type AppState } from '../../src/lib/appContext'
import Sources from '../../src/screens/Sources'
import { setTopbarSlot } from '../../src/shell/topbarSlot'
import { api, deferred, fail } from '../helpers/api'
import { me, MEMBERS, source } from '../helpers/fixtures'
import { mailConfig, mailRule, message, projectMail } from '../helpers/home'
import { makeApp, renderWithApp } from '../helpers/render'

type Source = Schemas['Source']

const DOCS = source({ last_synced_at: '2026-11-10T09:12:00Z' })
const LIB = source({ id: 'src-library', type: 'document_library', label: 'Policy library', status: 'idle', last_synced_at: null, items: 3 })
const GH = source({ id: 'src-github', type: 'github', label: 'acme/handbook', status: 'error', items: 12, last_synced_at: '2026-11-14T08:05:00Z' })
const MAIL = source({ id: 'src-mail', type: 'mail', label: 'ClearPath mailbox', status: 'syncing', items: undefined, last_synced_at: undefined })
const HOOK = source({ id: 'src-hook', type: 'webhook', label: 'Meeting recorder', items: 7, last_synced_at: '2026-11-13T17:40:00Z' })
const RULES = [
  mailRule({ id: 'rule-1', value: '@clearpath.com', project_id: 'proj-clearpath', priority: 20 }),
  mailRule({ id: 'rule-2', value: '@meridianlabs.org', project_id: 'proj-internal', priority: 5 }),
  mailRule({ id: 'rule-3', value: '@oldclient.com', project_id: 'proj-archived', priority: 100 }),
]
const EDITOR = { me: me({ as: MEMBERS.sara }) }
const NOW = new Date('2026-11-14T12:00:00Z')

/** The screen under a top bar, where its primary action goes. */
const renderSources = (over: Partial<AppState> = {}) =>
  renderWithApp(
    <>
      <div role="toolbar" ref={setTopbarSlot} />
      <Sources />
    </>,
    over,
  )

const card = (title: string) => within(screen.getByRole('heading', { name: title }).closest<HTMLElement>('.card')!)
const sourcesCard = () => card('Connected sources')
const mailCard = () => card('Mail settings')
const rulesCard = () => card('Routing rules')
const messagesCard = () => card('Last emails routed here')
const dialog = () => within(screen.getByRole('dialog'))
const dd = (scope: ReturnType<typeof within>, term: string) => scope.getByText(term, { selector: 'dt' }).nextElementSibling!
const sourceRow = (s: Source) => sourcesCard().getByText(s.id).closest('tr')!
/** Status, items and last sync of a source row. */
const cells = (s: Source) =>
  within(sourceRow(s))
    .getAllByRole('cell')
    .slice(1, 4)
    .map((c) => c.textContent!.replace(/\s+/g, ' ').trim())
const ruleRows = () =>
  rulesCard()
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent)
const ruleRow = (value: string) => within(rulesCard().getByText(value).closest('tr')!)
const paramOf = (path: string) => api.last('GET', path)!.params.project_id

beforeEach(() => {
  // The messages show the time alone for today: pin today.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  api.get('/projects/:project_id/sources', [DOCS])
  api.get('/projects/:project_id/mail', projectMail())
  api.get('/org/mail/rules', { items: RULES, total: RULES.length })
  api.get('/projects/:project_id/messages', { items: [message()], total: 1, limit: 50, offset: 0 })
})

/** The four cards have their data. */
async function loaded() {
  await sourcesCard().findByText('ClearPath documents')
  await mailCard().findByText('Inherited')
  await rulesCard().findByText('@clearpath.com')
  await messagesCard().findByText('anna@clearpath.com')
}

describe('Sources', () => {
  describe('page', () => {
    it('is about the current project and asks everything for it', async () => {
      renderSources()
      await loaded()
      expect(screen.getByRole('heading', { name: 'Sources', level: 1 })).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement. What Canonico reads, how mail reaches it, and how emails are routed.')).toBeInTheDocument()
      for (const path of ['/projects/:project_id/sources', '/projects/:project_id/mail', '/projects/:project_id/messages']) expect(paramOf(path)).toBe('proj-clearpath')
      expect(api.callsTo('GET', '/org/mail/rules')).toHaveLength(1)
      expect(screen.getByText(/^Real mail, SharePoint and Google Drive connectors are coming soon/)).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('follows the project the app is on', async () => {
      renderSources({ projectId: 'proj-internal' })
      await loaded()
      expect(screen.getByText(/^Internal\. What Canonico reads/)).toBeInTheDocument()
      for (const path of ['/projects/:project_id/sources', '/projects/:project_id/mail', '/projects/:project_id/messages']) expect(paramOf(path)).toBe('proj-internal')
    })

    it('switches project from the selector', async () => {
      const { user, app } = renderSources()
      await loaded()
      const select = screen.getByRole('combobox', { name: 'Project' })
      expect(select).toHaveValue('proj-clearpath')
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['ClearPath engagement', 'Internal'])

      await user.selectOptions(select, 'Internal')
      expect(app.setProjectId).toHaveBeenCalledWith('proj-internal')
    })
  })

  describe('adding a source', () => {
    it('puts Add source in the top bar, which opens the dialog for the project', async () => {
      const { user } = renderSources()
      await loaded()
      await user.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Add source' }))
      expect(dialog().getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      expect(dialog().getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/mail')).toHaveLength(2))

      await user.click(dialog().getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('opens the same dialog from the card', async () => {
      const { user } = renderSources()
      await loaded()
      await user.click(sourcesCard().getByRole('button', { name: 'Add source' }))
      expect(dialog().getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/mail')).toHaveLength(2))

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('has only the button of the card when there is no top bar', async () => {
      renderWithApp(<Sources />)
      await loaded()
      expect(screen.getAllByRole('button', { name: 'Add source' })).toHaveLength(1)
    })

    it('an editor sees both buttons greyed out and they open nothing', async () => {
      const { user } = renderSources(EDITOR)
      await loaded()
      const buttons = screen.getAllByRole('button', { name: 'Add source' })
      expect(buttons).toHaveLength(2)
      for (const b of buttons) {
        expect(b).toHaveAttribute('aria-disabled', 'true')
        expect(b).toHaveAttribute('data-tip', 'Requires admin')
        await user.click(b)
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('connected sources', () => {
    it('lists every source with status, items in its own unit and last sync', async () => {
      api.get('/projects/:project_id/sources', [DOCS, LIB, GH, MAIL, HOOK])
      renderSources()
      await loaded()
      expect(cells(DOCS)).toEqual(['Synced', '46 documents', '10 Nov, 09:12'])
      expect(cells(LIB)).toEqual(['Idle', '3 versions', 'never'])
      expect(cells(GH)).toEqual(['Failed', '12 issues', '14 Nov, 08:05'])
      expect(cells(MAIL)).toEqual(['Syncing…', '0 emails', 'never'])
      expect(cells(HOOK)).toEqual(['Synced', '7 items', '13 Nov, 17:40'])
      expect(within(sourceRow(GH)).getByText('Failed')).toHaveClass('text-destructive')
      expect(within(sourceRow(DOCS)).getByText('Synced')).not.toHaveClass('text-destructive')
      expect(within(sourceRow(DOCS)).getByText('ClearPath documents')).toBeInTheDocument()
    })

    it('offers Sync on every source but a webhook', async () => {
      api.get('/projects/:project_id/sources', [DOCS, LIB, GH, MAIL, HOOK])
      renderSources()
      await loaded()
      for (const s of [DOCS, LIB, GH, MAIL]) expect(within(sourceRow(s)).getByRole('button', { name: 'Sync' })).toBeEnabled()
      expect(within(sourceRow(HOOK)).queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
    })

    it('accepts the sources wrapped in { items }', async () => {
      api.get('/projects/:project_id/sources', { items: [LIB] })
      renderSources()
      expect(await sourcesCard().findByText('Policy library')).toBeInTheDocument()
      await mailCard().findByText('Inherited')
    })

    it.each([[[]], [{ items: [] }], [{}]])('says when the project has no sources (%j)', async (answer) => {
      api.get('/projects/:project_id/sources', answer)
      renderSources()
      expect(await sourcesCard().findByText('No sources yet')).toBeInTheDocument()
      expect(sourcesCard().getByText(/^Connect documents, a document library/)).toBeInTheDocument()
      expect(sourcesCard().queryByRole('table')).not.toBeInTheDocument()
      await mailCard().findByText('Inherited')
    })

    it('shows neither the table nor the empty state while loading', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/sources', () => gate.promise)
      renderSources()
      await mailCard().findByText('Inherited')
      expect(sourcesCard().queryByRole('table')).not.toBeInTheDocument()
      expect(sourcesCard().queryByText('No sources yet')).not.toBeInTheDocument()

      gate.resolve([DOCS])
      expect(await sourcesCard().findByText('ClearPath documents')).toBeInTheDocument()
    })

    it('shows the error and loads again on retry', async () => {
      api.get('/projects/:project_id/sources', fail(500, 'database is locked'))
      const { user } = renderSources()
      expect(await sourcesCard().findByText(/Could not load this\. database is locked/)).toBeInTheDocument()
      expect(sourcesCard().queryByRole('table')).not.toBeInTheDocument()

      api.get('/projects/:project_id/sources', [DOCS])
      await user.click(sourcesCard().getByRole('button', { name: 'Try again' }))
      expect(await sourcesCard().findByText('ClearPath documents')).toBeInTheDocument()
      expect(sourcesCard().queryByText(/Could not load this/)).not.toBeInTheDocument()
    })

    it('starts a sync and refreshes the app', async () => {
      api.post('/sources/:source_id/sync', { id: 'job-1', source_id: DOCS.id, status: 'queued' })
      const { user, app } = renderSources()
      await loaded()
      await user.click(within(sourceRow(DOCS)).getByRole('button', { name: 'Sync' }))

      expect(await screen.findByText('Sync started')).toBeInTheDocument()
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(1)
      expect(api.last('POST', '/sources/:source_id/sync')!.params.source_id).toBe('src-clearpath-docs')
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      // It does not wait for the job.
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(0)
    })

    it('says why when the sync cannot start', async () => {
      api.post('/sources/:source_id/sync', fail(409, 'A sync is already running'))
      const { user, app } = renderSources()
      await loaded()
      await user.click(within(sourceRow(DOCS)).getByRole('button', { name: 'Sync' }))

      expect(await screen.findByText('A sync is already running')).toBeInTheDocument()
      expect(screen.queryByText('Sync started')).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('an editor sees Sync greyed out and it sends nothing', async () => {
      api.post('/sources/:source_id/sync', {})
      const { user } = renderSources(EDITOR)
      await loaded()
      const sync = within(sourceRow(DOCS)).getByRole('button', { name: 'Sync' })
      expect(sync).toHaveAttribute('aria-disabled', 'true')
      expect(sync).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(sync)
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(0)
    })
  })

  describe('mail settings', () => {
    const putCalls = () => api.callsTo('PUT', '/projects/:project_id/mail')
    const override = () => mailCard().getByRole('button', { name: 'Override for this project' })

    it('shows the settings inherited from the organisation', async () => {
      renderSources()
      await loaded()
      expect(mailCard().getByText('Inherited')).toHaveClass('badge')
      expect(mailCard().getByText('Set on Meridian Labs and inherited by every project unless overridden.')).toBeInTheDocument()
      expect(dd(mailCard(), 'Mode')).toHaveTextContent('IMAP mailbox')
      expect(dd(mailCard(), 'IMAP host')).toHaveTextContent('imap.meridianlabs.org')
      expect(dd(mailCard(), 'Inbound')).toHaveTextContent('brain@inbound.meridianlabs.org')
      expect(dd(mailCard(), 'Set on')).toHaveTextContent('Meridian Labs')
      expect(override()).toBeEnabled()
      expect(mailCard().queryByRole('button', { name: 'Revert to organisation' })).not.toBeInTheDocument()
    })

    it('shows the own settings of a project that overrides, without a host when there is none', async () => {
      api.get('/projects/:project_id/mail', projectMail({ overridden: true, effective_mail_config: mailConfig({ mode: 'webhook', imap_host: null, inbound_address: 'clearpath@inbound.meridianlabs.org' }) }))
      renderSources()
      expect(await mailCard().findByText('Overridden')).toHaveClass('badge', 'line')
      expect(mailCard().getByText('This project uses its own mail configuration.')).toBeInTheDocument()
      expect(dd(mailCard(), 'Mode')).toHaveTextContent('Inbound webhook')
      expect(mailCard().queryByText('IMAP host')).not.toBeInTheDocument()
      expect(dd(mailCard(), 'Inbound')).toHaveTextContent('clearpath@inbound.meridianlabs.org')
      expect(dd(mailCard(), 'Set on')).toHaveTextContent('This project')
      expect(mailCard().getByRole('button', { name: 'Revert to organisation' })).toBeEnabled()
      expect(mailCard().queryByRole('button', { name: 'Override for this project' })).not.toBeInTheDocument()
      await rulesCard().findByText('@clearpath.com')
    })

    it('shows nothing while loading', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/mail', () => gate.promise)
      renderSources()
      await rulesCard().findByText('@clearpath.com')
      expect(mailCard().queryByText('Inherited')).not.toBeInTheDocument()
      expect(mailCard().queryByRole('button')).not.toBeInTheDocument()

      gate.resolve(projectMail())
      expect(await mailCard().findByText('Inherited')).toBeInTheDocument()
    })

    it('shows the error', async () => {
      api.get('/projects/:project_id/mail', fail(500, 'mail service offline'))
      renderSources()
      expect(await mailCard().findByText('Could not load this. mail service offline')).toBeInTheDocument()
      expect(mailCard().queryByRole('button')).not.toBeInTheDocument()
      await rulesCard().findByText('@clearpath.com')
    })

    describe('override', () => {
      it('asks for the inbound address of the project, starting from the inherited one', async () => {
        const { user } = renderSources()
        await loaded()
        await user.click(override())
        expect(dialog().getByRole('heading', { name: 'Override mail for this project' })).toBeInTheDocument()
        expect(dialog().getByText('Give this project its own inbound address. Everything else stays as set on the organisation.')).toBeInTheDocument()
        const input = dialog().getByRole('textbox', { name: 'Inbound address' })
        expect(input).toHaveValue('brain@inbound.meridianlabs.org')
        expect(input).toHaveFocus()
      })

      it('saves the address with the rest of the inherited settings, then refreshes and closes', async () => {
        api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
        const { user, app } = renderSources()
        await loaded()
        await user.click(override())
        const input = dialog().getByRole('textbox', { name: 'Inbound address' })
        await user.clear(input)
        await user.type(input, '  clearpath@inbound.meridianlabs.org ')
        await user.click(dialog().getByRole('button', { name: 'Save' }))

        expect(await screen.findByText('This project now has its own mail settings')).toBeInTheDocument()
        expect(putCalls()).toHaveLength(1)
        expect(putCalls()[0].params.project_id).toBe('proj-clearpath')
        expect(putCalls()[0].body).toEqual({ mode: 'imap_mock', imap_host: 'imap.meridianlabs.org', imap_user: 'brain', inbound_address: 'clearpath@inbound.meridianlabs.org', poll_interval_s: 30 })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(app.refresh).toHaveBeenCalledTimes(1)
      })

      it('sends null for the host and the user the organisation does not set', async () => {
        api.get('/projects/:project_id/mail', projectMail({ effective_mail_config: { mode: 'webhook', inbound_address: null, poll_interval_s: 120 } }))
        api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
        const { user } = renderSources()
        await loaded()
        await user.click(override())
        const input = dialog().getByRole('textbox', { name: 'Inbound address' })
        expect(input).toHaveValue('')
        await user.type(input, 'internal@inbound.meridianlabs.org')
        await user.click(dialog().getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(putCalls()[0].body).toEqual({ mode: 'webhook', imap_host: null, imap_user: null, inbound_address: 'internal@inbound.meridianlabs.org', poll_interval_s: 120 })
      })

      it.each(['', 'not an address', 'brain@inbound', 'brain@@inbound.org', 'two words@inbound.org'])('refuses "%s" as an address and sends nothing', async (value) => {
        api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
        const { user, app } = renderSources()
        await loaded()
        await user.click(override())
        const input = dialog().getByRole('textbox', { name: 'Inbound address' })
        await user.clear(input)
        if (value) await user.type(input, value)
        expect(input).not.toHaveClass('invalid')
        await user.click(dialog().getByRole('button', { name: 'Save' }))

        expect(dialog().getByText('Enter a valid email address.')).toBeInTheDocument()
        expect(input).toHaveClass('invalid')
        expect(putCalls()).toHaveLength(0)
        expect(app.refresh).not.toHaveBeenCalled()
      })

      it('says why when the backend refuses, and stays open', async () => {
        api.put('/projects/:project_id/mail', fail(409, 'Address already in use'))
        const { user, app } = renderSources()
        await loaded()
        await user.click(override())
        await user.click(dialog().getByRole('button', { name: 'Save' }))

        expect(await screen.findByText('Address already in use')).toBeInTheDocument()
        expect(dialog().getByRole('textbox', { name: 'Inbound address' })).toHaveValue('brain@inbound.meridianlabs.org')
        expect(app.refresh).not.toHaveBeenCalled()
      })

      it.each(['Cancel', 'Close'])('%s closes the dialog without saving', async (name) => {
        api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
        const { user } = renderSources()
        await loaded()
        await user.click(override())
        await user.click(dialog().getByRole('button', { name }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(putCalls()).toHaveLength(0)
      })

      it('Escape closes the dialog and an edit is not kept', async () => {
        const { user } = renderSources()
        await loaded()
        await user.click(override())
        await user.type(dialog().getByRole('textbox', { name: 'Inbound address' }), '.changed')
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        await user.click(override())
        expect(dialog().getByRole('textbox', { name: 'Inbound address' })).toHaveValue('brain@inbound.meridianlabs.org')
      })

      it('an editor sees the button greyed out and it opens nothing', async () => {
        const { user } = renderSources(EDITOR)
        await loaded()
        expect(override()).toHaveAttribute('aria-disabled', 'true')
        expect(override()).toHaveAttribute('data-tip', 'Requires admin')
        await user.click(override())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    describe('revert', () => {
      const revert = () => mailCard().getByRole('button', { name: 'Revert to organisation' })

      beforeEach(() => {
        api.get('/projects/:project_id/mail', projectMail({ overridden: true }))
      })

      it('removes the override and refreshes the app', async () => {
        api.delete('/projects/:project_id/mail', projectMail())
        const { user, app } = renderSources()
        await mailCard().findByText('Overridden')
        await user.click(revert())

        expect(await screen.findByText('This project now uses the organisation mail settings')).toBeInTheDocument()
        expect(api.callsTo('DELETE', '/projects/:project_id/mail')).toHaveLength(1)
        expect(api.last('DELETE', '/projects/:project_id/mail')!.params.project_id).toBe('proj-clearpath')
        await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      })

      it('says why when the backend refuses', async () => {
        api.delete('/projects/:project_id/mail', fail(500, 'mail service offline'))
        const { user, app } = renderSources()
        await mailCard().findByText('Overridden')
        await user.click(revert())

        expect(await screen.findByText('mail service offline')).toBeInTheDocument()
        expect(app.refresh).not.toHaveBeenCalled()
        expect(mailCard().getByText('Overridden')).toBeInTheDocument()
      })

      it('an editor sees the button greyed out and it sends nothing', async () => {
        api.delete('/projects/:project_id/mail', projectMail())
        const { user } = renderSources(EDITOR)
        await mailCard().findByText('Overridden')
        expect(revert()).toHaveAttribute('aria-disabled', 'true')
        expect(revert()).toHaveAttribute('data-tip', 'Requires admin')
        await user.click(revert())
        expect(api.callsTo('DELETE', '/projects/:project_id/mail')).toHaveLength(0)
      })
    })
  })

  describe('routing rules', () => {
    it('lists the rules of the organisation, lowest priority first, with the project they route to', async () => {
      renderSources()
      await loaded()
      expect(rulesCard().getByText('organisation-wide · first match wins')).toBeInTheDocument()
      // A project that is not in the list any more is shown by its id.
      expect(ruleRows()).toEqual(['@meridianlabs.orgInternal5', '@clearpath.comClearPath engagement20', '@oldclient.comproj-archived100'])
    })

    it('says when there are no rules', async () => {
      api.get('/org/mail/rules', { items: [], total: 0 })
      renderSources()
      expect(await rulesCard().findByText('No routing rules. Emails stay in the organisation inbox.')).toBeInTheDocument()
      expect(rulesCard().queryByRole('button', { name: 'Remove rule' })).not.toBeInTheDocument()
      await mailCard().findByText('Inherited')
    })

    it('shows the error instead of "no rules" when the rules cannot be loaded, and loads them again on retry', async () => {
      api.get('/org/mail/rules', fail(500, 'database is locked'))
      const { user } = renderSources()
      expect(await rulesCard().findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(rulesCard().queryByText('No routing rules. Emails stay in the organisation inbox.')).not.toBeInTheDocument()
      expect(rulesCard().queryByRole('table')).not.toBeInTheDocument()

      api.get('/org/mail/rules', { items: RULES, total: RULES.length })
      await user.click(rulesCard().getByRole('button', { name: 'Try again' }))
      expect(await rulesCard().findByText('@clearpath.com')).toBeInTheDocument()
      expect(rulesCard().queryByText('Could not load this. database is locked')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/org/mail/rules')).toHaveLength(2)
    })

    it('shows no table while loading', async () => {
      const gate = deferred()
      api.get('/org/mail/rules', () => gate.promise)
      renderSources()
      await mailCard().findByText('Inherited')
      expect(rulesCard().queryByRole('table')).not.toBeInTheDocument()
      expect(rulesCard().queryByText('No routing rules. Emails stay in the organisation inbox.')).not.toBeInTheDocument()

      gate.resolve({ items: RULES })
      expect(await rulesCard().findByText('@clearpath.com')).toBeInTheDocument()
    })

    describe('removing a rule', () => {
      it('deletes it and refreshes the app', async () => {
        api.delete('/org/mail/rules/:rule_id', {})
        const { user, app } = renderSources()
        await loaded()
        await user.click(ruleRow('@meridianlabs.org').getByRole('button', { name: 'Remove rule' }))

        expect(await screen.findByText('Rule removed')).toBeInTheDocument()
        expect(api.callsTo('DELETE', '/org/mail/rules/:rule_id')).toHaveLength(1)
        expect(api.last('DELETE', '/org/mail/rules/:rule_id')!.params.rule_id).toBe('rule-2')
        await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      })

      it('says why when the backend refuses', async () => {
        api.delete('/org/mail/rules/:rule_id', fail(404, 'No such rule'))
        const { user, app } = renderSources()
        await loaded()
        await user.click(ruleRow('@clearpath.com').getByRole('button', { name: 'Remove rule' }))

        expect(await screen.findByText('No such rule')).toBeInTheDocument()
        expect(app.refresh).not.toHaveBeenCalled()
        expect(ruleRows()).toHaveLength(3)
      })

      it('an editor sees the button greyed out and it sends nothing', async () => {
        api.delete('/org/mail/rules/:rule_id', {})
        const { user } = renderSources(EDITOR)
        await loaded()
        const remove = ruleRow('@clearpath.com').getByRole('button', { name: 'Remove rule' })
        expect(remove).toHaveAttribute('aria-disabled', 'true')
        expect(remove).toHaveAttribute('data-tip', 'Requires admin')
        await user.click(remove)
        expect(api.callsTo('DELETE', '/org/mail/rules/:rule_id')).toHaveLength(0)
      })
    })

    describe('adding a rule', () => {
      const postCalls = () => api.callsTo('POST', '/org/mail/rules')
      const openDialog = async (user: ReturnType<typeof renderSources>['user']) => {
        await loaded()
        await user.click(rulesCard().getByRole('button', { name: 'Add rule' }))
        return { domain: dialog().getByRole('textbox', { name: 'Sender domain' }), project: dialog().getByRole('combobox', { name: 'Project' }), priority: dialog().getByRole('textbox', { name: 'Priority' }) }
      }
      const submit = (user: ReturnType<typeof renderSources>['user']) => user.click(dialog().getByRole('button', { name: 'Add rule' }))

      it('starts on the current project with priority 30 and the focus on the domain', async () => {
        const { user } = renderSources({ projectId: 'proj-internal' })
        const f = await openDialog(user)
        expect(dialog().getByRole('heading', { name: 'Add routing rule' })).toBeInTheDocument()
        expect(dialog().getByText('Emails from this sender domain are routed to the project. First match wins, lowest priority first.')).toBeInTheDocument()
        expect(f.domain).toHaveValue('')
        expect(f.domain).toHaveFocus()
        expect(f.domain).toHaveAttribute('placeholder', '@client.com')
        expect(f.project).toHaveValue('proj-internal')
        expect(within(f.project).getAllByRole('option').map((o) => o.textContent)).toEqual(['ClearPath engagement', 'Internal'])
        expect(f.priority).toHaveValue('30')
      })

      it('creates a sender domain rule, adding the @ when it was left out, then refreshes and closes', async () => {
        api.post('/org/mail/rules', mailRule())
        const { user, app } = renderSources()
        const f = await openDialog(user)
        await user.type(f.domain, ' newclient.co.uk ')
        await submit(user)

        expect(await screen.findByText('Rule added')).toBeInTheDocument()
        expect(postCalls()).toHaveLength(1)
        expect(postCalls()[0].body).toEqual({ match_type: 'sender_domain', value: '@newclient.co.uk', project_id: 'proj-clearpath', priority: 30 })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(app.refresh).toHaveBeenCalledTimes(1)
      })

      it('sends the chosen project and priority, and a domain typed with its @ as it is', async () => {
        api.post('/org/mail/rules', mailRule())
        const { user } = renderSources()
        const f = await openDialog(user)
        await user.type(f.domain, '@acme-group.io')
        await user.selectOptions(f.project, 'Internal')
        await user.clear(f.priority)
        await user.type(f.priority, ' 5 ')
        await submit(user)

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(postCalls()[0].body).toEqual({ match_type: 'sender_domain', value: '@acme-group.io', project_id: 'proj-internal', priority: 5 })
      })

      it.each(['', 'client', 'anna@client.com', '@client', 'client.c', 'cli ent.com'])('refuses "%s" as a sender domain and sends nothing', async (value) => {
        api.post('/org/mail/rules', mailRule())
        const { user } = renderSources()
        const f = await openDialog(user)
        if (value) await user.type(f.domain, value)
        await submit(user)

        expect(dialog().getByText('Enter a sender domain like @client.com.')).toBeInTheDocument()
        expect(f.domain).toHaveClass('invalid')
        expect(f.priority).not.toHaveClass('invalid')
        expect(dialog().queryByText('Priority must be a whole number.')).not.toBeInTheDocument()
        expect(postCalls()).toHaveLength(0)
      })

      it.each(['', 'high', '3.5', '-1'])('refuses "%s" as a priority and sends nothing', async (value) => {
        api.post('/org/mail/rules', mailRule())
        const { user } = renderSources()
        const f = await openDialog(user)
        await user.type(f.domain, '@client.com')
        await user.clear(f.priority)
        if (value) await user.type(f.priority, value)
        await submit(user)

        expect(dialog().getByText('Priority must be a whole number.')).toBeInTheDocument()
        expect(f.priority).toHaveClass('invalid')
        expect(f.domain).not.toHaveClass('invalid')
        expect(dialog().queryByText('Enter a sender domain like @client.com.')).not.toBeInTheDocument()
        expect(postCalls()).toHaveLength(0)
      })

      it('shows both errors at once and clears them when the form is sent again corrected', async () => {
        api.post('/org/mail/rules', mailRule())
        const { user } = renderSources()
        const f = await openDialog(user)
        await user.clear(f.priority)
        await submit(user)
        expect(dialog().getByText('Enter a sender domain like @client.com.')).toBeInTheDocument()
        expect(dialog().getByText('Priority must be a whole number.')).toBeInTheDocument()

        await user.type(f.domain, 'client.com')
        await user.type(f.priority, '12')
        await submit(user)
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(postCalls()[0].body).toEqual({ match_type: 'sender_domain', value: '@client.com', project_id: 'proj-clearpath', priority: 12 })
      })

      it('says why when the backend refuses, and stays open with what was typed', async () => {
        api.post('/org/mail/rules', fail(409, 'A rule for this domain exists'))
        const { user, app } = renderSources()
        const f = await openDialog(user)
        await user.type(f.domain, '@client.com')
        await submit(user)

        expect(await screen.findByText('A rule for this domain exists')).toBeInTheDocument()
        expect(dialog().getByRole('textbox', { name: 'Sender domain' })).toHaveValue('@client.com')
        expect(app.refresh).not.toHaveBeenCalled()
      })

      it('Cancel closes the dialog without creating anything', async () => {
        api.post('/org/mail/rules', mailRule())
        const { user } = renderSources()
        const f = await openDialog(user)
        await user.type(f.domain, '@client.com')
        await user.click(dialog().getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(postCalls()).toHaveLength(0)
      })

      it('an editor sees Add rule greyed out and it opens nothing', async () => {
        const { user } = renderSources(EDITOR)
        await loaded()
        const add = rulesCard().getByRole('button', { name: 'Add rule' })
        expect(add).toHaveAttribute('aria-disabled', 'true')
        expect(add).toHaveAttribute('data-tip', 'Requires admin')
        await user.click(add)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    describe('testing an email', () => {
      const testCalls = () => api.callsTo('POST', '/org/mail/rules/test')
      const from = () => rulesCard().getByRole('textbox', { name: 'Test an email' })
      const run = (user: ReturnType<typeof renderSources>['user']) => user.click(rulesCard().getByRole('button', { name: 'Test' }))

      it('starts with a sample sender and says nothing is sent', async () => {
        renderSources()
        await loaded()
        expect(from()).toHaveValue('client@meridianlabs.org')
        expect(from()).toHaveAttribute('placeholder', 'sender@company.com')
        expect(rulesCard().getByText('Checks the rules in order without sending anything.')).toBeInTheDocument()
      })

      it('sends a test email from the sender and says which rule matched and where it goes', async () => {
        api.post('/org/mail/rules/test', { matched: true, rule_id: 'rule-1', routed_project_id: 'proj-internal' })
        const { user } = renderSources()
        await loaded()
        await user.clear(from())
        await user.type(from(), ' anna@clearpath.com ')
        await run(user)

        const result = await rulesCard().findByText('Matches rule-1 and goes to Internal.')
        expect(result).not.toHaveClass('bg-warning-soft')
        expect(rulesCard().queryByText('Checks the rules in order without sending anything.')).not.toBeInTheDocument()
        expect(testCalls()).toHaveLength(1)
        expect(testCalls()[0].body).toEqual({
          message_id: `<test-${NOW.getTime()}@clearpath.com>`,
          from: 'anna@clearpath.com',
          to: ['brain@inbound.clearpath.com'],
          cc: [],
          subject: 'Test',
          date: '2026-11-14T12:00:00.000Z',
          text: 'Test',
          attachments: [],
        })
      })

      it('warns when no rule matches', async () => {
        api.post('/org/mail/rules/test', { matched: false, rule_id: null, routed_project_id: null })
        const { user } = renderSources()
        await loaded()
        await run(user)
        const result = await rulesCard().findByText('No rule matches. The email stays in the organisation inbox and creates no facts.')
        expect(result).toHaveClass('bg-warning-soft')
        expect(testCalls()[0].body).toMatchObject({ from: 'client@meridianlabs.org', to: ['brain@inbound.meridianlabs.org'] })
      })

      it('shows the id of a project it does not know', async () => {
        api.post('/org/mail/rules/test', { matched: true, rule_id: 'rule-3', routed_project_id: 'proj-archived' })
        const { user } = renderSources()
        await loaded()
        await run(user)
        expect(await rulesCard().findByText('Matches rule-3 and goes to proj-archived.')).toBeInTheDocument()
      })

      it('runs on Enter in the field, not on other keys', async () => {
        api.post('/org/mail/rules/test', { matched: false })
        const { user } = renderSources()
        await loaded()
        await user.clear(from())
        await user.type(from(), 'luca@acme.io')
        expect(testCalls()).toHaveLength(0)

        await user.keyboard('{Enter}')
        expect(await rulesCard().findByText(/^No rule matches/)).toBeInTheDocument()
        expect(testCalls()).toHaveLength(1)
        expect(testCalls()[0].body).toMatchObject({ from: 'luca@acme.io' })
      })

      it('asks for a sender instead of testing an empty field', async () => {
        api.post('/org/mail/rules/test', { matched: false })
        const { user } = renderSources()
        await loaded()
        await user.clear(from())
        await user.type(from(), '   ')
        await run(user)
        expect(rulesCard().getByText('Enter a sender address.')).toBeInTheDocument()
        expect(rulesCard().queryByText('Checks the rules in order without sending anything.')).not.toBeInTheDocument()
        expect(testCalls()).toHaveLength(0)
      })

      it('uses example.com for a sender without a domain', async () => {
        api.post('/org/mail/rules/test', { matched: false })
        const { user } = renderSources()
        await loaded()
        await user.clear(from())
        await user.type(from(), 'anna')
        await run(user)
        await rulesCard().findByText(/^No rule matches/)
        expect(testCalls()[0].body).toMatchObject({ from: 'anna', to: ['brain@inbound.example.com'], message_id: `<test-${NOW.getTime()}@example.com>` })
      })

      it('says why when the test cannot run and keeps the previous result', async () => {
        api.post('/org/mail/rules/test', { matched: true, rule_id: 'rule-1', routed_project_id: 'proj-clearpath' })
        const { user } = renderSources()
        await loaded()
        await run(user)
        await rulesCard().findByText('Matches rule-1 and goes to ClearPath engagement.')

        api.post('/org/mail/rules/test', fail(422, 'Invalid sender'))
        await run(user)
        expect(await screen.findByText('Invalid sender')).toBeInTheDocument()
        expect(rulesCard().getByText('Matches rule-1 and goes to ClearPath engagement.')).toBeInTheDocument()
      })

      it('is open to an editor too', async () => {
        api.post('/org/mail/rules/test', { matched: false })
        const { user } = renderSources(EDITOR)
        await loaded()
        expect(rulesCard().getByRole('button', { name: 'Test' })).not.toHaveAttribute('aria-disabled')
        await run(user)
        expect(await rulesCard().findByText(/^No rule matches/)).toBeInTheDocument()
      })
    })
  })

  describe('last emails routed here', () => {
    it('lists sender, subject, rule and time of each email', async () => {
      api.get('/projects/:project_id/messages', {
        items: [
          message({ message_id: '<m-2@clearpath.com>', from: 'anna@clearpath.com', subject: 'Audit turnaround', rule_id: 'rule-1', date: '2026-11-14T08:15:00Z' }),
          message({ message_id: '<m-1@acme.io>', from: 'luca@acme.io', subject: 'Kickoff agenda', rule_id: null, date: '2026-11-12T16:40:00Z' }),
        ],
        total: 2,
        limit: 50,
        offset: 0,
      })
      renderSources()
      await loaded()
      const lines = messagesCard().getAllByRole('listitem')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toHaveTextContent('anna@clearpath.com· Audit turnaround')
      expect(within(lines[0]).getByText('rule-1')).toBeInTheDocument()
      // Today: the time. Another day: date and time.
      expect(within(lines[0]).getByText('08:15')).toBeInTheDocument()
      expect(lines[1]).toHaveTextContent('luca@acme.io· Kickoff agenda')
      expect(within(lines[1]).getByText('12 Nov, 16:40')).toBeInTheDocument()
      expect(within(lines[1]).queryByText(/^rule-/)).not.toBeInTheDocument()
    })

    it('says when no email arrived', async () => {
      api.get('/projects/:project_id/messages', { items: [], total: 0, limit: 50, offset: 0 })
      renderSources()
      expect(await messagesCard().findByText('No emails yet')).toBeInTheDocument()
      expect(messagesCard().getByText(/^Emails from senders that match a rule for this project arrive here/)).toBeInTheDocument()
      await mailCard().findByText('Inherited')
    })

    it('shows neither emails nor the empty state while loading', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/messages', () => gate.promise)
      renderSources()
      await mailCard().findByText('Inherited')
      expect(messagesCard().queryByText('No emails yet')).not.toBeInTheDocument()
      expect(messagesCard().queryByRole('listitem')).not.toBeInTheDocument()

      gate.resolve({ items: [message()], total: 1, limit: 50, offset: 0 })
      expect(await messagesCard().findByText('anna@clearpath.com')).toBeInTheDocument()
    })

    it('shows the error', async () => {
      api.get('/projects/:project_id/messages', fail(500, 'mail service offline'))
      renderSources()
      expect(await messagesCard().findByText('Could not load this. mail service offline')).toBeInTheDocument()
      expect(messagesCard().queryByText('No emails yet')).not.toBeInTheDocument()
      await mailCard().findByText('Inherited')
    })
  })

  describe('after a change', () => {
    it('loads the four cards again when the data version moves', async () => {
      const page = (version: number) => (
        <I18nProvider>
          <AppContext.Provider value={makeApp({ version })}>
            <Sources />
          </AppContext.Provider>
        </I18nProvider>
      )
      const view = render(page(1))
      await loaded()
      const paths = ['/projects/:project_id/sources', '/projects/:project_id/mail', '/org/mail/rules', '/projects/:project_id/messages']
      for (const path of paths) expect(api.callsTo('GET', path)).toHaveLength(1)

      api.get('/projects/:project_id/sources', [LIB])
      api.get('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.get('/org/mail/rules', { items: [mailRule({ value: '@new-rule.com' })] })
      api.get('/projects/:project_id/messages', { items: [message({ from: 'new@sender.com' })] })
      view.rerender(page(2))

      expect(await sourcesCard().findByText('Policy library')).toBeInTheDocument()
      expect(await mailCard().findByText('Overridden')).toBeInTheDocument()
      expect(await rulesCard().findByText('@new-rule.com')).toBeInTheDocument()
      expect(await messagesCard().findByText('new@sender.com')).toBeInTheDocument()
      for (const path of paths) expect(api.callsTo('GET', path)).toHaveLength(2)
    })
  })
})
