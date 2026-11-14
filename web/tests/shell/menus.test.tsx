import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from '../../src/i18n'
import { IdentityMenu, LanguageSwitch, ThemeMenu } from '../../src/shell/menus'
import { api, deferred, fail } from '../helpers/api'
import { me, member, MEMBERS } from '../helpers/fixtures'
import { renderI18n, renderWithApp } from '../helpers/render'
import { setSystemDark } from '../setup'

describe('LanguageSwitch', () => {
  function Probe() {
    return <p>{useI18n().t('common.cancel')}</p>
  }

  it('shows the two languages and marks the current one', () => {
    renderI18n(<LanguageSwitch />)
    const group = within(screen.getByRole('group', { name: 'Language' }))
    expect(group.getByRole('button', { name: 'en' })).toHaveAttribute('aria-pressed', 'true')
    expect(group.getByRole('button', { name: 'it' })).toHaveAttribute('aria-pressed', 'false')
    expect(group.getByRole('button', { name: 'it' })).toHaveAttribute('lang', 'it')
  })

  it('switches the whole interface', async () => {
    const { user } = renderI18n(
      <>
        <LanguageSwitch />
        <Probe />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'it' }))
    expect(screen.getByText('Annulla')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'it' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Lingua' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })
})

describe('ThemeMenu', () => {
  const button = () => screen.getByRole('button', { name: /^Theme: / })

  it('is a toggle that says which theme is on', () => {
    renderI18n(<ThemeMenu />)
    expect(button()).toHaveAccessibleName('Theme: Light')
    expect(button()).toHaveAttribute('aria-pressed', 'false')
    expect(button()).toHaveAttribute('data-tip', 'Theme: Light')
  })

  it('switches between light and dark directly, and remembers the choice', async () => {
    const { user } = renderI18n(<ThemeMenu />)
    await user.click(button())
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('canonico-theme')).toBe('dark')
    expect(button()).toHaveAccessibleName('Theme: Dark')
    expect(button()).toHaveAttribute('aria-pressed', 'true')
    expect(button()).toHaveAttribute('data-tip', 'Theme: Dark')

    await user.click(button())
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('canonico-theme')).toBe('light')
    expect(button()).toHaveAccessibleName('Theme: Light')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('starts from the saved theme', () => {
    localStorage.setItem('canonico-theme', 'dark')
    renderI18n(<ThemeMenu />)
    expect(button()).toHaveAccessibleName('Theme: Dark')
  })

  it('with no saved choice it shows the system theme, and the first click leaves it', async () => {
    setSystemDark(true)
    const { user } = renderI18n(<ThemeMenu />)
    expect(button()).toHaveAccessibleName('Theme: Dark')
    expect(document.documentElement).toHaveClass('dark')
    await user.click(button())
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('canonico-theme')).toBe('light')
  })

  it('is labelled in the current language', async () => {
    const { user } = renderI18n(
      <>
        <LanguageSwitch />
        <ThemeMenu />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'it' }))
    expect(screen.getByRole('button', { name: 'Tema: Chiaro' })).toBeInTheDocument()
  })
})

describe('IdentityMenu', () => {
  const trigger = (toggle: () => void) => <button onClick={toggle}>who</button>
  const invited = member({ id: 'mem-new', name: 'Nina Invited', status: 'invited', org_role: 'viewer' })

  describe('demo identity (not signed in)', () => {
    beforeEach(() => {
      api.get('/org/members', { items: [...Object.values(MEMBERS), invited], total: 5 })
    })

    it('loads the members when opened, not before', async () => {
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      expect(api.calls).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: 'who' }))
      expect(screen.getByText('Act as')).toBeInTheDocument()
      expect(await screen.findByRole('menuitem', { name: /Marco Fiore/ })).toBeInTheDocument()
    })

    it('says it is loading until the members arrive', async () => {
      const gate = deferred()
      api.get('/org/members', () => gate.promise)
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      expect(screen.getByText('Loading…')).toBeInTheDocument()
      gate.resolve({ items: [MEMBERS.sara], total: 1 })
      expect(await screen.findByRole('menuitem', { name: /Sara Conti/ })).toBeInTheDocument()
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    it('lists active members with their role, and marks the current identity', async () => {
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />, { me: me({ as: MEMBERS.sara }) })
      await user.click(screen.getByRole('button', { name: 'who' }))
      const items = await screen.findAllByRole('menuitem')
      expect(items.map((i) => i.textContent)).toEqual(['GGiulia Ferriowner', 'MMarco Fioreadmin', 'SSara Contieditor', 'LLuca Neriviewer', 'Sign in'])
      expect(screen.queryByText('Nina Invited')).not.toBeInTheDocument()
      const check = (name: RegExp) => screen.getByRole('menuitem', { name }).querySelectorAll('svg.sm').length
      expect(check(/Sara Conti/)).toBe(1)
      expect(check(/Giulia Ferri/)).toBe(0)
    })

    it('switches to the chosen member and closes', async () => {
      const { user, app } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      await user.click(await screen.findByRole('menuitem', { name: /Luca Neri/ }))
      expect(app.setActor).toHaveBeenCalledWith('mem-luca')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('asks for the members only once', async () => {
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      await screen.findByRole('menuitem', { name: /Marco Fiore/ })
      await user.keyboard('{Escape}')
      await user.click(screen.getByRole('button', { name: 'who' }))
      expect(api.callsTo('GET', '/org/members')).toHaveLength(1)
    })

    it('accepts a bare array of members', async () => {
      api.get('/org/members', [MEMBERS.marco])
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      expect(await screen.findByRole('menuitem', { name: /Marco Fiore/ })).toBeInTheDocument()
    })

    it('still offers Sign in when the members cannot be loaded', async () => {
      api.get('/org/members', fail(500))
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
      expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Sign in'])
    })

    it('Sign in goes to the sign-in page and remembers where the person was', async () => {
      location.hash = '#/memory/M-106'
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      await user.click(screen.getByRole('menuitem', { name: 'Sign in' }))
      expect(location.hash).toBe('#/login/memory/M-106')
    })

    it('Sign in from the sign-in page stays there', async () => {
      location.hash = '#/login/conflicts'
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />)
      await user.click(screen.getByRole('button', { name: 'who' }))
      await user.click(screen.getByRole('menuitem', { name: 'Sign in' }))
      expect(location.hash).toBe('#/login')
    })
  })

  describe('signed in', () => {
    it('shows who is signed in instead of the identity switcher, without loading members', async () => {
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />, { signedIn: true, me: me({ as: MEMBERS.marco }) })
      await user.click(screen.getByRole('button', { name: 'who' }))
      const menu = within(screen.getByRole('menu'))
      expect(menu.getByText('Signed in as')).toBeInTheDocument()
      expect(menu.getByText('Marco Fiore')).toBeInTheDocument()
      expect(menu.getByText('marco@meridianlabs.org')).toBeInTheDocument()
      expect(menu.getByText('admin')).toBeInTheDocument()
      expect(menu.queryByText('Act as')).not.toBeInTheDocument()
      expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Sign out'])
      expect(api.calls).toHaveLength(0)
    })

    it('signs out and confirms', async () => {
      const gate = deferred<void>()
      const signOut = vi.fn(() => gate.promise)
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />, { signedIn: true, signOut })
      await user.click(screen.getByRole('button', { name: 'who' }))
      await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
      expect(signOut).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Signed out')).not.toBeInTheDocument()
      gate.resolve()
      expect(await screen.findByText('Signed out')).toBeInTheDocument()
    })

    it('shows a placeholder while the identity is still loading', async () => {
      const { user } = renderWithApp(<IdentityMenu trigger={trigger} />, { signedIn: true, me: null })
      await user.click(screen.getByRole('button', { name: 'who' }))
      expect(within(screen.getByRole('menu')).getByText('…')).toBeInTheDocument()
    })
  })
})
