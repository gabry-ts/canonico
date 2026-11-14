import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ApiError, call, client, endSession, getDemoActor, getSession, onSessionEnded, setDemoActor, setSession, subscribeSession, type Schemas } from '../api/client'
import { currentLocale, translate } from '../i18n'
import { toast } from '../ui/toast'
import { AppContext, type AppState, type Scope } from './appContext'
import { useApi } from './useApi'

type Source = Schemas['Source']
const PROJECT_KEY = 'canonico-project'

onSessionEnded(() => toast(translate(currentLocale(), 'auth.sessionEnded'), { icon: 'info', long: true }))

function saved(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [savedProject, setSavedProject] = useState<string>(saved(PROJECT_KEY) || 'proj-clearpath')
  const [scope, setScope] = useState<Scope>('project')
  const [version, setVersion] = useState(0)
  const [factId, openFact] = useState<string | null>(null)
  const [actorId, setActorId] = useState<string | null>(getDemoActor())
  const session = useSyncExternalStore(subscribeSession, getSession)
  const sessionKey = session ? `${session.memberId}|${session.expiresAt}` : null

  // Who is acting, the organisation and its projects. Without these the app shows "backend not reachable".
  // `me` is null when the backend wants a session (CANONICO_AUTH_REQUIRED) and there is none: then every read
  // answers 401 and the sign-in page takes over.
  const core = useApi(async () => {
    const sent = getSession()
    const unless401 = <T,>(p: Promise<T>) =>
      p.catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      })
    const [me, org, projects] = await Promise.all([
      unless401(call(client.GET('/me', { params: { query: { project_id: savedProject } } }))),
      unless401(call(client.GET('/org'))),
      unless401(call(client.GET('/projects'))),
    ])
    if (!me || !org || !projects) return { me: null, org: null, projects: [] }
    const current = getSession()
    if (current && current === sent && (!me.session_expires_at || me.member.id !== current.memberId)) {
      // The backend answered with the demo identity: the session we knew about is gone (revoked, expired, unknown).
      endSession()
    } else if (!current && me.session_expires_at) {
      // A session cookie this page did not know about (for example after its storage was cleared): adopt it.
      setSession({ memberId: me.member.id, expiresAt: me.session_expires_at })
    }
    return { me, org, projects: projects.items }
  }, [savedProject, actorId, sessionKey])
  const needsSignIn = core.data !== undefined && core.data.me === null
  const projects = useMemo(() => core.data?.projects ?? [], [core.data])
  // A remembered project that no longer exists falls back to the first one.
  const projectId = projects.length && !projects.some((p) => p.id === savedProject) ? projects[0].id : savedProject
  const pid = scope === 'org' ? undefined : projectId

  // Sidebar counters and sources. Optional: the shell works without them.
  const side = useApi(
    needsSignIn
      ? null
      : async () => {
          const [stats, src] = await Promise.all([
            call(client.GET('/stats', { params: { query: { project_id: pid } } })),
            call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: projectId } } })),
          ])
          return { stats, sources: Array.isArray(src) ? (src as Source[]) : ((src as { items?: Source[] }).items ?? []) }
        },
    [projectId, pid, actorId, sessionKey, needsSignIn],
  )

  const reloadCore = core.reload
  const reloadSide = side.reload
  const refresh = useCallback(async () => {
    setVersion((v) => v + 1)
    await Promise.all([reloadCore(), reloadSide()])
  }, [reloadCore, reloadSide])

  const setProjectId = useCallback((id: string) => {
    try {
      localStorage.setItem(PROJECT_KEY, id)
    } catch {
      // storage unavailable
    }
    setSavedProject(id)
    setVersion((v) => v + 1)
  }, [])

  const setActor = useCallback((id: string | null) => {
    setDemoActor(id)
    setActorId(id)
    setVersion((v) => v + 1)
  }, [])

  const signIn = useCallback((login: Schemas['LoginResponse']) => {
    // The token stays in the HttpOnly cookie the backend set; the page keeps only who signed in and until when.
    setSession({ expiresAt: login.expires_at, memberId: login.member.id })
    setVersion((v) => v + 1)
  }, [])

  const signOut = useCallback(async () => {
    // The cookie goes with the request, so the backend revokes the session and clears the cookie; a backend that is
    // down just lets it expire.
    await client.POST('/auth/logout').catch(() => undefined)
    setSession(null)
    setVersion((v) => v + 1)
  }, [])

  const me = core.data?.me ?? null
  const signedIn = session !== null
  const signInRequired = needsSignIn
  const org = core.data?.org ?? null
  const stats = side.data?.stats ?? null
  const sources = useMemo(() => side.data?.sources ?? [], [side.data])
  const ready = core.data !== undefined || core.error !== null
  const offline = core.error

  const value = useMemo<AppState>(
    () => ({
      ready,
      offline,
      me,
      org,
      projects,
      projectId,
      project: projects.find((p) => p.id === projectId),
      setProjectId,
      scope,
      setScope,
      pid,
      stats,
      sources,
      can: (perm: string) => (me ? (me.permissions as string[]).includes(perm) : false),
      // The backend stores `actor` as given and shows it back ("retired by Giulia"), so send the display name.
      actor: me?.name || me?.member.name.split(' ')[0] || 'Giulia',
      actorName: me?.name || me?.member.name.split(' ')[0] || '',
      setActor,
      signedIn,
      signInRequired,
      signIn,
      signOut,
      version,
      refresh,
      factId,
      openFact,
    }),
    [ready, offline, me, org, projects, projectId, setProjectId, scope, pid, stats, sources, setActor, signedIn, signInRequired, signIn, signOut, version, refresh, factId],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
