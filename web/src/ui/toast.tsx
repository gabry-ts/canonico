import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Ic, type IconName } from './Icon'

type ToastOpts = {
  /** "ok" (default), "alert" for errors, "lock" for permission messages. */
  icon?: IconName
  /** Shows an action button (for example Undo). */
  action?: { label: string; run: () => void }
  long?: boolean
}
type Item = { id: number; msg: ReactNode; opts: ToastOpts }

let items: Item[] = []
let seq = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Show a toast, bottom right. Call from anywhere. */
export function toast(msg: ReactNode, opts: ToastOpts = {}) {
  const id = seq++
  items = [...items, { id, msg, opts }]
  emit()
  setTimeout(
    () => {
      items = items.filter((i) => i.id !== id)
      emit()
    },
    opts.long ? 5600 : 3400,
  )
}
/** Error toast. */
export const toastError = (msg: ReactNode) => toast(msg, { icon: 'alert', long: true })

function ToastView({ item }: { item: Item }) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setOut(true), (item.opts.long ? 5600 : 3400) - 220)
    return () => clearTimeout(t)
  }, [item.opts.long])
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
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
  )
  return (
    <div className="fixed z-[70] bottom-12 right-4 flex flex-col gap-2 items-end" aria-live="polite">
      {list.map((i) => (
        <ToastView key={i.id} item={i} />
      ))}
    </div>
  )
}
