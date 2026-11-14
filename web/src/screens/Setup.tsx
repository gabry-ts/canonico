import { useEffect, useRef, useState } from 'react'
import { ApiError, call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { nav } from '../lib/router'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { Ic, Logo } from '../ui/Icon'
import { toast, toastError } from '../ui/toast'
import { FieldErr } from './org/ui'

type Job = Schemas['IngestJob']

export default function Setup() {
  const { t } = useI18n()
  const app = useApp()
  const status = useApi(() => call(client.GET('/org/setup/status')), [])
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Record<string, string>>({})
  const [org, setOrg] = useState({ name: '', domain: '', admin: '', email: '' })
  const [mail, setMail] = useState({ mode: 'imap_mock' as 'imap_mock' | 'webhook', host: '', user: '', inbound: '' })
  const [proj, setProj] = useState({ name: '', desc: '', rule: true })
  const [job, setJob] = useState<Job | null>(null)
  
  const timer = useRef<number | undefined>(undefined)
  const done = job?.status === 'done'
  const failed = job?.status === 'error'
  const running = !!job && !done && !failed

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const dom = org.domain.trim()
  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (step === 1) {
      if (!org.name.trim()) e.name = t('org.setup.errName')
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(dom)) e.domain = t('org.setup.errDomain')
      if (!org.admin.trim()) e.admin = t('org.setup.errAdmin')
      if (!org.email.toLowerCase().endsWith('@' + dom.toLowerCase())) e.email = t('org.setup.errEmail', { domain: dom || '…' })
    }
    if (step === 2 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.inbound)) e.inbound = t('org.setup.errInbound')
    if (step === 3 && !proj.name.trim()) e.project = t('org.setup.errProject')
    setErr(e)
    return !Object.keys(e).length
  }

  const mailBody = () => ({
    mode: mail.mode,
    imap_host: mail.mode === 'imap_mock' ? mail.host || null : null,
    imap_user: mail.mode === 'imap_mock' ? mail.user || null : null,
    inbound_address: mail.inbound,
    poll_interval_s: 60,
  })

  const next = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      if (step === 1) {
        try {
          await call(
            client.POST('/org/setup', {
              body: { organisation_name: org.name.trim(), primary_email_domain: dom, first_admin: { name: org.admin.trim(), email: org.email.trim() } },
            }),
          )
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e
          toast(t('org.setup.alreadyDone'), { icon: 'info' })
        }
        setMail((m) => ({ ...m, inbound: m.inbound || `brain@inbound.${dom}`, host: m.host || `mock.${dom}`, user: m.user || `brain@${dom}` }))
      } else if (step === 2) {
        await call(client.PUT('/org/mail', { body: mailBody() }))
      } else if (step === 3) {
        const p = await call(client.POST('/projects', { body: { name: proj.name.trim(), description: proj.desc.trim() || null } }))
        app.setProjectId(p.id)
        if (proj.rule) {
          await call(client.POST('/org/mail/rules', { body: { match_type: 'sender_domain', value: '@' + dom, project_id: p.id, priority: 10 } })).catch((e) => toastError(errMsg(e)))
        }
      }
      setStep(step + 1)
    } catch (e) {
      toastError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const poll = (id: string) => {
    timer.current = window.setTimeout(async () => {
      try {
        const j = await call(client.GET('/ingest/{job_id}', { params: { path: { job_id: id } } }))
        setJob(j)
        if (j.status === 'error') toastError(t('org.setup.jobFailed'))
        else if (j.status !== 'done') poll(id)
        else void app.refresh()
      } catch (e) {
        // Polling stops here: show the ingest as failed so the person can try again or go back.
        setJob((cur) => cur && { ...cur, status: 'error' })
        toastError(errMsg(e))
      }
    }, 900)
  }
  const ingest = async () => {
    setBusy(true)
    try {
      const j = await call(client.POST('/ingest', { body: { corpus: 'org-consulting-clearpath', force: false } }))
      setJob(j)
      if (j.status === 'error') toastError(t('org.setup.jobFailed'))
      else if (j.status !== 'done') poll(j.id)
      else void app.refresh()
    } catch (e) {
      toastError(t('org.setup.failed', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }
  const finish = async () => {
    await app.refresh()
    toast(t('org.setup.ready', { org: org.name.trim() }), { icon: 'check' })
    nav('app')
  }

  const steps = [1, 2, 3, 4]
  const field = (id: string, label: string, val: string, onChange: (v: string) => void, o: { mono?: boolean; ph?: string; help?: string; cls?: string } = {}) => (
    <div className={o.cls}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className={'input ' + (o.mono ? 'mono !text-[13.5px] ' : '') + (err[id] ? 'invalid' : '')} value={val} placeholder={o.ph} onChange={(e) => onChange(e.target.value)} />
      {err[id] ? <FieldErr msg={err[id]} /> : o.help ? <div className="help">{o.help}</div> : null}
    </div>
  )
  const radio = (on: boolean, onClick: () => void, title: string, sub: string) => (
    <button type="button" className={'radio-card ' + (on ? 'on' : '')} onClick={onClick}>
      <span className="radio-dot"></span>
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  )

  const title = step === 4 && done ? t('org.setup.t4done') : t('org.setup.t' + step)
  const sub = step === 4 && done ? t('org.setup.d4done') : t('org.setup.d' + step)
  const progress = ((step - 1 + (done ? 1 : 0)) / 4) * 100

  return (
    <div className="h-full flex bg-background">
      <aside className="hidden md:flex w-[300px] shrink-0 flex-col bg-sidebar border-r px-7 py-7">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">{t('shell.product')}</span>
        </div>
        <h1 className="mt-10 text-[18px] font-semibold tracking-tight">{t('org.setup.railTitle')}</h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed">{t('org.setup.railSub')}</p>
        <ol className="mt-8 space-y-5">
          {steps.map((n) => (
            <li key={n} className={'flex gap-3 ' + (n === step ? '' : 'opacity-80')}>
              <span className={'step-dot mono !w-6 !h-6 mt-0.5 ' + (n < step ? 'done' : n === step ? 'on' : '')}>{n < step ? <Ic n="check" className="sm" /> : n}</span>
              <div>
                <div className={'text-[14px] ' + (n === step ? 'font-semibold' : 'font-medium')}>{t('org.setup.s' + n)}</div>
                <div className="text-[12.5px] text-muted-foreground">{t('org.setup.s' + n + 'sub')}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex-1"></div>
        <a href="#/app" className="mt-3 text-[12.5px] text-muted-foreground hover:text-foreground">
          {t('org.setup.skip')}
        </a>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto scroll flex flex-col">
        <div className="h-1 bg-muted shrink-0">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: progress + '%' }} />
        </div>
        <div className="flex-1 flex justify-center px-6 py-12">
          <div className="w-full max-w-[600px]">
            <div className="text-[12.5px] font-medium text-muted-foreground">{t('org.setup.stepOf', { n: step })}</div>
            <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight">{title}</h2>
            <p className="mt-1.5 text-[14.5px] text-muted-foreground leading-relaxed">{sub}</p>
            {status.data?.completed && step === 1 && <p className="help mt-3">{t('org.setup.alreadyDone')}</p>}
            <div className="mt-8 fade-in" key={step}>
              {step === 1 && (
                <div className="space-y-4">
                  {field('name', t('org.setup.orgName'), org.name, (v) => setOrg({ ...org, name: v }), { ph: t('org.setup.orgNamePh') })}
                  {field('domain', t('org.setup.domain'), org.domain, (v) => setOrg({ ...org, domain: v }), { mono: true, ph: t('org.setup.domainPh'), help: t('org.setup.domainHelp') })}
                  <div className="grid grid-cols-2 gap-3">
                    {field('admin', t('org.setup.admin'), org.admin, (v) => setOrg({ ...org, admin: v }))}
                    {field('email', t('org.setup.adminEmail'), org.email, (v) => setOrg({ ...org, email: v }), { mono: true })}
                  </div>
                </div>
              )}
              {step === 2 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {radio(mail.mode === 'imap_mock', () => setMail({ ...mail, mode: 'imap_mock' }), t('org.setup.imap'), t('org.setup.imapSub'))}
                    {radio(mail.mode === 'webhook', () => setMail({ ...mail, mode: 'webhook' }), t('org.setup.webhook'), t('org.setup.webhookSub'))}
                  </div>
                  <div className="mt-5 space-y-4">
                    {mail.mode === 'imap_mock' && (
                      <div className="grid grid-cols-2 gap-3">
                        {field('host', t('org.setup.imapHost'), mail.host, (v) => setMail({ ...mail, host: v }), { mono: true })}
                        {field('user', t('org.setup.imapUser'), mail.user, (v) => setMail({ ...mail, user: v }), { mono: true })}
                      </div>
                    )}
                    {field('inbound', t('org.setup.inbound'), mail.inbound, (v) => setMail({ ...mail, inbound: v }), { mono: true, help: t('org.setup.inboundHelp') })}
                  </div>
                </>
              )}
              {step === 3 && (
                <div className="space-y-4">
                  {field('project', t('org.setup.projName'), proj.name, (v) => setProj({ ...proj, name: v }))}
                  <div>
                    <label className="label" htmlFor="sPDesc">
                      {t('org.setup.projDesc')}
                    </label>
                    <textarea id="sPDesc" className="input" value={proj.desc} onChange={(e) => setProj({ ...proj, desc: e.target.value })} />
                  </div>
                  <label className="flex items-start gap-3 rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] px-4 py-3.5 cursor-pointer">
                    <input type="checkbox" className="check mt-0.5" checked={proj.rule} onChange={(e) => setProj({ ...proj, rule: e.target.checked })} />
                    <span>
                      <span className="block text-[14px] font-medium">{t('org.setup.projRule', { domain: '@' + dom })}</span>
                      <span className="block text-[12.5px] text-muted-foreground mt-0.5">{t('org.setup.projRuleSub')}</span>
                    </span>
                  </label>
                </div>
              )}
              {step === 4 && (
                <>
                  <div className="rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                        <Ic n="doc" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">{t('org.setup.corpus')}</span>
                        <span className="block text-[12.5px] text-muted-foreground">{t('org.setup.corpusSub')}</span>
                      </span>
                      {job && (
                        <span className={'text-[12.5px] ' + (done ? 'text-success' : failed ? 'text-destructive' : 'text-muted-foreground')}>
                          {done ? t('org.setup.done') : failed ? t('org.setup.error') : t('org.setup.reading')}
                        </span>
                      )}
                    </div>
                    {job && !failed && (
                      <div className="bar mt-3">
                        <i style={{ width: done ? '100%' : '60%' }} />
                      </div>
                    )}
                  </div>
                  {done && job && (
                    <div className="fade-in mt-6 rounded-[12px] bg-muted/50 px-5 py-4">
                      <p className="text-[16px] leading-relaxed">{t('org.setup.result', { docs: job.docs, facts: job.facts })}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="mt-10 pt-5 border-t flex items-center justify-between">
              {step > 1 && !running && !done ? (
                <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                  <Ic n="arrowl" className="sm" />
                  {t('org.setup.back')}
                </button>
              ) : (
                <span></span>
              )}
              {step < 4 ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => void next()}>
                  {t('org.setup.continue')} <Ic n="arrow" className="sm" />
                </button>
              ) : done ? (
                <button className="btn btn-primary btn-lg" onClick={() => void finish()}>
                  {t('org.setup.open')} <Ic n="arrow" className="sm" />
                </button>
              ) : running ? (
                <button className="btn btn-primary" aria-disabled="true">
                  <span className="spin"></span>
                  {t('org.setup.ingesting')}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={() => void ingest()}>
                  {failed ? t('common.retry') : t('org.setup.ingest')}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
