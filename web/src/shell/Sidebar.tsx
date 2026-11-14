import { useState } from 'react'
import { call, client } from '../api/client'
import { useI18n } from '../i18n'
import { nav, type Route, type RouteName } from '../lib/router'
import { usePerm } from '../lib/perm'
import { useApp } from '../lib/store'
import { Avatar, Ic, Logo, type IconName } from '../ui/Icon'
import { Dialog } from '../ui/overlays'
import { toast, toastError } from '../ui/toast'
import { errMsg } from '../api/client'
import { IdentityMenu } from './menus'

function NavItem({ route, r, icon, extra }: { route: Route; r: RouteName; icon: IconName; extra?: React.ReactNode }) {
  const { t } = useI18n()
  const on = route.r === r
  return (
    <a href={`#/${r}`} className={`nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
      <Ic n={icon} />
      <span className="flex-1 truncate">{t('nav.' + r)}</span>
      {extra}
    </a>
  )
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const p = await call(client.POST('/projects', { body: { name: name.trim(), description: description.trim() || undefined } }))
      await app.refresh()
      app.setProjectId(p.id)
      nav('projects/' + p.id)
      toast(t('shell.projectCreated', { name: p.name }))
      onClose()
    } catch (e) {
      toastError(t('common.actionError', { message: errMsg(e) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('shell.newProject')}
      sub={t('shell.newProjectSub')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={submit}>
            {busy && <span className="spin" />}
            {t('shell.createProject')}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="np-name">
        {t('shell.projectName')}
      </label>
      <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <label className="label mt-4" htmlFor="np-desc">
        {t('shell.projectDescription')}
      </label>
      <textarea id="np-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
    </Dialog>
  )
}

export default function Sidebar({ route, open, onPalette }: { route: Route; open: boolean; onPalette: () => void }) {
  const { t, fmtNum } = useI18n()
  const app = useApp()
  const perm = usePerm()
  const [newProject, setNewProject] = useState(false)
  const s = app.stats
  const oc = s?.needs_attention?.conflicts_open ?? s?.open_conflicts ?? 0
  const oq = s?.open_questions ?? 0
  const mq = s?.maintenance_pending ?? 0
  const org = app.scope === 'org'
  const me = app.me

  return (
    <aside
      className={`${open ? 'flex fixed inset-y-0 left-0 z-50 shadow-2xl' : 'hidden lg:flex'} w-[248px] shrink-0 flex-col bg-sidebar border-r`}
      aria-label={t('shell.primaryNav')}
    >
      <div className="h-[52px] shrink-0 px-3 flex items-center border-b">
        <a href="#/settings" className="flex items-center gap-2.5 h-9 px-1.5 -mx-0.5 rounded-md hover:bg-accent min-w-0 flex-1 text-left">
          <Logo />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold leading-tight truncate">{app.org?.name ?? '…'}</span>
            <span className="block text-[11.5px] text-muted-foreground leading-tight">{t('shell.product')}</span>
          </span>
        </a>
      </div>
      <div className="px-3 pt-3">
        <button
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-muted-foreground bg-background shadow-[inset_0_0_0_1px_hsl(var(--border))] hover:shadow-[inset_0_0_0_1px_hsl(var(--input))] hover:text-foreground transition"
          onClick={onPalette}
        >
          <Ic n="search" className="sm" />
          <span className="flex-1 text-left">{t('shell.searchJump')}</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto scroll px-3 py-3 space-y-px">
        <NavItem route={route} r="dashboard" icon="org" />
        <NavItem route={route} r="app" icon="ask" />
        <NavItem route={route} r="memory" icon="memory" extra={s ? <span className="mono text-[11.5px] text-muted-foreground">{fmtNum(s.facts_total)}</span> : null} />
        <NavItem route={route} r="conflicts" icon="conflict" extra={oc ? <span className="count warn">{oc}</span> : null} />
        <NavItem route={route} r="open-questions" icon="question" extra={oq ? <span className="count violet">{oq}</span> : null} />
        <NavItem route={route} r="maintenance" icon="archive" extra={mq ? <span className="count">{mq}</span> : null} />
        <NavItem route={route} r="sources" icon="sources" />
        <NavItem route={route} r="audit" icon="audit" />
        <div className="pt-4">
          <div className="nav-label">
            <span>{t('shell.scope')}</span>
          </div>
          <button className={`nav-item ${org ? 'on' : ''}`} onClick={() => app.setScope(org ? 'project' : 'org')} data-tip={t('shell.wholeOrgTip')} aria-pressed={org}>
            <Ic n="org" />
            <span className="flex-1 truncate">{t('shell.wholeOrg')}</span>
          </button>
          <div className="nav-label mt-2">
            <span>{t('shell.projects')}</span>
            <button
              className="btn btn-ghost btn-icon !w-6 !h-6 !rounded-md"
              aria-label={t('shell.newProject')}
              {...perm.attrs('manage_sources')}
              onClick={perm.guard('manage_sources', () => setNewProject(true))}
            >
              <Ic n="plus" className="sm" />
            </button>
          </div>
          {app.projects.map((p) => {
            const on = p.id === app.projectId
            return (
              <div key={p.id}>
                <button
                  className={`nav-item ${on && route.r === 'projects' ? 'on' : ''}`}
                  onClick={() => {
                    app.setProjectId(p.id)
                    app.setScope('project')
                    nav('projects/' + p.id)
                  }}
                >
                  <Ic n="folder" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {!on && <span className="text-[11.5px] text-muted-foreground">{t('shell.isolated')}</span>}
                </button>
                {on && app.sources.length > 0 && (
                  <div className="ml-[15px] pl-2 mt-0.5 mb-1 border-l space-y-px">
                    {app.sources.map((x) => (
                      <button key={x.id} className="nav-item !h-7" onClick={() => nav(`projects/${p.id}/${x.id}`)}>
                        <span className={`dot ${x.status === 'syncing' ? 'sync' : x.status === 'error' ? 'warn' : x.status === 'idle' ? 'idle' : ''}`} />
                        <span className="flex-1 truncate">{x.type === 'webhook' || x.type === 'github' ? x.label : t('shell.sourceTypes.' + x.type)}</span>
                        {x.items != null && <span className="mono text-[11.5px] text-muted-foreground">{fmtNum(x.items)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <p className="px-2 mt-3 text-[12px] text-muted-foreground leading-relaxed">{t('shell.isolationNote')}</p>
        </div>
      </nav>
      <div className="shrink-0 border-t p-3 space-y-px">
        <NavItem route={route} r="settings" icon="settings" />
        <NavItem route={route} r="admin" icon="admin" extra={perm.can('admin_demo') ? null : <Ic n="lock" className="sm text-muted-foreground" />} />
        <IdentityMenu
          trigger={(toggle) => (
            <button className="mt-2 w-full flex items-center gap-2.5 h-11 px-2 rounded-md hover:bg-accent text-left" onClick={toggle} aria-haspopup="menu">
              <Avatar name={me?.member.name} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-tight truncate">{me?.member.name ?? '…'}</span>
                <span className="block text-[12px] text-muted-foreground leading-tight truncate">
                  {[me?.title, me ? t('roles.' + me.role) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Ic n="updown" className="sm text-muted-foreground" />
            </button>
          )}
        />
      </div>
      {newProject && <NewProjectDialog onClose={() => setNewProject(false)} />}
    </aside>
  )
}
