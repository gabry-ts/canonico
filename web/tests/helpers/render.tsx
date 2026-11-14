import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { I18nProvider } from '../../src/i18n'
import { AppContext, type AppState } from '../../src/lib/appContext'
import { AppProvider } from '../../src/lib/AppProvider'
import { Toaster } from '../../src/ui/Toaster'
import { api } from './api'
import { me as meOf, MEMBERS, org as orgOf, PROJECTS, source, stats as statsOf } from './fixtures'
import type { Schemas } from '../../src/api/client'

/** Go to a hash route and let the router hear about it: `goto('memory/M-106')`. */
export function goto(path: string) {
  location.hash = '#/' + path
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/**
 * A complete `useApp()` value with spies for every function. By default the owner (Giulia) of the sample
 * organisation in project scope, loaded and online. Pass the fields a test needs to change.
 */
export function makeApp(over: Partial<AppState> = {}): AppState {
  const me = over.me === undefined ? meOf() : over.me
  const projects = over.projects ?? PROJECTS
  const projectId = over.projectId ?? projects[0]?.id ?? 'proj-clearpath'
  const scope = over.scope ?? 'project'
  return {
    ready: true,
    offline: null,
    me,
    org: orgOf(),
    projects,
    projectId,
    project: projects.find((p) => p.id === projectId),
    setProjectId: vi.fn(),
    scope,
    setScope: vi.fn(),
    pid: scope === 'org' ? undefined : projectId,
    stats: statsOf(),
    sources: [],
    can: (perm: string) => (me ? (me.permissions as string[]).includes(perm) : false),
    actor: me?.name ?? 'Giulia',
    actorName: me?.name ?? '',
    setActor: vi.fn(),
    signedIn: false,
    signInRequired: false,
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
    version: 0,
    refresh: vi.fn(async () => {}),
    factId: null,
    openFact: vi.fn(),
    ...over,
  }
}

type Extra = Omit<RenderOptions, 'wrapper'>

/** Render inside the i18n provider only (components that do not call `useApp`). The toaster is mounted too. */
export function renderI18n(ui: ReactElement, opts?: Extra) {
  const user = userEvent.setup()
  const view = render(ui, {
    ...opts,
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider>
        {children}
        <Toaster />
      </I18nProvider>
    ),
  })
  return { ...view, user }
}

/**
 * Render with a stubbed `useApp()` value: the component under test only talks to the routes it calls itself.
 * Returns the app value (to assert on its spies) and a `userEvent` instance. Toasts are rendered.
 */
export function renderWithApp(ui: ReactElement, over: Partial<AppState> = {}, opts?: Extra) {
  const app = makeApp(over)
  const user = userEvent.setup()
  const view = render(ui, {
    ...opts,
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider>
        <AppContext.Provider value={app}>
          {children}
          <Toaster />
        </AppContext.Provider>
      </I18nProvider>
    ),
  })
  return { ...view, app, user }
}

type Shell = {
  me?: Schemas['Me'] | null
  org?: Schemas['Organisation']
  projects?: Schemas['Project'][]
  stats?: Schemas['Stats']
  sources?: Schemas['Source'][]
  members?: Schemas['Member'][]
}

/**
 * Routes the real `AppProvider` and the shell call: /me, /org, /projects, /stats, the sources of a project,
 * /org/members and /topics. `me: null` makes /me answer 401 (the backend wants a sign-in).
 */
export function mockShell(over: Shell = {}) {
  const members = over.members ?? Object.values(MEMBERS)
  api.get('/me', () => (over.me === null ? new Response(JSON.stringify({ code: 'unauthorized', message: 'Sign in' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) : (over.me ?? meOf())))
  api.get('/org', over.org ?? orgOf())
  api.get('/projects', { items: over.projects ?? PROJECTS })
  api.get('/stats', over.stats ?? statsOf())
  api.get('/projects/:project_id/sources', (req) => over.sources ?? [source({ project_id: req.params.project_id })])
  api.get('/org/members', { items: members, total: members.length })
  api.get('/topics', [])
}

/** Render with the real providers (i18n and `AppProvider`). Call `mockShell()` first. */
export function renderWithProviders(ui: ReactElement, opts?: Extra) {
  const user = userEvent.setup()
  const view = render(ui, {
    ...opts,
    wrapper: ({ children }: { children: ReactNode }) => (
      <I18nProvider>
        <AppProvider>{children}</AppProvider>
      </I18nProvider>
    ),
  })
  return { ...view, user }
}
