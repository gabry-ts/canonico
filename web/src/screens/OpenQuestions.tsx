import { useState } from 'react'
import { call, client } from '../api/client'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { usePerm } from '../lib/perm'
import { useI18n } from '../i18n'
import { docLabel } from '../lib/facts'
import { Empty, Skeleton } from '../ui/overlays'
import { toast } from '../ui/toast'
import { FactCard, PageShell, ReasonDialog, Tabs, UndoIcon, useAuditActions, useFact, useTopicNames } from './review/common'
import { errMsg } from '../api/client'
import { toastError } from '../ui/toast'
import type { Schemas } from '../api/client'

type OQ = Schemas['OpenQuestion']

function Candidates({ q, value, onChange }: { q: OQ; value: string | null; onChange: (id: string | null) => void }) {
  const { pid } = useApp()
  const { t, fmtDate } = useI18n()
  const { data, loading } = useApi(() => call(client.GET('/facts', { params: { query: { project_id: pid, topic: q.topic, status: 'active', limit: 100 } } })), [q.id])
  const facts = (data?.items ?? []).filter((f) => f.id !== q.fact_id)
  return (
    <div className="mb-4">
      <div className="label">{t('review.oq.pickLabel')}</div>
      {loading ? (
        <Skeleton rows={2} className="h-10" />
      ) : facts.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('review.oq.noCandidates')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto scroll">
          {facts.map((f) => (
            <label key={f.id} className={'flex items-start gap-2.5 rounded-[10px] p-2.5 cursor-pointer ' + (value === f.id ? 'shadow-[inset_0_0_0_1.5px_hsl(var(--primary))]' : 'shadow-[inset_0_0_0_1px_hsl(var(--border))]')}>
              <input type="radio" name="oqpick" className="mt-1" checked={value === f.id} onChange={() => onChange(f.id)} />
              <span className="min-w-0 text-[13.5px]">
                <span className="font-medium">{f.value}</span>
                <span className="block text-[12px] text-muted-foreground">{docLabel(f.doc_id)} · <span className="mono">{f.id}</span> · <span className="mono">{fmtDate(f.date)}</span></span>
              </span>
            </label>
          ))}
          {value && <button className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>{t('review.oq.noPick')}</button>}
        </div>
      )}
    </div>
  )
}

function CloseDialog({ q, onClose, onDone }: { q: OQ; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { t } = useI18n()
  const { actor } = useApp()
  const audit = useAuditActions()
  const [pick, setPick] = useState<string | null>(null)
  return (
    <ReasonDialog
      title={t('review.oq.closeTitle')}
      sub={q.question}
      label={t('review.oq.noteLabel')}
      placeholder={t('review.oq.notePh')}
      confirm={t('review.oq.closeConfirm')}
      required={!pick}
      extra={<Candidates q={q} value={pick} onChange={setPick} />}
      onClose={onClose}
      onSubmit={async (note) => {
        const ids = await audit.withEvents(
          () => call(client.POST('/open-questions/{question_id}/close', { params: { path: { question_id: q.id } }, body: { actor, ...(pick ? { answer_fact_id: pick } : {}), ...(note ? { note } : {}) } })),
          ['close'],
        )
        onDone(ids)
      }}
    />
  )
}

function Body({ q }: { q: OQ }) {
  const { t, fmtDate } = useI18n()
  const f = useFact(q.fact_id)
  const ans = useFact(q.answer_fact_id)
  return (
    <div className="px-5 pb-5">
      {f ? <FactCard fact={f} /> : <div className="skel h-24" />}
      <div className="mt-2 text-[12.5px] text-muted-foreground">{docLabel(q.doc_id)} · <span className="mono">{fmtDate(q.opened_at)}</span></div>
      {q.status === 'closed' && ans && (
        <div className="mt-3"><div className="text-[12.5px] text-muted-foreground mb-1.5">{t('review.oq.answeredBy')}</div><FactCard fact={ans} win binding /></div>
      )}
    </div>
  )
}

export default function OpenQuestions() {
  const { t, fmtDate } = useI18n()
  const { pid, version, refresh } = useApp()
  const { attrs, guard } = usePerm()
  const topic = useTopicNames()
  const audit = useAuditActions()
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const [dlg, setDlg] = useState<OQ | null>(null)
  const { data, error, loading, reload } = useApi(
    // The API returns one status per call (default: open), so load both for the two tabs.
    async () =>
      (
        await Promise.all(
          (['open', 'closed'] as const).map((status) => call(client.GET('/open-questions', { params: { query: { project_id: pid, status } } }))),
        )
      ).flat(),
    [pid, version],
  )

  const all = data ?? []
  const list = all.filter((o) => o.status === tab)

  const reopen = async (q: OQ) => {
    try {
      const ev = await audit.list()
      const mine = ev.filter((e) => e.action === 'close' && e.fact_id === q.fact_id)
      if (!mine.length) return toastError(t('review.conflicts.noEvent'))
      await audit.undoIds([mine[0].id])
      toast(t('review.undone'), { icon: 'undo' })
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    }
  }

  return (
    <PageShell
      title={t('nav.open-questions')}
      sub={t('review.oq.sub')}
      tabs={<Tabs value={tab} onChange={setTab} items={[['open', t('review.tabOpen'), data ? all.filter((o) => o.status === 'open').length : undefined], ['closed', t('review.oq.tabClosed'), data ? all.filter((o) => o.status === 'closed').length : undefined]]} />}
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
          <Empty icon="question" title={tab === 'open' ? t('review.oq.emptyOpenT') : t('review.oq.emptyClosedT')}>
            {tab === 'open' ? t('review.oq.emptyOpenS') : t('review.oq.emptyClosedS')}
          </Empty>
        </div>
      ) : (
        <div className="space-y-5">
          {list.map((q) => (
            <article key={q.id} className="card overflow-hidden">
              <header className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mono text-[12px] text-muted-foreground">{q.id}</span>
                    {q.status === 'closed' ? <span className="badge ok">{t('review.oq.closed')}</span> : <span className="badge open"><span className="bd"></span>{t('review.conflicts.open')}</span>}
                    <span className="text-[12.5px] text-muted-foreground">{topic(q.topic)}</span>
                  </div>
                  <h2 className="mt-1.5 text-[17px] font-semibold tracking-tight">{q.question}</h2>
                  {q.note && <p className="mt-1 text-[13.5px] text-muted-foreground leading-relaxed">{q.note}</p>}
                  {q.closed_at && <p className="mt-1 text-[12.5px] text-muted-foreground">{t('review.oq.closedOn', { date: fmtDate(q.closed_at) })}</p>}
                </div>
                {q.status === 'open' ? (
                  <button className="btn btn-outline btn-sm shrink-0" {...attrs('resolve_conflict')} onClick={guard('resolve_conflict', () => setDlg(q))}>
                    {t('review.oq.close')}
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm shrink-0" {...attrs('resolve_conflict')} onClick={guard('resolve_conflict', () => void reopen(q))}>
                    <UndoIcon />
                    {t('review.oq.reopen')}
                  </button>
                )}
              </header>
              <Body q={q} />
            </article>
          ))}
        </div>
      )}
      {dlg && (
        <CloseDialog
          q={dlg}
          onClose={() => setDlg(null)}
          onDone={async (ids) => {
            setDlg(null)
            setTab('closed')
            await refresh()
            toast(t('review.oq.done'), { long: true, action: ids.length ? { label: t('common.undo'), run: () => void audit.undoWithToast(ids) } : undefined })
          }}
        />
      )}
    </PageShell>
  )
}
