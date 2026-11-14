import { act, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import type { AppState } from '../../src/lib/appContext'
import { NO_FILTERS, setFilters, useFilters } from '../../src/screens/memory/api'
import Palette from '../../src/ui/Palette'
import { api, deferred, fail, type Req } from '../helpers/api'
import { fact, MEMBERS } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

type Result = Schemas['SearchResult']

const TAGS: Schemas['TagCount'][] = [
  { tag: 'pricing', count: 2 },
  { tag: 'Onboarding', count: 1 },
  { tag: 'topic:pricing-model', count: 7 },
]
const result = (id: string, snippet: string, kind: Result['kind'] = 'fact'): Result => ({ kind, id, score: 0.9, snippet, doc_id: '07-documents/report-final', topic: 'onboarding-target', type: 'DECISION' })
const found = (...results: Result[]) => (req: Req): Schemas['SearchResponse'] => ({ query: req.query.get('q') ?? '', total: results.length, results })
const HITS = [result('M-106', 'New consultants reach autonomy in 3–4 weeks'), result('M-101', 'Autonomy takes roughly six weeks')]

const VIEWS = ['Home', 'Ask', 'Memory', 'Conflicts', 'Open questions', 'Maintenance', 'Sources', 'Overview', 'Audit log', 'Settings', 'Members', 'Roles', 'Demo control', 'Setup']
const ACTIONS = [
  'Export memory as JSON',
  'Switch light / dark theme',
  'Act as Giulia Ferri (owner)',
  'Act as Marco Fiore (admin)',
  'Act as Sara Conti (editor)',
  'Act as Luca Neri (viewer)',
]

/** Shows the shared memory filters, to see what the palette sets. */
function FiltersProbe() {
  return <output data-testid="filters">{JSON.stringify(useFilters())}</output>
}
const filters = () => JSON.parse(screen.getByTestId('filters').textContent ?? '{}') as typeof NO_FILTERS

function open(over: Partial<AppState> = {}) {
  const onClose = vi.fn()
  const view = renderWithApp(
    <>
      <Palette onClose={onClose} />
      <FiltersProbe />
    </>,
    over,
  )
  return { ...view, onClose }
}

const box = () => screen.getByRole('combobox')
const option = (name: string | RegExp) => screen.getByRole('option', { name })
const labels = () => screen.queryAllByRole('option').map((o) => o.querySelector('span')!.textContent)
const selected = () => screen.getByRole('option', { selected: true })
/** The palette with the member list in: the last thing it loads. */
const settled = () => screen.findByRole('option', { name: 'Act as Luca Neri (viewer)' })
const searches = () => api.callsTo('GET', '/search')

beforeAll(() => {
  // jsdom has no object URLs: the export needs them to finish.
  URL.createObjectURL = () => 'blob:export'
  URL.revokeObjectURL = () => {}
})

beforeEach(() => {
  setFilters(NO_FILTERS)
  api.get('/tags', TAGS)
  api.get('/search', found(...HITS))
  // Fetched once for the whole file (the app caches the member list).
  api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
})

describe('Palette', () => {
  describe('when it opens', () => {
    it('puts the cursor in the search box', async () => {
      open()
      expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
      expect(box()).toHaveFocus()
      expect(box()).toHaveValue('')
      expect(box()).toHaveAttribute('placeholder', 'Jump to a view, search facts, run an action…')
      await settled()
    })

    it('lists every view, then every action, with the first one selected', async () => {
      open()
      await settled()
      expect(labels()).toEqual([...VIEWS, ...ACTIONS])
      expect(screen.getByText('Go to')).toBeInTheDocument()
      expect(screen.getByText('Actions')).toBeInTheDocument()
      expect(screen.queryByText('Facts')).not.toBeInTheDocument()
      expect(screen.queryByText('Tags')).not.toBeInTheDocument()
      expect(selected()).toBe(option('Home'))
      expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1)
    })

    it('asks for the tags of the project and searches nothing yet', async () => {
      open()
      await settled()
      await waitFor(() => expect(api.callsTo('GET', '/tags')).toHaveLength(1))
      expect(Object.fromEntries(api.last('GET', '/tags')!.query)).toEqual({ project_id: 'proj-clearpath' })
      expect(searches()).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('asks for the tags of the whole organisation in organisation scope', async () => {
      const { user } = open({ scope: 'org' })
      await settled()
      await waitFor(() => expect(api.callsTo('GET', '/tags')).toHaveLength(1))
      expect(api.last('GET', '/tags')!.query.has('project_id')).toBe(false)
      await user.type(box(), 'weeks')
      await waitFor(() => expect(searches()).toHaveLength(1))
      expect(searches()[0].query.has('project_id')).toBe(false)
    })
  })

  describe('go to', () => {
    it.each([
      ['Home', '#/dashboard'],
      ['Ask', '#/app'],
      ['Memory', '#/memory'],
      ['Conflicts', '#/conflicts'],
      ['Open questions', '#/open-questions'],
      ['Maintenance', '#/maintenance'],
      ['Sources', '#/sources'],
      ['Overview', '#/projects'],
      ['Audit log', '#/audit'],
      ['Settings', '#/settings'],
      ['Members', '#/settings/members'],
      ['Roles', '#/settings/roles'],
      ['Demo control', '#/admin'],
      ['Setup', '#/setup'],
    ])('%s goes to %s and closes', async (label, hash) => {
      const { user, onClose } = open()
      await user.click(option(label))
      expect(location.hash).toBe(hash)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('typing', () => {
    it('narrows the views and actions to the ones that contain the words, whatever the case', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), 'SET')
      expect(labels()).toEqual(['Settings', 'Setup'])
      expect(screen.getByText('Go to')).toBeInTheDocument()
      expect(screen.queryByText('Actions')).not.toBeInTheDocument()

      await user.clear(box())
      await user.type(box(), 'act as')
      expect(labels()).toEqual(ACTIONS.slice(2))
      expect(screen.queryByText('Go to')).not.toBeInTheDocument()

      await user.clear(box())
      await user.type(box(), '(viewer)')
      expect(labels()).toEqual(['Act as Luca Neri (viewer)'])
    })

    it('ignores the spaces around the words', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), '  roles ')
      expect(labels()).toEqual(['Roles'])
    })

    it('keeps everything listed for spaces alone and searches nothing', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), '   ')
      expect(labels()).toEqual([...VIEWS, ...ACTIONS])
      // Longer than the pause before a search.
      await act(() => new Promise((r) => setTimeout(r, 250)))
      expect(searches()).toHaveLength(0)
    })

    it('says when nothing matches, and Enter then does nothing', async () => {
      api.get('/search', found())
      const { user, onClose, app } = open()
      await settled()
      await user.type(box(), 'zebra')
      expect(screen.getByText('No results for “zebra”.')).toBeInTheDocument()
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
      await waitFor(() => expect(searches()).toHaveLength(1))

      await user.keyboard('{Enter}')
      expect(onClose).not.toHaveBeenCalled()
      expect(app.openFact).not.toHaveBeenCalled()
      expect(location.hash).toBe('')
    })
  })

  describe('facts', () => {
    it('searches the facts once the typing pauses and lists them first, with their id', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), ' Autonomy ')
      expect(await screen.findByText('Facts')).toBeInTheDocument()
      expect(labels()).toEqual(['New consultants reach autonomy in 3–4 weeks', 'Autonomy takes roughly six weeks'])
      expect(option(/New consultants reach autonomy/)).toHaveTextContent('M-106')
      expect(option(/Autonomy takes roughly six weeks/)).toHaveTextContent('M-101')
      expect(selected()).toBe(option(/New consultants reach autonomy/))

      expect(searches()).toHaveLength(1)
      expect(Object.fromEntries(searches()[0].query)).toEqual({ q: 'Autonomy', kind: 'fact', project_id: 'proj-clearpath', limit: '6' })
    })

    it('lists the facts above the matching views', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), 'memory')
      await screen.findByText('Facts')
      expect(labels()).toEqual(['New consultants reach autonomy in 3–4 weeks', 'Autonomy takes roughly six weeks', 'Memory', 'Export memory as JSON'])
      expect(screen.getByText('Go to')).toBeInTheDocument()
      expect(screen.getByText('Actions')).toBeInTheDocument()
    })

    it('shows at most six facts and leaves the documents out', async () => {
      api.get(
        '/search',
        found(
          result('D-1', 'A document about autonomy', 'document'),
          ...Array.from({ length: 8 }, (_, i) => result(`M-${i + 1}`, `Fact number ${i + 1}`)),
        ),
      )
      const { user } = open()
      await settled()
      await user.type(box(), 'number')
      await screen.findByText('Facts')
      expect(labels()).toEqual(['Fact number 1', 'Fact number 2', 'Fact number 3', 'Fact number 4', 'Fact number 5', 'Fact number 6'])
    })

    it('opens the fact that is clicked and closes', async () => {
      const { user, onClose, app } = open()
      await user.type(box(), 'autonomy')
      await user.click(await screen.findByRole('option', { name: /Autonomy takes roughly six weeks/ }))
      expect(app.openFact).toHaveBeenCalledTimes(1)
      expect(app.openFact).toHaveBeenCalledWith('M-101')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('')
    })

    it('opens the first fact on Enter once the results are in', async () => {
      const { user, onClose, app } = open()
      await user.type(box(), 'autonomy')
      await screen.findByText('Facts')
      await user.keyboard('{Enter}')
      expect(app.openFact).toHaveBeenCalledWith('M-106')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('searches once for the whole word, not for every letter', async () => {
      const { user } = open()
      await user.type(box(), 'autonomy')
      await screen.findByText('Facts')
      expect(searches().map((c) => c.query.get('q'))).toEqual(['autonomy'])
    })

    it('searches again when the words change', async () => {
      api.get('/search', (req) => found(result('M-1', `About ${req.query.get('q')}`))(req))
      const { user } = open()
      await user.type(box(), 'weeks')
      expect(await screen.findByRole('option', { name: /About weeks/ })).toBeInTheDocument()
      await user.type(box(), ' of work')
      expect(await screen.findByRole('option', { name: /About weeks of work/ })).toBeInTheDocument()
      expect(searches().map((c) => c.query.get('q'))).toEqual(['weeks', 'weeks of work'])
    })

    it('drops the facts as soon as the box is emptied', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), 'autonomy')
      await screen.findByText('Facts')
      await user.clear(box())
      expect(screen.queryByText('Facts')).not.toBeInTheDocument()
      expect(labels()).toEqual([...VIEWS, ...ACTIONS])
    })

    it('still offers views and actions when the search fails', async () => {
      api.get('/search', fail(500, 'index is rebuilding'))
      const { user } = open()
      await settled()
      await user.type(box(), 'memory')
      await waitFor(() => expect(searches()).toHaveLength(1))
      expect(labels()).toEqual(['Memory', 'Export memory as JSON'])
      expect(screen.queryByText('Facts')).not.toBeInTheDocument()
    })

    it('shows the views at once, without waiting for the search', async () => {
      const gate = deferred<Schemas['SearchResponse']>()
      api.get('/search', () => gate.promise)
      const { user } = open()
      await settled()
      await user.type(box(), 'memory')
      expect(labels()).toEqual(['Memory', 'Export memory as JSON'])

      await waitFor(() => expect(searches()).toHaveLength(1))
      gate.resolve({ query: 'memory', total: 1, results: [HITS[0]] })
      expect(await screen.findByText('Facts')).toBeInTheDocument()
      expect(labels()).toEqual(['New consultants reach autonomy in 3–4 weeks', 'Memory', 'Export memory as JSON'])
    })
  })

  describe('tags', () => {
    it('lists the tags that contain the words, with how many facts carry them', async () => {
      api.get('/search', found())
      const { user } = open()
      await settled()
      await user.type(box(), 'PRIC')
      expect(screen.getByText('Tags')).toBeInTheDocument()
      expect(labels()).toEqual(['pricing', 'topic:pricing-model'])
      expect(option(/^pricing/)).toHaveTextContent('2 facts')
      expect(option(/^topic:pricing-model/)).toHaveTextContent('7 facts')
    })

    it('counts a single fact in the singular', async () => {
      api.get('/search', found())
      const { user } = open()
      await settled()
      await user.type(box(), 'onboarding')
      expect(option(/^Onboarding/)).toHaveTextContent(/1 fact$/)
    })

    it('finds a tag typed with its #', async () => {
      api.get('/search', found())
      const { user } = open()
      await settled()
      await user.type(box(), '#onb')
      expect(labels()).toEqual(['Onboarding'])
    })

    it('lists no tag for a # alone', async () => {
      api.get('/search', found())
      const { user } = open()
      await settled()
      await user.type(box(), '#')
      expect(screen.queryByText('Tags')).not.toBeInTheDocument()
      expect(screen.getByText('No results for “#”.')).toBeInTheDocument()
    })

    it('shows at most five tags', async () => {
      api.get('/search', found())
      api.get(
        '/tags',
        Array.from({ length: 8 }, (_, i) => ({ tag: `client-${i + 1}`, count: i + 1 })),
      )
      const { user } = open()
      await settled()
      await user.type(box(), 'client')
      expect(labels()).toEqual(['client-1', 'client-2', 'client-3', 'client-4', 'client-5'])
    })

    it('lists the tags between the facts and the views', async () => {
      api.get('/tags', [{ tag: 'memory-hygiene', count: 3 }])
      const { user } = open()
      await settled()
      await user.type(box(), 'memory')
      await screen.findByText('Facts')
      expect(labels()).toEqual(['New consultants reach autonomy in 3–4 weeks', 'Autonomy takes roughly six weeks', 'memory-hygiene', 'Memory', 'Export memory as JSON'])
    })

    it('opens Memory on the facts with the tag, dropping the other filters and the open fact', async () => {
      api.get('/search', found())
      setFilters({ q: 'weeks', type: 'DECISION', status: 'binding', topic: 'pricing', tag: 'old' })
      const { user, onClose, app } = open({ factId: 'M-106' })
      await settled()
      await user.type(box(), 'pricing-model')
      await user.click(option(/^topic:pricing-model/))
      expect(filters()).toEqual({ ...NO_FILTERS, tag: 'topic:pricing-model' })
      expect(app.openFact).toHaveBeenCalledWith(null)
      expect(location.hash).toBe('#/memory')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('lists no tags when they cannot be loaded', async () => {
      api.get('/search', found())
      api.get('/tags', fail(500, 'boom'))
      const { user } = open()
      await settled()
      await user.type(box(), 'pricing')
      expect(screen.queryByText('Tags')).not.toBeInTheDocument()
      expect(screen.getByText('Search is not available right now.')).toBeInTheDocument()
      expect(screen.queryByText('No results for “pricing”.')).not.toBeInTheDocument()
    })

    it('shows an error with a retry button when the search fails, and recovers on retry or on the next keystroke', async () => {
      let up = false
      api.get('/search', (req) => (up ? found(...HITS)(req) : fail(500, 'index is rebuilding')))
      const { user } = open()
      await settled()
      await user.type(box(), 'zebra')
      expect(await screen.findByText('Search is not available right now.')).toBeInTheDocument()
      expect(screen.queryByText('No results for “zebra”.')).not.toBeInTheDocument()

      up = true
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Facts')).toBeInTheDocument()
      expect(screen.queryByText('Search is not available right now.')).not.toBeInTheDocument()
    })

    it('searches again on the next keystroke after a failure', async () => {
      let up = false
      api.get('/search', (req) => (up ? found(...HITS)(req) : fail(500, 'index is rebuilding')))
      const { user } = open()
      await settled()
      await user.type(box(), 'zebr')
      await screen.findByText('Search is not available right now.')
      up = true
      await user.type(box(), 'a')
      expect(await screen.findByText('Facts')).toBeInTheDocument()
    })
  })

  describe('actions', () => {
    describe('export', () => {
      beforeEach(() => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      })

      it('downloads the export, says how many facts it holds and closes', async () => {
        api.get('/export', { version: '1', exported_at: '2026-11-14T10:00:00Z', corpus: 'clearpath', documents: [], topics: [], facts: [fact(), fact({ id: 'M-107' })], audit: [], answers: [] })
        const { user, onClose } = open()
        await user.click(option('Export memory as JSON'))
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(await screen.findByText('Export downloaded: 2 facts as JSON.')).toBeInTheDocument()
        expect(api.callsTo('GET', '/export')).toHaveLength(1)
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
      })

      it('says why when the export fails', async () => {
        api.get('/export', fail(500, 'disk full'))
        const { user, onClose } = open()
        await user.click(option('Export memory as JSON'))
        expect(await screen.findByText('That did not work. disk full')).toBeInTheDocument()
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
      })
    })

    describe('theme', () => {
      it('switches to the dark theme, remembers it and closes', async () => {
        const { user, onClose } = open()
        await user.click(option('Switch light / dark theme'))
        expect(document.documentElement).toHaveClass('dark')
        expect(localStorage.getItem('canonico-theme')).toBe('dark')
        expect(onClose).toHaveBeenCalledTimes(1)
      })

      it('switches back to the light theme', async () => {
        document.documentElement.classList.add('dark')
        const { user } = open()
        await user.click(option('Switch light / dark theme'))
        expect(document.documentElement).not.toHaveClass('dark')
        expect(localStorage.getItem('canonico-theme')).toBe('light')

        await user.click(option('Switch light / dark theme'))
        expect(document.documentElement).toHaveClass('dark')
        expect(localStorage.getItem('canonico-theme')).toBe('dark')
      })

      it('switches even when the choice cannot be remembered', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('denied', 'SecurityError')
        })
        const { user, onClose } = open()
        await user.click(option('Switch light / dark theme'))
        expect(document.documentElement).toHaveClass('dark')
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })

    describe('act as', () => {
      it('offers every member with their role', async () => {
        open()
        await settled()
        expect(labels().filter((l) => l?.startsWith('Act as'))).toEqual(ACTIONS.slice(2))
      })

      it('switches to the member that is picked and closes', async () => {
        const { user, onClose, app } = open()
        await user.click(await screen.findByRole('option', { name: 'Act as Sara Conti (editor)' }))
        expect(app.setActor).toHaveBeenCalledTimes(1)
        expect(app.setActor).toHaveBeenCalledWith('mem-sara')
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('keyboard', () => {
    it('moves the selection with the arrows and runs it with Enter', async () => {
      const { user, onClose } = open()
      await settled()
      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(selected()).toBe(option('Memory'))
      await user.keyboard('{ArrowUp}')
      expect(selected()).toBe(option('Ask'))
      expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1)

      await user.keyboard('{Enter}')
      expect(location.hash).toBe('#/app')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('runs the first entry on Enter straight away', async () => {
      const { user, onClose } = open()
      await user.keyboard('{Enter}')
      expect(location.hash).toBe('#/dashboard')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('stops at the first and at the last entry', async () => {
      const { user } = open()
      await settled()
      await user.keyboard('{ArrowUp}{ArrowUp}')
      expect(selected()).toBe(option('Home'))

      await user.keyboard('{ArrowDown>30/}')
      expect(selected()).toBe(option('Act as Luca Neri (viewer)'))
      await user.keyboard('{ArrowUp}')
      expect(selected()).toBe(option('Act as Sara Conti (editor)'))
    })

    it('keeps the cursor in the box while the arrows move the selection', async () => {
      const { user } = open()
      await settled()
      await user.type(box(), 'set')
      await user.keyboard('{ArrowDown}')
      expect(box()).toHaveFocus()
      expect(box()).toHaveValue('set')
      expect(selected()).toBe(option('Setup'))
    })

    it('scrolls the selected entry into view', async () => {
      const { user } = open()
      await settled()
      const scroll = vi.mocked(Element.prototype.scrollIntoView)
      scroll.mockClear()
      await user.keyboard('{ArrowDown}')
      expect(scroll).toHaveBeenCalledTimes(1)
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scroll.mock.contexts[0]).toBe(option('Ask'))
    })

    it('goes back to the first entry when the words change', async () => {
      const { user } = open()
      await settled()
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
      expect(selected()).toBe(option('Conflicts'))
      await user.type(box(), 'se')
      expect(selected()).toBe(option('Settings'))
      await user.keyboard('{Enter}')
      expect(location.hash).toBe('#/settings')
    })

    it('selects the entry under the mouse, and Enter runs that one', async () => {
      const { user, onClose } = open()
      await settled()
      await user.hover(option('Sources'))
      expect(selected()).toBe(option('Sources'))
      expect(box()).toHaveFocus()

      await user.keyboard('{ArrowDown}')
      expect(selected()).toBe(option('Overview'))
      await user.hover(option('Audit log'))
      await user.keyboard('{Enter}')
      expect(location.hash).toBe('#/audit')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('closing', () => {
    it('closes on Escape without doing anything', async () => {
      const { user, onClose, app } = open()
      await settled()
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('')
      expect(app.openFact).not.toHaveBeenCalled()
      expect(app.setActor).not.toHaveBeenCalled()
    })

    it('keeps Escape from reaching what is behind it', async () => {
      const onWindowKey = vi.fn()
      window.addEventListener('keydown', onWindowKey)
      try {
        const { user } = open()
        await settled()
        await user.keyboard('{Escape}')
        expect(onWindowKey).not.toHaveBeenCalled()
        await user.keyboard('{ArrowDown}')
        expect(onWindowKey).toHaveBeenCalledTimes(1)
      } finally {
        window.removeEventListener('keydown', onWindowKey)
      }
    })

    it('closes when the page behind is clicked', async () => {
      const { user, onClose } = open()
      await settled()
      await user.click(document.querySelector('.scrim')!)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('')
    })

    it('stops listening for Escape once it is gone', async () => {
      const { user, onClose, unmount } = open()
      await settled()
      unmount()
      await user.keyboard('{Escape}')
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
