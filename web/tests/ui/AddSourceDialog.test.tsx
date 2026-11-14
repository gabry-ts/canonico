import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import type { AppState } from '../../src/lib/appContext'
import AddSourceDialog from '../../src/ui/AddSourceDialog'
import { api, deferred, fail, offline } from '../helpers/api'
import { org, source } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'
import { LIBRARY, libraryDoc, mockLibrary, mutations, PID, pinToday, textFile, TODAY } from '../helpers/sources'

const KIND = {
  github: /^GitHub public repository/,
  library: /^Document library/,
  documents: /^Documents/,
  mail: /^Mail/,
  webhook: /^Inbound webhook/,
}

function projectMail(over: Partial<Schemas['ProjectMail']> = {}): Schemas['ProjectMail'] {
  return {
    project_id: PID,
    overridden: false,
    effective_mail_config: { mode: 'imap_mock', imap_host: 'imap.meridianlabs.org', imap_user: 'inbox', inbound_address: 'inbox@meridianlabs.org', poll_interval_s: 120 },
    mail_config_override: null,
    ...over,
  }
}

function preview(over: Partial<Schemas['GithubPreview']> = {}): Schemas['GithubPreview'] {
  return {
    repo_url: 'https://github.com/acme/handbook',
    full_name: 'acme/handbook',
    public: true,
    description: 'The company handbook',
    default_branch: 'main',
    open_issues: 3,
    has_readme: true,
    last_pushed_at: '2026-11-10T08:00:00Z',
    ...over,
  }
}

const job = (over: Partial<Schemas['SyncJob']> = {}): Schemas['SyncJob'] => ({ id: 'J-1', source_id: 'src-gh', status: 'done', ...over })

function open(over: Partial<AppState> = {}, projectId = PID) {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const view = renderWithApp(<AddSourceDialog projectId={projectId} onClose={onClose} onCreated={onCreated} />, over)
  return { ...view, onClose, onCreated }
}

/** Picks a source type on step 1 and continues to its form. */
async function configure(user: UserEvent, kind: keyof typeof KIND) {
  await user.click(screen.getByRole('button', { name: KIND[kind] }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const toast = (text: string) => screen.findByText(text, { selector: '.toast *' })
const steps = () => within(screen.getByRole('list')).getAllByRole('listitem')
const dot = (li: HTMLElement) => li.querySelector('.step-dot')!

beforeEach(() => {
  pinToday()
  api.get('/projects/:project_id/sources', [])
  api.get('/projects/:project_id/mail', projectMail())
})

describe('AddSourceDialog', () => {
  describe('choosing the type', () => {
    it('names the project and the step', () => {
      open()
      expect(screen.getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
    })

    it('shows the project id when the project is not among the ones the person sees', () => {
      open({}, 'proj-gone')
      expect(screen.getByText('proj-gone · step 1 of 3')).toBeInTheDocument()
    })

    it('offers the five source types, none picked, and the coming ones as unavailable', () => {
      open()
      for (const name of Object.values(KIND)) expect(button(name)).toHaveAttribute('aria-pressed', 'false')
      for (const soon of ['SharePoint', 'Google Drive', 'Gmail and Outlook']) {
        const tile = screen.getByText(soon).closest('.radio-card')!
        expect(tile).toHaveAttribute('aria-disabled', 'true')
        expect(tile.tagName).not.toBe('BUTTON')
        expect(within(tile as HTMLElement).getByText('Coming soon')).toBeInTheDocument()
      }
    })

    it('does not continue until a type is picked, and says why', async () => {
      const { user } = open()
      const next = button('Continue')
      expect(next).toHaveAttribute('aria-disabled', 'true')
      expect(next).toHaveAttribute('data-tip', 'Pick a source type')

      await user.click(next)
      expect(screen.getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
    })

    it('marks the picked type, one at a time, and continues to its form', async () => {
      const { user } = open()
      await user.click(button(KIND.mail))
      await user.click(button(KIND.github))
      expect(button(KIND.github)).toHaveAttribute('aria-pressed', 'true')
      expect(button(KIND.github)).toHaveClass('on')
      expect(button(KIND.mail)).toHaveAttribute('aria-pressed', 'false')
      expect(button(KIND.mail)).not.toHaveClass('on')

      const next = button('Continue')
      expect(next).not.toHaveAttribute('aria-disabled')
      expect(next).not.toHaveAttribute('data-tip')
      await user.click(next)
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Repository URL')).toBeInTheDocument()
    })

    it('shows where the person is in the three steps', async () => {
      const { user } = open()
      expect(steps().map((li) => li.textContent)).toEqual(['1Type', '2Configure', '3Sync'])
      expect(dot(steps()[0])).toHaveClass('on')
      expect(dot(steps()[1])).not.toHaveClass('on')

      await configure(user, 'github')
      expect(steps().map((li) => li.textContent)).toEqual(['Type', '2Configure', '3Sync'])
      expect(dot(steps()[0])).toHaveClass('done')
      expect(dot(steps()[0])).not.toHaveClass('on')
      expect(dot(steps()[1])).toHaveClass('on')
      expect(dot(steps()[2])).not.toHaveClass('on', 'done')
    })

    it('calls the last step Connect for a webhook', async () => {
      const { user } = open()
      await user.click(button(KIND.webhook))
      expect(steps().map((li) => li.textContent)).toEqual(['1Type', '2Configure', '3Connect'])
    })

    it('goes back to the types with the choice and the form kept', async () => {
      const { user } = open()
      await configure(user, 'github')
      await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/acme/handbook')
      await user.click(button('Back'))

      expect(screen.getByText('ClearPath engagement · step 1 of 3')).toBeInTheDocument()
      expect(button(KIND.github)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

      await user.click(button('Continue'))
      expect(screen.getByLabelText('Repository URL')).toHaveValue('https://github.com/acme/handbook')
    })

    it('closes from Cancel, from the close button and with Escape', async () => {
      const { user, onClose, onCreated } = open()
      await user.click(button('Cancel'))
      expect(onClose).toHaveBeenCalledTimes(1)
      await user.click(button('Close'))
      expect(onClose).toHaveBeenCalledTimes(2)
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(3)
      expect(onCreated).not.toHaveBeenCalled()
      expect(mutations()).toEqual([])
    })

    it('reads the sources and the mail settings of the project, and the documents of its library', async () => {
      mockLibrary()
      open()
      await waitFor(() => expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(1))
      expect(api.last('GET', '/sources/:source_id/documents')!.params.source_id).toBe('src-library')
      expect(api.last('GET', '/projects/:project_id/sources')!.params.project_id).toBe(PID)
      expect(api.last('GET', '/projects/:project_id/mail')!.params.project_id).toBe(PID)
      expect(api.unhandled).toEqual([])
    })
  })

  describe('GitHub repository', () => {
    const typeUrl = (user: UserEvent, url: string) => user.type(screen.getByLabelText('Repository URL'), url)

    async function previewed(user: UserEvent, pv = preview()) {
      api.post('/sources/github/preview', pv)
      await configure(user, 'github')
      await typeUrl(user, 'https://github.com/acme/handbook')
      await user.click(button('Preview'))
      await screen.findByText(pv.full_name)
    }

    it('wants a preview before connecting', async () => {
      const { user } = open()
      await configure(user, 'github')
      expect(screen.getByText('Public repositories only. No keys are stored.')).toBeInTheDocument()
      const connect = button('Connect and sync')
      expect(connect).toHaveAttribute('aria-disabled', 'true')
      expect(connect).toHaveAttribute('data-tip', 'Preview the repository first')

      await user.click(connect)
      expect(mutations()).toEqual([])
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
    })

    it.each(['handbook', 'https://github.com/acme', 'https://gitlab.com/acme/handbook'])('refuses "%s" without asking the backend', async (url) => {
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, url)
      await user.click(button('Preview'))

      expect(screen.getByText('Enter a URL like https://github.com/owner/repo')).toBeInTheDocument()
      expect(screen.getByLabelText('Repository URL')).toHaveClass('invalid')
      expect(screen.queryByText('Public repositories only. No keys are stored.')).not.toBeInTheDocument()
      expect(mutations()).toEqual([])
    })

    it('clears the URL error once a valid URL is previewed', async () => {
      api.post('/sources/github/preview', preview())
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, 'handbook')
      await user.click(button('Preview'))
      expect(screen.getByLabelText('Repository URL')).toHaveClass('invalid')

      await user.clear(screen.getByLabelText('Repository URL'))
      await typeUrl(user, 'github.com/acme/handbook')
      await user.click(button('Preview'))
      expect(await screen.findByText('acme/handbook')).toBeInTheDocument()
      expect(screen.queryByText('Enter a URL like https://github.com/owner/repo')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Repository URL')).not.toHaveClass('invalid')
    })

    it('asks the backend for the repository, trimmed, and shows what it found', async () => {
      api.post('/sources/github/preview', preview())
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, '  https://github.com/acme/handbook  ')
      await user.click(button('Preview'))

      expect(await screen.findByText('acme/handbook')).toBeInTheDocument()
      expect(api.last('POST', '/sources/github/preview')!.body).toEqual({ repo_url: 'https://github.com/acme/handbook' })
      expect(screen.getByText('public')).toHaveClass('badge', 'ok')
      expect(screen.getByText('The company handbook')).toBeInTheDocument()
      expect(screen.getByText('3 open issues')).toBeInTheDocument()
      expect(screen.getByText('yes')).toBeInTheDocument()
      expect(screen.getByText('main')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Issues and comments' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'README' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Pull requests' })).not.toBeChecked()
      expect(button('Connect and sync')).not.toHaveAttribute('aria-disabled')
      expect(api.unhandled).toEqual([])
    })

    it('previews when Enter is pressed in the URL field', async () => {
      api.post('/sources/github/preview', preview())
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, 'https://github.com/acme/handbook{Enter}')
      expect(await screen.findByText('acme/handbook')).toBeInTheDocument()
      expect(api.callsTo('POST', '/sources/github/preview')).toHaveLength(1)
    })

    it('shows a repository without description, without README, not public and with one issue', async () => {
      const { user } = open()
      await previewed(user, preview({ public: false, description: null, has_readme: false, open_issues: 1, default_branch: 'trunk' }))
      expect(screen.getByText('not public')).toBeInTheDocument()
      expect(screen.getByText('1 open issue')).toBeInTheDocument()
      expect(screen.getByText('no')).toBeInTheDocument()
      expect(screen.getByText('trunk')).toBeInTheDocument()
      expect(screen.queryByText('The company handbook')).not.toBeInTheDocument()
    })

    it('shows a placeholder and blocks a second preview while the first is running', async () => {
      const gate = deferred()
      api.post('/sources/github/preview', () => gate.promise)
      const { user, container } = open()
      await configure(user, 'github')
      await typeUrl(user, 'https://github.com/acme/handbook')
      await user.click(button('Preview'))

      expect(button('Preview')).toBeDisabled()
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
      expect(button('Connect and sync')).toHaveAttribute('aria-disabled', 'true')

      gate.resolve(preview())
      expect(await screen.findByText('acme/handbook')).toBeInTheDocument()
      expect(button('Preview')).toBeEnabled()
      expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    })

    it.each([
      [404, 'Repository not found'],
      [403, 'This repository is not public'],
      [422, 'This repository is not public'],
      [500, 'Could not read this repository'],
    ])('explains a %i from the preview as "%s"', async (status, title) => {
      api.post('/sources/github/preview', fail(status, 'GitHub said no'))
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, 'https://github.com/acme/handbook')
      await user.click(button('Preview'))

      expect(await screen.findByText(title)).toBeInTheDocument()
      expect(screen.getByText('GitHub said no')).toBeInTheDocument()
      expect(button('Connect and sync')).toHaveAttribute('data-tip', 'Preview the repository first')
      expect(button('Preview')).toBeEnabled()
    })

    it('says the repository could not be read when the backend is unreachable, then shows it on a new try', async () => {
      api.post('/sources/github/preview', offline)
      const { user } = open()
      await configure(user, 'github')
      await typeUrl(user, 'https://github.com/acme/handbook')
      await user.click(button('Preview'))
      expect(await screen.findByText('Could not read this repository')).toBeInTheDocument()
      expect(screen.getByText('network')).toBeInTheDocument()

      api.post('/sources/github/preview', preview())
      await user.click(button('Preview'))
      expect(await screen.findByText('acme/handbook')).toBeInTheDocument()
      expect(screen.queryByText('Could not read this repository')).not.toBeInTheDocument()
    })

    it('connects the repository as the backend named it, syncs it and reports the result', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github', label: 'acme/handbook' }))
      api.post('/sources/:source_id/sync', job({ items_added: 4, facts_created: 7 }))
      const { user, app, onClose, onCreated } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await screen.findByText('4 items added, 7 facts created.')).toBeInTheDocument()
      const sent = api.last('POST', '/projects/:project_id/sources')!
      expect(sent.params.project_id).toBe(PID)
      expect(sent.body).toEqual({ type: 'github', label: 'acme/handbook', config: { repo_url: 'https://github.com/acme/handbook', include: ['issues', 'readme'] } })
      expect(api.last('POST', '/sources/:source_id/sync')!.params.source_id).toBe('src-gh')
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(0)

      expect(screen.getByText('ClearPath engagement · step 3 of 3')).toBeInTheDocument()
      expect(screen.getByText('acme/handbook')).toBeInTheDocument()
      expect(screen.getByText('Synced')).toBeInTheDocument()
      expect(screen.getByText('The source is now listed in ClearPath engagement and in the sidebar.')).toBeInTheDocument()
      expect(dot(steps()[2])).toHaveClass('on')
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      // Once when the source exists, once when the sync has finished.
      expect(onCreated).toHaveBeenCalledTimes(2)
      expect(app.refresh).toHaveBeenCalledTimes(2)
      expect(api.unhandled).toEqual([])

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('imports only what is ticked', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', job())
      const { user } = open()
      await previewed(user)
      await user.click(screen.getByRole('checkbox', { name: 'Issues and comments' }))
      await user.click(screen.getByRole('checkbox', { name: 'Pull requests' }))
      await user.click(button('Connect and sync'))

      await screen.findByText('0 items added, 0 facts created.')
      expect((api.last('POST', '/projects/:project_id/sources')!.body as Schemas['SourceCreate']).config).toEqual({
        repo_url: 'https://github.com/acme/handbook',
        include: ['readme', 'pulls'],
      })
    })

    it('follows the sync job until it finishes', async () => {
      const start = deferred()
      const lastPoll = deferred()
      let polls = 0
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', () => start.promise)
      api.get('/sync-jobs/:job_id', () => (++polls === 1 ? job({ status: 'running' }) : lastPoll.promise))
      const { user, app, onCreated, container } = open()
      const bar = () => container.querySelector<HTMLElement>('.bar i')!
      await previewed(user)
      await user.click(button('Connect and sync'))

      // The source exists, the sync has not answered yet.
      expect(await screen.findByText('Queued')).toBeInTheDocument()
      expect(bar()).toHaveStyle({ width: '10%' })
      expect(button('Syncing…')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
      expect(screen.queryByText(/The source is now listed/)).not.toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)

      start.resolve(job({ status: 'queued' }))
      await waitFor(() => expect(bar()).toHaveStyle({ width: '20%' }))
      expect(screen.getByText('Queued')).toBeInTheDocument()

      await waitFor(() => expect(bar()).toHaveStyle({ width: '30%' }), { timeout: 3000 })
      expect(screen.getByText('Syncing…', { selector: 'div' })).toBeInTheDocument()
      expect(api.last('GET', '/sync-jobs/:job_id')!.params.job_id).toBe('J-1')

      await waitFor(() => expect(polls).toBe(2), { timeout: 3000 })
      lastPoll.resolve(job({ status: 'done', items_added: 12, facts_created: 30 }))
      expect(await screen.findByText('12 items added, 30 facts created.')).toBeInTheDocument()
      expect(screen.getByText('Synced')).toBeInTheDocument()
      expect(bar()).toHaveStyle({ width: '100%' })
      expect(button('Done')).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(2)
      expect(app.refresh).toHaveBeenCalledTimes(2)
    })

    it('says when the sync failed', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', job({ status: 'error' }))
      const { user } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await screen.findByText('The sync failed. You can try again from the sources table.')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.queryByText(/items added/)).not.toBeInTheDocument()
      expect(button('Done')).toBeInTheDocument()
    })

    it('says why when the sync cannot start, the source being already added', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', fail(503, 'The sync queue is full'))
      const { user, app, onCreated } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await toast('That did not work. The sync queue is full')).toBeInTheDocument()
      expect(api.callsTo('POST', '/projects/:project_id/sources')).toHaveLength(1)
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/items added/)).not.toBeInTheDocument()
    })

    it('shows the sync as failed and lets the person close when the sync cannot start', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', fail(500, 'Internal error'))
      const { user, app, onClose, onCreated, container } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await toast('That did not work. Internal error')).toBeInTheDocument()
      expect(await screen.findByText('The sync failed. You can try again from the sources table.')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(screen.queryByText('Queued')).not.toBeInTheDocument()
      expect(container.querySelector<HTMLElement>('.bar i')).toHaveStyle({ width: '100%' })
      expect(screen.queryByRole('button', { name: 'Syncing…' })).not.toBeInTheDocument()
      // The source exists: the list was refreshed.
      expect(onCreated).toHaveBeenCalled()
      expect(app.refresh).toHaveBeenCalled()

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows the sync as failed and lets the person close when following the job fails', async () => {
      api.post('/projects/:project_id/sources', source({ id: 'src-gh', type: 'github' }))
      api.post('/sources/:source_id/sync', job({ status: 'running' }))
      api.get('/sync-jobs/:job_id', fail(500, 'Internal error'))
      const { user, onClose } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await toast('That did not work. Internal error')).toBeInTheDocument()
      expect(await screen.findByText('The sync failed. You can try again from the sources table.')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(1)
      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('stays on the form and says why when the source cannot be created', async () => {
      api.post('/projects/:project_id/sources', fail(409, 'This repository is already connected'))
      const { user, app, onCreated } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))

      expect(await toast('That did not work. This repository is already connected')).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(0)
      expect(onCreated).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button('Connect and sync')).not.toHaveAttribute('aria-disabled'))
    })

    it('sends one request however many times Connect is clicked while it is working', async () => {
      const gate = deferred()
      api.post('/projects/:project_id/sources', () => gate.promise)
      api.post('/sources/:source_id/sync', job())
      const { user } = open()
      await previewed(user)
      await user.click(button('Connect and sync'))
      expect(button('Connect and sync')).toHaveAttribute('aria-disabled', 'true')
      await user.click(button('Connect and sync'))
      expect(api.callsTo('POST', '/projects/:project_id/sources')).toHaveLength(1)

      gate.resolve(source({ id: 'src-gh', type: 'github' }))
      expect(await screen.findByText('0 items added, 0 facts created.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/projects/:project_id/sources')).toHaveLength(1)
    })
  })

  describe('document library', () => {
    const created = (over: Partial<Schemas['Document']> = {}): Schemas['DocumentCreated'] => ({ document: libraryDoc({ id: 'doc-handbook', title: 'Handbook', ...over }), ingest_job: null })
    const versioned = (over: Partial<Schemas['DocumentVersionResult']> = {}): Schemas['DocumentVersionResult'] => ({
      version: { document_id: 'doc-report', version: 3, version_label: 'v3' },
      facts_created: ['M-301', 'M-302'],
      supersedes_created: [{ fact_id: 'M-301', supersedes: 'M-106' }],
      ...over,
    })

    it('offers a new document and each document of the library with its current version', async () => {
      mockLibrary([libraryDoc(), libraryDoc({ id: 'doc-brief', title: 'Project brief', current_version: null, version: 4 }), { id: 'doc-bare', title: 'Notes' }])
      const { user } = open()
      await configure(user, 'library')
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      expect(within(screen.getByLabelText('Document')).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'New document',
        'Final report · v2 current',
        'Project brief · v4 current',
        'Notes · v1 current',
      ])
      expect(screen.getByLabelText('Document')).toHaveValue('new')
      expect(screen.getByLabelText('Title')).toBeInTheDocument()
      expect(screen.queryByLabelText('Version label')).not.toBeInTheDocument()
    })

    it('accepts the documents as an { items } answer', async () => {
      api.get('/projects/:project_id/sources', { items: [LIBRARY] })
      api.get('/sources/:source_id/documents', { items: [libraryDoc()] })
      const { user } = open()
      await configure(user, 'library')
      expect(await screen.findByRole('option', { name: 'Final report · v2 current' })).toBeInTheDocument()
    })

    it('offers only a new document when the project has no library, without asking for its documents', async () => {
      api.get('/projects/:project_id/sources', [source()])
      const { user } = open()
      await configure(user, 'library')
      expect(within(screen.getByLabelText('Document')).getAllByRole('option')).toHaveLength(1)
      expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('wants a text, typed or from a file', async () => {
      const { user } = open()
      await configure(user, 'library')
      await user.type(screen.getByLabelText('Title'), 'Handbook')
      await user.type(screen.getByLabelText('Text'), '   ')
      await user.click(button('Upload and sync'))

      expect(screen.getByText('Choose a file or paste the text.')).toBeInTheDocument()
      expect(mutations()).toEqual([])
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(button('Upload and sync')).not.toHaveAttribute('aria-disabled')
    })

    it('wants a title for a new document', async () => {
      const { user } = open()
      await configure(user, 'library')
      await user.type(screen.getByLabelText('Text'), 'Onboarding takes four weeks.')
      await user.click(button('Upload and sync'))

      expect(screen.getByText('Give the document a title.')).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveClass('invalid')
      expect(screen.queryByText('Choose a file or paste the text.')).not.toBeInTheDocument()
      expect(mutations()).toEqual([])
    })

    it('adds a pasted text as a new Markdown document of the project', async () => {
      api.post('/documents', created())
      const { user, app, onClose, onCreated } = open()
      await configure(user, 'library')
      await user.type(screen.getByLabelText('Text'), 'Onboarding takes four weeks.')
      await user.type(screen.getByLabelText('Title'), '  Handbook  ')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('Document doc-handbook added. Facts are being extracted.')).toBeInTheDocument()
      expect(mutations()).toEqual(['POST /documents'])
      expect(api.last('POST', '/documents')!.body).toEqual({ title: 'Handbook', date: TODAY, format: 'markdown', text: 'Onboarding takes four weeks.', ingest: true, project_id: PID })
      expect(screen.getByText('ClearPath engagement · step 3 of 3')).toBeInTheDocument()
      expect(screen.getByText('Handbook')).toBeInTheDocument()
      expect(screen.getByText('Uploaded')).toBeInTheDocument()
      expect(screen.getByText('The source is now listed in ClearPath engagement and in the sidebar.')).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('takes the text and the title from a chosen file', async () => {
      api.post('/documents', created())
      const { user } = open()
      await configure(user, 'library')
      await user.upload(screen.getByLabelText(/Choose a file/), textFile('Team handbook.md', '# Handbook\nFour weeks.', 'text/markdown'))

      await waitFor(() => expect(screen.getByLabelText('Text')).toHaveValue('# Handbook\nFour weeks.'))
      expect(screen.getByLabelText('Title')).toHaveValue('Team handbook')
      expect(screen.getByText('Team handbook.md')).toBeInTheDocument()
      expect(screen.getByText('click to change')).toBeInTheDocument()
      expect(screen.queryByText('Choose a file')).not.toBeInTheDocument()

      await user.click(button('Upload and sync'))
      await screen.findByText('Document doc-handbook added. Facts are being extracted.')
      expect(api.last('POST', '/documents')!.body).toMatchObject({ title: 'Team handbook', text: '# Handbook\nFour weeks.', format: 'markdown' })
    })

    it('keeps a title already typed and drops the error when a file is chosen', async () => {
      const { user } = open()
      await configure(user, 'library')
      await user.type(screen.getByLabelText('Title'), 'My title')
      await user.click(button('Upload and sync'))
      expect(screen.getByText('Choose a file or paste the text.')).toBeInTheDocument()

      await user.upload(screen.getByLabelText(/Choose a file/), textFile('handbook.txt', 'Four weeks.'))
      await waitFor(() => expect(screen.getByLabelText('Text')).toHaveValue('Four weeks.'))
      expect(screen.getByLabelText('Title')).toHaveValue('My title')
      expect(screen.queryByText('Choose a file or paste the text.')).not.toBeInTheDocument()
    })

    it('keeps the chosen file when the file picker is closed without choosing', async () => {
      const { user } = open()
      await configure(user, 'library')
      await user.upload(screen.getByLabelText(/Choose a file/), textFile('handbook.txt', 'Four weeks.'))
      await screen.findByText('handbook.txt')
      fireEvent.change(screen.getByLabelText(/click to change/), { target: { files: [] } })

      expect(screen.getByText('handbook.txt')).toBeInTheDocument()
      expect(screen.getByLabelText('Text')).toHaveValue('Four weeks.')
    })

    it('proposes the next version label for an existing document and explains what a new version does', async () => {
      mockLibrary([libraryDoc(), { id: 'doc-bare', title: 'Notes' }])
      const { user } = open()
      await configure(user, 'library')
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText('Document'), 'doc-report')

      expect(screen.getByLabelText('Version label')).toHaveValue('v3')
      expect(screen.getByText(/^The new version of Final report supersedes the facts it restates/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Document'), 'doc-bare')
      expect(screen.getByLabelText('Version label')).toHaveValue('v2')

      await user.selectOptions(screen.getByLabelText('Document'), 'new')
      expect(screen.queryByLabelText('Version label')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toBeInTheDocument()
    })

    it('uploads a new version of the chosen document and reports what it changed', async () => {
      mockLibrary([libraryDoc({ id: '07-documents/report-final' })])
      api.post('/documents/:doc_id/versions', versioned())
      const { user, app, onCreated } = open()
      await configure(user, 'library')
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText('Document'), '07-documents/report-final')
      await user.type(screen.getByLabelText('Text'), 'Onboarding now takes five weeks.')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('Version v3 uploaded: 2 new facts, 1 superseded.')).toBeInTheDocument()
      const sent = api.last('POST', '/documents/:doc_id/versions')!
      expect(sent.params.doc_id).toBe('07-documents/report-final')
      expect(sent.body).toEqual({ version_label: 'v3', text: 'Onboarding now takes five weeks.', date: TODAY })
      expect(mutations()).toHaveLength(1)
      expect(screen.getByText('Final report')).toBeInTheDocument()
      expect(screen.getByText('Uploaded')).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('sends no label when it is left empty and names the version by its number', async () => {
      mockLibrary()
      api.post('/documents/:doc_id/versions', versioned({ version: { document_id: 'doc-report', version: 3, version_label: null }, facts_created: [], supersedes_created: [] }))
      const { user } = open()
      await configure(user, 'library')
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText('Document'), 'doc-report')
      await user.clear(screen.getByLabelText('Version label'))
      await user.type(screen.getByLabelText('Text'), 'Same as before.')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('Version v3 uploaded: 0 new facts, 0 superseded.')).toBeInTheDocument()
      expect(api.last('POST', '/documents/:doc_id/versions')!.body).toEqual({ text: 'Same as before.', date: TODAY })
    })

    it('does not want a title for a new version', async () => {
      mockLibrary()
      api.post('/documents/:doc_id/versions', versioned())
      const { user } = open()
      await configure(user, 'library')
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText('Document'), 'doc-report')
      await user.click(button('Upload and sync'))
      expect(screen.getByText('Choose a file or paste the text.')).toBeInTheDocument()
      expect(mutations()).toEqual([])

      await user.type(screen.getByLabelText('Text'), 'Five weeks.')
      await user.click(button('Upload and sync'))
      expect(await screen.findByText(/^Version v3 uploaded/)).toBeInTheDocument()
    })

    it('stays on the form and says why when the upload is refused', async () => {
      const gate = deferred()
      api.post('/documents', () => gate.promise)
      const { user, app, onCreated } = open()
      await configure(user, 'library')
      await user.type(screen.getByLabelText('Text'), 'Four weeks.')
      await user.type(screen.getByLabelText('Title'), 'Handbook')
      await user.click(button('Upload and sync'))
      expect(button('Upload and sync')).toHaveAttribute('aria-disabled', 'true')

      gate.resolve(fail(413, 'The document is too large'))
      expect(await toast('That did not work. The document is too large')).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Handbook')
      expect(onCreated).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button('Upload and sync')).not.toHaveAttribute('aria-disabled'))
    })
  })

  describe('documents', () => {
    const created = (): Schemas['DocumentCreated'] => ({ document: libraryDoc(), ingest_job: null })
    const picker = () => screen.getByLabelText(/Choose one or more files|click to change/)
    const documentBodies = () => api.callsTo('POST', '/documents').map((c) => c.body)

    it('wants at least one file', async () => {
      const { user } = open()
      await configure(user, 'documents')
      expect(screen.getByText('Each file becomes a document of this project. Facts are extracted in the background.')).toBeInTheDocument()
      await user.click(button('Upload and sync'))

      expect(screen.getByText('Choose at least one file.')).toBeInTheDocument()
      expect(mutations()).toEqual([])
    })

    it('shows the name of one chosen file and the number of several', async () => {
      const { user } = open()
      await configure(user, 'documents')
      expect(picker()).toHaveAttribute('multiple')
      await user.click(button('Upload and sync'))

      await user.upload(picker(), textFile('notes.txt', 'One.'))
      expect(await screen.findByText('notes.txt')).toBeInTheDocument()
      expect(screen.getByText('click to change')).toBeInTheDocument()
      expect(screen.queryByText('Choose at least one file.')).not.toBeInTheDocument()

      await user.upload(picker(), [textFile('a.txt', 'A.'), textFile('b.txt', 'B.'), textFile('c.txt', 'C.')])
      expect(await screen.findByText('3 files')).toBeInTheDocument()
      expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    })

    it('creates the Documents source, then one document per file, Markdown or text by its extension', async () => {
      api.post('/projects/:project_id/sources', source())
      api.post('/documents', created())
      const { user, app, onClose, onCreated } = open()
      await configure(user, 'documents')
      await user.upload(picker(), [textFile('notes.txt', 'Plain notes.'), textFile('Plan.MD', '# Plan', 'text/markdown'), textFile('spec.v2.markdown', '# Spec', 'text/markdown')])
      await screen.findByText('3 files')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('3 documents added. Facts are being extracted.')).toBeInTheDocument()
      expect(mutations()).toEqual([`POST /projects/${PID}/sources`, 'POST /documents', 'POST /documents', 'POST /documents'])
      expect(api.last('POST', '/projects/:project_id/sources')!.body).toEqual({ type: 'documents', label: 'Documents' })
      expect(documentBodies()).toEqual([
        { title: 'notes', date: TODAY, format: 'text', text: 'Plain notes.', ingest: true, project_id: PID },
        { title: 'Plan', date: TODAY, format: 'markdown', text: '# Plan', ingest: true, project_id: PID },
        { title: 'spec.v2', date: TODAY, format: 'markdown', text: '# Spec', ingest: true, project_id: PID },
      ])
      expect(screen.getByText('ClearPath engagement · step 3 of 3')).toBeInTheDocument()
      expect(screen.getByText('Documents')).toBeInTheDocument()
      expect(screen.getByText('Uploaded')).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('uses the Documents source the project already has', async () => {
      api.get('/projects/:project_id/sources', { items: [source({ type: 'documents' })] })
      api.post('/documents', created())
      const { user } = open()
      await configure(user, 'documents')
      await user.upload(picker(), textFile('notes.txt', 'Plain notes.'))
      await screen.findByText('notes.txt')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('1 document added. Facts are being extracted.')).toBeInTheDocument()
      expect(mutations()).toEqual(['POST /documents'])
    })

    it('leaves out the files that have no text', async () => {
      api.post('/projects/:project_id/sources', source())
      api.post('/documents', created())
      const { user } = open()
      await configure(user, 'documents')
      await user.upload(picker(), [textFile('blank.txt', '  \n'), textFile('notes.txt', 'Plain notes.')])
      await screen.findByText('2 files')
      await user.click(button('Upload and sync'))

      expect(await screen.findByText('1 document added. Facts are being extracted.')).toBeInTheDocument()
      expect(documentBodies()).toHaveLength(1)
      expect(documentBodies()[0]).toMatchObject({ title: 'notes' })
    })

    it('takes twenty files at most', async () => {
      const { user } = open()
      await configure(user, 'documents')
      await user.upload(
        picker(),
        Array.from({ length: 22 }, (_, i) => textFile(`file-${i}.txt`, `Text ${i}`)),
      )
      expect(await screen.findByText('20 files')).toBeInTheDocument()
    })

    it('stops at the file the backend refuses and says why', async () => {
      api.post('/projects/:project_id/sources', source())
      api.post('/documents', (req) => ((req.body as Schemas['DocumentCreate']).title === 'b' ? fail(500, 'extraction is down') : created()))
      const { user, app, onCreated } = open()
      await configure(user, 'documents')
      await user.upload(picker(), [textFile('a.txt', 'A.'), textFile('b.txt', 'B.'), textFile('c.txt', 'C.')])
      await screen.findByText('3 files')
      await user.click(button('Upload and sync'))

      expect(await toast('That did not work. extraction is down')).toBeInTheDocument()
      expect(documentBodies()).toHaveLength(2)
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(screen.getByText('3 files')).toBeInTheDocument()
      expect(onCreated).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button('Upload and sync')).not.toHaveAttribute('aria-disabled'))
    })
  })

  describe('mail', () => {
    const mailSource = { type: 'mail', label: 'ClearPath engagement mailbox', config: { mode: 'imap_mock', mailbox: 'inbox@meridianlabs.org' } }

    /** Opens the mail form once the mail settings of the project are on screen. */
    async function mailForm(over: Partial<AppState> = {}) {
      const view = open(over)
      await configure(view.user, 'mail')
      await screen.findByText('inbox@meridianlabs.org')
      return view
    }

    it('starts on the organisation mailbox and shows its address', async () => {
      await mailForm()
      const inherit = button(/^Use the organisation mailbox/)
      expect(inherit).toHaveAttribute('aria-pressed', 'true')
      expect(inherit).toHaveClass('on')
      expect(within(inherit).getByText('inbox@meridianlabs.org')).toBeInTheDocument()
      expect(button(/^Own address for this project/)).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByLabelText('Inbound address')).not.toBeInTheDocument()
      expect(screen.getByText('Adds an organisation rule: sender → ClearPath engagement. Leave empty to skip.')).toBeInTheDocument()
    })

    it('prefers the address in the organisation settings to the one the project reports', async () => {
      const { user } = open({ org: org({ mail_config: { mode: 'webhook', inbound_address: 'hello@meridian.example', poll_interval_s: 60 } }) })
      await configure(user, 'mail')
      expect(within(button(/^Use the organisation mailbox/)).getByText('hello@meridian.example')).toBeInTheDocument()
    })

    it('adds a mail source on the organisation mailbox and changes nothing else', async () => {
      api.post('/projects/:project_id/sources', source({ type: 'mail' }))
      const { user, app, onClose, onCreated } = await mailForm()
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(mutations()).toEqual([`POST /projects/${PID}/sources`])
      expect(api.last('POST', '/projects/:project_id/sources')!.body).toEqual(mailSource)
      expect(screen.getByText('ClearPath engagement · step 3 of 3')).toBeInTheDocument()
      expect(screen.getByText('inbox@meridianlabs.org')).toBeInTheDocument()
      expect(screen.getByText('Saved')).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('sends nothing when the project already has a mail source on the organisation mailbox', async () => {
      api.get('/projects/:project_id/sources', [source({ id: 'src-mail', type: 'mail' })])
      const { user, onCreated } = await mailForm()
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(mutations()).toEqual([])
      expect(onCreated).toHaveBeenCalledTimes(1)
    })

    it('removes the override of a project that goes back to the organisation mailbox', async () => {
      api.get('/projects/:project_id/sources', [source({ id: 'src-mail', type: 'mail' })])
      api.get('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.delete('/projects/:project_id/mail', projectMail())
      const { user } = await mailForm()
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(mutations()).toEqual([`DELETE /projects/${PID}/mail`])
    })

    it('proposes an address for the project on the domain of the organisation mailbox', async () => {
      const { user } = await mailForm()
      await user.click(button(/^Own address for this project/))

      expect(button(/^Own address for this project/)).toHaveAttribute('aria-pressed', 'true')
      expect(button(/^Use the organisation mailbox/)).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByLabelText('Inbound address')).toHaveValue('clearpath@meridianlabs.org')
    })

    it('proposes an address on the Canonico domain when no mailbox is known', async () => {
      api.get('/projects/:project_id/mail', fail(500, 'mail is down'))
      const { user } = open()
      await configure(user, 'mail')
      await user.click(button(/^Own address for this project/))
      expect(screen.getByLabelText('Inbound address')).toHaveValue('clearpath@inbound.canonico.app')
    })

    it('keeps the address the person typed when they switch back and forth', async () => {
      const { user } = await mailForm()
      await user.click(button(/^Own address for this project/))
      await user.clear(screen.getByLabelText('Inbound address'))
      await user.type(screen.getByLabelText('Inbound address'), 'cp@meridianlabs.org')
      await user.click(button(/^Use the organisation mailbox/))
      expect(screen.queryByLabelText('Inbound address')).not.toBeInTheDocument()

      await user.click(button(/^Own address for this project/))
      expect(screen.getByLabelText('Inbound address')).toHaveValue('cp@meridianlabs.org')
    })

    it('refuses an own address that is not an email address', async () => {
      const { user } = await mailForm()
      await user.click(button(/^Own address for this project/))
      await user.clear(screen.getByLabelText('Inbound address'))
      await user.type(screen.getByLabelText('Inbound address'), 'clearpath')
      await user.click(button('Save mailbox'))

      expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
      expect(screen.getByLabelText('Inbound address')).toHaveClass('invalid')
      expect(mutations()).toEqual([])
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(button('Save mailbox')).not.toHaveAttribute('aria-disabled')
    })

    it('gives the project its own address, keeping the rest of the mail settings, and points the source at it', async () => {
      api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.post('/projects/:project_id/sources', source({ type: 'mail' }))
      const { user } = await mailForm()
      await user.click(button(/^Own address for this project/))
      await user.clear(screen.getByLabelText('Inbound address'))
      await user.type(screen.getByLabelText('Inbound address'), ' cp@meridianlabs.org ')
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(mutations()).toEqual([`PUT /projects/${PID}/mail`, `POST /projects/${PID}/sources`])
      expect(api.last('PUT', '/projects/:project_id/mail')!.body).toEqual({
        mode: 'imap_mock',
        imap_host: 'imap.meridianlabs.org',
        imap_user: 'inbox',
        inbound_address: 'cp@meridianlabs.org',
        poll_interval_s: 120,
      })
      expect(api.last('POST', '/projects/:project_id/sources')!.body).toEqual({ ...mailSource, config: { mode: 'imap_mock', mailbox: 'cp@meridianlabs.org' } })
      expect(screen.getByText('cp@meridianlabs.org')).toBeInTheDocument()
    })

    it('fills in default mail settings when the ones of the project could not be read', async () => {
      api.get('/projects/:project_id/mail', fail(500, 'mail is down'))
      api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
      api.post('/projects/:project_id/sources', source({ type: 'mail' }))
      const { user } = open()
      await configure(user, 'mail')
      await user.click(button(/^Own address for this project/))
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(api.last('PUT', '/projects/:project_id/mail')!.body).toEqual({
        mode: 'webhook',
        imap_host: null,
        imap_user: null,
        inbound_address: 'clearpath@inbound.canonico.app',
        poll_interval_s: 60,
      })
    })

    it('sends no IMAP settings when the organisation has none', async () => {
      api.get('/projects/:project_id/sources', [source({ id: 'src-mail', type: 'mail' })])
      api.get('/projects/:project_id/mail', projectMail({ effective_mail_config: { mode: 'webhook', inbound_address: 'inbox@meridianlabs.org', poll_interval_s: 30 } }))
      api.put('/projects/:project_id/mail', projectMail({ overridden: true }))
      const { user } = await mailForm()
      await user.click(button(/^Own address for this project/))
      await user.click(button('Save mailbox'))

      expect(await screen.findByText('Mailbox saved.')).toBeInTheDocument()
      expect(mutations()).toEqual([`PUT /projects/${PID}/mail`])
      expect(api.last('PUT', '/projects/:project_id/mail')!.body).toEqual({
        mode: 'webhook',
        imap_host: null,
        imap_user: null,
        inbound_address: 'clearpath@meridianlabs.org',
        poll_interval_s: 30,
      })
    })

    it.each([
      ['@client.com', 'sender_domain'],
      ['anna@client.com', 'sender_address'],
    ])('routes emails from "%s" to the project with a %s rule', async (value, matchType) => {
      api.get('/projects/:project_id/sources', [source({ id: 'src-mail', type: 'mail' })])
      api.post('/org/mail/rules', { id: 'MR-1', match_type: matchType, value, project_id: PID, priority: 100 })
      const { user } = await mailForm()
      await user.type(screen.getByLabelText('Route emails from'), `  ${value} `)
      await user.click(button('Save mailbox'))

      expect(await screen.findByText(`Mailbox saved. Emails from ${value} now go to this project.`)).toBeInTheDocument()
      expect(mutations()).toEqual(['POST /org/mail/rules'])
      expect(api.last('POST', '/org/mail/rules')!.body).toEqual({ match_type: matchType, value, project_id: PID, priority: 100 })
    })

    it('stays on the form and says why when the mail settings are refused', async () => {
      api.put('/projects/:project_id/mail', fail(403, 'Requires admin'))
      const { user, app, onCreated } = await mailForm()
      await user.click(button(/^Own address for this project/))
      await user.type(screen.getByLabelText('Route emails from'), '@client.com')
      await user.click(button('Save mailbox'))

      expect(await toast('That did not work. Requires admin')).toBeInTheDocument()
      expect(mutations()).toEqual([`PUT /projects/${PID}/mail`])
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Route emails from')).toHaveValue('@client.com')
      expect(onCreated).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button('Save mailbox')).not.toHaveAttribute('aria-disabled'))
    })
  })

  describe('inbound webhook', () => {
    const hook = (over: Partial<Schemas['Source']> = {}): Schemas['Source'] =>
      source({
        id: 'src-hook',
        type: 'webhook',
        label: 'Meeting recorder',
        secret: 'whsec_test_9f2a',
        config: { url: 'http://api.test/projects/proj-clearpath/items', secret_last4: '9f2a', default_tags: ['meeting', 'topic:onboarding-target'] },
        ...over,
      })
    const copyFields = () => screen.getAllByLabelText('Value to copy').map((el) => (el as HTMLInputElement).value)
    const addTag = (user: UserEvent, keys: string) => user.type(screen.getByRole('textbox', { name: 'Add tag' }), keys)

    it('wants a name', async () => {
      const { user } = open()
      await configure(user, 'webhook')
      expect(screen.getByText('A secret is created with the webhook. It is shown once, then only its last 4 characters.')).toBeInTheDocument()
      await user.type(screen.getByLabelText('Name'), '   ')
      await user.click(button('Create webhook'))

      expect(screen.getByText('Give the webhook a name.')).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveClass('invalid')
      expect(mutations()).toEqual([])
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
    })

    it('creates the webhook with its default tags and shows the URL, the secret once and an example request', async () => {
      api.post('/projects/:project_id/sources', hook())
      const { user, app, onClose, onCreated } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), '  Meeting recorder ')
      await addTag(user, 'Meeting{Enter}topic:onboarding-target,')
      expect(button('Remove tag meeting')).toBeInTheDocument()
      await user.click(button('Create webhook'))

      expect(await screen.findByText('Webhook created for ClearPath engagement')).toBeInTheDocument()
      expect(mutations()).toEqual([`POST /projects/${PID}/sources`])
      expect(api.last('POST', '/projects/:project_id/sources')!.body).toEqual({
        type: 'webhook',
        label: 'Meeting recorder',
        config: { default_tags: ['meeting', 'topic:onboarding-target'] },
      })
      expect(screen.getByText('ClearPath engagement · step 3 of 3')).toBeInTheDocument()
      expect(dot(steps()[2])).toHaveClass('on')
      expect(copyFields()).toEqual(['http://api.test/projects/proj-clearpath/items', 'whsec_test_9f2a'])
      expect(screen.getByText('Shown once. Afterwards only the last 4 characters are visible: 9f2a.')).toBeInTheDocument()

      const example = screen.getByText(/^curl -X POST/).textContent
      expect(example).toContain('curl -X POST http://api.test/projects/proj-clearpath/items')
      expect(example).toContain('X-Canonico-Token: whsec_test_9f2a')
      expect(example).toContain(`"date": "${TODAY}T10:00:00Z"`)
      expect(example).toContain('"tags": ["meeting", "topic:onboarding-target"]')

      const tags = within(screen.getByText('Default tags').parentElement!)
      expect(tags.getByText('meeting')).toHaveClass('tag')
      expect(tags.getByText('topic:onboarding-target')).toHaveClass('tag', 'topic')
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('creates a webhook without tags and says there are none', async () => {
      api.post('/projects/:project_id/sources', hook({ config: { url: 'http://api.test/hook', secret_last4: '9f2a', default_tags: [] } }))
      const { user } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), 'Recorder')
      await user.click(button('Create webhook'))

      await screen.findByText('Webhook created for ClearPath engagement')
      expect((api.last('POST', '/projects/:project_id/sources')!.body as Schemas['SourceCreate']).config).toEqual({ default_tags: [] })
      expect(within(screen.getByText('Default tags').parentElement!).getByText('None')).toBeInTheDocument()
      expect(screen.getByText(/^curl -X POST/).textContent).toContain('"tags": []')
    })

    it('asks for a secret when the created webhook came back without one', async () => {
      // An answer without `default_tags` is outside the schema; the dialog copes with it.
      api.post('/projects/:project_id/sources', hook({ secret: undefined, config: { url: 'http://api.test/hook', secret_last4: '0000' } as Schemas['Source']['config'] }))
      api.post('/sources/:source_id/rotate-secret', { secret: 'whsec_test_rotated_7c1d', secret_last4: '7c1d', rotated_at: '2026-11-14T10:00:00Z' })
      const { user } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), 'Recorder')
      await addTag(user, 'notes{Enter}')
      await user.click(button('Create webhook'))

      await screen.findByText('Webhook created for ClearPath engagement')
      expect(mutations()).toEqual([`POST /projects/${PID}/sources`, 'POST /sources/src-hook/rotate-secret'])
      expect(copyFields()).toEqual(['http://api.test/hook', 'whsec_test_rotated_7c1d'])
      expect(screen.getByText('Shown once. Afterwards only the last 4 characters are visible: 7c1d.')).toBeInTheDocument()
      // The answer carried no default tags: the ones typed are shown.
      expect(within(screen.getByText('Default tags').parentElement!).getByText('notes')).toBeInTheDocument()
    })

    it('creates the webhook once and says where to get a secret when none could be made', async () => {
      api.post('/projects/:project_id/sources', hook({ secret: undefined, config: { url: 'http://api.test/hook', secret_last4: '0000', default_tags: [] } }))
      api.post('/sources/:source_id/rotate-secret', fail(500, 'Internal error'))
      const { user, app, onClose, onCreated } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), 'Recorder')
      await user.click(button('Create webhook'))

      expect(await toast('That did not work. Internal error')).toBeInTheDocument()
      expect(await screen.findByText('Webhook created for ClearPath engagement')).toBeInTheDocument()
      expect(screen.getByText('The secret could not be shown. Open the webhook in the sources table and use Rotate secret to get a new one.')).toBeInTheDocument()
      // No secret to copy, and no promise that it was shown.
      expect(copyFields()).toEqual(['http://api.test/hook'])
      expect(screen.queryByText(/^Shown once/)).not.toBeInTheDocument()
      // The webhook cannot be created a second time.
      expect(screen.queryByRole('button', { name: 'Create webhook' })).not.toBeInTheDocument()
      expect(mutations()).toEqual([`POST /projects/${PID}/sources`, 'POST /sources/src-hook/rotate-secret'])
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('shows an empty URL when the created webhook came back without a configuration', async () => {
      api.post('/projects/:project_id/sources', hook({ secret: undefined, config: undefined }))
      api.post('/sources/:source_id/rotate-secret', { secret: 'whsec_test_rotated_7c1d', secret_last4: '7c1d', rotated_at: '2026-11-14T10:00:00Z' })
      const { user } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), 'Recorder')
      await user.click(button('Create webhook'))

      await screen.findByText('Webhook created for ClearPath engagement')
      expect(copyFields()).toEqual(['', 'whsec_test_rotated_7c1d'])
      expect(screen.getByText('Shown once. Afterwards only the last 4 characters are visible: 7c1d.')).toBeInTheDocument()
    })

    it('stays on the form and says why when the webhook cannot be created', async () => {
      const gate = deferred()
      api.post('/projects/:project_id/sources', () => gate.promise)
      const { user, app, onCreated } = open()
      await configure(user, 'webhook')
      await user.type(screen.getByLabelText('Name'), 'Recorder')
      await user.click(button('Create webhook'))
      expect(button('Create webhook')).toHaveAttribute('aria-disabled', 'true')
      await user.click(button('Create webhook'))
      expect(api.callsTo('POST', '/projects/:project_id/sources')).toHaveLength(1)

      gate.resolve(fail(403, 'Requires admin'))
      expect(await toast('That did not work. Requires admin')).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement · step 2 of 3')).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toHaveValue('Recorder')
      expect(onCreated).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button('Create webhook')).not.toHaveAttribute('aria-disabled'))
    })
  })

  it('works without an onCreated callback', async () => {
    api.post('/documents', { document: libraryDoc({ id: 'doc-handbook', title: 'Handbook' }), ingest_job: null })
    const { user, app } = renderWithApp(<AddSourceDialog projectId={PID} onClose={() => {}} />)
    await configure(user, 'library')
    await user.type(screen.getByLabelText('Text'), 'Four weeks.')
    await user.type(screen.getByLabelText('Title'), 'Handbook')
    await user.click(button('Upload and sync'))

    expect(await screen.findByText('Document doc-handbook added. Facts are being extracted.')).toBeInTheDocument()
    expect(app.refresh).toHaveBeenCalledTimes(1)
  })
})
