import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadExport,
  fetchAllFacts,
  latestEvent,
  NO_FILTERS,
  runAction,
  setFilters,
  statesOf,
  undoEvent,
  useFilters,
} from '../../../src/screens/memory/api'
import { api, fail, offline } from '../../helpers/api'
import { auditEvent, fact, MEMBERS } from '../../helpers/fixtures'

describe('fetchAllFacts', () => {
  const all = Array.from({ length: 1100 }, (_, i) => fact({ id: `M-${i}` }))

  it('pages through GET /facts 500 at a time', async () => {
    api.get('/facts', (req) => {
      const offset = Number(req.query.get('offset'))
      return { items: all.slice(offset, offset + 500), total: all.length, limit: 500, offset }
    })
    const out = await fetchAllFacts('proj-clearpath')
    expect(out).toHaveLength(1100)
    expect(out.at(-1)!.id).toBe('M-1099')
    const calls = api.callsTo('GET', '/facts')
    expect(calls.map((c) => c.query.get('offset'))).toEqual(['0', '500', '1000'])
    expect(calls.every((c) => c.query.get('limit') === '500' && c.query.get('project_id') === 'proj-clearpath')).toBe(true)
  })

  it('asks once when everything fits in a page', async () => {
    api.get('/facts', { items: [fact()], total: 1, limit: 500, offset: 0 })
    expect(await fetchAllFacts('proj-clearpath')).toHaveLength(1)
    expect(api.callsTo('GET', '/facts')).toHaveLength(1)
  })

  it('stops on an empty page even if the total says there is more', async () => {
    api.get('/facts', (req) => ({ items: req.query.get('offset') === '0' ? [fact()] : [], total: 99, limit: 500, offset: 0 }))
    expect(await fetchAllFacts(undefined)).toHaveLength(1)
    expect(api.callsTo('GET', '/facts')).toHaveLength(2)
  })

  it('sends no project in organisation scope', async () => {
    api.get('/facts', { items: [], total: 0, limit: 500, offset: 0 })
    await fetchAllFacts(undefined)
    expect(api.last('GET', '/facts')!.query.has('project_id')).toBe(false)
  })

  it('fails when a page fails', async () => {
    api.get('/facts', fail(500, 'boom'))
    await expect(fetchAllFacts('p')).rejects.toMatchObject({ status: 500 })
  })
})

describe('statesOf', () => {
  it('computes one binding fact per topic', () => {
    const facts = [
      fact({ id: 'M-1', topic: 'a', date: '2025-08-01', type: 'SUPERSEDED', superseded_by: 'M-2' }),
      fact({ id: 'M-2', topic: 'a', date: '2025-11-01' }),
      fact({ id: 'M-3', topic: 'b', date: '2025-09-01' }),
      fact({ id: 'M-4', topic: 'b', date: '2025-10-01', status: 'retired' }),
    ]
    const st = statesOf(facts)
    expect([...st.keys()]).toEqual(['M-1', 'M-2', 'M-3', 'M-4'])
    expect(st.get('M-1')!.key).toBe('superseded')
    expect(st.get('M-2')!.key).toBe('binding')
    expect(st.get('M-3')!.key).toBe('binding')
    expect(st.get('M-4')!.key).toBe('retired')
  })

  it('marks facts newer than a pinned one as held', () => {
    const st = statesOf([fact({ id: 'M-1', date: '2025-08-01', pinned: true }), fact({ id: 'M-2', date: '2025-11-01' })])
    expect(st.get('M-1')!.key).toBe('binding')
    expect(st.get('M-2')!.key).toBe('held')
  })

  it('a pin in one topic does not hold facts of another', () => {
    const st = statesOf([fact({ id: 'M-1', topic: 'a', date: '2025-08-01', pinned: true }), fact({ id: 'M-2', topic: 'b', date: '2025-11-01' })])
    expect(st.get('M-2')!.key).toBe('binding')
  })

  it('is empty without facts', () => {
    expect(statesOf([]).size).toBe(0)
  })
})

describe('members', () => {
  // The list is cached in the module, so each test loads its own copy.
  const load = async () => {
    vi.resetModules()
    return (await import('../../../src/screens/memory/api')).members
  }
  afterEach(() => {
    vi.resetModules()
  })

  it('loads the organisation members once', async () => {
    api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
    const members = await load()
    expect((await members()).map((m) => m.name)).toEqual(['Giulia Ferri', 'Marco Fiore', 'Sara Conti', 'Luca Neri'])
    await members()
    expect(api.callsTo('GET', '/org/members')).toHaveLength(1)
  })

  it('is empty when the request fails, and asks again next time', async () => {
    api.get('/org/members', fail(500, 'boom'))
    const members = await load()
    expect(await members()).toEqual([])
    api.get('/org/members', { items: [MEMBERS.giulia], total: 1 })
    expect(await members()).toHaveLength(1)
    expect(api.callsTo('GET', '/org/members')).toHaveLength(2)
  })

  it('is empty when the answer has no items', async () => {
    api.get('/org/members', {})
    expect(await (await load())()).toEqual([])
  })
})

describe('runAction', () => {
  beforeEach(() => {
    for (const op of ['retire', 'restore', 'pin', 'unpin']) api.post(`/facts/:id/${op}`, (req) => fact({ id: req.params.id }))
    api.patch('/facts/:id', (req) => fact({ id: req.params.id, value: (req.body as { value: string }).value }))
  })

  it.each(['retire', 'pin', 'unpin'] as const)('%s posts the actor and the reason', async (kind) => {
    const out = await runAction(kind, 'M-105', 'Giulia', 'Out of date')
    expect(out.id).toBe('M-105')
    const sent = api.last('POST', `/facts/:id/${kind}`)!
    expect(sent.params.id).toBe('M-105')
    expect(sent.body).toEqual({ actor: 'Giulia', reason: 'Out of date' })
  })

  it('restore sends the reason only when there is one', async () => {
    await runAction('restore', 'M-105', 'Giulia', '')
    expect(api.last('POST', '/facts/:id/restore')!.body).toEqual({ actor: 'Giulia' })
    await runAction('restore', 'M-105', 'Giulia', 'Still valid')
    expect(api.last('POST', '/facts/:id/restore')!.body).toEqual({ actor: 'Giulia', reason: 'Still valid' })
  })

  it('correct patches the value', async () => {
    const out = await runAction('correct', 'M-105', 'Giulia', 'Typo', '4 weeks')
    expect(out.value).toBe('4 weeks')
    expect(api.last('PATCH', '/facts/:id')!.body).toEqual({ actor: 'Giulia', reason: 'Typo', value: '4 weeks' })
  })

  it('throws the backend error', async () => {
    api.post('/facts/:id/retire', fail(403, 'Role viewer lacks permission retire_fact.', 'forbidden'))
    await expect(runAction('retire', 'M-105', 'Luca', 'x')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('latestEvent', () => {
  it('asks for the newest audit event of the fact', async () => {
    api.get('/audit', [auditEvent({ id: 'A-9' })])
    expect(await latestEvent('M-105')).toBe('A-9')
    const q = api.last('GET', '/audit')!.query
    expect(q.get('fact_id')).toBe('M-105')
    expect(q.get('limit')).toBe('1')
  })

  it('accepts an { items } answer', async () => {
    api.get('/audit', { items: [auditEvent({ id: 'A-9' })] })
    expect(await latestEvent('M-105')).toBe('A-9')
  })

  it('is null when there is no event or the request fails', async () => {
    api.get('/audit', [])
    expect(await latestEvent('M-105')).toBeNull()
    api.get('/audit', {})
    expect(await latestEvent('M-105')).toBeNull()
    api.get('/audit', fail(500))
    expect(await latestEvent('M-105')).toBeNull()
    api.get('/audit', offline)
    expect(await latestEvent('M-105')).toBeNull()
  })
})

describe('undoEvent', () => {
  it('posts the undo with actor and reason', async () => {
    api.post('/audit/:id/undo', {})
    await undoEvent('A-9', 'Giulia', 'Changed my mind')
    const sent = api.last('POST', '/audit/:id/undo')!
    expect(sent.params.id).toBe('A-9')
    expect(sent.body).toEqual({ actor: 'Giulia', reason: 'Changed my mind' })
  })
})

describe('downloadExport', () => {
  let clicked: HTMLAnchorElement[]
  let blobs: Blob[]

  beforeEach(() => {
    clicked = []
    blobs = []
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:export'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('downloads the export as a dated JSON file and returns the number of facts', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z'))
    const data = { facts: [fact({ id: 'M-1' }), fact({ id: 'M-2' })], topics: [] }
    api.get('/export', data)

    expect(await downloadExport()).toBe(2)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('canonico-export-2026-11-14.json')
    expect(clicked[0].href).toBe('blob:export')
    expect(blobs[0].type).toBe('application/json')
    expect(JSON.parse(await blobs[0].text())).toEqual(data)
    // The temporary link does not stay in the page, and the blob is released a moment later.
    expect(document.querySelector('a[download]')).toBeNull()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
  })

  it('counts zero facts when the export has none', async () => {
    api.get('/export', {})
    expect(await downloadExport()).toBe(0)
  })

  it('downloads nothing when the export fails', async () => {
    api.get('/export', fail(403, 'Forbidden'))
    await expect(downloadExport()).rejects.toMatchObject({ status: 403 })
    expect(clicked).toHaveLength(0)
  })
})

describe('memory filters', () => {
  beforeEach(() => setFilters(NO_FILTERS))

  function Probe() {
    const f = useFilters()
    return <div data-testid="f">{[f.q, f.type, f.status, f.topic, f.tag].join('|')}</div>
  }

  it('start with nothing filtered', () => {
    render(<Probe />)
    expect(screen.getByTestId('f')).toHaveTextContent('|all|all|all|all')
  })

  it('merge a partial change and keep the rest', () => {
    render(<Probe />)
    act(() => setFilters({ type: 'DECISION' }))
    act(() => setFilters({ q: 'weeks' }))
    expect(screen.getByTestId('f')).toHaveTextContent('weeks|DECISION|all|all|all')
  })

  it('accept an updater function', () => {
    render(<Probe />)
    act(() => setFilters({ topic: 'a' }))
    act(() => setFilters((f) => ({ ...f, tag: f.topic + '-tag' })))
    expect(screen.getByTestId('f')).toHaveTextContent('|all|all|a|a-tag')
  })

  it('are shared by every component that reads them', () => {
    render(
      <>
        <Probe />
        <Probe />
      </>,
    )
    act(() => setFilters({ status: 'retired' }))
    expect(screen.getAllByTestId('f').map((el) => el.textContent)).toEqual(['|all|retired|all|all', '|all|retired|all|all'])
  })

  it('stop notifying a component that unmounted', () => {
    const { unmount } = render(<Probe />)
    unmount()
    expect(() => setFilters({ q: 'x' })).not.toThrow()
  })
})
