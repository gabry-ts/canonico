import { useEffect, useState } from 'react'
import { call, client, errMsg, type Schemas } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useApp } from '../../lib/store'
import { useI18n } from '../../i18n'
import type { Fact } from '../../lib/facts'
import { toast, toastError } from '../../ui/toast'

export type AuditEvent = Schemas['AuditEvent']

export function useTopicNames() {
  const { pid, version } = useApp()
  const { data } = useApi(() => call(client.GET('/topics', { params: { query: { project_id: pid } } })), [pid, version])
  return (id: string) => data?.find((x) => x.id === id)?.label || id.replace(/-/g, ' ')
}

/** Member id -> display name. */
export function useMembers() {
  const { data } = useApi(() => call(client.GET('/org/members', {})), [])
  const items = ((data as { items?: { id: string; name: string }[] } | undefined)?.items ?? []) as { id: string; name: string }[]
  return (id: string) => (id === 'system' ? null : (items.find((m) => m.id === id)?.name ?? id))
}

const factCache = new Map<string, Promise<Fact>>()
/** Lazy single-fact lookup (cached per data version). */
export function useFact(id: string | null | undefined) {
  const { version } = useApp()
  const [fact, setFact] = useState<Fact | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    const key = version + ':' + id
    let p = factCache.get(key)
    if (!p) {
      p = call(client.GET('/facts/{fact_id}', { params: { path: { fact_id: id } } })) as Promise<Fact>
      factCache.set(key, p)
    }
    p.then((f) => live && setFact(f)).catch(() => factCache.delete(key))
    return () => {
      live = false
    }
  }, [id, version])
  return fact
}

export function useAuditActions() {
  const { pid, actor, refresh } = useApp()
  const { t } = useI18n()
  const list = async (): Promise<AuditEvent[]> => call(client.GET('/audit', { params: { query: { project_id: pid, limit: 200 } } }))
  const undoIds = async (ids: string[]) => {
    for (const id of ids) {
      await call(client.POST('/audit/{event_id}/undo', { params: { path: { event_id: id } }, body: { actor, reason: t('review.undoReason') } }))
    }
    await refresh()
  }
  const undoWithToast = async (ids: string[]) => {
    try {
      await undoIds(ids)
      toast(t('review.undone'), { icon: 'undo' })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    }
  }
  /** Run a write and collect the audit events it created (ids not seen before). */
  const withEvents = async (write: () => Promise<unknown>, actions: string[]): Promise<string[]> => {
    let before = new Set<string>()
    try {
      before = new Set((await list()).map((e) => e.id))
    } catch {
      /* ignore */
    }
    await write()
    try {
      return (await list()).filter((e) => !before.has(e.id) && actions.includes(e.action)).map((e) => e.id)
    } catch {
      return []
    }
  }
  return { list, undoIds, undoWithToast, withEvents }
}
