/** Builders for API objects. Each takes the fields a test cares about and fills the rest with sample data. */
import type { Schemas } from '../../src/api/client'

type Role = Schemas['Role']

export const PERMISSIONS: Record<Role, Schemas['Permission'][]> = {
  viewer: ['ask', 'read_facts'],
  editor: ['ask', 'read_facts', 'retire_fact', 'restore_fact', 'correct_fact', 'resolve_conflict'],
  admin: ['ask', 'read_facts', 'retire_fact', 'restore_fact', 'correct_fact', 'resolve_conflict', 'manage_sources', 'manage_mail', 'manage_members'],
  owner: [
    'ask',
    'read_facts',
    'retire_fact',
    'restore_fact',
    'correct_fact',
    'resolve_conflict',
    'manage_sources',
    'manage_mail',
    'manage_members',
    'admin_demo',
  ],
}

export function member(over: Partial<Schemas['Member']> = {}): Schemas['Member'] {
  return {
    id: 'mem-giulia',
    name: 'Giulia Ferri',
    email: 'giulia@meridianlabs.org',
    org_role: 'owner',
    created_at: '2026-11-01T09:00:00Z',
    status: 'active',
    ...over,
  }
}

/** The members of the sample organisation, one per role. */
export const MEMBERS = {
  giulia: member(),
  marco: member({ id: 'mem-marco', name: 'Marco Fiore', email: 'marco@meridianlabs.org', org_role: 'admin' }),
  sara: member({ id: 'mem-sara', name: 'Sara Conti', email: 'sara@meridianlabs.org', org_role: 'editor' }),
  luca: member({ id: 'mem-luca', name: 'Luca Neri', email: 'luca@meridianlabs.org', org_role: 'viewer' }),
}

/** `GET /me` for a member: role and permissions follow `org_role` unless given. */
export function me(over: Partial<Schemas['Me']> & { as?: Schemas['Member'] } = {}): Schemas['Me'] {
  const { as, ...rest } = over
  const m = as ?? rest.member ?? MEMBERS.giulia
  const role = rest.role ?? m.org_role
  return { member: m, role, permissions: PERMISSIONS[role], name: m.name.split(' ')[0], title: 'Engagement lead', ...rest }
}

export function org(over: Partial<Schemas['Organisation']> = {}): Schemas['Organisation'] {
  return { id: 'org-meridian', name: 'Meridian Labs', mail_config: null, ...over }
}

export function project(over: Partial<Schemas['Project']> = {}): Schemas['Project'] {
  return { id: 'proj-clearpath', name: 'ClearPath engagement', description: 'Consulting engagement for ClearPath.', created_at: '2026-11-14T09:00:00Z', ...over }
}

export const PROJECTS = [project(), project({ id: 'proj-internal', name: 'Internal', description: 'Internal documents.' })]

export function source(over: Partial<Schemas['Source']> = {}): Schemas['Source'] {
  return {
    id: 'src-clearpath-docs',
    project_id: 'proj-clearpath',
    type: 'documents',
    label: 'ClearPath documents',
    status: 'ok',
    last_synced_at: '2026-11-14T09:12:00Z',
    items: 46,
    config: {},
    ...over,
  }
}

export function stats(over: Partial<Schemas['Stats']> = {}): Schemas['Stats'] {
  return {
    documents: 46,
    topics: 12,
    facts_total: 1234,
    by_type: { DECISION: 10, EVIDENCE: 20 },
    by_status: { active: 28, retired: 2 },
    open_conflicts: 2,
    open_questions: 3,
    maintenance_pending: 4,
    cost: { spent_usd: 0.42, cap_usd: 5 },
    last_ingest_at: '2026-11-14T09:12:00Z',
    ...over,
  }
}

export function fact(over: Partial<Schemas['Fact']> = {}): Schemas['Fact'] {
  return {
    id: 'M-106',
    topic: 'onboarding-target',
    value: '3–4 weeks',
    type: 'DECISION',
    status: 'active',
    doc_id: '07-documents/report-final',
    quote: 'New consultants should reach autonomy in three to four weeks.',
    date: '2025-11-28',
    supersedes: null,
    superseded_by: null,
    confidence: 0.92,
    retired_reason: null,
    pinned: false,
    tags: [],
    ...over,
  }
}

export function auditEvent(over: Partial<Schemas['AuditEvent']> = {}): Schemas['AuditEvent'] {
  return {
    id: 'A-1',
    at: '2026-11-14T10:00:00Z',
    actor: 'mem-giulia',
    actor_role: 'owner',
    action: 'retire',
    fact_id: 'M-105',
    reason: 'Out of date',
    ...over,
  }
}

export function conflict(over: Partial<Schemas['Conflict']> = {}): Schemas['Conflict'] {
  return {
    id: 'C-1',
    topic: 'audit-turnaround',
    status: 'open',
    summary: 'Two active facts give a different turnaround.',
    facts: [
      fact({ id: 'M-201', topic: 'audit-turnaround', value: '3–4 business days', doc_id: '05-meetings/meeting-005-final-presentation', date: '2025-11-20' }),
      fact({ id: 'M-202', topic: 'audit-turnaround', value: '5 business days', doc_id: '04-external-comms/email/email-external-012', date: '2025-10-02' }),
    ],
    detected_at: '2026-11-14T09:30:00Z',
    resolution: null,
    ...over,
  }
}

export function openQuestion(over: Partial<Schemas['OpenQuestion']> = {}): Schemas['OpenQuestion'] {
  return {
    id: 'Q-1',
    topic: 'pilot-size',
    question: 'How many consultants join the pilot?',
    fact_id: 'M-301',
    doc_id: '05-meetings/meeting-001-kickoff',
    status: 'open',
    opened_at: '2025-09-12',
    closed_at: null,
    answer_fact_id: null,
    note: null,
    ...over,
  }
}

export function maintenanceItem(over: Partial<Schemas['MaintenanceItem']> = {}): Schemas['MaintenanceItem'] {
  return {
    id: 'MQ-1',
    fact: fact({ id: 'M-101', value: '≈6 weeks', type: 'SUPERSEDED', doc_id: '01-scope/project-brief', date: '2025-08-22' }),
    reason: 'superseded_still_retrievable',
    detail: 'A newer fact replaced this one but it can still be retrieved.',
    proposed_action: 'retire',
    status: 'pending',
    proposed_at: '2026-11-14T09:40:00Z',
    ...over,
  }
}

export function topic(over: Partial<Schemas['Topic']> = {}): Schemas['Topic'] {
  return { id: 'onboarding-target', label: 'Onboarding target', fact_ids: ['M-106'], ...over }
}

/** `POST /auth/login` answer. The session lasts an hour unless `expires_at` says otherwise. */
export function login(over: Partial<Schemas['LoginResponse']> = {}): Schemas['LoginResponse'] {
  return { member: MEMBERS.giulia, token: 'tok-giulia', expires_at: new Date(Date.now() + 3600_000).toISOString(), ...over }
}
