import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { call, client, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { Ic, type IconName } from '../../ui/Icon'
import { toast, toastError } from '../../ui/toast'

export type Source = Schemas['Source']
export type Item = Schemas['Item']
export type SyncJob = Schemas['SyncJob']

/** Some list endpoints return a bare array, others `{ items }`: accept both. */
export function asList<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[]
  const items = (x as { items?: T[] } | null | undefined)?.items
  return Array.isArray(items) ? items : []
}

export const ITEM_ICON: Record<string, IconName> = { meeting: 'mic', document: 'doc', note: 'note', ticket: 'ticket' }
export const ITEM_TYPES = ['meeting', 'document', 'note', 'ticket'] as const

export const tagCls = (t: string) => (t.startsWith('topic:') ? 'topic' : '')
export const tagSort = (a: string, b: string) => Number(a.startsWith('topic:')) - Number(b.startsWith('topic:')) || a.localeCompare(b)
export const humanTopic = (t: string) => {
  const s = t.replace(/[-_]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

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

export function useCopy() {
  const { t } = useI18n()
  return (v: string) => {
    navigator.clipboard?.writeText(v).then(
      () => toast(t('common.copied')),
      () => toastError(t('home.copyFailed')),
    )
  }
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

export function curlFor(url: string, tags: string[], token: string, date: string) {
  return `curl -X POST ${url} \\\n  -H "X-Canonico-Token: ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "type": "meeting",\n    "title": "Weekly sync",\n    "date": "${date}T10:00:00Z",\n    "text": "We agreed the onboarding target stays at 3–4 weeks.",\n    "tags": [${tags.map((t) => `"${t}"`).join(', ')}]\n  }'`
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

export function SrcStatus({ status }: { status: string }) {
  const { t } = useI18n()
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Starts a sync and polls the job until it finishes. `onStep` reports each job state. */
export async function runSync(sourceId: string, onStep?: (job: SyncJob) => void): Promise<SyncJob> {
  let job = await call(client.POST('/sources/{source_id}/sync', { params: { path: { source_id: sourceId } } }))
  onStep?.(job)
  for (let i = 0; i < 120 && (job.status === 'queued' || job.status === 'running'); i++) {
    await sleep(i < 10 ? 500 : 1000)
    job = await call(client.GET('/sync-jobs/{job_id}', { params: { path: { job_id: job.id } } }))
    onStep?.(job)
  }
  return job
}

/** Today as yyyy-mm-dd (local). */
export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
