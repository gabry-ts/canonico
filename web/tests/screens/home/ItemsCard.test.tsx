import { screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../../src/api/client'
import { FactRow, ItemsCard, type ItemFilter } from '../../../src/screens/home/ItemsCard'
import { api, deferred, fail, type Req } from '../../helpers/api'
import { fact, source } from '../../helpers/fixtures'
import { item } from '../../helpers/home'
import { renderI18n, renderWithApp } from '../../helpers/render'

type Item = Schemas['Item']

const NO_FILTER: ItemFilter = { type: 'all', tag: 'all' }
const DOCS = source()

const MEETING = item({
  id: 'I-1',
  title: 'Steering committee',
  type: 'meeting',
  date: '2025-11-12',
  facts_count: 2,
  source_id: DOCS.id,
  document_id: '05-meetings/steering',
  tags: ['topic:pilot-size', 'team:ops'],
  participants: ['Anna Riva', 'Luca Neri'],
  received_at: '2026-11-10T10:30:00Z',
})
const NOTE = item({ id: 'I-2', title: 'Budget note', type: 'note', date: '2025-10-02', facts_count: 1, source_id: null, routed_by: 'tag_rule', document_id: 'doc-budget', tags: ['client'] })
const TICKET = item({ id: 'I-3', title: 'Support ticket', type: 'ticket', date: '2025-09-01', facts_count: 0, source_id: null, routed_by: 'url', document_id: 'doc-ticket', tags: undefined, participants: undefined })
const REPORT = item({ id: 'I-4', title: 'Final report', type: 'document', facts_count: 5, source_id: 'src-gone', routed_by: 'project_id', document_id: 'doc-report', tags: ['team:ops', 'archive'] })
const ITEMS = [MEETING, NOTE, TICKET, REPORT]

/** Answers like the backend: the `type` and `tag` of the query narrow the list. */
const serve = (items: Item[]) => (req: Req) => {
  const type = req.query.get('type')
  const tag = req.query.get('tag')
  const out = items.filter((i) => (!type || i.type === type) && (!tag || (i.tags ?? []).includes(tag)))
  return { items: out, total: out.length, limit: 200, offset: 0 }
}

/** The card with the state its page keeps for it. The spies see every change. */
function Card({ pid = 'proj-clearpath', filter: filter0 = NO_FILTER, open: open0 = null, sources = [DOCS], onOpen, onFilter }: {
  pid?: string
  filter?: ItemFilter
  open?: string | null
  sources?: Schemas['Source'][]
  onOpen?: (id: string | null) => void
  onFilter?: (f: ItemFilter) => void
}) {
  const [filter, setFilter] = useState(filter0)
  const [open, setOpen] = useState<string | null>(open0)
  return (
    <ItemsCard
      pid={pid}
      sources={sources}
      open={open}
      setOpen={(id) => {
        onOpen?.(id)
        setOpen(id)
      }}
      filter={filter}
      setFilter={(f) => {
        onFilter?.(f)
        setFilter(f)
      }}
    />
  )
}

const itemCalls = () => api.callsTo('GET', '/projects/:project_id/items')
const rowOf = (i: Item) => screen.getByRole('button', { name: new RegExp(i.title) })
const titles = () => screen.getAllByRole('button', { expanded: false }).map((b) => b.querySelector('.block')!.textContent)
const detailOf = (i: Item) => within(document.getElementById(`xp-item-${i.id}`)!)
const dd = (i: Item, term: string) => detailOf(i).getByText(term, { selector: 'dt' }).nextElementSibling!
const typeFilter = () => screen.getByRole('combobox', { name: 'Filter items by type' })
const tagFilter = () => screen.getByRole('combobox', { name: 'Filter items by tag' })
const options = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent)

beforeEach(() => {
  api.get('/projects/:project_id/items', serve(ITEMS))
  api.get('/items/:item_id', (req) => ({ ...ITEMS.find((i) => i.id === req.params.item_id)!, text_excerpt: 'We keep the pilot at twelve consultants.' }))
  api.get('/documents/:doc_id/facts', [])
})

describe('ItemsCard', () => {
  describe('the list', () => {
    it('asks for the items of the project, 200 at most and unfiltered', async () => {
      renderWithApp(<Card pid="proj-internal" />)
      await screen.findByText('Steering committee')
      await waitFor(() => expect(itemCalls()).toHaveLength(2))
      for (const c of itemCalls()) {
        expect(c.params.project_id).toBe('proj-internal')
        expect(c.query.get('limit')).toBe('200')
        expect(c.query.has('type')).toBe(false)
        expect(c.query.has('tag')).toBe(false)
      }
      expect(api.unhandled).toEqual([])
    })

    it('shows neither items nor a count nor the empty state while loading', async () => {
      const gate = deferred()
      api.get('/projects/:project_id/items', () => gate.promise)
      renderWithApp(<Card />)
      expect(screen.getByRole('heading', { name: 'Received items' })).toBeInTheDocument()
      expect(screen.queryByText('No items yet')).not.toBeInTheDocument()
      expect(screen.queryByText(/\d+ of \d+/)).not.toBeInTheDocument()

      gate.resolve(serve(ITEMS)({ query: new URLSearchParams() } as Req))
      expect(await screen.findByText('Steering committee')).toBeInTheDocument()
      expect(await screen.findByText('4 of 4')).toBeInTheDocument()
    })

    it('shows the error and loads again on retry', async () => {
      api.get('/projects/:project_id/items', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Card />)
      expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(screen.queryByText(/\d+ of \d+/)).not.toBeInTheDocument()

      api.get('/projects/:project_id/items', serve(ITEMS))
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Steering committee')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('says when the project has received nothing, with nothing to clear', async () => {
      api.get('/projects/:project_id/items', serve([]))
      renderWithApp(<Card />)
      expect(await screen.findByText('No items yet')).toBeInTheDocument()
      expect(screen.getByText('Uploads and webhook posts show up here.')).toBeInTheDocument()
      expect(screen.getByText('0 of 0')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    })

    it('shows type, tags, date and number of facts of every item', async () => {
      renderWithApp(<Card />)
      const meeting = within(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(meeting.getByText('Meeting')).toBeInTheDocument()
      expect(meeting.getByText('topic:pilot-size')).toHaveClass('tag', 'topic')
      expect(meeting.getByText('team:ops')).toHaveClass('tag')
      expect(meeting.getByText('team:ops')).not.toHaveClass('topic')
      expect(meeting.getByText('12 Nov 2025')).toBeInTheDocument()
      expect(meeting.getByText('2 facts')).toBeInTheDocument()

      expect(within(rowOf(NOTE)).getByText('Note')).toBeInTheDocument()
      expect(within(rowOf(NOTE)).getByText('1 fact')).toBeInTheDocument()
      expect(within(rowOf(TICKET)).getByText('Ticket')).toBeInTheDocument()
      expect(within(rowOf(TICKET)).getByText('0 facts')).toBeInTheDocument()
      expect(within(rowOf(REPORT)).getByText('Document')).toBeInTheDocument()
      expect(titles()).toEqual(['Steering committee', 'Budget note', 'Support ticket', 'Final report'])
      expect(screen.getByText('4 of 4')).toBeInTheDocument()
    })

    it('says where an item came from: its source, the organisation webhook or a manual upload', async () => {
      renderWithApp(<Card />)
      await screen.findByText('Steering committee')
      expect(within(rowOf(MEETING)).getByText('ClearPath documents')).toBeInTheDocument()
      expect(within(rowOf(NOTE)).getByText('Organisation webhook')).toBeInTheDocument()
      expect(within(rowOf(TICKET)).getByText('Manual upload')).toBeInTheDocument()
      // Its source is not one of the project any more.
      expect(within(rowOf(REPORT)).getByText('Manual upload')).toBeInTheDocument()
    })

    it('accepts the items as a bare array', async () => {
      api.get('/projects/:project_id/items', [NOTE, TICKET])
      renderWithApp(<Card />)
      expect(await screen.findByText('Budget note')).toBeInTheDocument()
      expect(await screen.findByText('2 of 2')).toBeInTheDocument()
      expect(options(tagFilter())).toEqual(['Any tag', 'client'])
    })
  })

  describe('filters', () => {
    it('offers the four types and the tags in use, plain tags before topic tags', async () => {
      renderWithApp(<Card />)
      await screen.findByText('Steering committee')
      expect(options(typeFilter())).toEqual(['All types', 'Meeting', 'Document', 'Note', 'Ticket'])
      await waitFor(() => expect(options(tagFilter())).toEqual(['Any tag', 'archive', 'client', 'team:ops', 'topic:pilot-size']))
      expect(typeFilter()).toHaveValue('all')
      expect(tagFilter()).toHaveValue('all')
    })

    it('asks the backend for one type and counts against all the items', async () => {
      const onFilter = vi.fn()
      const { user } = renderWithApp(<Card onFilter={onFilter} />)
      await screen.findByText('Steering committee')
      await user.selectOptions(typeFilter(), 'Note')

      expect(onFilter).toHaveBeenCalledWith({ type: 'note', tag: 'all' })
      expect(await screen.findByText('1 of 4')).toBeInTheDocument()
      expect(titles()).toEqual(['Budget note'])
      const sent = itemCalls().at(-1)!
      expect(sent.query.get('type')).toBe('note')
      expect(sent.query.has('tag')).toBe(false)
      expect(sent.query.get('limit')).toBe('200')
      // The unfiltered list (for the total and the tags) is not asked again.
      expect(itemCalls()).toHaveLength(3)
    })

    it('asks the backend for one tag, and for both when a type is chosen too', async () => {
      const onFilter = vi.fn()
      const { user } = renderWithApp(<Card onFilter={onFilter} />)
      await screen.findByText('Steering committee')
      await user.selectOptions(tagFilter(), 'team:ops')
      expect(onFilter).toHaveBeenLastCalledWith({ type: 'all', tag: 'team:ops' })
      expect(await screen.findByText('2 of 4')).toBeInTheDocument()
      expect(titles()).toEqual(['Steering committee', 'Final report'])
      expect(itemCalls().at(-1)!.query.get('tag')).toBe('team:ops')
      expect(itemCalls().at(-1)!.query.has('type')).toBe(false)

      await user.selectOptions(typeFilter(), 'Document')
      expect(onFilter).toHaveBeenLastCalledWith({ type: 'document', tag: 'team:ops' })
      expect(await screen.findByText('1 of 4')).toBeInTheDocument()
      expect(titles()).toEqual(['Final report'])
      expect(itemCalls().at(-1)!.query.get('tag')).toBe('team:ops')
      expect(itemCalls().at(-1)!.query.get('type')).toBe('document')
    })

    it('starts from the filter of the page', async () => {
      renderWithApp(<Card filter={{ type: 'ticket', tag: 'all' }} />)
      expect(await screen.findByText('Support ticket')).toBeInTheDocument()
      expect(typeFilter()).toHaveValue('ticket')
      expect(await screen.findByText('1 of 4')).toBeInTheDocument()
      expect(screen.queryByText('Steering committee')).not.toBeInTheDocument()
    })

    it('says when nothing matches and clears the filters on request', async () => {
      const onFilter = vi.fn()
      const { user } = renderWithApp(<Card onFilter={onFilter} />)
      await screen.findByText('Steering committee')
      await user.selectOptions(tagFilter(), 'client')
      await screen.findByText('1 of 4')
      await user.selectOptions(typeFilter(), 'Meeting')

      expect(await screen.findByText('No items match')).toBeInTheDocument()
      expect(screen.getByText('Try another type or tag.')).toBeInTheDocument()
      expect(screen.getByText('0 of 4')).toBeInTheDocument()
      expect(screen.queryByText('No items yet')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(onFilter).toHaveBeenLastCalledWith({ type: 'all', tag: 'all' })
      expect(await screen.findByText('4 of 4')).toBeInTheDocument()
      expect(typeFilter()).toHaveValue('all')
      expect(tagFilter()).toHaveValue('all')
    })
  })

  describe('opening an item', () => {
    it('opens on click, closes on a second click and tells the page', async () => {
      const onOpen = vi.fn()
      const { user } = renderWithApp(<Card onOpen={onOpen} />)
      await screen.findByText('Steering committee')
      expect(rowOf(MEETING)).toHaveAttribute('aria-expanded', 'false')
      expect(rowOf(MEETING)).toHaveAttribute('aria-controls', 'xp-item-I-1')
      expect(api.callsTo('GET', '/items/:item_id')).toHaveLength(0)

      await user.click(rowOf(MEETING))
      expect(onOpen).toHaveBeenLastCalledWith('I-1')
      expect(rowOf(MEETING)).toHaveAttribute('aria-expanded', 'true')
      expect(await detailOf(MEETING).findByText('Facts')).toBeInTheDocument()

      await user.click(rowOf(MEETING))
      expect(onOpen).toHaveBeenLastCalledWith(null)
      expect(rowOf(MEETING)).toHaveAttribute('aria-expanded', 'false')
      expect(detailOf(MEETING).queryByText('Facts')).not.toBeInTheDocument()
    })

    it('keeps one item open at a time', async () => {
      const { user } = renderWithApp(<Card />)
      await screen.findByText('Steering committee')
      await user.click(rowOf(MEETING))
      await detailOf(MEETING).findByText('Facts')
      await user.click(rowOf(NOTE))
      expect(rowOf(NOTE)).toHaveAttribute('aria-expanded', 'true')
      expect(rowOf(MEETING)).toHaveAttribute('aria-expanded', 'false')
      expect(await detailOf(NOTE).findByText('Facts')).toBeInTheDocument()
    })

    it('starts with the item the page asked for open', async () => {
      renderWithApp(<Card open="I-2" />)
      await screen.findByText('Budget note')
      expect(rowOf(NOTE)).toHaveAttribute('aria-expanded', 'true')
      expect(await detailOf(NOTE).findByText('Facts')).toBeInTheDocument()
      expect(api.last('GET', '/items/:item_id')!.params.item_id).toBe('I-2')
    })

    it('shows participants, excerpt, document and when it was received', async () => {
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      await detailOf(MEETING).findByText('Facts')

      expect(dd(MEETING, 'Participants')).toHaveTextContent('Anna Riva, Luca Neri')
      expect(dd(MEETING, 'Text')).toHaveTextContent('“We keep the pilot at twelve consultants.”')
      expect(dd(MEETING, 'Document')).toHaveTextContent('05-meetings/steering')
      expect(dd(MEETING, 'Received')).toHaveTextContent('10 Nov, 10:30 · I-1')
      expect(api.last('GET', '/items/:item_id')!.params.item_id).toBe('I-1')
      expect(api.last('GET', '/documents/:doc_id/facts')!.params.doc_id).toBe('05-meetings/steering')
      expect(api.unhandled).toEqual([])
    })

    it('leaves out participants and excerpt when the item has none', async () => {
      api.get('/items/:item_id', TICKET)
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Support ticket/ }))
      await detailOf(TICKET).findByText('Facts')
      expect(detailOf(TICKET).queryByText('Participants')).not.toBeInTheDocument()
      expect(detailOf(TICKET).queryByText('Text')).not.toBeInTheDocument()
      expect(dd(TICKET, 'Document')).toHaveTextContent('doc-ticket')

      // An empty list of participants is left out too.
      await user.click(rowOf(NOTE))
      await detailOf(NOTE).findByText('Facts')
      expect(detailOf(NOTE).queryByText('Participants')).not.toBeInTheDocument()
    })

    it('lists the facts of the document and opens one in the drawer', async () => {
      api.get('/documents/:doc_id/facts', [
        fact({ id: 'M-301', value: 'Twelve consultants', type: 'DECISION', pinned: true }),
        fact({ id: 'M-302', value: 'Ten consultants', status: 'retired' }),
      ])
      const { user, app } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))

      const first = await detailOf(MEETING).findByRole('button', { name: /Twelve consultants/ })
      expect(within(first).getByText('Decision')).toHaveClass('badge', 'binding')
      expect(within(first).getByText('M-301')).toBeInTheDocument()
      expect(within(detailOf(MEETING).getByRole('button', { name: /Ten consultants/ })).getByText('Retired')).toHaveClass('badge', 'retired')
      expect(detailOf(MEETING).queryByText(/extracted/)).not.toBeInTheDocument()

      await user.click(first)
      expect(app.openFact).toHaveBeenCalledWith('M-301')
    })

    it('accepts the facts wrapped in { items }', async () => {
      api.get('/documents/:doc_id/facts', { items: [fact({ id: 'M-301', value: 'Twelve consultants' })] })
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(await detailOf(MEETING).findByRole('button', { name: /Twelve consultants/ })).toBeInTheDocument()
    })

    it('says how many facts were extracted when the document does not list them', async () => {
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(await detailOf(MEETING).findByText('2 facts extracted.')).toBeInTheDocument()

      await user.click(rowOf(NOTE))
      expect(await detailOf(NOTE).findByText('1 fact extracted.')).toBeInTheDocument()

      await user.click(rowOf(TICKET))
      expect(await detailOf(TICKET).findByText('No facts extracted from this item.')).toBeInTheDocument()
    })

    it('still shows the item when its facts cannot be loaded', async () => {
      api.get('/documents/:doc_id/facts', fail(404, 'No such document'))
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(await detailOf(MEETING).findByText('2 facts extracted.')).toBeInTheDocument()
      expect(dd(MEETING, 'Document')).toHaveTextContent('05-meetings/steering')
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('shows nothing of the detail until it has loaded', async () => {
      const gate = deferred()
      api.get('/items/:item_id', () => gate.promise)
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(rowOf(MEETING)).toHaveAttribute('aria-expanded', 'true')
      expect(detailOf(MEETING).queryByText('Facts')).not.toBeInTheDocument()
      expect(detailOf(MEETING).queryByText('Received')).not.toBeInTheDocument()

      gate.resolve(MEETING)
      expect(await detailOf(MEETING).findByText('Received')).toBeInTheDocument()
    })

    it('shows the error of the detail inside the item and loads again on retry', async () => {
      api.get('/items/:item_id', fail(500, 'item store offline'))
      const { user } = renderWithApp(<Card />)
      await user.click(await screen.findByRole('button', { name: /Steering committee/ }))
      expect(await detailOf(MEETING).findByText('Could not load this. item store offline')).toBeInTheDocument()
      expect(screen.getByText('Budget note')).toBeInTheDocument()

      api.get('/items/:item_id', MEETING)
      await user.click(detailOf(MEETING).getByRole('button', { name: 'Try again' }))
      expect(await detailOf(MEETING).findByText('Received')).toBeInTheDocument()
      expect(detailOf(MEETING).queryByText('Something went wrong')).not.toBeInTheDocument()
    })
  })
})

describe('FactRow', () => {
  const show = (over: Partial<Schemas['Fact']>) => {
    const onOpen = vi.fn()
    const view = renderI18n(<FactRow f={fact({ value: 'Three to four weeks', ...over })} onOpen={onOpen} />)
    return { ...view, onOpen }
  }

  it('shows the value, the type and the id, and opens the fact on click', async () => {
    const { user, onOpen } = show({ id: 'M-106', type: 'EVIDENCE' })
    expect(screen.getByText('Three to four weeks')).not.toHaveClass('strike')
    expect(screen.getByText('Evidence')).toHaveClass('badge', 'line')
    expect(screen.getByText('M-106')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Three to four weeks/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('marks a pinned fact as binding, under its type', () => {
    show({ type: 'CONSTRAINT', pinned: true })
    expect(screen.getByText('Constraint')).toHaveClass('badge', 'binding')
  })

  it('marks an open question as open, pinned or not', () => {
    show({ type: 'OPEN', pinned: true })
    expect(screen.getByText('Open question')).toHaveClass('badge', 'open')
  })

  it('marks a replaced fact as superseded, whatever its type', () => {
    show({ type: 'OPEN', pinned: true, superseded_by: 'M-200' })
    expect(screen.getByText('Superseded')).toHaveClass('badge', 'superseded')
    expect(screen.queryByText('Open question')).not.toBeInTheDocument()
    expect(screen.getByText('Three to four weeks')).not.toHaveClass('strike')
  })

  it('strikes a retired fact through, even when it was superseded or pinned', () => {
    show({ status: 'retired', superseded_by: 'M-200', pinned: true })
    expect(screen.getByText('Retired')).toHaveClass('badge', 'retired')
    expect(screen.queryByText('Superseded')).not.toBeInTheDocument()
    expect(screen.getByText('Three to four weeks')).toHaveClass('strike')
  })
})
