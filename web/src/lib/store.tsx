import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call, client, getDemoActor, setDemoActor, type Schemas } from '../api/client'

export type Scope = 'project' | 'org'
type Me = Schemas['Me']
type Project = Schemas['Project']
type Source = Schemas['Source']
type Stats = Schemas['Stats']
type Org = Schemas['Organisation']

export type AppState = {
  /** False until the first load of /me, /org, /projects finished (or failed). */
  ready: boolean
  /** Set when the backend cannot be reached. */
  offline: string | null
  me: Me | null
  org: Org | null
  projects: Project[]
  projectId: string
  project: Project | undefined
  setProjectId: (id: string) => void
  scope: Scope
  setScope: (s: Scope) => void
  /** `project_id` to send on scoped requests: undefined in organisation scope. */
  pid: string | undefined
  /** Stats of the current scope (sidebar counters). */
  stats: Stats | null
  /** Sources of the current project (sidebar). */
  sources: Source[]
  can: (perm: string) => boolean
  /** Value for the `actor` field of write requests (member id). */
  actor: string
  /** Short display name of the current identity. */
  actorName: string
  /** Switch demo identity (member id); null returns to the backend default. */
  setActor: (id: string | null) => void
  /** Bumped after every mutation: screens put it in their useApi deps to refetch. */
  version: number
  /** Call after any write: refetches shell data and bumps `version`. */
  refresh: () => Promise<void>
  /** Fact drawer: id of the open fact, or null. */
  factId: string | null
  openFact: (id: string | null) => void
}

const Ctx = createContext<AppState | null>(null)
const PROJECT_KEY = 'canonico-project'

function saved(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectIdState] = useState<string>(saved(PROJECT_KEY) || 'proj-clearpath')
  const [scope, setScope] = useState<Scope>('project')
  const [stats, setStats] = useState<Stats | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [version, setVersion] = useState(0)
  const [factId, openFact] = useState<string | null>(null)
  const [actorId, setActorId] = useState<string | null>(getDemoActor())

  const pid = scope === 'org' ? undefined : projectId

  const load = useCallback(async () => {
    try {
      const [m, o, p] = await Promise.all([
        call(client.GET('/me', { params: { query: { project_id: projectId } } })),
        call(client.GET('/org')),
        call(client.GET('/projects')),
      ])
      setMe(m)
      setOrg(o)
      setProjects(p.items)
      setOffline(null)
      if (p.items.length && !p.items.some((x) => x.id === projectId)) setProjectIdState(p.items[0].id)
    } catch (e) {
      setOffline(e instanceof Error ? e.message : 'network')
    } finally {
      setReady(true)
    }
    try {
      const [s, src] = await Promise.all([
        call(client.GET('/stats', { params: { query: { project_id: pid } } })),
        call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: projectId } } })),
      ])
      setStats(s)
      setSources(Array.isArray(src) ? src : ((src as { items?: Source[] }).items ?? []))
    } catch {
      // counters are optional
    }
  }, [projectId, pid])

  useEffect(() => {
    void load()
  }, [load, actorId])

  const refresh = useCallback(async () => {
    setVersion((v) => v + 1)
    await load()
  }, [load])

  const setProjectId = useCallback((id: string) => {
    try {
      localStorage.setItem(PROJECT_KEY, id)
    } catch {
      // storage unavailable
    }
    setProjectIdState(id)
    setVersion((v) => v + 1)
  }, [])

  const setActor = useCallback((id: string | null) => {
    setDemoActor(id)
    setActorId(id)
    setVersion((v) => v + 1)
  }, [])

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
      actor: me?.member.id ?? 'mem-giulia-ferri',
      actorName: me?.name || me?.member.name.split(' ')[0] || '',
      setActor,
      version,
      refresh,
      factId,
      openFact,
    }),
    [ready, offline, me, org, projects, projectId, setProjectId, scope, pid, stats, sources, setActor, version, refresh, factId],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
