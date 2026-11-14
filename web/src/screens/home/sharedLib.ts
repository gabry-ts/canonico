import { call, client, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import type { IconName } from '../../ui/Icon'
import { toast, toastError } from '../../ui/toast'

export type Source = Schemas['Source']
export type Item = Schemas['Item']
export type SyncJob = Schemas['SyncJob']

/** Some list endpoints return a bare array, others `{ items }`: accept both. */
export function asList<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[]
  const items = (x as { items?: T[] } | null | undefined)?.items
  return Array.isArray(items) ? items : []
}

export const ITEM_ICON: Record<string, IconName> = { meeting: 'mic', document: 'doc', note: 'note', ticket: 'ticket' }
export const ITEM_TYPES = ['meeting', 'document', 'note', 'ticket'] as const

export const tagCls = (t: string) => (t.startsWith('topic:') ? 'topic' : '')
export const tagSort = (a: string, b: string) => Number(a.startsWith('topic:')) - Number(b.startsWith('topic:')) || a.localeCompare(b)
export const humanTopic = (t: string) => {
  const s = t.replace(/[-_]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function useCopy() {
  const { t } = useI18n()
  return (v: string) => {
    navigator.clipboard?.writeText(v).then(
      () => toast(t('common.copied')),
      () => toastError(t('home.copyFailed')),
    )
  }
}

export function curlFor(url: string, tags: string[], token: string, date: string) {
  return `curl -X POST ${url} \\\n  -H "X-Canonico-Token: ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "type": "meeting",\n    "title": "Weekly sync",\n    "date": "${date}T10:00:00Z",\n    "text": "We agreed the onboarding target stays at 3–4 weeks.",\n    "tags": [${tags.map((t) => `"${t}"`).join(', ')}]\n  }'`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Starts a sync and polls the job until it finishes. `onStep` reports each job state. */
export async function runSync(sourceId: string, onStep?: (job: SyncJob) => void): Promise<SyncJob> {
  let job = await call(client.POST('/sources/{source_id}/sync', { params: { path: { source_id: sourceId } } }))
  onStep?.(job)
  for (let i = 0; i < 120 && (job.status === 'queued' || job.status === 'running'); i++) {
    await sleep(i < 10 ? 500 : 1000)
    job = await call(client.GET('/sync-jobs/{job_id}', { params: { path: { job_id: job.id } } }))
    onStep?.(job)
  }
  return job
}

/** Today as yyyy-mm-dd (local). */
export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
