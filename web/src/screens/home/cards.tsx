import type { ReactNode } from 'react'
import { call, client, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { docLabel } from '../../lib/facts'
import { useApi } from '../../lib/useApi'
import { useApp } from '../../lib/store'
import { Avatar, Ic } from '../../ui/Icon'
import { Empty, Skeleton } from '../../ui/overlays'
import { CardHead, ErrorBox, humanTopic } from './shared'

type Stats = Schemas['Stats']

/* ---------------- Needs attention ---------------- */

export function Attention({ pid }: { pid: string | undefined }) {
  const { t } = useI18n()
  const { version } = useApp()
  const q = { project_id: pid }
  const st = useApi(
    () =>
      Promise.all([
        call(client.GET('/maintenance/queue', { params: { query: { ...q, status: 'pending', limit: 50 } } })),
        call(client.GET('/conflicts', { params: { query: { ...q, status: 'open' } } })),
        call(client.GET('/open-questions', { params: { query: { ...q, status: 'open' } } })),
      ]),
    [pid, version],
  )
  if (st.error && !st.data) return <ErrorBox message={st.error} onRetry={st.reload} />
  if (!st.data)
    return (
      <div className="p-5">
        <Skeleton rows={3} className="h-8" />
      </div>
    )
  const [mq, conf, oqs] = st.data
  const stale = (Array.isArray(mq) ? mq : []).filter((m) => m.reason === 'superseded_still_retrievable')
  const openConf = Array.isArray(conf) ? conf : []
  const openQ = Array.isArray(oqs) ? oqs : []
  if (!stale.length && !openConf.length && !openQ.length)
    return (
      <div className="p-5 text-[13.5px] text-muted-foreground flex items-center gap-2">
        <Ic n="ok" className="text-success" />
        {t('home.attention.clear')}
      </div>
    )
  const col = (title: string, n: number, tone: string, href: string, body: ReactNode) => (
    <a href={'#/' + href} className="block p-5 hover:bg-accent/40 transition min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{title}</span>
        <Ic n="arrow" className="sm text-muted-foreground" />
      </div>
      <div className={`mt-1 mono text-[26px] font-medium tracking-tight ${n ? tone : ''}`}>{n}</div>
      <div className="mt-2 space-y-1.5 text-[13px]">{body}</div>
    </a>
  )
  const none = (k: string) => <div className="text-muted-foreground">{t(k)}</div>
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x">
      {col(
        t('home.attention.stale'),
        stale.length,
        'text-warning-text',
        'maintenance',
        stale.length
          ? stale.slice(0, 2).map((m) => (
              <div key={m.id} className="truncate">
                <span className="font-medium">{m.fact.value}</span> <span className="text-muted-foreground">· {docLabel(m.fact.doc_id)}</span>
              </div>
            ))
          : none('home.attention.allClear'),
      )}
      {col(
        t('home.attention.conflicts'),
        openConf.length,
        'text-warning-text',
        'conflicts',
        openConf.length
          ? openConf.slice(0, 2).map((c) => (
              <div key={c.id} className="truncate">
                <span className="font-medium">{humanTopic(c.topic)}</span>{' '}
                <span className="text-muted-foreground">· {c.facts.map((f) => f.value).slice(0, 2).join(' / ')}</span>
              </div>
            ))
          : none('home.attention.noConflicts'),
      )}
      {col(
        t('home.attention.questions'),
        openQ.length,
        'text-open-text',
        'open-questions',
        openQ.length
          ? openQ.slice(0, 2).map((o) => (
              <div key={o.id} className="truncate text-muted-foreground">
                {o.question}
              </div>
            ))
          : none('home.attention.noQuestions'),
      )}
    </div>
  )
}

/* ---------------- What changed recently ---------------- */

const VERBS = ['retire', 'restore', 'ingest', 'classify', 'create', 'patch', 'pin', 'unpin', 'supersede', 'unlink', 'resolve', 'close', 'approve', 'dismiss', 'merge', 'delete_document', 'undo', 'import', 'reset']

export function Feed({ pid, limit = 8 }: { pid: string | undefined; limit?: number }) {
  const { t, fmtWhen } = useI18n()
  const { version, openFact } = useApp()
  const st = useApi(() => call(client.GET('/audit', { params: { query: { project_id: pid, limit } } })), [pid, limit, version])
  if (st.error && !st.data) return <ErrorBox message={st.error} onRetry={st.reload} />
  if (!st.data)
    return (
      <div className="p-5">
        <Skeleton rows={4} className="h-9" />
      </div>
    )
  const items = (Array.isArray(st.data) ? st.data : []).slice(0, limit)
  if (!items.length)
    return (
      <Empty icon="audit" title={t('home.feed.emptyTitle')}>
        {t('home.feed.emptyText')}
      </Empty>
    )
  return (
    <ul className="divide-y">
      {items.map((a) => {
        const system = !a.actor || a.actor === 'system'
        const name = system ? t('home.feed.system') : a.actor.split(' ')[0]
        return (
          <li key={a.id} className="flex gap-3 px-5 py-3">
            <span className="mt-0.5">
              <Avatar name={system ? 'Canonico' : a.actor} />
            </span>
            <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
              <div>
                <span className="font-medium">{name}</span>{' '}
                <span className="text-muted-foreground">{VERBS.includes(a.action) ? t('home.verb.' + a.action) : a.action}</span>{' '}
                {a.fact_id && (
                  <button className="font-medium mono text-[12.5px] hover:underline underline-offset-4" onClick={() => openFact(a.fact_id)}>
                    {a.fact_id}
                  </button>
                )}
              </div>
              {a.reason && <div className="text-[12.5px] text-muted-foreground mt-0.5 truncate">{a.reason}</div>}
            </div>
            <span className="mono text-[12px] text-muted-foreground shrink-0">{fmtWhen(a.at)}</span>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------- Answers ---------------- */

export function AnswersCard({ stats }: { stats: Stats | null | undefined }) {
  const { t, fmtDateShort } = useI18n()
  const a = stats?.answers ?? {}
  const rows: [string, number, string][] = [
    [t('home.answers.binding'), a.binding ?? 0, 'bg-primary'],
    [t('home.answers.contested'), a.contested ?? 0, 'bg-warning'],
    [t('home.answers.none'), a.no_answer ?? 0, 'bg-muted-foreground/40'],
  ]
  const tot = rows.reduce((s, r) => s + r[1], 0)
  return (
    <div className="card">
      <CardHead
        title={t('home.answers.title')}
        right={a.since ? <span className="badge line">{t('home.answers.since', { date: fmtDateShort(a.since) })}</span> : undefined}
      />
      <div className="p-5">
        {!stats ? (
          <Skeleton rows={3} className="h-5" />
        ) : (
          <>
            <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-muted">
              {tot > 0 && rows.filter((r) => r[1]).map((r) => <span key={r[0]} className={r[2]} style={{ width: `${(r[1] / tot) * 100}%` }} />)}
            </div>
            <ul className="mt-4 space-y-2">
              {rows.map((r) => (
                <li key={r[0]} className="flex items-center gap-2.5 text-[13.5px]">
                  <span className={`w-2 h-2 rounded-full ${r[2]}`} />
                  <span className="flex-1">{r[0]}</span>
                  <span className="mono">{r[1]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12.5px] text-muted-foreground leading-relaxed">{t('home.answers.note')}</p>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------- Time to fix ---------------- */

export function FixMetric({ stats }: { stats: Stats | null | undefined }) {
  const { t, fmtNum } = useI18n()
  const m = stats?.time_to_fix_seconds
  const sec = m?.median ?? null
  const val = sec === null ? '—' : sec < 60 ? `${Math.round(sec)} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`
  return (
    <div className="card">
      <CardHead title={t('home.fix.title')} right={sec === null ? <span className="badge open">{t('home.fix.notYet')}</span> : undefined} />
      <div className="p-5">
        <div className={`mono text-[30px] font-medium tracking-tight ${sec === null ? 'text-muted-foreground' : ''}`}>{val}</div>
        <div className="mt-1 text-[13.5px] font-medium">
          {sec === null ? t('home.fix.pending') : t('home.fix.median', { count: m?.samples ?? 0, n: fmtNum(m?.samples ?? 0) })}
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground leading-relaxed">{t('home.fix.note')}</p>
      </div>
    </div>
  )
}

/* ---------------- Memory health ---------------- */

const STATUS_COLOR: Record<string, string> = {
  binding: 'bg-primary',
  active: 'bg-foreground/35',
  contested: 'bg-warning/50',
  open: 'bg-open',
  superseded: 'bg-muted-foreground/25',
  retired: 'bg-muted-foreground/50',
}
const STATUS_KEYS = ['binding', 'held', 'stillActive', 'superseded', 'retired', 'open', 'active', 'contested']
const TYPE_KEYS = ['DECISION', 'CONSTRAINT', 'EVIDENCE', 'HYPOTHESIS', 'SUPERSEDED', 'OPEN']

export function HealthCard({ stats, children }: { stats: Stats | null | undefined; children?: ReactNode }) {
  const { t, fmtNum } = useI18n()
  const by = stats?.facts_by_status ?? stats?.by_status ?? {}
  const ty = stats?.facts_by_type ?? stats?.by_type ?? {}
  const tot = stats?.facts_total ?? Object.values(by).reduce((s, n) => s + n, 0)
  const stEntries = Object.entries(by)
  const tyEntries = Object.entries(ty).sort((a, b) => b[1] - a[1])
  const maxT = Math.max(1, ...tyEntries.map((e) => e[1]))
  return (
    <div className="card overflow-hidden">
      <CardHead title={t('home.health.title')} sub={stats ? t('home.health.sub', { count: tot, n: fmtNum(tot), docs: fmtNum(stats.documents), topics: fmtNum(stats.topics) }) : undefined} />
      {!stats ? (
        <div className="p-5">
          <Skeleton rows={3} className="h-5" />
        </div>
      ) : (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="text-[12.5px] font-medium text-muted-foreground mb-2">{t('home.health.byStatus')}</div>
            <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-muted">
              {tot > 0 &&
                stEntries.filter((e) => e[1]).map(([k, n]) => <span key={k} className={STATUS_COLOR[k] ?? 'bg-foreground/20'} style={{ width: `${(n / tot) * 100}%` }} />)}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {stEntries.map(([k, n]) => (
                <li key={k} className="flex items-center gap-2 text-[13px]">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[k] ?? 'bg-foreground/20'}`} />
                  <span className="flex-1 truncate">{STATUS_KEYS.includes(k) ? t('fact.status.' + k) : k}</span>
                  <span className="mono text-muted-foreground">{fmtNum(n)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-[12.5px]">
              {[
                [t('home.attention.stale'), stats.needs_attention?.stale_active ?? 0],
                [t('home.attention.conflicts'), stats.open_conflicts],
                [t('home.health.pending'), stats.maintenance_pending],
              ].map(([l, v]) => (
                <div key={String(l)} className="min-w-0">
                  <dt className="text-muted-foreground truncate">{l}</dt>
                  <dd className="mono text-[14px] mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <div className="text-[12.5px] font-medium text-muted-foreground mb-2">{t('home.health.byType')}</div>
            <ul className="space-y-1.5">
              {tyEntries.map(([k, n]) => (
                <li key={k} className="grid grid-cols-[110px_1fr_32px] items-center gap-3 text-[13px]">
                  <span className="truncate">{TYPE_KEYS.includes(k) ? t('fact.type.' + k) : k}</span>
                  <span className="bar neutral">
                    <i style={{ width: `${(n / maxT) * 100}%` }} />
                  </span>
                  <span className="mono text-right text-muted-foreground">{fmtNum(n)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {children && <div className="border-t">{children}</div>}
    </div>
  )
}
