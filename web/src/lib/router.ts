import { useSyncExternalStore } from 'react'

export const ROUTES = [
  'setup',
  'dashboard',
  'projects',
  'app',
  'memory',
  'conflicts',
  'open-questions',
  'maintenance',
  'sources',
  'settings',
  'audit',
  'admin',
] as const
export type RouteName = (typeof ROUTES)[number]
export type Route = { r: RouteName; sub: string | null }

/** Hash routing, same as the prototype: #/memory/M-106, #/projects/proj-clearpath, #/settings/members. */
export function parseHash(hash: string = location.hash): Route {
  const h = hash.replace(/^#\/?/, '')
  const [r, ...rest] = h.split('/')
  const sub = rest.length ? decodeURIComponent(rest.join('/')) : null
  return { r: (ROUTES as readonly string[]).includes(r) ? (r as RouteName) : 'app', sub: sub || null }
}

export function nav(path: string) {
  location.hash = '#/' + path
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseHash(hash)
}
