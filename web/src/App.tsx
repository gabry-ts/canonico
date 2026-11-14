import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { API_URL } from './api/client'
import { useI18n } from './i18n'
import { useRoute, type RouteName } from './lib/router'
import { useApp } from './lib/store'
import Sidebar from './shell/Sidebar'
import Topbar from './shell/Topbar'
import FactDrawer from './ui/FactDrawer'
import { Empty, Skeleton, Tips } from './ui/overlays'
import Palette from './ui/Palette'
import { Toaster } from './ui/toast'

const SCREENS: Record<RouteName, LazyExoticComponent<ComponentType>> = {
  app: lazy(() => import('./screens/Ask')),
  dashboard: lazy(() => import('./screens/Dashboard')),
  projects: lazy(() => import('./screens/Project')),
  memory: lazy(() => import('./screens/Memory')),
  conflicts: lazy(() => import('./screens/Conflicts')),
  'open-questions': lazy(() => import('./screens/OpenQuestions')),
  maintenance: lazy(() => import('./screens/Maintenance')),
  sources: lazy(() => import('./screens/Sources')),
  settings: lazy(() => import('./screens/Settings')),
  audit: lazy(() => import('./screens/Audit')),
  admin: lazy(() => import('./admin/Admin')),
  setup: lazy(() => import('./screens/Setup')),
  login: lazy(() => import('./screens/Login')),
}

class Boundary extends Component<{ children: ReactNode; fallback: (msg: string) => ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

const Loading = () => (
  <div className="max-w-[1080px] mx-auto px-6 py-8">
    <Skeleton rows={4} className="h-12" />
  </div>
)

export default function App() {
  const route = useRoute()
  const app = useApp()
  const { t } = useI18n()
  // The mobile navigation is open only for the route it was opened on, so navigating closes it.
  const routeKey = `${route.r}/${route.sub ?? ''}`
  const [navFor, setNavFor] = useState<string | null>(null)
  const navOpen = navFor === routeKey
  const [palette, setPalette] = useState(false)
  // While the backend wants a session the sign-in page replaces every screen. The address stays as it is, so after
  // signing in the person lands on the screen the link pointed to.
  const page: RouteName = app.signInRequired ? 'login' : route.r
  const Screen = SCREENS[page]

  // Leaving a screen closes the fact drawer; #/memory/<factId> opens it on purpose.
  const { openFact } = app
  useEffect(() => {
    if (route.r !== 'memory' || !route.sub) openFact(null)
  }, [route.r, route.sub, openFact])
  useEffect(() => {
    document.title = `${t('nav.' + page)} · Canonico`
  }, [page, t])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  const screen = (
    <Boundary key={page} fallback={(msg) => <Empty icon="alert" title={t('common.errorTitle')}>{msg}</Empty>}>
      <Suspense fallback={<Loading />}>
        <Screen />
      </Suspense>
    </Boundary>
  )

  const overlays = (
    <>
      {app.factId && <FactDrawer key={app.factId} id={app.factId} onClose={() => app.openFact(null)} />}
      {palette && <Palette onClose={() => setPalette(false)} />}
      <Toaster />
      <Tips />
    </>
  )

  if (page === 'login')
    return (
      <div className="h-full">
        {screen}
        <Toaster />
        <Tips />
      </div>
    )

  if (route.r === 'setup')
    return (
      <div className="h-full">
        {screen}
        {overlays}
      </div>
    )

  return (
    <div className="h-full flex overflow-hidden">
      {navOpen && <div className="scrim lg:hidden" onClick={() => setNavFor(null)} />}
      <Sidebar route={route} open={navOpen} onPalette={() => setPalette(true)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar route={route} onNav={() => setNavFor(routeKey)} />
        <main className="flex-1 min-h-0 relative" tabIndex={-1}>
          {app.ready && app.offline ? (
            <Empty icon="wifioff" title={t('shell.backendDown')}>
              {t('shell.backendDownHelp', { url: API_URL })}
              <div className="mt-4">
                <button className="btn btn-outline btn-sm" onClick={() => void app.refresh()}>
                  {t('common.retry')}
                </button>
              </div>
            </Empty>
          ) : app.ready ? (
            screen
          ) : (
            <Loading />
          )}
        </main>
        <footer className="shrink-0 h-8 border-t flex items-center justify-between gap-6 px-4 lg:px-5 text-[12px] text-muted-foreground">
          <span className="truncate">{t('shell.footerData')}</span>
          <span className="truncate hidden md:inline">{t('shell.footerNote')}</span>
        </footer>
      </div>
      {overlays}
    </div>
  )
}
