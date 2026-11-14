import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppContext } from '../../../src/lib/appContext'
import { InviteDialog, MembersTab, RolesTab } from '../../../src/screens/org/Members'
import { api, deferred, fail, offline } from '../../helpers/api'
import { me, member, MEMBERS, org, PERMISSIONS } from '../../helpers/fixtures'
import { mockMembersTab, projectMember, ROLES } from '../../helpers/org'
import { makeApp, renderI18n, renderWithApp } from '../../helpers/render'

const NINA = member({ id: 'mem-nina', name: 'Nina Russo', email: 'nina@meridianlabs.org', org_role: 'viewer', status: 'invited' })

const row = (text: string) => screen.getByText(text).closest('tr')!
const orgRole = (name: string) => within(row(name)).getByRole('combobox', { name: 'Organisation role' })
const projRole = (name: string, project: string) => within(row(name)).getByRole('combobox', { name: project })
const options = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent)
const toastText = (text: string) => screen.findByText(text, { selector: '.toast *' })

describe('MembersTab', () => {
  describe('listing', () => {
    it('shows a placeholder while the members load', async () => {
      const gate = deferred()
      api.get('/org/members', () => gate.promise)
      api.get('/projects/:project_id/members', [])
      const { container } = renderWithApp(<MembersTab />)
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()

      gate.resolve({ items: [MEMBERS.sara], total: 1 })
      expect(await screen.findByText('Sara Conti')).toBeInTheDocument()
      expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    })

    it('lists every member with email, organisation role and status', async () => {
      mockMembersTab({ members: [...Object.values(MEMBERS), NINA] })
      renderWithApp(<MembersTab />)
      await screen.findByText('Giulia Ferri')

      expect(within(row('Giulia Ferri')).getByText('giulia@meridianlabs.org')).toBeInTheDocument()
      expect(orgRole('Giulia Ferri')).toHaveValue('owner')
      expect(orgRole('Marco Fiore')).toHaveValue('admin')
      expect(orgRole('Sara Conti')).toHaveValue('editor')
      expect(orgRole('Luca Neri')).toHaveValue('viewer')
      expect(within(row('Sara Conti')).getByText('Active')).toHaveClass('badge', 'ok')
      expect(within(row('Nina Russo')).getByText('Invited')).toHaveClass('badge', 'line')
      expect(within(row('Nina Russo')).queryByText('Active')).not.toBeInTheDocument()
      expect(screen.getByText('A project role overrides the organisation role for that project only.')).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('offers the four roles, least powerful first', async () => {
      mockMembersTab()
      renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      expect(options(orgRole('Sara Conti'))).toEqual(['viewer', 'editor', 'admin', 'owner'])
      expect(options(projRole('Sara Conti', 'Internal'))).toEqual(['Inherit', 'viewer', 'editor', 'admin', 'owner'])
    })

    it('has one column per project and asks for the members of each', async () => {
      mockMembersTab()
      renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Member', 'Organisation role', 'Status', 'ClearPath engagement', 'Internal', ''])
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members').map((c) => c.params.project_id).sort()).toEqual(['proj-clearpath', 'proj-internal']))
    })

    it('has no project column and asks for no project members when there is no project', async () => {
      mockMembersTab()
      renderWithApp(<MembersTab />, { projects: [] })
      await screen.findByText('Sara Conti')
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Member', 'Organisation role', 'Status', ''])
      expect(within(row('Sara Conti')).getAllByRole('combobox')).toHaveLength(1)
      expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(0)
    })

    it('shows a role set on the project as an override and the others as inherited from the organisation role', async () => {
      mockMembersTab({ projectRoles: [projectMember({ member_id: 'mem-sara', project_id: 'proj-clearpath', role: 'admin', inherited: false })] })
      renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')

      await waitFor(() => expect(projRole('Sara Conti', 'ClearPath engagement')).toHaveValue('admin'))
      const cells = within(row('Sara Conti')).getAllByRole('cell')
      expect(within(cells[3]).getByText('override')).toHaveClass('badge', 'line')
      expect(within(cells[3]).queryByText(/inherited/)).not.toBeInTheDocument()
      expect(projRole('Sara Conti', 'Internal')).toHaveValue('')
      expect(within(cells[4]).getByText('inherited · editor')).toBeInTheDocument()
      expect(within(cells[4]).queryByText('override')).not.toBeInTheDocument()
      expect(within(row('Luca Neri')).getAllByText('inherited · viewer')).toHaveLength(2)
    })

    it('reads the project members from a bare array and from a page of items', async () => {
      api.get('/org/members', { items: [MEMBERS.sara, MEMBERS.luca], total: 2 })
      api.get('/projects/:project_id/members', (req) => {
        const pid = req.params.project_id
        return pid === 'proj-clearpath'
          ? [projectMember({ member_id: 'mem-sara', project_id: pid, role: 'owner', inherited: false })]
          : { items: [projectMember({ member_id: 'mem-luca', project_id: pid, role: 'editor', inherited: false })] }
      })
      renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      await waitFor(() => expect(projRole('Sara Conti', 'ClearPath engagement')).toHaveValue('owner'))
      expect(projRole('Luca Neri', 'Internal')).toHaveValue('editor')
      expect(projRole('Luca Neri', 'ClearPath engagement')).toHaveValue('')
      expect(projRole('Sara Conti', 'Internal')).toHaveValue('')
    })

    it('treats a page without items as nobody having a project role', async () => {
      api.get('/org/members', { items: [MEMBERS.sara], total: 1 })
      api.get('/projects/:project_id/members', {})
      renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(2))
      expect(projRole('Sara Conti', 'ClearPath engagement')).toHaveValue('')
      expect(within(row('Sara Conti')).getAllByText('inherited · editor')).toHaveLength(2)
    })

    it('shows the error and loads again on retry', async () => {
      mockMembersTab()
      api.get('/org/members', fail(500, 'database is locked'))
      const { user } = renderWithApp(<MembersTab />)
      expect(await screen.findByText(/Could not load this\. database is locked/)).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()

      api.get('/org/members', { items: [MEMBERS.sara], total: 1 })
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('Sara Conti')).toBeInTheDocument()
      expect(screen.queryByText(/Could not load this/)).not.toBeInTheDocument()
    })

    it('says so when the backend cannot be reached', async () => {
      api.get('/org/members', offline)
      api.get('/projects/:project_id/members', [])
      renderWithApp(<MembersTab />)
      expect(await screen.findByText(/Could not load this\./)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    it('loads the members and the project roles again when the data changed', async () => {
      mockMembersTab({ members: [MEMBERS.sara] })
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp({ version: 1 })}>
          <MembersTab />
        </AppContext.Provider>,
      )
      await screen.findByText('Sara Conti')
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(2))

      mockMembersTab({ members: [MEMBERS.sara, MEMBERS.luca] })
      rerender(
        <AppContext.Provider value={makeApp({ version: 2 })}>
          <MembersTab />
        </AppContext.Provider>,
      )
      expect(await screen.findByText('Luca Neri')).toBeInTheDocument()
      expect(api.callsTo('GET', '/org/members')).toHaveLength(2)
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(4))
    })
  })

  describe('changing the organisation role', () => {
    it('saves the new role, says so and refreshes', async () => {
      mockMembersTab()
      api.patch('/org/members/:member_id', (req) => ({ ...MEMBERS.sara, org_role: (req.body as { org_role: string }).org_role }))
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      await user.selectOptions(orgRole('Sara Conti'), 'admin')

      expect(await toastText('Sara Conti is now admin')).toBeInTheDocument()
      const sent = api.last('PATCH', '/org/members/:member_id')!
      expect(sent.params.member_id).toBe('mem-sara')
      expect(sent.body).toEqual({ org_role: 'admin' })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.unhandled).toEqual([])
    })

    it('says why when the backend refuses, does not refresh and loads the list again', async () => {
      mockMembersTab()
      api.patch('/org/members/:member_id', fail(409, 'The organisation needs an owner'))
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Giulia Ferri')
      await user.selectOptions(orgRole('Giulia Ferri'), 'viewer')

      expect(await toastText('The organisation needs an owner')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/org/members')).toHaveLength(2))
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(orgRole('Giulia Ferri')).toHaveValue('owner'))
    })

    it.each([
      ['a viewer', MEMBERS.luca],
      ['an editor', MEMBERS.sara],
    ])('%s cannot change roles: every select is locked and explains why', async (_who, as) => {
      mockMembersTab({ members: [...Object.values(MEMBERS), NINA] })
      renderWithApp(<MembersTab />, { me: me({ as }) })
      await screen.findByText('Sara Conti')
      const selects = screen.getAllByRole('combobox')
      expect(selects).toHaveLength(15)
      for (const s of selects) {
        expect(s).toBeDisabled()
        expect(s).toHaveAttribute('aria-disabled', 'true')
        expect(s).toHaveAttribute('data-tip', 'Requires admin')
      }
    })

    it('an admin can change roles', async () => {
      mockMembersTab()
      renderWithApp(<MembersTab />, { me: me({ as: MEMBERS.marco }) })
      await screen.findByText('Sara Conti')
      for (const s of screen.getAllByRole('combobox')) {
        expect(s).toBeEnabled()
        expect(s).not.toHaveAttribute('aria-disabled')
        expect(s).not.toHaveAttribute('data-tip')
      }
    })
  })

  describe('changing a project role', () => {
    it('sets the role on that project only, says so and refreshes', async () => {
      mockMembersTab()
      api.put('/projects/:project_id/members/:member_id', (req) => projectMember({ member_id: req.params.member_id, project_id: req.params.project_id, role: 'admin', inherited: false }))
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      await user.selectOptions(projRole('Sara Conti', 'Internal'), 'admin')

      expect(await toastText('Sara Conti: role in Internal updated')).toBeInTheDocument()
      const sent = api.last('PUT', '/projects/:project_id/members/:member_id')!
      expect(sent.params).toEqual({ project_id: 'proj-internal', member_id: 'mem-sara' })
      expect(sent.body).toEqual({ member_id: 'mem-sara', role: 'admin' })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.callsTo('DELETE', '/projects/:project_id/members/:member_id')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('choosing Inherit removes the override, says so and refreshes', async () => {
      mockMembersTab({ projectRoles: [projectMember({ member_id: 'mem-sara', project_id: 'proj-clearpath', role: 'admin', inherited: false })] })
      api.delete('/projects/:project_id/members/:member_id', () => undefined)
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Sara Conti')
      await waitFor(() => expect(projRole('Sara Conti', 'ClearPath engagement')).toHaveValue('admin'))
      await user.selectOptions(projRole('Sara Conti', 'ClearPath engagement'), 'Inherit')

      expect(await toastText('Sara Conti inherits the organisation role in ClearPath engagement')).toBeInTheDocument()
      const sent = api.last('DELETE', '/projects/:project_id/members/:member_id')!
      expect(sent.params).toEqual({ project_id: 'proj-clearpath', member_id: 'mem-sara' })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.callsTo('PUT', '/projects/:project_id/members/:member_id')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('says why when the backend refuses, does not refresh and loads the project roles again', async () => {
      mockMembersTab()
      api.put('/projects/:project_id/members/:member_id', fail(403, 'Requires admin on this project'))
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Luca Neri')
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(2))
      await user.selectOptions(projRole('Luca Neri', 'ClearPath engagement'), 'editor')

      expect(await toastText('Requires admin on this project')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/members')).toHaveLength(4))
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(projRole('Luca Neri', 'ClearPath engagement')).toHaveValue(''))
    })
  })

  describe('resending an invite', () => {
    it('is offered only for members who have not joined yet', async () => {
      mockMembersTab({ members: [MEMBERS.sara, NINA] })
      renderWithApp(<MembersTab />)
      await screen.findByText('Nina Russo')
      expect(within(row('Nina Russo')).getByRole('button', { name: 'Resend' })).toBeInTheDocument()
      expect(within(row('Sara Conti')).queryByRole('button')).not.toBeInTheDocument()
    })

    it('sends the invite again to the same address and says so, without refreshing', async () => {
      mockMembersTab({ members: [MEMBERS.sara, NINA] })
      api.patch('/org/members/:member_id', NINA)
      const { user, app } = renderWithApp(<MembersTab />)
      await screen.findByText('Nina Russo')
      await user.click(within(row('Nina Russo')).getByRole('button', { name: 'Resend' }))

      expect(await toastText('Invite sent again to Nina Russo')).toBeInTheDocument()
      const sent = api.last('PATCH', '/org/members/:member_id')!
      expect(sent.params.member_id).toBe('mem-nina')
      expect(sent.body).toEqual({ email: 'nina@meridianlabs.org' })
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('says why when the backend refuses', async () => {
      mockMembersTab({ members: [NINA] })
      api.patch('/org/members/:member_id', fail(429, 'Wait a minute before sending again'))
      const { user } = renderWithApp(<MembersTab />)
      await screen.findByText('Nina Russo')
      await user.click(within(row('Nina Russo')).getByRole('button', { name: 'Resend' }))
      expect(await toastText('Wait a minute before sending again')).toBeInTheDocument()
      expect(within(row('Nina Russo')).getByText('Invited')).toBeInTheDocument()
    })

    it('an editor sees the button greyed out and a click sends nothing', async () => {
      mockMembersTab({ members: [NINA] })
      api.patch('/org/members/:member_id', NINA)
      const { user } = renderWithApp(<MembersTab />, { me: me({ as: MEMBERS.sara }) })
      await screen.findByText('Nina Russo')
      const resend = within(row('Nina Russo')).getByRole('button', { name: 'Resend' })
      expect(resend).toHaveAttribute('aria-disabled', 'true')
      expect(resend).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(resend)
      expect(api.callsTo('PATCH', '/org/members/:member_id')).toHaveLength(0)
      expect(screen.queryByText(/Invite sent again/)).not.toBeInTheDocument()
    })
  })
})

describe('InviteDialog', () => {
  const setup = (over: Parameters<typeof renderWithApp>[1] = {}) => {
    const onClose = vi.fn()
    const view = renderWithApp(<InviteDialog onClose={onClose} />, over)
    const dialog = within(screen.getByRole('dialog'))
    return { ...view, onClose, dialog, send: dialog.getByRole('button', { name: 'Send invite' }) }
  }

  it('says which organisation the member joins and starts in the name field', () => {
    const { dialog } = setup()
    expect(dialog.getByRole('heading', { name: 'Invite a member' })).toBeInTheDocument()
    expect(dialog.getByText('They join Meridian Labs with the role you pick. Project roles can override it later.')).toBeInTheDocument()
    expect(dialog.getByLabelText('Name')).toHaveFocus()
    expect(dialog.getByLabelText('Name')).toHaveAttribute('placeholder', 'Full name')
    expect(dialog.getByLabelText('Email')).toHaveAttribute('placeholder', 'name@company.com')
  })

  it('still opens when the organisation is not known', () => {
    const { dialog } = setup({ org: null })
    expect(dialog.getByText('They join with the role you pick. Project roles can override it later.')).toBeInTheDocument()
  })

  it('offers the four roles with what each is for, viewer first and chosen', () => {
    const { dialog } = setup()
    const role = dialog.getByLabelText('Organisation role')
    expect(role).toHaveValue('viewer')
    expect(options(role)).toEqual([
      'viewer · Asks and browses memory.',
      'editor · Corrects, retires and resolves facts.',
      'admin · Manages sources, mail and members.',
      'owner · Everything, including demo controls.',
    ])
  })

  it('asks for a name and a valid email before sending anything', async () => {
    api.post('/org/members', MEMBERS.luca)
    const { user, dialog, send, onClose, app } = setup()
    await user.click(send)

    expect(dialog.getByText('Enter a name.')).toBeInTheDocument()
    expect(dialog.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(dialog.getByLabelText('Name')).toHaveClass('invalid')
    expect(dialog.getByLabelText('Email')).toHaveClass('invalid')
    expect(api.calls).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    expect(app.refresh).not.toHaveBeenCalled()
  })

  it('a name of spaces only is not a name', async () => {
    api.post('/org/members', MEMBERS.luca)
    const { user, dialog, send } = setup()
    await user.type(dialog.getByLabelText('Name'), '   ')
    await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
    await user.click(send)
    expect(dialog.getByText('Enter a name.')).toBeInTheDocument()
    expect(dialog.queryByText('Enter a valid email address.')).not.toBeInTheDocument()
    expect(dialog.getByLabelText('Email')).not.toHaveClass('invalid')
    expect(api.calls).toHaveLength(0)
  })

  it.each(['nina', 'nina@', 'nina@meridianlabs', '@meridianlabs.org', 'nina russo@meridianlabs.org', 'nina@@meridianlabs.org'])('refuses %j as an email', async (email) => {
    api.post('/org/members', MEMBERS.luca)
    const { user, dialog, send } = setup()
    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.type(dialog.getByLabelText('Email'), email)
    await user.click(send)
    expect(dialog.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(dialog.queryByText('Enter a name.')).not.toBeInTheDocument()
    expect(dialog.getByLabelText('Name')).not.toHaveClass('invalid')
    expect(api.calls).toHaveLength(0)
  })

  it('clears the errors once the fields are right and sends the invite', async () => {
    api.post('/org/members', NINA)
    const { user, dialog, send, onClose } = setup()
    await user.click(send)
    expect(dialog.getByText('Enter a name.')).toBeInTheDocument()

    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
    await user.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(dialog.queryByText('Enter a name.')).not.toBeInTheDocument()
    expect(dialog.queryByText('Enter a valid email address.')).not.toBeInTheDocument()
    expect(dialog.getByLabelText('Name')).not.toHaveClass('invalid')
    expect(api.callsTo('POST', '/org/members')).toHaveLength(1)
  })

  it('invites with the trimmed name and email and the chosen role, says so, refreshes and closes', async () => {
    api.post('/org/members', NINA)
    const { user, dialog, send, onClose, app } = setup()
    await user.type(dialog.getByLabelText('Name'), '  Nina Russo ')
    await user.type(dialog.getByLabelText('Email'), ' nina@meridianlabs.org  ')
    await user.selectOptions(dialog.getByLabelText('Organisation role'), 'editor')
    await user.click(send)

    expect(await toastText('Invite sent to Nina Russo')).toBeInTheDocument()
    expect(api.last('POST', '/org/members')!.body).toEqual({ name: 'Nina Russo', email: 'nina@meridianlabs.org', org_role: 'editor' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(app.refresh).toHaveBeenCalledTimes(1)
    expect(api.unhandled).toEqual([])
  })

  it('invites as a viewer unless another role is picked', async () => {
    api.post('/org/members', NINA)
    const { user, dialog, send, onClose } = setup()
    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
    await user.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.last('POST', '/org/members')!.body).toEqual({ name: 'Nina Russo', email: 'nina@meridianlabs.org', org_role: 'viewer' })
  })

  it('cannot be sent twice while the invite is on its way', async () => {
    const gate = deferred()
    api.post('/org/members', () => gate.promise)
    const { user, dialog, send, onClose } = setup()
    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
    await user.click(send)

    expect(send).toBeDisabled()
    await user.click(send)
    expect(api.callsTo('POST', '/org/members')).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()

    gate.resolve(NINA)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('says why when the backend refuses and stays open with what was typed, ready to send again', async () => {
    api.post('/org/members', fail(409, 'A member with this email already exists'))
    const { user, dialog, send, onClose, app } = setup()
    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.type(dialog.getByLabelText('Email'), 'nina@meridianlabs.org')
    await user.click(send)

    expect(await toastText('A member with this email already exists')).toBeInTheDocument()
    await waitFor(() => expect(send).toBeEnabled())
    expect(onClose).not.toHaveBeenCalled()
    expect(app.refresh).not.toHaveBeenCalled()
    expect(dialog.getByLabelText('Name')).toHaveValue('Nina Russo')
    expect(dialog.getByLabelText('Email')).toHaveValue('nina@meridianlabs.org')
    expect(screen.queryByText(/Invite sent to/)).not.toBeInTheDocument()

    api.post('/org/members', NINA)
    await user.click(send)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['Cancel', (d: ReturnType<typeof within>) => d.getByRole('button', { name: 'Cancel' })],
    ['the close button', (d: ReturnType<typeof within>) => d.getByRole('button', { name: 'Close' })],
  ])('%s closes it without inviting anyone', async (_what, pick) => {
    const { user, dialog, onClose } = setup()
    await user.type(dialog.getByLabelText('Name'), 'Nina Russo')
    await user.click(pick(dialog))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.calls).toHaveLength(0)
  })

  it('Escape closes it without inviting anyone', async () => {
    const { user, onClose } = setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(api.calls).toHaveLength(0)
  })

  it('names the organisation it is given', () => {
    const { dialog } = setup({ org: org({ name: 'Studio Nord' }) })
    expect(dialog.getByText(/^They join Studio Nord with the role you pick/)).toBeInTheDocument()
  })
})

describe('RolesTab', () => {
  const head = () => screen.getAllByRole('columnheader').map((h) => h.textContent)
  const cellsOf = (label: string) => within(screen.getByText(label).closest('tr')!).getAllByRole('cell')
  /** "yes" or "no" for each role column of a permission row. */
  const grants = (label: string) =>
    cellsOf(label)
      .slice(1)
      .map((c) => (within(c).queryByLabelText('Allowed') ? 'yes' : within(c).queryByLabelText('Not allowed') ? 'no' : '?'))

  it('shows a placeholder while the roles load', async () => {
    const gate = deferred()
    api.get('/roles', () => gate.promise)
    const { container } = renderI18n(<RolesTab />)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    gate.resolve(ROLES)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('has one column per role, from viewer to owner, whatever order the backend uses', async () => {
    api.get('/roles', ROLES)
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    expect(head()).toEqual(['Permission', 'viewer', 'editor', 'admin', 'owner'])
    expect(api.unhandled).toEqual([])
  })

  it('says what each role is for', async () => {
    api.get('/roles', ROLES)
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    expect(cellsOf('What the role is for').map((c) => c.textContent)).toEqual([
      'What the role is for',
      'Asks and browses memory.',
      'Corrects, retires and resolves facts.',
      'Manages sources, mail and members.',
      'Everything, including demo controls.',
    ])
  })

  it('lists every permission once, with its name and code, from the most common to the most restricted', async () => {
    api.get('/roles', ROLES)
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    const rows = screen.getAllByRole('row').slice(2)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'Ask questionsask',
      'Browse memoryread_facts',
      'Retire factsretire_fact',
      'Restore factsrestore_fact',
      'Correct and pin factscorrect_fact',
      'Resolve conflicts and questionsresolve_conflict',
      'Manage sourcesmanage_sources',
      'Manage mail and routingmanage_mail',
      'Manage membersmanage_members',
      'Demo controlsadmin_demo',
    ])
  })

  it('marks which role is allowed what', async () => {
    api.get('/roles', ROLES)
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    expect(grants('Ask questions')).toEqual(['yes', 'yes', 'yes', 'yes'])
    expect(grants('Retire facts')).toEqual(['no', 'yes', 'yes', 'yes'])
    expect(grants('Manage members')).toEqual(['no', 'no', 'yes', 'yes'])
    expect(grants('Demo controls')).toEqual(['no', 'no', 'no', 'yes'])
    expect(screen.getByText('Roles are fixed. Read only.')).toBeInTheDocument()
  })

  it('leaves out the column of a role the backend does not describe', async () => {
    api.get('/roles', [
      { role: 'admin', permissions: PERMISSIONS.admin },
      { role: 'viewer', permissions: PERMISSIONS.viewer },
    ])
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    expect(head()).toEqual(['Permission', 'viewer', 'admin'])
    expect(grants('Manage sources')).toEqual(['no', 'yes'])
    expect(screen.queryByText('Demo controls')).not.toBeInTheDocument()
  })

  it('shows only the heading when there are no roles', async () => {
    api.get('/roles', [])
    renderI18n(<RolesTab />)
    await screen.findByRole('table')
    expect(head()).toEqual(['Permission'])
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('shows the error when the roles cannot be loaded', async () => {
    api.get('/roles', fail(500, 'database is locked'))
    renderI18n(<RolesTab />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
