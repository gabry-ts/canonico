import type { ReactNode } from 'react'
import type { IconName } from './Icon'

export type ToastOpts = {
  /** "ok" (default), "alert" for errors, "lock" for permission messages. */
  icon?: IconName
  /** Shows an action button (for example Undo). */
  action?: { label: string; run: () => void }
  long?: boolean
}
export type ToastItem = { id: number; msg: ReactNode; opts: ToastOpts }

let items: ToastItem[] = []
let seq = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const toastMs = (opts: ToastOpts) => (opts.long ? 5600 : 3400)
export const getToasts = () => items
export const subscribeToasts = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Show a toast, bottom right. Call from anywhere. */
export function toast(msg: ReactNode, opts: ToastOpts = {}) {
  const id = seq++
  items = [...items, { id, msg, opts }]
  emit()
  setTimeout(() => {
    items = items.filter((i) => i.id !== id)
    emit()
  }, toastMs(opts))
}

/** Error toast. */
export const toastError = (msg: ReactNode) => toast(msg, { icon: 'alert', long: true })
