/**
 * A fake backend for the tests. `tests/setup.ts` points the global `fetch` at `api.handle`, so the real
 * openapi-fetch client (middleware included) talks to the routes a test declares:
 *
 *   api.get('/facts/:id', (req) => fact({ id: req.params.id }))   // handler: its return value is the JSON body
 *   api.get('/org', org())                                        // or just the JSON body
 *   api.post('/facts/:id/retire', fail(403, 'Requires editor'))   // an error answer
 *   api.get('/stats', offline)                                    // the request never reaches a server
 *
 * Routes declared later win, so a test can override a default from `mockShell()`.
 * A request no route matches is answered 404 and listed in `api.unhandled`.
 */

export type Req = {
  method: string
  /** Path without the base URL: "/facts/M-106". */
  path: string
  /** `:name` segments of the route pattern. */
  params: Record<string, string>
  query: URLSearchParams
  headers: Headers
  /** Parsed JSON body, the FormData of a multipart upload, or undefined. */
  body: unknown
}

type Answer = unknown | ((req: Req) => unknown | Promise<unknown>)
type Route = { method: string; pattern: string; re: RegExp; keys: string[]; answer: Answer }

function compile(pattern: string) {
  const keys: string[] = []
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1))
        return '([^/]+)'
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { re: new RegExp('^' + src + '$'), keys }
}

/** JSON answer with a status. */
export const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  })

/** Error answer in the backend's shape: `{ code, message }`. */
export const fail = (status: number, message = 'boom', code = 'error') => reply(status, { code, message })

/** Use as a route answer to make the request fail like an unreachable backend. */
export const offline = () => {
  throw new TypeError('Failed to fetch')
}

/** A promise the test resolves by hand, to hold a request open: `const gate = deferred(); api.get('/x', () => gate.promise)`. */
export function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakeApi {
  private routes: Route[] = []
  /** Every request received, oldest first. */
  calls: Req[] = []
  /** Requests no route matched ("GET /path"). */
  unhandled: string[] = []

  on(method: string, pattern: string, answer: Answer) {
    this.routes.unshift({ method: method.toUpperCase(), pattern, ...compile(pattern), answer })
    return this
  }
  get = (pattern: string, answer: Answer) => this.on('GET', pattern, answer)
  post = (pattern: string, answer: Answer = {}) => this.on('POST', pattern, answer)
  patch = (pattern: string, answer: Answer = {}) => this.on('PATCH', pattern, answer)
  put = (pattern: string, answer: Answer = {}) => this.on('PUT', pattern, answer)
  delete = (pattern: string, answer: Answer = {}) => this.on('DELETE', pattern, answer)

  reset() {
    this.routes = []
    this.calls = []
    this.unhandled = []
  }

  /** Requests received for a route: `api.callsTo('POST', '/facts/:id/retire')`. */
  callsTo(method: string, pattern: string): Req[] {
    const { re } = compile(pattern)
    return this.calls.filter((c) => c.method === method.toUpperCase() && re.test(c.path))
  }
  /** The last request received for a route, or undefined. */
  last(method: string, pattern: string): Req | undefined {
    return this.callsTo(method, pattern).at(-1)
  }

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method.toUpperCase()
    let body: unknown
    if (method !== 'GET' && method !== 'HEAD') {
      const type = request.headers.get('Content-Type') ?? ''
      if (type.includes('multipart/form-data')) body = await request.formData()
      else {
        const text = await request.text()
        try {
          body = text ? JSON.parse(text) : undefined
        } catch {
          body = text
        }
      }
    }
    const req: Req = { method, path, params: {}, query: url.searchParams, headers: request.headers, body }
    this.calls.push(req)
    for (const route of this.routes) {
      if (route.method !== method) continue
      const m = route.re.exec(path)
      if (!m) continue
      route.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])))
      const out = typeof route.answer === 'function' ? await (route.answer as (r: Req) => unknown)(req) : route.answer
      if (out instanceof Response) return out.clone()
      if (out === undefined) return new Response(null, { status: 204 })
      return reply(200, out)
    }
    this.unhandled.push(`${method} ${path}`)
    return fail(404, `no mock for ${method} ${path}`, 'not_mocked')
  }
}

export const api = new FakeApi()
