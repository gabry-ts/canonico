import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToasts, subscribeToasts, toast, toastError, toastMs } from '../../src/ui/toastStore'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('adds a toast with the default options', () => {
    toast('Saved')
    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0]).toMatchObject({ msg: 'Saved', opts: {} })
  })

  it('keeps the order and gives every toast its own id', () => {
    toast('one')
    toast('two')
    toast('one')
    const list = getToasts()
    expect(list.map((t) => t.msg)).toEqual(['one', 'two', 'one'])
    expect(new Set(list.map((t) => t.id)).size).toBe(3)
  })

  it('removes a toast after 3.4 seconds', () => {
    toast('Saved')
    vi.advanceTimersByTime(3399)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('a long toast stays 5.6 seconds', () => {
    toast('Undo?', { long: true })
    vi.advanceTimersByTime(5599)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('removes only the toast whose time is up', () => {
    toast('long', { long: true })
    toast('short')
    vi.advanceTimersByTime(3400)
    expect(getToasts().map((t) => t.msg)).toEqual(['long'])
  })

  it('toastMs', () => {
    expect(toastMs({})).toBe(3400)
    expect(toastMs({ long: false })).toBe(3400)
    expect(toastMs({ long: true })).toBe(5600)
  })

  it('an error toast is long and has the alert icon', () => {
    toastError('Nope')
    expect(getToasts()[0]).toMatchObject({ msg: 'Nope', opts: { icon: 'alert', long: true } })
  })

  it('keeps the action', () => {
    const run = vi.fn()
    toast('Retired', { action: { label: 'Undo', run } })
    getToasts()[0].opts.action!.run()
    expect(run).toHaveBeenCalled()
  })

  it('tells subscribers when a toast appears and when it goes, until they unsubscribe', () => {
    const cb = vi.fn()
    const off = subscribeToasts(cb)
    toast('Saved')
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3400)
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    toast('Again')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('hands out a new list on every change, so React sees it', () => {
    const before = getToasts()
    toast('Saved')
    expect(getToasts()).not.toBe(before)
  })
})
