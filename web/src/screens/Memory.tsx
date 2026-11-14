import { useEffect, useMemo, useRef, useState } from 'react'
import { call, client, errMsg } from '../api/client'
import { useI18n } from '../i18n'
import { docLabel, type Fact } from '../lib/facts'
import { nav, useRoute } from '../lib/router'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { TopbarActions } from '../shell/Topbar'
import { Ic } from '../ui/Icon'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { downloadExport, fetchAllFacts, NO_FILTERS, setFilters, statesOf, useFilters } from './memory/api'

const TYPES = ['DECISION', 'CONSTRAINT', 'EVIDENCE', 'HYPOTHESIS', 'OPEN', 'SUPERSEDED'] as const
const STATUSES: [string, string][] = [
  ['binding', 'fact.status.binding'],
  ['active', 'fact.status.active'],
  ['conflict', 'memory.statusConflict'],
  ['open', 'fact.status.open'],
  ['superseded', 'fact.status.superseded'],
  ['held', 'fact.status.held'],
  ['retired', 'fact.status.retired'],
]
const PAGE = 120

/** Source icon from a document id. */
function srcIcon(docId: string) {
  if (docId.startsWith('library/')) return 'library'
  if (/email|external-comms|internal-comms/.test(docId)) return 'mail'
  if (docId.startsWith('upload') || docId.startsWith('internal/')) return 'upload'
  return 'doc'
}

function ExportButton() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        downloadExport()
          .then((n) => toast(t('memory.exported', { count: n })))
          .catch((e) => toastError(t('common.actionError', { message: errMsg(e) })))
          .finally(() => setBusy(false))
      }}
    >
      <Ic n="archive" className="sm" />
      {t('memory.export')}
    </button>
  )
}

export default function Memory() {
  const app = useApp()
  const { t, fmtDate } = useI18n()
  const { sub } = useRoute()
  const m = useFilters()
  const [limit, setLimit] = useState(PAGE)
  const [q, setQ] = useState(m.q)

  // #/memory/<factId> opens the drawer; closing it returns to #/memory.
  const opened = useRef<string | null>(null)
  const prevFact = useRef<string | null>(app.factId)
  useEffect(() => {
    if (sub) {
      opened.current = sub
      app.openFact(sub)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub])
  useEffect(() => {
    if (prevFact.current && !app.factId && opened.current && sub === opened.current) {
      opened.current = null
      nav('memory')
    }
    prevFact.current = app.factId
  }, [app.factId, sub])

  // debounce the search box into the shared filters
  useEffect(() => {
    if (q === m.q) return
    const h = setTimeout(() => setFilters({ q }), 220)
    return () => clearTimeout(h)
  }, [q, m.q])
  useEffect(() => setQ(m.q), [m.q])
  useEffect(() => setLimit(PAGE), [m])

  const facts = useApi(() => fetchAllFacts(app.pid), [app.pid, app.version])
  const topics = useApi(() => call(client.GET('/topics', { params: { query: { project_id: app.pid } } })), [app.pid, app.version])
  const tags = useApi(() => call(client.GET('/tags', { params: { query: { project_id: app.pid } } })), [app.pid, app.version])
  const qs = m.q.trim()
  const search = useApi(
    qs
      ? () =>
          call(client.GET('/search', { params: { query: { q: qs, kind: 'fact', project_id: app.pid, limit: 500 } } })).then(
            (r) => new Set(r.results.filter((x) => x.kind === 'fact').map((x) => x.id)),
          )
      : null,
    [qs, app.pid, app.version],
  )
  const tagged = useApi(
    m.tag !== 'all'
      ? () =>
          fetchTagged(app.pid, m.tag).then((ids) => new Set(ids))
      : null,
    [m.tag, app.pid, app.version],
  )

  const all = useMemo(() => facts.data ?? [], [facts.data])
  const states = useMemo(() => statesOf(all), [all])
  const topicLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const tp of topics.data ?? []) map.set(tp.id, tp.label)
    return (id: string) => map.get(id) ?? id
  }, [topics.data])
  const topicCounts = useMemo(() => {
    const c = new Map<string, number>()
    for (const f of all) c.set(f.topic, (c.get(f.topic) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => topicLabel(a[0]).localeCompare(topicLabel(b[0])))
  }, [all, topicLabel])

  const matches = useMemo(() => {
    const ql = qs.toLowerCase()
    const list = all.filter((f) => {
      if (m.topic !== 'all' && f.topic !== m.topic) return false
      if (m.type !== 'all' && f.type !== m.type) return false
      if (m.status !== 'all' && states.get(f.id)?.key !== m.status) return false
      if (m.tag !== 'all') {
        if (tagged.data ? !tagged.data.has(f.id) : !(f.tags ?? []).includes(m.tag)) return false
      }
      if (ql) {
        const hit = search.data?.has(f.id) || f.id.toLowerCase() === ql || (f.value + ' ' + f.quote + ' ' + f.doc_id + ' ' + f.id).toLowerCase().includes(ql)
        if (!hit) return false
      }
      return true
    })
    if (!ql) return list
    // Facts that contain the exact phrase come before looser search matches (sort is stable).
    const exact = (f: Fact) => ((f.value + ' ' + f.quote).toLowerCase().includes(ql) ? 0 : 1)
    return list.sort((a, b) => exact(a) - exact(b))
  }, [all, m, qs, states, search.data, tagged.data])

  const groups = useMemo(() => {
    const shown = matches.slice(0, limit)
    const g = new Map<string, Fact[]>()
    for (const f of shown) {
      const l = g.get(f.topic)
      if (l) l.push(f)
      else g.set(f.topic, [f])
    }
    return [...g.entries()]
  }, [matches, limit])

  const filtered = !!(m.q || m.type !== 'all' || m.status !== 'all' || m.topic !== 'all' || m.tag !== 'all')
  const clear = () => {
    setQ('')
    setFilters(NO_FILTERS)
  }
  const sel = 'input input-sm !w-auto !h-9'

  return (
    <div className="h-full flex min-h-0">
      <TopbarActions>
        <ExportButton />
      </TopbarActions>
      <aside className="hidden xl:block w-[232px] shrink-0 border-r overflow-y-auto scroll px-3 py-5">
        <div className="nav-label">{t('memory.topics')}</div>
        <button className={'nav-item ' + (m.topic === 'all' ? 'on' : '')} onClick={() => setFilters({ topic: 'all' })}>
          <span className="flex-1 text-left">{t('memory.allTopics')}</span>
          <span className="mono text-[11.5px] text-muted-foreground">{all.length}</span>
        </button>
        {topicCounts.map(([id, n]) => (
          <button key={id} className={'nav-item ' + (m.topic === id ? 'on' : '')} onClick={() => setFilters({ topic: id })}>
            <span className="flex-1 truncate text-left">{topicLabel(id)}</span>
            <span className="mono text-[11.5px] text-muted-foreground">{n}</span>
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto scroll">
        <div className="max-w-[1080px] mx-auto px-6 py-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="page-title">{t('memory.title')}</h1>
              <p className="page-sub">{t('memory.sub')}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Ic n="search" className="sm" />
              </span>
              <input
                className="input !pl-9"
                placeholder={t('memory.searchPlaceholder')}
                aria-label={t('memory.searchLabel')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setFilters({ q })
                  if (e.key === 'Escape' && q) {
                    e.stopPropagation()
                    clear()
                  }
                }}
              />
            </div>
            <select className={sel} aria-label={t('memory.typeLabel')} value={m.type} onChange={(e) => setFilters({ type: e.target.value })}>
              <option value="all">{t('memory.allTypes')}</option>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t('fact.type.' + ty)}
                </option>
              ))}
            </select>
            <select className={sel} aria-label={t('memory.statusLabel')} value={m.status} onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="all">{t('memory.anyStatus')}</option>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {t(l)}
                </option>
              ))}
            </select>
            <select className={sel + ' max-w-[220px]'} aria-label={t('memory.tagLabel')} value={m.tag} onChange={(e) => setFilters({ tag: e.target.value })}>
              <option value="all">{t('memory.anyTag')}</option>
              {m.tag !== 'all' && !(tags.data ?? []).some((x) => x.tag === m.tag) && <option value={m.tag}>{m.tag}</option>}
              {(tags.data ?? []).map((x) => (
                <option key={x.tag} value={x.tag}>
                  {x.tag} · {x.count}
                </option>
              ))}
            </select>
            <select className={sel + ' xl:hidden max-w-[220px]'} aria-label={t('memory.topicLabel')} value={m.topic} onChange={(e) => setFilters({ topic: e.target.value })}>
              <option value="all">{t('memory.allTopics')}</option>
              {topicCounts.map(([id]) => (
                <option key={id} value={id}>
                  {topicLabel(id)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 mb-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="mono">{t('memory.shown', { shown: matches.length, total: all.length })}</span>
            <span>{t('memory.factsShown')}</span>
            {qs && search.loading && <span>· {t('memory.searching')}</span>}
            {filtered && (
              <button className="link !text-[12.5px] ml-1" onClick={clear}>
                {t('memory.clearFilters')}
              </button>
            )}
          </div>

          <div className="space-y-4 pb-8">
            {facts.loading && !facts.data ? (
              <div className="card p-4">
                <Skeleton rows={8} className="h-12" />
              </div>
            ) : facts.error && !facts.data ? (
              <div className="card">
                <Empty icon="alert" title={t('common.errorTitle')}>
                  {t('common.loadError', { message: facts.error })}
                  <div className="mt-4">
                    <button className="btn btn-outline btn-sm" onClick={() => void facts.reload()}>
                      {t('common.retry')}
                    </button>
                  </div>
                </Empty>
              </div>
            ) : !matches.length ? (
              <div className="card px-6 py-14 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-muted grid place-items-center text-muted-foreground">
                  <Ic n="search" />
                </div>
                <div className="mt-3 font-medium">{qs ? t('memory.noMatchQ', { q: qs }) : t('memory.noMatch')}</div>
                <p className="mt-1 text-[13.5px] text-muted-foreground">{t('memory.noMatchHelp')}</p>
                {filtered && (
                  <button className="btn btn-outline btn-sm mt-4" onClick={clear}>
                    {t('memory.clearAll')}
                  </button>
                )}
              </div>
            ) : (
              <>
                {groups.map(([topic, list]) => (
                  <section key={topic} className="card overflow-hidden">
                    <header className="flex items-center gap-3 px-4 h-10 border-b bg-muted/40">
                      <button className="text-[13px] font-medium hover:underline underline-offset-4 truncate" onClick={() => setFilters({ topic })}>
                        {topicLabel(topic)}
                      </button>
                      <span className="mono text-[11.5px] text-muted-foreground truncate">{topic}</span>
                      <span className="flex-1" />
                      <span className="text-[12px] text-muted-foreground shrink-0">{t('memory.factCount', { count: list.length })}</span>
                    </header>
                    {list.map((f) => {
                      const st = states.get(f.id)!
                      const on = app.factId === f.id
                      return (
                        <button
                          key={f.id}
                          className={'w-full text-left flex items-start gap-4 px-4 py-3 border-b last:border-b-0 transition ' + (on ? 'bg-accent' : 'hover:bg-accent/50')}
                          onClick={() => app.openFact(f.id)}
                        >
                          <span className="mt-0.5 text-muted-foreground">
                            <Ic n={srcIcon(f.doc_id)} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={'block text-[14.5px] leading-snug ' + (st.dim ? 'strike' : st.key === 'binding' ? 'font-medium' : '')}>{f.value}</span>
                            <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground min-w-0">
                              <span className="truncate">{docLabel(f.doc_id)}</span>
                              <span>·</span>
                              <span className="mono shrink-0">{fmtDate(f.date)}</span>
                            </span>
                            {f.tags && f.tags.length > 0 && (
                              <span className="mt-1.5 flex flex-wrap gap-1">
                                {f.tags.map((tg) => (
                                  <span key={tg} className={'tag ' + (tg.startsWith('topic:') ? 'topic' : '')}>
                                    {tg}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          <span className="hidden md:inline text-[12.5px] text-muted-foreground w-[92px] shrink-0 pt-0.5">{t('fact.type.' + f.type)}</span>
                          <span className="w-[118px] shrink-0 flex justify-end pt-px">
                            <span className={'badge ' + st.cls}>{t(st.label)}</span>
                          </span>
                          <span className="mono text-[11.5px] text-muted-foreground w-[52px] text-right shrink-0 pt-1">{f.id}</span>
                        </button>
                      )
                    })}
                  </section>
                ))}
                {matches.length > limit && (
                  <div className="text-center">
                    <button className="btn btn-outline btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                      {t('memory.showMore', { count: Math.min(PAGE, matches.length - limit) })}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Fact ids carrying a tag (GET /facts?tag=, server-side). */
async function fetchTagged(pid: string | undefined, tag: string): Promise<string[]> {
  const out: string[] = []
  let offset = 0
  for (;;) {
    const page = await call(client.GET('/facts', { params: { query: { project_id: pid, tag, limit: 500, offset } } }))
    out.push(...page.items.map((f) => f.id))
    offset += page.items.length
    if (!page.items.length || offset >= page.total) break
  }
  return out
}
