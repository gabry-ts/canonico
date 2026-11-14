import { useState } from 'react'
import { call, client, errMsg, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { useApp } from '../../lib/store'
import { useApi } from '../../lib/useApi'
import { usePerm } from '../../lib/perm'
import { Ic } from '../../ui/Icon'
import { Dialog } from '../../ui/overlays'
import { toast, toastError } from '../../ui/toast'
import { CardHead, CopyField, FieldErr, Loading } from './ui'

type Mail = Schemas['MailConfig']

export function OrgCard() {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const [name, setName] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const val = name ?? app.org?.name ?? ''
  const save = async () => {
    if (!val.trim()) return setErr(t('org.orgcard.nameErr'))
    setErr(null)
    try {
      await call(client.PATCH('/org', { body: { name: val.trim() } }))
      toast(t('org.orgcard.saved'), { icon: 'check' })
      setName(null)
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  return (
    <div className="card overflow-hidden">
      <CardHead title={t('org.orgcard.title')} />
      <div className="p-5 space-y-4">
        <div>
          <label className="label" htmlFor="orgName">
            {t('org.orgcard.name')}
          </label>
          <input id="orgName" className={'input ' + (err ? 'invalid' : '')} value={val} onChange={(e) => setName(e.target.value)} />
          <FieldErr msg={err} />
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {t('org.orgcard.id')} <span className="mono">{app.org?.id}</span>
        </div>
      </div>
      <footer className="px-5 py-3 border-t bg-muted/30 flex justify-end">
        <button className="btn btn-primary btn-sm" {...attrs('manage_members')} onClick={() => can('manage_members') && void save()}>
          {t('org.orgcard.save')}
        </button>
      </footer>
    </div>
  )
}

export function OrgMailCard() {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const mail = useApi(() => call(client.GET('/org/mail')), [app.version])
  const [edit, setEdit] = useState<Partial<Mail>>({})
  const over = useApi(
    async () => {
      const r = await Promise.all(app.projects.map((p) => call(client.GET('/projects/{project_id}/mail', { params: { path: { project_id: p.id } } })).then((m) => m.overridden)))
      return r.filter(Boolean).length
    },
    [app.version, app.projects.length],
  )
  if (mail.loading && !mail.data) return <div className="card"><CardHead title={t('org.orgmail.title')} /><Loading /></div>
  if (mail.error || !mail.data)
    return (
      <div className="card">
        <CardHead title={t('org.orgmail.title')} />
        <div className="p-5 text-[13.5px]">{t('common.loadError', { message: mail.error ?? '' })}</div>
      </div>
    )
  const cur: Mail = { ...mail.data, ...edit }
  const imap = cur.mode === 'imap_mock' || cur.mode === 'imap'
  const modes = (mail.data.mode === 'imap' ? ['imap', 'imap_mock', 'webhook'] : ['imap_mock', 'webhook']) as Mail['mode'][]
  const modeKey = (m: Mail['mode']) => (m === 'imap' ? 'org.mail.modeImapReal' : m === 'imap_mock' ? 'org.mail.modeImap' : 'org.mail.modeWebhook')
  const set = (p: Partial<Mail>) => setEdit((e) => ({ ...e, ...p }))
  const save = async () => {
    try {
      await call(
        client.PUT('/org/mail', {
          body: { mode: cur.mode, imap_host: cur.imap_host ?? null, imap_user: cur.imap_user ?? null, inbound_address: cur.inbound_address ?? null, poll_interval_s: cur.poll_interval_s },
        }),
      )
      toast(t('org.orgmail.saved'), { icon: 'check' })
      setEdit({})
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const inherited = app.projects.length - (over.data ?? 0)
  return (
    <div className="card overflow-hidden">
      <CardHead title={t('org.orgmail.title')} right={<span className="badge">{t('org.orgmail.badge')}</span>} />
      <div className="p-5 space-y-4">
        <div className={'grid gap-2 ' + (modes.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {modes.map((m) => (
            <button key={m} type="button" className={'radio-card ' + (cur.mode === m ? 'on' : '')} onClick={() => set({ mode: m })}>
              <span className="radio-dot"></span>
              <span>
                <span className="block text-[13.5px] font-medium">{t(modeKey(m))}</span>
                <span className="block text-[12.5px] text-muted-foreground">{t(modeKey(m) + 'Sub')}</span>
              </span>
            </button>
          ))}
        </div>
        {imap && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('org.mail.imapHost')}</label>
              <input className="input mono !text-[13px]" value={cur.imap_host ?? ''} onChange={(e) => set({ imap_host: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('org.mail.imapUser')}</label>
              <input className="input mono !text-[13px]" value={cur.imap_user ?? ''} onChange={(e) => set({ imap_user: e.target.value })} />
            </div>
          </div>
        )}
        <div>
          <label className="label">{t('org.mail.inboundAddress')}</label>
          <input className="input mono !text-[13px]" value={cur.inbound_address ?? ''} onChange={(e) => set({ inbound_address: e.target.value })} />
        </div>
        <p className="text-[12.5px] text-muted-foreground">{t('org.orgmail.inheritedBy', { count: inherited, total: app.projects.length })}</p>
      </div>
      <footer className="px-5 py-3 border-t bg-muted/30 flex justify-end">
        <button className="btn btn-primary btn-sm" {...attrs('manage_mail')} onClick={() => can('manage_mail') && void save()}>
          {t('org.orgmail.save')}
        </button>
      </footer>
    </div>
  )
}

function TagRuleDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const [tag, setTag] = useState('')
  const [project, setProject] = useState(app.projectId)
  const [priority, setPriority] = useState('10')
  const [err, setErr] = useState<{ tag?: string; priority?: string }>({})
  const submit = async () => {
    const e: typeof err = {}
    if (!tag.trim()) e.tag = t('org.tagrules.tagErr')
    if (!/^\d+$/.test(priority.trim())) e.priority = t('org.tagrules.priorityErr')
    setErr(e)
    if (e.tag || e.priority) return
    try {
      await call(client.POST('/org/tag-rules', { body: { tag: tag.trim(), project_id: project, priority: Number(priority) } }))
      toast(t('org.tagrules.added'), { icon: 'check' })
      await app.refresh()
      onClose()
    } catch (x) {
      toastError(errMsg(x))
    }
  }
  return (
    <Dialog
      title={t('org.tagrules.dialogTitle')}
      sub={t('org.tagrules.dialogSub')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()}>
            {t('org.tagrules.add')}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="dTag">
        {t('org.tagrules.tag')}
      </label>
      <input id="dTag" className={'input mono !text-[13.5px] ' + (err.tag ? 'invalid' : '')} value={tag} placeholder={t('org.tagrules.tagPh')} onChange={(e) => setTag(e.target.value)} autoFocus />
      <FieldErr msg={err.tag} />
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="label" htmlFor="dTP">
            {t('org.tagrules.project')}
          </label>
          <select id="dTP" className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            {app.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dTPr">
            {t('org.tagrules.priority')}
          </label>
          <input id="dTPr" className={'input mono ' + (err.priority ? 'invalid' : '')} value={priority} onChange={(e) => setPriority(e.target.value)} />
          <FieldErr msg={err.priority} />
        </div>
      </div>
    </Dialog>
  )
}

export function HooksRow() {
  const { t, fmtDate } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const hook = useApi(() => call(client.GET('/org/hooks')), [app.version])
  const rules = useApi(() => call(client.GET('/org/tag-rules')), [app.version])
  const [secret, setSecret] = useState<string | null>(null)
  const [dlg, setDlg] = useState(false)
  const [tags, setTags] = useState('clearpath, topic:onboarding-target')
  const [res, setRes] = useState<{ none?: boolean; rule?: string; project?: string; topics: string[] } | 'empty' | null>(null)
  const pname = (id: string | null | undefined) => app.projects.find((p) => p.id === id)?.name ?? id ?? ''

  const rotate = async () => {
    try {
      const r = await call(client.POST('/org/hooks/rotate-secret'))
      setSecret(r.secret)
      toast(t('org.hook.rotated'), { icon: 'key' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const del = async (id: string) => {
    try {
      await call(client.DELETE('/org/tag-rules/{rule_id}', { params: { path: { rule_id: id } } }))
      toast(t('org.tagrules.removed'), { icon: 'check' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const test = async () => {
    const list = tags.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
    if (!list.length) return setRes('empty')
    try {
      const r = await call(client.POST('/org/tag-rules/test', { body: { tags: list } }))
      setRes({ none: !r.rule_id, rule: r.rule_id ?? undefined, project: r.project_id ?? undefined, topics: list.filter((x) => x.startsWith('topic:')) })
    } catch (e) {
      toastError(errMsg(e))
    }
  }
  const list = [...(rules.data?.items ?? [])].sort((a, b) => a.priority - b.priority)
  const h = hook.data

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mt-5">
      <div className="xl:col-span-2 card overflow-hidden">
        <CardHead title={t('org.hook.title')} right={<span className="badge">{t('org.hook.badge')}</span>} />
        {hook.loading && !h ? (
          <Loading />
        ) : hook.error || !h ? (
          <div className="p-5 text-[13.5px]">{t('common.loadError', { message: hook.error ?? '' })}</div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-[13px] text-muted-foreground leading-relaxed">{t('org.hook.intro')}</p>
            <div>
              <div className="label">{t('org.hook.url')}</div>
              <CopyField value={h.url} />
            </div>
            <div>
              <div className="label">{t('org.hook.secret')}</div>
              {secret ? (
                <>
                  <CopyField value={secret} />
                  <div className="help flex items-center gap-1.5 !text-warning-text">
                    <Ic n="alert" className="sm" />
                    <span>{t('org.hook.shownOnce', { last4: h.secret_last4 })}</span>
                    <button className="link ml-auto" onClick={() => setSecret(null)}>
                      {t('org.hook.done')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input className="input mono !text-[13px]" readOnly value={'whsec_••••••••' + h.secret_last4} aria-label={t('org.hook.secretLast4')} />
                    <button className="btn btn-outline shrink-0" {...attrs('manage_sources')} onClick={() => can('manage_sources') && void rotate()}>
                      <Ic n="key" className="sm" />
                      {t('org.hook.rotate')}
                    </button>
                  </div>
                  <div className="help">
                    {t('org.hook.rotateHelp')} {fmtDate(h.created_at)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="xl:col-span-3 card overflow-hidden">
        <CardHead
          title={t('org.tagrules.title')}
          sub={t('org.tagrules.sub')}
          right={
            <button className="btn btn-outline btn-sm" {...attrs('manage_sources')} onClick={() => can('manage_sources') && setDlg(true)}>
              <Ic n="plus" className="sm" />
              {t('org.tagrules.add')}
            </button>
          }
        />
        {rules.loading && !rules.data ? (
          <Loading />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('org.tagrules.tag')}</th>
                <th>{t('org.tagrules.project')}</th>
                <th className="text-right">{t('org.tagrules.priority')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.length ? (
                list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className={'tag' + (r.tag.startsWith('topic:') ? ' topic' : '')}>{r.tag}</span>
                    </td>
                    <td>{pname(r.project_id)}</td>
                    <td className="text-right mono">{r.priority}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-ghost btn-icon btn-sm" {...attrs('manage_sources')} onClick={() => can('manage_sources') && void del(r.id)} aria-label={t('org.tagrules.remove') + ' ' + r.tag}>
                        <Ic n="x" className="sm" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center text-muted-foreground !py-8">
                    {t('org.tagrules.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <div className="border-t p-5">
          <label className="label" htmlFor="tagTest">
            {t('org.tagrules.testLabel')}
          </label>
          <div className="flex gap-2">
            <input id="tagTest" className="input mono !text-[13px]" value={tags} placeholder={t('org.tagrules.testPh')} onChange={(e) => setTags(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void test()} />
            <button className="btn btn-outline shrink-0" onClick={() => void test()}>
              {t('org.tagrules.test')}
            </button>
          </div>
          {res === null ? (
            <p className="help">{t('org.tagrules.testHelp')}</p>
          ) : res === 'empty' ? (
            <p className="help">{t('org.tagrules.testEmpty')}</p>
          ) : (
            <div className={'fade-in mt-3 rounded-[10px] px-4 py-3 text-[13.5px] ' + (res.none ? 'bg-warning-soft text-warning-text' : 'bg-muted/60')}>
              {res.none ? (
                t('org.tagrules.testNone')
              ) : (
                <span>
                  {t('org.tagrules.testMatch', { rule: res.rule ?? '', project: pname(res.project) })}
                </span>
              )}
              {res.topics.length > 0 && (
                <div className="mt-1">
                  {res.topics.map((x) => (
                    <span key={x} className="tag topic mr-1">
                      {x}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {dlg && <TagRuleDialog onClose={() => setDlg(false)} />}
    </div>
  )
}
