import { useState, type ReactNode } from 'react'
import { call, client, type Schemas } from '../api/client'
import { LOCALES, useI18n } from '../i18n'
import { nav, parseHash, routePath } from '../lib/router'
import { useTheme, type ThemePref } from '../lib/theme'
import { useApp } from '../lib/store'
import { Avatar, Ic } from '../ui/Icon'
import { Menu } from '../ui/overlays'
import { toast } from '../ui/toast'

type Member = Schemas['Member']

/**
 * Identity menu. Signed in, it shows the member of the session and Sign out. Otherwise it is the demo identity
 * switcher: it lists the organisation members and sends the chosen one as X-Demo-Actor.
 */
export function IdentityMenu({ trigger, align }: { trigger: (toggle: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const { t } = useI18n()
  const app = useApp()
  const [members, setMembers] = useState<Member[] | null>(null)
  const load = () => {
    if (members) return
    call(client.GET('/org/members'))
      .then((r) => setMembers(Array.isArray(r) ? r : ((r as { items?: Member[] }).items ?? [])))
      .catch(() => setMembers([]))
  }
  const signIn = () => {
    const here = parseHash()
    nav(here.r === 'login' ? 'login' : 'login/' + routePath(here))
  }
  const signOut = () => void app.signOut().then(() => toast(t('auth.signedOut')))
  const member = app.me?.member
  if (app.signedIn)
    return (
      <Menu align={align} trigger={(toggle) => trigger(toggle)}>
        <div className="menu-label">{t('auth.signedInAs')}</div>
        <div className="flex items-center gap-[9px] px-2 pb-2 text-[13.5px]">
          <Avatar name={member?.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{member?.name ?? '…'}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{member?.email}</span>
          </span>
          {app.me && <span className="text-[12px] text-muted-foreground">{t('roles.' + app.me.role)}</span>}
        </div>
        <div className="menu-sep" />
        <button className="menu-item" role="menuitem" onClick={signOut}>
          <Ic n="lock" />
          <span className="flex-1">{t('auth.signOut')}</span>
        </button>
      </Menu>
    )
  return (
    <Menu
      align={align}
      trigger={(toggle) =>
        trigger(() => {
          load()
          toggle()
        })
      }
    >
      <div className="menu-label">{t('shell.switchIdentity')}</div>
      {(members ?? []).filter((m) => m.status === 'active').map((m) => (
        <button key={m.id} className="menu-item" role="menuitem" onClick={() => app.setActor(m.id)}>
          <Avatar name={m.name} />
          <span className="flex-1 truncate">{m.name}</span>
          <span className="text-[12px] text-muted-foreground">{t('roles.' + m.org_role)}</span>
          {app.me?.member.id === m.id && <Ic n="check" className="sm" />}
        </button>
      ))}
      {members === null && <div className="px-2 py-2 text-[13px] text-muted-foreground">{t('common.loading')}</div>}
      <div className="menu-sep" />
      <button className="menu-item" role="menuitem" onClick={signIn}>
        <Ic n="key" />
        <span className="flex-1">{t('auth.signIn')}</span>
      </button>
    </Menu>
  )
}

const THEME_ICON: Record<ThemePref, string> = { light: 'sun', dark: 'moon', system: 'monitor' }

export function ThemeMenu() {
  const { t } = useI18n()
  const [pref, setPref] = useTheme()
  const label: Record<ThemePref, string> = { light: t('shell.themeLight'), dark: t('shell.themeDark'), system: t('shell.themeSystem') }
  return (
    <Menu
      align="right"
      trigger={(toggle) => (
        <button className="btn btn-ghost btn-icon btn-sm" onClick={toggle} aria-label={t('shell.theme')} data-tip={t('shell.theme')}>
          <Ic n={THEME_ICON[pref]} />
        </button>
      )}
    >
      <div className="menu-label">{t('shell.theme')}</div>
      {(['light', 'dark', 'system'] as ThemePref[]).map((p) => (
        <button key={p} className="menu-item" role="menuitemradio" aria-checked={pref === p} onClick={() => setPref(p)}>
          <Ic n={THEME_ICON[p]} />
          <span className="flex-1">{label[p]}</span>
          {pref === p && <Ic n="check" className="sm" />}
        </button>
      ))}
    </Menu>
  )
}

/** Language selector, EN / IT. */
export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n()
  return (
    <div className="seg" role="group" aria-label={t('shell.language')}>
      {LOCALES.map((l) => (
        <button key={l} className={`!px-2 mono !text-[12px] uppercase ${locale === l ? 'on' : ''}`} aria-pressed={locale === l} onClick={() => setLocale(l)} lang={l}>
          {l}
        </button>
      ))}
    </div>
  )
}
