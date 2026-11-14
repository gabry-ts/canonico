import { useSyncExternalStore } from 'react'

export const ROUTES = [
  'login',
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
  const [first, ...rest] = h.split('/')
  const r = first === 'home' ? 'dashboard' : first
  const sub = rest.length ? decodeURIComponent(rest.join('/')) : null
  return { r: (ROUTES as readonly string[]).includes(r) ? (r as RouteName) : 'app', sub: sub || null }
}

/** Go to `path`. With `replace` the current history entry is replaced, so Back does not return to it. */
export function nav(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) location.replace('#/' + path)
  else location.hash = '#/' + path
}

/** Path of a route as `nav` takes it: "memory/M-106". */
export const routePath = (route: Route) => (route.sub ? `${route.r}/${route.sub}` : route.r)

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseHash(hash)
}
