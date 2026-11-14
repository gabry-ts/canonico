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

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4010'

export const client = createClient<paths>({ baseUrl: API_URL })

client.use({
  onRequest({ request }) {
    request.headers.set('Accept-Language', currentLocale())
    if (demoActor) request.headers.set('X-Demo-Actor', demoActor)
    return request
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
