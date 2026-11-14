import { useSyncExternalStore } from 'react'
import { call, client, type Schemas } from '../../api/client'
import { bindingOf, factState, heldByPin, type Fact, type FactState } from '../../lib/facts'

export type Member = Schemas['Member']
export type ActKind = 'retire' | 'restore' | 'correct' | 'pin' | 'unpin'

/** All facts of a scope, paging through GET /facts (limit 500 max). */
export async function fetchAllFacts(pid: string | undefined): Promise<Fact[]> {
  const out: Fact[] = []
  let offset = 0
  for (;;) {
    const page = await call(client.GET('/facts', { params: { query: { project_id: pid, limit: 500, offset } } }))
    out.push(...page.items)
    offset += page.items.length
    if (!page.items.length || offset >= page.total) break
  }
  return out
}

/** Display state of every fact, computed per topic (one binding fact per topic). */
export function statesOf(facts: Fact[]): Map<string, FactState> {
  const byTopic = new Map<string, Fact[]>()
  for (const f of facts) {
    const l = byTopic.get(f.topic)
    if (l) l.push(f)
    else byTopic.set(f.topic, [f])
  }
  const out = new Map<string, FactState>()
  for (const list of byTopic.values()) {
    const b = bindingOf(list)
    const held = heldByPin(list, b)
    for (const f of list) out.set(f.id, factState(f, b, held))
  }
  return out
}

let membersP: Promise<Member[]> | null = null
/** Organisation members (cached) to show names in history. */
export function members(): Promise<Member[]> {
  if (!membersP)
    membersP = call(client.GET('/org/members')).then(
      (r) => (r as { items: Member[] }).items ?? [],
      () => {
        membersP = null
        return []
      },
    )
  return membersP
}

/** Runs one drawer action against the API. */
export async function runAction(kind: ActKind, id: string, actor: string, reason: string, value?: string): Promise<Fact> {
  const path = { fact_id: id }
  switch (kind) {
    case 'retire':
      return call(client.POST('/facts/{fact_id}/retire', { params: { path }, body: { actor, reason } }))
    case 'restore':
      return call(client.POST('/facts/{fact_id}/restore', { params: { path }, body: reason ? { actor, reason } : { actor } }))
    case 'pin':
      return call(client.POST('/facts/{fact_id}/pin', { params: { path }, body: { actor, reason } }))
    case 'unpin':
      return call(client.POST('/facts/{fact_id}/unpin', { params: { path }, body: { actor, reason } }))
    case 'correct':
      return call(client.PATCH('/facts/{fact_id}', { params: { path }, body: { actor, reason, value } }))
  }
}

/** Id of the latest audit event of a fact (for the Undo button in the toast). */
export async function latestEvent(factId: string): Promise<string | null> {
  try {
    const r = await call(client.GET('/audit', { params: { query: { fact_id: factId, limit: 1 } } }))
    const items = Array.isArray(r) ? r : ((r as { items?: Schemas['AuditEvent'][] }).items ?? [])
    return items[0]?.id ?? null
  } catch {
    return null
  }
}

export function undoEvent(eventId: string, actor: string, reason: string) {
  return call(client.POST('/audit/{event_id}/undo', { params: { path: { event_id: eventId } }, body: { actor, reason } }))
}

/** Downloads GET /export as a JSON file. */
export async function downloadExport(): Promise<number> {
  const data = await call(client.GET('/export'))
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `canonico-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return data.facts?.length ?? 0
}

/* ---------- memory filters, shared by the screen, the drawer and the palette ---------- */
export type MemFilters = { q: string; type: string; status: string; topic: string; tag: string }
export const NO_FILTERS: MemFilters = { q: '', type: 'all', status: 'all', topic: 'all', tag: 'all' }
let filters: MemFilters = NO_FILTERS
const subs = new Set<() => void>()
export function setFilters(f: Partial<MemFilters> | ((f: MemFilters) => MemFilters)) {
  filters = typeof f === 'function' ? f(filters) : { ...filters, ...f }
  subs.forEach((s) => s())
}
export function useFilters(): MemFilters {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => filters,
  )
}
