/** Builders for the API objects of the home screens (dashboard, project overview, sources). */
import type { Schemas } from '../../src/api/client'

export function item(over: Partial<Schemas['Item']> = {}): Schemas['Item'] {
  return {
    id: 'I-1',
    project_id: 'proj-clearpath',
    type: 'meeting',
    title: 'Steering committee',
    date: '2025-11-12',
    tags: [],
    participants: [],
    source_id: null,
    document_id: 'doc-steering',
    facts_count: 2,
    received_at: '2026-11-10T10:30:00Z',
    routed_by: 'project_id',
    ...over,
  }
}

export function syncJob(over: Partial<Schemas['SyncJob']> = {}): Schemas['SyncJob'] {
  return { id: 'job-1', source_id: 'src-clearpath-docs', status: 'done', items_added: 3, facts_created: 7, ...over }
}

export function mailConfig(over: Partial<Schemas['MailConfig']> = {}): Schemas['MailConfig'] {
  return { mode: 'imap_mock', imap_host: 'imap.meridianlabs.org', imap_user: 'brain', inbound_address: 'brain@inbound.meridianlabs.org', poll_interval_s: 30, ...over }
}

/** `GET /projects/{id}/mail`: inherited from the organisation unless `overridden`. */
export function projectMail(over: Partial<Schemas['ProjectMail']> = {}): Schemas['ProjectMail'] {
  return { project_id: 'proj-clearpath', overridden: false, effective_mail_config: mailConfig(), mail_config_override: null, ...over }
}

export function mailRule(over: Partial<Schemas['MailRule']> = {}): Schemas['MailRule'] {
  return { id: 'rule-1', match_type: 'sender_domain', value: '@clearpath.com', project_id: 'proj-clearpath', priority: 10, ...over }
}

export function projectMember(over: Partial<Schemas['ProjectMember']> = {}): Schemas['ProjectMember'] {
  return { member_id: 'mem-giulia', project_id: 'proj-clearpath', role: 'owner', inherited: true, ...over }
}

export function message(over: Partial<Schemas['ReceivedMessage']> = {}): Schemas['ReceivedMessage'] {
  return {
    message_id: '<msg-1@clearpath.com>',
    project_id: 'proj-clearpath',
    from: 'anna@clearpath.com',
    subject: 'Audit turnaround',
    date: '2026-11-10T08:15:00Z',
    rule_id: 'rule-1',
    document_id: 'doc-email-1',
    ...over,
  }
}

export function doc(over: Partial<Schemas['Document']> = {}): Schemas['Document'] {
  return { id: 'doc-1', title: 'Project brief', date: '2025-08-22', path: '01-scope/project-brief.md', version: 1, ...over }
}
