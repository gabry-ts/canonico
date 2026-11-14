import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { call, client, errMsg, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { usePerm } from '../../lib/perm'
import { nav } from '../../lib/router'
import { useApi } from '../../lib/useApi'
import { useApp } from '../../lib/store'
import { Ic } from '../../ui/Icon'
import { SRC_ICON } from '../../ui/srcIcon'
import { Empty, Skeleton } from '../../ui/overlays'
import { toast, toastError } from '../../ui/toast'
import { asList, CopyField, curlFor, ErrorBox, ITEM_ICON, runSync, SrcStatus, TagChip, tagSort, todayIso, useCopy, type Item, type Source } from './shared'

type Doc = Schemas['Document'] & { current_version?: number; version?: number }

/** Sources of a project, each row expands inline to its detail (recent items, configuration, actions). */
export function SourcesTable({
  pid,
  openId,
  onAdd,
  onItem,
}: {
  pid: string
  /** Source expanded on first render (route #/projects/<pid>/<sourceId>). */
  openId?: string | null
  onAdd?: () => void
  /** Click on a recent item. Default: go to the project page. */
  onItem?: (id: string) => void
}) {
  const { t, fmtWhen } = useI18n()
  const app = useApp()
  const { attrs, guard } = usePerm()
  const [open, setOpen] = useState<string | null>(openId ?? null)
  // A sidebar link to another source of the same project only changes the route: expand that row too.
  const [lastOpenId, setLastOpenId] = useState(openId)
  if (openId !== lastOpenId) {
    setLastOpenId(openId)
    if (openId) setOpen(openId)
  }
  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const st = useApi(() => call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: pid } } })).then((d) => asList<Source>(d)), [pid, app.version])
  const items = useApi(
    () => call(client.GET('/projects/{project_id}/items', { params: { path: { project_id: pid }, query: { limit: 200 } } })).then((d) => asList<Item>(d)),
    [pid, app.version],
  )
  const loaded = !!st.data
  useEffect(() => {
    if (!openId || !loaded) return
    const tm = setTimeout(() => document.getElementById(`xp-src-${openId}`)?.previousElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    return () => clearTimeout(tm)
  }, [openId, loaded])

  const sync = async (x: Source) => {
    setSyncing((s) => ({ ...s, [x.id]: true }))
    try {
      const job = await runSync(x.id)
      if (job.status === 'error') toastError(t('home.src.syncFailed', { label: x.label }))
      else toast(t('home.src.synced', { label: x.label, items: job.items_added ?? 0, facts: job.facts_created ?? 0 }))
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setSyncing((s) => ({ ...s, [x.id]: false }))
      await st.reload()
      void app.refresh()
    }
  }

  if (st.error && !st.data) return <ErrorBox message={st.error} onRetry={st.reload} />
  if (!st.data)
    return (
      <div className="p-5">
        <Skeleton rows={3} className="h-11" />
      </div>
    )
  const list = st.data
  if (!list.length)
    return (
      <Empty icon="sources" title={t('home.src.emptyTitle')}>
        {t('home.src.emptyText')}
        {onAdd && (
          <div>
            <button className="btn btn-primary btn-sm mt-4" {...attrs('manage_sources')} onClick={guard('manage_sources', onAdd)}>
              <Ic n="plus" className="sm" />
              {t('home.addSource')}
            </button>
          </div>
        )}
      </Empty>
    )
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('home.src.colSource')}</th>
            <th>{t('home.src.colStatus')}</th>
            <th className="text-right">{t('home.src.colItems')}</th>
            <th className="hidden md:table-cell">{t('home.src.colLastSync')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((x) => {
            const isOpen = open === x.id
            const status = syncing[x.id] ? 'syncing' : x.status
            return (
              <Fragment key={x.id}>
                <tr className={`hov ${isOpen ? 'xo' : ''}`} onClick={() => toggle(x.id)}>
                  <td>
                    <button
                      className="flex items-center gap-3 min-w-0 text-left rounded-md"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(x.id)
                      }}
                      aria-expanded={isOpen}
                      aria-controls={`xp-src-${x.id}`}
                    >
                      <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                        <Ic n={SRC_ICON[x.type] ?? 'doc'} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{x.label}</span>
                        <span className="block text-[12px] text-muted-foreground mono truncate">{x.id}</span>
                      </span>
                    </button>
                  </td>
                  <td>
                    <SrcStatus status={status} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <span className="mono">{x.items ?? 0}</span>{' '}
                    <span className="text-muted-foreground text-[12.5px]">{t('home.unit.' + x.type, { count: x.items ?? 0 })}</span>
                  </td>
                  <td className="mono text-[12.5px] text-muted-foreground whitespace-nowrap hidden md:table-cell">
                    {status === 'syncing' ? '…' : x.last_synced_at ? fmtWhen(x.last_synced_at) : t('home.src.never')}
                  </td>
                  <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {x.type !== 'webhook' && (
                      <button className="btn btn-ghost btn-sm" disabled={!!syncing[x.id]} {...attrs('manage_sources')} onClick={guard('manage_sources', () => void sync(x))}>
                        <Ic n="refresh" className="sm" />
                        {t('home.src.sync')}
                      </button>
                    )}
                    <button className="inline-grid place-items-center w-7 h-7 align-middle" aria-expanded={isOpen} onClick={() => toggle(x.id)} aria-label={x.label} tabIndex={-1}>
                      <Ic n="down" className="xchev" />
                    </button>
                  </td>
                </tr>
                <tr className={`xr ${isOpen ? 'open' : ''}`} id={`xp-src-${x.id}`} inert={!isOpen}>
                  <td colSpan={5}>
                    <div className="xp">
                      <div>
                        <div className="xbody px-4 sm:px-5 pt-2 pb-5">
                          {isOpen && (
                            <SourceDetail
                              x={x}
                              status={status}
                              items={(items.data ?? []).filter((i) => i.source_id === x.id)}
                              itemsLoading={!items.data && items.loading}
                              onSync={() => void sync(x)}
                              syncing={!!syncing[x.id]}
                              onRemoved={() => {
                                setOpen(null)
                                void st.reload()
                                void app.refresh()
                              }}
                              onItem={onItem ?? (() => nav('projects/' + pid))}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SourceDetail({
  x,
  status,
  items,
  itemsLoading,
  onSync,
  syncing,
  onRemoved,
  onItem,
}: {
  x: Source
  status: string
  items: Item[]
  itemsLoading: boolean
  onSync: () => void
  syncing: boolean
  onRemoved: () => void
  onItem: (id: string) => void
}) {
  const { t, fmtWhen, fmtDate } = useI18n()
  const { attrs, guard } = usePerm()
  const [tag, setTag] = useState('all')
  const [confirmRm, setConfirmRm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [last4, setLast4] = useState<string | null>(null)
  const isHook = x.type === 'webhook'

  const tags = [...new Set(items.flatMap((i) => i.tags ?? []))].sort(tagSort)
  const recent = items.filter((i) => tag === 'all' || (i.tags ?? []).includes(tag)).slice(0, 5)

  const remove = async () => {
    setBusy(true)
    try {
      await call(client.DELETE('/sources/{source_id}', { params: { path: { source_id: x.id } } }))
      toast(t('home.src.removed', { label: x.label }))
      onRemoved()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
      setConfirmRm(false)
    }
  }
  const rotate = async () => {
    setBusy(true)
    try {
      const r = await call(client.POST('/sources/{source_id}/rotate-secret', { params: { path: { source_id: x.id } } }))
      setSecret(r.secret)
      setLast4(r.secret_last4)
      toast(t('home.src.rotated'))
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const stat = (l: string, v: ReactNode) => (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{l}</div>
      <div className="mt-1 text-[14px] truncate">{v}</div>
    </div>
  )
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3">
        {stat(t('home.src.colStatus'), <SrcStatus status={status} />)}
        {stat(
          t('home.src.colLastSync'),
          <span className="mono text-[13px]">{status === 'syncing' ? t('home.src.inProgress') : x.last_synced_at ? fmtWhen(x.last_synced_at) : t('home.src.never')}</span>,
        )}
        {stat(
          t('home.src.colItems'),
          <>
            <span className="mono">{x.items ?? 0}</span> <span className="text-muted-foreground text-[12.5px]">{t('home.unit.' + x.type, { count: x.items ?? 0 })}</span>
          </>,
        )}
        {stat(t('home.src.type'), t('shell.sourceTypes.' + x.type))}
      </div>
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2 h-7">
            <h3 className="text-[13px] font-medium">{t('home.src.recentItems')}</h3>
            {tags.length > 0 && (
              <select className="input input-sm !w-auto !h-7 !text-[12.5px]" value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t('home.items.filterTag')}>
                <option value="all">{t('home.items.anyTag')}</option>
                {tags.map((tg) => (
                  <option key={tg} value={tg}>
                    {tg}
                  </option>
                ))}
              </select>
            )}
          </div>
          {itemsLoading ? (
            <Skeleton rows={2} className="h-12" />
          ) : recent.length ? (
            <ul className="rounded-[10px] bg-card shadow-[inset_0_0_0_1px_hsl(var(--border))] divide-y overflow-hidden">
              {recent.map((i) => (
                <li key={i.id}>
                  <button className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-accent/50 transition" onClick={() => onItem(i.id)}>
                    <span className="text-muted-foreground">
                      <Ic n={ITEM_ICON[i.type] ?? 'doc'} className="sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] truncate">{i.title}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(i.tags ?? []).slice(0, 3).map((tg) => (
                          <TagChip key={tg} tag={tg} />
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block mono text-[12px] text-muted-foreground">{fmtDate(i.date)}</span>
                      <span className="block text-[12px] text-muted-foreground">{t('home.items.facts', { count: i.facts_count })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-[10px] border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
              {items.length ? t('home.src.noTagItems') : isHook ? t('home.src.noHookItems') : x.type === 'documents' || x.type === 'document_library' ? t('home.src.docsHint') : t('home.src.noItems')}
            </div>
          )}
          {(x.type === 'documents' || x.type === 'document_library') && <SourceDocs sourceId={x.id} />}
        </div>
        <div className="lg:col-span-2 min-w-0">
          <div className="flex items-center mb-2 h-7">
            <h3 className="text-[13px] font-medium">{t('home.src.config')}</h3>
          </div>
          <SourceConfig x={x} secret={secret} last4={last4} onHideSecret={() => setSecret(null)} />
        </div>
      </div>
      <div className="mt-5 pt-4 border-t flex items-center gap-2 flex-wrap">
        {isHook ? (
          <button className="btn btn-outline btn-sm" aria-disabled="true" data-tip={t('home.src.hookNoSync')}>
            <Ic n="refresh" className="sm" />
            {t('home.src.syncNow')}
          </button>
        ) : (
          <button className="btn btn-outline btn-sm" disabled={syncing} {...attrs('manage_sources')} onClick={guard('manage_sources', onSync)}>
            <Ic n="refresh" className="sm" />
            {syncing ? t('home.status.syncing') : t('home.src.syncNow')}
          </button>
        )}
        {isHook && (
          <button className="btn btn-outline btn-sm" disabled={busy} {...attrs('manage_sources')} onClick={guard('manage_sources', () => void rotate())}>
            <Ic n="key" className="sm" />
            {t('home.src.rotate')}
          </button>
        )}
        <span className="flex-1" />
        {confirmRm ? (
          <>
            <span className="fade-in text-[13px] text-muted-foreground">{t('home.src.removeConfirm')}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRm(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={guard('manage_sources', () => void remove())}>
              {t('common.remove')}
            </button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm hover:!text-destructive" {...attrs('manage_sources')} onClick={guard('manage_sources', () => setConfirmRm(true))}>
            <Ic n="x" className="sm" />
            {t('common.remove')}
          </button>
        )}
      </div>
    </>
  )
}

/** Documents of a documents / library source, at their current version. */
function SourceDocs({ sourceId }: { sourceId: string }) {
  const { t, fmtDate } = useI18n()
  const { version } = useApp()
  const st = useApi(
    () => call(client.GET('/sources/{source_id}/documents', { params: { path: { source_id: sourceId } } })).then((d) => asList<Doc>(d)),
    [sourceId, version],
  )
  if (!st.data || !st.data.length) return null
  return (
    <>
      <h3 className="text-[13px] font-medium mt-4 mb-2">{t('home.src.documents', { count: st.data.length })}</h3>
      <ul className="rounded-[10px] bg-card shadow-[inset_0_0_0_1px_hsl(var(--border))] divide-y overflow-hidden">
        {st.data.slice(0, 6).map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-3.5 py-2 text-[13px]">
            <Ic n="doc" className="sm text-muted-foreground" />
            <span className="flex-1 min-w-0 truncate">{d.title}</span>
            {(d.current_version ?? d.version ?? 1) > 1 && <span className="badge line">v{d.current_version ?? d.version}</span>}
            <span className="mono text-[12px] text-muted-foreground">{fmtDate(d.date)}</span>
          </li>
        ))}
      </ul>
      {st.data.length > 6 && <div className="mt-1.5 text-[12px] text-muted-foreground">{t('home.src.moreDocs', { count: st.data.length - 6 })}</div>}
    </>
  )
}

function SourceConfig({ x, secret, last4, onHideSecret }: { x: Source; secret: string | null; last4: string | null; onHideSecret: () => void }) {
  const { t } = useI18n()
  const copy = useCopy()
  const cfg = (x.config ?? {}) as Record<string, unknown>
  const box = (inner: ReactNode) => <div className="rounded-[10px] bg-card shadow-[inset_0_0_0_1px_hsl(var(--border))] p-4">{inner}</div>
  const sub = (l: string) => <div className="mt-4 text-[12.5px] font-medium text-muted-foreground">{l}</div>
  if (x.type === 'github') {
    const inc = (cfg.include as string[] | undefined) ?? []
    return box(
      <>
        <dl className="kv !grid-cols-[88px_1fr]">
          <dt>{t('home.cfg.repository')}</dt>
          <dd className="mono text-[12.5px] truncate">{String(cfg.repo_url ?? x.label)}</dd>
          <dt>{t('home.cfg.access')}</dt>
          <dd>{t('home.cfg.publicNoKeys')}</dd>
        </dl>
        {sub(t('home.cfg.import'))}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {inc.length ? inc.map((k) => <span key={k} className="badge line">{t('home.gh.' + k)}</span>) : <span className="text-[13px] text-muted-foreground">{t('common.none')}</span>}
        </div>
      </>,
    )
  }
  if (x.type === 'mail')
    return box(
      <>
        <dl className="kv !grid-cols-[88px_1fr]">
          <dt>{t('home.cfg.mailbox')}</dt>
          <dd className="mono text-[12.5px] truncate">{String(cfg.mailbox ?? '')}</dd>
          <dt>{t('home.cfg.mode')}</dt>
          <dd className="mono text-[12.5px]">{String(cfg.mode ?? '')}</dd>
          <dt>{t('home.cfg.rules')}</dt>
          <dd className="mono text-[12.5px]">{((cfg.match_rules as string[] | undefined) ?? []).join(', ') || t('common.none')}</dd>
        </dl>
        <div className="mt-4">
          <a href="#/sources" className="btn btn-outline btn-xs">
            {t('home.cfg.routingRules')} <Ic n="arrow" className="sm" />
          </a>
        </div>
      </>,
    )
  if (x.type === 'document_library')
    return box(
      <dl className="kv !grid-cols-[88px_1fr]">
        <dt>{t('home.cfg.provider')}</dt>
        <dd>
          {t('home.cfg.localLibrary')} <span className="text-muted-foreground">· {t('home.cfg.cloudSoon')}</span>
        </dd>
        <dt>{t('home.cfg.path')}</dt>
        <dd className="mono text-[12.5px] truncate">{String(cfg.root_path ?? '')}</dd>
      </dl>,
    )
  if (x.type === 'webhook') {
    const url = String(cfg.url ?? '')
    const tags = (cfg.default_tags as string[] | undefined) ?? []
    return box(
      <>
        <div className="text-[12.5px] font-medium text-muted-foreground mb-1">{t('home.cfg.url')}</div>
        <div className="flex items-center gap-1">
          <span className="mono text-[12px] truncate flex-1 min-w-0" title={url}>
            {url}
          </span>
          <button className="btn btn-ghost btn-icon btn-sm shrink-0" onClick={() => copy(url)} aria-label={t('home.cfg.copyUrl')} data-tip={t('home.cfg.copyUrl')}>
            <Ic n="copy" className="sm" />
          </button>
        </div>
        {sub(t('home.cfg.secret'))}
        {secret ? (
          <>
            <div className="mt-1.5">
              <CopyField value={secret} />
            </div>
            <div className="help flex items-center gap-1.5 !text-warning-text">
              <Ic n="alert" className="sm" />
              {t('home.cfg.shownOnce')}
              <button className="link ml-auto" onClick={onHideSecret}>
                {t('home.cfg.done')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-1.5 text-[13px] mono">whsec_••••{last4 ?? String(cfg.secret_last4 ?? '')}</div>
            <div className="help !mt-1">{t('home.cfg.header')}</div>
          </>
        )}
        {sub(t('home.cfg.defaultTags'))}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.length ? tags.map((tg) => <TagChip key={tg} tag={tg} />) : <span className="text-[13px] text-muted-foreground">{t('common.none')}</span>}
        </div>
        <div className="mt-4">
          <button className="btn btn-ghost btn-xs" onClick={() => copy(curlFor(url, tags, '$CANONICO_SECRET', todayIso()))}>
            <Ic n="copy" className="sm" />
            {t('home.cfg.copyCurl')}
          </button>
        </div>
      </>,
    )
  }
  return box(
    <dl className="kv !grid-cols-[88px_1fr]">
      <dt>{t('home.cfg.formats')}</dt>
      <dd>{t('home.cfg.formatsList')}</dd>
      <dt>{t('home.cfg.upload')}</dt>
      <dd className="text-muted-foreground text-[13px]">{t('home.cfg.uploadHint')}</dd>
    </dl>,
  )
}
