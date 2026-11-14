import { useState } from 'react'
import { call, client } from '../api/client'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { usePerm } from '../lib/perm'
import { useI18n } from '../i18n'
import { docLabel } from '../lib/facts'
import { Avatar, Ic } from '../ui/Icon'
import { Empty, Skeleton } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { errMsg } from '../api/client'
import { FactCard, PageShell, ReasonDialog, Tabs, UndoIcon, useAuditActions, useMembers, useTopicNames, type AuditEvent } from './review/common'
import type { Fact } from '../lib/facts'

export default function Conflicts() {
  const { t, fmtDateTime, fmtDate } = useI18n()
  const { pid, version, actor, refresh } = useApp()
  const { attrs, guard } = usePerm()
  const topic = useTopicNames()
  const member = useMembers()
  const audit = useAuditActions()
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [dlg, setDlg] = useState<{ cid: string; fact: Fact; others: Fact[] } | null>(null)
  const { data, error, loading, reload } = useApi(
    // The API returns one status per call (default: open), so load both for the two tabs.
    async () =>
      (
        await Promise.all(
          (['open', 'resolved'] as const).map((status) => call(client.GET('/conflicts', { params: { query: { project_id: pid, status } } }))),
        )
      ).flat(),
    [pid, version],
  )

  const all = data ?? []
  const list = all.filter((c) => c.status === tab)

  const submit = async (reason: string) => {
    if (!dlg) return
    const ids = await audit.withEvents(
      () => call(client.POST('/conflicts/{conflict_id}/resolve', { params: { path: { conflict_id: dlg.cid } }, body: { winning_fact_id: dlg.fact.id, reason, actor } })),
      ['resolve'],
    )
    setDlg(null)
    setTab('resolved')
    await refresh()
    toast(t('review.conflicts.done'), { long: true, action: ids.length ? { label: t('common.undo'), run: () => void audit.undoWithToast(ids) } : undefined })
  }

  const undoResolved = async (facts: Fact[]) => {
    try {
      const ev: AuditEvent[] = await audit.list()
      // A conflict also closes when one side is retired from Memory or Ask, so look for both kinds of event.
      const mine = ev.filter((e) => (e.action === 'resolve' || e.action === 'retire') && e.fact_id && facts.some((f) => f.id === e.fact_id))
      if (!mine.length) return toastError(t('review.conflicts.noEvent'))
      const newest = Math.max(...mine.map((e) => Date.parse(e.at)))
      const ids = mine.filter((e) => newest - Date.parse(e.at) < 5000).map((e) => e.id)
      await audit.undoIds(ids)
      toast(t('review.undone'), { icon: 'undo' })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    }
  }

  return (
    <PageShell
      title={t('nav.conflicts')}
      sub={t('review.conflicts.sub')}
      tabs={<Tabs value={tab} onChange={setTab} items={[['open', t('review.tabOpen'), data ? all.filter((c) => c.status === 'open').length : undefined], ['resolved', t('review.tabResolved'), data ? all.filter((c) => c.status === 'resolved').length : undefined]]} />}
    >
      {loading && !data ? (
        <div className="card p-5"><Skeleton rows={4} className="h-14" /></div>
      ) : error && !data ? (
        <div className="card">
          <Empty icon="alert" title={t('common.errorTitle')}>
            {t('common.loadError', { message: error })}
            <div className="mt-3"><button className="btn btn-outline btn-sm" onClick={() => void reload()}>{t('common.retry')}</button></div>
          </Empty>
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          <Empty icon="ok" title={tab === 'open' ? t('review.conflicts.emptyOpenT') : t('review.conflicts.emptyResT')}>
            {tab === 'open' ? t('review.conflicts.emptyOpenS') : t('review.conflicts.emptyResS')}
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          {list.map((c) => {
            const open = c.status === 'open'
            const win = c.resolution?.winning_fact_id
            const cols = c.facts.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'
            const winner = c.facts.find((f) => f.id === win)
            return (
              <article key={c.id} className="card overflow-hidden">
                <header className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[12px] text-muted-foreground">{c.id}</span>
                      {open ? (
                        <span className="badge conflict"><span className="bd"></span>{t('review.conflicts.open')}</span>
                      ) : (
                        <span className="badge ok">{t('review.conflicts.resolved')}</span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-[17px] font-semibold tracking-tight">{topic(c.topic)}</h2>
                    <p className="mt-1 text-[13.5px] text-muted-foreground max-w-[720px] leading-relaxed">{c.summary}</p>
                  </div>
                  <span className="text-[12px] text-muted-foreground whitespace-nowrap">{t('review.conflicts.detected', { date: fmtDateTime(c.detected_at) })}</span>
                </header>
                <div className={'px-5 pb-5 grid grid-cols-1 gap-3 ' + cols}>
                  {c.facts.map((f) => (
                    <FactCard
                      key={f.id}
                      fact={f}
                      win={!open && win === f.id}
                      lose={!open && !!win && win !== f.id}
                      binding={!open && win === f.id}
                      button={
                        open ? (
                          <button
                            className="btn btn-outline btn-sm mt-3 self-start"
                            {...attrs('resolve_conflict')}
                            onClick={guard('resolve_conflict', () => setDlg({ cid: c.id, fact: f, others: c.facts.filter((x) => x.id !== f.id) }))}
                          >
                            <Ic n="check" className="sm" />
                            {t('review.conflicts.keep')}
                          </button>
                        ) : null
                      }
                    />
                  ))}
                </div>
                {!open && c.resolution && (
                  <footer className="px-5 py-3 border-t bg-muted/30 flex items-center gap-3 text-[13px]">
                    <Avatar name={member(c.resolution.actor)} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{member(c.resolution.actor)}</span>{' '}
                      <span className="text-muted-foreground">
                        {winner ? t('review.conflicts.kept', { value: winner.value, doc: docLabel(winner.doc_id) }) : ''}
                        {c.resolution.resolved_at ? <> · <span className="mono">{fmtDate(c.resolution.resolved_at)}</span></> : null}
                      </span>
                      {c.resolution.reason && <div className="text-muted-foreground truncate">{c.resolution.reason}</div>}
                    </div>
                    <button className="btn btn-ghost btn-sm" {...attrs('resolve_conflict')} onClick={guard('resolve_conflict', () => void undoResolved(c.facts))}>
                      <UndoIcon />
                      {t('common.undo')}
                    </button>
                  </footer>
                )}
              </article>
            )
          })}
        </div>
      )}
      {dlg && (
        <ReasonDialog
          title={t('review.conflicts.keepTitle', { value: dlg.fact.value })}
          sub={t('review.conflicts.keepSub', { doc: docLabel(dlg.fact.doc_id), date: fmtDate(dlg.fact.date), count: dlg.others.length })}
          label={t('review.reason')}
          placeholder={t('review.conflicts.reasonPh')}
          confirm={t('review.conflicts.keepConfirm')}
          onClose={() => setDlg(null)}
          onSubmit={submit}
        />
      )}
    </PageShell>
  )
}
