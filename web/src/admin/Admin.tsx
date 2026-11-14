import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { Ic } from '../ui/Icon'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import AddSourceDialog from '../ui/AddSourceDialog'

type Result = { ep: string; at: string; code: number | string; body: ReactNode; err?: boolean }

function ResultBox({ r }: { r?: Result }) {
  if (!r) return null
  return (
    <div className="fade-in mt-3 rounded-[10px] bg-muted/60 px-4 py-3 text-[13px] leading-relaxed" role="status">
      <div className="flex justify-between gap-3 mb-1 mono text-[11.5px] text-muted-foreground">
        <span>{r.ep}</span>
        <span>
          {r.at} · {r.code}
        </span>
      </div>
      <div className={r.err ? 'text-destructive' : ''}>{r.body}</div>
    </div>
  )
}

function Row({ title, desc, ep, control, result }: { title: ReactNode; desc?: ReactNode; ep: string; control?: ReactNode; result?: ReactNode }) {
  return (
    <div className="py-4 border-t first:border-t-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[14px] font-medium">{title}</div>
          {desc && <div className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>}
          <div className="mt-1 mono text-[11.5px] text-muted-foreground">{ep}</div>
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {result}
    </div>
  )
}

function Card({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      <header className="flex items-center justify-between gap-3 px-5 h-12 border-b">
        <h2 className="section-title truncate">{title}</h2>
        {right}
      </header>
      <div className="px-5 pb-1">{children}</div>
    </div>
  )
}

const mono = (s: ReactNode) => <span className="mono">{s}</span>

export default function Admin() {
  const app = useApp()
  const { t, fmtDateTime, fmtNum } = useI18n()
  const { me, org, projects, version, refresh, can } = app
  const ok = can('admin_demo')
  const [results, setResults] = useState<Record<string, Result>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const stamp = (ep: string, code: number | string, body: ReactNode, err = false): Result => ({
    ep,
    code,
    body,
    err,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  })
  const put = (k: string, r: Result) => setResults((x) => ({ ...x, [k]: r }))

  /** Runs a write: shows the result inline, refreshes the app after. */
  async function run<T>(key: string, ep: string, fn: () => Promise<T>, show: (d: T) => ReactNode, opts: { write?: boolean; code?: number } = {}) {
    setBusy(key)
    try {
      const d = await fn()
      put(key, stamp(ep, opts.code ?? 200, show(d)))
      if (opts.write !== false) await refresh()
      return d
    } catch (e) {
      put(key, stamp(ep, e instanceof ApiError ? e.status : 'ERR', errMsg(e), true))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const stats = useApi(ok ? () => call(client.GET('/stats', {})) : null, [ok, version])
  const config = useApi(ok ? () => call(client.GET('/config')) : null, [ok, version])
  const audit = useApi(ok ? () => call(client.GET('/audit', { params: { query: { limit: 8 } } })) : null, [ok, version])
  const allSources = useApi(
    ok
      ? () =>
          Promise.all(
            projects.map((p) => call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: p.id } } })).then((r) => ({ p, items: (Array.isArray(r) ? r : ((r as { items?: Schemas['Source'][] }).items ?? [])) as Schemas['Source'][] }))),
          )
      : null,
    [ok, version, projects.length],
  )

  if (!me) return <div className="p-6"><Skeleton rows={4} /></div>

  const head = (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div className="min-w-0">
        <h1 className="page-title">{t('admin.title')}</h1>
        <p className="page-sub">{t('admin.sub')}</p>
      </div>
      {ok && <span className="badge line">{config.data?.offline_mode ? t('admin.offlineBadge') : t('admin.online')}</span>}
    </div>
  )

  if (!ok) {
    return (
      <div className="h-full overflow-y-auto scroll">
        <div className="mx-auto px-6 py-6 pb-12" style={{ maxWidth: 1240 }}>
          {head}
          <div className="rounded-[12px] px-4 py-3 bg-muted/60 shadow-[inset_0_0_0_1px_hsl(var(--border))] flex items-center gap-3 text-[13.5px]">
            <Ic n="lock" className="text-muted-foreground" />
            <span>
              <span className="font-medium">{t('admin.lockedTitle')}</span>{' '}
              <span className="text-muted-foreground">{t('admin.lockedText', { name: app.actorName, role: t('roles.' + me.role) })}</span>
            </span>
          </div>
        </div>
      </div>
    )
  }

  const cost = stats.data?.cost
  const pct = cost && cost.cap_usd ? Math.min(100, (cost.spent_usd / cost.cap_usd) * 100) : 0

  return (
    <div className="h-full overflow-y-auto scroll" data-scroll="page">
      <div className="mx-auto px-6 py-6 pb-12" style={{ maxWidth: 1240 }}>
        {head}
        {(stats.error || config.error) && <div className="mb-5 text-[13px] text-destructive">{t('admin.loadError', { message: stats.error || config.error || '' })}</div>}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <div className="space-y-5">
            <StateCard {...{ results, busy, run, stats, config, pct, cost, fmtNum, fmtDateTime, t }} />
            <MailCard {...{ results, busy, run, t, inbound: org?.mail_config?.inbound_address || '', projects }} />
          </div>
          <div className="space-y-5">
            <LibraryCard {...{ results, busy, run, t, fmtDateTime }} />
            <GithubCard {...{ results, busy, run, t, put, stamp, sources: allSources.data, fmtDateTime }} />
            <ProjectsCard {...{ t, projects, sources: allSources.data, loading: allSources.loading, refresh, app }} />
            <AuditCard {...{ t, audit: audit.data, loading: audit.loading, app, fmtDateTime }} />
            <MiscCard {...{ t, me, app }} />
          </div>
        </div>
      </div>
    </div>
  )
}

type T = (k: string, p?: Record<string, string | number>) => string
type Run = <X>(key: string, ep: string, fn: () => Promise<X>, show: (d: X) => ReactNode, opts?: { write?: boolean; code?: number }) => Promise<X | undefined>
type Common = { results: Record<string, Result>; busy: string | null; run: Run; t: T }

function Spin({ on, children }: { on: boolean; children: ReactNode }) {
  return <>{on && <span className="spin" />}{children}</>
}

function StateCard({ results, busy, run, stats, config, pct, cost, fmtNum, fmtDateTime, t }: Common & {
  stats: { data?: Schemas['Stats']; reload: () => Promise<void> }
  config: { data?: Schemas['Config']; reload: () => Promise<void> }
  pct: number
  cost?: { spent_usd: number; cap_usd: number }
  fmtNum: (n: number, o?: Intl.NumberFormatOptions) => string
  fmtDateTime: (s: string) => string
}) {
  const [ask, setAsk] = useState(false)
  const off = !!config.data?.offline_mode
  const money = (n: number) => '$' + fmtNum(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <Card title={t('admin.state')}>
      <Row
        title={t('admin.reset')}
        desc={t('admin.resetDesc', { when: stats.data?.last_reset_at ? fmtDateTime(stats.data.last_reset_at) : t('admin.resetNever') })}
        ep="POST /demo/reset"
        control={!ask && <button className="btn btn-primary btn-sm" onClick={() => setAsk(true)}>{t('admin.reset')}</button>}
        result={
          ask ? (
            <div className="fade-in mt-3 rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--input))] p-4">
              <div className="font-medium text-[14px]">{t('admin.resetAsk')}</div>
              <p className="text-[13px] text-muted-foreground mt-1">{t('admin.resetWarn')}</p>
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setAsk(false)}>{t('common.cancel')}</button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busy === 'reset'}
                  onClick={async () => {
                    const d = await run('reset', 'POST /demo/reset', () => call(client.POST('/demo/reset', {})), (s) =>
                      t('admin.resetDone', { facts: s.facts_total, conflicts: s.open_conflicts, questions: s.open_questions }))
                    setAsk(false)
                    if (d) toast(t('admin.resetToast'))
                  }}
                >
                  <Spin on={busy === 'reset'}>{t('admin.resetConfirm')}</Spin>
                </button>
              </div>
            </div>
          ) : (
            <ResultBox r={results.reset} />
          )
        }
      />
      <Row
        title={t('admin.health')}
        desc={t('admin.healthDesc')}
        ep="GET /health"
        control={
          <button className="btn btn-outline btn-sm" disabled={busy === 'health'} onClick={() => run('health', 'GET /health', () => call(client.GET('/health')), (h) => mono(`{ status: "${h.status}", version: "${h.version}" }`), { write: false })}>
            <Spin on={busy === 'health'}>{t('admin.healthCheck')}</Spin>
          </button>
        }
        result={<ResultBox r={results.health} />}
      />
      <div className="py-4 border-t">
        <div className="flex items-baseline justify-between text-[14px]">
          <span className="font-medium">{t('admin.cost')}</span>
          <span>
            <span className="mono font-medium">{cost ? money(cost.spent_usd) : '—'}</span>{' '}
            <span className="text-muted-foreground">{t('admin.costOf')} <span className="mono">{cost ? money(cost.cap_usd) : '—'}</span></span>
          </span>
        </div>
        <div className="bar neutral mt-2.5"><i style={{ width: pct + '%' }} /></div>
        <div className="mt-1.5 flex justify-between gap-3 text-[12px] text-muted-foreground">
          <span className="mono">GET /stats · GET /config</span>
          <span className="text-right">{off ? t('admin.costOffline') : t('admin.costNote', { provider: config.data?.provider ?? '—', model: config.data?.models.answer ?? '—' })}</span>
        </div>
      </div>
      <Row
        title={t('admin.offline')}
        desc={t('admin.offlineDesc')}
        ep="PATCH /config"
        control={
          <button
            className={'switch mt-1 ' + (off ? 'on' : '')}
            role="switch"
            aria-checked={off}
            aria-label={t('admin.offline')}
            disabled={!config.data || busy === 'offline'}
            onClick={async () => {
              const next = !off
              const d = await run('offline', 'PATCH /config', () => call(client.PATCH('/config', { body: { offline_mode: next } })), (c) => mono(`offline_mode: ${c.offline_mode}`))
              if (d) {
                toast(next ? t('admin.offlineOn') : t('admin.offlineOff'), { icon: next ? 'wifioff' : 'ok' })
                void config.reload()
              }
            }}
          />
        }
        result={<ResultBox r={results.offline} />}
      />
    </Card>
  )
}

type Routed = Schemas['InboundEmailResult']

function routing(t: T, r: Routed, projects: Schemas['Project'][]): ReactNode {
  const proj = projects.find((p) => p.id === r.routed_project_id)
  return (
    <div className="space-y-1">
      <div>{r.routed_project_id ? t('admin.routedTo', { project: proj?.name ?? r.routed_project_id, rule: r.rule_id ?? '—' }) : t('admin.routedNone')}</div>
      <div>{r.facts_created.length ? t('admin.facts', { list: r.facts_created.join(', ') }) : t('admin.noFacts')}</div>
      {r.supersedes_created.map((s) => (
        <div key={s.fact_id + s.supersedes}>{t('admin.supersedes', { fact: s.fact_id, old: s.supersedes })}</div>
      ))}
    </div>
  )
}

function MailCard({ results, busy, run, t, inbound, projects }: Common & { inbound: string; projects: Schemas['Project'][] }) {
  const [from, setFrom] = useState('client@meridianlabs.org')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('Onboarding target, final check')
  const [text, setText] = useState('We keep the onboarding target at 5 weeks, as agreed.')
  useEffect(() => {
    if (inbound && !to) setTo(inbound)
  }, [inbound, to])
  return (
    <Card title={t('admin.mail')}>
      <Row
        title={t('admin.demoEmail')}
        desc={t('admin.demoEmailDesc')}
        ep="POST /demo/send-email"
        control={
          <button className="btn btn-primary btn-sm" disabled={busy === 'email'} onClick={() => run('email', 'POST /demo/send-email', () => call(client.POST('/demo/send-email', {})), (r) => routing(t, r, projects))}>
            <Spin on={busy === 'email'}><Ic n="send" className="sm" />{t('admin.send')}</Spin>
          </button>
        }
        result={<ResultBox r={results.email} />}
      />
      <Row
        title={t('admin.poll')}
        desc={t('admin.pollDesc')}
        ep="POST /mail/poll"
        control={
          <button
            className="btn btn-outline btn-sm"
            disabled={busy === 'poll'}
            onClick={() =>
              run('poll', 'POST /mail/poll', () => call(client.POST('/mail/poll', { body: {} })), (r) =>
                r.polled === 0 ? t('admin.pollEmpty') : (
                  <div className="space-y-2">
                    <div>{t('admin.pollRead', { count: r.polled })}</div>
                    {r.results.map((x) => <div key={x.message_id}>{routing(t, x, projects)}</div>)}
                  </div>
                ))
            }
          >
            <Spin on={busy === 'poll'}>{t('admin.pollNow')}</Spin>
          </button>
        }
        result={<ResultBox r={results.poll} />}
      />
      <div className="py-4 border-t">
        <div className="text-[14px] font-medium">{t('admin.compose')}</div>
        <div className="mono text-[11.5px] text-muted-foreground mt-0.5">POST /mail/inbound</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="cFrom">{t('admin.from')}</label><input id="cFrom" className="input mono !text-[13px]" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="cTo">{t('admin.to')}</label><input id="cTo" className="input mono !text-[13px]" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="col-span-2"><label className="label" htmlFor="cSubj">{t('admin.subject')}</label><input id="cSubj" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="col-span-2"><label className="label" htmlFor="cText">{t('admin.text')}</label><textarea id="cText" className="input !min-h-[60px]" value={text} onChange={(e) => setText(e.target.value)} /></div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            className="btn btn-outline btn-sm"
            disabled={busy === 'compose' || !from.trim() || !text.trim()}
            onClick={() =>
              run('compose', 'POST /mail/inbound', () =>
                call(client.POST('/mail/inbound', {
                  body: { message_id: `<admin-${Date.now()}@admin.local>`, from: from.trim(), to: [to.trim()], cc: [], subject: subject.trim(), date: new Date().toISOString(), text: text.trim(), attachments: [] },
                })), (r) => routing(t, r, projects))
            }
          >
            <Spin on={busy === 'compose'}>{t('admin.composeSend')}</Spin>
          </button>
        </div>
        <ResultBox r={results.compose} />
      </div>
    </Card>
  )
}

function LibraryCard({ results, busy, run, t, fmtDateTime }: Common & { fmtDateTime: (s: string) => string }) {
  const { version } = useApp()
  const [docId, setDocId] = useState('library/onboarding-standard')
  const [active, setActive] = useState('library/onboarding-standard')
  const [label, setLabel] = useState('')
  const [text, setText] = useState('Onboarding SLA: 5 weeks.')
  const vers = useApi(() => call(client.GET('/documents/{doc_id}/versions', { params: { path: { doc_id: active } } })), [active, version])
  const list = vers.data ?? []
  const next = 'v' + ((list.length ? Math.max(...list.map((v) => v.version)) : 0) + 1)
  return (
    <Card title={t('admin.library')}>
      <div className="py-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><label className="label" htmlFor="docId">{t('admin.docId')}</label><input id="docId" className="input mono !text-[13px]" value={docId} onChange={(e) => setDocId(e.target.value)} /></div>
          <button className="btn btn-outline btn-sm mb-0.5" onClick={() => (docId.trim() === active ? void vers.reload() : setActive(docId.trim()))}>{t('admin.docLoad')}</button>
        </div>
        <div className="mono text-[11.5px] text-muted-foreground mt-1">GET /documents/{'{doc_id}'}/versions</div>
        {vers.loading && !vers.data ? <div className="mt-3"><Skeleton rows={2} className="h-9" /></div> : vers.error ? (
          <div className="mt-3 text-[13px] text-muted-foreground">{t('admin.noVersions')}</div>
        ) : list.length === 0 ? (
          <div className="mt-3 text-[13px] text-muted-foreground">{t('admin.noVersions')}</div>
        ) : (
          <ul className="mt-3 rounded-[10px] shadow-[inset_0_0_0_1px_hsl(var(--border))] divide-y">
            {[...list].reverse().map((v, i) => (
              <li key={v.version} className="flex items-center gap-3 px-4 py-2.5 text-[13.5px]">
                <span className="mono w-8">{v.version_label || 'v' + v.version}</span>
                <span className="flex-1 mono text-[12.5px] text-muted-foreground">{v.uploaded_at ? fmtDateTime(v.uploaded_at) : ''}</span>
                {!!v.facts_superseded?.length && <span className="mono text-[12px] text-muted-foreground strike">{v.facts_superseded.join(', ')}</span>}
                <span className={'badge ' + (i === 0 ? 'binding' : 'superseded')}>{i === 0 ? t('fact.status.binding') : t('fact.status.superseded')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Row
        title={t('admin.uploadVersion')}
        desc={t('admin.uploadDesc')}
        ep="POST /documents/{doc_id}/versions"
        result={
          <>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div><label className="label" htmlFor="vLabel">{t('admin.versionLabel')}</label><input id="vLabel" className="input mono !text-[13px]" placeholder={next} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <div><label className="label" htmlFor="vText">{t('admin.versionText')}</label><textarea id="vText" className="input !min-h-[60px]" value={text} onChange={(e) => setText(e.target.value)} /></div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === 'v3' || !text.trim() || !active}
                onClick={async () => {
                  const d = await run('v3', 'POST /documents/{doc_id}/versions', () =>
                    call(client.POST('/documents/{doc_id}/versions', { params: { path: { doc_id: active } }, body: { version_label: label.trim() || next, text: text.trim() } })),
                    (r) => (
                      <div className="space-y-1">
                        <div>{t('admin.uploaded', { label: r.version.version_label || 'v' + r.version.version })}</div>
                        {r.supersedes_created.length ? r.supersedes_created.map((s) => <div key={s.fact_id}>{t('admin.supersedes', { fact: s.fact_id, old: s.supersedes })}</div>) : <div>{t('admin.supersededNone')}</div>}
                      </div>
                    ), { code: 201 })
                  if (d) { setLabel(''); void vers.reload() }
                }}
              >
                <Spin on={busy === 'v3'}><Ic n="upload" className="sm" />{t('admin.uploadBtn')}</Spin>
              </button>
            </div>
            <ResultBox r={results.v3} />
          </>
        }
      />
    </Card>
  )
}

function GithubCard({ results, busy, run, t, put, stamp, sources, fmtDateTime }: Common & {
  put: (k: string, r: Result) => void
  stamp: (ep: string, code: number | string, body: ReactNode, err?: boolean) => Result
  sources?: { p: Schemas['Project']; items: Schemas['Source'][] }[]
  fmtDateTime: (s: string) => string
}) {
  const { refresh } = useApp()
  const [job, setJob] = useState<{ id: string; status: string; src: string } | null>(null)
  const [repo, setRepo] = useState('https://github.com/gabry-ts/canonico')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const gh = (sources ?? []).flatMap((x) => x.items).filter((s) => s.type === 'github')

  async function sync(s: Schemas['Source']) {
    const ep = 'POST /sources/{source_id}/sync'
    const key = 'gh-' + s.id
    try {
      let j = await call(client.POST('/sources/{source_id}/sync', { params: { path: { source_id: s.id } } }))
      setJob({ id: j.id, status: j.status, src: s.id })
      for (let i = 0; i < 90 && (j.status === 'queued' || j.status === 'running') && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        j = await call(client.GET('/sync-jobs/{job_id}', { params: { path: { job_id: j.id } } }))
        setJob({ id: j.id, status: j.status, src: s.id })
      }
      put(key, j.status === 'error' ? stamp(ep, 'error', t('admin.syncError'), true) : stamp(ep, 200, t('admin.syncDone', { items: j.items_added ?? 0, facts: j.facts_created ?? 0 })))
      await refresh()
    } catch (e) {
      put(key, stamp(ep, e instanceof ApiError ? e.status : 'ERR', errMsg(e), true))
    } finally {
      if (alive.current) setJob(null)
    }
  }

  return (
    <Card title={t('admin.github')}>
      {gh.length === 0 && <div className="py-4 text-[13px] text-muted-foreground">{t('admin.githubNone')}</div>}
      {gh.map((s) => {
        const syncing = job?.src === s.id
        return (
          <Row
            key={s.id}
            title={s.label}
            desc={t('admin.syncDesc', { items: s.items ?? 0, when: s.last_synced_at ? fmtDateTime(s.last_synced_at) : '—' })}
            ep="POST /sources/{source_id}/sync · GET /sync-jobs/{job_id}"
            control={
              <button className="btn btn-outline btn-sm" disabled={!!job} onClick={() => sync(s)}>
                {syncing ? <><span className="spin" />{t('admin.syncing')}</> : <><Ic n="refresh" className="sm" />{t('admin.syncNow')}</>}
              </button>
            }
            result={syncing ? <div className="mt-3"><div className="bar"><i style={{ width: job.status === 'running' ? '60%' : '15%' }} /></div><div className="mt-1.5 text-[12px] text-muted-foreground mono">{t('admin.syncJob', { id: job.id, status: job.status })}</div></div> : <ResultBox r={results['gh-' + s.id]} />}
          />
        )
      })}
      <Row
        title={t('admin.preview')}
        desc={t('admin.previewDesc')}
        ep="POST /sources/github/preview"
        result={
          <>
            <div className="mt-3 flex gap-2">
              <input className="input mono !text-[13px] flex-1" aria-label={t('admin.preview')} value={repo} onChange={(e) => setRepo(e.target.value)} />
              <button
                className="btn btn-outline btn-sm"
                disabled={busy === 'preview' || !repo.trim()}
                onClick={() => run('preview', 'POST /sources/github/preview', () => call(client.POST('/sources/github/preview', { body: { repo_url: repo.trim() } })), (p) =>
                  t('admin.previewResult', { name: p.full_name, issues: p.open_issues, branch: p.default_branch, readme: p.has_readme ? t('admin.readme') : t('admin.noReadme') }), { write: false })}
              >
                <Spin on={busy === 'preview'}>{t('admin.previewBtn')}</Spin>
              </button>
            </div>
            <ResultBox r={results.preview} />
          </>
        }
      />
    </Card>
  )
}

function ProjectsCard({ t, projects, sources, loading, refresh }: {
  t: T
  projects: Schemas['Project'][]
  sources?: { p: Schemas['Project']; items: Schemas['Source'][] }[]
  loading: boolean
  refresh: () => Promise<void>
  app: unknown
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [addFor, setAddFor] = useState<string | null>(null)
  async function create() {
    setSaving(true)
    try {
      await call(client.POST('/projects', { body: { name: name.trim(), description: desc.trim() || null } }))
      setName(''); setDesc('')
      toast(t('admin.projectCreated'))
      await refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card title={t('admin.projects')}>
      <div className="py-4">
        <div className="mono text-[11.5px] text-muted-foreground mb-2">GET /projects · GET /projects/{'{id}'}/sources</div>
        {loading && !sources ? <Skeleton rows={2} className="h-9" /> : (
          <ul className="space-y-3">
            {projects.map((p) => {
              const items = sources?.find((x) => x.p.id === p.id)?.items ?? []
              return (
                <li key={p.id} className="rounded-[10px] shadow-[inset_0_0_0_1px_hsl(var(--border))] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><span className="text-[13.5px] font-medium">{p.name}</span> <span className="mono text-[11.5px] text-muted-foreground">{p.id}</span></div>
                    <button className="btn btn-outline btn-xs" onClick={() => setAddFor(p.id)}>{t('admin.addSource')}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {items.length === 0 && <span className="text-[12.5px] text-muted-foreground">{t('admin.noSources')}</span>}
                    {items.map((s) => <span key={s.id} className="tag" title={s.id}>{s.type} · {s.label}</span>)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="py-4 border-t">
        <div className="text-[14px] font-medium">{t('admin.newProject')}</div>
        <div className="mono text-[11.5px] text-muted-foreground mt-0.5">POST /projects</div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <div><label className="label" htmlFor="pName">{t('admin.projectName')}</label><input id="pName" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="pDesc">{t('admin.projectDesc')}</label><input id="pDesc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
        <div className="mt-3 flex justify-end"><button className="btn btn-primary btn-sm" disabled={saving || !name.trim()} onClick={create}><Spin on={saving}>{t('admin.newProject')}</Spin></button></div>
      </div>
      {addFor && <AddSourceDialog projectId={addFor} onClose={() => setAddFor(null)} onCreated={() => void refresh()} />}
    </Card>
  )
}

function AuditCard({ t, audit, loading, app, fmtDateTime }: {
  t: T; audit?: Schemas['AuditEvent'][]; loading: boolean; app: ReturnType<typeof useApp>; fmtDateTime: (s: string) => string
}) {
  const [busy, setBusy] = useState<string | null>(null)
  async function undo(id: string) {
    setBusy(id)
    try {
      await call(client.POST('/audit/{event_id}/undo', { params: { path: { event_id: id } }, body: { actor: app.actor, reason: 'Undone from demo control.' } }))
      toast(t('admin.undoDone'))
      await app.refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card title={t('admin.audit')}>
      <div className="py-3">
        <div className="mono text-[11.5px] text-muted-foreground mb-2">GET /audit · POST /audit/{'{event_id}'}/undo</div>
        {loading && !audit ? <Skeleton rows={3} className="h-9" /> : !audit?.length ? <Empty icon="inbox" title={t('admin.noAudit')} /> : (
          <ul className="divide-y">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="badge line">{a.action}</span>
                <span className="flex-1 min-w-0 truncate"><span className="text-muted-foreground">{a.reason || '—'}</span>{a.fact_id && <> <button className="mono text-[11.5px] underline-offset-2 hover:underline" onClick={() => app.openFact(a.fact_id)}>{a.fact_id}</button></>}</span>
                <span className="mono text-[11.5px] text-muted-foreground shrink-0">{fmtDateTime(a.at)}</span>
                {a.actor !== 'system' && a.action !== 'undo' && a.fact_id && (
                  <button className="btn btn-ghost btn-sm" disabled={busy === a.id} onClick={() => undo(a.id)}><Ic n="undo" className="sm" />{t('common.undo')}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function MiscCard({ t, me, app }: { t: T; me: Schemas['Me']; app: ReturnType<typeof useApp> }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Schemas['SearchResult'][] | null>(null)
  const [busy, setBusy] = useState(false)
  const meInfo = useApi(() => call(client.GET('/me', {})), [app.version])
  async function search() {
    if (!q.trim()) return
    setBusy(true)
    try {
      const r = await call(client.GET('/search', { params: { query: { q: q.trim(), project_id: app.pid } } }))
      setRes(r.results)
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }
  const m = meInfo.data ?? me
  return (
    <Card title={t('admin.me')}>
      <div className="py-4">
        <div className="mono text-[11.5px] text-muted-foreground mb-2">GET /me</div>
        <div className="text-[13.5px]"><span className="font-medium">{m.member.name}</span> · {t('roles.' + m.role)} <span className="mono text-[11.5px] text-muted-foreground">{m.member.id}</span></div>
        <div className="mt-2 flex flex-wrap gap-1.5">{(m.permissions as string[]).map((p) => <span key={p} className="tag">{p}</span>)}</div>
      </div>
      <div className="py-4 border-t">
        <div className="text-[14px] font-medium">{t('admin.search')}</div>
        <div className="mono text-[11.5px] text-muted-foreground mt-0.5">GET /search</div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <input className="input flex-1" aria-label={t('admin.search')} placeholder={t('admin.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-outline btn-sm" type="submit" disabled={busy || !q.trim()}><Spin on={busy}>{t('common.search')}</Spin></button>
        </form>
        {res && (res.length === 0 ? <div className="mt-3 text-[13px] text-muted-foreground">{t('admin.searchNone')}</div> : (
          <ul className="mt-3 divide-y">
            {res.slice(0, 6).map((r) => (
              <li key={r.kind + r.id} className="py-2 text-[13px]">
                {r.kind === 'fact' ? <button className="mono text-[12px] underline-offset-2 hover:underline" onClick={() => app.openFact(r.id)}>{r.id}</button> : <span className="mono text-[12px]">{r.id}</span>}
                <span className="ml-2 text-muted-foreground">{r.snippet}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Card>
  )
}
