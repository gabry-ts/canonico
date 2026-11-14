import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import type { Route } from '../lib/router'
import { useApp } from '../lib/store'
import { Avatar, Ic } from '../ui/Icon'
import { IdentityMenu, LanguageSwitch, ThemeMenu } from './menus'
import { setTopbarSlot, useTopbarSlot } from './topbarSlot'

/** Renders its children in the top bar, left of the theme button. Use for a screen's primary action (Export, Add source…). */
export function TopbarActions({ children }: { children: ReactNode }) {
  const el = useTopbarSlot()
  return el ? createPortal(children, el) : null
}

export default function Topbar({ route, onNav }: { route: Route; onNav: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const orgName = app.org?.name ?? ''
  const scopeLabel =
    route.r === 'projects'
      ? t('shell.projects')
      : route.r === 'settings' || route.r === 'admin' || route.r === 'audit'
        ? orgName
        : app.scope === 'org'
          ? orgName
          : (app.project?.name ?? '')
  const title = route.r === 'projects' ? (app.project?.name ?? t('nav.projects')) : t('nav.' + route.r)
  const me = app.me
  return (
    <header className="h-[52px] shrink-0 border-b flex items-center gap-3 px-4 lg:px-5">
      <button className="btn btn-ghost btn-icon btn-sm lg:hidden -ml-1" onClick={onNav} aria-label={t('shell.openNav')}>
        <Ic n="menu" />
      </button>
      <nav className="flex items-center gap-1.5 min-w-0 text-[13.5px]" aria-label={t('shell.breadcrumb')}>
        <span className="text-muted-foreground truncate">{scopeLabel}</span>
        <Ic n="right" className="sm text-muted-foreground/60" />
        <span className="font-medium truncate">{title}</span>
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {route.r === 'app' && (
          <div className="seg" role="group" aria-label={t('shell.scope')}>
            <button className={app.scope === 'org' ? '' : 'on'} onClick={() => app.setScope('project')}>
              <Ic n="folder" className="sm" />
              {t('shell.scopeProject')}
            </button>
            <button className={app.scope === 'org' ? 'on' : ''} onClick={() => app.setScope('org')}>
              <Ic n="org" className="sm" />
              {t('shell.scopeOrg')}
            </button>
          </div>
        )}
        <div ref={setTopbarSlot} className="flex items-center gap-2" />
        <LanguageSwitch />
        <ThemeMenu />
        <span className="w-px h-5 bg-border mx-1" />
        <IdentityMenu
          align="right"
          trigger={(toggle) => (
            <button className="flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-full hover:bg-accent text-[13px]" onClick={toggle} aria-haspopup="menu" aria-label={t('shell.identity')}>
              <Avatar name={me?.member.name} />
              <span className="font-medium">{app.actorName || '…'}</span>
              {me?.title && <span className="text-muted-foreground hidden md:inline">· {me.title}</span>}
            </button>
          )}
        />
      </div>
    </header>
  )
}
