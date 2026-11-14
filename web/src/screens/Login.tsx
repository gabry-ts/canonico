import { useState, type FormEvent } from 'react'
import { ApiError, call, client, errMsg, type Schemas } from '../api/client'
import { useI18n } from '../i18n'
import { nav, useRoute } from '../lib/router'
import { useApp } from '../lib/store'
import { LanguageSwitch, ThemeMenu } from '../shell/menus'
import { Avatar, Logo } from '../ui/Icon'
import { FieldErr } from './org/ui'

/**
 * Sign-in page. Reached at #/login (optionally #/login/<path> to return to <path>), and shown in place of any
 * screen while the backend only answers to signed-in members.
 */
export default function Login() {
  const { t } = useI18n()
  const app = useApp()
  const route = useRoute()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Stays set after a successful sign-in, until the app replaces this page.
  const [busy, setBusy] = useState<'password' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [demoOff, setDemoOff] = useState(false)

  // Where to go afterwards. Null when this page replaced another screen: the address is already the right one.
  const target = route.r === 'login' ? (route.sub && !route.sub.startsWith('login') ? route.sub : 'app') : null

  const enter = (login: Schemas['LoginResponse']) => {
    app.signIn(login)
    if (target) nav(target, { replace: true })
  }
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 0) setError(t('auth.errNetwork'))
    else if (e instanceof ApiError && e.status === 401) setError(t('auth.errCredentials'))
    else setError(t('common.actionError', { message: errMsg(e) }))
    setBusy(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError(t('auth.errRequired'))
      return
    }
    setBusy('password')
    setError(null)
    try {
      enter(await call(client.POST('/auth/login', { body: { email: email.trim(), password } })))
    } catch (e) {
      fail(e)
    }
  }

  const demo = async () => {
    if (busy) return
    setBusy('demo')
    setError(null)
    try {
      enter(await call(client.POST('/auth/demo-login')))
    } catch (e) {
      // 404: the server runs with CANONICO_DEMO_LOGIN off.
      if (e instanceof ApiError && e.status === 404) {
        setDemoOff(true)
        setBusy(null)
      } else fail(e)
    }
  }

  const signedIn = app.signedIn && !busy

  return (
    <div className="h-full overflow-y-auto scroll bg-background flex flex-col">
      <header className="shrink-0 h-[52px] flex items-center justify-between gap-3 px-4 lg:px-5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">{t('shell.product')}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeMenu />
        </div>
      </header>
      <main className="flex-1 flex justify-center px-6 pt-[12vh] pb-12">
        <div className="w-full max-w-[380px] fade-in">
          {signedIn ? (
            <>
              <h1 className="text-[24px] font-semibold tracking-tight">{t('auth.alreadyTitle')}</h1>
              <div className="mt-6 flex items-center gap-3 rounded-[12px] shadow-[inset_0_0_0_1px_hsl(var(--border))] px-4 py-3.5">
                <Avatar name={app.me?.member.name} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium truncate">{app.me?.member.name ?? '…'}</span>
                  <span className="block text-[12.5px] text-muted-foreground truncate">{app.me?.member.email}</span>
                </span>
              </div>
              <div className="mt-6 flex items-center gap-2">
                <a className="btn btn-primary btn-lg flex-1" href={'#/' + (target ?? 'app')}>
                  {t('auth.continue')}
                </a>
                <button className="btn btn-outline btn-lg" onClick={() => void app.signOut()}>
                  {t('auth.signOut')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[24px] font-semibold tracking-tight">{t('auth.title')}</h1>
              <p className="mt-1.5 text-[14.5px] text-muted-foreground leading-relaxed">{t('auth.sub')}</p>
              <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
                <div>
                  <label className="label" htmlFor="login-email">
                    {t('auth.email')}
                  </label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    className="input"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="login-password">
                    {t('auth.password')}
                  </label>
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    className="input"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <div role="alert">
                    <FieldErr msg={error} />
                  </div>
                )}
                <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy !== null}>
                  {busy === 'password' && <span className="spin" />}
                  {t('auth.submit')}
                </button>
              </form>
              {demoOff ? (
                <p className="help mt-6">{t('auth.demoOff')}</p>
              ) : (
                <>
                  <div className="mt-6 flex items-center gap-3 text-[12.5px] text-muted-foreground" aria-hidden="true">
                    <span className="h-px flex-1 bg-border" />
                    {t('auth.or')}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <button type="button" className="btn btn-outline btn-lg w-full mt-6" disabled={busy !== null} onClick={demo}>
                    {busy === 'demo' && <span className="spin" />}
                    {t('auth.demo')}
                  </button>
                  <p className="help text-center">{t('auth.demoHelp')}</p>
                </>
              )}
              {!app.signInRequired && target && (
                <p className="mt-8 text-center">
                  <a href={'#/' + target} className="text-[13px] text-muted-foreground hover:text-foreground">
                    {t('auth.skip')}
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
