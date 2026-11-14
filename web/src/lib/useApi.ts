import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { errMsg } from '../api/client'

export type ApiState<T> = {
  data: T | undefined
  error: string | null
  loading: boolean
  /** Refetch, keeping the current data on screen while loading. */
  reload: () => Promise<void>
  /** Replace the data locally (optimistic update). */
  setData: (d: T | undefined) => void
}

/**
 * Loads data with `fn` and reloads when `deps` change.
 * `fn` returns a promise of the data (use `call(client.GET(...))`). Pass `null` to skip.
 */
export function useApi<T>(fn: (() => Promise<T>) | null, deps: DependencyList): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(fn !== null)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    const f = fnRef.current
    if (!f) return
    const mine = ++seq.current
    setLoading(true)
    try {
      const d = await f()
      if (mine === seq.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (mine === seq.current) setError(errMsg(e))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}
