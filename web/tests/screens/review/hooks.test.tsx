import { renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../src/i18n'
import { AppContext, type AppState } from '../../../src/lib/appContext'
import { useAuditActions, useFact, useMembers, useTopicNames } from '../../../src/screens/review/hooks'
import { Toaster } from '../../../src/ui/Toaster'
import { api, fail, offline } from '../../helpers/api'
import { auditEvent, fact, MEMBERS, topic } from '../../helpers/fixtures'
import { makeApp } from '../../helpers/render'

function setup(over: Partial<AppState> = {}) {
  const app = makeApp(over)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider>
      <AppContext.Provider value={app}>
        {children}
        <Toaster />
      </AppContext.Provider>
    </I18nProvider>
  )
  return { app, wrapper }
}

// `useFact` caches by data version and fact id for the whole file: every test takes a fresh version.
let nextVersion = 1000
const fresh = () => ++nextVersion

describe('useTopicNames', () => {
  it('maps a topic id to its label, and falls back to the id with spaces', async () => {
    api.get('/topics', [topic({ id: 'onboarding-target', label: 'Onboarding target' })])
    const { wrapper } = setup()
    const { result } = renderHook(() => useTopicNames(), { wrapper })
    expect(result.current('onboarding-target')).toBe('onboarding target')
    await waitFor(() => expect(result.current('onboarding-target')).toBe('Onboarding target'))
    expect(result.current('audit-turn-around')).toBe('audit turn around')
  })

  it('asks for the topics of the current scope', async () => {
    api.get('/topics', [])
    const a = setup()
    renderHook(() => useTopicNames(), { wrapper: a.wrapper })
    await waitFor(() => expect(api.callsTo('GET', '/topics')).toHaveLength(1))
    expect(api.last('GET', '/topics')!.query.get('project_id')).toBe('proj-clearpath')

    const b = setup({ scope: 'org', pid: undefined })
    renderHook(() => useTopicNames(), { wrapper: b.wrapper })
    await waitFor(() => expect(api.callsTo('GET', '/topics')).toHaveLength(2))
    expect(api.last('GET', '/topics')!.query.has('project_id')).toBe(false)
  })

  it('falls back to a topic without a label', async () => {
    api.get('/topics', [topic({ id: 'pilot-size', label: '' })])
    const { wrapper } = setup()
    const { result } = renderHook(() => useTopicNames(), { wrapper })
    await waitFor(() => expect(api.callsTo('GET', '/topics')).toHaveLength(1))
    expect(result.current('pilot-size')).toBe('pilot size')
  })
})

describe('useMembers', () => {
  it('maps a member id to a name', async () => {
    api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
    const { wrapper } = setup()
    const { result } = renderHook(() => useMembers(), { wrapper })
    expect(result.current('mem-sara')).toBe('mem-sara')
    await waitFor(() => expect(result.current('mem-sara')).toBe('Sara Conti'))
  })

  it('the system has no name, an unknown id stays as it is', async () => {
    api.get('/org/members', { items: [MEMBERS.giulia], total: 1 })
    const { wrapper } = setup()
    const { result } = renderHook(() => useMembers(), { wrapper })
    await waitFor(() => expect(result.current('mem-giulia')).toBe('Giulia Ferri'))
    expect(result.current('system')).toBeNull()
    expect(result.current('mem-gone')).toBe('mem-gone')
  })

  it('works when the members cannot be loaded', async () => {
    api.get('/org/members', fail(500))
    const { wrapper } = setup()
    const { result } = renderHook(() => useMembers(), { wrapper })
    await waitFor(() => expect(api.callsTo('GET', '/org/members')).toHaveLength(1))
    expect(result.current('mem-giulia')).toBe('mem-giulia')
    expect(result.current('system')).toBeNull()
  })
})

describe('useFact', () => {
  it('loads a fact by id', async () => {
    api.get('/facts/:id', (req) => fact({ id: req.params.id, value: '5 weeks' }))
    const { wrapper } = setup({ version: fresh() })
    const { result } = renderHook(() => useFact('M-1'), { wrapper })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.value).toBe('5 weeks'))
    expect(api.last('GET', '/facts/:id')!.params.id).toBe('M-1')
  })

  it.each([null, undefined, ''])('asks nothing for the id %o', async (id) => {
    const { wrapper } = setup({ version: fresh() })
    const { result } = renderHook(() => useFact(id), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeNull()
    expect(api.calls).toHaveLength(0)
  })

  it('asks once for a fact used in several places', async () => {
    api.get('/facts/:id', (req) => fact({ id: req.params.id }))
    const { wrapper } = setup({ version: fresh() })
    const a = renderHook(() => useFact('M-2'), { wrapper })
    const b = renderHook(() => useFact('M-2'), { wrapper })
    await waitFor(() => expect(a.result.current && b.result.current).toBeTruthy())
    expect(api.callsTo('GET', '/facts/:id')).toHaveLength(1)
  })

  it('asks again after the data changed', async () => {
    let value = 'before'
    api.get('/facts/:id', (req) => fact({ id: req.params.id, value }))
    const first = setup({ version: fresh() })
    const a = renderHook(() => useFact('M-3'), { wrapper: first.wrapper })
    await waitFor(() => expect(a.result.current?.value).toBe('before'))

    value = 'after'
    const second = setup({ version: fresh() })
    const b = renderHook(() => useFact('M-3'), { wrapper: second.wrapper })
    await waitFor(() => expect(b.result.current?.value).toBe('after'))
  })

  it('does not remember a failure: the next use asks again', async () => {
    const version = fresh()
    api.get('/facts/:id', fail(500))
    const first = setup({ version })
    const a = renderHook(() => useFact('M-4'), { wrapper: first.wrapper })
    await waitFor(() => expect(api.callsTo('GET', '/facts/:id')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(a.result.current).toBeNull()

    api.get('/facts/:id', (req) => fact({ id: req.params.id, value: 'now it works' }))
    const second = setup({ version })
    const b = renderHook(() => useFact('M-4'), { wrapper: second.wrapper })
    await waitFor(() => expect(b.result.current?.value).toBe('now it works'))
  })

  it('follows the id it is given', async () => {
    api.get('/facts/:id', (req) => fact({ id: req.params.id, value: 'value of ' + req.params.id }))
    const { wrapper } = setup({ version: fresh() })
    const { result, rerender } = renderHook(({ id }: { id: string }) => useFact(id), { wrapper, initialProps: { id: 'M-5' } })
    await waitFor(() => expect(result.current?.value).toBe('value of M-5'))
    rerender({ id: 'M-6' })
    await waitFor(() => expect(result.current?.value).toBe('value of M-6'))
  })
})

describe('useAuditActions', () => {
  it('list asks for the last 200 events of the scope', async () => {
    api.get('/audit', [auditEvent()])
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditActions(), { wrapper })
    expect(await result.current.list()).toHaveLength(1)
    const q = api.last('GET', '/audit')!.query
    expect(q.get('project_id')).toBe('proj-clearpath')
    expect(q.get('limit')).toBe('200')
  })

  it('undoIds undoes every event in order as the current person, then refreshes once', async () => {
    api.post('/audit/:id/undo', {})
    const { app, wrapper } = setup()
    const { result } = renderHook(() => useAuditActions(), { wrapper })
    await result.current.undoIds(['A-1', 'A-2'])
    const calls = api.callsTo('POST', '/audit/:id/undo')
    expect(calls.map((c) => c.params.id)).toEqual(['A-1', 'A-2'])
    expect(calls[0].body).toEqual({ actor: 'Giulia', reason: 'Undone from the review screens.' })
    expect(app.refresh).toHaveBeenCalledTimes(1)
  })

  it('undoIds stops at the first failure and does not refresh', async () => {
    api.post('/audit/:id/undo', (req) => (req.params.id === 'A-2' ? fail(409, 'Already undone') : {}))
    const { app, wrapper } = setup()
    const { result } = renderHook(() => useAuditActions(), { wrapper })
    await expect(result.current.undoIds(['A-1', 'A-2', 'A-3'])).rejects.toMatchObject({ message: 'Already undone' })
    expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-1', 'A-2'])
    expect(app.refresh).not.toHaveBeenCalled()
  })

  it('undoWithToast confirms', async () => {
    api.post('/audit/:id/undo', {})
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditActions(), { wrapper })
    await result.current.undoWithToast(['A-1'])
    expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
  })

  it('undoWithToast shows why it failed instead of throwing', async () => {
    api.post('/audit/:id/undo', fail(409, 'Already undone'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useAuditActions(), { wrapper })
    await expect(result.current.undoWithToast(['A-1'])).resolves.toBeUndefined()
    expect(await screen.findByText('That did not work. Already undone')).toBeInTheDocument()
  })

  describe('withEvents', () => {
    const before = [auditEvent({ id: 'A-1', action: 'retire' })]
    const after = [
      auditEvent({ id: 'A-3', action: 'retire' }),
      auditEvent({ id: 'A-2', action: 'resolve' }),
      auditEvent({ id: 'A-4', action: 'ingest' }),
      ...before,
    ]

    it('returns the ids of the events the write created, of the kinds asked for', async () => {
      let written = false
      api.get('/audit', () => (written ? after : before))
      const { wrapper } = setup()
      const { result } = renderHook(() => useAuditActions(), { wrapper })
      const write = vi.fn(async () => {
        written = true
      })
      expect(await result.current.withEvents(write, ['resolve', 'retire'])).toEqual(['A-3', 'A-2'])
      expect(write).toHaveBeenCalledTimes(1)
    })

    it('leaves out new events of other kinds', async () => {
      let written = false
      api.get('/audit', () => (written ? after : before))
      const { wrapper } = setup()
      const { result } = renderHook(() => useAuditActions(), { wrapper })
      expect(await result.current.withEvents(async () => void (written = true), ['resolve'])).toEqual(['A-2'])
    })

    it('still writes when the audit log cannot be read, and then has nothing to undo', async () => {
      api.get('/audit', offline)
      const { wrapper } = setup()
      const { result } = renderHook(() => useAuditActions(), { wrapper })
      const write = vi.fn(async () => {})
      expect(await result.current.withEvents(write, ['resolve'])).toEqual([])
      expect(write).toHaveBeenCalledTimes(1)
    })

    it('lets the failure of the write through', async () => {
      api.get('/audit', before)
      const { wrapper } = setup()
      const { result } = renderHook(() => useAuditActions(), { wrapper })
      await expect(result.current.withEvents(() => Promise.reject(new Error('forbidden')), ['resolve'])).rejects.toThrow('forbidden')
      expect(api.callsTo('GET', '/audit')).toHaveLength(1)
    })
  })
})
