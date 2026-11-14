import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../../src/api/client'
import { I18nProvider } from '../../../src/i18n'
import { AppContext } from '../../../src/lib/appContext'
import { SourcesTable } from '../../../src/screens/home/SourcesTable'
import { Toaster } from '../../../src/ui/Toaster'
import { api, deferred, fail } from '../../helpers/api'
import { me, MEMBERS, source } from '../../helpers/fixtures'
import { doc, item, syncJob } from '../../helpers/home'
import { makeApp, renderWithApp } from '../../helpers/render'

type Source = Schemas['Source']

const DOCS = source({ last_synced_at: '2026-11-10T09:12:00Z' })
const LIB = source({ id: 'src-library', type: 'document_library', label: 'Policy library', status: 'idle', last_synced_at: null, items: 1, config: { provider: 'local_mock', root_path: '/data/library' } })
const GH = source({
  id: 'src-github',
  type: 'github',
  label: 'acme/handbook',
  status: 'error',
  items: 12,
  last_synced_at: '2026-11-14T08:05:00Z',
  config: { repo_url: 'https://github.com/acme/handbook', include: ['issues', 'readme'] },
})
const MAIL = source({
  id: 'src-mail',
  type: 'mail',
  label: 'ClearPath mailbox',
  status: 'syncing',
  items: 1,
  config: { mode: 'imap_mock', mailbox: 'brain@inbound.meridianlabs.org', match_rules: ['@clearpath.com', '@acme.io'] },
})
const HOOK = source({
  id: 'src-hook',
  type: 'webhook',
  label: 'Meeting recorder',
  items: 0,
  last_synced_at: null,
  config: { url: 'http://api.test/hooks/src-hook', secret_last4: 'a1b2', default_tags: ['team:ops', 'topic:onboarding-target'] },
})
const ALL = [DOCS, LIB, GH, MAIL, HOOK]
const EDITOR = { me: me({ as: MEMBERS.sara }) }

const row = (s: Source) => screen.getByText(s.id).closest('tr')!
/** The text of the status, items and last sync cells of a source row. */
const cells = (s: Source) =>
  within(row(s))
    .getAllByRole('cell')
    .slice(1, 4)
    .map((c) => c.textContent!.replace(/\s+/g, ' ').trim())
const nameButton = (s: Source) => screen.getByText(s.id).closest('button')!
const syncButton = (s: Source) => within(row(s)).getByRole('button', { name: 'Sync' })
const detailRow = (s: Source) => document.getElementById(`xp-src-${s.id}`)!
const detail = (s: Source) => within(detailRow(s))
/** The value under a label in the detail ("Status", "Last sync", "Items", "Type") or after a term in the configuration. */
const valueOf = (s: Source, label: string) => detail(s).getByText(label).nextElementSibling!
const sourceCalls = () => api.callsTo('GET', '/projects/:project_id/sources')

async function openSource(user: ReturnType<typeof renderWithApp>['user'], s: Source) {
  await user.click(await screen.findByText(s.label))
  await detail(s).findByText('Recent items')
}

beforeEach(() => {
  // "Last sync" shows the time alone for today: pin today.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  api.get('/projects/:project_id/sources', ALL)
  api.get('/projects/:project_id/items', { items: [], total: 0, limit: 200, offset: 0 })
  api.get('/sources/:source_id/documents', [])
})

describe('SourcesTable', () => {
  describe('loading the sources', () => {
    it('asks for the sources and the last 200 items of the project', async () => {
      renderWithApp(<SourcesTable pid="proj-internal" />)
      await screen.findByText('ClearPath documents')
      expect(sourceCalls()).toHaveLength(1)
      expect(sourceCalls()[0].params.project_id).toBe('proj-internal')
      const items = api.last('GET', '/projects/:project_id/items')!
      expect(items.params.project_id).toBe('proj-internal')
      expect(items.query.get('limit')).toBe('200')
      expect(api.unhandled).toEqual([])
    })

    it('shows neither the table nor the empty state while the sources load', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/sources', () => gate.promise)
      renderWithApp(<SourcesTable pid="proj-clearpath" onAdd={() => {}} />)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText('No sources yet')).not.toBeInTheDocument()

      gate.resolve([DOCS])
      expect(await screen.findByRole('table')).toBeInTheDocument()
    })

    it('shows the error and loads again on retry', async () => {
      api.get('/projects/:project_id/sources', fail(500, 'database is locked'))
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('Could not load this. database is locked')).toBeInTheDocument()

      api.get('/projects/:project_id/sources', [DOCS])
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('ClearPath documents')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('accepts the sources wrapped in { items }', async () => {
      api.get('/projects/:project_id/sources', { items: [LIB] })
      renderWithApp(<SourcesTable pid="proj-clearpath" />)
      expect(await screen.findByText('Policy library')).toBeInTheDocument()
    })
  })

  describe('with no sources', () => {
    beforeEach(() => {
      api.get('/projects/:project_id/sources', [])
    })

    it('explains what can be connected, without a button when nothing can be added from here', async () => {
      renderWithApp(<SourcesTable pid="proj-clearpath" />)
      expect(await screen.findByText('No sources yet')).toBeInTheDocument()
      expect(screen.getByText(/^Connect documents, a document library/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('offers to add a source', async () => {
      const onAdd = vi.fn()
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" onAdd={onAdd} />)
      await user.click(await screen.findByRole('button', { name: 'Add source' }))
      expect(onAdd).toHaveBeenCalledTimes(1)
    })

    it('an editor sees Add source greyed out and a click only explains why', async () => {
      const onAdd = vi.fn()
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" onAdd={onAdd} />, EDITOR)
      const add = await screen.findByRole('button', { name: 'Add source' })
      expect(add).toHaveAttribute('aria-disabled', 'true')
      expect(add).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(add)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(onAdd).not.toHaveBeenCalled()
    })
  })

  describe('rows', () => {
    it('shows status, number of items with its unit and last sync of every source', async () => {
      renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      expect(cells(DOCS)).toEqual(['Synced', '46 documents', '10 Nov, 09:12'])
      expect(cells(LIB)).toEqual(['Not synced yet', '1 document', 'never'])
      expect(cells(GH)).toEqual(['Failed', '12 items', '08:05'])
      expect(cells(MAIL)).toEqual(['Syncing…', '1 email', '…'])
      expect(cells(HOOK)).toEqual(['Waiting for first event', '0 items', 'never'])
    })

    it('counts a source without a number of items as zero', async () => {
      api.get('/projects/:project_id/sources', [source({ items: undefined, type: 'mail', last_synced_at: undefined })])
      renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      expect(cells(DOCS)).toEqual(['Synced', '0 emails', 'never'])
    })

    it('offers Sync on every source but a webhook', async () => {
      renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      for (const s of [DOCS, LIB, GH, MAIL]) expect(syncButton(s)).toBeEnabled()
      expect(within(row(HOOK)).queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
    })
  })

  describe('expanding a source', () => {
    it('opens on a click on the name and closes on a second one', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false')
      expect(nameButton(DOCS)).toHaveAttribute('aria-controls', 'xp-src-src-clearpath-docs')
      expect(detailRow(DOCS)).not.toHaveClass('open')
      expect(detail(DOCS).queryByText('Recent items')).not.toBeInTheDocument()

      await user.click(nameButton(DOCS))
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'true')
      expect(detailRow(DOCS)).toHaveClass('open')
      expect(detail(DOCS).getByText('Recent items')).toBeInTheDocument()
      expect(detail(DOCS).getByText('Configuration')).toBeInTheDocument()

      await user.click(nameButton(DOCS))
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false')
      expect(detail(DOCS).queryByText('Recent items')).not.toBeInTheDocument()
    })

    it('keeps one source open at a time', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(nameButton(GH))
      expect(nameButton(GH)).toHaveAttribute('aria-expanded', 'true')
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false')
      expect(detail(DOCS).queryByText('Recent items')).not.toBeInTheDocument()
      expect(detail(GH).getByText('Recent items')).toBeInTheDocument()
    })

    it('opens from anywhere on the row and closes from the chevron', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(within(row(GH)).getByText('Failed'))
      expect(nameButton(GH)).toHaveAttribute('aria-expanded', 'true')

      const chevron = within(row(GH)).getByRole('button', { name: 'acme/handbook' })
      expect(chevron).toHaveAttribute('aria-expanded', 'true')
      await user.click(chevron)
      expect(nameButton(GH)).toHaveAttribute('aria-expanded', 'false')

      await user.click(chevron)
      expect(nameButton(GH)).toHaveAttribute('aria-expanded', 'true')
    })

    it('starts with the source of the route open', async () => {
      renderWithApp(<SourcesTable pid="proj-clearpath" openId="src-github" />)
      await screen.findByText('acme/handbook')
      expect(detail(GH).getByText('Recent items')).toBeInTheDocument()
      expect(nameButton(GH)).toHaveAttribute('aria-expanded', 'true')
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens nothing when the source of the route is not in the project', async () => {
      renderWithApp(<SourcesTable pid="proj-clearpath" openId="src-gone" />)
      await screen.findByText('ClearPath documents')
      for (const s of ALL) expect(nameButton(s)).toHaveAttribute('aria-expanded', 'false')
    })

    it('repeats status, last sync, items and type in the detail', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(valueOf(DOCS, 'Status')).toHaveTextContent('Synced')
      expect(valueOf(DOCS, 'Last sync')).toHaveTextContent('10 Nov, 09:12')
      expect(valueOf(DOCS, 'Items')).toHaveTextContent('46 documents')
      expect(valueOf(DOCS, 'Type')).toHaveTextContent('Documents')

      await user.click(nameButton(LIB))
      expect(valueOf(LIB, 'Status')).toHaveTextContent('Not synced yet')
      expect(valueOf(LIB, 'Last sync')).toHaveTextContent('never')
      expect(valueOf(LIB, 'Items')).toHaveTextContent(/^1 document$/)
      expect(valueOf(LIB, 'Type')).toHaveTextContent('Document library')

      await user.click(nameButton(MAIL))
      expect(valueOf(MAIL, 'Status')).toHaveTextContent('Syncing…')
      expect(valueOf(MAIL, 'Last sync')).toHaveTextContent('in progress')
      expect(valueOf(MAIL, 'Type')).toHaveTextContent('Mail')

      await user.click(nameButton(GH))
      expect(valueOf(GH, 'Last sync')).toHaveTextContent(/^08:05$/)
      expect(valueOf(GH, 'Type')).toHaveTextContent('GitHub')

      await user.click(nameButton(HOOK))
      expect(valueOf(HOOK, 'Type')).toHaveTextContent('Inbound webhook')
    })
  })

  describe('recent items', () => {
    const ITEMS = [
      item({ id: 'I-1', source_id: DOCS.id, title: 'Kickoff notes', date: '2025-09-12', facts_count: 1, tags: ['topic:pilot-size', 'team:ops', 'client', 'extra'] }),
      item({ id: 'I-2', source_id: DOCS.id, title: 'Steering committee', date: '2025-11-12', facts_count: 3, tags: ['team:ops'] }),
      item({ id: 'I-3', source_id: DOCS.id, title: 'Risk review', facts_count: 0, tags: undefined }),
      item({ id: 'I-4', source_id: DOCS.id, title: 'Budget note', type: 'note' }),
      item({ id: 'I-5', source_id: DOCS.id, title: 'Support ticket', type: 'ticket' }),
      item({ id: 'I-6', source_id: DOCS.id, title: 'Sixth item', tags: ['archive'] }),
      item({ id: 'I-7', source_id: HOOK.id, title: 'Recorded stand-up', tags: ['team:ops'] }),
      item({ id: 'I-8', source_id: null, title: 'Uploaded by hand' }),
    ]
    const titles = (s: Source) =>
      detail(s)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.block')!.textContent)

    beforeEach(() => {
      api.get('/projects/:project_id/items', { items: ITEMS, total: ITEMS.length, limit: 200, offset: 0 })
    })

    it('lists the first five items of the source with tags, date and facts', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(titles(DOCS)).toEqual(['Kickoff notes', 'Steering committee', 'Risk review', 'Budget note', 'Support ticket'])

      const first = within(detail(DOCS).getByRole('button', { name: /Kickoff notes/ }))
      expect(first.getByText('12 Sep 2025')).toBeInTheDocument()
      expect(first.getByText('1 fact')).toBeInTheDocument()
      // Three tags at most.
      expect(first.getByText('topic:pilot-size')).toBeInTheDocument()
      expect(first.getByText('team:ops')).toBeInTheDocument()
      expect(first.getByText('client')).toBeInTheDocument()
      expect(first.queryByText('extra')).not.toBeInTheDocument()

      expect(within(detail(DOCS).getByRole('button', { name: /Steering committee/ })).getByText('3 facts')).toBeInTheDocument()
      expect(within(detail(DOCS).getByRole('button', { name: /Risk review/ })).getByText('0 facts')).toBeInTheDocument()
    })

    it('accepts the items as a bare array', async () => {
      api.get('/projects/:project_id/items', ITEMS)
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      expect(titles(HOOK)).toEqual(['Recorded stand-up'])
    })

    it('filters the recent items by tag, plain tags before topic tags', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      const select = detail(DOCS).getByRole('combobox', { name: 'Filter items by tag' })
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any tag', 'archive', 'client', 'extra', 'team:ops', 'topic:pilot-size'])

      await user.selectOptions(select, 'team:ops')
      expect(titles(DOCS)).toEqual(['Kickoff notes', 'Steering committee'])

      // The sixth item is beyond the first five, the filter reaches it.
      await user.selectOptions(select, 'archive')
      expect(titles(DOCS)).toEqual(['Sixth item'])

      await user.selectOptions(select, 'Any tag')
      expect(titles(DOCS)).toHaveLength(5)
    })

    it('has no tag filter when the items of the source carry no tags', async () => {
      api.get('/projects/:project_id/items', [item({ source_id: DOCS.id, tags: [] })])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(detail(DOCS).getByRole('button', { name: /Steering committee/ })).toBeInTheDocument()
      expect(detail(DOCS).queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('says when no recent item has the chosen tag any more', async () => {
      const wrap = (version: number): ReactElement => (
        <I18nProvider>
          <AppContext.Provider value={makeApp({ version })}>
            <SourcesTable pid="proj-clearpath" openId={DOCS.id} />
            <Toaster />
          </AppContext.Provider>
        </I18nProvider>
      )
      const view = render(wrap(1))
      const select = await screen.findByRole('combobox', { name: 'Filter items by tag' })
      await userEvent.setup().selectOptions(select, 'archive')
      expect(titles(DOCS)).toEqual(['Sixth item'])

      // The data changes (new version): the items come again, without the tagged one.
      api.get('/projects/:project_id/items', ITEMS.filter((i) => i.id !== 'I-6'))
      view.rerender(wrap(2))
      expect(await detail(DOCS).findByText('No recent items with this tag.')).toBeInTheDocument()
    })

    it('goes to the project page on a click on an item', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-internal" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: /Steering committee/ }))
      expect(location.hash).toBe('#/projects/proj-internal')
    })

    it('hands the item to the page that asked for it instead of leaving', async () => {
      const onItem = vi.fn()
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" onItem={onItem} />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: /Steering committee/ }))
      expect(onItem).toHaveBeenCalledWith('I-2')
      expect(location.hash).toBe('')
    })

    it('waits for the items before saying a source has none', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/items', () => gate.promise)
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, GH)
      expect(detail(GH).queryByText('No items yet.')).not.toBeInTheDocument()

      gate.resolve([])
      expect(await detail(GH).findByText('No items yet.')).toBeInTheDocument()
    })

    it('says what an empty source is waiting for, by type', async () => {
      api.get('/projects/:project_id/items', [])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(detail(DOCS).getByText('Uploads and webhook posts show up here. Documents of this source are listed below.')).toBeInTheDocument()
      await user.click(nameButton(LIB))
      expect(detail(LIB).getByText('Uploads and webhook posts show up here. Documents of this source are listed below.')).toBeInTheDocument()
      await user.click(nameButton(MAIL))
      expect(detail(MAIL).getByText('No items yet.')).toBeInTheDocument()
      await user.click(nameButton(HOOK))
      expect(detail(HOOK).getByText('No items yet. Post to the URL to send one.')).toBeInTheDocument()
    })
  })

  describe('documents of a source', () => {
    it('lists them with the current version and the date', async () => {
      api.get('/sources/:source_id/documents', [
        doc({ id: 'd1', title: 'Project brief', date: '2025-08-22', version: 1 }),
        doc({ id: 'd2', title: 'Travel policy', date: '2025-10-01', version: 1, current_version: 3 }),
        doc({ id: 'd3', title: 'Security policy', date: '2025-10-02', version: 2 }),
      ])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, LIB)
      expect(await detail(LIB).findByRole('heading', { name: '3 documents' })).toBeInTheDocument()
      expect(api.last('GET', '/sources/:source_id/documents')!.params.source_id).toBe('src-library')

      const line = (title: string) => within(detail(LIB).getByText(title).closest('li')!)
      expect(line('Project brief').getByText('22 Aug 2025')).toBeInTheDocument()
      expect(line('Project brief').queryByText(/^v\d/)).not.toBeInTheDocument()
      expect(line('Travel policy').getByText('v3')).toHaveClass('badge')
      expect(line('Security policy').getByText('v2')).toBeInTheDocument()
    })

    it('shows six documents and counts the rest', async () => {
      const docs = Array.from({ length: 8 }, (_, i) => doc({ id: `d${i}`, title: `Document ${i + 1}` }))
      api.get('/sources/:source_id/documents', { items: docs })
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(await detail(DOCS).findByRole('heading', { name: '8 documents' })).toBeInTheDocument()
      expect(detail(DOCS).getByText('Document 6')).toBeInTheDocument()
      expect(detail(DOCS).queryByText('Document 7')).not.toBeInTheDocument()
      expect(detail(DOCS).getByText('and 2 more')).toBeInTheDocument()
    })

    it('uses the singular for one document and does not count beyond it', async () => {
      api.get('/sources/:source_id/documents', [doc()])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(await detail(DOCS).findByRole('heading', { name: '1 document' })).toBeInTheDocument()
      expect(detail(DOCS).queryByText(/and \d+ more/)).not.toBeInTheDocument()
    })

    it('shows no documents section for a source without documents', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await waitFor(() => expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(1))
      expect(detail(DOCS).queryByRole('heading', { name: /\d+ documents?/ })).not.toBeInTheDocument()
    })

    it('does not ask for documents of a repository, a mailbox or a webhook', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, GH)
      await user.click(nameButton(MAIL))
      await user.click(nameButton(HOOK))
      await detail(HOOK).findByText('Recent items')
      expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(0)
    })
  })

  describe('configuration', () => {
    it('of uploaded documents: the formats and how to add files', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(valueOf(DOCS, 'Formats')).toHaveTextContent('Text, Markdown, PDF')
      expect(valueOf(DOCS, 'Upload')).toHaveTextContent('Add files with Add source › Documents, or use Upload.')
    })

    it('of a document library: the provider and the folder', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, LIB)
      expect(valueOf(LIB, 'Provider')).toHaveTextContent('Local library · SharePoint and Google Drive coming soon')
      expect(valueOf(LIB, 'Folder')).toHaveTextContent('/data/library')
    })

    it('of a repository: the URL, the access and what is imported', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, GH)
      expect(valueOf(GH, 'Repository')).toHaveTextContent('https://github.com/acme/handbook')
      expect(valueOf(GH, 'Access')).toHaveTextContent('Public, no keys stored')
      expect(detail(GH).getByText('Issues and comments')).toHaveClass('badge')
      expect(detail(GH).getByText('README')).toHaveClass('badge')
      expect(detail(GH).queryByText('Pull requests')).not.toBeInTheDocument()
    })

    it('of a repository without configuration: its label, importing nothing', async () => {
      api.get('/projects/:project_id/sources', [{ ...GH, config: undefined }])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, GH)
      expect(valueOf(GH, 'Repository')).toHaveTextContent('acme/handbook')
      expect(valueOf(GH, 'Import')).toHaveTextContent('None')
    })

    it('of a mailbox: the address, the mode, the rules and a link to the routing rules', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, MAIL)
      expect(valueOf(MAIL, 'Mailbox')).toHaveTextContent('brain@inbound.meridianlabs.org')
      expect(valueOf(MAIL, 'Mode')).toHaveTextContent('imap_mock')
      expect(valueOf(MAIL, 'Rules')).toHaveTextContent('@clearpath.com, @acme.io')
      expect(detail(MAIL).getByRole('link', { name: 'Routing rules' })).toHaveAttribute('href', '#/sources')
    })

    it('of a mailbox without rules: None', async () => {
      api.get('/projects/:project_id/sources', [{ ...MAIL, config: { mode: 'webhook', mailbox: 'x@y.org' } }])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, MAIL)
      expect(valueOf(MAIL, 'Rules')).toHaveTextContent('None')
      expect(valueOf(MAIL, 'Mode')).toHaveTextContent('webhook')
    })

    it('of a webhook: the URL, the masked secret and the default tags', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      expect(valueOf(HOOK, 'URL')).toHaveTextContent('http://api.test/hooks/src-hook')
      expect(detail(HOOK).getByText('whsec_••••a1b2')).toBeInTheDocument()
      expect(detail(HOOK).getByText('Sent as the X-Canonico-Token header.')).toBeInTheDocument()
      expect(valueOf(HOOK, 'Default tags')).toHaveTextContent('team:opstopic:onboarding-target')
      expect(detail(HOOK).queryByRole('textbox', { name: 'Value to copy' })).not.toBeInTheDocument()
    })

    it('of a webhook without default tags: None', async () => {
      api.get('/projects/:project_id/sources', [{ ...HOOK, config: { url: 'http://api.test/hooks/src-hook', secret_last4: 'a1b2', default_tags: [] } }])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      expect(valueOf(HOOK, 'Default tags')).toHaveTextContent('None')
    })

    it('shows blanks, not placeholders like "undefined", for a source that comes without configuration', async () => {
      api.get('/projects/:project_id/sources', [
        { ...MAIL, config: undefined },
        { ...LIB, config: undefined },
        { ...HOOK, config: undefined },
      ])
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, MAIL)
      expect(valueOf(MAIL, 'Mailbox')).toBeEmptyDOMElement()
      expect(valueOf(MAIL, 'Mode')).toBeEmptyDOMElement()
      expect(valueOf(MAIL, 'Rules')).toHaveTextContent('None')

      await user.click(nameButton(LIB))
      expect(valueOf(LIB, 'Folder')).toBeEmptyDOMElement()

      await user.click(nameButton(HOOK))
      expect(valueOf(HOOK, 'URL')).toHaveTextContent(/^$/)
      expect(detail(HOOK).getByText('whsec_••••')).toBeInTheDocument()
      expect(valueOf(HOOK, 'Default tags')).toHaveTextContent('None')
      expect(detailRow(HOOK)).not.toHaveTextContent('undefined')
    })

    it('copies the URL of a webhook', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      const write = vi.spyOn(navigator.clipboard, 'writeText')
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Copy URL' }))
      expect(write).toHaveBeenCalledWith('http://api.test/hooks/src-hook')
      expect(await screen.findByText('Copied')).toBeInTheDocument()
    })

    it('copies a curl example with the URL, the default tags, a placeholder for the secret and the date of today', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      const write = vi.spyOn(navigator.clipboard, 'writeText')
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Copy curl' }))
      expect(await screen.findByText('Copied')).toBeInTheDocument()
      const curl = write.mock.calls[0][0]
      expect(curl).toMatch(/^curl -X POST http:\/\/api\.test\/hooks\/src-hook /)
      expect(curl).toContain('-H "X-Canonico-Token: $CANONICO_SECRET"')
      expect(curl).toContain('"date": "2026-11-14T10:00:00Z"')
      expect(curl).toContain('"tags": ["team:ops", "topic:onboarding-target"]')
    })

    it('says when copying is not possible', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Copy URL' }))
      expect(await screen.findByText('Could not copy. Select the text and copy it by hand.')).toBeInTheDocument()
    })
  })

  describe('sync', () => {
    it('starts the job from the row, says what came in, loads the sources again and refreshes the app', async () => {
      api.post('/sources/:source_id/sync', syncJob())
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(DOCS))

      expect(await screen.findByText('ClearPath documents synced: 3 new items, 7 new facts.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(1)
      expect(api.last('POST', '/sources/:source_id/sync')!.params.source_id).toBe('src-clearpath-docs')
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(sourceCalls()).toHaveLength(2)
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(0)
      // A click on Sync does not expand the row.
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false')
      expect(api.unhandled).toEqual([])
    })

    it('shows the source as syncing, with Sync disabled, until the job answers', async () => {
      const gate = deferred()
      api.post('/sources/:source_id/sync', () => gate.promise)
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(DOCS))

      await waitFor(() => expect(cells(DOCS)).toEqual(['Syncing…', '46 documents', '…']))
      expect(syncButton(DOCS)).toBeDisabled()
      expect(syncButton(LIB)).toBeEnabled()
      expect(cells(LIB)).toEqual(['Not synced yet', '1 document', 'never'])

      gate.resolve(syncJob())
      await waitFor(() => expect(cells(DOCS)).toEqual(['Synced', '46 documents', '10 Nov, 09:12']))
      expect(syncButton(DOCS)).toBeEnabled()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('polls a queued job until it is done', async () => {
      api.post('/sources/:source_id/sync', syncJob({ id: 'job-9', status: 'queued', items_added: 0, facts_created: 0 }))
      api.get('/sync-jobs/:job_id', syncJob({ id: 'job-9', status: 'done', items_added: 2, facts_created: 4 }))
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(DOCS))

      expect(await screen.findByText('ClearPath documents synced: 2 new items, 4 new facts.', {}, { timeout: 4000 })).toBeInTheDocument()
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(1)
      expect(api.last('GET', '/sync-jobs/:job_id')!.params.job_id).toBe('job-9')
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('counts what a job does not report as zero', async () => {
      api.post('/sources/:source_id/sync', { id: 'job-1', source_id: LIB.id, status: 'done' })
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(LIB))
      expect(await screen.findByText('Policy library synced: 0 new items, 0 new facts.')).toBeInTheDocument()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('says the sync failed when the job ends in error, and still reloads', async () => {
      api.post('/sources/:source_id/sync', syncJob({ status: 'error' }))
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(GH))

      expect(await screen.findByText('Sync of acme/handbook failed. Try again in a moment.')).toBeInTheDocument()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(sourceCalls()).toHaveLength(2)
      expect(syncButton(GH)).toBeEnabled()
    })

    it('says why when the sync cannot start', async () => {
      api.post('/sources/:source_id/sync', fail(409, 'A sync is already running'))
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await screen.findByText('ClearPath documents')
      await user.click(syncButton(DOCS))

      expect(await screen.findByText('That did not work. A sync is already running')).toBeInTheDocument()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(cells(DOCS)).toEqual(['Synced', '46 documents', '10 Nov, 09:12'])
      expect(syncButton(DOCS)).toBeEnabled()
    })

    it('runs from Sync now in the detail, which reads Syncing… meanwhile', async () => {
      const gate = deferred()
      api.post('/sources/:source_id/sync', () => gate.promise)
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: 'Sync now' }))

      const busy = await detail(DOCS).findByRole('button', { name: 'Syncing…' })
      expect(busy).toBeDisabled()
      expect(valueOf(DOCS, 'Status')).toHaveTextContent('Syncing…')
      expect(valueOf(DOCS, 'Last sync')).toHaveTextContent('in progress')
      expect(api.last('POST', '/sources/:source_id/sync')!.params.source_id).toBe('src-clearpath-docs')

      gate.resolve(syncJob({ items_added: 4, facts_created: 0 }))
      expect(await screen.findByText('ClearPath documents synced: 4 new items, 0 new facts.')).toBeInTheDocument()
      expect(await detail(DOCS).findByRole('button', { name: 'Sync now' })).toBeEnabled()
      expect(valueOf(DOCS, 'Last sync')).toHaveTextContent('10 Nov, 09:12')
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('an editor sees both sync buttons greyed out and a click only explains why', async () => {
      api.post('/sources/:source_id/sync', syncJob())
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />, EDITOR)
      await openSource(user, DOCS)
      const inRow = syncButton(DOCS)
      const inDetail = detail(DOCS).getByRole('button', { name: 'Sync now' })
      for (const b of [inRow, inDetail]) {
        expect(b).toHaveAttribute('aria-disabled', 'true')
        expect(b).toHaveAttribute('data-tip', 'Requires admin')
      }

      await user.click(inRow)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      await user.click(inDetail)
      await waitFor(() => expect(screen.getAllByText('Requires admin', { selector: '.toast *' })).toHaveLength(2))
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(0)
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('a webhook has nothing to pull: Sync now is greyed out and does nothing', async () => {
      api.post('/sources/:source_id/sync', syncJob())
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      const sync = detail(HOOK).getByRole('button', { name: 'Sync now' })
      expect(sync).toHaveAttribute('aria-disabled', 'true')
      expect(sync).toHaveAttribute('data-tip', 'Webhooks push items, nothing to pull')

      await user.click(sync)
      expect(api.callsTo('POST', '/sources/:source_id/sync')).toHaveLength(0)
    })
  })

  describe('rotating the secret of a webhook', () => {
    it('is offered on webhooks only', async () => {
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      expect(detail(DOCS).queryByRole('button', { name: 'Rotate secret' })).not.toBeInTheDocument()
      await user.click(nameButton(HOOK))
      expect(detail(HOOK).getByRole('button', { name: 'Rotate secret' })).toBeEnabled()
    })

    it('shows the new secret once, to copy, then only its last characters', async () => {
      api.post('/sources/:source_id/rotate-secret', { secret: 'whsec_new_secret_9f3c', secret_last4: '9f3c' })
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      const write = vi.spyOn(navigator.clipboard, 'writeText')
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Rotate secret' }))

      expect(await screen.findByText('New secret created. Copy it now, it is shown once.')).toBeInTheDocument()
      expect(api.last('POST', '/sources/:source_id/rotate-secret')!.params.source_id).toBe('src-hook')
      expect(detail(HOOK).getByRole('textbox', { name: 'Value to copy' })).toHaveValue('whsec_new_secret_9f3c')
      expect(detail(HOOK).getByText('Shown once. Copy it now.')).toBeInTheDocument()
      expect(detail(HOOK).queryByText(/^whsec_••••/)).not.toBeInTheDocument()

      await user.click(detail(HOOK).getByRole('button', { name: 'Copy' }))
      expect(write).toHaveBeenCalledWith('whsec_new_secret_9f3c')

      await user.click(detail(HOOK).getByRole('button', { name: 'Done' }))
      expect(detail(HOOK).queryByRole('textbox', { name: 'Value to copy' })).not.toBeInTheDocument()
      expect(detail(HOOK).getByText('whsec_••••9f3c')).toBeInTheDocument()
    })

    it('disables the button while the secret is being created', async () => {
      const gate = deferred()
      api.post('/sources/:source_id/rotate-secret', () => gate.promise)
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Rotate secret' }))
      await waitFor(() => expect(detail(HOOK).getByRole('button', { name: 'Rotate secret' })).toBeDisabled())

      gate.resolve({ secret: 'whsec_x', secret_last4: 'c_x1' })
      await waitFor(() => expect(detail(HOOK).getByRole('button', { name: 'Rotate secret' })).toBeEnabled())
      expect(detail(HOOK).getByRole('textbox', { name: 'Value to copy' })).toHaveValue('whsec_x')
    })

    it('says why when the backend refuses, and keeps the old secret', async () => {
      api.post('/sources/:source_id/rotate-secret', fail(500, 'vault unavailable'))
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, HOOK)
      await user.click(detail(HOOK).getByRole('button', { name: 'Rotate secret' }))

      expect(await screen.findByText('That did not work. vault unavailable')).toBeInTheDocument()
      expect(detail(HOOK).getByText('whsec_••••a1b2')).toBeInTheDocument()
      await waitFor(() => expect(detail(HOOK).getByRole('button', { name: 'Rotate secret' })).toBeEnabled())
    })

    it('an editor cannot rotate', async () => {
      api.post('/sources/:source_id/rotate-secret', { secret: 's', secret_last4: 'l' })
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />, EDITOR)
      await openSource(user, HOOK)
      const rotate = detail(HOOK).getByRole('button', { name: 'Rotate secret' })
      expect(rotate).toHaveAttribute('aria-disabled', 'true')
      expect(rotate).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(rotate)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(api.callsTo('POST', '/sources/:source_id/rotate-secret')).toHaveLength(0)
    })
  })

  describe('removing a source', () => {
    it('asks first, and Cancel leaves the source alone', async () => {
      api.delete('/sources/:source_id', {})
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))
      expect(detail(DOCS).getByText('Remove this source? Its facts stay in memory.')).toBeInTheDocument()

      await user.click(detail(DOCS).getByRole('button', { name: 'Cancel' }))
      expect(detail(DOCS).queryByText('Remove this source? Its facts stay in memory.')).not.toBeInTheDocument()
      expect(detail(DOCS).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
      expect(api.callsTo('DELETE', '/sources/:source_id')).toHaveLength(0)
    })

    it('removes it once confirmed, closes the row, loads the sources again and refreshes the app', async () => {
      api.delete('/sources/:source_id', () => {
        api.get('/projects/:project_id/sources', [LIB, GH])
        return {}
      })
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))

      expect(await screen.findByText('ClearPath documents removed. Its facts stay in memory.')).toBeInTheDocument()
      expect(api.last('DELETE', '/sources/:source_id')!.params.source_id).toBe('src-clearpath-docs')
      await waitFor(() => expect(screen.queryByText('src-clearpath-docs')).not.toBeInTheDocument())
      expect(screen.getByText('Policy library')).toBeInTheDocument()
      expect(nameButton(LIB)).toHaveAttribute('aria-expanded', 'false')
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])
    })

    it('says why when the backend refuses, and keeps the source', async () => {
      api.delete('/sources/:source_id', fail(409, 'A sync is running'))
      const { user, app } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))

      expect(await screen.findByText('That did not work. A sync is running')).toBeInTheDocument()
      await waitFor(() => expect(detail(DOCS).queryByText('Remove this source? Its facts stay in memory.')).not.toBeInTheDocument())
      expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'true')
      expect(detail(DOCS).getByRole('button', { name: 'Remove' })).toBeEnabled()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(sourceCalls()).toHaveLength(1)
    })

    it('disables the confirmation while the request is running', async () => {
      const gate = deferred()
      api.delete('/sources/:source_id', () => gate.promise)
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />)
      await openSource(user, DOCS)
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))
      await user.click(detail(DOCS).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(detail(DOCS).getByRole('button', { name: 'Remove' })).toBeDisabled())

      gate.resolve({})
      expect(await screen.findByText('ClearPath documents removed. Its facts stay in memory.')).toBeInTheDocument()
      await waitFor(() => expect(nameButton(DOCS)).toHaveAttribute('aria-expanded', 'false'))
      expect(api.callsTo('DELETE', '/sources/:source_id')).toHaveLength(1)
    })

    it('an editor cannot remove: no confirmation, only the reason', async () => {
      api.delete('/sources/:source_id', {})
      const { user } = renderWithApp(<SourcesTable pid="proj-clearpath" />, EDITOR)
      await openSource(user, DOCS)
      const remove = detail(DOCS).getByRole('button', { name: 'Remove' })
      expect(remove).toHaveAttribute('aria-disabled', 'true')
      expect(remove).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(remove)
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
      expect(detail(DOCS).queryByText('Remove this source? Its facts stay in memory.')).not.toBeInTheDocument()
      expect(api.callsTo('DELETE', '/sources/:source_id')).toHaveLength(0)
    })
  })
})
