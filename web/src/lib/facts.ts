import type { Schemas } from '../api/client'

export type Fact = Schemas['Fact']

/** Last path segment of a document id: "07-documents/report-final" -> "report-final". */
export const shortDoc = (docId: string) => docId.split('/').pop() || docId

/**
 * Human label of a source document, in the source language (never translated):
 * "07-documents/report-final" -> "final report", "05-meetings/meeting-005-final-presentation" -> "final presentation".
 */
export function docLabel(docId: string): string {
  let s = shortDoc(docId)
  s = s.replace(/^(meeting|observation|email-external|email-internal|email)-\d+(-v\d+)?-?/, (m) => (m.startsWith('email') ? 'email ' + m.replace(/\D/g, '') : ''))
  const report = /^report-(.+)$/.exec(s)
  if (report) s = `${report[1]} report`
  return s.replace(/[-_]+/g, ' ').trim() || shortDoc(docId)
}

/**
 * The one binding fact of a topic: the pinned active fact if any, otherwise the latest-dated active fact
 * that is not marked superseded. Retired facts are never binding.
 */
export function bindingOf(facts: Fact[]): Fact | null {
  const active = facts.filter((f) => f.status === 'active')
  const pinned = active.filter((f) => f.pinned).sort((a, b) => b.date.localeCompare(a.date))
  if (pinned.length) return pinned[0]
  const cands = active.filter((f) => f.type !== 'SUPERSEDED' && f.type !== 'OPEN')
  return cands.reduce<Fact | null>((best, f) => (!best || f.date >= best.date ? f : best), null)
}

/** Active facts newer than a pinned binding fact: shown as "Newer · held by pin". */
export function heldByPin(facts: Fact[], binding: Fact | null): Fact[] {
  if (!binding || !binding.pinned) return []
  return facts.filter((f) => f.id !== binding.id && f.status === 'active' && f.type !== 'SUPERSEDED' && f.type !== 'OPEN' && f.date > binding.date)
}

export type FactState = {
  key: 'binding' | 'held' | 'conflict' | 'superseded' | 'retired' | 'open' | 'active'
  /** Badge class from the stylesheet. */
  cls: 'binding' | 'held' | 'conflict' | 'superseded' | 'retired' | 'open' | 'ok'
  /** i18n key of the badge label (namespace "fact"). */
  label: string
  dim: boolean
}

/**
 * Display state of a fact. `binding` is the binding fact of its topic (see bindingOf) when known.
 * An active DECISION/CONSTRAINT that a newer fact replaced but nobody retired is "still active" (conflict).
 */
export function factState(f: Fact, binding?: Fact | null, held: Fact[] = []): FactState {
  if (f.status === 'retired') return { key: 'retired', cls: 'retired', label: 'fact.status.retired', dim: true }
  if (binding && f.id === binding.id) return { key: 'binding', cls: 'binding', label: 'fact.status.binding', dim: false }
  if (held.some((h) => h.id === f.id)) return { key: 'held', cls: 'held', label: 'fact.status.held', dim: false }
  if (f.type === 'SUPERSEDED') return { key: 'superseded', cls: 'superseded', label: 'fact.status.superseded', dim: true }
  if (f.type === 'OPEN') return { key: 'open', cls: 'open', label: 'fact.status.open', dim: false }
  if (f.superseded_by && (f.type === 'DECISION' || f.type === 'CONSTRAINT'))
    return { key: 'conflict', cls: 'conflict', label: 'fact.status.stillActive', dim: false }
  if (f.superseded_by) return { key: 'superseded', cls: 'superseded', label: 'fact.status.superseded', dim: true }
  return { key: 'active', cls: 'ok', label: 'fact.status.active', dim: false }
}

/** First sentence of a generated answer: "Three to four weeks. That is…" -> "Three to four weeks." */
export function headline(answer: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(answer.trim())
  return m ? m[1] : answer.trim()
}
