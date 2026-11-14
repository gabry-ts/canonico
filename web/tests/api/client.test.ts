import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_URL,
  ApiError,
  call,
  client,
  endSession,
  errMsg,
  getDemoActor,
  getSession,
  onSessionEnded,
  setDemoActor,
  setSession,
  subscribeSession,
  type Session,
} from '../../src/api/client'
import { storeLocale } from '../../src/i18n/core'
import { api, fail, offline, reply } from '../helpers/api'
import { me } from '../helpers/fixtures'

const inAnHour = () => new Date(Date.now() + 3600_000).toISOString()
const session = (over: Partial<Session> = {}): Session => ({ token: 'tok-1', expiresAt: inAnHour(), memberId: 'mem-giulia', ...over })

describe('call', () => {
  it('returns the data of a successful request', async () => {
    api.get('/me', me())
    await expect(call(client.GET('/me'))).resolves.toMatchObject({ role: 'owner' })
  })

  it('talks to the configured backend', async () => {
    api.get('/org', {})
    await call(client.GET('/org'))
    expect(API_URL).toBe('http://api.test')
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/org' })
  })

  it('throws the backend message, status and code', async () => {
    api.get('/me', fail(403, 'Role viewer lacks permission retire_fact.', 'forbidden'))
    const e = await call(client.GET('/me')).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({ message: 'Role viewer lacks permission retire_fact.', status: 403, code: 'forbidden' })
  })

  it('reads a FastAPI `detail` string as the message', async () => {
    api.get('/me', reply(422, { detail: 'project_id is required' }))
    await expect(call(client.GET('/me'))).rejects.toMatchObject({ message: 'project_id is required', status: 422 })
  })

  it('falls back to the status when the error has no readable message', async () => {
    api.get('/me', reply(422, { detail: [{ loc: ['query'], msg: 'bad' }] }))
    await expect(call(client.GET('/me'))).rejects.toMatchObject({ message: 'HTTP 422', status: 422 })
  })

  it('handles an error answer that is not JSON', async () => {
    api.get('/me', new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
    await expect(call(client.GET('/me'))).rejects.toMatchObject({ message: 'HTTP 502', status: 502 })
  })

  it('handles an error answer without a body', async () => {
    api.get('/me', new Response(null, { status: 500, headers: { 'Content-Length': '0' } }))
    await expect(call(client.GET('/me'))).rejects.toMatchObject({ message: 'HTTP 500', status: 500 })
  })

  it('reports an unreachable backend as status 0', async () => {
    api.get('/me', offline)
    await expect(call(client.GET('/me'))).rejects.toMatchObject({ message: 'network', status: 0, code: 'network' })
  })

  it('returns undefined for an empty answer', async () => {
    api.post('/auth/logout', () => undefined)
    await expect(call(client.POST('/auth/logout'))).resolves.toBeUndefined()
  })
})

describe('errMsg', () => {
  it('reads the message of an error and stringifies the rest', () => {
    expect(errMsg(new Error('nope'))).toBe('nope')
    expect(errMsg(new ApiError('forbidden', 403))).toBe('forbidden')
    expect(errMsg('plain')).toBe('plain')
    expect(errMsg(42)).toBe('42')
    expect(errMsg(null)).toBe('null')
  })
})

describe('demo identity', () => {
  it('is remembered', () => {
    setDemoActor('mem-sara')
    expect(getDemoActor()).toBe('mem-sara')
    expect(localStorage.getItem('canonico-actor')).toBe('mem-sara')
  })

  it('null goes back to the backend default', () => {
    setDemoActor('mem-sara')
    setDemoActor(null)
    expect(getDemoActor()).toBeNull()
    expect(localStorage.getItem('canonico-actor')).toBeNull()
  })

  it('is sent as X-Demo-Actor', async () => {
    api.get('/me', me())
    setDemoActor('mem-sara')
    await client.GET('/me')
    expect(api.calls[0].headers.get('X-Demo-Actor')).toBe('mem-sara')
    expect(api.calls[0].headers.get('Authorization')).toBeNull()
  })

  it('no header without a demo identity', async () => {
    api.get('/me', me())
    await client.GET('/me')
    expect(api.calls[0].headers.get('X-Demo-Actor')).toBeNull()
  })
})

describe('session', () => {
  it('is kept in memory and in storage', () => {
    const s = session()
    setSession(s)
    expect(getSession()).toEqual(s)
    expect(JSON.parse(localStorage.getItem('canonico-session')!)).toEqual(s)
  })

  it('null forgets it', () => {
    setSession(session())
    setSession(null)
    expect(getSession()).toBeNull()
    expect(localStorage.getItem('canonico-session')).toBeNull()
  })

  it('tells its subscribers, until they unsubscribe', () => {
    const cb = vi.fn()
    const off = subscribeSession(cb)
    setSession(session())
    setSession(null)
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    setSession(session())
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('is sent as a bearer token, and replaces the demo identity', async () => {
    api.get('/me', me())
    setDemoActor('mem-sara')
    setSession(session({ token: 'tok-abc' }))
    await client.GET('/me')
    expect(api.calls[0].headers.get('Authorization')).toBe('Bearer tok-abc')
    expect(api.calls[0].headers.get('X-Demo-Actor')).toBeNull()
  })

  it('endSession forgets the session and calls the listener once', () => {
    const ended = vi.fn()
    onSessionEnded(ended)
    setSession(session())
    endSession()
    expect(getSession()).toBeNull()
    expect(ended).toHaveBeenCalledTimes(1)
    endSession()
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('a sign-out (setSession(null)) is not a session that ended on its own', () => {
    const ended = vi.fn()
    onSessionEnded(ended)
    setSession(session())
    setSession(null)
    expect(ended).not.toHaveBeenCalled()
  })

  it('an expired session ends before the request and the demo identity is sent instead', async () => {
    api.get('/me', me())
    const ended = vi.fn()
    onSessionEnded(ended)
    setDemoActor('mem-sara')
    setSession(session({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    await client.GET('/me')
    expect(ended).toHaveBeenCalledTimes(1)
    expect(getSession()).toBeNull()
    expect(api.calls[0].headers.get('Authorization')).toBeNull()
    expect(api.calls[0].headers.get('X-Demo-Actor')).toBe('mem-sara')
  })

  it('a 401 for the token we hold ends the session', async () => {
    api.get('/me', fail(401, 'Unknown token', 'unauthorized'))
    const ended = vi.fn()
    onSessionEnded(ended)
    setSession(session())
    await client.GET('/me')
    expect(getSession()).toBeNull()
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('a wrong password on sign-in does not end the current session', async () => {
    api.post('/auth/login', fail(401, 'Wrong email or password', 'unauthorized'))
    const ended = vi.fn()
    onSessionEnded(ended)
    const s = session()
    setSession(s)
    await client.POST('/auth/login', { body: { email: 'a@b.c', password: 'nope' } })
    expect(getSession()).toEqual(s)
    expect(ended).not.toHaveBeenCalled()
  })

  it('a 401 without a session changes nothing', async () => {
    api.get('/me', fail(401, 'Sign in', 'unauthorized'))
    const ended = vi.fn()
    onSessionEnded(ended)
    await client.GET('/me')
    expect(ended).not.toHaveBeenCalled()
  })

  it('a late 401 for an older token does not end the session opened meanwhile', async () => {
    const ended = vi.fn()
    onSessionEnded(ended)
    setSession(session({ token: 'tok-old' }))
    const fresh = session({ token: 'tok-new' })
    api.get('/me', () => {
      // The person signed in again while the request with the old token was on its way.
      setSession(fresh)
      return fail(401, 'Unknown token', 'unauthorized')
    })
    await client.GET('/me')
    expect(getSession()).toEqual(fresh)
    expect(ended).not.toHaveBeenCalled()
  })

  it('other errors keep the session', async () => {
    api.get('/me', fail(403, 'Forbidden', 'forbidden'))
    setSession(session())
    await client.GET('/me')
    expect(getSession()).not.toBeNull()
  })
})

describe('Accept-Language', () => {
  afterEach(() => storeLocale('en'))

  it('follows the UI language', async () => {
    api.get('/org', {})
    storeLocale('it')
    await client.GET('/org')
    storeLocale('en')
    await client.GET('/org')
    expect(api.calls.map((c) => c.headers.get('Accept-Language'))).toEqual(['it', 'en'])
  })
})

describe('at start-up', () => {
  afterEach(() => {
    vi.resetModules()
  })

  const load = async () => {
    vi.resetModules()
    return import('../../src/api/client')
  }

  it('restores a saved session that is still valid', async () => {
    const s = session()
    localStorage.setItem('canonico-session', JSON.stringify(s))
    expect((await load()).getSession()).toEqual(s)
  })

  it('drops a saved session that expired', async () => {
    localStorage.setItem('canonico-session', JSON.stringify(session({ expiresAt: '2020-01-01T00:00:00Z' })))
    expect((await load()).getSession()).toBeNull()
  })

  it.each([
    ['not JSON', '{oops'],
    ['no token', JSON.stringify({ expiresAt: inAnHour(), memberId: 'mem-giulia' })],
    ['no member', JSON.stringify({ token: 'tok-1', expiresAt: inAnHour() })],
    ['no expiry', JSON.stringify({ token: 'tok-1', memberId: 'mem-giulia' })],
    ['an expiry that is not a date', JSON.stringify({ token: 'tok-1', memberId: 'mem-giulia', expiresAt: 'soon' })],
    ['null', 'null'],
  ])('ignores a saved session that is broken: %s', async (_, saved) => {
    localStorage.setItem('canonico-session', saved)
    expect((await load()).getSession()).toBeNull()
  })

  it('a restored session the backend no longer knows ends quietly, without the notice', async () => {
    // Sessions live in the memory of the backend: after a restart the saved token is simply unknown.
    localStorage.setItem('canonico-session', JSON.stringify(session({ token: 'tok-before-restart' })))
    const c = await load()
    const ended = vi.fn()
    c.onSessionEnded(ended)
    api.get('/me', fail(401, 'Unknown token', 'unauthorized'))
    await c.client.GET('/me')
    expect(api.calls[0].headers.get('Authorization')).toBe('Bearer tok-before-restart')
    expect(c.getSession()).toBeNull()
    expect(localStorage.getItem('canonico-session')).toBeNull()
    expect(ended).not.toHaveBeenCalled()
  })

  it('a session opened on this page does give the notice when it ends, also after an earlier quiet one', async () => {
    localStorage.setItem('canonico-session', JSON.stringify(session({ token: 'tok-before-restart' })))
    const c = await load()
    const ended = vi.fn()
    c.onSessionEnded(ended)
    c.endSession()
    expect(ended).not.toHaveBeenCalled()
    c.setSession(session({ token: 'tok-new' }))
    c.endSession()
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('restores the saved demo identity', async () => {
    localStorage.setItem('canonico-actor', 'mem-luca')
    expect((await load()).getDemoActor()).toBe('mem-luca')
  })

  it('works when storage is not available', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const c = await load()
    expect(c.getSession()).toBeNull()
    expect(c.getDemoActor()).toBeNull()
    const s = session()
    expect(() => c.setSession(s)).not.toThrow()
    expect(c.getSession()).toEqual(s)
    expect(() => c.setDemoActor('mem-sara')).not.toThrow()
    expect(c.getDemoActor()).toBe('mem-sara')
    expect(() => c.setDemoActor(null)).not.toThrow()
    expect(() => c.setSession(null)).not.toThrow()
  })

  it('defaults to the local mock server when VITE_API_URL is not set', async () => {
    vi.stubEnv('VITE_API_URL', undefined as unknown as string)
    expect((await load()).API_URL).toBe('http://localhost:4010')
    vi.unstubAllEnvs()
  })
})
