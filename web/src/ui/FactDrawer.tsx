import { useMemo, useRef, useState } from 'react'
import { ApiError, call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { bindingOf, docLabel, factState, heldByPin } from '../lib/facts'
import { usePerm } from '../lib/perm'
import { nav } from '../lib/router'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { latestEvent, members, NO_FILTERS, runAction, setFilters, undoEvent, type ActKind } from '../screens/memory/api'
import { Avatar, Ic } from './Icon'
import { Drawer, Empty, Skeleton } from './overlays'
import { toast, toastError } from './toast'

type ChainFact = Schemas['TopicChain']['facts'][number]
type Act = { kind: ActKind; value: string; reason: string; err?: boolean; errValue?: boolean; busy?: boolean }

const PERM: Record<ActKind, string> = {
  retire: 'retire_fact',
  restore: 'restore_fact',
  correct: 'correct_fact',
  pin: 'correct_fact',
  unpin: 'correct_fact',
}

/** Fact detail drawer, opened from anywhere with useApp().openFact(id). */
export default function FactDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp()
  const { t, fmtDate, fmtWhen, fmtPct } = useI18n()
  const perm = usePerm()
  const [act, setAct] = useState<Act | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)

  const fact = useApi(() => call(client.GET('/facts/{fact_id}', { params: { path: { fact_id: id } } })), [id, app.version])
  const topicId = fact.data?.id === id ? fact.data.topic : null
  const chain = useApi(
    topicId ? () => call(client.GET('/topics/{topic_id}/chain', { params: { path: { topic_id: topicId } } })) : null,
    [topicId, app.version],
  )
  const history = useApi(() => call(client.GET('/facts/{fact_id}/history', { params: { path: { fact_id: id } } })), [id, app.version])
  const audit = useApi(async () => {
    const r = await call(client.GET('/audit', { params: { query: { fact_id: id, limit: 50 } } }))
    return Array.isArray(r) ? (r as Schemas['AuditEvent'][]) : ((r as { items?: Schemas['AuditEvent'][] }).items ?? [])
  }, [id, app.version])
  const deps = useApi(() => call(client.GET('/facts/{fact_id}/dependents', { params: { path: { fact_id: id } } })), [id, app.version])
  const mems = useApi(() => members(), [])

  const nameOf = (actor: string | null | undefined) => {
    if (!actor || actor === 'system') return t('memory.drawer.system')
    return mems.data?.find((m) => m.id === actor)?.name ?? actor
  }

  const f = fact.data && fact.data.id === id ? fact.data : undefined
  const chainFacts: ChainFact[] = useMemo(() => {
    const l = chain.data && f && chain.data.topic.id === f.topic ? [...chain.data.facts] : f ? [f] : []
    if (f && !l.some((x) => x.id === f.id)) l.push(f)
    return l.map((x) => (f && x.id === f.id ? { ...x, ...f } : x)).sort((a, b) => a.date.localeCompare(b.date))
  }, [chain.data, f])
  const binding = useMemo(() => bindingOf(chainFacts), [chainFacts])
  const held = useMemo(() => heldByPin(chainFacts, binding), [chainFacts, binding])

  const close = onClose

  if (!f) {
    return (
      <Drawer onClose={close} label={t('memory.drawer.label', { id })}>
        <header className="shrink-0 h-[52px] px-5 border-b flex items-center gap-2.5">
          <span className="mono text-[12.5px] text-muted-foreground">{id}</span>
          <span className="flex-1" />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={close} aria-label={t('common.close')}>
            <Ic n="x" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto scroll px-5 py-5">
          {fact.error ? (
            <Empty icon="alert" title={t('memory.drawer.notFound')}>
              {fact.error}
              <div className="mt-4">
                <button className="btn btn-outline btn-sm" onClick={() => void fact.reload()}>
                  {t('common.retry')}
                </button>
              </div>
            </Empty>
          ) : (
            <Skeleton rows={5} className="h-8" />
          )}
        </div>
      </Drawer>
    )
  }

  const st = factState(f, binding, held)
  const isRet = f.status === 'retired'
  const topicLabel = chain.data?.topic.label ?? f.topic
  const docTitle = chainFacts.find((x) => x.id === f.id)?.doc_title
  const otherPins = chainFacts.filter((x) => x.pinned && x.id !== f.id && x.status === 'active')
  const pinList = otherPins.map((x) => x.value).join(', ')

  // "Changed because…"
  const events = audit.data ?? []
  const lastOf = (a: string) => events.find((e) => e.action === a)
  let changed = ''
  if (isRet) {
    const when = f.retired_at ? fmtWhen(f.retired_at) : ''
    const name = nameOf(f.retired_by)
    changed = f.retired_reason
      ? t('memory.drawer.retiredByReason', { name, when, reason: f.retired_reason })
      : t('memory.drawer.retiredBy', { name, when })
  } else {
    const patch = (history.data ?? []).filter((h) => h.action === 'patch' && h.changes.value).sort((a, b) => b.version - a.version)[0]
    if (patch) {
      const ev = lastOf('patch')
      changed = t('memory.drawer.corrected', { name: nameOf(patch.actor), was: String(patch.changes.value.from ?? '') }) + (ev?.reason ? ' ' + ev.reason : '')
    } else if (f.pinned) {
      const ev = lastOf('pin')
      changed = t('memory.drawer.pinnedBy', { name: nameOf(ev?.actor) }) + (ev?.reason ? ' ' + ev.reason : '')
    }
  }

  const startAct = (kind: ActKind) => {
    setAct({ kind, value: f.value, reason: '' })
    setTimeout(() => (kind === 'correct' ? valueRef.current : reasonRef.current)?.focus(), 20)
  }

  const confirm = async () => {
    if (!act) return
    const reason = act.reason.trim()
    const value = act.value.trim()
    const needReason = act.kind !== 'restore'
    const err = needReason && !reason
    const errValue = act.kind === 'correct' && !value
    if (err || errValue) {
      setAct({ ...act, err, errValue })
      return
    }
    if (!perm.can(PERM[act.kind])) {
      perm.guard(PERM[act.kind], () => {})()
      return
    }
    setAct({ ...act, busy: true, err: false, errValue: false })
    try {
      await runAction(act.kind, f.id, app.actor, reason, value)
      const kind = act.kind
      setAct(null)
      await app.refresh()
      const msg =
        kind === 'pin' && pinList ? t('memory.act.pinDoneReplaced', { list: pinList }) : t(`memory.act.${kind}Done`)
      const eid = await latestEvent(f.id)
      toast(msg, {
        long: true,
        action: eid
          ? {
              label: t('common.undo'),
              run: () => {
                undoEvent(eid, app.actor, t('memory.act.undoReason'))
                  .then(async () => {
                    await app.refresh()
                    toast(t('memory.act.undone'), { icon: 'undo' })
                  })
                  .catch((e) => toastError(t('common.actionError', { message: errMsg(e) })))
              },
            }
          : undefined,
      })
    } catch (e) {
      setAct((a) => (a ? { ...a, busy: false } : a))
      toastError(e instanceof ApiError && e.status === 409 ? e.message : t('common.actionError', { message: errMsg(e) }))
    }
  }

  const goTopic = () => {
    setFilters({ ...NO_FILTERS, topic: f.topic })
    close()
    nav('memory')
  }
  const goTag = (tag: string) => {
    setFilters({ ...NO_FILTERS, tag })
    close()
    nav('memory')
  }

  const actionPanel = act && (
    <div className="fade-in rounded-[12px] bg-muted/50 shadow-[inset_0_0_0_1px_hsl(var(--border))] p-4 mt-4">
      <div className="font-medium text-[14px]">{t(`memory.act.${act.kind}Title`)}</div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{t(`memory.act.${act.kind}Help`)}</p>
      {act.kind === 'pin' && pinList && <p className="mt-2 text-[13px] font-medium">{t('memory.act.replacesPin', { list: pinList })}</p>}
      {act.kind === 'correct' && (
        <>
          <label className="label mt-3" htmlFor="actValue">
            {t('memory.act.value')}
          </label>
          <input
            id="actValue"
            ref={valueRef}
            className={'input ' + (act.errValue ? 'invalid' : '')}
            value={act.value}
            onChange={(e) => setAct({ ...act, value: e.target.value, errValue: false })}
          />
          {act.errValue && (
            <div className="err">
              <Ic n="alert" className="sm" />
              {t('memory.act.valueErr')}
            </div>
          )}
        </>
      )}
      <label className="label mt-3" htmlFor="actReason">
        {act.kind === 'restore' ? t('memory.act.reasonOptional') : t('memory.act.reason')}
      </label>
      <textarea
        id="actReason"
        ref={reasonRef}
        className={'input ' + (act.err ? 'invalid' : '')}
        placeholder={t('memory.act.reasonPlaceholder')}
        value={act.reason}
        onChange={(e) => setAct({ ...act, reason: e.target.value, err: false })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void confirm()
        }}
      />
      {act.err && (
        <div className="err">
          <Ic n="alert" className="sm" />
          {t('memory.act.reasonErr')}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={() => setAct(null)}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void confirm()} disabled={act.busy} {...perm.attrs(PERM[act.kind])}>
          {t(`memory.act.${act.kind}Btn`)}
        </button>
      </div>
    </div>
  )

  const hist = [...(history.data ?? [])].sort((a, b) => b.version - a.version)
  const usedEvents = new Set<string>()
  const reasonFor = (action: string, at: string) => {
    const ev =
      events.find((e) => !usedEvents.has(e.id) && e.action === action && e.at === at) ??
      events.find((e) => !usedEvents.has(e.id) && e.action === action)
    if (!ev) return null
    usedEvents.add(ev.id)
    return ev.reason
  }

  const d = deps.data
  const depCount = d ? d.facts.length + d.conflicts.length + d.answers.length : 0

  return (
    <Drawer onClose={close} label={t('memory.drawer.label', { id })}>
      <header className="shrink-0 h-[52px] px-5 border-b flex items-center gap-2.5">
        <span className="mono text-[12.5px] text-muted-foreground">{f.id}</span>
        <span className={'badge ' + st.cls}>{t(st.label)}</span>
        <span className="text-[12.5px] text-muted-foreground">{t('fact.type.' + f.type)}</span>
        <span className="flex-1" />
        <a href={'#/memory/' + encodeURIComponent(f.id)} className="btn btn-ghost btn-sm" data-tip={t('memory.drawer.openInMemory')} aria-label={t('memory.drawer.openInMemory')}>
          <Ic n="memory" className="sm" />
        </a>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={close} aria-label={t('common.close')}>
          <Ic n="x" />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scroll px-5 py-5">
        <button className="text-[12.5px] text-muted-foreground hover:text-foreground" onClick={goTopic}>
          {topicLabel}
        </button>
        <h2 className={'mt-1 text-[19px] font-semibold tracking-tight leading-snug ' + (st.dim ? 'strike' : '')}>{f.value}</h2>
        {changed && (
          <div className="mt-4 flex gap-2.5 rounded-[10px] bg-muted/60 px-3.5 py-2.5 text-[13px] leading-relaxed">
            <span className="mt-0.5 text-muted-foreground">
              <Ic n="changed" className="sm" />
            </span>
            <div>
              <span className="font-medium">{t('memory.drawer.changed')}</span> <span className="text-muted-foreground">{changed}</span>
            </div>
          </div>
        )}
        <blockquote className={'quote mt-4 ' + (st.key === 'binding' ? 'binding' : '')}>“{f.quote}”</blockquote>
        <dl className="kv mt-5">
          <dt>{t('fact.source')}</dt>
          <dd className="break-words">
            <span>{docTitle || docLabel(f.doc_id)}</span> <span className="text-muted-foreground">·</span>{' '}
            <span className="mono text-[12.5px] break-all">{f.doc_id}</span>
          </dd>
          <dt>{t('fact.date')}</dt>
          <dd className="mono text-[13px]">{fmtDate(f.date)}</dd>
          <dt>{t('memory.drawer.confidence')}</dt>
          <dd className="mono text-[13px]">{fmtPct(f.confidence)}</dd>
          <dt>{t('memory.drawer.tags')}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {f.tags && f.tags.length ? (
              f.tags.map((tg) => (
                <button key={tg} className={'tag ' + (tg.startsWith('topic:') ? 'topic' : '')} data-tip={t('memory.drawer.tagTip')} onClick={() => goTag(tg)}>
                  {tg}
                </button>
              ))
            ) : (
              <span className="text-muted-foreground text-[13px]">{t('memory.drawer.noTags')}</span>
            )}
          </dd>
          {f.superseded_by && (
            <>
              <dt>{t('memory.drawer.replacedBy')}</dt>
              <dd>
                <button className="link !font-normal text-left" onClick={() => app.openFact(f.superseded_by!)}>
                  {chainFacts.find((x) => x.id === f.superseded_by)?.value ?? f.superseded_by}
                </button>
              </dd>
            </>
          )}
          {f.supersedes && (
            <>
              <dt>{t('memory.drawer.replaces')}</dt>
              <dd>
                <button className="link !font-normal text-left" onClick={() => app.openFact(f.supersedes!)}>
                  {chainFacts.find((x) => x.id === f.supersedes)?.value ?? f.supersedes}
                </button>
              </dd>
            </>
          )}
        </dl>

        <div className="mt-5 flex items-center gap-1.5 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={() => perm.guard('correct_fact', () => startAct('correct'))()} {...perm.attrs('correct_fact')}>
            <Ic n="edit" className="sm" />
            {t('memory.drawer.correct')}
          </button>
          {isRet ? (
            <button className="btn btn-outline btn-sm" onClick={() => perm.guard('restore_fact', () => startAct('restore'))()} {...perm.attrs('restore_fact')}>
              <Ic n="restore" className="sm" />
              {t('memory.drawer.restore')}
            </button>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => perm.guard('retire_fact', () => startAct('retire'))()} {...perm.attrs('retire_fact')}>
              <Ic n="retire" className="sm" />
              {t('memory.drawer.retire')}
            </button>
          )}
          {isRet ? (
            <button className="btn btn-outline btn-sm" aria-disabled="true" data-tip={t('memory.drawer.pinRetired')} onClick={() => toast(t('memory.drawer.pinRetired'), { icon: 'lock' })}>
              <Ic n="pin" className="sm" />
              {t('memory.drawer.pin')}
            </button>
          ) : (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => perm.guard('correct_fact', () => startAct(f.pinned ? 'unpin' : 'pin'))()}
              {...perm.attrs('correct_fact')}
            >
              <Ic n="pin" className="sm" />
              {f.pinned ? t('memory.drawer.unpin') : t('memory.drawer.pin')}
            </button>
          )}
        </div>
        {actionPanel}

        <h3 className="mt-7 mb-3 text-[13px] font-medium flex items-center justify-between">
          {t('memory.drawer.timeline')}
          <span className="text-[12px] font-normal text-muted-foreground">{t('memory.drawer.oldestFirst', { topic: topicLabel })}</span>
        </h3>
        {chain.loading && !chain.data ? (
          <Skeleton rows={3} className="h-12" />
        ) : (
          <div className="vt">
            {chainFacts.map((x) => {
              const xs = factState(x, binding, held)
              const cur = x.id === f.id
              const inner = (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className={'text-[13.5px] truncate ' + (xs.dim ? 'strike' : 'font-medium')}>{x.value}</span>
                    <span className={'badge ' + xs.cls}>{t(xs.label)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    <span className="mono">{fmtDate(x.date)}</span> · {x.doc_title || docLabel(x.doc_id)}
                    {cur ? ' · ' + t('memory.drawer.thisFact') : ''}
                  </div>
                </>
              )
              return (
                <div key={x.id} className={`vt-item ${xs.key === 'binding' ? 'binding' : xs.key === 'conflict' ? 'conflict' : ''} ${cur ? 'current' : ''}`}>
                  <span className="vt-dot" />
                  {cur ? (
                    <div className="vt-card">{inner}</div>
                  ) : (
                    <button className="vt-card" onClick={() => app.openFact(x.id)}>
                      {inner}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {depCount > 0 && d && (
          <>
            <h3 className="mt-7 mb-1 text-[13px] font-medium">{t('memory.drawer.dependents')}</h3>
            <div className="-mx-3">
              {d.facts.map((x) => (
                <button key={x.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent text-left" onClick={() => app.openFact(x.id)}>
                  <span className="text-[12px] text-muted-foreground w-24 shrink-0">{t('memory.drawer.depFact')}</span>
                  <span className="flex-1 truncate text-[13.5px]">{x.value}</span>
                  <span className="mono text-[11.5px] text-muted-foreground">{x.id}</span>
                </button>
              ))}
              {d.conflicts.map((c) => (
                <a key={c} href="#/conflicts" onClick={close} className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent">
                  <span className="text-[12px] text-muted-foreground w-24 shrink-0">{t('memory.drawer.depConflict')}</span>
                  <span className="flex-1 truncate text-[13.5px]">{c}</span>
                  <span className="mono text-[11.5px] text-muted-foreground">{c}</span>
                </a>
              ))}
              {d.answers.map((a) => (
                <div key={a.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-md">
                  <span className="text-[12px] text-muted-foreground w-24 shrink-0">{t('memory.drawer.depAnswer')}</span>
                  <span className="flex-1 truncate text-[13.5px]">{a.question}</span>
                  <span className="mono text-[11.5px] text-muted-foreground">{fmtWhen(a.asked_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <h3 className="mt-7 mb-1 text-[13px] font-medium">{t('memory.drawer.history')}</h3>
        {history.loading && !history.data ? (
          <Skeleton rows={2} className="h-8" />
        ) : hist.length ? (
          <ul className="divide-y">
            {hist.map((h) => {
              const reason = reasonFor(h.action, h.at)
              const nm = h.actor === 'system' ? null : nameOf(h.actor)
              return (
                <li key={h.version} className="flex gap-3 py-2">
                  <span className="mt-0.5">
                    <Avatar name={nm} />
                  </span>
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div>
                      <span className="font-medium">{nm ?? t('memory.drawer.system')}</span>{' '}
                      <span className="text-muted-foreground">{t('memory.action.' + h.action)}</span>{' '}
                      <span className="mono text-[12px] text-muted-foreground">· {fmtWhen(h.at)}</span>
                    </div>
                    {reason && <div className="text-muted-foreground mt-0.5">{reason}</div>}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground py-2">{t('memory.drawer.noHistory')}</p>
        )}
      </div>
    </Drawer>
  )
}

