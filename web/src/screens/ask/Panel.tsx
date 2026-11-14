import { useI18n } from '../../i18n'
import { usePerm } from '../../lib/perm'
import { useApp } from '../../lib/store'
import { Ic } from '../../ui/Icon'
import { sep, sourceLabel, splitValue, type AskResponse, type Chain, type ChainFact, type TopicView } from './model'

export type RetireForm = { id: string; reason: string; error: boolean } | null

type Props = {
  chain: Chain | undefined
  view: TopicView
  loading: boolean
  error: string | null
  /** False on step 1: only the placeholder is shown. */
  revealed: boolean
  onReveal: () => void
  /** Latest contested answer on this topic, if the topic has no binding value. */
  contested: AskResponse | null
  form: RetireForm
  setForm: (f: RetireForm) => void
  busy: boolean
  onRetire: (fact: ChainFact, reason: string) => void
  onRestore: (fact: ChainFact) => void
}

export default function Panel(p: Props) {
  const { t } = useI18n()
  const app = useApp()
  const head = (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold tracking-tight">{t('ask.panel.title')}</h2>
        <div className="mt-0.5 text-[13px] text-muted-foreground truncate">
          {[p.chain?.topic.label, app.project?.name].filter(Boolean).join(' · ')}
        </div>
      </div>
      {p.chain && <span className="mono text-[12px] text-muted-foreground mt-1 shrink-0">{p.chain.topic.id}</span>}
    </div>
  )

  if (!p.revealed)
    return (
      <>
        {head}
        <div className="rounded-[12px] border border-dashed px-5 py-6">
          <div className="text-[14.5px] font-medium">{t('ask.panel.placeholderTitle')}</div>
          <p className="mt-1.5 text-[14px] text-muted-foreground leading-relaxed">{t('ask.panel.placeholderText')}</p>
          <div className="mt-4 space-y-2" aria-hidden="true">
            <div className="skel h-14 !rounded-[10px]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skel h-12" />
              <div className="skel h-12" />
            </div>
          </div>
          <button className="btn btn-outline btn-sm mt-5" onClick={p.onReveal}>
            {t('ask.panel.show')} <Ic n="arrow" className="sm" />
          </button>
        </div>
      </>
    )

  if (!p.chain)
    return (
      <>
        {head}
        {p.error ? (
          <div className="rounded-[12px] border border-dashed px-5 py-6 text-[14px] text-muted-foreground">{t('ask.panel.loadError', { message: p.error })}</div>
        ) : (
          <div className="space-y-2" aria-hidden="true">
            <div className="skel h-28 !rounded-[12px]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="skel h-14" />
              <div className="skel h-14" />
            </div>
            <div className="skel h-24 !rounded-[12px]" />
          </div>
        )}
      </>
    )

  return (
    <>
      {head}
      {p.contested ? <ContestedPanel {...p} chain={p.chain} contested={p.contested} /> : <BindingPanel {...p} chain={p.chain} />}
    </>
  )
}

function BindingPanel(p: Props & { chain: Chain }) {
  const { t, fmtDate } = useI18n()
  const app = useApp()
  const { binding, replaced, stillActive, retired } = p.view
  return (
    <>
      {binding ? (
        <button
          className="block w-full text-left rounded-[12px] bg-primary-soft shadow-[inset_0_0_0_1px_hsl(var(--primary)/.3)] px-5 py-4 hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/.55)] transition"
          onClick={() => app.openFact(binding.id)}
        >
          <div className="flex items-center gap-2">
            <span className="badge binding">
              {binding.pinned && <Ic n="pin" className="sm" />}
              {t('ask.panel.binding')}
            </span>
            <span className="text-[13px] text-muted-foreground truncate">{t('ask.panel.fromThe', { doc: sourceLabel(binding) })}</span>
          </div>
          <div className="mt-3 mono text-[32px] leading-none font-medium tracking-tight text-primary-text">{binding.value}</div>
          <dl className="kv mt-4 !grid-cols-[64px_1fr] !gap-y-1 text-[13px]">
            <dt>{t('ask.panel.source')}</dt>
            <dd className="mono text-[12.5px] truncate">{binding.doc_id}</dd>
            <dt>{t('ask.panel.date')}</dt>
            <dd className="mono text-[12.5px]">{sep(fmtDate(binding.date))}</dd>
          </dl>
        </button>
      ) : (
        <div className="rounded-[12px] border border-dashed px-5 py-5 text-[14px] text-muted-foreground">{t('ask.panel.noBinding')}</div>
      )}

      {replaced.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-[13px] font-medium">{t('ask.panel.replaced', { count: replaced.length })}</h3>
          <div className="grid grid-cols-2 gap-2">
            {replaced.map((f) => (
              <button
                key={f.id}
                className="text-left rounded-[10px] px-3.5 py-3 shadow-[inset_0_0_0_1px_hsl(var(--border))] hover:bg-accent/60 transition min-w-0"
                onClick={() => app.openFact(f.id)}
              >
                <div className="text-[15px] font-medium strike truncate">{f.value}</div>
                <div className="mt-0.5 text-[12.5px] text-muted-foreground truncate">
                  <span className="mono">{sep(fmtDate(f.date))}</span> · {sourceLabel(f)}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {stillActive.map((f) => (
        <div key={f.id} className="mt-3">
          <StillActiveCard {...p} fact={f} bindingDoc={binding ? sourceLabel(binding) : ''} />
        </div>
      ))}
      {retired.map((f) => (
        <div key={f.id} className="mt-3">
          <RetiredCard {...p} fact={f} />
        </div>
      ))}

      <div className="mt-7">
        <ChainTable chain={p.chain} view={p.view} />
      </div>
      <a href="#/memory" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        {t('ask.panel.browseMemory')} <Ic n="arrow" className="sm" />
      </a>
    </>
  )
}

function FactHead({ fact, strong }: { fact: ChainFact; strong: boolean }) {
  const { fmtDate } = useI18n()
  const app = useApp()
  return (
    <button className="min-w-0 flex-1 text-left" onClick={() => app.openFact(fact.id)}>
      <div className={`text-[15px] ${strong ? 'font-semibold' : 'font-medium strike'}`}>{fact.value}</div>
      <div className="mt-0.5 text-[12.5px] text-muted-foreground">
        <span className="mono">{sep(fmtDate(fact.date))}</span> · {sourceLabel(fact)}
      </div>
    </button>
  )
}

function StillActiveCard(p: Props & { fact: ChainFact; bindingDoc: string }) {
  const { t } = useI18n()
  const perm = usePerm()
  const f = p.fact
  const form = p.form && p.form.id === f.id ? p.form : null
  return (
    <div className="rounded-[12px] px-4 py-3.5 bg-warning-soft/60 shadow-[inset_0_0_0_1px_hsl(var(--warning)/.45)]">
      <div className="flex items-start gap-3">
        <FactHead fact={f} strong />
        <span className="badge conflict">
          <span className="bd" />
          {t('ask.panel.stillActive')}
        </span>
      </div>
      {p.bindingDoc && <p className="mt-2 text-[13px] leading-relaxed text-warning-text">{t('ask.panel.stillActiveNote', { doc: p.bindingDoc })}</p>}
      {!form && (
        <div className="mt-3 flex justify-end">
          <button
            className="btn btn-outline btn-sm"
            {...perm.attrs('retire_fact')}
            onClick={perm.guard('retire_fact', () => p.setForm({ id: f.id, reason: t('ask.panel.reasonDefault'), error: false }))}
          >
            <Ic n="retire" className="sm" />
            {t('ask.panel.retire')}
          </button>
        </div>
      )}
      {form && (
        <div className="fade-in mt-3 pt-3 border-t border-warning/25">
          <label className="label" htmlFor={'reason-' + f.id}>
            {t('ask.panel.reason')}
          </label>
          <textarea
            id={'reason-' + f.id}
            className={`input !min-h-[64px] !text-[13.5px] ${form.error ? 'invalid' : ''}`}
            value={form.reason}
            onChange={(e) => p.setForm({ id: f.id, reason: e.target.value, error: false })}
          />
          {form.error ? (
            <div className="err">
              <Ic n="alert" className="sm" />
              {t('ask.panel.reasonError')}
            </div>
          ) : (
            <div className="help">{t('ask.panel.reasonHelp')}</div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => p.setForm(null)} disabled={p.busy}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary btn-sm" disabled={p.busy} {...perm.attrs('retire_fact')} onClick={perm.guard('retire_fact', () => p.onRetire(f, form.reason))}>
              {p.busy && <span className="spin" />}
              {t('ask.panel.confirmRetire')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RetiredCard(p: Props & { fact: ChainFact }) {
  const { t, fmtDate, isToday } = useI18n()
  const app = useApp()
  const perm = usePerm()
  const f = p.fact
  const when = isToday(f.retired_at) ? t('common.today') : sep(fmtDate(f.retired_at))
  const by = f.retired_by && app.me && (f.retired_by === app.me.member.id || f.retired_by === app.me.member.name) ? app.actorName : f.retired_by
  return (
    <div className="rounded-[12px] px-4 py-3.5 bg-muted/50 shadow-[inset_0_0_0_1px_hsl(var(--border))]">
      <div className="flex items-start gap-3">
        <FactHead fact={f} strong={false} />
        <span className="badge retired">{t('ask.panel.retired')}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-[13px]">
        <span className="text-muted-foreground">{by ? t('ask.panel.retiredBy', { name: by, when }) : t('ask.panel.retiredNoName', { when })}</span>
        <button className="btn btn-ghost btn-xs" disabled={p.busy} {...perm.attrs('restore_fact')} onClick={perm.guard('restore_fact', () => p.onRestore(f))}>
          <Ic n="restore" className="sm" />
          {t('ask.panel.restore')}
        </button>
      </div>
    </div>
  )
}

function ChainTable({ chain, view }: { chain: Chain; view: TopicView }) {
  const { t, fmtDateShort } = useI18n()
  const app = useApp()
  const b = view.binding
  // The row the assistant answers with: the stale figure while it is still active, the binding fact once it is gone.
  const aiId = view.stillActive.length ? view.stillActive[view.stillActive.length - 1].id : b?.id
  const changes = chain.changes ?? Math.max(0, chain.facts.length - 1)
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-[13px] font-medium">{t('ask.panel.tableTitle', { topic: chain.topic.label })}</h3>
        <span className="badge line">
          <Ic n="changed" className="sm" />
          {t('ask.panel.changed', { count: changes })}
        </span>
      </div>
      <div className="rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th className="!h-8">{t('ask.panel.colDate')}</th>
              <th className="!h-8">{t('ask.panel.colDocument')}</th>
              <th className="!h-8">{t('ask.panel.colSays')}</th>
              <th className="!h-8" />
            </tr>
          </thead>
          <tbody>
            {chain.facts.map((f) => {
              const isB = f.id === b?.id
              const dim = f.status === 'retired' || f.type === 'SUPERSEDED'
              return (
                <tr key={f.id} className={`${isB ? 'bg-primary-soft' : ''} hov`} onClick={() => app.openFact(f.id)}>
                  <td className={`!py-2 mono text-[12.5px] whitespace-nowrap ${isB ? '!text-primary-text' : 'text-muted-foreground'}`}>{sep(fmtDateShort(f.date))}</td>
                  <td className={`!py-2 text-[13px] ${isB ? 'font-medium' : ''}`}>{sourceLabel(f)}</td>
                  <td className={`!py-2 text-[13px] whitespace-nowrap ${isB ? 'font-semibold text-primary-text' : dim ? 'strike' : 'font-medium'}`}>{f.value}</td>
                  <td className="!py-2 text-right whitespace-nowrap">
                    {f.id === aiId && <span className={`badge ${isB ? 'binding' : 'conflict'} !h-[18px] !text-[11px]`}>{t('ask.panel.aiAnswer')}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ContestedPanel(p: Props & { chain: Chain; contested: AskResponse }) {
  const { t, fmtDate } = useI18n()
  const app = useApp()
  const tiles = p.contested.conflicts
  const tileIds = new Set(tiles.map((f) => f.id))
  const open = p.chain.facts.filter((f) => f.type === 'OPEN' && f.status === 'active')
  const rest = p.chain.facts.filter((f) => !tileIds.has(f.id) && f.type !== 'OPEN' && f.status === 'active')
  return (
    <>
      <div className="rounded-[12px] px-5 py-4 shadow-[inset_0_0_0_1px_hsl(var(--warning)/.5)] bg-warning-soft/40">
        <div className="flex items-center gap-2">
          <span className="badge contested">{t('ask.panel.contested')}</span>
          <span className="text-[13px] text-muted-foreground">{t('ask.panel.noBindingValue')}</span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed">{t('ask.panel.contestedText', { count: tiles.length })}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((f) => {
          const [value, who] = splitValue(f.value)
          return (
            <button key={f.id} className="flex flex-col items-start justify-start text-left rounded-[10px] px-3.5 py-3 shadow-[inset_0_0_0_1px_hsl(var(--warning)/.45)] hover:bg-accent/60 transition min-w-0" onClick={() => app.openFact(f.id)}>
              <div className="mono text-[15px] font-medium">{value}</div>
              {who && <div className="mt-0.5 text-[12.5px] text-muted-foreground">{who.split(',')[0]}</div>}
            </button>
          )
        })}
      </div>
      {open.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-[13px] font-medium">{t('ask.panel.openQuestion')}</h3>
          {open.map((f) => (
            <button key={f.id} className="block w-full text-left rounded-[12px] px-4 py-3.5 bg-open-soft shadow-[inset_0_0_0_1px_hsl(var(--open)/.25)] mb-2" onClick={() => app.openFact(f.id)}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14.5px] font-medium">{f.value}</span>
                <span className="badge open">
                  <span className="bd" />
                  {t('ask.panel.open')}
                </span>
              </div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {sourceLabel(f)} · <span className="mono">{sep(fmtDate(f.date))}</span>
              </div>
            </button>
          ))}
        </>
      )}
      {rest.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-[13px] font-medium">{t('ask.panel.alsoOnTopic')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {rest.map((f) => (
              <button key={f.id} className="flex flex-col items-start justify-start text-left rounded-[10px] px-3.5 py-3 shadow-[inset_0_0_0_1px_hsl(var(--border))] hover:bg-accent/60 transition min-w-0" onClick={() => app.openFact(f.id)}>
                <div className="text-[14px] font-medium">{f.value}</div>
                <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {sourceLabel(f)} · <span className="mono">{sep(fmtDate(f.date))}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <a href="#/open-questions" className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        {t('ask.panel.reviewOpen')} <Ic n="arrow" className="sm" />
      </a>
    </>
  )
}
