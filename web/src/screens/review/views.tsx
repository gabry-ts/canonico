import { useState, type ReactNode } from 'react'
import { errMsg } from '../../api/client'
import { useApp } from '../../lib/store'
import { useI18n } from '../../i18n'
import { docLabel, factState, type Fact } from '../../lib/facts'
import { Dialog } from '../../ui/overlays'
import { Ic } from '../../ui/Icon'
import { toastError } from '../../ui/toast'

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

export const UndoIcon = () => <Ic n="undo" className="sm" />
