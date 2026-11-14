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

/**
 * A signed-in session as the page knows it: whose it is and until when. The session token itself is never kept by
 * the page: the backend sets it as an HttpOnly cookie, which page scripts cannot read, and every request carries it.
 */
export type Session = { expiresAt: string; memberId: string }

const SESSION_KEY = 'canonico-session'
const alive = (s: Session) => Date.parse(s.expiresAt) > Date.now()

function store(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify({ memberId: s.memberId, expiresAt: s.expiresAt }))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // storage unavailable
  }
}

function savedSession(): Session | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as (Session & { token?: unknown }) | null
    const s = raw && typeof raw.memberId === 'string' && typeof raw.expiresAt === 'string' ? { memberId: raw.memberId, expiresAt: raw.expiresAt } : null
    // Older versions kept the bearer token here as well: rewrite the entry without it.
    if (raw && 'token' in raw) store(s && alive(s) ? s : null)
    return s && alive(s) ? s : null
  } catch {
    return null
  }
}

let session: Session | null = savedSession()
// Bumped on every sign-in and sign-out, so a late 401 to a request sent under an older session is not mistaken
// for the end of the current one.
let generation = 0
const sentWith = new Map<string, number>()
const sessionListeners = new Set<() => void>()
let sessionEnded: () => void = () => {}

export const getSession = () => session
export const subscribeSession = (cb: () => void) => {
  sessionListeners.add(cb)
  return () => {
    sessionListeners.delete(cb)
  }
}

/** Keep the session opened by a sign-in (only its member and expiry). Null forgets it: back to the demo identity. */
export function setSession(s: Session | null) {
  session = s ? { memberId: s.memberId, expiresAt: s.expiresAt } : null
  generation++
  store(session)
  sessionListeners.forEach((l) => l())
}

/**
 * The session stopped being valid without a sign-out: expired, revoked, or unknown to the backend. Only a session
 * that existed ends, so a first visit never shows the "session ended" notice.
 */
export function endSession() {
  if (!session) return
  setSession(null)
  sessionEnded()
}

/** Called once each time a session ends on its own (see `endSession`). */
export function onSessionEnded(cb: () => void) {
  sessionEnded = cb
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4010'

// `credentials: 'include'` sends the session cookie also when the API is on another origin in development
// (the web app on :5173, the API on :8000); the backend allows it for the configured CORS origins.
export const client = createClient<paths>({ baseUrl: API_URL, credentials: 'include' })

const SIGN_IN = /\/auth\/(login|demo-login|logout)$/

client.use({
  onRequest({ request, id }) {
    request.headers.set('Accept-Language', currentLocale())
    if (session && !alive(session)) endSession()
    // With a session the backend ignores the demo header: the signed-in member is the actor.
    if (session) sentWith.set(id, generation)
    else if (demoActor) request.headers.set('X-Demo-Actor', demoActor)
    return request
  },
  onResponse({ request, response, id }) {
    const sent = sentWith.get(id)
    sentWith.delete(id)
    // A 401 to a request sent under the current session means the backend no longer knows it. A wrong password on
    // sign-in is not that, and neither is a 401 to a request sent before the latest sign-in.
    if (response.status === 401 && session && sent === generation && !SIGN_IN.test(new URL(request.url).pathname)) endSession()
    return response
  },
  onError({ id }) {
    sentWith.delete(id)
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
