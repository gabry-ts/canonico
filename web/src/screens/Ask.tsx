import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, call, client, errMsg } from '../api/client'
import { useI18n } from '../i18n'
import { docLabel } from '../lib/facts'
import { usePerm } from '../lib/perm'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { Ic } from '../ui/Icon'
import { toast, toastError } from '../ui/toast'
import { Answer, AskError, Divider, Pending, UserMsg, WrongAnswer, type Item } from './ask/Chat'
import { DEMO, viewOf, type AskResponse, type ChainFact } from './ask/model'
import Panel, { type RetireForm } from './ask/Panel'

const LAST = 7

export default function Ask() {
  const { t, fmtTime } = useI18n()
  const app = useApp()
  const perm = usePerm()
  const QS = t('ask.question')

  const [step, setStep] = useState(1)
  const [revealed, setRevealed] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [topic, setTopic] = useState(DEMO.topic)
  const [contested, setContested] = useState<AskResponse | null>(null)
  const [form, setFormState] = useState<RetireForm>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState(QS)
  const [oldFact, setOldFact] = useState<ChainFact | undefined>(undefined)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const seq = useRef(1)
  const todayShown = useRef(false)
  const chatRef = useRef<HTMLDivElement>(null)

  const chainApi = useApi(async () => {
    const c = await call(client.GET('/topics/{topic_id}/chain', { params: { path: { topic_id: topic } } }))
    // Keep what later steps still need once the panel moves to another topic:
    // the old fact shown under "Last Monday" and the document titles seen so far.
    if (c.topic.id === DEMO.topic) setOldFact(c.facts.find((f) => f.id === DEMO.oldFact) ?? undefined)
    setTitles((prev) => {
      const next = { ...prev }
      for (const f of c.facts) if (f.doc_title) next[f.doc_id] = f.doc_title
      return next
    })
    return c
  }, [topic, app.version])
  const chain = chainApi.data && chainApi.data.topic.id === topic ? chainApi.data : undefined
  const view = useMemo(() => viewOf(chain), [chain])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [items])

  const ask = useCallback(
    async (question: string): Promise<AskResponse | null> => {
      const q = question.trim()
      if (!q) return null
      const pendingId = seq.current++
      const add: Item[] = []
      if (!todayShown.current) {
        todayShown.current = true
        add.push({ k: 'divider', id: seq.current++, key: 'ask.today' })
      }
      add.push({ k: 'user', id: seq.current++, text: q, at: new Date().toISOString() }, { k: 'pending', id: pendingId })
      setItems((prev) => [...prev, ...add])
      try {
        const res = await call(client.POST('/ask', { body: { question: q, project_id: app.pid, include_plain_retrieval: true } }))
        setItems((prev) => prev.map((i) => (i.id === pendingId ? { k: 'answer', id: pendingId, res, at: new Date().toISOString() } : i)))
        const tp = res.binding?.topic ?? res.conflicts[0]?.topic
        if (tp) {
          setTopic(tp)
          setContested(res.status === 'contested' ? res : null)
          setRevealed(true)
        }
        void app.refresh()
        return res
      } catch (e) {
        setItems((prev) => prev.map((i) => (i.id === pendingId ? { k: 'error', id: pendingId, message: errMsg(e) } : i)))
        return null
      }
    },
    [app],
  )

  const clearChat = () => {
    setItems([])
    todayShown.current = false
  }

  const setForm = (f: RetireForm) => {
    setFormState(f)
    if (f && step === 2) setStep(3)
    if (!f && step === 3) setStep(2)
  }

  const retire = async (fact: ChainFact, reason: string) => {
    if (busy) return
    if (!reason.trim()) {
      setFormState({ id: fact.id, reason, error: true })
      return
    }
    setBusy(true)
    try {
      // The backend explains what changed only against an earlier answer to the same question:
      // record the answer as it stands before the retirement.
      if (step <= 3) await call(client.POST('/ask', { body: { question: QS, project_id: app.pid, include_plain_retrieval: false } })).catch(() => null)
      // The display name is sent as actor so the history reads "retired by Giulia".
      await call(client.POST('/facts/{fact_id}/retire', { params: { path: { fact_id: fact.id } }, body: { reason: reason.trim(), actor: app.actorName || app.actor } }))
      setFormState(null)
      toast(t('ask.panel.retiredToast', { value: fact.value }))
      await chainApi.reload()
      void app.refresh()
      if (step <= 3) {
        setStep(4)
        setInput(QS)
        await ask(QS)
      }
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (fact: ChainFact, replay = false) => {
    if (busy) return
    setBusy(true)
    try {
      await call(client.POST('/facts/{fact_id}/restore', { params: { path: { fact_id: fact.id } }, body: { actor: app.actorName || app.actor } }))
      toast(t('ask.panel.restoredToast', { value: fact.value }))
      if (replay) clearChat()
      if (step === 4) setStep(2)
      await chainApi.reload()
      void app.refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await call(client.POST('/demo/reset'))
      clearChat()
      setFormState(null)
      setContested(null)
      setTopic(DEMO.topic)
      setRevealed(false)
      setInput(QS)
      setStep(1)
      toast(t('ask.resetDone'))
      await app.refresh()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const pushDivider = (key: string, params: Record<string, string | number>) => setItems((prev) => [...prev, { k: 'divider', id: seq.current++, key, params }])

  /** Shows the onboarding topic in the panel again (after the contested question). */
  const backToDemoTopic = () => {
    setContested(null)
    setTopic(DEMO.topic)
  }

  const sendEmail = async () => {
    setBusy(true)
    try {
      let projectName = app.project?.name ?? ''
      try {
        const r = await call(client.POST('/demo/send-email'))
        projectName = app.projects.find((p) => p.id === r.routed_project_id)?.name ?? projectName
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e
        toast(t('ask.emailAlready'), { icon: 'info' })
      }
      pushDivider('ask.emailDivider', { project: projectName })
      backToDemoTopic()
      setStep(6)
      setInput(QS)
      await ask(QS)
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const uploadVersion = async () => {
    setBusy(true)
    try {
      const r = await call(client.POST('/documents/{doc_id}/versions', { params: { path: { doc_id: DEMO.libraryDoc } }, body: { text: DEMO.versionText } }))
      const label = docLabel(DEMO.libraryDoc)
      const title = titles[DEMO.libraryDoc] ?? label.charAt(0).toUpperCase() + label.slice(1)
      pushDivider('ask.versionDivider', { title, version: r.version.version })
      backToDemoTopic()
      setStep(7)
      setInput(QS)
      await ask(QS)
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }

  const retireTarget = topic === DEMO.topic ? view.stillActive[0] : undefined

  const next = async () => {
    if (busy) return
    if (step === 1) {
      setRevealed(true)
      setStep(2)
    } else if (step === 2) {
      if (retireTarget) perm.guard('retire_fact', () => setForm({ id: retireTarget.id, reason: t('ask.panel.reasonDefault'), error: false }))()
      else {
        setStep(4)
        setInput(QS)
        await ask(QS)
      }
    } else if (step === 3) {
      const fact = form && view.stillActive.find((f) => f.id === form.id)
      if (fact && form) perm.guard('retire_fact', () => void retire(fact, form.reason))()
      else setStep(2)
    } else if (step === 4) {
      const q2 = t('ask.question2')
      setStep(5)
      setInput(q2)
      await ask(q2)
    } else if (step === 5) await sendEmail()
    else if (step === 6) await uploadVersion()
    else perm.guard('admin_demo', () => void reset())()
  }

  const back = async () => {
    if (busy) return
    if (step === 2) {
      setRevealed(false)
      setStep(1)
    } else if (step === 3) setForm(null)
    else if (step === 4) {
      const fact = view.retired.find((f) => f.id === DEMO.oldFact) ?? view.retired[view.retired.length - 1]
      if (fact) perm.guard('restore_fact', () => void restore(fact, true))()
      else {
        clearChat()
        setStep(2)
      }
    }
  }

  const keys = useRef({ next, back })
  useEffect(() => {
    keys.current = { next, back }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('.scrim')) return
      if (e.key === 'ArrowRight') void keys.current.next()
      if (e.key === 'ArrowLeft') void keys.current.back()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const nextLabel =
    step === 1
      ? t('ask.next.openMemory')
      : step === 2
        ? retireTarget
          ? t('ask.next.retire', { value: retireTarget.value })
          : t('ask.next.askAgain')
        : step === 3
          ? t('ask.next.confirmRetire')
          : step === 4
            ? t('ask.next.nextQuestion')
            : step === 5
              ? t('ask.next.sendEmail')
              : step === 6
                ? t('ask.next.uploadVersion')
                : t('ask.restart')
  const nextPerm = step === 2 && retireTarget ? 'retire_fact' : step === 3 ? 'retire_fact' : step === LAST ? 'admin_demo' : null
  const scopeName = app.scope === 'org' ? t('shell.wholeOrg') : (app.project?.name ?? '')

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 h-11 border-b bg-muted/40 flex items-center gap-4 px-4 lg:px-5">
        <span className="text-[12px] font-medium text-muted-foreground shrink-0 hidden md:inline">{t('ask.demo')}</span>
        <div className="flex items-center gap-1 shrink-0">
          {Array.from({ length: LAST }, (_, i) => {
            const n = i + 1
            const label = t(`ask.steps.s${n}.label`)
            const cls = step === n ? 'on' : step > n ? 'done' : ''
            return (
              <span key={n} className="flex items-center gap-1">
                <span
                  className={`flex items-center gap-1.5 ${step === n ? 'text-foreground' : 'text-muted-foreground'}`}
                  data-tip={`${n}. ${label}`}
                  aria-label={t('ask.stepLabel', { n, label })}
                  aria-current={step === n ? 'step' : undefined}
                >
                  <span className={`step-dot mono ${cls}`}>{n}</span>
                  {step === n && <span className="text-[13px] font-medium pr-0.5 whitespace-nowrap">{label}</span>}
                </span>
                {n < LAST && <span className="w-2.5 h-px bg-border" />}
              </span>
            )
          })}
        </div>
        <p className="flex-1 min-w-0 truncate text-[13px] text-muted-foreground">{t(`ask.steps.s${step}.caption`)}</p>
        <div className="flex items-center gap-1 shrink-0">
          {step < LAST && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              disabled={busy}
              aria-label={t('ask.restart')}
              {...perm.attrs('admin_demo')}
              data-tip={perm.can('admin_demo') ? t('ask.restartTip') : perm.attrs('admin_demo')['data-tip']}
              onClick={() => perm.guard('admin_demo', () => void reset())()}
            >
              <Ic n="restore" className="sm" />
            </button>
          )}
          {step >= 2 && step <= 4 && (
            <button className="btn btn-ghost btn-sm" onClick={() => void back()} disabled={busy}>
              <Ic n="arrowl" className="sm" />
              {t('ask.back')}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => void next()} disabled={busy} {...(nextPerm ? perm.attrs(nextPerm) : {})}>
            {busy && <span className="spin" />}
            {nextLabel}
            <Ic n={step >= LAST ? 'restore' : 'arrow'} className="sm" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,500px)] xl:grid-cols-[minmax(0,1fr)_540px]">
        <section className="flex flex-col min-h-0" aria-label={t('ask.chatAria')}>
          <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto scroll px-6 xl:px-12 py-8">
            <div className="max-w-[720px] mx-auto space-y-6">
              <Divider>{t('ask.lastMonday')}</Divider>
              <UserMsg text={QS} time={t('ask.monTime')} />
              <WrongAnswer fact={oldFact} />
              {items.map((i) =>
                i.k === 'divider' ? (
                  <Divider key={i.id}>{t(i.key, i.params)}</Divider>
                ) : i.k === 'user' ? (
                  <UserMsg key={i.id} text={i.text} time={fmtTime(i.at)} />
                ) : i.k === 'answer' ? (
                  <Answer key={i.id} res={i.res} time={fmtTime(i.at)} titles={titles} />
                ) : i.k === 'pending' ? (
                  <Pending key={i.id} />
                ) : (
                  <AskError key={i.id} message={i.message} />
                ),
              )}
            </div>
          </div>
          <div className="shrink-0 px-6 xl:px-12 pb-5 pt-2">
            <div className="max-w-[720px] mx-auto">
              <form
                className="flex items-center gap-3 rounded-[12px] bg-card shadow-[inset_0_0_0_1px_hsl(var(--input))] px-4 h-12 focus-within:shadow-[inset_0_0_0_1px_hsl(var(--ring)),0_0_0_3px_hsl(var(--ring)/.15)]"
                onSubmit={(e) => {
                  e.preventDefault()
                  void ask(input)
                }}
              >
                <input
                  className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground min-w-0"
                  placeholder={t('ask.composer')}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  aria-label={t('ask.composerAria')}
                />
                <span className="hidden md:inline text-[12px] text-muted-foreground shrink-0">
                  {t('ask.asking')} <span className="text-foreground font-medium">{scopeName}</span>
                </span>
                <button type="submit" className="btn btn-primary btn-icon btn-sm" aria-label={t('ask.askAria')} disabled={!input.trim()}>
                  <Ic n="send" className="sm" />
                </button>
              </form>
              <div className="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
                <span>
                  <span className="kbd">→</span> {t('ask.hintNext')}
                </span>
                <span>
                  <span className="kbd">←</span> {t('ask.hintBack')}
                </span>
                <span className="ml-auto truncate">{t('ask.hintCite')}</span>
              </div>
            </div>
          </div>
        </section>
        <aside className="hidden lg:flex flex-col min-h-0 border-l bg-card" aria-label={t('ask.panel.title')}>
          <div className="flex-1 min-h-0 overflow-y-auto scroll px-6 py-6">
            <Panel
              chain={chain}
              view={view}
              loading={chainApi.loading}
              error={chainApi.error}
              revealed={revealed}
              onReveal={() => {
                setRevealed(true)
                if (step === 1) setStep(2)
              }}
              contested={contested && contested.conflicts[0]?.topic === topic ? contested : null}
              form={form}
              setForm={setForm}
              busy={busy}
              onRetire={(f, reason) => void retire(f, reason)}
              onRestore={(f) => void restore(f)}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
