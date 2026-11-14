import { useState, type ReactNode } from 'react'
import { ApiError, call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { asList, ChipsInput, CodeBlock, CopyField, curlFor, runSync, TagChip, todayIso, type Source } from '../screens/home/shared'
import { Ic } from './Icon'
import { SRC_ICON } from './srcIcon'
import { Dialog } from './overlays'
import { toastError } from './toast'

type Kind = 'github' | 'document_library' | 'mail' | 'documents' | 'webhook'
type Preview = Schemas['GithubPreview']
type Doc = { id: string; title: string; current_version?: number; version?: number }
type Done = { title: string; text: string; pct: number; phase: string; ok: boolean }

const KINDS: Kind[] = ['github', 'document_library', 'mail', 'documents', 'webhook']
const SOON = ['sharepoint', 'gdrive', 'gmail'] as const
const GH_INC = ['issues', 'readme', 'pulls'] as const

/** "Add source" dialog (POST /projects/{project_id}/sources). `onCreated` runs after a source was added. */
export default function AddSourceDialog({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated?: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const projName = app.projects.find((p) => p.id === projectId)?.name ?? projectId
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<Kind | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Record<string, string>>({})
  // github
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<Preview | 'loading' | { error: string; status: number } | null>(null)
  const [inc, setInc] = useState<Record<string, boolean>>({ issues: true, readme: true, pulls: false })
  // library / documents
  const [doc, setDoc] = useState('new')
  const [file, setFile] = useState<{ name: string; text: string }[]>([])
  const [text, setText] = useState('')
  const [docTitle, setDocTitle] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  // mail
  const [mode, setMode] = useState<'inherit' | 'override'>('inherit')
  const [inbound, setInbound] = useState('')
  const [rule, setRule] = useState('')
  // webhook
  const [hookLabel, setHookLabel] = useState('')
  const [hookTags, setHookTags] = useState<string[]>([])
  const [hook, setHook] = useState<{ url: string; secret: string; last4: string; tags: string[] } | null>(null)
  // step 3
  const [done, setDone] = useState<Done | null>(null)

  const sources = useApi(() => call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: projectId } } })).then((d) => asList<Source>(d)), [projectId])
  const lib = sources.data?.find((s) => s.type === 'document_library')
  const libDocs = useApi(
    lib ? () => call(client.GET('/sources/{source_id}/documents', { params: { path: { source_id: lib.id } } })).then((d) => asList<Doc>(d)) : null,
    [lib?.id],
  )
  const mail = useApi(() => call(client.GET('/projects/{project_id}/mail', { params: { path: { project_id: projectId } } })), [projectId])
  const orgInbound = app.org?.mail_config?.inbound_address ?? mail.data?.effective_mail_config.inbound_address ?? ''

  const finish = () => {
    onCreated?.()
    void app.refresh()
  }
  const fail = (e: unknown) => toastError(t('common.actionError', { message: errMsg(e) }))

  const pickFiles = async (list: FileList | null, multi: boolean) => {
    if (!list || !list.length) return
    const arr = await Promise.all(Array.from(list).slice(0, multi ? 20 : 1).map(async (f) => ({ name: f.name, text: await f.text() })))
    setFile(arr)
    setErr({})
    if (!multi && arr[0]) {
      setText(arr[0].text)
      if (!docTitle) setDocTitle(arr[0].name.replace(/\.[^.]+$/, ''))
    }
  }

  /* ---- github ---- */
  const doPreview = async () => {
    if (!/github\.com\/[^/\s]+\/[^/\s]+/.test(url.trim())) {
      setErr({ url: t('home.add.gh.badUrl') })
      return
    }
    setErr({})
    setPreview('loading')
    try {
      const pv = await call(client.POST('/sources/github/preview', { body: { repo_url: url.trim() } }))
      setPreview(pv)
    } catch (e) {
      setPreview({ error: errMsg(e), status: e instanceof ApiError ? e.status : 0 })
    }
  }
  const createAndSync = async (body: Schemas['SourceCreate'], title: string) => {
    const src = await call(client.POST('/projects/{project_id}/sources', { params: { path: { project_id: projectId } }, body }))
    setStep(3)
    setDone({ title, text: '', pct: 10, phase: t('home.add.queued'), ok: false })
    finish()
    const job = await runSync(src.id, (j) =>
      setDone((d) => d && { ...d, pct: j.status === 'queued' ? 20 : j.status === 'running' ? Math.min(90, (d.pct || 20) + 10) : 100, phase: t('home.add.job.' + j.status) }),
    ).catch((e: unknown) => {
      // The source exists and the list was refreshed above: show the sync as failed so the dialog can be closed.
      setDone({ title, pct: 100, ok: false, phase: t('home.add.job.error'), text: t('home.add.syncError') })
      throw e
    })
    setDone({
      title,
      pct: 100,
      ok: job.status !== 'error',
      phase: t('home.add.job.' + job.status),
      text: job.status === 'error' ? t('home.add.syncError') : t('home.add.syncResult', { items: job.items_added ?? 0, facts: job.facts_created ?? 0 }),
    })
    finish()
  }

  const connect = async () => {
    setBusy(true)
    try {
      if (kind === 'github') {
        if (!preview || preview === 'loading' || 'error' in preview) return
        await createAndSync(
          { type: 'github', label: preview.full_name, config: { repo_url: preview.repo_url, include: GH_INC.filter((k) => inc[k]) } },
          preview.full_name,
        )
      } else if (kind === 'document_library') {
        if (!text.trim()) return setErr({ file: t('home.add.lib.needText') })
        if (doc === 'new') {
          if (!docTitle.trim()) return setErr({ title: t('home.add.lib.needTitle') })
          const r = await call(
            client.POST('/documents', {
              body: { title: docTitle.trim(), date: todayIso(), format: 'markdown', text, ingest: true, project_id: projectId } as Schemas['DocumentCreate'],
            }),
          )
          setDone({ title: r.document.title, pct: 100, ok: true, phase: t('home.add.uploaded'), text: t('home.add.docCreated', { id: r.document.id }) })
        } else {
          const r = await call(
            client.POST('/documents/{doc_id}/versions', { params: { path: { doc_id: doc } }, body: { version_label: versionLabel.trim() || undefined, text, date: todayIso() } }),
          )
          const title = libDocs.data?.find((d) => d.id === doc)?.title ?? doc
          setDone({
            title,
            pct: 100,
            ok: true,
            phase: t('home.add.uploaded'),
            text: t('home.add.versionResult', { label: r.version.version_label ?? 'v' + r.version.version, facts: r.facts_created.length, superseded: r.supersedes_created.length }),
          })
        }
        setStep(3)
        finish()
      } else if (kind === 'documents') {
        if (!file.length) return setErr({ file: t('home.add.docs.needFile') })
        if (!sources.data?.some((s) => s.type === 'documents'))
          await call(client.POST('/projects/{project_id}/sources', { params: { path: { project_id: projectId } }, body: { type: 'documents', label: t('shell.sourceTypes.documents') } }))
        let n = 0
        for (const f of file) {
          if (!f.text.trim()) continue
          await call(
            client.POST('/documents', {
              body: { title: f.name.replace(/\.[^.]+$/, ''), date: todayIso(), format: /\.md$|\.markdown$/i.test(f.name) ? 'markdown' : 'text', text: f.text, ingest: true, project_id: projectId } as Schemas['DocumentCreate'],
            }),
          )
          n++
        }
        setDone({ title: t('shell.sourceTypes.documents'), pct: 100, ok: true, phase: t('home.add.uploaded'), text: t('home.add.docsResult', { count: n }) })
        setStep(3)
        finish()
      } else if (kind === 'mail') {
        const eff = mail.data?.effective_mail_config
        if (mode === 'override') {
          if (!inbound.includes('@')) return setErr({ inbound: t('home.add.mail.badAddress') })
          await call(
            client.PUT('/projects/{project_id}/mail', {
              params: { path: { project_id: projectId } },
              body: { mode: eff?.mode ?? 'webhook', imap_host: eff?.imap_host ?? null, imap_user: eff?.imap_user ?? null, inbound_address: inbound.trim(), poll_interval_s: eff?.poll_interval_s ?? 60 },
            }),
          )
        } else if (mail.data?.overridden) {
          await call(client.DELETE('/projects/{project_id}/mail', { params: { path: { project_id: projectId } } }))
        }
        if (rule.trim()) {
          await call(
            client.POST('/org/mail/rules', { body: { match_type: rule.trim().startsWith('@') ? 'sender_domain' : 'sender_address', value: rule.trim(), project_id: projectId, priority: 100 } }),
          )
        }
        const address = mode === 'override' ? inbound.trim() : orgInbound
        if (!sources.data?.some((s) => s.type === 'mail'))
          await call(
            client.POST('/projects/{project_id}/sources', {
              params: { path: { project_id: projectId } },
              body: { type: 'mail', label: t('home.add.mail.label', { project: projName }), config: { mode: eff?.mode ?? 'imap_mock', mailbox: address } },
            }),
          )
        setDone({ title: address, pct: 100, ok: true, phase: t('home.add.saved'), text: rule.trim() ? t('home.add.mail.resultRule', { rule: rule.trim() }) : t('home.add.mail.result') })
        setStep(3)
        finish()
      } else if (kind === 'webhook') {
        if (!hookLabel.trim()) return setErr({ label: t('home.add.hook.needName') })
        const r = (await call(
          client.POST('/projects/{project_id}/sources', {
            params: { path: { project_id: projectId } },
            body: { type: 'webhook', label: hookLabel.trim(), config: { default_tags: hookTags } },
          }),
        )) as Source & { secret?: string }
        const cfg = (r.config ?? {}) as { url?: string; secret_last4?: string; default_tags?: string[] }
        let secret = r.secret ?? ''
        let last4 = cfg.secret_last4 ?? ''
        if (!secret) {
          // The webhook exists from here on: a failed rotation must not leave the form up to create it again.
          try {
            const rot = await call(client.POST('/sources/{source_id}/rotate-secret', { params: { path: { source_id: r.id } } }))
            secret = rot.secret
            last4 = rot.secret_last4
          } catch (e) {
            fail(e)
          }
        }
        setHook({ url: cfg.url ?? '', secret, last4, tags: cfg.default_tags ?? hookTags })
        setStep(3)
        finish()
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  /* ---- render ---- */
  const isHook = kind === 'webhook'
  const stepper = (
    <ol className="flex items-center gap-2 text-[12.5px] mb-5">
      {[t('home.add.stepType'), t('home.add.stepConfigure'), isHook ? t('home.add.stepConnect') : t('home.add.stepSync')].map((l, i) => (
        <li key={i} className="contents">
          <span className={`flex items-center gap-2 ${step === i + 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            <span className={`step-dot mono ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`}>{step > i + 1 ? <Ic n="check" className="sm" /> : i + 1}</span>
            {l}
          </span>
          {i < 2 && <span className="w-6 h-px bg-border" />}
        </li>
      ))}
    </ol>
  )
  const back =
    step === 2 ? (
      <button className="btn btn-ghost mr-auto" onClick={() => setStep(1)}>
        <Ic n="arrowl" className="sm" />
        {t('home.add.back')}
      </button>
    ) : null
  const cancel = (
    <button className="btn btn-ghost" onClick={onClose}>
      {t('common.cancel')}
    </button>
  )
  const fieldErr = (k: string) =>
    err[k] ? (
      <div className="err">
        <Ic n="alert" className="sm" />
        {err[k]}
      </div>
    ) : null
  const primary = (label: ReactNode, onClick: () => void, disabledTip?: string) => (
    <button
      className="btn btn-primary"
      onClick={disabledTip || busy ? undefined : onClick}
      aria-disabled={disabledTip || busy ? true : undefined}
      data-tip={disabledTip}
    >
      {busy && <span className="w-3.5 h-3.5 rounded-full border-[1.6px] border-current border-r-transparent animate-spin inline-block" />}
      {label}
    </button>
  )
  const dropzone = (multi: boolean, accept: string) => (
    <label className="dropzone w-full px-5 py-6 text-center hover:bg-muted/70 transition block cursor-pointer">
      <input type="file" className="sr-only" accept={accept} multiple={multi} onChange={(e) => void pickFiles(e.target.files, multi)} />
      {file.length ? (
        <>
          <span className="inline-flex items-center gap-2 text-[13.5px] font-medium">
            <Ic n="doc" /> {file.length === 1 ? file[0].name : t('home.add.files', { count: file.length })}
          </span>
          <span className="block text-[12.5px] text-muted-foreground mt-1">{t('home.add.clickToChange')}</span>
        </>
      ) : (
        <>
          <span className="mx-auto w-9 h-9 rounded-full bg-background shadow-[inset_0_0_0_1px_hsl(var(--border))] grid place-items-center text-muted-foreground">
            <Ic n="upload" />
          </span>
          <span className="block mt-2 text-[13.5px] font-medium">{multi ? t('home.add.docs.drop') : t('home.add.lib.choose')}</span>
          <span className="block text-[12.5px] text-muted-foreground">{t('home.add.formats')}</span>
        </>
      )}
    </label>
  )

  let body: ReactNode = null
  let foot: ReactNode = null
  if (step === 1) {
    body = (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button key={k} className={`radio-card ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
              <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                <Ic n={SRC_ICON[k]} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium">{t('home.add.kind.' + k)}</span>
                <span className="block text-[12.5px] text-muted-foreground leading-snug mt-0.5">{t('home.add.kindSub.' + k)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 text-[12.5px] font-medium text-muted-foreground">{t('common.comingSoon')}</div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SOON.map((k) => (
            <div key={k} className="radio-card opacity-60 cursor-not-allowed" aria-disabled="true">
              <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
                <Ic n={k === 'gmail' ? 'mail' : 'library'} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{t('home.add.soon.' + k)}</span>
                <span className="badge line mt-1 !h-[18px] !text-[11px]">{t('common.comingSoon')}</span>
              </span>
            </div>
          ))}
        </div>
      </>
    )
    foot = (
      <>
        {cancel}
        {primary(
          <>
            {t('home.add.continue')} <Ic n="arrow" className="sm" />
          </>,
          () => setStep(2),
          kind ? undefined : t('home.add.pickType'),
        )}
      </>
    )
  } else if (step === 2 && kind === 'github') {
    const pv = preview
    body = (
      <>
        <label className="label" htmlFor="ghUrl">
          {t('home.add.gh.url')}
        </label>
        <div className="flex gap-2">
          <input
            id="ghUrl"
            className={`input mono !text-[13.5px] ${err.url ? 'invalid' : ''}`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doPreview()}
            placeholder="https://github.com/owner/repo"
          />
          <button className="btn btn-outline" onClick={() => void doPreview()} disabled={pv === 'loading'}>
            {t('home.add.gh.preview')}
          </button>
        </div>
        {fieldErr('url') ?? <div className="help">{t('home.add.gh.help')}</div>}
        {pv === 'loading' && (
          <div className="mt-4 rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] p-4 space-y-2.5" aria-busy="true">
            <div className="skel h-4 w-48" />
            <div className="skel h-3 w-72" />
          </div>
        )}
        {pv && pv !== 'loading' && 'error' in pv && (
          <div className="fade-in mt-4 rounded-[12px] bg-destructive/10 px-4 py-3 text-[13.5px] flex gap-3">
            <Ic n="alert" className="sm text-destructive mt-0.5" />
            <div>
              <div className="font-medium text-destructive">{pv.status === 404 ? t('home.add.gh.notFound') : pv.status === 403 || pv.status === 422 ? t('home.add.gh.private') : t('home.add.gh.failed')}</div>
              <div className="text-muted-foreground mt-0.5">{pv.error}</div>
            </div>
          </div>
        )}
        {pv && pv !== 'loading' && !('error' in pv) && (
          <>
            <div className="fade-in mt-4 rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] p-4">
              <div className="flex items-center gap-2">
                <Ic n="github" className="text-muted-foreground" />
                <span className="mono text-[13.5px] font-medium">{pv.full_name}</span>
                <span className="badge ok">
                  <span className="bd !bg-success" />
                  {pv.public ? t('home.add.gh.public') : t('home.add.gh.notPublic')}
                </span>
              </div>
              {pv.description && <p className="mt-1.5 text-[13.5px] text-muted-foreground">{pv.description}</p>}
              <div className="mt-3 flex gap-4 text-[12.5px] text-muted-foreground flex-wrap">
                <span>{t('home.add.gh.issues', { count: pv.open_issues })}</span>
                <span>
                  README <span className="text-foreground">{pv.has_readme ? t('home.add.gh.yes') : t('home.add.gh.no')}</span>
                </span>
                <span className="mono">{pv.default_branch}</span>
              </div>
            </div>
            <div className="mt-5 text-[13px] font-medium">{t('home.add.gh.what')}</div>
            <div className="mt-2 space-y-2">
              {GH_INC.map((k) => (
                <label key={k} className="flex items-center gap-2.5 text-[13.5px] cursor-pointer">
                  <input type="checkbox" className="check" checked={!!inc[k]} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} />
                  {t('home.gh.' + k)}
                </label>
              ))}
            </div>
          </>
        )}
      </>
    )
    const ready = pv && pv !== 'loading' && !('error' in pv)
    foot = (
      <>
        {back}
        {cancel}
        {primary(t('home.add.connectSync'), () => void connect(), ready ? undefined : t('home.add.gh.previewFirst'))}
      </>
    )
  } else if (step === 2 && kind === 'document_library') {
    const docs = libDocs.data ?? []
    const cur = docs.find((d) => d.id === doc)
    body = (
      <>
        <label className="label" htmlFor="libDoc">
          {t('home.add.lib.document')}
        </label>
        <select
          id="libDoc"
          className="input"
          value={doc}
          onChange={(e) => {
            setDoc(e.target.value)
            const d = docs.find((x) => x.id === e.target.value)
            setVersionLabel(d ? 'v' + ((d.current_version ?? d.version ?? 1) + 1) : '')
          }}
        >
          <option value="new">{t('home.add.lib.newDoc')}</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} · {t('home.add.lib.current', { v: 'v' + (d.current_version ?? d.version ?? 1) })}
            </option>
          ))}
        </select>
        <div className="mt-4">{dropzone(false, '.md,.markdown,.txt,text/plain,text/markdown')}</div>
        {fieldErr('file')}
        <label className="label mt-4" htmlFor="libText">
          {t('home.add.lib.text')}
        </label>
        <textarea id="libText" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('home.add.lib.textPh')} />
        {doc === 'new' ? (
          <>
            <label className="label mt-4" htmlFor="libTitle">
              {t('home.add.lib.title')}
            </label>
            <input id="libTitle" className={`input ${err.title ? 'invalid' : ''}`} value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
            {fieldErr('title')}
          </>
        ) : (
          <>
            <label className="label mt-4" htmlFor="vLabel">
              {t('home.add.lib.version')}
            </label>
            <input id="vLabel" className="input mono !w-32" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} />
            <div className="help">{t('home.add.lib.versionHelp', { title: cur?.title ?? '' })}</div>
          </>
        )}
      </>
    )
    foot = (
      <>
        {back}
        {cancel}
        {primary(t('home.add.uploadSync'), () => void connect())}
      </>
    )
  } else if (step === 2 && kind === 'documents') {
    body = (
      <>
        {dropzone(true, '.md,.markdown,.txt,text/plain,text/markdown')}
        {fieldErr('file')}
        <div className="help">{t('home.add.docs.help')}</div>
      </>
    )
    foot = (
      <>
        {back}
        {cancel}
        {primary(t('home.add.uploadSync'), () => void connect())}
      </>
    )
  } else if (step === 2 && kind === 'mail') {
    body = (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button className={`radio-card ${mode === 'inherit' ? 'on' : ''}`} onClick={() => setMode('inherit')} aria-pressed={mode === 'inherit'}>
            <span className="radio-dot" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">{t('home.add.mail.inherit')}</span>
              <span className="block text-[12px] text-muted-foreground mono mt-0.5 truncate">{orgInbound}</span>
            </span>
          </button>
          <button
            className={`radio-card ${mode === 'override' ? 'on' : ''}`}
            onClick={() => {
              setMode('override')
              if (!inbound) setInbound(`${projectId.replace(/^proj-/, '')}@${orgInbound.split('@')[1] ?? 'inbound.canonico.app'}`)
            }}
            aria-pressed={mode === 'override'}
          >
            <span className="radio-dot" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">{t('home.add.mail.override')}</span>
              <span className="block text-[12px] text-muted-foreground mt-0.5">{t('home.add.mail.ownAddress')}</span>
            </span>
          </button>
        </div>
        {mode === 'override' && (
          <>
            <label className="label mt-4" htmlFor="mInbound">
              {t('home.add.mail.address')}
            </label>
            <input id="mInbound" className={`input mono !text-[13px] ${err.inbound ? 'invalid' : ''}`} value={inbound} onChange={(e) => setInbound(e.target.value)} />
            {fieldErr('inbound')}
          </>
        )}
        <label className="label mt-4" htmlFor="mRule">
          {t('home.add.mail.routeFrom')}
        </label>
        <input id="mRule" className="input mono !text-[13.5px]" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="@client.com" />
        <div className="help">{t('home.add.mail.ruleHelp', { project: projName })}</div>
        <div className="mt-4 rounded-[10px] bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground flex gap-2.5">
          <Ic n="info" className="sm mt-0.5" />
          <span>{t('home.add.mail.soonNote')}</span>
        </div>
      </>
    )
    foot = (
      <>
        {back}
        {cancel}
        {primary(t('home.add.mail.save'), () => void connect())}
      </>
    )
  } else if (step === 2 && kind === 'webhook') {
    body = (
      <>
        <label className="label" htmlFor="hLabel">
          {t('home.add.hook.name')}
        </label>
        <input id="hLabel" className={`input ${err.label ? 'invalid' : ''}`} value={hookLabel} onChange={(e) => setHookLabel(e.target.value)} placeholder={t('home.add.hook.namePh')} />
        {fieldErr('label')}
        <label className="label mt-4" htmlFor="tagInput-hook">
          {t('home.add.hook.tags')}
        </label>
        <ChipsInput id="tagInput-hook" value={hookTags} onChange={setHookTags} />
        <div className="help">{t('home.add.hook.tagsHelp')}</div>
        <div className="mt-4 rounded-[10px] bg-muted/60 px-4 py-3 text-[13px] text-muted-foreground flex gap-2.5">
          <Ic n="key" className="sm mt-0.5" />
          <span>{t('home.add.hook.secretNote')}</span>
        </div>
      </>
    )
    foot = (
      <>
        {back}
        {cancel}
        {primary(t('home.add.hook.create'), () => void connect())}
      </>
    )
  } else if (step === 3 && isHook && hook) {
    body = (
      <>
        <div className="fade-in flex items-center gap-2.5 text-[14px] font-medium">
          <Ic n="ok" className="text-success" />
          {t('home.add.hook.created', { project: projName })}
        </div>
        <label className="label mt-4">{t('home.add.hook.url')}</label>
        <CopyField value={hook.url} />
        <label className="label mt-4">{t('home.cfg.secret')}</label>
        {hook.secret && <CopyField value={hook.secret} />}
        <div className="help flex items-center gap-1.5 !text-warning-text">
          <Ic n="alert" className="sm" />
          <span>{hook.secret ? t('home.add.hook.once', { last4: hook.last4 }) : t('home.add.hook.noSecret')}</span>
        </div>
        <label className="label mt-4">{t('home.add.hook.example')}</label>
        <CodeBlock value={curlFor(hook.url, hook.tags, hook.secret, todayIso())} />
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="text-[13px] text-muted-foreground mr-1">{t('home.add.hook.tags')}</span>
          {hook.tags.length ? hook.tags.map((tg) => <TagChip key={tg} tag={tg} />) : <span className="text-[13px] text-muted-foreground">{t('common.none')}</span>}
        </div>
      </>
    )
    foot = (
      <button className="btn btn-primary" onClick={onClose}>
        {t('home.cfg.done')}
      </button>
    )
  } else if (step === 3 && done && kind) {
    const fin = done.pct >= 100
    body = (
      <>
        <div className="rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] p-4">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground">
              <Ic n={SRC_ICON[kind]} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium truncate">{done.title}</div>
              <div className="text-[12.5px] text-muted-foreground">{done.phase}</div>
            </div>
            {fin ? (
              <Ic n={done.ok ? 'ok' : 'alert'} className={done.ok ? 'text-success' : 'text-destructive'} />
            ) : (
              <span className="w-4 h-4 border-[1.6px] rounded-full border-muted-foreground border-r-transparent animate-spin inline-block" />
            )}
          </div>
          <div className="bar mt-4">
            <i style={{ width: `${done.pct}%` }} />
          </div>
        </div>
        {fin && (
          <>
            <div className="fade-in mt-4 text-[14px] font-medium">{done.text}</div>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('home.add.listed', { project: projName })}</p>
          </>
        )}
      </>
    )
    foot = fin ? (
      <button className="btn btn-primary" onClick={onClose}>
        {t('home.cfg.done')}
      </button>
    ) : (
      <button className="btn btn-ghost" aria-disabled="true">
        {t('home.status.syncing')}
      </button>
    )
  }

  return (
    <Dialog title={t('home.addSource')} sub={t('home.add.sub', { project: projName, step })} onClose={onClose} footer={foot} wide>
      {stepper}
      {body}
    </Dialog>
  )
}
