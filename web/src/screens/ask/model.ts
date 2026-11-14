import type { Schemas } from '../../api/client'
import { bindingOf, docLabel, type Fact } from '../../lib/facts'

export type Chain = Schemas['TopicChain']
export type ChainFact = Chain['facts'][number]
export type AskResponse = Schemas['AskResponse']

/** Demo script constants: which topic the video flow is about and which library document gets a new version. */
export const DEMO = {
  topic: 'onboarding-target',
  /** The out-of-date figure the company assistant returned "last Monday". */
  oldFact: 'M-105',
  libraryDoc: 'library/onboarding-standard',
  versionText: 'Onboarding target: 5 weeks to autonomy.',
}

/**
 * Label of a fact's source document, in the source language. Corpus documents get the short slug label
 * ("final report"); mail, library and upload documents use their title when the chain provides one.
 */
export function sourceLabel(f: Fact | ChainFact, titles?: Record<string, string>): string {
  const title = ('doc_title' in f && f.doc_title) || titles?.[f.doc_id]
  if (/^(mail|library|uploads?)\//.test(f.doc_id) && title) return title.replace(/^Email:\s*/i, 'email · ')
  return docLabel(f.doc_id)
}

export type TopicView = {
  binding: ChainFact | null
  /** Older versions the binding fact replaced. */
  replaced: ChainFact[]
  /** Replaced by a newer fact but never retired: plain retrieval still returns them. */
  stillActive: ChainFact[]
  retired: ChainFact[]
}

/** Splits a topic chain into the binding fact, the versions it replaced, and old facts that are still active. */
export function viewOf(chain: Chain | undefined, bindingId?: string | null): TopicView {
  const facts = chain?.facts ?? []
  const binding = (bindingId ? facts.find((f) => f.id === bindingId && f.status === 'active') : null) ?? (bindingOf(facts) as ChainFact | null)
  const others = facts.filter((f) => f.id !== binding?.id)
  return {
    binding,
    replaced: others.filter((f) => f.status === 'active' && f.type === 'SUPERSEDED'),
    stillActive: others.filter((f) => f.status === 'active' && !!f.superseded_by && (f.type === 'DECISION' || f.type === 'CONSTRAINT')),
    retired: others.filter((f) => f.status === 'retired'),
  }
}

/** "3–4 business days (Marco Fiore, audit team lead)" -> ["3–4 business days", "Marco Fiore, audit team lead"]. */
export function splitValue(value: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(value)
  return m ? [m[1], m[2]] : [value, null]
}

/** en-GB abbreviates September as "Sept"; the validated prototype and the video use "Sep". */
export const sep = (date: string) => date.replace(/\bSept\b/, 'Sep')
