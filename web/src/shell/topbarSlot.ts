import { useSyncExternalStore } from 'react'

// The DOM node in the top bar where screens put their primary action.
let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

/** Ref callback for the slot element in the top bar. */
export function setTopbarSlot(el: HTMLElement | null) {
  if (el === slot) return
  slot = el
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The slot element, or null until the top bar has mounted. */
export const useTopbarSlot = () => useSyncExternalStore(subscribe, () => slot)
