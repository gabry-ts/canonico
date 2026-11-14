import { useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { Ic } from '../../ui/Icon'
import { toast } from '../../ui/toast'


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
        {sub && <span className="text-[12.5px] text-muted-foreground truncate">{sub}</span>}
      </div>
      {right}
    </header>
  )
}

export function FieldErr({ msg }: { msg?: string | null }) {
  if (!msg) return null
  return (
    <div className="err">
      <Ic n="alert" className="sm" />
      {msg}
    </div>
  )
}

export function CopyField({ value }: { value: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      el.remove()
    }
    setDone(true)
    toast(t('org.hook.copied'), { icon: 'copy' })
    setTimeout(() => setDone(false), 1800)
  }
  return (
    <div className="flex gap-2">
      <input className="input mono !text-[13px]" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn-outline shrink-0" onClick={() => void copy()}>
        <Ic n={done ? 'check' : 'copy'} className="sm" />
        {done ? t('org.hook.copied') : t('org.hook.copy')}
      </button>
    </div>
  )
}

export function Loading() {
  return (
    <div className="p-5 space-y-2" aria-busy="true">
      <div className="skel h-4 w-1/3" />
      <div className="skel h-10" />
      <div className="skel h-10" />
    </div>
  )
}
