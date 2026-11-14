import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { call, client, getDemoActor, setDemoActor, type Schemas } from '../api/client'
import { AppContext, type AppState, type Scope } from './appContext'
import { useApi } from './useApi'

type Source = Schemas['Source']
const PROJECT_KEY = 'canonico-project'

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

  // Who is acting, the organisation and its projects. Without these the app shows "backend not reachable".
  const core = useApi(async () => {
    const [me, org, projects] = await Promise.all([
      call(client.GET('/me', { params: { query: { project_id: savedProject } } })),
      call(client.GET('/org')),
      call(client.GET('/projects')),
    ])
    return { me, org, projects: projects.items }
  }, [savedProject, actorId])

  const projects = useMemo(() => core.data?.projects ?? [], [core.data])
  // A remembered project that no longer exists falls back to the first one.
  const projectId = projects.length && !projects.some((p) => p.id === savedProject) ? projects[0].id : savedProject
  const pid = scope === 'org' ? undefined : projectId

  // Sidebar counters and sources. Optional: the shell works without them.
  const side = useApi(async () => {
    const [stats, src] = await Promise.all([
      call(client.GET('/stats', { params: { query: { project_id: pid } } })),
      call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: projectId } } })),
    ])
    return { stats, sources: Array.isArray(src) ? (src as Source[]) : ((src as { items?: Source[] }).items ?? []) }
  }, [projectId, pid, actorId])

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

  const me = core.data?.me ?? null
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
      version,
      refresh,
      factId,
      openFact,
    }),
    [ready, offline, me, org, projects, projectId, setProjectId, scope, pid, stats, sources, setActor, version, refresh, factId],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
