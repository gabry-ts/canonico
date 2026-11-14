/** Builders for the Ask screen: topic chains and answers of `POST /ask`, with the two topics of the demo. */
import type { Schemas } from '../../src/api/client'
import { fact, topic } from './fixtures'

export type Chain = Schemas['TopicChain']
export type ChainFact = Chain['facts'][number]
export type AskResponse = Schemas['AskResponse']

/** The question of the demo and the contested one, as the composer shows them. */
export const QUESTION = 'How long does onboarding take?'
export const QUESTION_2 = 'Why do the team leads disagree about how long a report spends in the audit queue, and was the discrepancy ever resolved with hard data?'

export const chainFact = (over: Partial<ChainFact> = {}): ChainFact => ({ ...fact(), ...over })

/**
 * The onboarding topic at the start of the demo, oldest first: two superseded versions, the verbal preview
 * that a newer fact replaced but nobody retired (M-105), and the binding figure of the final report (M-106).
 */
export const ONBOARDING = {
  brief: chainFact({ id: 'M-101', value: '≈6 weeks', type: 'SUPERSEDED', doc_id: '01-scope/project-brief', date: '2025-08-22', quote: 'Roughly six weeks.', superseded_by: 'M-103' }),
  kickoff: chainFact({ id: 'M-103', value: '5 weeks', type: 'SUPERSEDED', doc_id: '05-meetings/meeting-001-kickoff', date: '2025-09-12', quote: 'Let us aim for five weeks.', supersedes: 'M-101', superseded_by: 'M-105' }),
  preview: chainFact({
    id: 'M-105',
    value: '4 weeks',
    type: 'DECISION',
    doc_id: '05-meetings/meeting-005-final-presentation',
    date: '2025-11-20',
    quote: 'Onboarding will take four weeks.',
    supersedes: 'M-103',
    superseded_by: 'M-106',
  }),
  report: chainFact({ id: 'M-106', value: '3–4 weeks', type: 'DECISION', doc_id: '07-documents/report-final', date: '2025-11-28', supersedes: 'M-105' }),
}

/** M-105 after someone retired it. */
export const retiredPreview = (over: Partial<ChainFact> = {}): ChainFact => ({
  ...ONBOARDING.preview,
  status: 'retired',
  retired_by: 'Giulia',
  retired_at: new Date().toISOString(),
  retired_reason: 'The final report sets 3–4 weeks.',
  ...over,
})

/** A topic chain. Without arguments, the onboarding topic at the start of the demo. */
export function chain(over: Partial<Chain> = {}): Chain {
  const facts = over.facts ?? [ONBOARDING.brief, ONBOARDING.kickoff, ONBOARDING.preview, ONBOARDING.report]
  return { topic: topic({ id: 'onboarding-target', label: 'Onboarding target', fact_ids: facts.map((f) => f.id) }), changes: 3, ...over, facts }
}

const audit = (over: Partial<ChainFact>) => chainFact({ topic: 'audit-turnaround', type: 'EVIDENCE', ...over })

/** The audit topic: three estimates that disagree, an open question, one more active fact and a retired one. */
export const AUDIT = {
  marco: audit({ id: 'M-201', value: '3–4 business days (Marco Fiore, audit team lead)', doc_id: '05-meetings/meeting-003-audit-review', date: '2025-10-02', quote: 'We turn a report around in three to four days.' }),
  sara: audit({ id: 'M-202', value: '5–7 business days (Sara Conti, delivery lead)', doc_id: '04-external-comms/email/email-external-012', date: '2025-10-09', quote: 'From my side it is closer to a week.' }),
  sample: audit({ id: 'M-203', value: '2 business days', doc_id: '03-observations/observation-004-queue-sample', date: '2025-10-16', quote: 'The sampled reports left the queue in two days.' }),
  open: audit({ id: 'M-204', value: 'Was the queue time ever measured?', type: 'OPEN', doc_id: '05-meetings/meeting-004-steering', date: '2025-10-20' }),
  other: audit({ id: 'M-205', value: 'The queue is reviewed every Friday', type: 'CONSTRAINT', doc_id: '02-process/audit-policy', date: '2025-09-01' }),
  gone: audit({ id: 'M-206', value: '10 business days', status: 'retired', doc_id: '01-scope/project-brief', date: '2025-08-22', retired_by: 'Sara', retired_at: '2026-11-03T10:00:00Z' }),
}

export function auditChain(over: Partial<Chain> = {}): Chain {
  const facts = over.facts ?? Object.values(AUDIT)
  return { topic: topic({ id: 'audit-turnaround', label: 'Audit turnaround', fact_ids: facts.map((f) => f.id) }), changes: 2, ...over, facts }
}

/** `POST /ask` answer. Without arguments, the binding answer to the demo question. */
export function askResponse(over: Partial<AskResponse> = {}): AskResponse {
  return {
    question: QUESTION,
    status: 'binding',
    answer: 'Three to four weeks. That is the figure the final report sets.',
    binding: ONBOARDING.report,
    superseded: [ONBOARDING.kickoff],
    conflicts: [],
    citations: [{ doc_id: ONBOARDING.report.doc_id, quote: ONBOARDING.report.quote }],
    plain_retrieval: { doc_id: ONBOARDING.preview.doc_id, quote: ONBOARDING.preview.quote, rank: 1 },
    changed_because: null,
    answer_id: 'ans-0001',
    ...over,
  }
}

/** The answer to a question nobody settled: no binding fact, the competing estimates in `conflicts`. */
export function contestedResponse(over: Partial<AskResponse> = {}): AskResponse {
  return askResponse({
    question: QUESTION_2,
    status: 'contested',
    answer: 'The team leads give three different estimates and nobody measured the queue.',
    binding: null,
    superseded: [],
    conflicts: [AUDIT.marco, AUDIT.sara, AUDIT.sample],
    citations: [],
    plain_retrieval: { doc_id: AUDIT.sara.doc_id, quote: AUDIT.sara.quote, rank: 1 },
    ...over,
  })
}

export function noAnswerResponse(over: Partial<AskResponse> = {}): AskResponse {
  return askResponse({ status: 'no_answer', answer: 'No document in this project talks about that.', binding: null, superseded: [], citations: [], plain_retrieval: undefined, ...over })
}
