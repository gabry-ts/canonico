import { useState } from 'react'
import { call, client, errMsg } from '../api/client'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { usePerm } from '../lib/perm'
import { useI18n } from '../i18n'
import { Avatar } from '../ui/Icon'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { PageShell, Tabs, UndoIcon, useFact, useMembers } from './review/common'

const BADGE: Record<string, string> = {
  retire: 'retired', restore: 'ok', resolve: 'ok', close: 'ok', pin: 'binding', unpin: 'line', patch: 'line', create: 'line',
  supersede: 'superseded', approve: 'retired', undo: 'line', merge: 'line',
}
const NOT_UNDOABLE = ['ingest', 'classify', 'undo', 'reset', 'import']

function FactRef({ id }: { id: string | null }) {
  const { openFact } = useApp()
  const f = useFact(id)
  if (!id) return <span className="text-muted-foreground">—</span>
  return (
    <button className="text-left" onClick={() => openFact(id)}>
      <div className="text-[13.5px] truncate max-w-[260px]">{f?.value ?? id}</div>
      <div className="mono text-[11.5px] text-muted-foreground">{id}</div>
    </button>
  )
}

export default function Audit() {
  const { t, fmtDateTime } = useI18n()
  const { pid, version, actor, refresh } = useApp()
  const { attrs, guard } = usePerm()
  const member = useMembers()
  const [tab, setTab] = useState<'all' | 'people' | 'system'>('all')
  const [undone, setUndone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const { data, error, loading, reload } = useApi(() => call(client.GET('/audit', { params: { query: { limit: 200 } } })), [pid, version])

  const all = data ?? []
  const list = all.filter((a) => tab === 'all' || (tab === 'people' ? a.actor !== 'system' : a.actor === 'system'))

  const undo = async (id: string) => {
    setBusy(id)
    try {
      await call(client.POST('/audit/{event_id}/undo', { params: { path: { event_id: id } }, body: { actor, reason: t('review.undoReason') } }))
      setUndone((s) => new Set(s).add(id))
      toast(t('review.undone'), { icon: 'undo' })
      await refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageShell
      max={1240}
      title={t('nav.audit')}
      sub={t('review.audit.sub')}
      tabs={<Tabs value={tab} onChange={setTab} items={[['all', t('common.all'), data ? all.length : undefined], ['people', t('review.audit.people'), undefined], ['system', t('review.audit.system'), undefined]]} />}
    >
      {loading && !data ? (
        <div className="card p-5"><Skeleton rows={6} /></div>
      ) : error && !data ? (
        <div className="card">
          <Empty icon="alert" title={t('common.errorTitle')}>
            {t('common.loadError', { message: error })}
            <div className="mt-3"><button className="btn btn-outline btn-sm" onClick={() => void reload()}>{t('common.retry')}</button></div>
          </Empty>
        </div>
      ) : list.length === 0 ? (
        <div className="card"><Empty icon="history" title={t('review.audit.empty')} /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('review.audit.time')}</th><th>{t('review.audit.actor')}</th><th>{t('review.audit.action')}</th><th>{t('review.audit.fact')}</th><th>{t('review.reason')}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const name = member(a.actor)
                  const isUndone = undone.has(a.id)
                  const canUndo = a.actor !== 'system' && !isUndone && !NOT_UNDOABLE.includes(a.action)
                  return (
                    <tr key={a.id} className={isUndone ? 'opacity-55' : ''}>
                      <td className="mono text-[12.5px] text-muted-foreground whitespace-nowrap">{fmtDateTime(a.at)}</td>
                      <td>
                        <div className="flex items-center gap-2.5 whitespace-nowrap">
                          <Avatar name={name} />
                          <div>
                            <div className="text-[13.5px] font-medium">{name ?? t('review.audit.systemName')}</div>
                            <div className="text-[12px] text-muted-foreground">{name ? (a.actor_role ? t('roles.' + a.actor_role) : '') : t('review.audit.automatic')}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={'badge ' + (BADGE[a.action] ?? '')}>{t('review.action.' + a.action)}</span>
                        {isUndone && <> <span className="badge line">{t('review.audit.undone')}</span></>}
                      </td>
                      <td className="min-w-[180px]"><FactRef id={a.fact_id} /></td>
                      <td className="text-[13px] text-muted-foreground max-w-[340px]">{a.reason || '—'}</td>
                      <td className="text-right">
                        {canUndo && (
                          <button className="btn btn-ghost btn-sm" disabled={busy === a.id} {...attrs('retire_fact')} onClick={guard('retire_fact', () => void undo(a.id))}>
                            <UndoIcon />
                            {t('common.undo')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  )
}
