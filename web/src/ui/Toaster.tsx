import { useEffect, useState, useSyncExternalStore } from 'react'
import { Ic } from './Icon'
import { getToasts, subscribeToasts, toastMs, type ToastItem } from './toastStore'

function ToastView({ item }: { item: ToastItem }) {
  const [out, setOut] = useState(false)
  const ms = toastMs(item.opts)
  useEffect(() => {
    const t = setTimeout(() => setOut(true), ms - 220)
    return () => clearTimeout(t)
  }, [ms])
  const icon = item.opts.icon || 'ok'
  const tone = icon === 'alert' ? 'text-destructive' : icon === 'lock' ? 'text-muted-foreground' : 'text-success'
  return (
    <div className={`toast overlay ${out ? 'out' : ''}`}>
      <span className={`mt-px ${tone}`}>
        <Ic n={icon} />
      </span>
      <div className="flex-1 min-w-0 leading-snug">{item.msg}</div>
      {item.opts.action && (
        <button className="btn btn-ghost btn-xs -my-0.5" onClick={item.opts.action.run}>
          {item.opts.action.label}
        </button>
      )}
    </div>
  )
}

export function Toaster() {
  const list = useSyncExternalStore(subscribeToasts, getToasts)
  return (
    <div className="fixed z-[70] bottom-12 right-4 flex flex-col gap-2 items-end" aria-live="polite">
      {list.map((i) => (
        <ToastView key={i.id} item={i} />
      ))}
    </div>
  )
}
