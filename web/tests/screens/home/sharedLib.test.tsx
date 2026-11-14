import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asList, curlFor, humanTopic, ITEM_ICON, ITEM_TYPES, runSync, tagCls, tagSort, todayIso, useCopy, type SyncJob } from '../../../src/screens/home/sharedLib'
import { api, fail } from '../../helpers/api'
import { renderI18n } from '../../helpers/render'

const job = (over: Partial<SyncJob> = {}): SyncJob => ({ id: 'job-1', source_id: 'src-1', status: 'queued', ...over })

describe('asList', () => {
  it('accepts a bare array and an { items } object', () => {
    expect(asList([1, 2])).toEqual([1, 2])
    expect(asList({ items: [1, 2], total: 2 })).toEqual([1, 2])
  })

  it('is empty for anything else', () => {
    expect(asList(null)).toEqual([])
    expect(asList(undefined)).toEqual([])
    expect(asList({})).toEqual([])
    expect(asList({ items: 'nope' })).toEqual([])
    expect(asList('text')).toEqual([])
  })
})

describe('tags', () => {
  it('tagCls marks topic tags', () => {
    expect(tagCls('topic:onboarding')).toBe('topic')
    expect(tagCls('weekly')).toBe('')
    expect(tagCls('my-topic:x')).toBe('')
  })

  it('tagSort puts plain tags first, then topic tags, each alphabetically', () => {
    expect(['topic:b', 'zeta', 'topic:a', 'alpha'].sort(tagSort)).toEqual(['alpha', 'zeta', 'topic:a', 'topic:b'])
  })

  it('humanTopic turns a slug into a title', () => {
    expect(humanTopic('onboarding-target')).toBe('Onboarding target')
    expect(humanTopic('audit_turn--around')).toBe('Audit turn around')
    expect(humanTopic('x')).toBe('X')
    expect(humanTopic('')).toBe('')
  })

  it('every item type has an icon', () => {
    expect(ITEM_TYPES.every((t) => ITEM_ICON[t])).toBe(true)
  })
})

describe('curlFor', () => {
  it('builds a runnable curl command with the token, the date and the tags', () => {
    const cmd = curlFor('http://api.test/hooks/in/abc', ['topic:onboarding', 'weekly'], 'secret-1', '2026-11-14')
    expect(cmd).toContain('curl -X POST http://api.test/hooks/in/abc \\\n')
    expect(cmd).toContain('-H "X-Canonico-Token: secret-1"')
    expect(cmd).toContain('-H "Content-Type: application/json"')
    const body = JSON.parse(/-d '([\s\S]*)'$/.exec(cmd)![1])
    expect(body).toEqual({
      type: 'meeting',
      title: 'Weekly sync',
      date: '2026-11-14T10:00:00Z',
      text: 'We agreed the onboarding target stays at 3–4 weeks.',
      tags: ['topic:onboarding', 'weekly'],
    })
  })

  it('sends an empty tag list when there are none', () => {
    const cmd = curlFor('http://x', [], 't', '2026-01-01')
    expect(JSON.parse(/-d '([\s\S]*)'$/.exec(cmd)![1]).tags).toEqual([])
  })
})

describe('todayIso', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is the local date, zero padded', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59))
    expect(todayIso()).toBe('2026-01-05')
    vi.setSystemTime(new Date(2026, 10, 14, 0, 0))
    expect(todayIso()).toBe('2026-11-14')
  })
})

describe('runSync', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts a sync and returns at once when the job is already done', async () => {
    api.post('/sources/:id/sync', job({ status: 'done', items_added: 3 }))
    const steps: string[] = []
    const out = await runSync('src-1', (j) => steps.push(j.status))
    expect(out).toMatchObject({ status: 'done', items_added: 3 })
    expect(steps).toEqual(['done'])
    expect(api.last('POST', '/sources/:id/sync')!.params.id).toBe('src-1')
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(0)
  })

  it('polls the job until it finishes and reports every state', async () => {
    vi.useFakeTimers()
    const states: SyncJob['status'][] = ['running', 'running', 'done']
    api.post('/sources/:id/sync', job({ status: 'queued' }))
    api.get('/sync-jobs/:id', (req) => job({ id: req.params.id, status: states.shift()!, facts_created: 7 }))
    const steps: string[] = []
    const p = runSync('src-1', (j) => steps.push(j.status))
    await vi.advanceTimersByTimeAsync(1500)
    await expect(p).resolves.toMatchObject({ status: 'done', facts_created: 7 })
    expect(steps).toEqual(['queued', 'running', 'running', 'done'])
    expect(api.callsTo('GET', '/sync-jobs/:id').map((c) => c.params.id)).toEqual(['job-1', 'job-1', 'job-1'])
  })

  it('waits half a second between the first polls', async () => {
    vi.useFakeTimers()
    api.post('/sources/:id/sync', job({ status: 'queued' }))
    api.get('/sync-jobs/:id', job({ status: 'running' }))
    void runSync('src-1').catch(() => {})
    await vi.advanceTimersByTimeAsync(499)
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(2)
  })

  it('stops on an error state', async () => {
    vi.useFakeTimers()
    api.post('/sources/:id/sync', job({ status: 'running' }))
    api.get('/sync-jobs/:id', job({ status: 'error' }))
    const p = runSync('src-1')
    await vi.advanceTimersByTimeAsync(500)
    await expect(p).resolves.toMatchObject({ status: 'error' })
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(1)
  })

  it('gives up after 120 polls and returns the job as it is', async () => {
    vi.useFakeTimers()
    api.post('/sources/:id/sync', job({ status: 'queued' }))
    api.get('/sync-jobs/:id', job({ status: 'running' }))
    const p = runSync('src-1')
    // 10 polls at 500 ms, then 110 at one second.
    await vi.advanceTimersByTimeAsync(10 * 500 + 110 * 1000)
    await expect(p).resolves.toMatchObject({ status: 'running' })
    expect(api.callsTo('GET', '/sync-jobs/:id')).toHaveLength(120)
  })

  it('throws when the sync cannot start', async () => {
    api.post('/sources/:id/sync', fail(403, 'Role viewer lacks permission manage_sources.'))
    await expect(runSync('src-1')).rejects.toMatchObject({ status: 403, message: 'Role viewer lacks permission manage_sources.' })
  })

  it('throws when a poll fails', async () => {
    vi.useFakeTimers()
    api.post('/sources/:id/sync', job({ status: 'queued' }))
    api.get('/sync-jobs/:id', fail(404, 'Job not found'))
    const p = runSync('src-1')
    const caught = p.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(500)
    expect(await caught).toMatchObject({ status: 404 })
  })
})

describe('useCopy', () => {
  function Probe() {
    const copy = useCopy()
    return <button onClick={() => copy('secret-1')}>copy</button>
  }

  it('copies to the clipboard and says so', async () => {
    const { user } = renderI18n(<Probe />)
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    await user.click(screen.getByRole('button', { name: 'copy' }))
    expect(write).toHaveBeenCalledWith('secret-1')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('says when the browser refuses', async () => {
    const { user } = renderI18n(<Probe />)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'copy' }))
    expect(await screen.findByText('Could not copy. Select the text and copy it by hand.')).toBeInTheDocument()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })
})
