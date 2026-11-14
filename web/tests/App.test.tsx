import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { getSession } from '../src/api/client'
import { ROUTES } from '../src/lib/router'
import { api, deferred, fail, offline } from './helpers/api'
import { login, me, MEMBERS } from './helpers/fixtures'
import { goto, mockShell, renderWithProviders } from './helpers/render'

// The screens have their own tests. Here each one is a marker, so these tests are about the shell around them:
// routing, the sign-in takeover, offline and loading states, the palette, the drawer and the error boundary.
const state = vi.hoisted(() => ({ boom: false }))

vi.mock('../src/screens/Ask', () => ({ default: () => <div>ask screen</div> }))
vi.mock('../src/screens/Dashboard', () => ({ default: () => <div>dashboard screen</div> }))
vi.mock('../src/screens/Project', () => ({ default: () => <div>projects screen</div> }))
vi.mock('../src/screens/Conflicts', () => ({ default: () => <div>conflicts screen</div> }))
vi.mock('../src/screens/OpenQuestions', () => ({ default: () => <div>open-questions screen</div> }))
vi.mock('../src/screens/Maintenance', () => ({ default: () => <div>maintenance screen</div> }))
vi.mock('../src/screens/Sources', () => ({ default: () => <div>sources screen</div> }))
vi.mock('../src/screens/Settings', () => ({ default: () => <div>settings screen</div> }))
vi.mock('../src/admin/Admin', () => ({ default: () => <div>admin screen</div> }))
vi.mock('../src/screens/Setup', () => ({ default: () => <div>setup screen</div> }))
vi.mock('../src/screens/Audit', () => ({
  default: () => {
    if (state.boom) throw new Error('kaput')
    return <div>audit screen</div>
  },
}))
vi.mock('../src/screens/Memory', async () => {
  const { useApp } = await import('../src/lib/store')
  function MemoryStub() {
    const app = useApp()
    return (
      <div>
        memory screen
        <button onClick={() => app.openFact('M-106')}>open fact</button>
      </div>
    )
  }
  return { default: MemoryStub }
})
vi.mock('../src/ui/FactDrawer', () => ({
  default: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <div role="dialog" aria-label={'fact ' + id}>
      <button onClick={onClose}>close drawer</button>
    </div>
  ),
}))
vi.mock('../src/ui/Palette', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="palette">
      <button onClick={onClose}>close palette</button>
    </div>
  ),
}))

function start(path = '') {
  if (path) goto(path)
  return renderWithProviders(<App />)
}
const sidebar = () => screen.queryByRole('complementary', { name: 'Primary' })
const palette = () => screen.queryByRole('dialog', { name: 'palette' })

beforeEach(() => {
  state.boom = false
  mockShell()
})

describe('App', () => {
  describe('routing', () => {
    it('opens on the Ask screen inside the shell', async () => {
      start()
      expect(await screen.findByText('ask screen')).toBeInTheDocument()
      expect(sidebar()).toBeInTheDocument()
      expect(screen.getByRole('banner')).toBeInTheDocument()
      expect(screen.getByText(/OIDA Benchmark Corpora/)).toBeInTheDocument()
      expect(document.title).toBe('Ask · Canonico')
      expect(api.unhandled).toEqual([])
    })

    it.each(ROUTES.filter((r) => r !== 'login' && r !== 'app'))('#/%s shows its screen and names it in the tab title', async (r) => {
      start(r)
      expect(await screen.findByText(`${r} screen`)).toBeInTheDocument()
      const titles: Record<string, string> = {
        setup: 'Setup',
        dashboard: 'Home',
        projects: 'Overview',
        memory: 'Memory',
        conflicts: 'Conflicts',
        'open-questions': 'Open questions',
        maintenance: 'Maintenance',
        sources: 'Sources',
        settings: 'Settings',
        audit: 'Audit log',
        admin: 'Demo control',
      }
      expect(document.title).toBe(`${titles[r]} · Canonico`)
    })

    it('#/home opens the dashboard', async () => {
      start('home')
      expect(await screen.findByText('dashboard screen')).toBeInTheDocument()
      expect(document.title).toBe('Home · Canonico')
    })

    it('an address it does not know is the Ask screen', async () => {
      start('nowhere')
      expect(await screen.findByText('ask screen')).toBeInTheDocument()
    })

    it('follows the address when it changes, and marks the screen in the sidebar', async () => {
      start('conflicts')
      await screen.findByText('conflicts screen')
      expect(within(sidebar()!).getByRole('link', { name: /^Conflicts/ })).toHaveAttribute('aria-current', 'page')
      act(() => goto('audit'))
      expect(await screen.findByText('audit screen')).toBeInTheDocument()
      expect(screen.queryByText('conflicts screen')).not.toBeInTheDocument()
      expect(document.title).toBe('Audit log · Canonico')
      expect(within(sidebar()!).getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page')
    })

    it('the tab title follows the language', async () => {
      const { user } = start('memory')
      await screen.findByText('memory screen')
      await user.click(screen.getByRole('button', { name: 'it' }))
      await waitFor(() => expect(document.title).toBe('Memoria · Canonico'))
    })

    it('the setup screen takes the whole page', async () => {
      start('setup')
      expect(await screen.findByText('setup screen')).toBeInTheDocument()
      expect(sidebar()).not.toBeInTheDocument()
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    })
  })

  describe('before the backend answered', () => {
    it('shows the shell with a placeholder instead of the screen', async () => {
      const gate = deferred()
      api.get('/org', () => gate.promise)
      start('memory')
      expect(sidebar()).toBeInTheDocument()
      expect(document.querySelector('main .skel')).not.toBeNull()
      expect(screen.queryByText('memory screen')).not.toBeInTheDocument()
      gate.resolve({ id: 'org-meridian', name: 'Meridian Labs' })
      expect(await screen.findByText('memory screen')).toBeInTheDocument()
      expect(document.querySelector('main .skel')).toBeNull()
    })
  })

  describe('backend not reachable', () => {
    it('says so, with the address it is looking at, instead of the screen', async () => {
      api.get('/org', offline)
      start('memory')
      expect(await screen.findByText('The backend is not reachable')).toBeInTheDocument()
      expect(screen.getByText(/Looking for it at http:\/\/api\.test\./)).toBeInTheDocument()
      expect(screen.queryByText('memory screen')).not.toBeInTheDocument()
      expect(sidebar()).toBeInTheDocument()
    })

    it('Try again loads the screen once the backend is back', async () => {
      api.get('/org', offline)
      const { user } = start('memory')
      await screen.findByText('The backend is not reachable')
      mockShell()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('memory screen')).toBeInTheDocument()
      expect(screen.queryByText('The backend is not reachable')).not.toBeInTheDocument()
    })

    it('Try again keeps the message while the backend is still down', async () => {
      api.get('/org', offline)
      const { user } = start()
      await screen.findByText('The backend is not reachable')
      const before = api.callsTo('GET', '/org').length
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(api.callsTo('GET', '/org').length).toBe(before + 1))
      expect(screen.getByText('The backend is not reachable')).toBeInTheDocument()
    })
  })

  describe('sign-in', () => {
    /** A backend that only answers to signed-in members. */
    const requireSignIn = () => {
      api.get('/me', (req) => (req.headers.get('Authorization') === 'Bearer tok-marco' ? me({ as: MEMBERS.marco }) : fail(401, 'Sign in', 'unauthorized')))
      api.post('/auth/login', (req) => {
        const { email, password } = req.body as { email: string; password: string }
        return email === 'marco@meridianlabs.org' && password === 'right' ? login({ member: MEMBERS.marco, token: 'tok-marco' }) : fail(401, 'Invalid credentials', 'unauthorized')
      })
      api.post('/auth/logout', () => undefined)
    }

    it('the sign-in page replaces every screen while the backend wants a session, and keeps the address', async () => {
      requireSignIn()
      start('audit')
      expect(await screen.findByRole('heading', { name: 'Sign in to Canonico' })).toBeInTheDocument()
      expect(screen.queryByText('audit screen')).not.toBeInTheDocument()
      expect(sidebar()).not.toBeInTheDocument()
      expect(location.hash).toBe('#/audit')
      expect(document.title).toBe('Sign in · Canonico')
      expect(screen.queryByRole('link', { name: 'Continue without signing in' })).not.toBeInTheDocument()
    })

    it('after signing in the person lands on the screen the address pointed to', async () => {
      requireSignIn()
      const { user } = start('audit')
      await user.type(await screen.findByLabelText('Email'), 'marco@meridianlabs.org')
      await user.type(screen.getByLabelText('Password'), 'right')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByText('audit screen')).toBeInTheDocument()
      expect(location.hash).toBe('#/audit')
      expect(within(sidebar()!).getByRole('button', { name: /Marco Fiore/ })).toBeInTheDocument()
      expect(getSession()).toMatchObject({ token: 'tok-marco', memberId: 'mem-marco' })
    })

    it('a wrong password keeps the sign-in page', async () => {
      requireSignIn()
      const { user } = start('audit')
      await user.type(await screen.findByLabelText('Email'), 'marco@meridianlabs.org')
      await user.type(screen.getByLabelText('Password'), 'wrong')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
      expect(screen.queryByText('audit screen')).not.toBeInTheDocument()
      expect(getSession()).toBeNull()
    })

    it('signing out from the identity menu returns to the sign-in page', async () => {
      requireSignIn()
      const { user } = start('audit')
      await user.type(await screen.findByLabelText('Email'), 'marco@meridianlabs.org')
      await user.type(screen.getByLabelText('Password'), 'right')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await screen.findByText('audit screen')

      await user.click(within(sidebar()!).getByRole('button', { name: /Marco Fiore/ }))
      await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
      expect(await screen.findByRole('heading', { name: 'Sign in to Canonico' })).toBeInTheDocument()
      expect(api.last('POST', '/auth/logout')!.headers.get('Authorization')).toBe('Bearer tok-marco')
      expect(getSession()).toBeNull()
      expect(await screen.findByText('Signed out')).toBeInTheDocument()
    })

    it('#/login is reachable without the backend asking, and offers to continue without signing in', async () => {
      start('login/memory')
      expect(await screen.findByRole('heading', { name: 'Sign in to Canonico' })).toBeInTheDocument()
      expect(sidebar()).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Continue without signing in' })).toHaveAttribute('href', '#/memory')
    })

    it('has no command palette on the sign-in page', async () => {
      const { user } = start('login')
      await screen.findByRole('heading', { name: 'Sign in to Canonico' })
      await user.keyboard('{Control>}k{/Control}')
      expect(palette()).not.toBeInTheDocument()
    })
  })

  describe('command palette', () => {
    it.each([
      ['Ctrl+K', '{Control>}k{/Control}'],
      ['⌘K', '{Meta>}k{/Meta}'],
      ['Ctrl+Shift+K', '{Control>}{Shift>}K{/Shift}{/Control}'],
    ])('%s opens it and closes it again', async (_, keys) => {
      const { user } = start()
      await screen.findByText('ask screen')
      await user.keyboard(keys)
      expect(palette()).toBeInTheDocument()
      await user.keyboard(keys)
      expect(palette()).not.toBeInTheDocument()
    })

    it('a plain K does nothing', async () => {
      const { user } = start()
      await screen.findByText('ask screen')
      await user.keyboard('k')
      expect(palette()).not.toBeInTheDocument()
    })

    it('opens from the search button of the sidebar and closes itself', async () => {
      const { user } = start()
      await screen.findByText('ask screen')
      await user.click(screen.getByRole('button', { name: /Search or jump to/ }))
      expect(palette()).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'close palette' }))
      expect(palette()).not.toBeInTheDocument()
    })

    it('works on the setup screen too', async () => {
      const { user } = start('setup')
      await screen.findByText('setup screen')
      await user.keyboard('{Control>}k{/Control}')
      expect(palette()).toBeInTheDocument()
    })
  })

  describe('navigation on small screens', () => {
    const scrim = () => document.querySelector('.scrim')

    it('opens from the menu button and closes on the scrim', async () => {
      const { user } = start()
      await screen.findByText('ask screen')
      expect(sidebar()).toHaveClass('hidden')
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      expect(sidebar()).toHaveClass('fixed')
      await user.click(scrim()!)
      expect(sidebar()).toHaveClass('hidden')
      expect(scrim()).toBeNull()
    })

    it('closes when the person navigates', async () => {
      const { user } = start()
      await screen.findByText('ask screen')
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      act(() => goto('memory'))
      await screen.findByText('memory screen')
      expect(sidebar()).toHaveClass('hidden')
      expect(scrim()).toBeNull()
    })
  })

  describe('fact drawer', () => {
    const drawer = () => screen.queryByRole('dialog', { name: 'fact M-106' })

    it('opens over the current screen and closes', async () => {
      const { user } = start('memory')
      await user.click(await screen.findByRole('button', { name: 'open fact' }))
      expect(drawer()).toBeInTheDocument()
      expect(screen.getByText('memory screen')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'close drawer' }))
      expect(drawer()).not.toBeInTheDocument()
    })

    it('closes when the person goes to another screen', async () => {
      const { user } = start('memory')
      await user.click(await screen.findByRole('button', { name: 'open fact' }))
      act(() => goto('audit'))
      await screen.findByText('audit screen')
      expect(drawer()).not.toBeInTheDocument()
    })

    it('stays open on the address of a fact, #/memory/<id>', async () => {
      const { user } = start('memory')
      await user.click(await screen.findByRole('button', { name: 'open fact' }))
      act(() => goto('memory/M-106'))
      await waitFor(() => expect(location.hash).toBe('#/memory/M-106'))
      expect(drawer()).toBeInTheDocument()
    })
  })

  describe('when a screen crashes', () => {
    it('shows the error in place of the screen, keeps the shell, and recovers on the next screen', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      state.boom = true
      start('audit')
      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('kaput')).toBeInTheDocument()
      expect(sidebar()).toBeInTheDocument()

      act(() => goto('memory'))
      expect(await screen.findByText('memory screen')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
      quiet.mockRestore()
    })
  })
})
