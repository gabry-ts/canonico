import { createContext, useContext } from 'react'
import type { Schemas } from '../api/client'

type Me = Schemas['Me']
type Project = Schemas['Project']
type Source = Schemas['Source']
type Stats = Schemas['Stats']
type Org = Schemas['Organisation']

export type Scope = 'project' | 'org'

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
  /** Value for the `actor` field of write requests (display name, shown back as "retired by …"). */
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

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(AppContext)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
