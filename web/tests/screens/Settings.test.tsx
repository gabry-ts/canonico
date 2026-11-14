import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppContext } from '../../src/lib/appContext'
import Settings from '../../src/screens/Settings'
import { setTopbarSlot } from '../../src/shell/topbarSlot'
import { api, fail } from '../helpers/api'
import { me, member, MEMBERS } from '../helpers/fixtures'
import { mockMembersTab, mockOrgTab, ROLES, tagRule } from '../helpers/org'
import { goto, makeApp, renderI18n, renderWithApp } from '../helpers/render'

/** The screen under the element the top bar gives to screens for their main action. */
const withTopbar = (
  <>
    <div data-testid="topbar" ref={setTopbarSlot} />
    <Settings />
  </>
)
const tab = (name: string | RegExp) => screen.getByRole('tab', { name })
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent)
const topbar = () => within(screen.getByTestId('topbar'))

beforeEach(() => {
  mockOrgTab({ rules: [tagRule()] })
  mockMembersTab()
  api.get('/roles', ROLES)
})

describe('Settings', () => {
  describe('heading', () => {
    it('names the screen and the organisation', async () => {
      renderWithApp(<Settings />)
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
      expect(screen.getByText('Meridian Labs · organisation, webhooks, tag rules, members and roles.')).toBeInTheDocument()
      await screen.findByRole('tab', { name: 'Members4' })
    })

    it('leaves the organisation name out while it is not known', async () => {
      renderWithApp(<Settings />, { org: null })
      expect(screen.getByText('· organisation, webhooks, tag rules, members and roles.')).toBeInTheDocument()
      await screen.findByRole('tab', { name: 'Members4' })
    })

    it('has the three tabs in order, with the number of members once it is known', async () => {
      renderWithApp(<Settings />)
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Organisation', 'Members', 'Roles'])
      expect(await screen.findByRole('tab', { name: 'Members4' })).toBeInTheDocument()
    })

    it('counts the members the backend says there are, not the ones on the page', async () => {
      api.get('/org/members', { items: [MEMBERS.giulia, MEMBERS.sara], total: 27 })
      renderWithApp(<Settings />)
      expect(await screen.findByRole('tab', { name: 'Members27' })).toBeInTheDocument()
    })

    it('shows no number when the members cannot be loaded', async () => {
      api.get('/org/members', fail(500, 'database is locked'))
      renderWithApp(<Settings />)
      await screen.findByRole('button', { name: 'Rotate secret' })
      expect(tab(/^Members/)).toHaveTextContent(/^Members$/)
    })

    it('counts again when the data changed', async () => {
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp({ version: 1 })}>
          <Settings />
        </AppContext.Provider>,
      )
      await screen.findByRole('tab', { name: 'Members4' })

      mockMembersTab({ members: [...Object.values(MEMBERS), member({ id: 'mem-nina', name: 'Nina Russo', email: 'nina@meridianlabs.org', status: 'invited' })] })
      rerender(
        <AppContext.Provider value={makeApp({ version: 2 })}>
          <Settings />
        </AppContext.Provider>,
      )
      expect(await screen.findByRole('tab', { name: 'Members5' })).toBeInTheDocument()
    })
  })

  describe('which tab is shown', () => {
    it('opens on the organisation: name, mail, webhook and tag rules', async () => {
      goto('settings')
      renderWithApp(<Settings />)
      expect(selected()).toEqual(['Organisation'])
      expect(tab('Organisation')).toHaveClass('on')
      expect(screen.getByLabelText('Name')).toHaveValue('Meridian Labs')
      expect(await screen.findByRole('button', { name: 'Save mail settings' })).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'Rotate secret' })).toBeInTheDocument()
      expect(await screen.findByText('clearpath', { selector: '.tag' })).toBeInTheDocument()
      await screen.findByRole('tab', { name: 'Members4' })
      await screen.findByText('Inherited by 2 of 2 projects.')

      expect(screen.queryByText('Giulia Ferri')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/roles')).toHaveLength(0)
      expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('opens on the members from #/settings/members', async () => {
      goto('settings/members')
      renderWithApp(<Settings />)
      expect(selected()).toEqual(['Members'])
      expect(await screen.findByText('Giulia Ferri')).toBeInTheDocument()
      expect(screen.getByText('A project role overrides the organisation role for that project only.')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(2))

      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/org/mail')).toHaveLength(0)
      expect(api.callsTo('GET', '/org/hooks')).toHaveLength(0)
      expect(api.callsTo('GET', '/roles')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('opens on the roles from #/settings/roles', async () => {
      goto('settings/roles')
      renderWithApp(<Settings />)
      expect(selected()).toEqual(['Roles'])
      expect(await screen.findByText('Roles are fixed. Read only.')).toBeInTheDocument()
      expect(screen.getByText('Manage members')).toBeInTheDocument()
      await screen.findByRole('tab', { name: 'Members4' })

      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(screen.queryByText('Giulia Ferri')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/org/mail')).toHaveLength(0)
      expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it.each(['settings/billing', 'settings/org', 'settings/members/mem-sara', 'settings/Members'])('falls back to the organisation for #/%s', async (path) => {
      goto(path)
      renderWithApp(<Settings />)
      expect(selected()).toEqual(['Organisation'])
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      await screen.findByRole('button', { name: 'Rotate secret' })
      await screen.findByRole('tab', { name: 'Members4' })
    })

    it('follows the address when it changes', async () => {
      goto('settings')
      renderWithApp(<Settings />)
      await screen.findByRole('button', { name: 'Rotate secret' })

      goto('settings/roles')
      expect(await screen.findByText('Roles are fixed. Read only.')).toBeInTheDocument()
      expect(selected()).toEqual(['Roles'])
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    })
  })

  describe('switching tab', () => {
    it('Members goes to #/settings/members and shows the members', async () => {
      goto('settings')
      const { user } = renderWithApp(<Settings />)
      await user.click(await screen.findByRole('tab', { name: 'Members4' }))

      expect(await screen.findByText('Giulia Ferri')).toBeInTheDocument()
      expect(location.hash).toBe('#/settings/members')
      expect(selected()).toEqual(['Members4'])
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    })

    it('Roles goes to #/settings/roles and shows the permissions', async () => {
      goto('settings')
      const { user } = renderWithApp(<Settings />)
      await user.click(tab('Roles'))

      expect(await screen.findByText('Roles are fixed. Read only.')).toBeInTheDocument()
      expect(location.hash).toBe('#/settings/roles')
      expect(selected()).toEqual(['Roles'])
    })

    it('Organisation goes back to #/settings', async () => {
      goto('settings/roles')
      const { user } = renderWithApp(<Settings />)
      await screen.findByText('Roles are fixed. Read only.')
      await user.click(tab('Organisation'))

      expect(await screen.findByLabelText('Name')).toBeInTheDocument()
      expect(location.hash).toBe('#/settings')
      expect(selected()).toEqual(['Organisation'])
      expect(screen.queryByText('Roles are fixed. Read only.')).not.toBeInTheDocument()
    })
  })

  describe('Invite member', () => {
    it('is in the top bar on the members tab only', async () => {
      goto('settings/members')
      const { user } = renderWithApp(withTopbar)
      await screen.findByText('Giulia Ferri')
      expect(topbar().getByRole('button', { name: 'Invite member' })).toBeInTheDocument()

      await user.click(tab('Roles'))
      await screen.findByText('Roles are fixed. Read only.')
      expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument()

      await user.click(tab('Organisation'))
      await screen.findByLabelText('Name')
      expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument()
    })

    it('is not shown anywhere when there is no top bar', async () => {
      goto('settings/members')
      renderWithApp(<Settings />)
      await screen.findByText('Giulia Ferri')
      expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument()
    })

    it('opens the invite dialog, and Cancel or Escape closes it', async () => {
      goto('settings/members')
      const { user } = renderWithApp(withTopbar)
      await screen.findByText('Giulia Ferri')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(topbar().getByRole('button', { name: 'Invite member' }))
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeInTheDocument()
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(topbar().getByRole('button', { name: 'Invite member' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/org/members')).toHaveLength(0)
    })

    it('invites the member, refreshes and closes the dialog', async () => {
      goto('settings/members')
      const nina = member({ id: 'mem-nina', name: 'Nina Russo', email: 'nina@meridianlabs.org', org_role: 'viewer', status: 'invited' })
      api.post('/org/members', nina)
      const { user, app } = renderWithApp(withTopbar)
      await screen.findByText('Giulia Ferri')
      await user.click(topbar().getByRole('button', { name: 'Invite member' }))
      const dialog = within(screen.getByRole('dialog'))
      await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
      await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
      await user.click(dialog.getByRole('button', { name: 'Send invite' }))

      expect(await screen.findByText('Invite sent to Nina Russo')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(api.last('POST', '/org/members')!.body).toEqual({ name: 'Nina Russo', email: 'nina@meridianlabs.org', org_role: 'viewer' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])
    })

    it('an admin can invite', async () => {
      goto('settings/members')
      const { user } = renderWithApp(withTopbar, { me: me({ as: MEMBERS.marco }) })
      await screen.findByText('Giulia Ferri')
      const invite = topbar().getByRole('button', { name: 'Invite member' })
      expect(invite).not.toHaveAttribute('aria-disabled')
      await user.click(invite)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it.each([
      ['an editor', MEMBERS.sara],
      ['a viewer', MEMBERS.luca],
    ])('%s sees it greyed out and a click opens nothing', async (_who, as) => {
      goto('settings/members')
      const { user } = renderWithApp(withTopbar, { me: me({ as }) })
      await screen.findByText('Giulia Ferri')
      const invite = topbar().getByRole('button', { name: 'Invite member' })
      expect(invite).toHaveAttribute('aria-disabled', 'true')
      expect(invite).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(invite)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
