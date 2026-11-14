import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDemoActor, getSession, setSession } from '../../src/api/client'
import { useApp, type AppState } from '../../src/lib/store'
import { Toaster } from '../../src/ui/toast'
import { api, deferred, fail, offline } from '../helpers/api'
import { login, me, MEMBERS, project, source, stats } from '../helpers/fixtures'
import { mockShell, renderWithProviders } from '../helpers/render'

/** Renders the provider and hands back a live view of `useApp()`. */
function mount() {
  const ref: { app: AppState } = { app: undefined as unknown as AppState }
  function Probe() {
    ref.app = useApp()
    return <div data-testid="state">{ref.app.ready ? (ref.app.offline ? 'offline' : 'ready') : 'loading'}</div>
  }
  renderWithProviders(
    <>
      <Probe />
      <Toaster />
    </>,
  )
  const ready = async () => {
    await waitFor(() => expect(screen.getByTestId('state')).not.toHaveTextContent('loading'))
    return ref.app
  }
  return { ref, ready }
}

describe('AppProvider', () => {
  describe('first load', () => {
    it('is not ready until identity, organisation and projects arrived', async () => {
      const gate = deferred()
      mockShell()
      api.get('/org', () => gate.promise)
      const { ref } = mount()
      expect(ref.app).toMatchObject({ ready: false, offline: null, me: null, org: null, projects: [], signInRequired: false })
      gate.resolve({ id: 'org-meridian', name: 'Meridian Labs' })
      await waitFor(() => expect(ref.app.ready).toBe(true))
    })

    it('exposes who is acting, the organisation, the projects and the current project', async () => {
      mockShell()
      const app = await mount().ready()
      expect(app.me?.member.name).toBe('Giulia Ferri')
      expect(app.org?.name).toBe('Meridian Labs')
      expect(app.projects.map((p) => p.id)).toEqual(['proj-clearpath', 'proj-internal'])
      expect(app).toMatchObject({ projectId: 'proj-clearpath', pid: 'proj-clearpath', scope: 'project', signedIn: false, signInRequired: false, version: 0, factId: null })
      expect(app.project?.name).toBe('ClearPath engagement')
    })

    it('asks /me for the remembered project, the demo project by default', async () => {
      mockShell()
      await mount().ready()
      expect(api.last('GET', '/me')!.query.get('project_id')).toBe('proj-clearpath')
    })

    it('starts on the remembered project', async () => {
      localStorage.setItem('canonico-project', 'proj-internal')
      mockShell()
      const app = await mount().ready()
      expect(app.projectId).toBe('proj-internal')
      expect(api.last('GET', '/me')!.query.get('project_id')).toBe('proj-internal')
    })

    it('falls back to the first project when the remembered one is gone', async () => {
      localStorage.setItem('canonico-project', 'proj-deleted')
      mockShell()
      const { ref, ready } = mount()
      const app = await ready()
      expect(app.projectId).toBe('proj-clearpath')
      await waitFor(() => expect(ref.app.sources).toHaveLength(1))
      expect(api.last('GET', '/projects/:id/sources')!.params.project_id).toBe('proj-clearpath')
    })

    it('keeps the remembered id while there are no projects at all', async () => {
      mockShell({ projects: [] })
      const app = await mount().ready()
      expect(app.projectId).toBe('proj-clearpath')
      expect(app.project).toBeUndefined()
    })

    it('loads the sidebar counters and the sources of the project', async () => {
      mockShell({ stats: stats({ facts_total: 77 }), sources: [source({ id: 's-1' }), source({ id: 's-2' })] })
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.stats?.facts_total).toBe(77))
      expect(ref.app.sources.map((s) => s.id)).toEqual(['s-1', 's-2'])
      expect(api.last('GET', '/stats')!.query.get('project_id')).toBe('proj-clearpath')
    })

    it('accepts sources wrapped in { items }', async () => {
      mockShell()
      api.get('/projects/:id/sources', { items: [source({ id: 's-9' })] })
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.sources.map((s) => s.id)).toEqual(['s-9']))
    })

    it('works without counters and sources', async () => {
      mockShell()
      api.get('/stats', fail(500))
      const app = await mount().ready()
      expect(app.offline).toBeNull()
      expect(app.stats).toBeNull()
      expect(app.sources).toEqual([])
    })
  })

  describe('backend not reachable', () => {
    it('reports offline, with the reason', async () => {
      mockShell()
      api.get('/org', offline)
      const app = await mount().ready()
      expect(app).toMatchObject({ ready: true, offline: 'network', me: null, signInRequired: false })
    })

    it('a failing /me that is not a 401 is an error too', async () => {
      mockShell()
      api.get('/me', fail(500, 'database is locked'))
      const app = await mount().ready()
      expect(app.offline).toBe('database is locked')
    })

    it('refresh recovers once the backend is back', async () => {
      mockShell()
      api.get('/projects', offline)
      const { ref, ready } = mount()
      await ready()
      api.get('/projects', { items: [project()] })
      await act(() => ref.app.refresh())
      expect(ref.app.offline).toBeNull()
      expect(ref.app.projects).toHaveLength(1)
    })
  })

  describe('permissions and names', () => {
    it('can() follows the permissions of the identity', async () => {
      mockShell({ me: me({ as: MEMBERS.sara }) })
      const app = await mount().ready()
      expect(app.can('retire_fact')).toBe(true)
      expect(app.can('manage_sources')).toBe(false)
      expect(app.can('no_such_permission')).toBe(false)
    })

    it('nobody can do anything before the identity is known', async () => {
      mockShell({ me: null })
      const app = await mount().ready()
      expect(app.can('ask')).toBe(false)
    })

    it('uses the display name as the actor of writes', async () => {
      mockShell({ me: me({ as: MEMBERS.marco, name: 'Marco' }) })
      const app = await mount().ready()
      expect(app).toMatchObject({ actor: 'Marco', actorName: 'Marco' })
    })

    it('falls back to the first name when there is no display name', async () => {
      mockShell({ me: { ...me({ as: MEMBERS.sara }), name: undefined } })
      const app = await mount().ready()
      expect(app).toMatchObject({ actor: 'Sara', actorName: 'Sara' })
    })

    it('without an identity the actor is the default member and the shown name is empty', async () => {
      mockShell({ me: null })
      const app = await mount().ready()
      expect(app).toMatchObject({ actor: 'Giulia', actorName: '' })
    })
  })

  describe('project and scope', () => {
    it('setProjectId remembers the project, reloads for it and bumps the version', async () => {
      mockShell()
      const { ref, ready } = mount()
      await ready()
      act(() => ref.app.setProjectId('proj-internal'))
      expect(ref.app).toMatchObject({ projectId: 'proj-internal', pid: 'proj-internal', version: 1 })
      expect(ref.app.project?.name).toBe('Internal')
      expect(localStorage.getItem('canonico-project')).toBe('proj-internal')
      await waitFor(() => expect(api.last('GET', '/me')!.query.get('project_id')).toBe('proj-internal'))
      await waitFor(() => expect(api.last('GET', '/projects/:id/sources')!.params.project_id).toBe('proj-internal'))
      expect(api.last('GET', '/stats')!.query.get('project_id')).toBe('proj-internal')
    })

    it('organisation scope sends no project and reloads the counters', async () => {
      mockShell()
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.stats).not.toBeNull())
      act(() => ref.app.setScope('org'))
      expect(ref.app).toMatchObject({ scope: 'org', pid: undefined, projectId: 'proj-clearpath' })
      await waitFor(() => expect(api.last('GET', '/stats')!.query.has('project_id')).toBe(false))
      // The sources in the sidebar stay those of the current project.
      expect(api.last('GET', '/projects/:id/sources')!.params.project_id).toBe('proj-clearpath')
    })
  })

  describe('fact drawer', () => {
    it('openFact sets and clears the open fact', async () => {
      mockShell()
      const { ref, ready } = mount()
      await ready()
      act(() => ref.app.openFact('M-106'))
      expect(ref.app.factId).toBe('M-106')
      act(() => ref.app.openFact(null))
      expect(ref.app.factId).toBeNull()
    })
  })

  describe('refresh', () => {
    it('bumps the version and reloads identity, projects, counters and sources', async () => {
      mockShell()
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.stats).not.toBeNull())
      const before = api.calls.length
      api.get('/stats', stats({ facts_total: 999 }))
      await act(() => ref.app.refresh())
      expect(ref.app.version).toBe(1)
      expect(ref.app.stats?.facts_total).toBe(999)
      expect(api.calls.slice(before).map((c) => c.path).sort()).toEqual(['/me', '/org', '/projects', '/projects/proj-clearpath/sources', '/stats'])
    })
  })

  describe('demo identity', () => {
    it('setActor sends the member as X-Demo-Actor, reloads and bumps the version', async () => {
      mockShell()
      api.get('/me', (req) => me({ as: req.headers.get('X-Demo-Actor') === 'mem-luca' ? MEMBERS.luca : MEMBERS.giulia }))
      const { ref, ready } = mount()
      await ready()
      act(() => ref.app.setActor('mem-luca'))
      await waitFor(() => expect(ref.app.me?.member.id).toBe('mem-luca'))
      expect(ref.app.version).toBe(1)
      expect(ref.app.can('retire_fact')).toBe(false)
      expect(getDemoActor()).toBe('mem-luca')
      expect(api.last('GET', '/stats')!.headers.get('X-Demo-Actor')).toBe('mem-luca')
    })

    it('setActor(null) goes back to the backend default', async () => {
      localStorage.setItem('canonico-actor', 'mem-luca')
      mockShell()
      const { ref, ready } = mount()
      await ready()
      act(() => ref.app.setActor(null))
      await waitFor(() => expect(api.last('GET', '/me')!.headers.get('X-Demo-Actor')).toBeNull())
      expect(getDemoActor()).toBeNull()
    })
  })

  describe('sign-in', () => {
    it('asks for a sign-in when the backend answers 401 to /me', async () => {
      mockShell({ me: null })
      const app = await mount().ready()
      expect(app).toMatchObject({ ready: true, offline: null, me: null, signInRequired: true, signedIn: false })
      expect(app.org?.name).toBe('Meridian Labs')
    })

    it('signIn keeps the session, sends its token and reloads as that member', async () => {
      mockShell({ me: null })
      api.get('/me', (req) => (req.headers.get('Authorization') === 'Bearer tok-marco' ? me({ as: MEMBERS.marco }) : fail(401, 'Sign in', 'unauthorized')))
      const { ref, ready } = mount()
      await ready()
      act(() => ref.app.signIn(login({ member: MEMBERS.marco, token: 'tok-marco' })))
      expect(ref.app.signedIn).toBe(true)
      await waitFor(() => expect(ref.app.me?.member.id).toBe('mem-marco'))
      expect(ref.app).toMatchObject({ signInRequired: false, version: 1 })
      expect(getSession()).toMatchObject({ token: 'tok-marco', memberId: 'mem-marco' })
    })

    it('starts signed in when a session is saved', async () => {
      setSession({ token: 'tok-giulia', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-giulia' })
      mockShell()
      const app = await mount().ready()
      expect(app.signedIn).toBe(true)
      expect(api.last('GET', '/me')!.headers.get('Authorization')).toBe('Bearer tok-giulia')
    })

    it('signOut revokes the token while it is still sent, then forgets the session', async () => {
      setSession({ token: 'tok-giulia', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-giulia' })
      mockShell()
      api.post('/auth/logout', () => undefined)
      const { ref, ready } = mount()
      await ready()
      await act(() => ref.app.signOut())
      expect(api.last('POST', '/auth/logout')!.headers.get('Authorization')).toBe('Bearer tok-giulia')
      expect(getSession()).toBeNull()
      expect(ref.app).toMatchObject({ signedIn: false, version: 1 })
      await waitFor(() => expect(api.last('GET', '/me')!.headers.get('Authorization')).toBeNull())
      expect(screen.queryByText('Your session has ended. Sign in again.')).not.toBeInTheDocument()
    })

    it('signOut forgets the session even when the backend is down', async () => {
      setSession({ token: 'tok-giulia', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-giulia' })
      mockShell()
      api.post('/auth/logout', offline)
      const { ref, ready } = mount()
      await ready()
      await act(() => ref.app.signOut())
      expect(getSession()).toBeNull()
      expect(ref.app.signedIn).toBe(false)
    })

    it('ends a session the backend no longer knows: it answers with the demo identity instead', async () => {
      // A backend that does not require sign-in ignores an unknown token and answers as the default member.
      setSession({ token: 'tok-old', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-marco' })
      mockShell({ me: me({ as: MEMBERS.giulia }) })
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.signedIn).toBe(false))
      expect(getSession()).toBeNull()
      expect(await screen.findByText('Your session has ended. Sign in again.')).toBeInTheDocument()
    })

    it('ends the session and asks to sign in again when the token is refused', async () => {
      setSession({ token: 'tok-old', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-marco' })
      mockShell({ me: null })
      const { ref, ready } = mount()
      await ready()
      await waitFor(() => expect(ref.app.signedIn).toBe(false))
      expect(ref.app.signInRequired).toBe(true)
      expect(await screen.findByText('Your session has ended. Sign in again.')).toBeInTheDocument()
    })

    it('a session restored from storage that the backend forgot ends without the notice', async () => {
      localStorage.setItem('canonico-session', JSON.stringify({ token: 'tok-before-restart', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-marco' }))
      vi.resetModules()
      const { AppProvider } = await import('../../src/lib/AppProvider')
      const { useApp: useFreshApp } = await import('../../src/lib/appContext')
      const { I18nProvider } = await import('../../src/i18n')
      const { Toaster: FreshToaster } = await import('../../src/ui/toast')
      const client = await import('../../src/api/client')
      mockShell({ me: null })
      function Probe() {
        const app = useFreshApp()
        return <div data-testid="fresh">{app.ready ? (app.signedIn ? 'signed in' : 'signed out') : 'loading'}</div>
      }
      render(
        <I18nProvider>
          <AppProvider>
            <Probe />
            <FreshToaster />
          </AppProvider>
        </I18nProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('fresh')).toHaveTextContent('signed out'))
      expect(client.getSession()).toBeNull()
      expect(screen.queryByText('Your session has ended. Sign in again.')).not.toBeInTheDocument()
      vi.resetModules()
    })

    it('keeps the session when the backend answers as its member', async () => {
      setSession({ token: 'tok-marco', expiresAt: new Date(Date.now() + 3600_000).toISOString(), memberId: 'mem-marco' })
      mockShell({ me: me({ as: MEMBERS.marco }) })
      const app = await mount().ready()
      expect(app.signedIn).toBe(true)
      expect(getSession()).not.toBeNull()
    })
  })

  it('useApp fails loudly outside the provider', () => {
    const quiet = console.error
    console.error = () => {}
    function Probe() {
      useApp()
      return null
    }
    try {
      expect(() => render(<Probe />)).toThrow('useApp outside AppProvider')
    } finally {
      console.error = quiet
    }
  })
})
