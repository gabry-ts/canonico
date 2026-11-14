import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { api } from './helpers/api'

// openapi-fetch keeps the `fetch` it finds when the client is created, so the fake backend has to be in place
// before any test file imports `src/api/client`. Setup files run first.
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => api.handle(input, init)) as typeof fetch

// The module instances every test file gets from its own imports. They are kept here so the clean-up below still
// reaches them after a test called `vi.resetModules()` to load a second copy.
const client = await import('../src/api/client')
const i18n = await import('../src/i18n/core')
const toasts = await import('../src/ui/toastStore')
const reveal = await import('../src/lib/revealDelay')

/** jsdom has no matchMedia. `setSystemDark(true)` in a test flips the answer and notifies listeners. */
type MqListener = (e: { matches: boolean }) => void
const mq = { dark: false, listeners: new Set<MqListener>() }
export function setSystemDark(dark: boolean) {
  mq.dark = dark
  mq.listeners.forEach((l) => l({ matches: dark }))
}
export const systemThemeListeners = () => mq.listeners.size

function installBrowserStubs() {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return mq.dark
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: MqListener) => mq.listeners.add(l),
    removeEventListener: (_: string, l: MqListener) => mq.listeners.delete(l),
    addListener: (l: MqListener) => mq.listeners.add(l),
    removeListener: (l: MqListener) => mq.listeners.delete(l),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
  // Not implemented by jsdom.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
}

beforeEach(() => {
  reveal.revealConfig.enabled = false
  installBrowserStubs()
})

afterEach(() => {
  cleanup()
  api.reset()
  mq.dark = false
  mq.listeners.clear()
  // Back to English before the storage is cleared, so no test inherits another one's language.
  i18n.storeLocale('en')
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('lang')
  document.title = ''
  if (location.hash) {
    history.replaceState(null, '', location.pathname)
  }
  // Module state that outlives a test: the signed-in session, the demo identity, the toasts on screen.
  client.setSession(null)
  client.setDemoActor(null)
  toasts.getToasts().splice(0)
  vi.useRealTimers()
})
