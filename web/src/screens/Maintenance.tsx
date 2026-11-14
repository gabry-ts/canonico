import { useState } from 'react'
import { call, client, errMsg } from '../api/client'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { usePerm } from '../lib/perm'
import { useI18n } from '../i18n'
import { docLabel } from '../lib/facts'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { PageShell, Tabs, UndoIcon, useAuditActions } from './review/common'

const TONE: Record<string, string> = { superseded_still_retrievable: 'conflict', stale: 'retired', low_confidence: 'open' }

export default function Maintenance() {
  const { t, fmtDate } = useI18n()
  const { pid, version, actor, refresh, openFact } = useApp()
  const { attrs, guard } = usePerm()
  const audit = useAuditActions()
  const [tab, setTab] = useState<'pending' | 'approved' | 'dismissed'>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const { data, error, loading, reload } = useApi(() => call(client.GET('/maintenance/queue', { params: { query: { project_id: pid, limit: 200 } } })), [pid, version])

  const items = data ?? []
  const list = items.filter((m) => m.status === tab)
  const cnt = (k: string) => (data ? items.filter((m) => m.status === k).length : undefined)

  const decide = async (id: string, op: 'approve' | 'dismiss') => {
    setBusy(id)
    try {
      const ids = await audit.withEvents(
        () =>
          op === 'approve'
            ? call(client.POST('/maintenance/{item_id}/approve', { params: { path: { item_id: id } }, body: { actor } }))
            : call(client.POST('/maintenance/{item_id}/dismiss', { params: { path: { item_id: id } }, body: { actor } })),
        op === 'approve' ? ['approve', 'retire'] : ['dismiss'],
      )
      await refresh()
      toast(t(op === 'approve' ? 'review.maint.approved' : 'review.maint.dismissed'), {
        long: true,
        action: ids.length ? { label: t('common.undo'), run: () => void audit.undoWithToast(ids) } : undefined,
      })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(null)
    }
  }

  const undoItem = async (factId: string, op: 'approve' | 'dismiss') => {
    setBusy(factId + op)
    try {
      const ev = await audit.list()
      const mine = ev.filter((e) => e.fact_id === factId && (op === 'approve' ? ['approve', 'retire'] : ['dismiss']).includes(e.action))
      if (!mine.length) return toastError(t('review.conflicts.noEvent'))
      const newest = Math.max(...mine.map((e) => Date.parse(e.at)))
      await audit.undoIds(mine.filter((e) => newest - Date.parse(e.at) < 5000).map((e) => e.id))
      toast(t('review.undone'), { icon: 'undo' })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageShell
      max={1180}
      title={t('nav.maintenance')}
      sub={t('review.maint.sub')}
      tabs={<Tabs value={tab} onChange={setTab} items={[['pending', t('review.maint.pending'), cnt('pending')], ['approved', t('review.maint.approvedTab'), cnt('approved')], ['dismissed', t('review.maint.dismissedTab'), cnt('dismissed')]]} />}
    >
      <div className="card overflow-hidden">
        {loading && !data ? (
          <div className="p-5"><Skeleton rows={5} className="h-12" /></div>
        ) : error && !data ? (
          <Empty icon="alert" title={t('common.errorTitle')}>
            {t('common.loadError', { message: error })}
            <div className="mt-3"><button className="btn btn-outline btn-sm" onClick={() => void reload()}>{t('common.retry')}</button></div>
          </Empty>
        ) : list.length === 0 ? (
          <Empty icon="archive" title={t('review.maint.empty_' + tab)}>{t('review.maint.emptySub_' + tab)}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>{t('review.audit.fact')}</th><th>{t('review.maint.reason')}</th><th>{t('review.maint.why')}</th><th></th></tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td className="!py-3.5">
                      <button className="text-left" onClick={() => openFact(m.fact.id)}>
                        <div className={'font-medium ' + (tab === 'approved' ? 'strike' : '')}>{m.fact.value}</div>
                        <div className="text-[12.5px] text-muted-foreground mt-0.5">
                          {docLabel(m.fact.doc_id)} · <span className="mono">{fmtDate(m.fact.date)}</span> · <span className="mono">{m.fact.id}</span>
                        </div>
                      </button>
                    </td>
                    <td><span className={'badge ' + TONE[m.reason]}>{t('review.maint.r_' + m.reason)}</span></td>
                    <td className="text-[13px] text-muted-foreground max-w-[360px]">{m.detail}</td>
                    <td className="text-right whitespace-nowrap">
                      {tab === 'pending' ? (
                        <>
                          <button className="btn btn-ghost btn-sm" disabled={busy === m.id} {...attrs('retire_fact')} onClick={guard('retire_fact', () => void decide(m.id, 'dismiss'))}>
                            {t('review.maint.dismiss')}
                          </button>{' '}
                          <button className="btn btn-primary btn-sm" disabled={busy === m.id} {...attrs('retire_fact')} onClick={guard('retire_fact', () => void decide(m.id, 'approve'))}>
                            {t('review.maint.approve')}
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-ghost btn-sm" disabled={busy === m.fact.id + tab} {...attrs('retire_fact')} onClick={guard('retire_fact', () => void undoItem(m.fact.id, tab === 'approved' ? 'approve' : 'dismiss'))}>
                          <UndoIcon />
                          {t('common.undo')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
