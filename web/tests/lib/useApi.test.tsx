import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/api/client'
import { useApi } from '../../src/lib/useApi'
import { deferred } from '../helpers/api'

describe('useApi', () => {
  it('loads on mount', async () => {
    const fn = vi.fn(async () => 'data')
    const { result } = renderHook(() => useApi(fn, []))
    expect(result.current).toMatchObject({ data: undefined, error: null, loading: true })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ data: 'data', error: null })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reports the message of a failure', async () => {
    const { result } = renderHook(() => useApi(() => Promise.reject(new ApiError('Role viewer lacks permission', 403)), []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ data: undefined, error: 'Role viewer lacks permission' })
  })

  it('reports a thrown value that is not an error', async () => {
    const { result } = renderHook(() => useApi(() => Promise.reject('plain'), []))
    await waitFor(() => expect(result.current.error).toBe('plain'))
  })

  it('does nothing while the function is null', async () => {
    const { result } = renderHook(() => useApi<string>(null, []))
    expect(result.current).toMatchObject({ data: undefined, error: null, loading: false })
    await act(() => result.current.reload())
    expect(result.current).toMatchObject({ data: undefined, loading: false })
  })

  it('starts loading when the function appears', async () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useApi(q ? async () => 'hit for ' + q : null, [q]), { initialProps: { q: '' } })
    expect(result.current.loading).toBe(false)
    rerender({ q: 'weeks' })
    await waitFor(() => expect(result.current.data).toBe('hit for weeks'))
  })

  it('loads again when a dependency changes, and not when it stays the same', async () => {
    const fn = vi.fn(async (id: string) => 'fact ' + id)
    const { result, rerender } = renderHook(({ id }: { id: string }) => useApi(() => fn(id), [id]), { initialProps: { id: 'M-1' } })
    await waitFor(() => expect(result.current.data).toBe('fact M-1'))
    rerender({ id: 'M-1' })
    expect(fn).toHaveBeenCalledTimes(1)
    rerender({ id: 'M-2' })
    await waitFor(() => expect(result.current.data).toBe('fact M-2'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps the data on screen while it reloads', async () => {
    const gate = deferred<string>()
    const answers: Promise<string>[] = [Promise.resolve('first'), gate.promise]
    const { result } = renderHook(() => useApi(() => answers.shift()!, []))
    await waitFor(() => expect(result.current.data).toBe('first'))

    let done!: Promise<void>
    act(() => {
      done = result.current.reload()
    })
    expect(result.current).toMatchObject({ data: 'first', loading: true })
    await act(async () => {
      gate.resolve('second')
      await done
    })
    expect(result.current).toMatchObject({ data: 'second', loading: false, error: null })
  })

  it('keeps the data when a reload fails, and clears the error when the next one works', async () => {
    const answers: (() => Promise<string>)[] = [async () => 'first', () => Promise.reject(new Error('down')), async () => 'third']
    const { result } = renderHook(() => useApi(() => answers.shift()!(), []))
    await waitFor(() => expect(result.current.data).toBe('first'))

    await act(() => result.current.reload())
    expect(result.current).toMatchObject({ data: 'first', error: 'down', loading: false })

    await act(() => result.current.reload())
    expect(result.current).toMatchObject({ data: 'third', error: null, loading: false })
  })

  it('ignores an answer that arrives after a newer request', async () => {
    const slow = deferred<string>()
    const fast = deferred<string>()
    const { result, rerender } = renderHook(({ id }: { id: string }) => useApi(() => (id === 'slow' ? slow.promise : fast.promise), [id]), {
      initialProps: { id: 'slow' },
    })
    rerender({ id: 'fast' })
    await act(async () => {
      fast.resolve('fast answer')
    })
    expect(result.current).toMatchObject({ data: 'fast answer', loading: false })
    await act(async () => {
      slow.resolve('slow answer')
    })
    expect(result.current).toMatchObject({ data: 'fast answer', loading: false })
  })

  it('ignores a failure that arrives after a newer request', async () => {
    const slow = deferred<string>()
    const { result, rerender } = renderHook(({ id }: { id: string }) => useApi(() => (id === 'slow' ? slow.promise : Promise.resolve('fast answer')), [id]), {
      initialProps: { id: 'slow' },
    })
    rerender({ id: 'fast' })
    await waitFor(() => expect(result.current.data).toBe('fast answer'))
    await act(async () => {
      slow.reject(new Error('too late'))
    })
    expect(result.current).toMatchObject({ data: 'fast answer', error: null, loading: false })
  })

  it('always calls the latest function', async () => {
    const { result, rerender } = renderHook(({ n }: { n: number }) => useApi(async () => n, []), { initialProps: { n: 1 } })
    await waitFor(() => expect(result.current.data).toBe(1))
    rerender({ n: 2 })
    await act(() => result.current.reload())
    expect(result.current.data).toBe(2)
  })

  it('setData replaces the data locally without a request', async () => {
    const fn = vi.fn(async () => ['a'])
    const { result } = renderHook(() => useApi(fn, []))
    await waitFor(() => expect(result.current.data).toEqual(['a']))
    act(() => result.current.setData(['a', 'b']))
    expect(result.current.data).toEqual(['a', 'b'])
    act(() => result.current.setData(undefined))
    expect(result.current.data).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reload keeps its identity between renders', async () => {
    const { result, rerender } = renderHook(() => useApi(async () => 1, []))
    const first = result.current.reload
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender()
    expect(result.current.reload).toBe(first)
  })
})
