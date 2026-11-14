import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n'
import { headline } from '../../lib/facts'
import { useApp } from '../../lib/store'
import { Avatar, Ic, Logo } from '../../ui/Icon'
import { sep, sourceLabel, splitValue, type AskResponse, type ChainFact } from './model'

export type Item =
  | { k: 'divider'; id: number; key: string; params?: Record<string, string | number> }
  | { k: 'user'; id: number; text: string; at: string }
  | { k: 'answer'; id: number; res: AskResponse; at: string }
  | { k: 'pending'; id: number }
  | { k: 'error'; id: number; message: string }

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="fade-in flex items-center gap-3 text-[12.5px] font-medium text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export function UserMsg({ text, time }: { text: string; time: string }) {
  const app = useApp()
  return (
    <div className="fade-in flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="mono">{time}</span>
        <span>{app.actorName}</span>
        <Avatar name={app.me?.member.name} />
      </div>
      <div className="max-w-[560px] bg-muted rounded-[12px] rounded-tr-[4px] px-4 py-2.5 text-[15px] leading-relaxed">{text}</div>
    </div>
  )
}

function Cite({ id, children }: { id: string; children: ReactNode }) {
  const app = useApp()
  return (
    <button className="cite" onClick={() => app.openFact(id)}>
      {children}
    </button>
  )
}

function CanonicoMeta({ time, badge }: { time: string; badge: ReactNode }) {
  const { t } = useI18n()
  const app = useApp()
  return (
    <div className="flex items-center gap-2 mb-2 text-[12.5px]">
      <Logo size={24} />
      <span className="font-medium text-foreground">{t('shell.product')}</span>
      <span className="text-muted-foreground truncate">{app.scope === 'org' ? t('shell.wholeOrg') : app.project?.name}</span>
      <span className="mono text-muted-foreground">{time}</span>
      {badge}
    </div>
  )
}

/** "Last Monday": the plain company assistant returned the stale figure. */
export function WrongAnswer({ fact }: { fact: ChainFact | undefined }) {
  const { t, fmtDate } = useI18n()
  return (
    <div className="fade-in max-w-[600px]">
      <div className="flex items-center gap-2 mb-2 text-[12.5px]">
        <span className="avatar sys">
          <Ic n="ask" className="sm" />
        </span>
        <span className="font-medium text-foreground">{t('ask.companyAssistant')}</span>
        <span className="text-muted-foreground">{t('ask.plainRetrievalTag')}</span>
        <span className="mono text-muted-foreground">{t('ask.monTime')}</span>
      </div>
      <div className="relative card px-5 py-4 pr-28">
        <div className="text-[22px] font-semibold tracking-tight strike">{t('ask.oldAnswer')}</div>
        <div className="mt-1 text-[13.5px] text-muted-foreground min-h-[20px]">
          {fact && (
            <>
              {t('ask.from')} <Cite id={fact.id}>{sourceLabel(fact)}</Cite> · <span className="mono">{sep(fmtDate(fact.date))}</span>
            </>
          )}
        </div>
        <span
          className="absolute right-4 top-1/2 -translate-y-1/2 -rotate-6 select-none rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[.12em] text-destructive/90 shadow-[inset_0_0_0_1.5px_hsl(var(--destructive)/.55)]"
          aria-label={t('ask.wrongAria')}
        >
          {t('ask.wrong')}
        </span>
      </div>
    </div>
  )
}

function Compare({ res }: { res: AskResponse }) {
  const { t } = useI18n()
  const [on, setOn] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (on) box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [on])
  const hit = res.plain_retrieval
  return (
    <>
      <button role="switch" aria-checked={on} onClick={() => setOn((v) => !v)} className="mt-4 inline-flex items-center gap-2.5 text-[13px] text-muted-foreground hover:text-foreground">
        <span className={`switch ${on ? 'on' : ''}`} />
        {t('ask.compare')}
      </button>
      {on && (
        <div className="fade-in mt-3 rounded-[12px] border border-dashed px-4 py-3" ref={box}>
          {hit ? (
            <>
              <div className="text-[12.5px] text-muted-foreground mb-1">
                {t('ask.plainHit')} <span className="mono">{hit.doc_id.split('/').pop()}</span>
              </div>
              <div className="text-[15px]">“{hit.quote}”</div>
              <div className="text-[13px] mt-1 text-muted-foreground">{t('ask.plainNote')}</div>
            </>
          ) : (
            <div className="text-[13.5px] text-muted-foreground">{t('ask.plainNone')}</div>
          )}
        </div>
      )}
    </>
  )
}

function ChangedNote({ children }: { children: ReactNode }) {
  return (
    <div className="fade-in mb-3 flex gap-3 rounded-[12px] bg-primary-soft/70 shadow-[inset_0_0_0_1px_hsl(var(--primary)/.18)] px-4 py-3 text-[14px] leading-relaxed">
      <span className="mt-0.5 text-primary-text">
        <Ic n="changed" />
      </span>
      <div>{children}</div>
    </div>
  )
}

function BindingAnswer({ res, time, titles }: { res: AskResponse; time: string; titles: Record<string, string> }) {
  const { t, fmtDate } = useI18n()
  const f = res.binding!
  const reason = res.changed_because?.replace(/[.\s]+$/, '')
  return (
    <div className="fade-in max-w-[600px]">
      <CanonicoMeta time={time} badge={<span className="badge binding">{t('ask.bindingBadge')}</span>} />
      {f.pinned ? (
        <ChangedNote>
          <span className="font-medium">{t('ask.pinnedWins')}</span> <span className="text-muted-foreground">{t('ask.pinnedWinsNote', { value: f.value })}</span>
        </ChangedNote>
      ) : reason ? (
        <ChangedNote>
          <span className="font-medium">{t('ask.changedBecause', { reason })}</span> <span className="text-muted-foreground">{t('ask.changedKept')}</span>
        </ChangedNote>
      ) : null}
      <div className="card px-5 py-4">
        <div className="text-[22px] font-semibold tracking-tight">{headline(res.answer)}</div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[13.5px] text-muted-foreground">
          <span>
            {t('ask.from')} <Cite id={f.id}>{sourceLabel(f, titles)}</Cite> · <span className="mono">{sep(fmtDate(f.date))}</span>
          </span>
          <span className="badge ok !h-[22px] !text-[12px]">
            <span className="text-success">
              <Ic n="check" className="sm" />
            </span>
            {t('ask.noTicket')}
          </span>
        </div>
        <blockquote className="quote mt-4 !text-[14px]">“{f.quote}”</blockquote>
      </div>
      <Compare res={res} />
    </div>
  )
}

function ContestedAnswer({ res, time, titles }: { res: AskResponse; time: string; titles: Record<string, string> }) {
  const { t, fmtDate } = useI18n()
  const [reveal, setReveal] = useState<string | null>(null)
  const r = res.conflicts.find((f) => f.id === reveal)
  const cols = res.conflicts.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'
  return (
    <div className="fade-in max-w-[640px]">
      <CanonicoMeta time={time} badge={<span className="badge contested">{t('ask.contestedBadge')}</span>} />
      <div className="card px-5 py-4">
        <div className="text-[20px] font-semibold tracking-tight">{t('ask.contestedTitle')}</div>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{res.answer}</p>
        <div className={`mt-4 grid ${cols} gap-2`}>
          {res.conflicts.map((f) => {
            const [value, who] = splitValue(f.value)
            const on = reveal === f.id
            return (
              <button
                key={f.id}
                onClick={() => setReveal(on ? null : f.id)}
                aria-pressed={on}
                className={`flex flex-col items-start justify-start text-left rounded-[12px] px-4 py-3 transition ${on ? 'bg-card shadow-[inset_0_0_0_1.5px_hsl(var(--warning)/.7)]' : 'bg-muted hover:shadow-[inset_0_0_0_1px_hsl(var(--foreground)/.2)]'}`}
              >
                <div className="mono text-[18px] font-medium leading-snug">{value}</div>
                {who && <div className="text-[13px] text-muted-foreground mt-0.5">{who}</div>}
              </button>
            )
          })}
        </div>
        {r ? (
          <blockquote className="quote mt-3 fade-in">
            “{r.quote}”
            <div className="text-[12.5px] text-muted-foreground mt-1">
              <Cite id={r.id}>{sourceLabel(r, titles)}</Cite> · <span className="mono">{sep(fmtDate(r.date))}</span>
            </div>
          </blockquote>
        ) : (
          <div className="mt-3 text-[13px] text-muted-foreground">{t('ask.selectEstimate')}</div>
        )}
      </div>
      <Compare res={res} />
    </div>
  )
}

function NoAnswer({ res, time }: { res: AskResponse; time: string }) {
  const { t } = useI18n()
  return (
    <div className="fade-in max-w-[600px]">
      <CanonicoMeta time={time} badge={<span className="badge line">{t('ask.noAnswerBadge')}</span>} />
      <div className="card px-5 py-4">
        <div className="text-[18px] font-semibold tracking-tight">{t('ask.noAnswerTitle')}</div>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{res.answer}</p>
      </div>
      <Compare res={res} />
    </div>
  )
}

export function Answer({ res, time, titles }: { res: AskResponse; time: string; titles: Record<string, string> }) {
  if (res.status === 'binding' && res.binding) return <BindingAnswer res={res} time={time} titles={titles} />
  if (res.status === 'contested') return <ContestedAnswer res={res} time={time} titles={titles} />
  return <NoAnswer res={res} time={time} />
}

export function Pending() {
  const { t } = useI18n()
  return (
    <div className="fade-in max-w-[600px]">
      <div className="flex items-center gap-2 mb-2 text-[12.5px]">
        <Logo size={24} />
        <span className="font-medium text-foreground">{t('shell.product')}</span>
        <span className="text-muted-foreground">{t('ask.thinking')}</span>
      </div>
      <div className="skel h-[104px] !rounded-[12px]" aria-hidden="true" />
    </div>
  )
}

export function AskError({ message }: { message: string }) {
  const { t } = useI18n()
  return (
    <div className="fade-in max-w-[600px] flex gap-3 rounded-[12px] px-4 py-3 text-[14px] shadow-[inset_0_0_0_1px_hsl(var(--destructive)/.4)]">
      <span className="mt-0.5 text-destructive">
        <Ic n="alert" />
      </span>
      <div>{t('ask.askFailed', { message })}</div>
    </div>
  )
}
