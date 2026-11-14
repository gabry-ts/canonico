import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Ic } from '../../ui/Icon'
import { tagCls, useCopy } from './sharedLib'

export function TagChip({ tag }: { tag: string }) {
  return <span className={'tag ' + tagCls(tag)}>{tag}</span>
}

export function PageWrap({ children, max = 1120 }: { children: ReactNode; max?: number }) {
  return (
    <div className="h-full overflow-y-auto scroll">
      <div className="mx-auto px-6 py-6 pb-12" style={{ maxWidth: max }}>
        {children}
      </div>
    </div>
  )
}

export function PageHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function CardHead({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-5 h-12 border-b">
      <div className="min-w-0 flex items-baseline gap-2">
        <h2 className="section-title truncate">{title}</h2>
        {sub !== undefined && sub !== null && <span className="text-[12.5px] text-muted-foreground truncate">{sub}</span>}
      </div>
      {right}
    </header>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto w-9 h-9 rounded-full bg-muted grid place-items-center text-destructive">
        <Ic n="alert" />
      </div>
      <div className="mt-3 text-[14px] font-medium">{t('common.errorTitle')}</div>
      <p className="mt-1 text-[13px] text-muted-foreground max-w-[380px] mx-auto">{t('common.loadError', { message })}</p>
      {onRetry && (
        <button className="btn btn-outline btn-sm mt-4" onClick={onRetry}>
          <Ic n="refresh" className="sm" />
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

export function CopyField({ value }: { value: string }) {
  const { t } = useI18n()
  const copy = useCopy()
  return (
    <div className="flex gap-2">
      <input className="input mono !text-[12.5px]" readOnly value={value} aria-label={t('home.valueToCopy')} />
      <button className="btn btn-outline shrink-0" onClick={() => copy(value)}>
        <Ic n="copy" className="sm" />
        {t('common.copy')}
      </button>
    </div>
  )
}

export function CodeBlock({ value }: { value: string }) {
  const { t } = useI18n()
  const copy = useCopy()
  return (
    <div className="relative">
      <pre className="code scroll">{value}</pre>
      <button className="btn btn-outline btn-xs absolute top-2 right-2" onClick={() => copy(value)}>
        <Ic n="copy" className="sm" />
        {t('common.copy')}
      </button>
    </div>
  )
}

const normTag = (v: string) => v.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '-')

/** Tag input with chips (prototype .chips). Enter or comma adds a tag, Backspace on empty removes the last. */
export function ChipsInput({ value, onChange, id }: { value: string[]; onChange: (v: string[]) => void; id: string }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const tag = normTag(raw)
    setText('')
    if (tag && !value.includes(tag)) onChange([...value, tag])
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className="chips" onClick={() => document.getElementById(id)?.focus()}>
      {value.map((tag, i) => (
        <span key={tag} className={'tag ' + tagCls(tag)}>
          {tag}
          <button
            type="button"
            className="-mr-1 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onChange(value.filter((_, j) => j !== i))
            }}
            aria-label={t('home.removeTag', { tag })}
          >
            <Ic n="x" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={key}
        onBlur={() => text && add(text)}
        placeholder={value.length ? t('home.addTag') : t('home.addTagHint')}
        aria-label={t('home.addTag')}
        autoComplete="off"
      />
    </div>
  )
}

export function SrcStatus({ status, waiting = false }: { status: string; waiting?: boolean }) {
  const { t } = useI18n()
  if (waiting && status !== 'syncing' && status !== 'error')
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="dot !bg-muted-foreground/50" />
        {t('home.status.waiting')}
      </span>
    )
  if (status === 'syncing')
    return (
      <span className="inline-flex items-center gap-2 text-[13px]">
        <span className="dot sync" />
        {t('home.status.syncing')}
      </span>
    )
  if (status === 'error')
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-destructive">
        <span className="dot !bg-destructive" />
        {t('home.status.error')}
      </span>
    )
  if (status === 'idle')
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="dot !bg-muted-foreground/50" />
        {t('home.status.idle')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <span className="dot" />
      {t('home.status.ok')}
    </span>
  )
}
