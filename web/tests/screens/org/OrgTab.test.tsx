import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppContext } from '../../../src/lib/appContext'
import { HooksRow, OrgCard, OrgMailCard } from '../../../src/screens/org/OrgTab'
import { api, deferred, fail } from '../../helpers/api'
import { me, MEMBERS, org, project, PROJECTS } from '../../helpers/fixtures'
import { hookConfig, mailConfig, mockOrgTab, tagRule } from '../../helpers/org'
import { makeApp, renderI18n, renderWithApp } from '../../helpers/render'

const toastText = (text: string) => screen.findByText(text, { selector: '.toast *' })
/** The input under a label that is not tied to it. */
const field = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!
const hasField = (label: string) => screen.queryByText(label, { selector: 'label' }) !== null

describe('OrgCard', () => {
  it('shows the name and the id of the organisation', () => {
    renderWithApp(<OrgCard />)
    expect(screen.getByRole('heading', { name: 'Organisation' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Meridian Labs')
    expect(screen.getByText('org-meridian')).toBeInTheDocument()
    expect(api.calls).toHaveLength(0)
  })

  it('has an empty name while the organisation is not known', () => {
    renderWithApp(<OrgCard />, { org: null })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('saves the trimmed name, says so and refreshes', async () => {
    api.patch('/org', (req) => org({ name: (req.body as { name: string }).name }))
    const { user, app } = renderWithApp(<OrgCard />)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '  Meridian Group ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await toastText('Organisation saved')).toBeInTheDocument()
    expect(api.last('PATCH', '/org')!.body).toEqual({ name: 'Meridian Group' })
    await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    expect(api.unhandled).toEqual([])
  })

  it('refuses an empty name without calling the backend, then saves once it is filled in', async () => {
    api.patch('/org', org())
    const { user, app } = renderWithApp(<OrgCard />)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '   ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByText('Enter the organisation name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveClass('invalid')
    expect(api.calls).toHaveLength(0)
    expect(app.refresh).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Name'), 'Studio Nord')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await toastText('Organisation saved')).toBeInTheDocument()
    expect(screen.queryByText('Enter the organisation name.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).not.toHaveClass('invalid')
    expect(api.last('PATCH', '/org')!.body).toEqual({ name: 'Studio Nord' })
    await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
  })

  it('says why when the backend refuses and keeps what was typed', async () => {
    api.patch('/org', fail(422, 'Name is too long'))
    const { user, app } = renderWithApp(<OrgCard />)
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Meridian Group')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await toastText('Name is too long')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Meridian Group')
    expect(app.refresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Organisation saved')).not.toBeInTheDocument()
  })

  it('an admin can save', async () => {
    api.patch('/org', org())
    const { user } = renderWithApp(<OrgCard />, { me: me({ as: MEMBERS.marco }) })
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).not.toHaveAttribute('aria-disabled')
    await user.click(save)
    expect(await toastText('Organisation saved')).toBeInTheDocument()
  })

  it('an editor sees Save greyed out and a click sends nothing', async () => {
    api.patch('/org', org())
    const { user } = renderWithApp(<OrgCard />, { me: me({ as: MEMBERS.sara }) })
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAttribute('data-tip', 'Requires admin')

    await user.clear(screen.getByLabelText('Name'))
    await user.click(save)
    expect(api.calls).toHaveLength(0)
    expect(screen.queryByText('Enter the organisation name.')).not.toBeInTheDocument()
  })
})

describe('OrgMailCard', () => {
  const mode = (name: RegExp) => screen.getByRole('button', { name })
  const save = () => screen.getByRole('button', { name: 'Save mail settings' })

  it('shows a placeholder under the title while the mail settings load', async () => {
    mockOrgTab()
    const gate = deferred()
    api.get('/org/mail', () => gate.promise)
    const { container } = renderWithApp(<OrgMailCard />)
    expect(screen.getByRole('heading', { name: 'Mail' })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save mail settings' })).not.toBeInTheDocument()

    gate.resolve(mailConfig())
    expect(await screen.findByRole('button', { name: 'Save mail settings' })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('shows the error when the mail settings cannot be loaded', async () => {
    mockOrgTab()
    api.get('/org/mail', fail(500, 'database is locked'))
    renderWithApp(<OrgMailCard />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mail' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save mail settings' })).not.toBeInTheDocument()
  })

  it('shows an IMAP mailbox with its host, user and inbound address', async () => {
    mockOrgTab()
    renderWithApp(<OrgMailCard />)
    await screen.findByRole('button', { name: 'Save mail settings' })

    expect(screen.getByText('organisation default')).toHaveClass('badge')
    expect(mode(/IMAP mailbox/)).toHaveClass('on')
    expect(mode(/Inbound webhook/)).not.toHaveClass('on')
    expect(mode(/IMAP mailbox/)).toHaveTextContent('Mocked, polled')
    expect(mode(/Inbound webhook/)).toHaveTextContent('Pushed by the mail provider')
    expect(field('IMAP host')).toHaveValue('imap.meridianlabs.org')
    expect(field('IMAP user')).toHaveValue('canonico@meridianlabs.org')
    expect(field('Inbound address')).toHaveValue('brain@meridianlabs.org')
    await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/mail')).toHaveLength(2))
    expect(api.unhandled).toEqual([])
  })

  it('shows a webhook without the IMAP fields', async () => {
    mockOrgTab({ mail: mailConfig({ mode: 'webhook', imap_host: null, imap_user: null }) })
    renderWithApp(<OrgMailCard />)
    await screen.findByRole('button', { name: 'Save mail settings' })
    expect(mode(/Inbound webhook/)).toHaveClass('on')
    expect(mode(/IMAP mailbox/)).not.toHaveClass('on')
    expect(hasField('IMAP host')).toBe(false)
    expect(hasField('IMAP user')).toBe(false)
    expect(field('Inbound address')).toHaveValue('brain@meridianlabs.org')
  })

  it('shows empty fields for values that are not set', async () => {
    mockOrgTab({ mail: { mode: 'imap_mock', poll_interval_s: 60 } })
    renderWithApp(<OrgMailCard />)
    await screen.findByRole('button', { name: 'Save mail settings' })
    expect(field('IMAP host')).toHaveValue('')
    expect(field('IMAP user')).toHaveValue('')
    expect(field('Inbound address')).toHaveValue('')
  })

  it('switching the mode shows and hides the IMAP fields', async () => {
    mockOrgTab()
    const { user } = renderWithApp(<OrgMailCard />)
    await screen.findByRole('button', { name: 'Save mail settings' })

    await user.click(mode(/Inbound webhook/))
    expect(mode(/Inbound webhook/)).toHaveClass('on')
    expect(mode(/IMAP mailbox/)).not.toHaveClass('on')
    expect(hasField('IMAP host')).toBe(false)

    await user.click(mode(/IMAP mailbox/))
    expect(mode(/IMAP mailbox/)).toHaveClass('on')
    expect(field('IMAP host')).toHaveValue('imap.meridianlabs.org')
    expect(api.callsTo('PUT', '/org/mail')).toHaveLength(0)
  })

  describe('how many projects inherit it', () => {
    it('counts every project when none has its own mail settings', async () => {
      mockOrgTab()
      renderWithApp(<OrgMailCard />)
      expect(await screen.findByText('Inherited by 2 of 2 projects.')).toBeInTheDocument()
    })

    it('leaves out the projects with their own mail settings', async () => {
      mockOrgTab({ overridden: ['proj-internal'] })
      renderWithApp(<OrgMailCard />)
      expect(await screen.findByText('Inherited by 1 of 2 projects.')).toBeInTheDocument()
      expect(api.callsTo('GET', '/projects/:project_id/mail').map((c) => c.params.project_id).sort()).toEqual(['proj-clearpath', 'proj-internal'])
    })

    it('is zero of zero without projects, and asks for no project', async () => {
      mockOrgTab()
      renderWithApp(<OrgMailCard />, { projects: [] })
      expect(await screen.findByText('Inherited by 0 of 0 projects.')).toBeInTheDocument()
      expect(api.callsTo('GET', '/projects/:project_id/mail')).toHaveLength(0)
    })

    it('counts again when a project is added', async () => {
      mockOrgTab({ overridden: ['proj-internal'] })
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp()}>
          <OrgMailCard />
        </AppContext.Provider>,
      )
      expect(await screen.findByText('Inherited by 1 of 2 projects.')).toBeInTheDocument()

      rerender(
        <AppContext.Provider value={makeApp({ projects: [...PROJECTS, project({ id: 'proj-new', name: 'New' })] })}>
          <OrgMailCard />
        </AppContext.Provider>,
      )
      expect(await screen.findByText('Inherited by 2 of 3 projects.')).toBeInTheDocument()
    })
  })

  describe('saving', () => {
    it('sends the settings as shown when nothing was edited', async () => {
      mockOrgTab()
      api.put('/org/mail', mailConfig())
      const { user, app } = renderWithApp(<OrgMailCard />)
      await user.click(await screen.findByRole('button', { name: 'Save mail settings' }))

      expect(await toastText('Mail settings saved')).toBeInTheDocument()
      expect(api.last('PUT', '/org/mail')!.body).toEqual({
        mode: 'imap_mock',
        imap_host: 'imap.meridianlabs.org',
        imap_user: 'canonico@meridianlabs.org',
        inbound_address: 'brain@meridianlabs.org',
        poll_interval_s: 60,
      })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.unhandled).toEqual([])
    })

    it('sends the edited host, user and inbound address', async () => {
      mockOrgTab()
      api.put('/org/mail', mailConfig())
      const { user, app } = renderWithApp(<OrgMailCard />)
      await screen.findByRole('button', { name: 'Save mail settings' })
      await user.clear(field('IMAP host'))
      await user.type(field('IMAP host'), 'mail.studio.it')
      await user.clear(field('IMAP user'))
      await user.type(field('IMAP user'), 'inbox@studio.it')
      await user.clear(field('Inbound address'))
      await user.type(field('Inbound address'), 'memory@studio.it')
      expect(field('IMAP host')).toHaveValue('mail.studio.it')
      await user.click(save())

      expect(await toastText('Mail settings saved')).toBeInTheDocument()
      expect(api.last('PUT', '/org/mail')!.body).toEqual({ mode: 'imap_mock', imap_host: 'mail.studio.it', imap_user: 'inbox@studio.it', inbound_address: 'memory@studio.it', poll_interval_s: 60 })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
    })

    it('sends the chosen mode and keeps the polling interval', async () => {
      mockOrgTab({ mail: mailConfig({ poll_interval_s: 300 }) })
      api.put('/org/mail', mailConfig())
      const { user } = renderWithApp(<OrgMailCard />)
      await screen.findByRole('button', { name: 'Save mail settings' })
      await user.click(mode(/Inbound webhook/))
      await user.click(save())

      expect(await toastText('Mail settings saved')).toBeInTheDocument()
      expect(api.last('PUT', '/org/mail')!.body).toMatchObject({ mode: 'webhook', inbound_address: 'brain@meridianlabs.org', poll_interval_s: 300 })
    })

    it('sends null for the values that are not set', async () => {
      mockOrgTab({ mail: { mode: 'webhook', poll_interval_s: 60 } })
      api.put('/org/mail', mailConfig())
      const { user } = renderWithApp(<OrgMailCard />)
      await user.click(await screen.findByRole('button', { name: 'Save mail settings' }))
      expect(await toastText('Mail settings saved')).toBeInTheDocument()
      expect(api.last('PUT', '/org/mail')!.body).toEqual({ mode: 'webhook', imap_host: null, imap_user: null, inbound_address: null, poll_interval_s: 60 })
    })

    it('says why when the backend refuses, keeps the edits and does not refresh', async () => {
      mockOrgTab()
      api.put('/org/mail', fail(422, 'Inbound address is not valid'))
      const { user, app } = renderWithApp(<OrgMailCard />)
      await screen.findByRole('button', { name: 'Save mail settings' })
      await user.clear(field('Inbound address'))
      await user.type(field('Inbound address'), 'nope')
      await user.click(save())

      expect(await toastText('Inbound address is not valid')).toBeInTheDocument()
      expect(field('Inbound address')).toHaveValue('nope')
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.queryByText('Mail settings saved')).not.toBeInTheDocument()
    })

    it('an editor sees Save greyed out and a click sends nothing', async () => {
      mockOrgTab()
      api.put('/org/mail', mailConfig())
      const { user } = renderWithApp(<OrgMailCard />, { me: me({ as: MEMBERS.sara }) })
      const button = await screen.findByRole('button', { name: 'Save mail settings' })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(button)
      expect(api.callsTo('PUT', '/org/mail')).toHaveLength(0)
      expect(screen.queryByText('Mail settings saved')).not.toBeInTheDocument()
    })

    it('an admin can save', async () => {
      mockOrgTab()
      api.put('/org/mail', mailConfig())
      const { user } = renderWithApp(<OrgMailCard />, { me: me({ as: MEMBERS.marco }) })
      const button = await screen.findByRole('button', { name: 'Save mail settings' })
      expect(button).not.toHaveAttribute('aria-disabled')
      await user.click(button)
      expect(await toastText('Mail settings saved')).toBeInTheDocument()
    })
  })

  it('loads the settings again when the data changed, keeping the card on screen', async () => {
    mockOrgTab()
    const { rerender } = renderI18n(
      <AppContext.Provider value={makeApp({ version: 1 })}>
        <OrgMailCard />
      </AppContext.Provider>,
    )
    await screen.findByRole('button', { name: 'Save mail settings' })

    api.get('/org/mail', mailConfig({ inbound_address: 'new@meridianlabs.org' }))
    rerender(
      <AppContext.Provider value={makeApp({ version: 2 })}>
        <OrgMailCard />
      </AppContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Save mail settings' })).toBeInTheDocument()
    await waitFor(() => expect(field('Inbound address')).toHaveValue('new@meridianlabs.org'))
    expect(api.callsTo('GET', '/org/mail')).toHaveLength(2)
  })
})

describe('HooksRow', () => {
  const RULES = [
    tagRule({ id: 'TR-2', tag: 'topic:pricing', project_id: 'proj-internal', priority: 20 }),
    tagRule({ id: 'TR-1', tag: 'clearpath', project_id: 'proj-clearpath', priority: 10 }),
    tagRule({ id: 'TR-3', tag: 'legacy', project_id: 'proj-gone', priority: 30 }),
  ]
  const ruleRow = (tag: string) => screen.getByText(tag, { selector: '.tag' }).closest('tr')!
  const testInput = () => screen.getByLabelText('Test tags')
  const testButton = () => screen.getByRole('button', { name: 'Test tags' })

  describe('organisation webhook', () => {
    it('shows a placeholder while the webhook loads', async () => {
      mockOrgTab()
      const gate = deferred()
      api.get('/org/hooks', () => gate.promise)
      renderWithApp(<HooksRow />)
      await screen.findByText(/No tag rules/)
      const card = screen.getByRole('heading', { name: 'Organisation webhook' }).closest('.card')!
      expect(card.querySelector('[aria-busy="true"]')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Rotate secret' })).not.toBeInTheDocument()

      gate.resolve(hookConfig())
      expect(await screen.findByRole('button', { name: 'Rotate secret' })).toBeInTheDocument()
      expect(card.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    })

    it('shows the error when the webhook cannot be loaded, and still lists the rules', async () => {
      mockOrgTab({ rules: RULES })
      api.get('/org/hooks', fail(500, 'database is locked'))
      renderWithApp(<HooksRow />)
      expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Rotate secret' })).not.toBeInTheDocument()
      expect(await screen.findByText('clearpath', { selector: '.tag' })).toBeInTheDocument()
    })

    it('shows the URL, the secret masked down to its last four characters and when it was created', async () => {
      mockOrgTab({ hook: hookConfig({ url: 'http://api.test/hooks/org/org-meridian', secret_last4: 'x9z1', created_at: '2026-11-03T09:00:00Z' }) })
      renderWithApp(<HooksRow />)
      await screen.findByRole('button', { name: 'Rotate secret' })

      expect(screen.getByText('routes by tag')).toHaveClass('badge')
      expect(screen.getByDisplayValue('http://api.test/hooks/org/org-meridian')).toHaveAttribute('readonly')
      const secret = screen.getByLabelText('Secret, last 4 characters')
      expect(secret).toHaveValue('whsec_••••••••x9z1')
      expect(secret).toHaveAttribute('readonly')
      expect(screen.getByText(/Sent as the X-Canonico-Token header\. Rotating stops the old secret at once\. 3 Nov 2026/)).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('rotating shows the new secret once, says so and refreshes; Done hides it again', async () => {
      mockOrgTab()
      api.post('/org/hooks/rotate-secret', { secret: 'whsec_new_secret_value_77aa', secret_last4: '77aa' })
      const { user, app } = renderWithApp(<HooksRow />)
      await user.click(await screen.findByRole('button', { name: 'Rotate secret' }))

      expect(await toastText('Secret rotated. Copy the new one now.')).toBeInTheDocument()
      expect(screen.getByDisplayValue('whsec_new_secret_value_77aa')).toHaveAttribute('readonly')
      expect(screen.getByText(/^Copy it now\. It is shown once, then only/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Rotate secret' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Secret, last 4 characters')).not.toBeInTheDocument()
      expect(api.last('POST', '/org/hooks/rotate-secret')!.body).toBeUndefined()
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))

      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.queryByDisplayValue('whsec_new_secret_value_77aa')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Secret, last 4 characters')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rotate secret' })).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('says why when rotating fails and keeps the old secret masked', async () => {
      mockOrgTab()
      api.post('/org/hooks/rotate-secret', fail(403, 'Requires admin'))
      const { user, app } = renderWithApp(<HooksRow />)
      await user.click(await screen.findByRole('button', { name: 'Rotate secret' }))

      expect(await toastText('Requires admin')).toBeInTheDocument()
      expect(screen.getByLabelText('Secret, last 4 characters')).toHaveValue('whsec_••••••••a1b2')
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('an editor sees Rotate greyed out and a click rotates nothing', async () => {
      mockOrgTab()
      api.post('/org/hooks/rotate-secret', { secret: 'whsec_new', secret_last4: '_new' })
      const { user } = renderWithApp(<HooksRow />, { me: me({ as: MEMBERS.sara }) })
      const rotate = await screen.findByRole('button', { name: 'Rotate secret' })
      expect(rotate).toHaveAttribute('aria-disabled', 'true')
      expect(rotate).toHaveAttribute('data-tip', 'Requires admin')

      await user.click(rotate)
      expect(api.callsTo('POST', '/org/hooks/rotate-secret')).toHaveLength(0)
      expect(screen.getByLabelText('Secret, last 4 characters')).toBeInTheDocument()
    })
  })

  describe('tag rules', () => {
    it('shows a placeholder while the rules load', async () => {
      mockOrgTab()
      const gate = deferred()
      api.get('/org/tag-rules', () => gate.promise)
      renderWithApp(<HooksRow />)
      await screen.findByRole('button', { name: 'Rotate secret' })
      const card = screen.getByRole('heading', { name: 'Tag rules' }).closest('.card')!
      expect(card.querySelector('[aria-busy="true"]')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText(/No tag rules/)).not.toBeInTheDocument()

      gate.resolve({ items: RULES })
      expect(await screen.findByRole('table')).toBeInTheDocument()
      expect(card.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
    })

    it('lists the rules lowest priority first, with the project each one routes to', async () => {
      mockOrgTab({ rules: RULES })
      renderWithApp(<HooksRow />)
      await screen.findByText('clearpath', { selector: '.tag' })

      expect(screen.getByText('first match wins · lowest priority first')).toBeInTheDocument()
      const rows = screen.getAllByRole('row').slice(1)
      expect(rows.map((r) => within(r).getAllByRole('cell').slice(0, 3).map((c) => c.textContent))).toEqual([
        ['clearpath', 'ClearPath engagement', '10'],
        ['topic:pricing', 'Internal', '20'],
        ['legacy', 'proj-gone', '30'],
      ])
      expect(screen.queryByText(/No tag rules/)).not.toBeInTheDocument()
    })

    it('marks the tags that force a topic', async () => {
      mockOrgTab({ rules: RULES })
      renderWithApp(<HooksRow />)
      await screen.findByText('clearpath', { selector: '.tag' })
      expect(screen.getByText('topic:pricing', { selector: '.tag' })).toHaveClass('topic')
      expect(screen.getByText('clearpath', { selector: '.tag' })).not.toHaveClass('topic')
    })

    it('says when there are no rules', async () => {
      mockOrgTab({ rules: [] })
      renderWithApp(<HooksRow />)
      expect(await screen.findByText('No tag rules. Items posted to the organisation webhook stay in the inbox.')).toBeInTheDocument()
      expect(screen.getAllByRole('row')).toHaveLength(2)
    })

    it('deletes a rule, says so and refreshes', async () => {
      mockOrgTab({ rules: RULES })
      api.delete('/org/tag-rules/:rule_id', () => undefined)
      const { user, app } = renderWithApp(<HooksRow />)
      await screen.findByText('clearpath', { selector: '.tag' })
      await user.click(screen.getByRole('button', { name: 'Delete rule topic:pricing' }))

      expect(await toastText('Tag rule deleted')).toBeInTheDocument()
      expect(api.callsTo('DELETE', '/org/tag-rules/:rule_id').map((c) => c.params.rule_id)).toEqual(['TR-2'])
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.unhandled).toEqual([])
    })

    it('says why when a rule cannot be deleted and leaves it listed', async () => {
      mockOrgTab({ rules: RULES })
      api.delete('/org/tag-rules/:rule_id', fail(404, 'Rule not found'))
      const { user, app } = renderWithApp(<HooksRow />)
      await screen.findByText('clearpath', { selector: '.tag' })
      await user.click(screen.getByRole('button', { name: 'Delete rule clearpath' }))

      expect(await toastText('Rule not found')).toBeInTheDocument()
      expect(ruleRow('clearpath')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('an editor sees Add and Delete greyed out, and clicks do nothing', async () => {
      mockOrgTab({ rules: RULES })
      api.delete('/org/tag-rules/:rule_id', () => undefined)
      const { user } = renderWithApp(<HooksRow />, { me: me({ as: MEMBERS.sara }) })
      await screen.findByText('clearpath', { selector: '.tag' })
      const del = screen.getByRole('button', { name: 'Delete rule clearpath' })
      const add = screen.getByRole('button', { name: 'Add rule' })
      for (const b of [del, add]) {
        expect(b).toHaveAttribute('aria-disabled', 'true')
        expect(b).toHaveAttribute('data-tip', 'Requires admin')
      }

      await user.click(del)
      await user.click(add)
      expect(api.callsTo('DELETE', '/org/tag-rules/:rule_id')).toHaveLength(0)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('loads the webhook and the rules again when the data changed', async () => {
      mockOrgTab({ rules: [RULES[1]] })
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp({ version: 1 })}>
          <HooksRow />
        </AppContext.Provider>,
      )
      await screen.findByText('clearpath', { selector: '.tag' })
      await screen.findByRole('button', { name: 'Rotate secret' })

      mockOrgTab({ rules: RULES, hook: hookConfig({ secret_last4: '77aa' }) })
      rerender(
        <AppContext.Provider value={makeApp({ version: 2 })}>
          <HooksRow />
        </AppContext.Provider>,
      )
      expect(await screen.findByText('legacy', { selector: '.tag' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByLabelText('Secret, last 4 characters')).toHaveValue('whsec_••••••••77aa'))
      expect(api.callsTo('GET', '/org/hooks')).toHaveLength(2)
      expect(api.callsTo('GET', '/org/tag-rules')).toHaveLength(2)
    })
  })

  describe('adding a tag rule', () => {
    const open = async (over: Parameters<typeof renderWithApp>[1] = {}) => {
      mockOrgTab({ rules: [RULES[1]] })
      const view = renderWithApp(<HooksRow />, over)
      await screen.findByText('clearpath', { selector: '.tag' })
      await view.user.click(screen.getByRole('button', { name: 'Add rule' }))
      const dialog = within(screen.getByRole('dialog'))
      return { ...view, dialog, add: dialog.getByRole('button', { name: 'Add rule' }) }
    }

    it('opens on the current project with priority 10 and the tag field focused', async () => {
      const { dialog } = await open({ projectId: 'proj-internal' })
      expect(dialog.getByRole('heading', { name: 'Add tag rule' })).toBeInTheDocument()
      expect(dialog.getByText('Items with this tag are routed to the project. First match wins, lowest priority first.')).toBeInTheDocument()
      expect(dialog.getByLabelText('Tag')).toHaveFocus()
      expect(dialog.getByLabelText('Tag')).toHaveAttribute('placeholder', 'client-name')
      expect(dialog.getByLabelText('Project')).toHaveValue('proj-internal')
      expect(within(dialog.getByLabelText('Project')).getAllByRole('option').map((o) => o.textContent)).toEqual(['ClearPath engagement', 'Internal'])
      expect(dialog.getByLabelText('Priority')).toHaveValue('10')
    })

    it('adds the rule with the trimmed tag, the chosen project and the priority as a number, then closes', async () => {
      api.post('/org/tag-rules', tagRule({ id: 'TR-9', tag: 'pricing' }))
      const { user, app, dialog, add } = await open()
      await user.type(dialog.getByLabelText('Tag'), '  pricing ')
      await user.selectOptions(dialog.getByLabelText('Project'), 'Internal')
      await user.clear(dialog.getByLabelText('Priority'))
      await user.type(dialog.getByLabelText('Priority'), '25')
      await user.click(add)

      expect(await toastText('Tag rule added')).toBeInTheDocument()
      expect(api.last('POST', '/org/tag-rules')!.body).toEqual({ tag: 'pricing', project_id: 'proj-internal', priority: 25 })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])
    })

    it('uses the current project and priority 10 when only the tag is typed', async () => {
      api.post('/org/tag-rules', tagRule())
      const { user, dialog, add } = await open()
      await user.type(dialog.getByLabelText('Tag'), 'pricing')
      await user.click(add)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(api.last('POST', '/org/tag-rules')!.body).toEqual({ tag: 'pricing', project_id: 'proj-clearpath', priority: 10 })
    })

    it('asks for a tag before sending anything', async () => {
      api.post('/org/tag-rules', tagRule())
      const { user, app, dialog, add } = await open()
      await user.type(dialog.getByLabelText('Tag'), '   ')
      await user.click(add)

      expect(dialog.getByText('Enter a tag.')).toBeInTheDocument()
      expect(dialog.getByLabelText('Tag')).toHaveClass('invalid')
      expect(dialog.queryByText('Priority must be a whole number.')).not.toBeInTheDocument()
      expect(dialog.getByLabelText('Priority')).not.toHaveClass('invalid')
      expect(api.callsTo('POST', '/org/tag-rules')).toHaveLength(0)
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it.each(['', 'abc', '1.5', '-1', '1e3'])('refuses %j as a priority', async (priority) => {
      api.post('/org/tag-rules', tagRule())
      const { user, dialog, add } = await open()
      await user.type(dialog.getByLabelText('Tag'), 'pricing')
      await user.clear(dialog.getByLabelText('Priority'))
      if (priority) await user.type(dialog.getByLabelText('Priority'), priority)
      await user.click(add)

      expect(dialog.getByText('Priority must be a whole number.')).toBeInTheDocument()
      expect(dialog.getByLabelText('Priority')).toHaveClass('invalid')
      expect(dialog.queryByText('Enter a tag.')).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/org/tag-rules')).toHaveLength(0)
    })

    it('clears the errors once the fields are right', async () => {
      api.post('/org/tag-rules', tagRule())
      const { user, dialog, add } = await open()
      await user.clear(dialog.getByLabelText('Priority'))
      await user.click(add)
      expect(dialog.getByText('Enter a tag.')).toBeInTheDocument()
      expect(dialog.getByText('Priority must be a whole number.')).toBeInTheDocument()

      await user.type(dialog.getByLabelText('Tag'), 'pricing')
      await user.type(dialog.getByLabelText('Priority'), '0')
      await user.click(add)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(api.last('POST', '/org/tag-rules')!.body).toEqual({ tag: 'pricing', project_id: 'proj-clearpath', priority: 0 })
    })

    it('says why when the backend refuses and stays open with what was typed', async () => {
      api.post('/org/tag-rules', fail(409, 'A rule for this tag already exists'))
      const { user, app, dialog, add } = await open()
      await user.type(dialog.getByLabelText('Tag'), 'clearpath')
      await user.click(add)

      expect(await toastText('A rule for this tag already exists')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(dialog.getByLabelText('Tag')).toHaveValue('clearpath')
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.queryByText('Tag rule added')).not.toBeInTheDocument()
    })

    it.each([
      ['Cancel', 'Cancel'],
      ['the close button', 'Close'],
    ])('%s closes it without adding anything', async (_what, name) => {
      const { user, dialog } = await open()
      await user.type(dialog.getByLabelText('Tag'), 'pricing')
      await user.click(dialog.getByRole('button', { name }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/org/tag-rules')).toHaveLength(0)
    })

    it('Escape closes it, and it opens empty the next time', async () => {
      const { user, dialog } = await open()
      await user.type(dialog.getByLabelText('Tag'), 'pricing')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add rule' }))
      expect(within(screen.getByRole('dialog')).getByLabelText('Tag')).toHaveValue('')
      expect(api.callsTo('POST', '/org/tag-rules')).toHaveLength(0)
    })
  })

  describe('testing tags', () => {
    const ready = async (over: Parameters<typeof renderWithApp>[1] = {}) => {
      mockOrgTab({ rules: RULES })
      const view = renderWithApp(<HooksRow />, over)
      await screen.findByText('clearpath', { selector: '.tag' })
      return view
    }
    const result = () => screen.getByText(/^(Matches|No rule matches)/).closest('div.fade-in') as HTMLElement

    it('starts with two sample tags and a hint, without calling the backend', async () => {
      await ready()
      expect(testInput()).toHaveValue('clearpath, topic:onboarding-target')
      expect(testInput()).toHaveAttribute('placeholder', 'tag, tag')
      expect(screen.getByText('Checks the rules in order without creating anything. topic: tags force the topic.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/org/tag-rules/test')).toHaveLength(0)
    })

    it('says which rule matches and where the item goes, and shows the topic tags', async () => {
      api.post('/org/tag-rules/test', { rule_id: 'TR-1', project_id: 'proj-clearpath' })
      const { user, app } = await ready()
      await user.click(testButton())

      expect(await screen.findByText('Matches TR-1 and goes to ClearPath engagement.')).toBeInTheDocument()
      expect(api.last('POST', '/org/tag-rules/test')!.body).toEqual({ tags: ['clearpath', 'topic:onboarding-target'] })
      expect(result()).not.toHaveClass('bg-warning-soft')
      expect(within(result()).getByText('topic:onboarding-target')).toHaveClass('tag', 'topic')
      expect(within(result()).queryByText('clearpath')).not.toBeInTheDocument()
      expect(screen.queryByText(/Checks the rules in order/)).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(api.unhandled).toEqual([])
    })

    it('splits the tags on commas and spaces and tests on Enter', async () => {
      api.post('/org/tag-rules/test', { rule_id: 'TR-2', project_id: 'proj-internal' })
      const { user } = await ready()
      await user.clear(testInput())
      await user.type(testInput(), ' pricing,, legacy   topic:a,topic:b ,{Enter}')

      expect(await screen.findByText('Matches TR-2 and goes to Internal.')).toBeInTheDocument()
      expect(api.last('POST', '/org/tag-rules/test')!.body).toEqual({ tags: ['pricing', 'legacy', 'topic:a', 'topic:b'] })
      expect(within(result()).getAllByText(/^topic:/).map((x) => x.textContent)).toEqual(['topic:a', 'topic:b'])
    })

    it('shows the project id when the rule routes to a project that is not listed', async () => {
      api.post('/org/tag-rules/test', { rule_id: 'TR-3', project_id: 'proj-gone' })
      const { user } = await ready()
      await user.clear(testInput())
      await user.type(testInput(), 'legacy')
      await user.click(testButton())
      expect(await screen.findByText('Matches TR-3 and goes to proj-gone.')).toBeInTheDocument()
      expect(within(result()).queryByText(/^topic:/)).not.toBeInTheDocument()
    })

    it('warns when no rule matches, and still shows the topic tags', async () => {
      api.post('/org/tag-rules/test', { rule_id: null, project_id: null })
      const { user } = await ready()
      await user.click(testButton())

      expect(await screen.findByText(/No rule matches\. The item stays in the organisation inbox and creates no facts\./)).toBeInTheDocument()
      expect(result()).toHaveClass('bg-warning-soft', 'text-warning-text')
      expect(within(result()).getByText('topic:onboarding-target')).toHaveClass('tag', 'topic')
      expect(screen.queryByText(/^Matches/)).not.toBeInTheDocument()
    })

    it('asks for a tag when the field is empty, without calling the backend', async () => {
      api.post('/org/tag-rules/test', { rule_id: 'TR-1', project_id: 'proj-clearpath' })
      const { user } = await ready()
      await user.clear(testInput())
      await user.type(testInput(), ' , ,')
      await user.click(testButton())

      expect(screen.getByText('Enter at least one tag.')).toBeInTheDocument()
      expect(screen.queryByText(/Checks the rules in order/)).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/org/tag-rules/test')).toHaveLength(0)
    })

    it('replaces the previous result with the new one', async () => {
      api.post('/org/tag-rules/test', (req) => ((req.body as { tags: string[] }).tags.includes('clearpath') ? { rule_id: 'TR-1', project_id: 'proj-clearpath' } : { rule_id: null, project_id: null }))
      const { user } = await ready()
      await user.click(testButton())
      expect(await screen.findByText('Matches TR-1 and goes to ClearPath engagement.')).toBeInTheDocument()

      await user.clear(testInput())
      await user.type(testInput(), 'unknown')
      await user.click(testButton())
      expect(await screen.findByText(/No rule matches/)).toBeInTheDocument()
      expect(screen.queryByText(/^Matches/)).not.toBeInTheDocument()

      await user.clear(testInput())
      await user.click(testButton())
      expect(screen.getByText('Enter at least one tag.')).toBeInTheDocument()
      expect(screen.queryByText(/No rule matches/)).not.toBeInTheDocument()
    })

    it('says why when the test fails and keeps the hint', async () => {
      api.post('/org/tag-rules/test', fail(422, 'Too many tags'))
      const { user } = await ready()
      await user.click(testButton())
      expect(await toastText('Too many tags')).toBeInTheDocument()
      expect(screen.getByText(/Checks the rules in order/)).toBeInTheDocument()
      expect(screen.queryByText(/^Matches/)).not.toBeInTheDocument()
    })

    it('a viewer can test tags too', async () => {
      api.post('/org/tag-rules/test', { rule_id: 'TR-1', project_id: 'proj-clearpath' })
      const { user } = await ready({ me: me({ as: MEMBERS.luca }) })
      expect(testButton()).not.toHaveAttribute('aria-disabled')
      await user.click(testButton())
      expect(await screen.findByText('Matches TR-1 and goes to ClearPath engagement.')).toBeInTheDocument()
    })
  })
})

describe('the organisation tab as a whole', () => {
  it('asks only for what it shows', async () => {
    mockOrgTab({ rules: [tagRule()] })
    renderWithApp(
      <>
        <OrgCard />
        <OrgMailCard />
        <HooksRow />
      </>,
    )
    await screen.findByRole('button', { name: 'Save mail settings' })
    await screen.findByRole('button', { name: 'Rotate secret' })
    await screen.findByText('clearpath', { selector: '.tag' })
    await screen.findByText('Inherited by 2 of 2 projects.')
    await waitFor(() => expect(api.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(['GET /org/hooks', 'GET /org/mail', 'GET /org/tag-rules', 'GET /projects/proj-clearpath/mail', 'GET /projects/proj-internal/mail']))
    expect(api.unhandled).toEqual([])
  })
})
