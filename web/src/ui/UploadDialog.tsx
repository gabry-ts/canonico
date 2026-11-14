import { useState, type ReactNode } from 'react'
import { call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import { FactRow } from '../screens/home/ItemsCard'
import { asList, ChipsInput, ITEM_ICON, ITEM_TYPES, tagCls, todayIso, type Source } from '../screens/home/shared'
import { Ic } from './Icon'
import { Dialog, Skeleton } from './overlays'
import { toastError } from './toast'

type ItemType = (typeof ITEM_TYPES)[number]
type Result = Schemas['InboundItemResult']
type Topic = { id: string; label?: string }
type Doc = { id: string; title: string; current_version?: number; version?: number }

const SAMPLE = {
  utype: 'meeting' as ItemType,
  title: 'Steering committee 12 Nov',
  date: '2026-11-12',
  participants: 'Sara Conti, Marco Bianchi',
  text: 'We agreed the onboarding target stays at 3–4 weeks.',
  tags: ['clearpath', 'meeting', 'topic:onboarding-target'],
}

/** Manual upload dialog (meeting / document / note / ticket, tags). `onDone` runs after the item was processed. */
export default function UploadDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const projName = (id: string) => app.projects.find((p) => p.id === id)?.name ?? id
  const [utype, setUtype] = useState<ItemType>('meeting')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso())
  const [participants, setParticipants] = useState('')
  const [versionOf, setVersionOf] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [err, setErr] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'form' | 'sending' | 'result'>('form')
  const [result, setResult] = useState<Result | null>(null)

  const tagList = useApi(() => call(client.GET('/tags', { params: { query: { project_id: projectId } } })), [projectId])
  const topics = useApi(() => call(client.GET('/topics', { params: { query: { project_id: projectId } } })).then((d) => asList<Topic>(d)), [projectId])
  const libDocs = useApi(
    () =>
      call(client.GET('/projects/{project_id}/sources', { params: { path: { project_id: projectId } } })).then(async (d) => {
        const lib = asList<Source>(d).find((s) => s.type === 'document_library')
        if (!lib) return [] as Doc[]
        return asList<Doc>(await call(client.GET('/sources/{source_id}/documents', { params: { path: { source_id: lib.id } } })))
      }),
    [projectId],
  )

  const topicTag = tags.find((tg) => tg.startsWith('topic:'))
  const topicLabel = (tg: string) => {
    const id = tg.slice(6)
    return topics.data?.find((x) => x.id === id)?.label ?? id
  }
  const fromApi = asList<{ tag: string; count: number }>(tagList.data).map((x) => x.tag)
  const fromTopics = (topics.data ?? []).slice(0, 2).map((x) => 'topic:' + x.id)
  const sugg = [...new Set([...fromApi.slice(0, 5), utype, ...fromTopics])].filter((tg) => !tags.includes(tg)).slice(0, 7)

  const fillSample = () => {
    setUtype(SAMPLE.utype)
    setTitle(SAMPLE.title)
    setDate(SAMPLE.date)
    setParticipants(SAMPLE.participants)
    setText(SAMPLE.text)
    setTags(SAMPLE.tags)
    setErr({})
  }
  const reset = () => {
    setTitle('')
    setText('')
    setFile(null)
    setParticipants('')
    setVersionOf('')
    setTags([])
    setResult(null)
    setPhase('form')
  }
  const pick = async (list: FileList | null) => {
    const f = list?.[0]
    if (!f) return
    setFile(f.name)
    setText(await f.text())
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async () => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = t('home.upload.needTitle')
    if (!date) e.date = t('home.upload.needDate')
    if (!text.trim()) e.text = t('home.upload.needText')
    setErr(e)
    if (Object.keys(e).length) return
    setPhase('sending')
    try {
      const r = await call(
        client.POST('/projects/{project_id}/items', {
          params: { path: { project_id: projectId } },
          body: {
            type: utype,
            title: title.trim(),
            date: `${date}T09:00:00Z`,
            text: text.trim(),
            tags,
            participants:
              utype === 'meeting'
                ? participants
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : undefined,
            version_of: utype === 'document' && versionOf ? versionOf : undefined,
          },
        }),
      )
      setResult(r)
      setPhase('result')
      onDone?.()
      void app.refresh()
    } catch (er) {
      setPhase('form')
      toastError(t('common.actionError', { message: errMsg(er) }))
    }
  }

  const fieldErr = (k: string) =>
    err[k] ? (
      <div className="err">
        <Ic n="alert" className="sm" />
        {err[k]}
      </div>
    ) : null

  if (phase === 'sending')
    return (
      <Dialog title={t('home.upload.title')} sub={projName(projectId)} onClose={onClose} wide footer={<button className="btn btn-ghost" aria-disabled="true">{t('home.upload.processing')}</button>}>
        <div className="py-10 flex flex-col items-center gap-3 text-[13.5px] text-muted-foreground" aria-busy="true">
          <span className="w-5 h-5 rounded-full border-[1.6px] border-muted-foreground border-r-transparent animate-spin" />
          {t('home.upload.routing')}
        </div>
      </Dialog>
    )

  if (phase === 'result' && result) {
    const r = result
    return (
      <Dialog
        title={r.duplicate ? t('home.upload.dupTitle') : t('home.upload.doneTitle')}
        sub={title}
        onClose={onClose}
        wide
        footer={
          <>
            <button className="btn btn-ghost mr-auto" onClick={reset}>
              {t('home.upload.another')}
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              {t('home.cfg.done')}
            </button>
          </>
        }
      >
        {r.duplicate ? (
          <div className="fade-in rounded-[12px] bg-warning-soft text-warning-text px-4 py-3 text-[13.5px] flex gap-3">
            <Ic n="info" className="sm mt-0.5" />
            <div>
              <div className="font-medium">{t('home.upload.dup')}</div>
              <div className="mt-0.5">{t('home.upload.dupText', { id: r.item_id })}</div>
            </div>
          </div>
        ) : (
          <UploadResult r={r} topicTag={topicTag} topicLabel={topicTag ? topicLabel(topicTag) : ''} projName={projName(r.project_id)} />
        )}
      </Dialog>
    )
  }

  const types = ITEM_TYPES
  return (
    <Dialog
      title={t('home.upload.title')}
      sub={t('home.upload.sub', { project: projName(projectId) })}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-[12.5px] text-muted-foreground hidden sm:inline">{t('home.upload.footNote', { project: projName(projectId) })}</span>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()}>
            <Ic n="upload" className="sm" />
            {t('home.upload.button')}
          </button>
        </>
      }
    >
      {projectId === 'proj-clearpath' && title !== SAMPLE.title && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-primary-soft/70 shadow-[inset_0_0_0_1px_hsl(var(--primary)/.18)] px-3.5 py-2.5 text-[13px]">
          <Ic n="info" className="sm text-primary-text" />
          <span className="flex-1 min-w-0">
            {t('home.upload.sample')} <span className="font-medium">{SAMPLE.title}</span>
          </span>
          <button className="btn btn-outline btn-xs" onClick={fillSample}>
            {t('home.upload.fillSample')}
          </button>
        </div>
      )}
      <div className="label">{t('home.upload.type')}</div>
      <div className="seg w-full flex" role="radiogroup" aria-label={t('home.upload.type')}>
        {types.map((k) => (
          <button key={k} role="radio" aria-checked={utype === k} className={`flex-1 justify-center ${utype === k ? 'on' : ''}`} onClick={() => setUtype(k)}>
            <Ic n={ITEM_ICON[k]} className="sm" />
            {t('home.itemType.' + k)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_168px] gap-3 mt-4">
        <div>
          <label className="label" htmlFor="uTitle">
            {t('home.upload.titleField')}
          </label>
          <input
            id="uTitle"
            className={`input ${err.title ? 'invalid' : ''}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={utype === 'meeting' ? t('home.upload.titlePhMeeting') : t('home.upload.titleField')}
          />
          {fieldErr('title')}
        </div>
        <div>
          <label className="label" htmlFor="uDate">
            {t('home.upload.date')}
          </label>
          <input id="uDate" type="date" className={`input mono !text-[13px] ${err.date ? 'invalid' : ''}`} value={date} onChange={(e) => setDate(e.target.value)} />
          {fieldErr('date')}
        </div>
      </div>
      {utype === 'meeting' && (
        <>
          <label className="label mt-4" htmlFor="uPart">
            {t('home.upload.participants')}
          </label>
          <input id="uPart" className="input" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder={t('home.upload.participantsPh')} />
        </>
      )}
      {utype === 'document' && (
        <>
          <label className="label mt-4" htmlFor="uVer">
            {t('home.upload.versionOf')} <span className="text-muted-foreground font-normal">{t('home.upload.optional')}</span>
          </label>
          <select id="uVer" className="input" value={versionOf} onChange={(e) => setVersionOf(e.target.value)}>
            <option value="">{t('home.upload.notVersion')}</option>
            {(libDocs.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {t('home.add.lib.current', { v: 'v' + (d.current_version ?? d.version ?? 1) })}
              </option>
            ))}
          </select>
          <div className="help">{t('home.upload.versionHelp')}</div>
        </>
      )}
      <label className="label mt-4" htmlFor="uText">
        {t('home.upload.text')}
      </label>
      <textarea id="uText" className={`input ${err.text ? 'invalid' : ''}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('home.upload.textPh')} />
      <label className="dropzone w-full mt-2 px-4 py-3 flex items-center justify-center gap-2 text-[13px] text-muted-foreground hover:bg-muted/70 transition cursor-pointer">
        <input type="file" className="sr-only" accept=".txt,.md,.markdown,.vtt,text/plain,text/markdown,text/vtt" onChange={(e) => void pick(e.target.files)} />
        {file ? (
          <>
            <Ic n="doc" className="sm" />
            <span className="text-foreground font-medium">{file}</span>
            <span>· {t('home.add.clickToChange')}</span>
          </>
        ) : (
          <>
            <Ic n="upload" className="sm" />
            <span>{t('home.upload.drop')}</span>
          </>
        )}
      </label>
      {fieldErr('text')}
      <label className="label mt-4" htmlFor="tagInput-upload">
        {t('home.upload.tags')}
      </label>
      <ChipsInput id="tagInput-upload" value={tags} onChange={setTags} />
      <div className="help">{t('home.upload.tagsHelp')}</div>
      {sugg.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-muted-foreground mr-0.5">{t('home.upload.suggested')}</span>
          {sugg.map((tg) => (
            <button key={tg} className={'tag ' + tagCls(tg)} onClick={() => setTags([...tags, tg])}>
              <Ic n="plus" />
              {tg}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}

function UploadResult({ r, topicTag, topicLabel, projName }: { r: Result; topicTag?: string; topicLabel: string; projName: string }) {
  const { t } = useI18n()
  const { openFact } = useApp()
  const facts = useApi(
    r.facts_created.length ? () => Promise.all(r.facts_created.map((id) => call(client.GET('/facts/{fact_id}', { params: { path: { fact_id: id } } })))) : null,
    [r.item_id],
  )
  const row = (icon: string, title: string, body: ReactNode) => (
    <div className="flex gap-3 py-3">
      <Ic n={icon} className="sm mt-0.5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-muted-foreground">{title}</div>
        <div className="mt-0.5 text-[14px]">{body}</div>
      </div>
    </div>
  )
  return (
    <div className="fade-in">
      <div className="flex items-center gap-2.5 text-[14px] font-medium">
        <Ic n="ok" className="text-success" />
        {t('home.upload.received')} <span className="mono text-[13px]">{r.item_id}</span>
      </div>
      <div className="mt-2 divide-y">
        {row(
          'folder',
          t('home.upload.routedTo'),
          <>
            <span className="font-medium">{projName}</span>{' '}
            <span className="text-muted-foreground text-[13px]">{r.routed_by === 'tag_rule' ? t('home.upload.byRule', { rule: r.rule_id ?? '' }) : t('home.upload.noRule')}</span>
          </>,
        )}
        {row(
          'tag',
          t('home.upload.topic'),
          topicTag ? (
            <>
              {topicLabel} <span className="text-muted-foreground text-[13px]">{t('home.upload.forcedBy')}</span> <span className="tag topic">{topicTag}</span>
            </>
          ) : (
            <span className="text-muted-foreground text-[13.5px]">{t('home.upload.noTopic')}</span>
          ),
        )}
        {row(
          'memory',
          t('home.upload.factsCreated'),
          <>
            <span className="mono">{r.facts_created.length}</span>
            {r.facts_created.length > 0 && (
              <div className="mt-2 space-y-1">
                {facts.data ? (
                  facts.data.map((f) => <FactRow key={f.id} f={f} onOpen={() => openFact(f.id)} />)
                ) : facts.error ? (
                  r.facts_created.map((id) => (
                    <button key={id} className="mono text-[12.5px] hover:underline mr-2" onClick={() => openFact(id)}>
                      {id}
                    </button>
                  ))
                ) : (
                  <Skeleton rows={r.facts_created.length} className="h-8" />
                )}
              </div>
            )}
          </>,
        )}
        {row(
          'changed',
          t('home.upload.superseded'),
          <>
            <span className="mono">{r.supersedes_created.length}</span>
            {r.supersedes_created.length > 0 ? (
              <div className="mt-1 space-y-0.5 text-[13px]">
                {r.supersedes_created.map((s) => (
                  <div key={s.fact_id + s.supersedes}>
                    <button className="mono hover:underline" onClick={() => openFact(s.fact_id)}>
                      {s.fact_id}
                    </button>{' '}
                    <span className="text-muted-foreground">{t('home.upload.supersedes')}</span>{' '}
                    <button className="mono hover:underline" onClick={() => openFact(s.supersedes)}>
                      {s.supersedes}
                    </button>
                  </div>
                ))}
              </div>
            ) : r.facts_created.length ? (
              <span className="text-muted-foreground text-[13px]"> · {t('home.upload.keptEvidence')}</span>
            ) : null}
          </>,
        )}
      </div>
    </div>
  )
}
