/** Builders shared by the tests of the "Add source" and "Upload" dialogs. */
import { vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import { api } from './api'
import { source } from './fixtures'

export const PID = 'proj-clearpath'

/** The document library of the sample project. */
export const LIBRARY = source({ id: 'src-library', type: 'document_library', label: 'Library' })

export function libraryDoc(over: Partial<Schemas['Document']> = {}): Schemas['Document'] {
  return { id: 'doc-report', title: 'Final report', date: '2025-11-28', path: 'library/report.md', version: 1, current_version: 2, source_type: 'document_library', ...over }
}

/** Gives the project a document library holding `docs` (answered as a bare array). */
export function mockLibrary(docs: unknown[] = [libraryDoc()]) {
  api.get('/projects/:project_id/sources', [LIBRARY])
  api.get('/sources/:source_id/documents', docs)
}

export const textFile = (name: string, text: string, type = 'text/plain') => new File([text], name, { type })

/** Requests that change something, as "METHOD /path", oldest first. */
export const mutations = () => api.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)

export const TODAY = '2026-11-14'

/** Pins "today" (the dialogs stamp what they send with it). Only `Date` is faked: timers stay real. */
export function pinToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`))
}
