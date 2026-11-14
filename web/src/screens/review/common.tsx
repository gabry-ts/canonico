import { useEffect, useState, type ReactNode } from 'react'
import { call, client, errMsg, type Schemas } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useApp } from '../../lib/store'
import { useI18n } from '../../i18n'
import { docLabel, factState, type Fact } from '../../lib/facts'
import { Dialog } from '../../ui/overlays'
import { Ic } from '../../ui/Icon'
import { toast, toastError } from '../../ui/toast'

export type AuditEvent = Schemas['AuditEvent']

export function PageShell({ title, sub, tabs, children, max = 1120 }: { title: string; sub: string; tabs: ReactNode; children: ReactNode; max?: number }) {
  return (
    <div className="h-full overflow-y-auto scroll">
      <div className="mx-auto px-6 py-6 pb-12" style={{ maxWidth: max }}>
        <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
          <div className="min-w-0">
            <h1 className="page-title">{title}</h1>
            <p className="page-sub">{sub}</p>
          </div>
          {tabs}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Tabs({ value, onChange, items }: { value: string; onChange: (k: never) => void; items: [string, string, number | undefined][] }) {
  return (
    <div className="seg" role="tablist">
      {items.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => (onChange as (k: string) => void)(k)}>
          {label}
          {n !== undefined && <span className="mono text-[11px] text-muted-foreground">{n}</span>}
        </button>
      ))}
    </div>
  )
}

/** Topic id -> label for the current scope. */
export function useTopicNames() {
  const { pid, version } = useApp()
  const { data } = useApi(() => call(client.GET('/topics', { params: { query: { project_id: pid } } })), [pid, version])
  return (id: string) => data?.find((x) => x.id === id)?.label || id.replace(/-/g, ' ')
}

/** Member id -> display name. */
export function useMembers() {
  const { data } = useApi(() => call(client.GET('/org/members', {})), [])
  const items = ((data as { items?: { id: string; name: string }[] } | undefined)?.items ?? []) as { id: string; name: string }[]
  return (id: string) => (id === 'system' ? null : (items.find((m) => m.id === id)?.name ?? id))
}

const factCache = new Map<string, Promise<Fact>>()
/** Lazy single-fact lookup (cached per data version). */
export function useFact(id: string | null | undefined) {
  const { version } = useApp()
  const [fact, setFact] = useState<Fact | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    const key = version + ':' + id
    let p = factCache.get(key)
    if (!p) {
      p = call(client.GET('/facts/{fact_id}', { params: { path: { fact_id: id } } })) as Promise<Fact>
      factCache.set(key, p)
    }
    p.then((f) => live && setFact(f)).catch(() => factCache.delete(key))
    return () => {
      live = false
    }
  }, [id, version])
  return fact
}

/** Side-by-side fact card with quote and source (prototype sideCard). */
export function FactCard({ fact, win, lose, binding, button }: { fact: Fact; win?: boolean; lose?: boolean; binding?: boolean; button?: ReactNode }) {
  const { t, fmtDate } = useI18n()
  const { openFact } = useApp()
  const st = factState(fact, binding ? fact : null)
  const cls = win
    ? 'shadow-[inset_0_0_0_1.5px_hsl(var(--primary))] bg-primary-soft/50'
    : lose
      ? 'shadow-[inset_0_0_0_1px_hsl(var(--border))] opacity-80'
      : 'shadow-[inset_0_0_0_1px_hsl(var(--border))]'
  return (
    <div className={'rounded-[12px] p-4 flex flex-col min-w-0 ' + cls}>
      <div className="flex items-start justify-between gap-3">
        <button className="text-left min-w-0" onClick={() => openFact(fact.id)}>
          <div className={'text-[16px] font-semibold tracking-tight ' + (st.dim ? 'strike' : '')}>{fact.value}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {docLabel(fact.doc_id)} · <span className="mono">{fact.id}</span> · <span className="mono">{fmtDate(fact.date)}</span>
          </div>
        </button>
        <span className={'badge ' + st.cls}>{t(st.label)}</span>
      </div>
      <blockquote className="quote mt-3 !text-[13.5px] flex-1">“{fact.quote}”</blockquote>
      <div className="mt-2 mono text-[11.5px] text-muted-foreground truncate">{fact.doc_id}</div>
      {button}
    </div>
  )
}

/** Dialog with a required reason textarea (and optional extra content). Resolves via onSubmit(reason). */
export function ReasonDialog({
  title,
  sub,
  label,
  placeholder,
  confirm,
  onClose,
  onSubmit,
  extra,
  required = true,
}: {
  title: ReactNode
  sub?: ReactNode
  label: string
  placeholder: string
  confirm: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
  extra?: ReactNode
  required?: boolean
}) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (required && !reason.trim()) return setErr(true)
    setBusy(true)
    try {
      await onSubmit(reason.trim())
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={title}
      sub={sub}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={go}>
            {confirm}
          </button>
        </>
      }
    >
      {extra}
      <label className="label" htmlFor="rvReason">
        {label}
      </label>
      <textarea id="rvReason" className={'input ' + (err ? 'invalid' : '')} value={reason} placeholder={placeholder} onChange={(e) => { setReason(e.target.value); setErr(false) }} />
      {err && <div className="mt-1 text-[12.5px]" style={{ color: 'hsl(var(--destructive))' }}>{t('review.reasonRequired')}</div>}
    </Dialog>
  )
}

export function useAuditActions() {
  const { pid, actor, refresh } = useApp()
  const { t } = useI18n()
  const list = async (): Promise<AuditEvent[]> => call(client.GET('/audit', { params: { query: { project_id: pid, limit: 200 } } }))
  const undoIds = async (ids: string[]) => {
    for (const id of ids) {
      await call(client.POST('/audit/{event_id}/undo', { params: { path: { event_id: id } }, body: { actor, reason: t('review.undoReason') } }))
    }
    await refresh()
  }
  const undoWithToast = async (ids: string[]) => {
    try {
      await undoIds(ids)
      toast(t('review.undone'), { icon: 'undo' })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    }
  }
  /** Run a write and collect the audit events it created (ids not seen before). */
  const withEvents = async (write: () => Promise<unknown>, actions: string[]): Promise<string[]> => {
    let before = new Set<string>()
    try {
      before = new Set((await list()).map((e) => e.id))
    } catch {
      /* ignore */
    }
    await write()
    try {
      return (await list()).filter((e) => !before.has(e.id) && actions.includes(e.action)).map((e) => e.id)
    } catch {
      return []
    }
  }
  return { list, undoIds, undoWithToast, withEvents }
}

export const UndoIcon = () => <Ic n="undo" className="sm" />
