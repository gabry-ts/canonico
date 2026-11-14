import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import { I18nProvider } from '../../src/i18n'
import { AppContext, type AppState } from '../../src/lib/appContext'
import Memory from '../../src/screens/Memory'
import { NO_FILTERS, setFilters } from '../../src/screens/memory/api'
import { setTopbarSlot } from '../../src/shell/topbarSlot'
import { Ic } from '../../src/ui/Icon'
import { Toaster } from '../../src/ui/Toaster'
import { api, deferred, fail, type Req } from '../helpers/api'
import { fact, topic } from '../helpers/fixtures'
import { goto, makeApp, renderWithApp } from '../helpers/render'

type Fact = Schemas['Fact']

/** Nine facts in three topics, one for every display state. */
const FACTS: Fact[] = [
  // onboarding-target: superseded, retired, binding
  fact({ id: 'M-101', value: '≈6 weeks', type: 'SUPERSEDED', doc_id: '01-scope/project-brief', quote: 'Roughly six weeks to autonomy.', date: '2025-08-22', tags: undefined }),
  fact({
    id: 'M-105',
    value: '4 weeks',
    status: 'retired',
    doc_id: '04-external-comms/email/email-external-012',
    quote: 'Four weeks should be enough.',
    date: '2025-10-02',
    retired_reason: 'Out of date',
  }),
  fact({ id: 'M-106', value: '3–4 weeks', tags: ['onboarding', 'topic:hr'] }),
  // audit-turnaround: still active (conflict), binding, open question, plain active
  fact({
    id: 'M-201',
    topic: 'audit-turnaround',
    value: '5 business days',
    doc_id: '05-meetings/meeting-002-status',
    quote: 'We promise five business days.',
    date: '2025-10-02',
    superseded_by: 'M-202',
  }),
  fact({
    id: 'M-202',
    topic: 'audit-turnaround',
    value: '3–4 business days',
    doc_id: '05-meetings/meeting-005-final-presentation',
    quote: 'Turnaround drops to three or four business days.',
    date: '2025-11-20',
    supersedes: 'M-201',
  }),
  fact({
    id: 'M-203',
    topic: 'audit-turnaround',
    value: 'How fast must an urgent audit be?',
    type: 'OPEN',
    doc_id: '05-meetings/meeting-001-kickoff',
    quote: 'Nobody could say how fast an urgent audit must be.',
    date: '2025-09-12',
  }),
  fact({
    id: 'M-204',
    topic: 'audit-turnaround',
    value: '4.2 days on average',
    type: 'EVIDENCE',
    doc_id: 'library/benchmarks',
    quote: 'The measured average is 4.2 days.',
    date: '2025-09-15',
  }),
  // pricing: pinned binding and a newer fact held by the pin
  fact({
    id: 'M-301',
    topic: 'pricing',
    value: '€40k fixed fee',
    doc_id: 'upload-7/offer',
    quote: 'The fee is fixed at forty thousand.',
    date: '2025-09-01',
    pinned: true,
    tags: ['pricing'],
  }),
  fact({
    id: 'M-302',
    topic: 'pricing',
    value: '€45k fixed fee',
    doc_id: 'internal/price-list',
    quote: 'The new price list says forty-five thousand.',
    date: '2025-10-01',
    tags: ['pricing', 'topic:finance'],
  }),
]

// `pricing` has no topic record: the screen falls back to its id.
const TOPICS = [
  topic({ id: 'onboarding-target', label: 'Onboarding target', fact_ids: ['M-101', 'M-105', 'M-106'] }),
  topic({ id: 'audit-turnaround', label: 'Audit turnaround', fact_ids: ['M-201', 'M-202', 'M-203', 'M-204'] }),
]
const TAGS: Schemas['TagCount'][] = [
  { tag: 'onboarding', count: 1 },
  { tag: 'pricing', count: 2 },
]

const page = (items: Fact[], total = items.length): Schemas['FactPage'] => ({ items, total, limit: 500, offset: 0 })
const hit = (id: string, kind: 'fact' | 'document' = 'fact'): Schemas['SearchResult'] => ({ kind, id, score: 0.9, snippet: id, doc_id: 'doc', topic: null, type: null })
const hits = (...ids: string[]) => (req: Req): Schemas['SearchResponse'] => ({ query: req.query.get('q') ?? '', total: ids.length, results: ids.map((id) => hit(id)) })

/** `GET /facts` answers the list or, with `?tag=`, the facts carrying the tag. */
const listFacts = (all: Fact[]) => (req: Req) => {
  const tag = req.query.get('tag')
  return page(tag ? all.filter((f) => f.tags?.includes(tag)) : all)
}
const listCalls = () => api.callsTo('GET', '/facts').filter((c) => !c.query.has('tag'))
const tagCalls = () => api.callsTo('GET', '/facts').filter((c) => c.query.has('tag'))

/** The screen with a top bar slot for its Export button. */
const Screen = () => (
  <>
    <div ref={setTopbarSlot} />
    <Memory />
  </>
)

/** Like `renderWithApp`, but the app value can change after the first render (`update`). */
function mount(over: Partial<AppState> = {}) {
  let app = makeApp(over)
  const user = userEvent.setup()
  const tree = (value: AppState) => (
    <I18nProvider>
      <AppContext.Provider value={value}>
        <Screen />
        <Toaster />
      </AppContext.Provider>
    </I18nProvider>
  )
  const view = render(tree(app))
  return {
    user,
    get app() {
      return app
    },
    update(next: Partial<AppState>) {
      app = makeApp({ ...over, ...next })
      view.rerender(tree(app))
      return app
    },
  }
}

const row = (id: string) => screen.getByText(id).closest('button')!
const shownIds = () => screen.queryAllByText(/^M-\d+$/).map((el) => el.textContent)
const loaded = () => screen.findByText('3–4 weeks')
const searchBox = () => screen.getByRole('textbox', { name: 'Search facts' })
const section = (label: string) => screen.getByRole('button', { name: label }).closest('section')!
const sidebar = () => within(screen.getByRole('complementary'))
/** What `<Ic n={name} />` draws, to recognise an icon on screen. */
function iconOf(name: string) {
  const view = render(<Ic n={name} />)
  const html = view.container.querySelector('svg')!.innerHTML
  view.unmount()
  return html
}

beforeAll(() => {
  // jsdom has no object URLs and does not download: the export needs both to finish.
  URL.createObjectURL = () => 'blob:export'
  URL.revokeObjectURL = () => {}
})

beforeEach(() => {
  setFilters(NO_FILTERS)
  api.get('/facts', listFacts(FACTS))
  api.get('/topics', TOPICS)
  api.get('/tags', TAGS)
  api.get('/search', hits())
})

describe('Memory', () => {
  describe('loading the facts', () => {
    it('shows placeholders while the facts load, then the list', async () => {
      const gate = deferred<Schemas['FactPage']>()
      api.get('/facts', () => gate.promise)
      const { container } = renderWithApp(<Screen />)
      expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument()
      expect(container.querySelectorAll('.skel')).toHaveLength(8)
      expect(screen.getByText('0 of 0')).toBeInTheDocument()
      expect(screen.queryByText('No facts match')).not.toBeInTheDocument()

      gate.resolve(page(FACTS))
      expect(await loaded()).toBeInTheDocument()
      expect(container.querySelectorAll('.skel')).toHaveLength(0)
      expect(screen.getByText('9 of 9')).toBeInTheDocument()
      expect(screen.getByText('facts shown')).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('asks for the facts, topics and tags of the current project', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const facts = listCalls()
      expect(facts).toHaveLength(1)
      expect(Object.fromEntries(facts[0].query)).toEqual({ project_id: 'proj-clearpath', limit: '500', offset: '0' })
      expect(Object.fromEntries(api.last('GET', '/topics')!.query)).toEqual({ project_id: 'proj-clearpath' })
      expect(Object.fromEntries(api.last('GET', '/tags')!.query)).toEqual({ project_id: 'proj-clearpath' })
      expect(api.callsTo('GET', '/search')).toHaveLength(0)
    })

    it('asks for the whole organisation in organisation scope', async () => {
      const { user } = renderWithApp(<Screen />, { scope: 'org' })
      await loaded()
      expect(listCalls()[0].query.has('project_id')).toBe(false)
      expect(api.last('GET', '/topics')!.query.has('project_id')).toBe(false)
      expect(api.last('GET', '/tags')!.query.has('project_id')).toBe(false)

      await user.type(searchBox(), 'weeks')
      await waitFor(() => expect(api.callsTo('GET', '/search')).toHaveLength(1))
      expect(api.last('GET', '/search')!.query.has('project_id')).toBe(false)
      await user.selectOptions(screen.getByLabelText('Tag'), 'pricing')
      await waitFor(() => expect(tagCalls()).toHaveLength(1))
      expect(tagCalls()[0].query.has('project_id')).toBe(false)
    })

    it('loads every page of a long list', async () => {
      api.get('/facts', (req) => {
        const offset = Number(req.query.get('offset'))
        return { items: FACTS.slice(offset, offset + 4), total: FACTS.length, limit: 500, offset }
      })
      renderWithApp(<Screen />)
      expect(await screen.findByText('9 of 9')).toBeInTheDocument()
      expect(listCalls().map((c) => c.query.get('offset'))).toEqual(['0', '4', '8'])
      expect(shownIds()).toHaveLength(9)
    })

    it('shows the error and loads again on retry', async () => {
      api.get('/facts', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Screen />)
      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('Could not load this. database is locked')).toBeInTheDocument()

      api.get('/facts', listFacts(FACTS))
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await loaded()).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('says when the memory is empty, without offering to clear filters', async () => {
      api.get('/facts', page([]))
      renderWithApp(<Screen />)
      expect(await screen.findByText('No facts match')).toBeInTheDocument()
      expect(screen.getByText('Try another word, a document name or a fact id such as M-105.')).toBeInTheDocument()
      expect(screen.getByText('0 of 0')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear search and filters' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
      expect(sidebar().getByRole('button', { name: 'All topics0' })).toBeInTheDocument()
    })

    it('still lists the facts when topics and tags cannot be loaded', async () => {
      api.get('/topics', fail(500, 'no topics'))
      api.get('/tags', fail(500, 'no tags'))
      renderWithApp(<Screen />)
      await loaded()
      expect(shownIds()).toHaveLength(9)
      // Without topic records a group is named by its id.
      expect(screen.getByRole('button', { name: 'onboarding-target' })).toBeInTheDocument()
      expect(within(screen.getByLabelText('Tag')).getAllByRole('option')).toHaveLength(1)
    })

    it('loads again when the data version changes and keeps the list on screen meanwhile', async () => {
      const view = mount()
      await loaded()
      const gate = deferred<Schemas['FactPage']>()
      api.get('/facts', () => gate.promise)
      view.update({ version: 1 })
      await waitFor(() => expect(listCalls()).toHaveLength(2))
      expect(screen.getByText('3–4 weeks')).toBeInTheDocument()

      gate.resolve(page([fact({ id: 'M-900', value: 'Two weeks' })]))
      expect(await screen.findByText('Two weeks')).toBeInTheDocument()
      expect(screen.queryByText('3–4 weeks')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 1')).toBeInTheDocument()
      expect(api.callsTo('GET', '/topics')).toHaveLength(2)
      expect(api.callsTo('GET', '/tags')).toHaveLength(2)
    })

    it('keeps the list when a reload fails', async () => {
      const view = mount()
      await loaded()
      api.get('/facts', fail(500, 'database is locked'))
      view.update({ version: 1 })
      await waitFor(() => expect(listCalls()).toHaveLength(2))
      // Nothing on screen tells that the failed answer is in: give it a moment.
      await act(() => new Promise((r) => setTimeout(r, 50)))
      expect(screen.getByText('9 of 9')).toBeInTheDocument()
      expect(screen.getByText('3–4 weeks')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('loads the facts of the other project when the project changes', async () => {
      const view = mount()
      await loaded()
      view.update({ projectId: 'proj-internal' })
      await waitFor(() => expect(listCalls()).toHaveLength(2))
      expect(listCalls()[1].query.get('project_id')).toBe('proj-internal')
      await waitFor(() => expect(api.last('GET', '/tags')!.query.get('project_id')).toBe('proj-internal'))
      expect(api.last('GET', '/topics')!.query.get('project_id')).toBe('proj-internal')
    })
  })

  describe('the list', () => {
    it('groups the facts by topic, with the topic label, its id and how many facts it has', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const onboarding = within(section('Onboarding target'))
      expect(onboarding.getByText('onboarding-target')).toBeInTheDocument()
      expect(onboarding.getByText('3 facts')).toBeInTheDocument()
      expect(onboarding.getAllByText(/^M-\d+$/).map((el) => el.textContent)).toEqual(['M-101', 'M-105', 'M-106'])

      const audit = within(section('Audit turnaround'))
      expect(audit.getByText('4 facts')).toBeInTheDocument()
      expect(audit.getAllByText(/^M-\d+$/).map((el) => el.textContent)).toEqual(['M-201', 'M-202', 'M-203', 'M-204'])
    })

    it('names a topic without a record by its id and counts a single fact in the singular', async () => {
      api.get('/facts', page([FACTS[7]]))
      renderWithApp(<Screen />)
      const pricing = within((await screen.findByText('€40k fixed fee')).closest('section')!)
      expect(pricing.getByRole('button', { name: 'pricing' })).toBeInTheDocument()
      expect(pricing.getByText('1 fact')).toBeInTheDocument()
    })

    it('shows each fact with its sentence, source, date, type, state and id', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const binding = within(row('M-106'))
      expect(binding.getByText('3–4 weeks')).toHaveClass('font-medium')
      expect(binding.getByText('final report')).toBeInTheDocument()
      expect(binding.getByText('28 Nov 2025')).toBeInTheDocument()
      expect(binding.getByText('Decision')).toBeInTheDocument()
      expect(binding.getByText('Binding')).toHaveClass('badge', 'binding')

      const evidence = within(row('M-204'))
      expect(evidence.getByText('4.2 days on average')).not.toHaveClass('font-medium')
      expect(evidence.getByText('benchmarks')).toBeInTheDocument()
      expect(evidence.getByText('15 Sep 2025')).toBeInTheDocument()
      expect(evidence.getByText('Evidence')).toBeInTheDocument()
      expect(evidence.getByText('Active')).toHaveClass('badge', 'ok')
    })

    it.each([
      ['M-101', '≈6 weeks', 'superseded', true],
      ['M-105', '4 weeks', 'retired', true],
      ['M-201', '5 business days', 'conflict', false],
      ['M-203', 'How fast must an urgent audit be?', 'open', false],
      ['M-301', '€40k fixed fee', 'binding', false],
      ['M-302', '€45k fixed fee', 'held', false],
    ])('gives %s the %s badge and strikes it through only when it no longer counts', async (id, value, cls, struck) => {
      renderWithApp(<Screen />)
      await loaded()
      expect(row(id).querySelector('.badge')).toHaveClass(cls)
      if (struck) expect(within(row(id)).getByText(value)).toHaveClass('strike')
      else expect(within(row(id)).getByText(value)).not.toHaveClass('strike')
    })

    it('labels the states in words', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const badge = (id: string) => row(id).querySelector('.badge')
      expect(badge('M-101')).toHaveTextContent('Superseded')
      expect(badge('M-105')).toHaveTextContent('Retired')
      expect(badge('M-201')).toHaveTextContent('Still active')
      expect(badge('M-203')).toHaveTextContent('Open question')
      expect(badge('M-302')).toHaveTextContent('Newer · held by pin')
    })

    it('shows the tags of a fact, topic tags marked as such, and no tag line without tags', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const tagged = within(row('M-106'))
      expect(tagged.getByText('onboarding')).toHaveClass('tag')
      expect(tagged.getByText('onboarding')).not.toHaveClass('topic')
      expect(tagged.getByText('topic:hr')).toHaveClass('tag', 'topic')
      expect(row('M-101').querySelector('.tag')).toBeNull()
    })

    it.each([
      ['library/benchmarks', 'library'],
      ['library/email-templates', 'library'],
      ['04-external-comms/email/email-external-012', 'mail'],
      ['03-internal-comms/thread-4', 'mail'],
      ['upload-7/offer', 'upload'],
      ['internal/price-list', 'upload'],
      ['07-documents/report-final', 'doc'],
    ])('draws the source icon of %s as %s', async (docId, icon) => {
      api.get('/facts', page([fact({ id: 'M-1', doc_id: docId })]))
      renderWithApp(<Screen />)
      await screen.findByText('M-1')
      expect(row('M-1').querySelector('svg')!.innerHTML).toBe(iconOf(icon))
    })

    it('opens the fact drawer when a fact is clicked', async () => {
      const { user, app } = renderWithApp(<Screen />)
      await loaded()
      await user.click(row('M-202'))
      expect(app.openFact).toHaveBeenCalledTimes(1)
      expect(app.openFact).toHaveBeenCalledWith('M-202')
    })

    it('highlights the fact that is open in the drawer', async () => {
      renderWithApp(<Screen />, { factId: 'M-202' })
      await loaded()
      expect(row('M-202')).toHaveClass('bg-accent')
      expect(row('M-201')).not.toHaveClass('bg-accent')
    })
  })

  describe('paging', () => {
    const many = Array.from({ length: 250 }, (_, i) => fact({ id: `M-${1000 + i}`, topic: 'bulk', value: `Bulk fact ${i}` }))
    // By text and with room to spare: role queries over hundreds of rows are slow on a busy machine.
    const more = (count: number) => screen.getByText(`Show ${count} more`, { selector: 'button' })
    const SLOW = 20_000

    it(
      'shows 120 facts at a time and more on request',
      async () => {
        api.get('/facts', page(many))
        const { user } = renderWithApp(<Screen />)
        expect(await screen.findByText('250 of 250')).toBeInTheDocument()
        expect(shownIds()).toHaveLength(120)
        expect(screen.getByText('120 facts')).toBeInTheDocument()

        await user.click(more(120))
        expect(shownIds()).toHaveLength(240)

        await user.click(more(10))
        expect(shownIds()).toHaveLength(250)
        expect(screen.queryByText(/^Show \d+ more$/)).not.toBeInTheDocument()
      },
      SLOW,
    )

    it(
      'goes back to the first 120 when a filter changes',
      async () => {
        api.get('/facts', page(many))
        const { user } = renderWithApp(<Screen />)
        await screen.findByText('250 of 250')
        await user.click(more(120))
        expect(shownIds()).toHaveLength(240)

        await user.selectOptions(screen.getByLabelText('Type'), 'Decision')
        expect(screen.getByText('250 of 250')).toBeInTheDocument()
        expect(shownIds()).toHaveLength(120)
        expect(more(120)).toBeInTheDocument()
      },
      SLOW,
    )

    it('has no button when everything fits', async () => {
      renderWithApp(<Screen />)
      await loaded()
      expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).not.toBeInTheDocument()
    })
  })

  describe('topics', () => {
    it('lists the topics by label with their number of facts', async () => {
      renderWithApp(<Screen />)
      await loaded()
      expect(sidebar().getAllByRole('button').map((b) => b.textContent)).toEqual(['All topics9', 'Audit turnaround4', 'Onboarding target3', 'pricing2'])
      expect(sidebar().getByRole('button', { name: 'All topics9' })).toHaveClass('on')
      expect(within(screen.getByLabelText('Topic')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All topics', 'Audit turnaround', 'Onboarding target', 'pricing'])
    })

    it('shows one topic when it is picked in the side list, and all again with All topics', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.click(sidebar().getByRole('button', { name: 'Audit turnaround4' }))
      expect(shownIds()).toEqual(['M-201', 'M-202', 'M-203', 'M-204'])
      expect(screen.getByText('4 of 9')).toBeInTheDocument()
      expect(sidebar().getByRole('button', { name: 'Audit turnaround4' })).toHaveClass('on')
      expect(sidebar().getByRole('button', { name: 'All topics9' })).not.toHaveClass('on')
      expect(screen.getByLabelText('Topic')).toHaveValue('audit-turnaround')

      await user.click(sidebar().getByRole('button', { name: 'All topics9' }))
      expect(shownIds()).toHaveLength(9)
      expect(sidebar().getByRole('button', { name: 'All topics9' })).toHaveClass('on')
    })

    it('filters by topic from the topic menu', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Topic'), 'pricing')
      expect(shownIds()).toEqual(['M-301', 'M-302'])
      expect(sidebar().getByRole('button', { name: 'pricing2' })).toHaveClass('on')
    })

    it('filters by topic from the title of a group', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Onboarding target' }))
      expect(shownIds()).toEqual(['M-101', 'M-105', 'M-106'])
      expect(screen.getByText('3 of 9')).toBeInTheDocument()
    })
  })

  describe('type and status filters', () => {
    it('offers every type and every state', async () => {
      renderWithApp(<Screen />)
      await loaded()
      const options = (label: string) => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent)
      expect(options('Type')).toEqual(['All types', 'Decision', 'Constraint', 'Evidence', 'Hypothesis', 'Open question', 'Superseded'])
      expect(options('Status')).toEqual(['Any status', 'Binding', 'Active', 'Still active, conflicting', 'Open question', 'Superseded', 'Newer · held by pin', 'Retired'])
    })

    it.each([
      ['Decision', ['M-105', 'M-106', 'M-201', 'M-202', 'M-301', 'M-302']],
      ['Evidence', ['M-204']],
      ['Open question', ['M-203']],
      ['Superseded', ['M-101']],
    ])('shows only the facts of type %s', async (type, ids) => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Type'), type)
      expect(shownIds()).toEqual(ids)
      expect(screen.getByText(`${ids.length} of 9`)).toBeInTheDocument()
    })

    it.each([
      ['Binding', ['M-106', 'M-202', 'M-301']],
      ['Active', ['M-204']],
      ['Still active, conflicting', ['M-201']],
      ['Open question', ['M-203']],
      ['Superseded', ['M-101']],
      ['Newer · held by pin', ['M-302']],
      ['Retired', ['M-105']],
    ])('shows only the facts in state %s', async (status, ids) => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Status'), status)
      expect(shownIds()).toEqual(ids)
    })

    it('combines the filters', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Type'), 'Decision')
      await user.selectOptions(screen.getByLabelText('Status'), 'Binding')
      await user.selectOptions(screen.getByLabelText('Topic'), 'Audit turnaround')
      expect(shownIds()).toEqual(['M-202'])
      expect(screen.getByText('1 of 9')).toBeInTheDocument()
    })

    it('says when nothing matches and clears the filters from there', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Type'), 'Hypothesis')
      expect(screen.getByText('No facts match')).toBeInTheDocument()
      expect(screen.getByText('0 of 9')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
      expect(shownIds()).toHaveLength(9)
      expect(screen.getByLabelText('Type')).toHaveValue('all')
    })

    it('offers Clear filters only while something is filtered, and it resets everything', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Type'), 'Decision')
      await user.selectOptions(screen.getByLabelText('Status'), 'Binding')
      await user.selectOptions(screen.getByLabelText('Topic'), 'pricing')
      await user.selectOptions(screen.getByLabelText('Tag'), 'pricing')
      await user.type(searchBox(), 'fee{Enter}')
      expect(shownIds()).toEqual(['M-301'])

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(shownIds()).toHaveLength(9)
      expect(searchBox()).toHaveValue('')
      for (const label of ['Type', 'Status', 'Tag', 'Topic']) expect(screen.getByLabelText(label)).toHaveValue('all')
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    })
  })

  describe('tag filter', () => {
    it('lists the tags with their number of facts', async () => {
      renderWithApp(<Screen />)
      await loaded()
      await waitFor(() =>
        expect(within(screen.getByLabelText('Tag')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any tag', 'onboarding · 1', 'pricing · 2']),
      )
    })

    it('asks the backend which facts carry the tag and shows those', async () => {
      // The backend knows better than the tags on the loaded facts: M-204 carries the tag there.
      api.get('/facts', (req) => (req.query.get('tag') ? page([FACTS[6], FACTS[7]]) : page(FACTS)))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(await screen.findByLabelText('Tag'), 'pricing')
      await waitFor(() => expect(shownIds()).toEqual(['M-204', 'M-301']))
      expect(tagCalls()).toHaveLength(1)
      expect(Object.fromEntries(tagCalls()[0].query)).toEqual({ project_id: 'proj-clearpath', tag: 'pricing', limit: '500', offset: '0' })
      expect(screen.getByText('2 of 9')).toBeInTheDocument()
    })

    it('uses the tags on the facts until the backend answers', async () => {
      const gate = deferred<Schemas['FactPage']>()
      api.get('/facts', (req) => (req.query.get('tag') ? gate.promise : page(FACTS)))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Tag'), 'pricing')
      expect(shownIds()).toEqual(['M-301', 'M-302'])

      gate.resolve(page([FACTS[7]]))
      await waitFor(() => expect(shownIds()).toEqual(['M-301']))
    })

    it('uses the tags on the facts when the backend cannot answer', async () => {
      api.get('/facts', (req) => (req.query.get('tag') ? fail(500, 'boom') : page(FACTS)))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Tag'), 'onboarding')
      await waitFor(() => expect(tagCalls()).toHaveLength(1))
      expect(shownIds()).toEqual(['M-106'])
    })

    it('reads every page of the tagged facts', async () => {
      api.get('/facts', (req) => {
        if (!req.query.get('tag')) return page(FACTS)
        const offset = Number(req.query.get('offset'))
        return { items: [FACTS[0], FACTS[3], FACTS[8]].slice(offset, offset + 2), total: 3, limit: 500, offset }
      })
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Tag'), 'pricing')
      await waitFor(() => expect(shownIds()).toEqual(['M-101', 'M-201', 'M-302']))
      expect(tagCalls().map((c) => c.query.get('offset'))).toEqual(['0', '2'])
    })

    it('stops paging when the backend promises more facts than it sends', async () => {
      api.get('/facts', (req) => {
        if (!req.query.get('tag')) return page(FACTS)
        return req.query.get('offset') === '0' ? page([FACTS[7]], 5) : page([], 5)
      })
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Tag'), 'pricing')
      await waitFor(() => expect(shownIds()).toEqual(['M-301']))
      expect(tagCalls().map((c) => c.query.get('offset'))).toEqual(['0', '1'])
    })

    it('keeps a tag picked elsewhere selectable even when the tag list does not have it', async () => {
      setFilters({ tag: 'legacy' })
      renderWithApp(<Screen />)
      await screen.findByText('0 of 9')
      const select = screen.getByLabelText('Tag')
      await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any tag', 'legacy', 'onboarding · 1', 'pricing · 2']))
      expect(select).toHaveValue('legacy')
      expect(tagCalls()[0].query.get('tag')).toBe('legacy')
      expect(await screen.findByText('No facts match')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    })

    it('does not ask for tagged facts while no tag is picked', async () => {
      renderWithApp(<Screen />)
      await loaded()
      expect(tagCalls()).toHaveLength(0)
    })
  })

  describe('search', () => {
    it('searches the backend once the typing pauses and adds its hits to the literal matches', async () => {
      api.get('/search', hits('M-204'))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'Weeks')
      await waitFor(() => expect(shownIds()).toEqual(['M-101', 'M-105', 'M-106', 'M-204']))
      expect(screen.getByText('4 of 9')).toBeInTheDocument()

      const calls = api.callsTo('GET', '/search')
      expect(calls).toHaveLength(1)
      expect(Object.fromEntries(calls[0].query)).toEqual({ q: 'Weeks', kind: 'fact', project_id: 'proj-clearpath', limit: '500' })
    })

    it.each([
      ['the sentence', 'fixed fee', ['M-301', 'M-302']],
      ['the quote', 'AUTONOMY', ['M-101', 'M-106']],
      ['the document', 'meeting-005', ['M-202']],
      ['the fact id', 'm-203', ['M-203']],
    ])('finds facts by %s without the help of the backend', async (_what, text, ids) => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), text)
      await waitFor(() => expect(shownIds()).toEqual(ids))
    })

    it('ignores the documents the backend finds', async () => {
      api.get('/search', (req) => ({ query: req.query.get('q'), total: 2, results: [hit('M-204', 'document'), hit('M-301')] }))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'kickoff')
      await waitFor(() => expect(shownIds()).toEqual(['M-203', 'M-301']))
    })

    it('searches without the spaces around the words', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), '  fixed fee  ')
      await waitFor(() => expect(api.callsTo('GET', '/search')).toHaveLength(1))
      expect(api.last('GET', '/search')!.query.get('q')).toBe('fixed fee')
      expect(shownIds()).toEqual(['M-301', 'M-302'])
    })

    it('applies the search at once on Enter', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'kickoff{Enter}')
      expect(shownIds()).toEqual(['M-203'])
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/search')).toHaveLength(1))
    })

    it('says that it is searching until the backend answers', async () => {
      const gate = deferred<Schemas['SearchResponse']>()
      api.get('/search', () => gate.promise)
      const { user } = renderWithApp(<Screen />)
      await loaded()
      expect(screen.queryByText('· Searching…')).not.toBeInTheDocument()
      await user.type(searchBox(), 'kickoff{Enter}')
      expect(await screen.findByText('· Searching…')).toBeInTheDocument()
      // Literal matches do not wait for the backend.
      expect(shownIds()).toEqual(['M-203'])

      gate.resolve({ query: 'kickoff', total: 1, results: [hit('M-204')] })
      await waitFor(() => expect(shownIds()).toEqual(['M-203', 'M-204']))
      expect(screen.queryByText('· Searching…')).not.toBeInTheDocument()
    })

    it('still finds literal matches when the search fails', async () => {
      api.get('/search', fail(500, 'index is rebuilding'))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'kickoff')
      await waitFor(() => expect(api.callsTo('GET', '/search')).toHaveLength(1))
      await waitFor(() => expect(shownIds()).toEqual(['M-203']))
      await waitFor(() => expect(screen.queryByText('· Searching…')).not.toBeInTheDocument())
    })

    it('names the words that match nothing and clears them from there', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'zebra')
      expect(await screen.findByText('No facts match “zebra”')).toBeInTheDocument()
      expect(screen.getByText('0 of 9')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear search and filters' }))
      expect(searchBox()).toHaveValue('')
      expect(shownIds()).toHaveLength(9)
    })

    it('searches inside the picked topic only', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.selectOptions(screen.getByLabelText('Topic'), 'Onboarding target')
      await user.type(searchBox(), 'days{Enter}')
      expect(screen.getByText('No facts match “days”')).toBeInTheDocument()
    })

    it('clears the search and the filters on Escape, and keeps the key from closing anything else', async () => {
      const onDocumentKey = vi.fn()
      document.addEventListener('keydown', onDocumentKey)
      try {
        const { user } = renderWithApp(<Screen />)
        await loaded()
        await user.selectOptions(screen.getByLabelText('Type'), 'Decision')
        await user.type(searchBox(), 'fee{Enter}')
        expect(shownIds()).toEqual(['M-301', 'M-302'])
        onDocumentKey.mockClear()

        await user.keyboard('{Escape}')
        expect(onDocumentKey).not.toHaveBeenCalled()
        expect(searchBox()).toHaveValue('')
        expect(screen.getByLabelText('Type')).toHaveValue('all')
        expect(shownIds()).toHaveLength(9)

        // With an empty box the key is not the screen's any more.
        await user.keyboard('{Escape}')
        expect(onDocumentKey).toHaveBeenCalledTimes(1)
      } finally {
        document.removeEventListener('keydown', onDocumentKey)
      }
    })

    it('does not search again for every letter', async () => {
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.type(searchBox(), 'business days')
      await waitFor(() => expect(shownIds()).toEqual(['M-201', 'M-202']))
      expect(api.callsTo('GET', '/search').map((c) => c.query.get('q'))).toEqual(['business days'])
    })
  })

  describe('filters kept between visits', () => {
    it('comes back with the search and the filters of the last visit', async () => {
      setFilters({ q: 'fee', type: 'DECISION', status: 'held', topic: 'pricing' })
      renderWithApp(<Screen />)
      await screen.findByText('1 of 9')
      expect(shownIds()).toEqual(['M-302'])
      expect(searchBox()).toHaveValue('fee')
      expect(screen.getByLabelText('Type')).toHaveValue('DECISION')
      expect(screen.getByLabelText('Status')).toHaveValue('held')
      expect(screen.getByLabelText('Topic')).toHaveValue('pricing')
      expect(sidebar().getByRole('button', { name: 'pricing2' })).toHaveClass('on')
      expect(api.last('GET', '/search')!.query.get('q')).toBe('fee')
    })

    it('follows filters set from elsewhere while it is open', async () => {
      renderWithApp(<Screen />)
      await loaded()
      act(() => setFilters({ ...NO_FILTERS, q: 'kickoff', topic: 'audit-turnaround' }))
      expect(searchBox()).toHaveValue('kickoff')
      expect(screen.getByLabelText('Topic')).toHaveValue('audit-turnaround')
      expect(shownIds()).toEqual(['M-203'])
      await waitFor(() => expect(api.callsTo('GET', '/search')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByText('· Searching…')).not.toBeInTheDocument())
    })
  })

  describe('#/memory/<factId>', () => {
    it('opens the drawer of the fact in the address', async () => {
      goto('memory/M-106')
      const { app } = renderWithApp(<Screen />)
      await loaded()
      expect(app.openFact).toHaveBeenCalledTimes(1)
      expect(app.openFact).toHaveBeenCalledWith('M-106')
    })

    it('opens nothing without a fact in the address', async () => {
      goto('memory')
      const { app } = renderWithApp(<Screen />)
      await loaded()
      expect(app.openFact).not.toHaveBeenCalled()
    })

    it('opens the next fact when the address changes', async () => {
      goto('memory/M-106')
      const { app } = renderWithApp(<Screen />)
      await loaded()
      act(() => goto('memory/M-202'))
      await waitFor(() => expect(app.openFact).toHaveBeenLastCalledWith('M-202'))
      expect(app.openFact).toHaveBeenCalledTimes(2)
    })

    it('goes back to #/memory when that drawer is closed', async () => {
      goto('memory/M-106')
      const view = mount()
      await loaded()
      expect(view.app.openFact).toHaveBeenCalledWith('M-106')

      view.update({ factId: 'M-106' })
      expect(location.hash).toBe('#/memory/M-106')
      view.update({ factId: null })
      expect(location.hash).toBe('#/memory')
    })

    it('stays on the address of the first fact while another fact of its timeline is looked at', async () => {
      goto('memory/M-106')
      const view = mount()
      await loaded()
      view.update({ factId: 'M-106' })
      view.update({ factId: 'M-101' })
      expect(location.hash).toBe('#/memory/M-106')
      view.update({ factId: null })
      expect(location.hash).toBe('#/memory')
    })

    it('leaves the address alone when a drawer opened by a click is closed', async () => {
      const view = mount()
      await loaded()
      view.update({ factId: 'M-106' })
      view.update({ factId: null })
      expect(location.hash).toBe('')
    })
  })

  describe('export', () => {
    beforeEach(() => {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    })
    const bundle = (facts: Fact[]): Schemas['ExportBundle'] => ({
      version: '1',
      exported_at: '2026-11-14T10:00:00Z',
      corpus: 'clearpath',
      documents: [],
      topics: [],
      facts,
      audit: [],
      answers: [],
    })

    it('downloads the export and says how many facts it holds', async () => {
      api.get('/export', bundle(FACTS.slice(0, 2)))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Export' }))
      expect(await screen.findByText('Export downloaded: 2 facts as JSON.')).toBeInTheDocument()
      expect(api.callsTo('GET', '/export')).toHaveLength(1)
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    })

    it('cannot be started twice while it runs', async () => {
      const gate = deferred<Schemas['ExportBundle']>()
      api.get('/export', () => gate.promise)
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Export' }))
      expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Export' }))
      expect(api.callsTo('GET', '/export')).toHaveLength(1)

      gate.resolve(bundle(FACTS))
      expect(await screen.findByText('Export downloaded: 9 facts as JSON.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    })

    it('says why when the export fails and can be tried again', async () => {
      api.get('/export', fail(500, 'disk full'))
      const { user } = renderWithApp(<Screen />)
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Export' }))
      expect(await screen.findByText('That did not work. disk full')).toBeInTheDocument()
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled())
    })
  })
})
