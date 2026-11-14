import createClient from 'openapi-fetch'
import type { components, paths } from './schema'
import { currentLocale } from '../i18n'

export type Schemas = components['schemas']

const ACTOR_KEY = 'canonico-actor'
let demoActor: string | null = null
try {
  demoActor = localStorage.getItem(ACTOR_KEY)
} catch {
  // storage unavailable
}

/** Demo identity (member id) sent as X-Demo-Actor. Null = backend default (Giulia). */
export const getDemoActor = () => demoActor
export function setDemoActor(id: string | null) {
  demoActor = id
  try {
    if (id) localStorage.setItem(ACTOR_KEY, id)
    else localStorage.removeItem(ACTOR_KEY)
  } catch {
    // storage unavailable
  }
}

/** A signed-in session: the bearer token of `POST /auth/login`, its expiry and the member it belongs to. */
export type Session = { token: string; expiresAt: string; memberId: string }

const SESSION_KEY = 'canonico-session'
const alive = (s: Session) => Date.parse(s.expiresAt) > Date.now()

function savedSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
    return s && typeof s.token === 'string' && typeof s.memberId === 'string' && alive(s) ? s : null
  } catch {
    return null
  }
}

let session: Session | null = savedSession()
// True when the session was opened by a sign-in on this page. A session restored from storage that the backend no
// longer knows (expired or revoked) ends quietly, without the "session ended" notice.
let sessionUsed = false
const sessionListeners = new Set<() => void>()
let sessionEnded: () => void = () => {}

export const getSession = () => session
export const subscribeSession = (cb: () => void) => {
  sessionListeners.add(cb)
  return () => {
    sessionListeners.delete(cb)
  }
}

/** Keep the session opened by a sign-in. Null forgets it: requests go back to the demo identity. */
export function setSession(s: Session | null) {
  session = s
  sessionUsed = s !== null
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // storage unavailable
  }
  sessionListeners.forEach((l) => l())
}

/** The session stopped being valid without a sign-out: expired, revoked, or the backend restarted. */
export function endSession() {
  if (!session) return
  const notify = sessionUsed
  setSession(null)
  if (notify) sessionEnded()
}

/** Called once each time a session ends on its own (see `endSession`). */
export function onSessionEnded(cb: () => void) {
  sessionEnded = cb
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4010'

export const client = createClient<paths>({ baseUrl: API_URL })

client.use({
  onRequest({ request }) {
    request.headers.set('Accept-Language', currentLocale())
    if (session && !alive(session)) endSession()
    // With a session the backend ignores the demo header: the signed-in member is the actor.
    if (session) request.headers.set('Authorization', `Bearer ${session.token}`)
    else if (demoActor) request.headers.set('X-Demo-Actor', demoActor)
    return request
  },
  onResponse({ request, response }) {
    // A 401 for the token we still hold means the backend no longer knows it. A wrong password on sign-in is not that.
    const sent = request.headers.get('Authorization')
    if (response.status === 401 && session && sent === `Bearer ${session.token}` && !new URL(request.url).pathname.endsWith('/auth/login')) endSession()
    return response
  },
})

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response }

/** Unwraps an openapi-fetch call: returns the data or throws ApiError with the backend message. */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  let res: Result<T>
  try {
    res = await p
  } catch {
    throw new ApiError('network', 0, 'network')
  }
  if (res.error !== undefined || !res.response.ok) {
    const e = (res.error ?? {}) as { message?: string; code?: string; detail?: unknown }
    const msg = e.message ?? (typeof e.detail === 'string' ? e.detail : '') ?? ''
    throw new ApiError(msg || `HTTP ${res.response.status}`, res.response.status, e.code)
  }
  return res.data as T
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
