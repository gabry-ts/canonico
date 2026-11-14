import { useEffect, useState } from 'react'
import { call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { usePerm } from '../lib/perm'
import { useRoute } from '../lib/router'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import AddSourceDialog from '../ui/AddSourceDialog'
import { Avatar, Ic } from '../ui/Icon'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import UploadDialog from '../ui/UploadDialog'
import { AnswersCard, Attention, Feed } from './home/cards'
import { ItemsCard, type ItemFilter } from './home/ItemsCard'
import { SourcesTable } from './home/SourcesTable'
import { asList, CardHead, ErrorBox, PageHead, PageWrap, type Source } from './home/shared'

type Member = Schemas['Member']
type MailRule = Schemas['MailRule']

export default function Project() {
  const { t } = useI18n()
  const app = useApp()
  const { attrs, guard } = usePerm()
  const { sub } = useRoute()
  const [routePid, routeSrc] = (sub ?? '').split('/')
  const pid = routePid || app.projectId
  const [dialog, setDialog] = useState<'source' | 'upload' | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [filter, setFilter] = useState<ItemFilter>({ type: 'all', tag: 'all' })

  const { projectId: currentPid, projects, setProjectId } = app
  useEffect(() => {
    if (routePid && routePid !== currentPid && projects.some((p) => p.id === routePid)) setProjectId(routePid)
  }, [routePid, currentPid, projects, setProjectId])

  const proj = useApi(() => call(client.GET('/projects/{project_id}', { params: { path: { project_id: pid } } })), [pid, app.version])
  const stats = useApi(() => call(client.GET('/stats', { params: { query: { project_id: pid } } })), [pid, app.version])
  const sources = useApi(() => call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: pid } } })).then((d) => asList<Source>(d)), [pid, app.version])

  const goItem = (id: string) => {
    setFilter({ type: 'all', tag: 'all' })
    setOpenItem(id)
    setTimeout(() => document.getElementById('item-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }

  if (proj.error && !proj.data)
    return (
      <PageWrap>
        <div className="card">
          <ErrorBox message={proj.error} onRetry={proj.reload} />
        </div>
      </PageWrap>
    )
  const p = proj.data
  return (
    <PageWrap>
      <PageHead
        title={p ? p.name : <span className="skel inline-block h-7 w-56 align-middle" />}
        sub={p?.description ?? undefined}
        right={
          <div className="flex gap-2 flex-wrap">
            <a href="#/app" className="btn btn-outline btn-sm">
              <Ic n="ask" className="sm" />
              {t('home.proj.ask')}
            </a>
            <button className="btn btn-outline btn-sm" {...attrs('correct_fact')} onClick={guard('correct_fact', () => setDialog('upload'))}>
              <Ic n="upload" className="sm" />
              {t('home.upload.button')}
            </button>
            <button className="btn btn-primary btn-sm" {...attrs('manage_sources')} onClick={guard('manage_sources', () => setDialog('source'))}>
              <Ic n="plus" className="sm" />
              {t('home.addSource')}
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <div className="card overflow-hidden">
            <CardHead
              title={t('home.src.title')}
              right={
                <a href="#/sources" className="btn btn-ghost btn-sm">
                  {t('home.proj.manage')} <Ic n="arrow" className="sm" />
                </a>
              }
            />
            <SourcesTable key={pid} pid={pid} openId={routeSrc || null} onAdd={() => setDialog('source')} onItem={goItem} />
          </div>
          <ItemsCard pid={pid} open={openItem} setOpen={setOpenItem} filter={filter} setFilter={setFilter} sources={sources.data ?? []} />
          <div className="card overflow-hidden">
            <CardHead title={t('home.attention.title')} />
            <Attention pid={pid} />
          </div>
          <div className="card overflow-hidden">
            <CardHead
              title={t('home.feed.recent')}
              right={
                <a href="#/audit" className="btn btn-ghost btn-sm">
                  {t('nav.audit')} <Ic n="arrow" className="sm" />
                </a>
              }
            />
            <Feed pid={pid} />
          </div>
        </div>
        <div className="space-y-5 min-w-0">
          <MembersCard pid={pid} />
          <MailCard pid={pid} />
          <AnswersCard stats={stats.data} error={stats.error} onRetry={stats.reload} />
        </div>
      </div>
      {dialog === 'source' && <AddSourceDialog projectId={pid} onClose={() => setDialog(null)} onCreated={() => void sources.reload()} />}
      {dialog === 'upload' && (
        <UploadDialog
          projectId={pid}
          onClose={() => setDialog(null)}
          onDone={() => {
            setFilter({ type: 'all', tag: 'all' })
          }}
        />
      )}
    </PageWrap>
  )
}

function MembersCard({ pid }: { pid: string }) {
  const { t } = useI18n()
  const { version } = useApp()
  const st = useApi(
    () =>
      Promise.all([
        call(client.GET('/projects/{project_id}/members', { params: { path: { project_id: pid } } })),
        call(client.GET('/org/members')).then((d) => asList<Member>(d)),
      ]),
    [pid, version],
  )
  return (
    <div className="card overflow-hidden">
      <CardHead
        title={t('home.proj.members')}
        right={
          <a href="#/settings/members" className="btn btn-ghost btn-sm">
            {t('home.proj.manage')}
          </a>
        }
      />
      {st.error && !st.data ? (
        <ErrorBox message={st.error} onRetry={st.reload} />
      ) : !st.data ? (
        <div className="p-5">
          <Skeleton rows={3} className="h-8" />
        </div>
      ) : asList<Schemas['ProjectMember']>(st.data[0]).length === 0 ? (
        <Empty icon="users" title={t('home.proj.noMembers')} />
      ) : (
        <ul className="divide-y py-1">
          {asList<Schemas['ProjectMember']>(st.data[0]).map((pm) => {
            const m = st.data![1].find((x) => x.id === pm.member_id)
            return (
              <li key={pm.member_id} className="flex items-center gap-3 px-5 py-2.5">
                <Avatar name={m?.name ?? pm.member_id} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium truncate">{m?.name ?? pm.member_id}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {m?.email}
                    {m?.status === 'invited' ? ' · ' + t('home.proj.invited') : ''}
                  </div>
                </div>
                <span className="text-[13px] capitalize">{t('roles.' + pm.role)}</span>
                {pm.inherited ? <span className="badge">{t('home.proj.inherited')}</span> : <span className="badge line">{t('home.proj.projectRole')}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MailCard({ pid }: { pid: string }) {
  const { t } = useI18n()
  const app = useApp()
  const { attrs, guard } = usePerm()
  const [busy, setBusy] = useState(false)
  const st = useApi(
    () =>
      Promise.all([
        call(client.GET('/projects/{project_id}/mail', { params: { path: { project_id: pid } } })),
        call(client.GET('/org/mail/rules'))
          .then((d) => asList<MailRule>(d))
          .catch(() => [] as MailRule[]),
      ]),
    [pid, app.version],
  )
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast(msg)
      await st.reload()
      void app.refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }
  const mail = st.data?.[0]
  const rules = (st.data?.[1] ?? []).filter((r) => r.project_id === pid)
  const eff = mail?.effective_mail_config
  const override = () => {
    if (!eff) return
    const domain = (eff.inbound_address ?? '').split('@')[1] || 'inbound.canonico.app'
    const slug = pid.replace(/^proj-/, '')
    return act(
      () =>
        call(
          client.PUT('/projects/{project_id}/mail', {
            params: { path: { project_id: pid } },
            body: { mode: eff.mode, imap_host: eff.imap_host ?? null, imap_user: eff.imap_user ?? null, inbound_address: `${slug}@${domain}`, poll_interval_s: eff.poll_interval_s ?? 60 },
          }),
        ),
      t('home.mail.overridden'),
    )
  }
  const revert = () =>
    act(() => call(client.DELETE('/projects/{project_id}/mail', { params: { path: { project_id: pid } } })), t('home.mail.reverted'))
  const projName = app.projects.find((p) => p.id === pid)?.name ?? pid
  return (
    <div className="card overflow-hidden">
      <CardHead
        title={t('home.mail.title')}
        right={mail ? mail.overridden ? <span className="badge line">{t('home.mail.badgeOverridden')}</span> : <span className="badge">{t('home.mail.badgeInherited')}</span> : undefined}
      />
      {st.error && !st.data ? (
        <ErrorBox message={st.error} onRetry={st.reload} />
      ) : !mail || !eff ? (
        <div className="p-5">
          <Skeleton rows={3} className="h-5" />
        </div>
      ) : (
        <div className="p-5">
          <dl className="kv !grid-cols-[88px_1fr]">
            <dt>{t('home.mail.mode')}</dt>
            <dd className="text-[12.5px]">{t(eff.mode === 'imap' ? 'org.mail.modeImapReal' : eff.mode === 'webhook' ? 'org.mail.modeWebhook' : 'org.mail.modeImap')}</dd>
            <dt>{t('home.mail.inbound')}</dt>
            <dd className="mono text-[12.5px] truncate">{eff.inbound_address ?? '—'}</dd>
            <dt>{t('home.mail.setOn')}</dt>
            <dd>{mail.overridden ? t('home.mail.thisProject') : (app.org?.name ?? '')}</dd>
          </dl>
          <div className="mt-4">
            {mail.overridden ? (
              <button className="btn btn-outline btn-sm" disabled={busy} {...attrs('manage_mail')} onClick={guard('manage_mail', () => void revert())}>
                {t('home.mail.revert')}
              </button>
            ) : (
              <button className="btn btn-outline btn-sm" disabled={busy} {...attrs('manage_mail')} onClick={guard('manage_mail', () => void override())}>
                {t('home.mail.override')}
              </button>
            )}
          </div>
          <div className="mt-5 text-[12.5px] font-medium text-muted-foreground">{t('home.mail.rulesTitle')}</div>
          {rules.length ? (
            <ul className="mt-2 space-y-1">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[13px]">
                  <span className="mono">{r.value}</span>
                  <Ic n="arrow" className="sm text-muted-foreground" />
                  <span className="truncate">{projName}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">{t('home.mail.noRules')}</p>
          )}
        </div>
      )}
    </div>
  )
}
