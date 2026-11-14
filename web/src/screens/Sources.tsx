import { useState } from 'react'
import { call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { usePerm } from '../lib/perm'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { TopbarActions } from '../shell/Topbar'
import AddSourceDialog from '../ui/AddSourceDialog'
import { Ic } from '../ui/Icon'
import { SRC_ICON } from '../ui/srcIcon'
import { Dialog, Empty } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { CardHead, FieldErr, Loading, PageHead, PageWrap } from './org/ui'

type Source = Schemas['Source']

function SourcesCard({ pid, onAdd }: { pid: string; onAdd: () => void }) {
  const { t, fmtDateTime } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const q = useApi(() => call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: pid } } })), [pid, app.version])
  const list: Source[] = q.data ? (Array.isArray(q.data) ? q.data : ((q.data as { items?: Source[] }).items ?? [])) : []
  const sync = async (id: string) => {
    try {
      await call(client.POST('/sources/{source_id}/sync', { params: { path: { source_id: id } } }))
      toast(t('org.sources.syncStarted'), { icon: 'refresh' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const unit = (s: Source) => (s.type === 'mail' ? 'emails' : s.type === 'document_library' ? 'versions' : s.type === 'github' ? 'issues' : s.type === 'webhook' ? 'items' : 'documents')
  return (
    <div className="card overflow-hidden">
      <CardHead
        title={t('org.sources.connected')}
        right={
          <button className="btn btn-outline btn-sm" {...attrs('manage_sources')} onClick={() => can('manage_sources') && onAdd()}>
            <Ic n="plus" className="sm" />
            {t('org.sources.add')}
          </button>
        }
      />
      {q.loading && !q.data ? (
        <Loading />
      ) : q.error ? (
        <div className="p-5 text-[13.5px]">
          {t('common.loadError', { message: q.error })} <button className="link" onClick={() => void q.reload()}>{t('common.retry')}</button>
        </div>
      ) : !list.length ? (
        <Empty icon="sources" title={t('org.sources.emptyTitle')}>
          {t('org.sources.emptyText')}
        </Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('org.sources.source')}</th>
              <th>{t('org.sources.status')}</th>
              <th className="text-right">{t('org.sources.itemsCol')}</th>
              <th className="hidden md:table-cell">{t('org.sources.lastSync')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                      <Ic n={SRC_ICON[s.type] ?? 'doc'} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium truncate">{s.label}</span>
                      <span className="block text-[12px] text-muted-foreground mono truncate">{s.id}</span>
                    </span>
                  </div>
                </td>
                <td>
                  {s.status === 'error' ? (
                    <span className="inline-flex items-center gap-2 text-[13px] text-destructive">
                      <span className="dot !bg-destructive"></span>
                      {t('org.sources.st_error')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-[13px]">
                      <span className={'dot' + (s.status === 'syncing' ? ' sync' : '')}></span>
                      {t('org.sources.st_' + (s.type === 'webhook' && !s.last_synced_at && s.status !== 'syncing' ? 'waiting' : s.status))}
                    </span>
                  )}
                </td>
                <td className="text-right whitespace-nowrap">
                  <span className="mono">{s.items ?? 0}</span> <span className="text-muted-foreground text-[12.5px]">{t('org.sources.unit_' + unit(s), { count: s.items ?? 0 })}</span>
                </td>
                <td className="mono text-[12.5px] text-muted-foreground whitespace-nowrap hidden md:table-cell">{s.last_synced_at ? fmtDateTime(s.last_synced_at) : t('org.sources.never')}</td>
                <td className="text-right whitespace-nowrap">
                  {s.type !== 'webhook' && (
                    <button className="btn btn-ghost btn-sm" {...attrs('manage_sources')} onClick={() => can('manage_sources') && void sync(s.id)}>
                      <Ic n="refresh" className="sm" />
                      {t('org.sources.sync')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t px-5 py-3 text-[12.5px] text-muted-foreground">{t('org.sources.comingSoon')}</div>
    </div>
  )
}

function OverrideDialog({ pid, base, onClose }: { pid: string; base: Schemas['MailConfig']; onClose: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const [addr, setAddr] = useState(base.inbound_address ?? '')
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr.trim())) return setErr(t('org.mail.invalidEmail'))
    try {
      await call(client.PUT('/projects/{project_id}/mail', { params: { path: { project_id: pid } }, body: { mode: base.mode, imap_host: base.imap_host ?? null, imap_user: base.imap_user ?? null, inbound_address: addr.trim(), poll_interval_s: base.poll_interval_s } }))
      toast(t('org.mail.overrideDone'), { icon: 'check' })
      await app.refresh()
      onClose()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  return (
    <Dialog
      title={t('org.mail.overrideTitle')}
      sub={t('org.mail.overrideSub')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()}>
            {t('org.mail.save')}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="dInb">
        {t('org.mail.inboundAddress')}
      </label>
      <input id="dInb" className={'input mono !text-[13.5px] ' + (err ? 'invalid' : '')} value={addr} onChange={(e) => setAddr(e.target.value)} autoFocus />
      <FieldErr msg={err} />
    </Dialog>
  )
}

function MailCard({ pid }: { pid: string }) {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const [dlg, setDlg] = useState(false)
  const q = useApi(() => call(client.GET('/projects/{project_id}/mail', { params: { path: { project_id: pid } } })), [pid, app.version])
  const m = q.data
  const eff = m?.effective_mail_config
  const revert = async () => {
    try {
      await call(client.DELETE('/projects/{project_id}/mail', { params: { path: { project_id: pid } } }))
      toast(t('org.mail.reverted'), { icon: 'check' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  return (
    <div className="xl:col-span-2 card overflow-hidden">
      <CardHead title={t('org.mail.title')} right={m ? m.overridden ? <span className="badge line">{t('org.mail.overridden')}</span> : <span className="badge">{t('org.mail.inherited')}</span> : undefined} />
      {q.loading && !m ? (
        <Loading />
      ) : q.error || !m || !eff ? (
        <div className="p-5 text-[13.5px]">{t('common.loadError', { message: q.error ?? '' })}</div>
      ) : (
        <div className="p-5">
          <p className="text-[13px] text-muted-foreground leading-relaxed">{m.overridden ? t('org.mail.ownConfig') : t('org.mail.inheritedFrom', { org: app.org?.name ?? '' })}</p>
          <dl className="kv mt-4 !grid-cols-[100px_1fr]">
            <dt>{t('org.mail.mode')}</dt>
            <dd className="text-[12.5px]">{t(eff.mode === 'imap' ? 'org.mail.modeImapReal' : eff.mode === 'webhook' ? 'org.mail.modeWebhook' : 'org.mail.modeImap')}</dd>
            {eff.imap_host && (
              <>
                <dt>{t('org.mail.imapHost')}</dt>
                <dd className="mono text-[12.5px]">{eff.imap_host}</dd>
              </>
            )}
            <dt>{t('org.mail.inbound')}</dt>
            <dd className="mono text-[12.5px] truncate">{eff.inbound_address}</dd>
            <dt>{t('org.mail.setOn')}</dt>
            <dd>{m.overridden ? t('org.mail.thisProject') : app.org?.name}</dd>
          </dl>
          <div className="mt-5 flex gap-2">
            {m.overridden ? (
              <button className="btn btn-outline btn-sm" {...attrs('manage_mail')} onClick={() => can('manage_mail') && void revert()}>
                {t('org.mail.revert')}
              </button>
            ) : (
              <button className="btn btn-outline btn-sm" {...attrs('manage_mail')} onClick={() => can('manage_mail') && setDlg(true)}>
                {t('org.mail.override')}
              </button>
            )}
          </div>
        </div>
      )}
      {dlg && eff && <OverrideDialog pid={pid} base={eff} onClose={() => setDlg(false)} />}
    </div>
  )
}

function RuleDialog({ defaultProject, onClose }: { defaultProject: string; onClose: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const [value, setValue] = useState('')
  const [project, setProject] = useState(defaultProject)
  const [priority, setPriority] = useState('30')
  const [err, setErr] = useState<{ value?: string; priority?: string }>({})
  const submit = async () => {
    const e: typeof err = {}
    if (!/^@?[\w.-]+\.[a-z]{2,}$/i.test(value.trim())) e.value = t('org.rules.domainErr')
    if (!/^\d+$/.test(priority.trim())) e.priority = t('org.rules.priorityErr')
    setErr(e)
    if (e.value || e.priority) return
    const v = value.trim()
    try {
      await call(client.POST('/org/mail/rules', { body: { match_type: 'sender_domain', value: v.startsWith('@') ? v : '@' + v, project_id: project, priority: Number(priority) } }))
      toast(t('org.rules.added'), { icon: 'check' })
      await app.refresh()
      onClose()
    } catch (x) {
      toastError(errMsg(x))
    }
  }
  return (
    <Dialog
      title={t('org.rules.dialogTitle')}
      sub={t('org.rules.dialogSub')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()}>
            {t('org.rules.add')}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="dDom">
        {t('org.rules.domain')}
      </label>
      <input id="dDom" className={'input mono !text-[13.5px] ' + (err.value ? 'invalid' : '')} value={value} placeholder={t('org.rules.domainPh')} onChange={(e) => setValue(e.target.value)} autoFocus />
      <FieldErr msg={err.value} />
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="label" htmlFor="dRP">
            {t('org.rules.project')}
          </label>
          <select id="dRP" className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            {app.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dPr">
            {t('org.rules.priority')}
          </label>
          <input id="dPr" className={'input mono ' + (err.priority ? 'invalid' : '')} value={priority} onChange={(e) => setPriority(e.target.value)} />
          <FieldErr msg={err.priority} />
        </div>
      </div>
    </Dialog>
  )
}

function RulesCard({ pid }: { pid: string }) {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const q = useApi(() => call(client.GET('/org/mail/rules')), [app.version])
  const [dlg, setDlg] = useState(false)
  const [from, setFrom] = useState('client@meridianlabs.org')
  const [res, setRes] = useState<{ ok: boolean; rule?: string | null; project?: string | null } | 'empty' | null>(null)
  const pname = (id: string | null | undefined) => app.projects.find((p) => p.id === id)?.name ?? id ?? ''
  const rules = [...(q.data?.items ?? [])].sort((a, b) => a.priority - b.priority)
  const del = async (id: string) => {
    try {
      await call(client.DELETE('/org/mail/rules/{rule_id}', { params: { path: { rule_id: id } } }))
      toast(t('org.rules.removed'), { icon: 'check' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const test = async () => {
    const f = from.trim()
    if (!f) return setRes('empty')
    const dom = f.split('@')[1] ?? 'example.com'
    try {
      const r = await call(
        client.POST('/org/mail/rules/test', {
          body: { message_id: `<test-${Date.now()}@${dom}>`, from: f, to: ['brain@inbound.' + dom], cc: [], subject: 'Test', date: new Date().toISOString(), text: 'Test', attachments: [] },
        }),
      )
      setRes({ ok: r.matched, rule: r.rule_id, project: r.routed_project_id })
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  return (
    <div className="xl:col-span-3 card overflow-hidden">
      <CardHead
        title={t('org.rules.title')}
        sub={t('org.rules.sub')}
        right={
          <button className="btn btn-outline btn-sm" {...attrs('manage_mail')} onClick={() => can('manage_mail') && setDlg(true)}>
            <Ic n="plus" className="sm" />
            {t('org.rules.add')}
          </button>
        }
      />
      {q.loading && !q.data ? (
        <Loading />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('org.rules.domain')}</th>
              <th>{t('org.rules.project')}</th>
              <th className="text-right">{t('org.rules.priority')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.length ? (
              rules.map((r) => (
                <tr key={r.id}>
                  <td className="mono text-[13px]">{r.value}</td>
                  <td>{pname(r.project_id)}</td>
                  <td className="text-right mono">{r.priority}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-icon btn-sm" {...attrs('manage_mail')} onClick={() => can('manage_mail') && void del(r.id)} aria-label={t('org.rules.remove')}>
                      <Ic n="x" className="sm" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="text-center text-muted-foreground !py-8">
                  {t('org.rules.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <div className="border-t p-5">
        <label className="label" htmlFor="testFrom">
          {t('org.rules.testLabel')}
        </label>
        <div className="flex gap-2">
          <input id="testFrom" className="input" placeholder={t('org.rules.testPh')} value={from} onChange={(e) => setFrom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void test()} />
          <button className="btn btn-outline" onClick={() => void test()}>
            {t('org.rules.test')}
          </button>
        </div>
        {res === null ? (
          <p className="help">{t('org.rules.testHelp')}</p>
        ) : res === 'empty' ? (
          <p className="help">{t('org.rules.testFrom')}</p>
        ) : (
          <div className={'fade-in mt-3 rounded-[10px] px-4 py-3 text-[13.5px] ' + (res.ok ? 'bg-muted/60' : 'bg-warning-soft text-warning-text')}>
            {res.ok ? t('org.rules.testMatch', { rule: res.rule ?? '', project: pname(res.project) }) : t('org.rules.testNone')}
          </div>
        )}
      </div>
      {dlg && <RuleDialog defaultProject={pid} onClose={() => setDlg(false)} />}
    </div>
  )
}

function MessagesCard({ pid }: { pid: string }) {
  const { t, fmtWhen } = useI18n()
  const app = useApp()
  const q = useApi(() => call(client.GET('/projects/{project_id}/messages', { params: { path: { project_id: pid } } })), [pid, app.version])
  const items = q.data?.items ?? []
  return (
    <div className="card overflow-hidden">
      <CardHead title={t('org.messages.title')} />
      {q.loading && !q.data ? (
        <Loading />
      ) : q.error ? (
        <div className="p-5 text-[13.5px]">{t('common.loadError', { message: q.error })}</div>
      ) : items.length ? (
        <ul className="divide-y">
          {items.map((m) => (
            <li key={m.message_id} className="px-5 py-3 flex gap-4">
              <span className="text-muted-foreground mt-0.5">
                <Ic n="mail" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px]">
                  <span className="font-medium">{m.from}</span>
                  <span className="text-muted-foreground truncate">· {m.subject}</span>
                </div>
                {m.rule_id && <div className="text-[12.5px] text-muted-foreground mono truncate">{m.rule_id}</div>}
              </div>
              <span className="mono text-[12px] text-muted-foreground whitespace-nowrap">{fmtWhen(m.date)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="inbox" title={t('org.messages.emptyTitle')}>
          {t('org.messages.emptyText')}
        </Empty>
      )}
    </div>
  )
}

export default function Sources() {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const [add, setAdd] = useState(false)
  const pid = app.projectId
  return (
    <PageWrap>
      <TopbarActions>
        <button className="btn btn-primary btn-sm" {...attrs('manage_sources')} onClick={() => can('manage_sources') && setAdd(true)}>
          <Ic n="plus" className="sm" />
          {t('org.sources.add')}
        </button>
      </TopbarActions>
      <PageHead
        title={t('nav.sources')}
        sub={t('org.sources.sub', { project: app.project?.name ?? '' })}
        right={
          <select className="input input-sm !w-auto" value={pid} onChange={(e) => app.setProjectId(e.target.value)} aria-label={t('org.rules.project')}>
            {app.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="space-y-5">
        <SourcesCard pid={pid} onAdd={() => setAdd(true)} />
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <MailCard pid={pid} />
          <RulesCard pid={pid} />
        </div>
        <MessagesCard pid={pid} />
      </div>
      {add && <AddSourceDialog projectId={pid} onClose={() => setAdd(false)} onCreated={() => void app.refresh()} />}
    </PageWrap>
  )
}
