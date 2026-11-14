/** Builders and default routes for the organisation settings and the demo control screen. */
import type { Schemas } from '../../src/api/client'
import { api } from './api'
import { auditEvent, me as meOf, MEMBERS, PERMISSIONS, source, stats as statsOf } from './fixtures'

export function mailConfig(over: Partial<Schemas['MailConfig']> = {}): Schemas['MailConfig'] {
  return {
    mode: 'imap_mock',
    imap_host: 'imap.meridianlabs.org',
    imap_user: 'canonico@meridianlabs.org',
    inbound_address: 'brain@meridianlabs.org',
    poll_interval_s: 60,
    ...over,
  }
}

export function projectMail(over: Partial<Schemas['ProjectMail']> = {}): Schemas['ProjectMail'] {
  return { project_id: 'proj-clearpath', overridden: false, effective_mail_config: mailConfig(), mail_config_override: null, ...over }
}

export function hookConfig(over: Partial<Schemas['OrgHookConfig']> = {}): Schemas['OrgHookConfig'] {
  return { url: 'http://api.test/hooks/org/org-meridian', secret_last4: 'a1b2', created_at: '2026-11-03T09:00:00Z', ...over }
}

export function tagRule(over: Partial<Schemas['TagRule']> = {}): Schemas['TagRule'] {
  return { id: 'TR-1', tag: 'clearpath', project_id: 'proj-clearpath', priority: 10, ...over }
}

export function projectMember(over: Partial<Schemas['ProjectMember']> = {}): Schemas['ProjectMember'] {
  return { member_id: 'mem-sara', project_id: 'proj-clearpath', role: 'editor', inherited: true, ...over }
}

/** `GET /roles`, in the order the backend gives them: most powerful first. */
export const ROLES: Schemas['RolePermissions'][] = (['owner', 'admin', 'editor', 'viewer'] as const).map((role) => ({ role, permissions: PERMISSIONS[role] }))

export function config(over: Partial<Schemas['Config']> = {}): Schemas['Config'] {
  return {
    models: { extraction: 'claude-haiku', classification: 'claude-haiku', answer: 'claude-sonnet' },
    cost_cap_usd: 5,
    active_corpus: 'clearpath',
    stale_after_days: 180,
    low_confidence_threshold: 0.6,
    offline_mode: false,
    provider: 'anthropic',
    ...over,
  }
}

export function syncJob(over: Partial<Schemas['SyncJob']> = {}): Schemas['SyncJob'] {
  return { id: 'J-1', source_id: 'src-gh', status: 'queued', ...over }
}

export function inboundResult(over: Partial<Schemas['InboundEmailResult']> = {}): Schemas['InboundEmailResult'] {
  return {
    message_id: '<demo-1@meridianlabs.org>',
    routed_project_id: 'proj-clearpath',
    rule_id: 'MR-1',
    document_id: '04-external-comms/email/demo-1',
    facts_created: ['M-400'],
    supersedes_created: [{ fact_id: 'M-400', supersedes: 'M-106' }],
    audit_event_id: 'A-9',
    ...over,
  }
}

export function docVersion(over: Partial<Schemas['DocumentVersion']> = {}): Schemas['DocumentVersion'] {
  return { document_id: 'library/onboarding-standard', version: 1, version_label: 'v1', uploaded_at: '2026-11-10T08:00:00Z', supersedes_document_id: null, facts_superseded: [], ...over }
}

export function searchResult(over: Partial<Schemas['SearchResult']> = {}): Schemas['SearchResult'] {
  return { kind: 'fact', id: 'M-106', score: 0.9, snippet: 'Onboarding target is 3–4 weeks.', doc_id: '07-documents/report-final', topic: 'onboarding-target', type: 'DECISION', ...over }
}

export function githubPreview(over: Partial<Schemas['GithubPreview']> = {}): Schemas['GithubPreview'] {
  return {
    repo_url: 'https://github.com/gabry-ts/canonico',
    full_name: 'gabry-ts/canonico',
    public: true,
    description: null,
    default_branch: 'main',
    open_issues: 7,
    has_readme: true,
    last_pushed_at: '2026-11-13T18:00:00Z',
    ...over,
  }
}

/** What the Organisation tab of the settings reads: mail of the organisation and of each project, the webhook, the tag rules. */
export function mockOrgTab(over: { mail?: Schemas['MailConfig']; overridden?: string[]; hook?: Schemas['OrgHookConfig']; rules?: Schemas['TagRule'][] } = {}) {
  api.get('/org/mail', over.mail ?? mailConfig())
  api.get('/projects/:project_id/mail', (req) => projectMail({ project_id: req.params.project_id, overridden: (over.overridden ?? []).includes(req.params.project_id) }))
  api.get('/org/hooks', over.hook ?? hookConfig())
  api.get('/org/tag-rules', { items: over.rules ?? [] })
}

/** What the Members tab reads: the members and their role in each project (inherited unless given). */
export function mockMembersTab(over: { members?: Schemas['Member'][]; projectRoles?: Schemas['ProjectMember'][] } = {}) {
  const members = over.members ?? Object.values(MEMBERS)
  api.get('/org/members', { items: members, total: members.length })
  api.get('/projects/:project_id/members', (req) =>
    members.map(
      (m) =>
        (over.projectRoles ?? []).find((r) => r.member_id === m.id && r.project_id === req.params.project_id) ??
        projectMember({ member_id: m.id, project_id: req.params.project_id, role: m.org_role, inherited: true }),
    ),
  )
}

/** What the demo control screen reads when the owner opens it. */
export function mockAdmin(
  over: {
    stats?: Schemas['Stats']
    config?: Schemas['Config']
    audit?: Schemas['AuditEvent'][]
    sources?: Record<string, Schemas['Source'][]>
    versions?: Schemas['DocumentVersion'][]
    me?: Schemas['Me']
  } = {},
) {
  api.get('/stats', over.stats ?? statsOf())
  api.get('/config', over.config ?? config())
  api.get('/audit', over.audit ?? [auditEvent()])
  api.get('/projects/:project_id/sources', (req) => ({ items: over.sources?.[req.params.project_id] ?? (over.sources ? [] : [source({ project_id: req.params.project_id, id: 'src-docs-' + req.params.project_id })]) }))
  api.get('/documents/:doc_id/versions', over.versions ?? [])
  api.get('/me', over.me ?? meOf())
}
