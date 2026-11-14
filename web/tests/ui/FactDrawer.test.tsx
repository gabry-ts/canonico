import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import { I18nProvider } from '../../src/i18n'
import { AppContext, type AppState } from '../../src/lib/appContext'
import { NO_FILTERS, setFilters, useFilters } from '../../src/screens/memory/api'
import FactDrawer from '../../src/ui/FactDrawer'
import { Toaster } from '../../src/ui/Toaster'
import { api, deferred, fail, offline, type Req } from '../helpers/api'
import { auditEvent, fact, me, MEMBERS, topic } from '../helpers/fixtures'
import { makeApp, renderWithApp } from '../helpers/render'

type Fact = Schemas['Fact']
type Chain = Schemas['TopicChain']
type Version = Schemas['FactVersion']
type Dependents = Schemas['Dependents']

/** The fact most tests open: the binding fact of its topic, replacing an older one that is still active. */
const F = fact({
  id: 'M-202',
  topic: 'audit-turnaround',
  value: '3–4 business days',
  doc_id: '05-meetings/meeting-005-final-presentation',
  quote: 'Turnaround drops to three or four business days.',
  date: '2025-11-20',
  supersedes: 'M-201',
  confidence: 0.92,
  tags: ['sla', 'topic:audit'],
})
const OLD = fact({
  id: 'M-201',
  topic: 'audit-turnaround',
  value: '5 business days',
  doc_id: '04-external-comms/email/email-external-012',
  quote: 'We promise five business days.',
  date: '2025-10-02',
  superseded_by: 'M-202',
})
const RETIRED: Fact = { ...F, status: 'retired', retired_by: 'mem-giulia', retired_at: '2024-03-02T10:30:00Z', retired_reason: 'Out of date' }

const TOPIC = topic({ id: 'audit-turnaround', label: 'Audit turnaround', fact_ids: ['M-201', 'M-202'] })
const chainOf = (...facts: Chain['facts']): Chain => ({ topic: TOPIC, facts })
// Newest first, as a careless backend might send it: the drawer orders the timeline itself.
const CHAIN = chainOf({ ...F, doc_title: 'Final presentation' }, { ...OLD, doc_title: 'Email to ClearPath' })

const version = (over: Partial<Version> = {}): Version => ({ version: 1, at: '2024-03-01T09:00:00Z', actor: 'system', action: 'ingest', changes: {}, snapshot: F, ...over })
const noDependents = (id = F.id): Dependents => ({ fact_id: id, facts: [], conflicts: [], answers: [] })

/** `GET /audit` answers the events of the fact (limit 50) and the latest one for the Undo of a toast (limit 1). */
const audit = (events: Schemas['AuditEvent'][], latest: Schemas['AuditEvent'][] = []) => (req: Req) => (req.query.get('limit') === '1' ? latest : events)

/** Shows the shared memory filters, to see what the drawer sets. */
function FiltersProbe() {
  return <output data-testid="filters">{JSON.stringify(useFilters())}</output>
}
const filters = () => JSON.parse(screen.getByTestId('filters').textContent ?? '{}') as typeof NO_FILTERS

/** Opens the drawer on `f`, which the backend then knows. */
function show(f: Fact = F, over: Partial<AppState> = {}) {
  api.get('/facts/:id', (req) => (req.params.id === f.id ? f : fail(404, 'Fact not found')))
  const onClose = vi.fn()
  const view = renderWithApp(
    <>
      <FactDrawer id={f.id} onClose={onClose} />
      <FiltersProbe />
    </>,
    over,
  )
  return { ...view, onClose }
}

/** Like `show`, but the app value can change after the first render (`update`). */
function mount(f: Fact = F, over: Partial<AppState> = {}) {
  api.get('/facts/:id', f)
  let app = makeApp(over)
  const user = userEvent.setup()
  const tree = (value: AppState) => (
    <I18nProvider>
      <AppContext.Provider value={value}>
        <FactDrawer id={f.id} onClose={() => {}} />
        <Toaster />
      </AppContext.Provider>
    </I18nProvider>
  )
  const view = render(tree(app))
  return {
    user,
    update(next: Partial<AppState>) {
      app = makeApp({ ...over, ...next })
      view.rerender(tree(app))
      return app
    },
  }
}

const ready = (value = F.value) => screen.findByRole('heading', { name: value })
const drawer = () => screen.getByRole('dialog')
const header = () => within(drawer().querySelector('header')!)
/** The `<dd>` next to a term of the details list. */
const detail = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
/** The button that opens an action (first in the page) and the one that confirms it (in the panel below). */
const startButton = (name: string) => screen.getAllByRole('button', { name })[0]
const confirmButton = (name: string) => screen.getAllByRole('button', { name }).at(-1)!
const reason = () => screen.getByRole('textbox', { name: /^Reason/ })
/** Opens an action and waits for the cursor to land in its first field, as it does a moment after the click. */
async function begin(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(startButton(name))
  const first = screen.queryByRole('textbox', { name: 'Corrected sentence' }) ?? reason()
  await waitFor(() => expect(first).toHaveFocus())
}
const panelOpen = () => screen.queryByRole('textbox', { name: /^Reason/ }) !== null
const timeline = () => [...drawer().querySelectorAll<HTMLElement>('.vt-item')]
const historyRows = () => screen.getAllByRole('listitem')
const writes = () => api.calls.filter((c) => c.method !== 'GET')

beforeEach(() => {
  setFilters(NO_FILTERS)
  api.get('/topics/:id/chain', (req) => (req.params.id === TOPIC.id ? CHAIN : fail(404, 'Topic not found')))
  api.get('/facts/:id/history', [])
  api.get('/audit', audit([]))
  api.get('/facts/:id/dependents', (req) => noDependents(req.params.id))
  // The member list is fetched once for the whole file (it is cached by the app).
  api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
})

describe('FactDrawer', () => {
  describe('loading the fact', () => {
    it('shows the id and placeholders while the fact loads', async () => {
      const gate = deferred<Fact>()
      api.get('/facts/:id', () => gate.promise)
      renderWithApp(<FactDrawer id="M-202" onClose={() => {}} />)
      expect(screen.getByRole('dialog', { name: 'Fact M-202' })).toBeInTheDocument()
      expect(header().getByText('M-202')).toBeInTheDocument()
      expect(drawer().querySelectorAll('.skel')).toHaveLength(5)
      expect(screen.queryByRole('link', { name: 'Open in Memory' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument()

      gate.resolve(F)
      expect(await ready()).toBeInTheDocument()
      await screen.findByText('No changes yet.')
      expect(drawer().querySelectorAll('.skel')).toHaveLength(0)
    })

    it('asks for the fact, its timeline, history, events and dependents', async () => {
      show()
      await ready()
      await screen.findByText('No changes yet.')
      await screen.findByText('Audit turnaround · oldest first')
      expect(api.last('GET', '/facts/:id')!.params.id).toBe('M-202')
      expect(api.last('GET', '/topics/:id/chain')!.params.id).toBe('audit-turnaround')
      expect(api.last('GET', '/facts/:id/history')!.params.id).toBe('M-202')
      expect(api.last('GET', '/facts/:id/dependents')!.params.id).toBe('M-202')
      expect(Object.fromEntries(api.last('GET', '/audit')!.query)).toEqual({ fact_id: 'M-202', limit: '50' })
      expect(api.unhandled).toEqual([])
      expect(writes()).toEqual([])
    })

    it('says when the fact cannot be loaded and loads it again on retry', async () => {
      api.get('/facts/:id', fail(404, 'Fact M-999 not found'))
      const { user } = renderWithApp(<FactDrawer id="M-999" onClose={() => {}} />)
      expect(await screen.findByText('This fact could not be loaded.')).toBeInTheDocument()
      expect(screen.getByText('Fact M-999 not found')).toBeInTheDocument()
      expect(header().getByText('M-999')).toBeInTheDocument()

      api.get('/facts/:id', { ...F, id: 'M-999' })
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await ready()).toBeInTheDocument()
      expect(screen.queryByText('This fact could not be loaded.')).not.toBeInTheDocument()
    })

    it('can be closed while loading and after a failure', async () => {
      api.get('/facts/:id', fail(500, 'boom'))
      const onClose = vi.fn()
      const { user } = renderWithApp(<FactDrawer id="M-202" onClose={onClose} />)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      await screen.findByText('This fact could not be loaded.')
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('does not show the previous fact while another one loads', async () => {
      const view = show()
      await ready()
      const gate = deferred<Fact>()
      api.get('/facts/:id', () => gate.promise)
      view.rerender(<FactDrawer id="M-201" onClose={() => {}} />)
      expect(screen.queryByRole('heading', { name: F.value })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Fact M-201' })).toBeInTheDocument()
      expect(header().getByText('M-201')).toBeInTheDocument()

      gate.resolve(OLD)
      expect(await ready(OLD.value)).toBeInTheDocument()
      expect(api.last('GET', '/facts/:id/history')!.params.id).toBe('M-201')
    })
  })

  describe('what it shows', () => {
    it('shows the id, state and type in the header, with a link to the fact in Memory', async () => {
      show()
      await ready()
      expect(header().getByText('M-202')).toBeInTheDocument()
      expect(header().getByText('Binding')).toHaveClass('badge', 'binding')
      expect(header().getByText('Decision')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open in Memory' })).toHaveAttribute('href', '#/memory/M-202')
    })

    it('escapes the fact id in the address and in the requests', async () => {
      show({ ...F, id: 'DOC 7/3' })
      await ready()
      expect(screen.getByRole('link', { name: 'Open in Memory' })).toHaveAttribute('href', '#/memory/DOC%207%2F3')
      expect(api.last('GET', '/facts/:id')!.path).toBe('/facts/DOC%207%2F3')
      await screen.findByText('No changes yet.')
      expect(api.last('GET', '/facts/:id/history')!.params.id).toBe('DOC 7/3')
      expect(api.last('GET', '/audit')!.query.get('fact_id')).toBe('DOC 7/3')
    })

    it('shows the sentence, the quote, the source, the date and the confidence', async () => {
      show()
      await ready()
      expect(screen.getByRole('heading', { name: F.value })).not.toHaveClass('strike')
      expect(screen.getByText('“Turnaround drops to three or four business days.”')).toHaveClass('quote', 'binding')
      expect(detail('Date')).toHaveTextContent('20 Nov 2025')
      expect(detail('Confidence')).toHaveTextContent('92%')
      // The title of the document comes with the timeline.
      await waitFor(() => expect(detail('Source')).toHaveTextContent('Final presentation · 05-meetings/meeting-005-final-presentation'))
    })

    it('names the source after its file when the timeline has no title for it', async () => {
      api.get('/topics/:id/chain', chainOf(F, OLD))
      show()
      await ready()
      await screen.findByText('Audit turnaround · oldest first')
      expect(detail('Source')).toHaveTextContent('final presentation · 05-meetings/meeting-005-final-presentation')
    })

    it('shows a fact that no longer counts struck through, without the binding mark', async () => {
      show(RETIRED)
      expect(await ready()).toHaveClass('strike')
      expect(header().getByText('Retired')).toHaveClass('badge', 'retired')
      expect(screen.getByText(`“${F.quote}”`)).not.toHaveClass('binding')
    })

    it('shows an older decision that nobody retired as still active', async () => {
      show(OLD)
      await ready(OLD.value)
      // Without the timeline the drawer only knows this fact; with it, that a newer one is binding.
      expect(await header().findByText('Still active')).toHaveClass('badge', 'conflict')
      expect(screen.getByRole('heading', { name: OLD.value })).not.toHaveClass('strike')
      expect(screen.getByText(`“${OLD.quote}”`)).not.toHaveClass('binding')
    })

    it('shows the topic label once the timeline is known, the topic id before', async () => {
      const gate = deferred<Chain>()
      api.get('/topics/:id/chain', () => gate.promise)
      show()
      await ready()
      expect(screen.getByRole('button', { name: 'audit-turnaround' })).toBeInTheDocument()
      expect(screen.getByText('audit-turnaround · oldest first')).toBeInTheDocument()

      gate.resolve(CHAIN)
      expect(await screen.findByRole('button', { name: 'Audit turnaround' })).toBeInTheDocument()
      expect(screen.getByText('Audit turnaround · oldest first')).toBeInTheDocument()
    })

    it('links the fact it replaces and the one that replaced it, by their sentence', async () => {
      const { user, app } = show({ ...F, superseded_by: 'M-201' })
      await ready()
      await screen.findByText('Audit turnaround · oldest first')
      await user.click(within(detail('Replaces')).getByRole('button', { name: '5 business days' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-201')
      await user.click(within(detail('Replaced by')).getByRole('button', { name: '5 business days' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-201')
      expect(app.openFact).toHaveBeenCalledTimes(2)
    })

    it('links replaced facts by id when the timeline does not have them', async () => {
      api.get('/topics/:id/chain', fail(500, 'boom'))
      const { user, app } = show({ ...F, supersedes: 'M-150', superseded_by: 'M-250' })
      await ready()
      await user.click(within(detail('Replaces')).getByRole('button', { name: 'M-150' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-150')
      await user.click(within(detail('Replaced by')).getByRole('button', { name: 'M-250' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-250')
    })

    it('has no replaced lines for a fact on its own', async () => {
      show({ ...F, supersedes: null, superseded_by: null })
      await ready()
      expect(screen.queryByText('Replaces')).not.toBeInTheDocument()
      expect(screen.queryByText('Replaced by')).not.toBeInTheDocument()
    })
  })

  describe('tags and topic', () => {
    it('lists the tags, topic tags marked as such', async () => {
      show()
      await ready()
      const tags = within(detail('Tags'))
      expect(tags.getByRole('button', { name: 'sla' })).toHaveClass('tag')
      expect(tags.getByRole('button', { name: 'sla' })).not.toHaveClass('topic')
      expect(tags.getByRole('button', { name: 'sla' })).toHaveAttribute('data-tip', 'Show facts with this tag')
      expect(tags.getByRole('button', { name: 'topic:audit' })).toHaveClass('tag', 'topic')
    })

    it.each([
      ['an empty list', { tags: [] }],
      ['no list at all', { tags: undefined }],
    ])('says "No tags" for %s', async (_what, over) => {
      show({ ...F, ...over })
      await ready()
      expect(detail('Tags')).toHaveTextContent('No tags')
      expect(within(detail('Tags')).queryByRole('button')).not.toBeInTheDocument()
    })

    it('opens Memory on the facts with a tag, dropping every other filter', async () => {
      setFilters({ q: 'weeks', type: 'DECISION', status: 'binding', topic: 'pricing', tag: 'old' })
      const { user, onClose } = show()
      await ready()
      await user.click(screen.getByRole('button', { name: 'topic:audit' }))
      expect(filters()).toEqual({ ...NO_FILTERS, tag: 'topic:audit' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('#/memory')
    })

    it('opens Memory on the topic of the fact, dropping every other filter', async () => {
      setFilters({ q: 'weeks', type: 'DECISION', status: 'binding', topic: 'pricing', tag: 'old' })
      const { user, onClose } = show()
      await ready()
      await user.click(await screen.findByRole('button', { name: 'Audit turnaround' }))
      expect(filters()).toEqual({ ...NO_FILTERS, topic: 'audit-turnaround' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('#/memory')
    })
  })

  describe('changed because…', () => {
    it('is absent for a fact nobody touched', async () => {
      show()
      await ready()
      await screen.findByText('No changes yet.')
      expect(screen.queryByText('Changed because…')).not.toBeInTheDocument()
    })

    it('says who retired the fact, when and why', async () => {
      show(RETIRED)
      await ready()
      expect(await screen.findByText('Retired by Giulia Ferri on 2 Mar, 10:30: Out of date')).toBeInTheDocument()
      expect(screen.getByText('Changed because…')).toBeInTheDocument()
    })

    it('says who retired the fact and when if no reason was given', async () => {
      show({ ...RETIRED, retired_reason: null, retired_by: 'mem-sara' })
      await ready()
      expect(await screen.findByText('Retired by Sara Conti on 2 Mar, 10:30.')).toBeInTheDocument()
    })

    it('shows the id of someone who is no longer a member', async () => {
      show({ ...RETIRED, retired_by: 'mem-gone' })
      await ready()
      expect(await screen.findByText('Retired by mem-gone on 2 Mar, 10:30: Out of date')).toBeInTheDocument()
    })

    it.each([
      ['the system', 'system'],
      ['nobody', null],
    ])('attributes a fact retired by %s to the system', async (_what, by) => {
      show({ ...RETIRED, retired_by: by })
      await ready()
      expect(await screen.findByText('Retired by System on 2 Mar, 10:30: Out of date')).toBeInTheDocument()
    })

    it('says who corrected the sentence, what it was and why', async () => {
      api.get('/facts/:id/history', [
        version({ version: 1 }),
        version({ version: 2, at: '2024-03-02T10:30:00Z', actor: 'mem-sara', action: 'patch', changes: { value: { from: '3 business days', to: F.value } } }),
      ])
      api.get('/audit', audit([auditEvent({ id: 'A-2', action: 'patch', actor: 'mem-sara', fact_id: F.id, reason: 'The minutes say three to four.' })]))
      show()
      await ready()
      expect(await screen.findByText('Corrected by Sara Conti. Was “3 business days”. The minutes say three to four.')).toBeInTheDocument()
    })

    it('describes the latest correction when there are several', async () => {
      api.get('/facts/:id/history', [
        version({ version: 3, actor: 'mem-marco', action: 'patch', changes: { value: { from: 'second', to: F.value } } }),
        version({ version: 2, actor: 'mem-sara', action: 'patch', changes: { value: { from: 'first', to: 'second' } } }),
        // A later change that did not touch the sentence does not count as a correction.
        version({ version: 4, actor: 'mem-giulia', action: 'patch', changes: { tags: { from: [], to: ['sla'] } } }),
      ])
      show()
      await ready()
      expect(await screen.findByText('Corrected by Marco Fiore. Was “second”.')).toBeInTheDocument()
    })

    it('prefers the correction over the pin', async () => {
      api.get('/facts/:id/history', [version({ version: 2, actor: 'mem-sara', action: 'patch', changes: { value: { from: 'before', to: F.value } } })])
      api.get('/audit', audit([auditEvent({ id: 'A-3', action: 'pin', actor: 'mem-marco', reason: 'Signed off' })]))
      show({ ...F, pinned: true })
      await ready()
      expect(await screen.findByText('Corrected by Sara Conti. Was “before”.')).toBeInTheDocument()
      expect(screen.queryByText(/Pinned as binding by/)).not.toBeInTheDocument()
    })

    it('says who pinned the fact and why', async () => {
      // The events may also come wrapped in `{ items }`.
      api.get('/audit', { items: [auditEvent({ id: 'A-3', action: 'pin', actor: 'mem-marco', fact_id: F.id, reason: 'The client signed this off.' })] })
      show({ ...F, pinned: true })
      await ready()
      expect(await screen.findByText('Pinned as binding by Marco Fiore. The client signed this off.')).toBeInTheDocument()
    })

    it('attributes a pin without an event to the system', async () => {
      api.get('/audit', { total: 0 })
      show({ ...F, pinned: true })
      await ready()
      expect(await screen.findByText('Pinned as binding by System.')).toBeInTheDocument()
    })

    it('ignores the corrections of a retired fact', async () => {
      api.get('/facts/:id/history', [version({ version: 2, actor: 'mem-sara', action: 'patch', changes: { value: { from: 'before', to: F.value } } })])
      show(RETIRED)
      await ready()
      expect(await screen.findByText('Retired by Giulia Ferri on 2 Mar, 10:30: Out of date')).toBeInTheDocument()
      expect(screen.queryByText(/Corrected by/)).not.toBeInTheDocument()
    })
  })

  describe('timeline', () => {
    it('lists the facts of the topic oldest first, with date, source and state', async () => {
      show()
      await ready()
      await screen.findByText('Audit turnaround · oldest first')
      const [first, second] = timeline()
      expect(timeline()).toHaveLength(2)
      expect(first).toHaveTextContent('5 business days')
      expect(first).toHaveTextContent('2 Oct 2025 · Email to ClearPath')
      expect(within(first).getByText('Still active')).toHaveClass('badge', 'conflict')
      expect(first).toHaveClass('conflict')
      expect(first).not.toHaveClass('current')

      expect(second).toHaveTextContent('3–4 business days')
      expect(second).toHaveTextContent('20 Nov 2025 · Final presentation · this fact')
      expect(within(second).getByText('Binding')).toHaveClass('badge', 'binding')
      expect(second).toHaveClass('binding', 'current')
    })

    it('opens another fact of the timeline, but not the one already open', async () => {
      const { user, app } = show()
      await ready()
      await screen.findByText('Audit turnaround · oldest first')
      const [first, second] = timeline()
      expect(within(second).queryByRole('button')).not.toBeInTheDocument()
      await user.click(within(first).getByRole('button'))
      expect(app.openFact).toHaveBeenCalledTimes(1)
      expect(app.openFact).toHaveBeenCalledWith('M-201')
    })

    it('shows placeholders while the timeline loads', async () => {
      const gate = deferred<Chain>()
      api.get('/topics/:id/chain', () => gate.promise)
      show()
      await ready()
      await screen.findByText('No changes yet.')
      expect(drawer().querySelectorAll('.skel')).toHaveLength(3)
      expect(timeline()).toHaveLength(0)

      gate.resolve(CHAIN)
      await waitFor(() => expect(timeline()).toHaveLength(2))
      expect(drawer().querySelectorAll('.skel')).toHaveLength(0)
    })

    it('shows only this fact when the timeline cannot be loaded', async () => {
      api.get('/topics/:id/chain', fail(500, 'boom'))
      show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(1))
      expect(timeline()[0]).toHaveTextContent('3–4 business days')
      expect(timeline()[0]).toHaveTextContent('20 Nov 2025 · final presentation · this fact')
      expect(header().getByText('Binding')).toBeInTheDocument()
    })

    it('adds the fact to a timeline that does not have it yet', async () => {
      api.get('/topics/:id/chain', chainOf(OLD))
      show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(2))
      expect(timeline()[1]).toHaveTextContent('3–4 business days')
      expect(timeline()[1]).toHaveClass('current')
    })

    it('ignores a timeline that belongs to another topic', async () => {
      const gate = deferred<Chain>()
      api.get('/topics/:id/chain', () => gate.promise)
      show()
      await ready()
      await screen.findByText('No changes yet.')
      gate.resolve({ topic: topic({ id: 'pricing', label: 'Pricing' }), facts: [fact({ id: 'M-301', topic: 'pricing', value: '€40k fixed fee' })] })
      // The placeholders go when the answer is in.
      await waitFor(() => expect(drawer().querySelectorAll('.skel')).toHaveLength(0))
      expect(timeline()).toHaveLength(1)
      expect(timeline()[0]).toHaveTextContent('3–4 business days')
      expect(screen.queryByText('€40k fixed fee')).not.toBeInTheDocument()
    })

    it('trusts the fact over the copy in the timeline', async () => {
      api.get('/topics/:id/chain', chainOf({ ...F, value: 'An outdated sentence', status: 'retired', doc_title: 'Final presentation' }, OLD))
      show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(2))
      expect(screen.queryByText('An outdated sentence')).not.toBeInTheDocument()
      expect(within(timeline()[1]).getByText('Binding')).toBeInTheDocument()
      expect(timeline()[1]).toHaveTextContent('Final presentation')
    })

    it('marks newer facts held back by a pin and retired ones', async () => {
      const pinned = { ...OLD, pinned: true, superseded_by: null }
      const gone = fact({ id: 'M-200', topic: TOPIC.id, value: 'Ten business days', date: '2025-09-01', status: 'retired' })
      api.get('/topics/:id/chain', chainOf(F, pinned, gone))
      show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(3))
      const [first, second, third] = timeline()
      expect(within(first).getByText('Retired')).toHaveClass('badge', 'retired')
      expect(within(first).getByText('Ten business days')).toHaveClass('strike')
      expect(within(second).getByText('Binding')).toBeInTheDocument()
      expect(within(third).getByText('Newer · held by pin')).toHaveClass('badge', 'held')
      expect(third).not.toHaveClass('binding')
      expect(header().getByText('Newer · held by pin')).toBeInTheDocument()
    })
  })

  describe('dependents', () => {
    const DEPENDENTS: Dependents = {
      fact_id: F.id,
      facts: [fact({ id: 'M-400', topic: 'staffing', value: 'The staffing plan assumes four days' })],
      conflicts: ['C-7'],
      answers: [{ id: 'ANS-1', question: 'How long does an audit take?', asked_at: '2024-03-02T10:30:00Z', status: 'binding' }],
    }

    it('is absent when nothing depends on the fact', async () => {
      show()
      await ready()
      await screen.findByText('No changes yet.')
      await waitFor(() => expect(api.callsTo('GET', '/facts/:id/dependents')).toHaveLength(1))
      expect(screen.queryByText('Dependents')).not.toBeInTheDocument()
    })

    it('is absent when the dependents cannot be loaded', async () => {
      api.get('/facts/:id/dependents', fail(500, 'boom'))
      show()
      await ready()
      await screen.findByText('No changes yet.')
      expect(screen.queryByText('Dependents')).not.toBeInTheDocument()
    })

    it('lists the facts, conflicts and answers that depend on the fact', async () => {
      api.get('/facts/:id/dependents', DEPENDENTS)
      show()
      await ready()
      expect(await screen.findByRole('heading', { name: 'Dependents' })).toBeInTheDocument()
      const dependent = screen.getByRole('button', { name: /The staffing plan assumes four days/ })
      expect(dependent).toHaveTextContent('Depends on it')
      expect(dependent).toHaveTextContent('M-400')
      expect(screen.getByRole('link', { name: /C-7/ })).toHaveTextContent('Conflict')
      const answer = screen.getByText('How long does an audit take?').parentElement!
      expect(answer).toHaveTextContent('Answer')
      expect(answer).toHaveTextContent('2 Mar, 10:30')
    })

    it('opens a dependent fact', async () => {
      api.get('/facts/:id/dependents', DEPENDENTS)
      const { user, app } = show()
      await ready()
      await user.click(await screen.findByRole('button', { name: /The staffing plan assumes four days/ }))
      expect(app.openFact).toHaveBeenCalledWith('M-400')
    })

    it('goes to the conflicts and closes when a conflict is clicked', async () => {
      api.get('/facts/:id/dependents', { ...DEPENDENTS, facts: [], answers: [] })
      const { user, onClose } = show()
      await ready()
      const link = await screen.findByRole('link', { name: /C-7/ })
      expect(link).toHaveAttribute('href', '#/conflicts')
      await user.click(link)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('#/conflicts')
    })

    it('shows the section for answers alone', async () => {
      api.get('/facts/:id/dependents', { ...DEPENDENTS, facts: [], conflicts: [] })
      show()
      await ready()
      expect(await screen.findByText('How long does an audit take?')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Dependents' })).toBeInTheDocument()
      expect(screen.queryByText('Depends on it')).not.toBeInTheDocument()
      expect(screen.queryByText('Conflict')).not.toBeInTheDocument()
    })
  })

  describe('history', () => {
    it('says when nothing changed yet', async () => {
      show()
      await ready()
      expect(await screen.findByText('No changes yet.')).toBeInTheDocument()
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    })

    it('shows placeholders while the history loads', async () => {
      const gate = deferred<Version[]>()
      api.get('/facts/:id/history', () => gate.promise)
      show()
      await ready()
      await screen.findByText('Audit turnaround · oldest first')
      expect(drawer().querySelectorAll('.skel')).toHaveLength(2)
      expect(screen.queryByText('No changes yet.')).not.toBeInTheDocument()

      gate.resolve([version()])
      expect(await screen.findByText('added it')).toBeInTheDocument()
      expect(drawer().querySelectorAll('.skel')).toHaveLength(0)
    })

    it('says "No changes yet." when the history cannot be loaded', async () => {
      api.get('/facts/:id/history', fail(500, 'boom'))
      show()
      await ready()
      expect(await screen.findByText('No changes yet.')).toBeInTheDocument()
    })

    it('lists the changes newest first, with who did what and when', async () => {
      api.get('/facts/:id/history', [
        version({ version: 1, at: '2024-03-01T09:00:00Z', actor: 'system', action: 'ingest' }),
        version({ version: 3, at: '2024-03-03T16:45:00Z', actor: 'mem-gone', action: 'pin' }),
        version({ version: 2, at: '2024-03-02T10:30:00Z', actor: 'mem-sara', action: 'retire' }),
      ])
      show()
      await ready()
      await screen.findByText('Sara Conti')
      const rows = historyRows()
      expect(rows).toHaveLength(3)
      expect(rows[0]).toHaveTextContent('mem-gone pinned it · 3 Mar, 16:45')
      expect(rows[1]).toHaveTextContent('Sara Conti retired it · 2 Mar, 10:30')
      expect(rows[2]).toHaveTextContent('System added it · 1 Mar, 09:00')
    })

    it('shows the initial of a person and no initial for the system', async () => {
      api.get('/facts/:id/history', [version({ version: 1 }), version({ version: 2, actor: 'mem-sara', action: 'retire' })])
      show()
      await ready()
      await screen.findByText('Sara Conti')
      const [sara, system] = historyRows()
      expect(sara.querySelector('.avatar')).toHaveTextContent('S')
      expect(system.querySelector('.avatar')).toHaveTextContent('')
      expect(system.querySelector('.avatar')).toHaveClass('sys')
    })

    it.each([
      ['retire', 'retired it'],
      ['restore', 'restored it'],
      ['patch', 'corrected it'],
      ['pin', 'pinned it'],
      ['unpin', 'unpinned it'],
      ['supersede', 'linked a newer version'],
      ['undo', 'undid a change'],
    ] as const)('describes a "%s" as "%s"', async (action, words) => {
      api.get('/facts/:id/history', [version({ version: 2, actor: 'mem-sara', action })])
      show()
      await ready()
      expect(await screen.findByText(words)).toBeInTheDocument()
    })

    it('shows the reason of each change, matched by what happened and when', async () => {
      api.get('/facts/:id/history', [
        version({ version: 1, at: '2024-03-01T09:00:00Z' }),
        version({ version: 2, at: '2024-03-02T10:30:00Z', actor: 'mem-sara', action: 'patch', changes: { value: { from: 'a', to: 'b' } } }),
        version({ version: 3, at: '2024-03-03T16:45:00Z', actor: 'mem-marco', action: 'patch', changes: { value: { from: 'b', to: F.value } } }),
      ])
      // Oldest first on purpose: the reasons are matched by time, not by position.
      api.get(
        '/audit',
        audit([
          auditEvent({ id: 'A-2', at: '2024-03-02T10:30:00Z', action: 'patch', actor: 'mem-sara', reason: 'First fix' }),
          auditEvent({ id: 'A-3', at: '2024-03-03T16:45:00Z', action: 'patch', actor: 'mem-marco', reason: 'Second fix' }),
        ]),
      )
      show()
      await ready()
      await screen.findByText('Second fix')
      const rows = historyRows()
      expect(rows[0]).toHaveTextContent('Marco Fiore corrected it · 3 Mar, 16:45')
      expect(within(rows[0]).getByText('Second fix')).toBeInTheDocument()
      expect(rows[1]).toHaveTextContent('Sara Conti corrected it · 2 Mar, 10:30')
      expect(within(rows[1]).getByText('First fix')).toBeInTheDocument()
      expect(rows[2]).toHaveTextContent(/^System added it · 1 Mar, 09:00$/)
    })

    it('lists the changes without reasons when the events cannot be loaded', async () => {
      api.get('/facts/:id/history', [version({ version: 2, at: '2024-03-02T10:30:00Z', actor: 'mem-sara', action: 'pin' })])
      api.get('/audit', fail(500, 'boom'))
      show({ ...F, pinned: true })
      await ready()
      expect(await screen.findByText('Sara Conti')).toBeInTheDocument()
      expect(historyRows()[0]).toHaveTextContent(/^SSara Conti pinned it · 2 Mar, 10:30$/)
      expect(screen.getByText('Pinned as binding by System.')).toBeInTheDocument()
    })

    it('gives each change its own reason when the times do not line up', async () => {
      api.get('/facts/:id/history', [
        version({ version: 2, at: '2024-03-02T10:30:00Z', actor: 'mem-sara', action: 'patch' }),
        version({ version: 3, at: '2024-03-03T16:45:00Z', actor: 'mem-marco', action: 'patch' }),
        version({ version: 4, at: '2024-03-04T08:00:00Z', actor: 'mem-giulia', action: 'patch' }),
      ])
      api.get(
        '/audit',
        audit([
          auditEvent({ id: 'A-3', at: '2024-03-03T16:45:01Z', action: 'patch', reason: 'Newer reason' }),
          auditEvent({ id: 'A-2', at: '2024-03-02T10:30:01Z', action: 'patch', reason: 'Older reason' }),
          auditEvent({ id: 'A-1', at: '2024-03-01T09:00:00Z', action: 'retire', reason: 'Not about a correction' }),
        ]),
      )
      show()
      await ready()
      await screen.findByText('Newer reason')
      const rows = historyRows()
      expect(within(rows[0]).getByText('Newer reason')).toBeInTheDocument()
      expect(within(rows[1]).getByText('Older reason')).toBeInTheDocument()
      // Two events for three corrections: the last one has no reason, and the retire reason is not borrowed.
      expect(rows[2]).toHaveTextContent(/^SSara Conti corrected it · 2 Mar, 10:30$/)
      expect(screen.queryByText('Not about a correction')).not.toBeInTheDocument()
    })
  })

  describe('closing', () => {
    it('closes with the Close button', async () => {
      const { user, onClose } = show()
      await ready()
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on Escape', async () => {
      const { user, onClose } = show()
      await ready()
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes when the page behind is clicked', async () => {
      const { user, onClose } = show()
      await ready()
      await user.click(document.querySelector('.scrim')!)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('actions on offer', () => {
    it('offers Correct, Retire and Pin on an active fact', async () => {
      show()
      await ready()
      for (const name of ['Correct', 'Retire', 'Pin as binding']) {
        expect(screen.getByRole('button', { name })).toBeEnabled()
        expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-disabled')
      }
      expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Unpin' })).not.toBeInTheDocument()
      expect(panelOpen()).toBe(false)
    })

    it('offers Unpin on a pinned fact', async () => {
      show({ ...F, pinned: true })
      await ready()
      expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Pin as binding' })).not.toBeInTheDocument()
    })

    it('offers Restore instead of Retire on a retired fact, and explains why it cannot be pinned', async () => {
      const { user } = show(RETIRED)
      await ready()
      expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retire' })).not.toBeInTheDocument()
      const pin = screen.getByRole('button', { name: 'Pin as binding' })
      expect(pin).toHaveAttribute('aria-disabled', 'true')
      expect(pin).toHaveAttribute('data-tip', 'Retired facts cannot be pinned. Restore it first.')

      await user.click(pin)
      expect(await screen.findByText('Retired facts cannot be pinned. Restore it first.')).toBeInTheDocument()
      expect(panelOpen()).toBe(false)
    })

    it.each([
      ['Correct', F],
      ['Retire', F],
      ['Pin as binding', F],
      ['Unpin', { ...F, pinned: true }],
      ['Restore', RETIRED],
    ])('a viewer sees %s greyed out and a click only explains why', async (name, f) => {
      const { user } = show(f, { me: me({ as: MEMBERS.luca }) })
      await ready()
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(button)
      expect(await screen.findByText('Requires editor')).toBeInTheDocument()
      expect(panelOpen()).toBe(false)
      expect(writes()).toEqual([])
    })

    it.each([
      ['an editor', MEMBERS.sara],
      ['an admin', MEMBERS.marco],
    ])('%s can change a fact', async (_who, member) => {
      const { user } = show(F, { me: me({ as: member }) })
      await ready()
      const retire = screen.getByRole('button', { name: 'Retire' })
      expect(retire).not.toHaveAttribute('aria-disabled')
      await user.click(retire)
      expect(panelOpen()).toBe(true)
      expect(confirmButton('Retire')).not.toHaveAttribute('aria-disabled')
    })
  })

  describe('the action panel', () => {
    it.each([
      ['Retire', F, 'Retire this fact', 'It stays in history, marked as retired. Answers stop using it.', 'Reason'],
      ['Restore', RETIRED, 'Restore this fact', 'It becomes active again and can be used in answers.', 'Reason (optional)'],
      ['Correct', F, 'Correct this fact', 'The corrected sentence is used from the next answer on. The original stays in history.', 'Reason'],
      ['Pin as binding', F, 'Pin as binding', 'Pinned facts win over newer versions until unpinned. One pin per topic: pinning this replaces the current pin.', 'Reason'],
      ['Unpin', { ...F, pinned: true }, 'Unpin', 'Precedence goes back to dates and supersedes links.', 'Reason'],
    ])('%s opens a panel that explains what will happen and asks for a reason', async (name, f, title, help, label) => {
      const { user } = show(f)
      await ready()
      await begin(user, name)
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
      expect(screen.getByText(help)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: label })).toHaveValue('')
      expect(screen.getByPlaceholderText('Why are you changing this? It is shown in history and the audit log.')).toBe(reason())
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(writes()).toEqual([])
    })

    it('puts the cursor in the reason', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await waitFor(() => expect(reason()).toHaveFocus())
      expect(screen.queryByRole('textbox', { name: 'Corrected sentence' })).not.toBeInTheDocument()
    })

    it('starts a correction from the current sentence, with the cursor in it', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Correct')
      const sentence = screen.getByRole('textbox', { name: 'Corrected sentence' })
      expect(sentence).toHaveValue('3–4 business days')
      await waitFor(() => expect(sentence).toHaveFocus())
    })

    it('closes on Cancel without changing anything, and starts empty the next time', async () => {
      const { user, app } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Never mind')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(panelOpen()).toBe(false)
      expect(writes()).toEqual([])
      expect(app.refresh).not.toHaveBeenCalled()

      await begin(user, 'Retire')
      expect(reason()).toHaveValue('')
    })

    it('switches to another action, starting it afresh', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Wrong action')
      await begin(user, 'Correct')
      expect(screen.getByText('Correct this fact')).toBeInTheDocument()
      expect(screen.queryByText('Retire this fact')).not.toBeInTheDocument()
      expect(reason()).toHaveValue('')
      expect(screen.getByRole('textbox', { name: 'Corrected sentence' })).toHaveValue('3–4 business days')
    })

    it('warns which pin will be replaced', async () => {
      api.get('/topics/:id/chain', chainOf(F, { ...OLD, pinned: true }, fact({ id: 'M-199', topic: TOPIC.id, value: 'Ten business days', date: '2025-08-01', pinned: true })))
      const { user } = show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(3))
      await begin(user, 'Pin as binding')
      expect(screen.getByText('Replaces the current pin on Ten business days, 5 business days')).toBeInTheDocument()
    })

    it('does not warn about pins that are retired, or when unpinning', async () => {
      api.get('/topics/:id/chain', chainOf(F, { ...OLD, pinned: true, status: 'retired' }))
      const { user } = show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(2))
      await begin(user, 'Pin as binding')
      expect(screen.queryByText(/Replaces the current pin/)).not.toBeInTheDocument()
    })

    it('does not warn about another pin when unpinning', async () => {
      api.get('/topics/:id/chain', chainOf({ ...F, pinned: true }, { ...OLD, pinned: true }))
      const { user } = show({ ...F, pinned: true })
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(2))
      await begin(user, 'Unpin')
      expect(screen.getByText('Precedence goes back to dates and supersedes links.')).toBeInTheDocument()
      expect(screen.queryByText(/Replaces the current pin/)).not.toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it.each([
      ['Retire', 'Retire', F],
      ['Pin as binding', 'Pin', F],
      ['Unpin', 'Unpin', { ...F, pinned: true }],
      ['Correct', 'Correct', F],
    ])('%s needs a reason: nothing is sent without one', async (start, confirm, f) => {
      const { user, app } = show(f)
      await ready()
      await begin(user, start)
      await user.click(confirmButton(confirm))
      expect(screen.getByText('A reason is required.')).toBeInTheDocument()
      expect(reason()).toHaveClass('invalid')
      expect(panelOpen()).toBe(true)
      expect(writes()).toEqual([])
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('does not take spaces for a reason', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), '   ')
      await user.click(confirmButton('Retire'))
      expect(screen.getByText('A reason is required.')).toBeInTheDocument()
      expect(writes()).toEqual([])
    })

    it('takes the error away as soon as a reason is typed', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.click(confirmButton('Retire'))
      expect(screen.getByText('A reason is required.')).toBeInTheDocument()
      await user.type(reason(), 'O')
      expect(screen.queryByText('A reason is required.')).not.toBeInTheDocument()
      expect(reason()).not.toHaveClass('invalid')
    })

    it('a correction needs a sentence too', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Correct')
      const sentence = screen.getByRole('textbox', { name: 'Corrected sentence' })
      await user.clear(sentence)
      await user.type(reason(), 'Typo')
      await user.click(confirmButton('Correct'))
      expect(screen.getByText('Write the corrected sentence.')).toBeInTheDocument()
      expect(sentence).toHaveClass('invalid')
      expect(screen.queryByText('A reason is required.')).not.toBeInTheDocument()
      expect(writes()).toEqual([])

      await user.type(sentence, '4')
      expect(screen.queryByText('Write the corrected sentence.')).not.toBeInTheDocument()
      expect(sentence).not.toHaveClass('invalid')
    })

    it('points at both the sentence and the reason when both are missing', async () => {
      const { user } = show()
      await ready()
      await begin(user, 'Correct')
      await user.clear(screen.getByRole('textbox', { name: 'Corrected sentence' }))
      await user.type(screen.getByRole('textbox', { name: 'Corrected sentence' }), '  ')
      await user.click(confirmButton('Correct'))
      expect(screen.getByText('Write the corrected sentence.')).toBeInTheDocument()
      expect(screen.getByText('A reason is required.')).toBeInTheDocument()
      expect(writes()).toEqual([])
    })
  })

  describe('carrying out an action', () => {
    it.each([
      ['Retire', 'Retire', F, 'POST', '/facts/:id/retire', 'Fact retired. The next answer will not use it.'],
      ['Pin as binding', 'Pin', F, 'POST', '/facts/:id/pin', 'Pinned as binding.'],
      ['Unpin', 'Unpin', { ...F, pinned: true }, 'POST', '/facts/:id/unpin', 'Unpinned.'],
      ['Restore', 'Restore', RETIRED, 'POST', '/facts/:id/restore', 'Fact restored.'],
    ])('%s sends who and why, refreshes and confirms', async (start, confirm, f, method, path, done) => {
      api.on(method, path, F)
      const { user, app } = show(f)
      await ready()
      await begin(user, start)
      await user.type(reason(), '  The client asked for it.  ')
      await user.click(confirmButton(confirm))

      expect(await screen.findByText(done)).toBeInTheDocument()
      expect(writes()).toHaveLength(1)
      const sent = api.last(method, path)!
      expect(sent.params.id).toBe('M-202')
      expect(sent.body).toEqual({ actor: 'Giulia', reason: 'The client asked for it.' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(panelOpen()).toBe(false)
    })

    it('corrects the sentence with the new text and the reason', async () => {
      api.patch('/facts/:id', F)
      const { user, app } = show()
      await ready()
      await begin(user, 'Correct')
      const sentence = screen.getByRole('textbox', { name: 'Corrected sentence' })
      await user.clear(sentence)
      await user.type(sentence, '  Three business days ')
      await user.type(reason(), 'The contract says three.')
      await user.click(confirmButton('Correct'))

      expect(await screen.findByText('Fact corrected. The next answer uses the new sentence.')).toBeInTheDocument()
      const sent = api.last('PATCH', '/facts/:id')!
      expect(sent.params.id).toBe('M-202')
      expect(sent.body).toEqual({ actor: 'Giulia', reason: 'The contract says three.', value: 'Three business days' })
      expect(writes()).toHaveLength(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(panelOpen()).toBe(false)
    })

    it('restores without a reason when none is given', async () => {
      api.post('/facts/:id/restore', F)
      const { user } = show(RETIRED)
      await ready()
      await begin(user, 'Restore')
      await user.click(confirmButton('Restore'))
      expect(await screen.findByText('Fact restored.')).toBeInTheDocument()
      expect(api.last('POST', '/facts/:id/restore')!.body).toEqual({ actor: 'Giulia' })
    })

    it('acts in the name of the current person', async () => {
      api.post('/facts/:id/retire', F)
      const { user } = show(F, { me: me({ as: MEMBERS.sara }) })
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.click(confirmButton('Retire'))
      await screen.findByText('Fact retired. The next answer will not use it.')
      expect(api.last('POST', '/facts/:id/retire')!.body).toEqual({ actor: 'Sara', reason: 'Out of date' })
    })

    it.each([
      ['Control', '{Control>}{Enter}{/Control}'],
      ['Command', '{Meta>}{Enter}{/Meta}'],
    ])('confirms with %s+Enter in the reason', async (_key, keys) => {
      api.post('/facts/:id/retire', F)
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.keyboard(keys)
      expect(await screen.findByText('Fact retired. The next answer will not use it.')).toBeInTheDocument()
      expect(api.last('POST', '/facts/:id/retire')!.body).toEqual({ actor: 'Giulia', reason: 'Out of date' })
    })

    it('a plain Enter in the reason starts a new line', async () => {
      api.post('/facts/:id/retire', F)
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date{Enter}since March')
      expect(reason()).toHaveValue('Out of date\nsince March')
      expect(writes()).toEqual([])
    })

    it('cannot be confirmed twice while it runs', async () => {
      const gate = deferred<Fact>()
      api.post('/facts/:id/retire', () => gate.promise)
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.click(confirmButton('Retire'))
      expect(confirmButton('Retire')).toBeDisabled()
      await user.click(confirmButton('Retire'))
      expect(api.callsTo('POST', '/facts/:id/retire')).toHaveLength(1)

      gate.resolve(F)
      expect(await screen.findByText('Fact retired. The next answer will not use it.')).toBeInTheDocument()
    })

    it('says which pin was replaced', async () => {
      api.post('/facts/:id/pin', F)
      api.get('/topics/:id/chain', chainOf(F, { ...OLD, pinned: true }))
      const { user } = show()
      await ready()
      await waitFor(() => expect(timeline()).toHaveLength(2))
      await begin(user, 'Pin as binding')
      await user.type(reason(), 'Signed off')
      await user.click(confirmButton('Pin'))
      expect(await screen.findByText('Pinned as binding. Replaced the pin on 5 business days.')).toBeInTheDocument()
    })
  })

  describe('when an action fails', () => {
    it('says why, keeps the panel with what was typed and lets it be tried again', async () => {
      api.post('/facts/:id/retire', fail(500, 'database is locked'))
      const { user, app } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.click(confirmButton('Retire'))

      expect(await screen.findByText('That did not work. database is locked')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(reason()).toHaveValue('Out of date')
      await waitFor(() => expect(confirmButton('Retire')).toBeEnabled())
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()

      api.post('/facts/:id/retire', F)
      await user.click(confirmButton('Retire'))
      expect(await screen.findByText('Fact retired. The next answer will not use it.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/facts/:id/retire')).toHaveLength(2)
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('still says why when the panel was cancelled before the answer came', async () => {
      const gate = deferred<Response>()
      api.post('/facts/:id/retire', () => gate.promise)
      const { user, app } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.click(confirmButton('Retire'))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(panelOpen()).toBe(false)

      gate.resolve(fail(500, 'database is locked'))
      expect(await screen.findByText('That did not work. database is locked')).toBeInTheDocument()
      expect(panelOpen()).toBe(false)
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('shows the words of the backend alone when the fact changed meanwhile', async () => {
      api.post('/facts/:id/retire', fail(409, 'This fact was retired a moment ago by Sara.'))
      const { user } = show()
      await ready()
      await begin(user, 'Retire')
      await user.type(reason(), 'Out of date')
      await user.click(confirmButton('Retire'))
      expect(await screen.findByText('This fact was retired a moment ago by Sara.')).toBeInTheDocument()
      expect(screen.queryByText(/That did not work/)).not.toBeInTheDocument()
      expect(panelOpen()).toBe(true)
    })

    it('says so when the backend cannot be reached', async () => {
      api.patch('/facts/:id', offline)
      const { user } = show()
      await ready()
      await begin(user, 'Correct')
      await user.type(reason(), 'Typo')
      await user.click(confirmButton('Correct'))
      expect(await screen.findByText('That did not work. network')).toBeInTheDocument()
      expect(panelOpen()).toBe(true)
    })

    it('a person who lost the right meanwhile is told so, after the form is complete', async () => {
      api.post('/facts/:id/retire', F)
      const view = mount()
      await ready()
      await begin(view.user, 'Retire')
      view.update({ me: me({ as: MEMBERS.luca }) })
      const confirm = confirmButton('Retire')
      expect(confirm).toHaveAttribute('aria-disabled', 'true')
      expect(confirm).toHaveAttribute('data-tip', 'Requires editor')

      await view.user.click(confirm)
      expect(screen.getByText('A reason is required.')).toBeInTheDocument()
      expect(screen.queryByText('Requires editor')).not.toBeInTheDocument()

      await view.user.type(reason(), 'Out of date')
      await view.user.click(confirmButton('Retire'))
      expect(await screen.findByText('Requires editor')).toBeInTheDocument()
      expect(panelOpen()).toBe(true)
      expect(writes()).toEqual([])
    })
  })

  describe('undo from the toast', () => {
    const LATEST = auditEvent({ id: 'A-9', action: 'retire', fact_id: F.id, reason: 'Out of date' })

    async function retire(over: Partial<AppState> = {}) {
      api.post('/facts/:id/retire', F)
      const view = show(F, over)
      await ready()
      await begin(view.user, 'Retire')
      await view.user.type(reason(), 'Out of date')
      await view.user.click(confirmButton('Retire'))
      await screen.findByText('Fact retired. The next answer will not use it.')
      return view
    }

    it('offers Undo for the event the action left behind', async () => {
      api.get('/audit', audit([], [LATEST]))
      await retire()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      const lookup = api.callsTo('GET', '/audit').filter((c) => c.query.get('limit') === '1')
      expect(lookup).toHaveLength(1)
      expect(lookup[0].query.get('fact_id')).toBe('M-202')
    })

    it.each([
      ['there is no event', audit([], [])],
      ['the events cannot be read', (req: Req) => (req.query.get('limit') === '1' ? fail(500, 'boom') : [])],
    ])('confirms without Undo when %s', async (_what, answer) => {
      api.get('/audit', answer)
      await retire()
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    })

    it('undoes the action, refreshes and says so', async () => {
      api.get('/audit', audit([], [LATEST]))
      api.post('/audit/:id/undo', {})
      const { user, app } = await retire({ me: me({ as: MEMBERS.sara }) })
      await user.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Undone. The fact is back as before.')).toBeInTheDocument()
      const sent = api.last('POST', '/audit/:id/undo')!
      expect(sent.params.id).toBe('A-9')
      expect(sent.body).toEqual({ actor: 'Sara', reason: 'Undone from the toast.' })
      expect(app.refresh).toHaveBeenCalledTimes(2)
    })

    it('says why when the undo fails', async () => {
      api.get('/audit', audit([], [LATEST]))
      api.post('/audit/:id/undo', fail(409, 'Already undone'))
      const { user, app } = await retire()
      await user.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('That did not work. Already undone')).toBeInTheDocument()
      expect(screen.queryByText('Undone. The fact is back as before.')).not.toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })
  })
})
