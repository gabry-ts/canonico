import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import Setup from '../../src/screens/Setup'
import { api, deferred, fail, offline } from '../helpers/api'
import { org, project } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

type Job = Schemas['IngestJob']

const job = (over: Partial<Job> = {}): Job => ({ id: 'job-1', status: 'done', docs: 46, facts: 312, cost_usd: 0.42, kind: 'ingest', ...over })
const status = (completed: boolean): Schemas['SetupStatus'] => {
  const s = completed ? 'done' : 'pending'
  return { completed, steps: { org: s, mail: s, first_project: s, first_source: s } }
}

beforeEach(() => {
  api.get('/org/setup/status', status(false))
  api.post('/org/setup', org({ name: 'Acme' }))
  api.put('/org/mail', { mode: 'imap_mock', inbound_address: 'brain@inbound.acme.com' })
  api.post('/projects', project({ id: 'proj-pilot', name: 'Pilot' }))
  api.post('/org/mail/rules', { id: 'rule-1' })
  api.post('/ingest', job())
  api.get('/ingest/:job_id', job())
})

const field = (label: string) => screen.getByLabelText(label)
const cont = () => screen.getByRole('button', { name: 'Continue' })
const back = () => screen.getByRole('button', { name: 'Back' })
const title = (name: string) => screen.findByRole('heading', { level: 2, name })
const railSteps = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.step-dot')!)
const progress = (container: HTMLElement) => (container.querySelector('main .bg-primary') as HTMLElement).style.width
const polls = () => api.callsTo('GET', '/ingest/:job_id')

async function fillOrg(user: UserEvent, over: { name?: string; domain?: string; admin?: string; email?: string } = {}) {
  const v = { name: 'Acme', domain: 'acme.com', admin: 'Giulia Ferri', email: 'giulia@acme.com', ...over }
  if (v.name) await user.type(field('Organisation name'), v.name)
  if (v.domain) await user.type(field('Email domain'), v.domain)
  if (v.admin) await user.type(field('First admin'), v.admin)
  if (v.email) await user.type(field('Admin email'), v.email)
}
async function toMail(user: UserEvent) {
  await fillOrg(user)
  await user.click(cont())
  await title('Connect the organisation mailbox')
}
async function toProject(user: UserEvent) {
  await toMail(user)
  await user.click(cont())
  await title('Create the first project')
}
async function toSources(user: UserEvent) {
  await toProject(user)
  await user.type(field('Project name'), 'Pilot')
  await user.click(cont())
  await title('Connect the first sources')
}

/** Polling runs on a 900 ms timer: these move the clock instead of waiting. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
async function advanceUntil(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await tick(100)
  expect(done()).toBe(true)
}
/** Reaches step 4 and starts an ingest that the backend has not finished yet. */
async function startSlowIngest(user: UserEvent, first: Job = job({ status: 'running', docs: 0, facts: 0 })) {
  api.post('/ingest', first)
  await toSources(user)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByRole('button', { name: 'Start first ingest' }))
  await screen.findByText('Reading…')
}

describe('Setup', () => {
  describe('the wizard', () => {
    it('starts on step 1 of 4 with the four steps on the rail', async () => {
      const { container } = renderWithApp(<Setup />)
      expect(screen.getByRole('heading', { level: 1, name: 'Set up your company brain' })).toBeInTheDocument()
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(await title('Create your organisation')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        '1OrganisationName and email domain',
        '2MailOrganisation mailbox',
        '3First projectScope, mail and routing',
        '4First sourcesConnect and ingest',
      ])
      expect(railSteps()[0]).toHaveClass('on')
      expect(railSteps()[1]).not.toHaveClass('on')
      expect(railSteps()[1]).not.toHaveClass('done')
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(progress(container)).toBe('0%')
    })

    it('lets the person skip to the app', () => {
      renderWithApp(<Setup />)
      expect(screen.getByRole('link', { name: 'Skip to the app' })).toHaveAttribute('href', '#/app')
    })

    it('asks the backend whether the organisation is already set up', async () => {
      renderWithApp(<Setup />)
      await waitFor(() => expect(api.callsTo('GET', '/org/setup/status')).toHaveLength(1))
      expect(screen.queryByText('This organisation is already set up.')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('says so on step 1 when the organisation is already set up', async () => {
      api.get('/org/setup/status', status(true))
      const { user } = renderWithApp(<Setup />)
      expect(await screen.findByText('This organisation is already set up.')).toBeInTheDocument()

      await toMail(user)
      expect(screen.queryByText('This organisation is already set up.')).not.toBeInTheDocument()
    })

    it('works without the status', async () => {
      api.get('/org/setup/status', fail(500, 'boom'))
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
      expect(screen.queryByText('This organisation is already set up.')).not.toBeInTheDocument()
    })

    it('marks the steps already done on the rail and moves the progress bar', async () => {
      const { user, container } = renderWithApp(<Setup />)
      await toProject(user)
      expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
      const [one, two, three, four] = railSteps()
      expect(one).toHaveClass('done')
      expect(one).not.toHaveTextContent('1')
      expect(two).toHaveClass('done')
      expect(three).toHaveClass('on')
      expect(three).toHaveTextContent('3')
      expect(four).not.toHaveClass('on')
      expect(four).not.toHaveClass('done')
      expect(progress(container)).toBe('50%')
    })
  })

  describe('step 1: the organisation', () => {
    it('asks for every field before sending anything', async () => {
      const { user } = renderWithApp(<Setup />)
      expect(screen.getByText('Used to invite members and for the default mail routing rule.')).toBeInTheDocument()
      await user.click(cont())

      expect(screen.getByText('Enter the organisation name.')).toBeInTheDocument()
      expect(screen.getByText('Enter a domain like company.com, without @.')).toBeInTheDocument()
      expect(screen.getByText('Enter a name.')).toBeInTheDocument()
      expect(screen.getByText('Use an address at @….')).toBeInTheDocument()
      for (const label of ['Organisation name', 'Email domain', 'First admin', 'Admin email']) expect(field(label)).toHaveClass('invalid')
      expect(screen.queryByText('Used to invite members and for the default mail routing rule.')).not.toBeInTheDocument()
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(api.callsTo('POST', '/org/setup')).toHaveLength(0)
    })

    it('treats a name made of spaces as missing', async () => {
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user, { name: '   ', admin: '   ' })
      await user.click(cont())
      expect(screen.getByText('Enter the organisation name.')).toBeInTheDocument()
      expect(screen.getByText('Enter a name.')).toBeInTheDocument()
      expect(field('Email domain')).not.toHaveClass('invalid')
      expect(field('Admin email')).not.toHaveClass('invalid')
      expect(api.callsTo('POST', '/org/setup')).toHaveLength(0)
    })

    it.each(['@acme.com', 'acme', 'acme.', 'ac me.com', 'acme..com'])('rejects the domain "%s"', async (domain) => {
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user, { domain })
      await user.click(cont())
      expect(screen.getByText('Enter a domain like company.com, without @.')).toBeInTheDocument()
      expect(field('Email domain')).toHaveClass('invalid')
      expect(api.callsTo('POST', '/org/setup')).toHaveLength(0)
    })

    it('wants the admin address at the domain of the organisation', async () => {
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user, { email: 'giulia@other.com' })
      await user.click(cont())
      expect(screen.getByText('Use an address at @acme.com.')).toBeInTheDocument()
      expect(field('Admin email')).toHaveClass('invalid')
      expect(field('Organisation name')).not.toHaveClass('invalid')
      expect(api.callsTo('POST', '/org/setup')).toHaveLength(0)
    })

    it('compares the address and the domain without looking at the case', async () => {
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user, { domain: 'Acme.com', email: 'Giulia@ACME.COM' })
      await user.click(cont())
      await title('Connect the organisation mailbox')
      expect(api.last('POST', '/org/setup')!.body).toMatchObject({ primary_email_domain: 'Acme.com', first_admin: { email: 'Giulia@ACME.COM' } })
    })

    it('clears the errors once the fields are right', async () => {
      const { user } = renderWithApp(<Setup />)
      await user.click(cont())
      expect(screen.getByText('Enter the organisation name.')).toBeInTheDocument()

      await fillOrg(user, { email: '' })
      await user.click(cont())
      expect(screen.queryByText('Enter the organisation name.')).not.toBeInTheDocument()
      expect(screen.queryByText('Enter a domain like company.com, without @.')).not.toBeInTheDocument()
      expect(screen.getByText('Used to invite members and for the default mail routing rule.')).toBeInTheDocument()
      expect(field('Organisation name')).not.toHaveClass('invalid')
      expect(screen.getByText('Use an address at @acme.com.')).toBeInTheDocument()
    })

    it('creates the organisation with the values, trimmed, and moves to the mailbox', async () => {
      const { user, container } = renderWithApp(<Setup />)
      await fillOrg(user, { name: '  Acme  ', domain: '  acme.com  ', admin: '  Giulia Ferri  ', email: '  giulia@acme.com' })
      await user.click(cont())

      expect(await title('Connect the organisation mailbox')).toBeInTheDocument()
      expect(api.last('POST', '/org/setup')!.body).toEqual({
        organisation_name: 'Acme',
        primary_email_domain: 'acme.com',
        first_admin: { name: 'Giulia Ferri', email: 'giulia@acme.com' },
      })
      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      expect(screen.getByText('Set once for the organisation. Every project inherits it unless it overrides it.')).toBeInTheDocument()
      expect(progress(container)).toBe('25%')
      expect(api.unhandled).toEqual([])
    })

    it('carries on when the organisation was already created', async () => {
      api.post('/org/setup', fail(409, 'Already set up'))
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user)
      await user.click(cont())

      expect(await screen.findByText('This organisation is already set up.')).toBeInTheDocument()
      expect(await title('Connect the organisation mailbox')).toBeInTheDocument()
      expect(field('Inbound address')).toHaveValue('brain@inbound.acme.com')
    })

    it('says why when the organisation cannot be created, and stays on step 1', async () => {
      api.post('/org/setup', fail(422, 'The domain is taken'))
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user)
      await user.click(cont())

      expect(await screen.findByText('The domain is taken')).toBeInTheDocument()
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
      expect(field('Organisation name')).toHaveValue('Acme')
      await waitFor(() => expect(cont()).toBeEnabled())
    })

    it('says so when the backend cannot be reached', async () => {
      api.post('/org/setup', offline)
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user)
      await user.click(cont())
      expect(await screen.findByText('network')).toBeInTheDocument()
      expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    })

    it('locks Continue while the organisation is created', async () => {
      const gate = deferred()
      api.post('/org/setup', () => gate.promise)
      const { user } = renderWithApp(<Setup />)
      await fillOrg(user)
      await user.click(cont())

      await waitFor(() => expect(cont()).toBeDisabled())
      await user.click(cont())
      gate.resolve(org())
      await title('Connect the organisation mailbox')
      expect(cont()).toBeEnabled()
      expect(api.callsTo('POST', '/org/setup')).toHaveLength(1)
    })
  })

  describe('step 2: the mailbox', () => {
    it('suggests the mailbox from the domain, with IMAP selected', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      expect(screen.getByRole('button', { name: /IMAP mailbox/ })).toHaveClass('on')
      expect(screen.getByRole('button', { name: /Inbound webhook/ })).not.toHaveClass('on')
      expect(field('IMAP host')).toHaveValue('mock.acme.com')
      expect(field('IMAP user')).toHaveValue('brain@acme.com')
      expect(field('Inbound address')).toHaveValue('brain@inbound.acme.com')
      expect(screen.getByText('Forward or BCC emails here. Routing rules decide the project.')).toBeInTheDocument()
    })

    it('saves the IMAP mailbox and moves to the project', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.click(cont())

      expect(await title('Create the first project')).toBeInTheDocument()
      expect(api.last('PUT', '/org/mail')!.body).toEqual({
        mode: 'imap_mock',
        imap_host: 'mock.acme.com',
        imap_user: 'brain@acme.com',
        inbound_address: 'brain@inbound.acme.com',
        poll_interval_s: 60,
      })
      expect(api.unhandled).toEqual([])
    })

    it('sends what the person typed, and no host or user when they are left empty', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.clear(field('IMAP host'))
      await user.clear(field('IMAP user'))
      await user.clear(field('Inbound address'))
      await user.type(field('Inbound address'), 'memory@acme.com')
      await user.click(cont())

      await title('Create the first project')
      expect(api.last('PUT', '/org/mail')!.body).toEqual({ mode: 'imap_mock', imap_host: null, imap_user: null, inbound_address: 'memory@acme.com', poll_interval_s: 60 })
    })

    it('hides the IMAP fields for a webhook and sends none of them', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.click(screen.getByRole('button', { name: /Inbound webhook/ }))

      expect(screen.getByRole('button', { name: /Inbound webhook/ })).toHaveClass('on')
      expect(screen.getByRole('button', { name: /IMAP mailbox/ })).not.toHaveClass('on')
      expect(screen.queryByLabelText('IMAP host')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('IMAP user')).not.toBeInTheDocument()
      expect(field('Inbound address')).toHaveValue('brain@inbound.acme.com')

      await user.click(cont())
      await title('Create the first project')
      expect(api.last('PUT', '/org/mail')!.body).toEqual({ mode: 'webhook', imap_host: null, imap_user: null, inbound_address: 'brain@inbound.acme.com', poll_interval_s: 60 })
    })

    it('keeps the IMAP values when switching to the webhook and back', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.clear(field('IMAP host'))
      await user.type(field('IMAP host'), 'imap.acme.com')
      await user.click(screen.getByRole('button', { name: /Inbound webhook/ }))
      await user.click(screen.getByRole('button', { name: /IMAP mailbox/ }))
      expect(field('IMAP host')).toHaveValue('imap.acme.com')
      expect(field('IMAP user')).toHaveValue('brain@acme.com')
    })

    it.each(['brain', 'brain@acme', 'brain @acme.com', '@acme.com', 'a@b@acme.com'])('rejects the inbound address "%s"', async (address) => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.clear(field('Inbound address'))
      await user.type(field('Inbound address'), address)
      await user.click(cont())

      expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
      expect(field('Inbound address')).toHaveClass('invalid')
      expect(screen.queryByText('Forward or BCC emails here. Routing rules decide the project.')).not.toBeInTheDocument()
      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      expect(api.callsTo('PUT', '/org/mail')).toHaveLength(0)
    })

    it('says why when the mailbox cannot be saved, and stays on step 2', async () => {
      api.put('/org/mail', fail(403, 'Requires admin'))
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.click(cont())

      expect(await screen.findByText('Requires admin')).toBeInTheDocument()
      expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
      await waitFor(() => expect(cont()).toBeEnabled())
    })

    it('goes back to the organisation with the values kept', async () => {
      const { user, container } = renderWithApp(<Setup />)
      await toMail(user)
      await user.click(back())

      expect(await title('Create your organisation')).toBeInTheDocument()
      expect(field('Organisation name')).toHaveValue('Acme')
      expect(field('Email domain')).toHaveValue('acme.com')
      expect(field('First admin')).toHaveValue('Giulia Ferri')
      expect(field('Admin email')).toHaveValue('giulia@acme.com')
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(progress(container)).toBe('0%')
    })

    it('keeps the mailbox the person typed when step 1 is confirmed again', async () => {
      const { user } = renderWithApp(<Setup />)
      await toMail(user)
      await user.clear(field('Inbound address'))
      await user.type(field('Inbound address'), 'memory@acme.com')
      await user.click(back())
      await user.click(cont())

      await title('Connect the organisation mailbox')
      expect(field('Inbound address')).toHaveValue('memory@acme.com')
      expect(field('IMAP host')).toHaveValue('mock.acme.com')
    })
  })

  describe('step 3: the first project', () => {
    it('offers to route the emails of the domain to the project', async () => {
      const { user } = renderWithApp(<Setup />)
      await toProject(user)
      expect(screen.getByText('Route emails from @acme.com to this project')).toBeInTheDocument()
      expect(screen.getByRole('checkbox')).toBeChecked()
      expect(field('Project name')).toHaveValue('')
      expect(field('Description')).toHaveValue('')
    })

    it('asks for the project name before sending anything', async () => {
      const { user, app } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), '   ')
      await user.click(cont())

      expect(screen.getByText('Give the project a name.')).toBeInTheDocument()
      expect(field('Project name')).toHaveClass('invalid')
      expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
      expect(api.callsTo('POST', '/projects')).toHaveLength(0)
      expect(app.setProjectId).not.toHaveBeenCalled()
    })

    it('creates the project, selects it, adds the routing rule and moves to the sources', async () => {
      const { user, app, container } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), '  Pilot  ')
      await user.click(cont())

      expect(await title('Connect the first sources')).toBeInTheDocument()
      expect(api.last('POST', '/projects')!.body).toEqual({ name: 'Pilot', description: null })
      expect(app.setProjectId).toHaveBeenCalledWith('proj-pilot')
      expect(api.last('POST', '/org/mail/rules')!.body).toEqual({ match_type: 'sender_domain', value: '@acme.com', project_id: 'proj-pilot', priority: 10 })
      const sent = api.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)
      expect(sent).toEqual(['POST /org/setup', 'PUT /org/mail', 'POST /projects', 'POST /org/mail/rules'])
      expect(screen.getByText('Step 4 of 4')).toBeInTheDocument()
      expect(progress(container)).toBe('75%')
      expect(api.unhandled).toEqual([])
    })

    it('sends the description when there is one, trimmed', async () => {
      const { user } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), 'Pilot')
      await user.type(field('Description'), '  First engagement  ')
      await user.click(cont())

      await title('Connect the first sources')
      expect(api.last('POST', '/projects')!.body).toEqual({ name: 'Pilot', description: 'First engagement' })
    })

    it('creates no routing rule when the box is unticked', async () => {
      const { user } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), 'Pilot')
      await user.click(screen.getByRole('checkbox'))
      expect(screen.getByRole('checkbox')).not.toBeChecked()
      await user.click(cont())

      await title('Connect the first sources')
      expect(api.callsTo('POST', '/projects')).toHaveLength(1)
      expect(api.callsTo('POST', '/org/mail/rules')).toHaveLength(0)
    })

    it('carries on when only the routing rule fails, and says why', async () => {
      api.post('/org/mail/rules', fail(409, 'A rule for this domain exists'))
      const { user, app } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), 'Pilot')
      await user.click(cont())

      expect(await screen.findByText('A rule for this domain exists')).toBeInTheDocument()
      expect(await title('Connect the first sources')).toBeInTheDocument()
      expect(app.setProjectId).toHaveBeenCalledWith('proj-pilot')
    })

    it('says why when the project cannot be created, and stays on step 3', async () => {
      api.post('/projects', fail(409, 'A project with this name exists'))
      const { user, app } = renderWithApp(<Setup />)
      await toProject(user)
      await user.type(field('Project name'), 'Pilot')
      await user.click(cont())

      expect(await screen.findByText('A project with this name exists')).toBeInTheDocument()
      expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
      expect(app.setProjectId).not.toHaveBeenCalled()
      expect(api.callsTo('POST', '/org/mail/rules')).toHaveLength(0)
      await waitFor(() => expect(cont()).toBeEnabled())
    })

    it('goes back to the mailbox', async () => {
      const { user } = renderWithApp(<Setup />)
      await toProject(user)
      await user.click(back())
      expect(await title('Connect the organisation mailbox')).toBeInTheDocument()
      expect(field('Inbound address')).toHaveValue('brain@inbound.acme.com')
    })
  })

  describe('step 4: the first ingest', () => {
    it('offers to ingest the sample corpus', async () => {
      const { user } = renderWithApp(<Setup />)
      await toSources(user)
      expect(screen.getByText('Sample corpus')).toBeInTheDocument()
      expect(screen.getByText('OIDA ClearPath documents, emails and notes')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start first ingest' })).toBeEnabled()
      expect(screen.queryByText('Reading…')).not.toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/ingest')).toHaveLength(0)
    })

    it('goes back to the project with its name kept', async () => {
      const { user } = renderWithApp(<Setup />)
      await toSources(user)
      await user.click(back())
      expect(await title('Create the first project')).toBeInTheDocument()
      expect(field('Project name')).toHaveValue('Pilot')
    })

    it('shows the result when the ingest is already done, and reloads the app', async () => {
      const { user, app, container } = renderWithApp(<Setup />)
      await toSources(user)
      await user.click(screen.getByRole('button', { name: 'Start first ingest' }))

      expect(await title('Your memory is ready')).toBeInTheDocument()
      expect(api.last('POST', '/ingest')!.body).toEqual({ corpus: 'org-consulting-clearpath', force: false })
      expect(screen.getByText('Canonico read every source and extracted facts.')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
      expect(screen.getByText('46 documents · 312 facts')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open Canonico' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Start first ingest' })).not.toBeInTheDocument()
      expect(progress(container)).toBe('100%')
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(polls()).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('says why when the ingest cannot start, and lets the person try again', async () => {
      api.post('/ingest', fail(402, 'The cost cap is reached'))
      const { user, app } = renderWithApp(<Setup />)
      await toSources(user)
      await user.click(screen.getByRole('button', { name: 'Start first ingest' }))

      expect(await screen.findByText('The ingest failed. The cost cap is reached')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Start first ingest' })).toBeEnabled())
      expect(screen.queryByText('Reading…')).not.toBeInTheDocument()
      expect(back()).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()

      api.post('/ingest', job())
      await user.click(screen.getByRole('button', { name: 'Start first ingest' }))
      expect(await title('Your memory is ready')).toBeInTheDocument()
    })

    it('locks the button while the ingest is requested', async () => {
      const gate = deferred()
      api.post('/ingest', () => gate.promise)
      const { user } = renderWithApp(<Setup />)
      await toSources(user)
      await user.click(screen.getByRole('button', { name: 'Start first ingest' }))

      await waitFor(() => expect(screen.getByRole('button', { name: 'Start first ingest' })).toBeDisabled())
      gate.resolve(job())
      expect(await title('Your memory is ready')).toBeInTheDocument()
      expect(api.callsTo('POST', '/ingest')).toHaveLength(1)
    })

    it('shows the ingest running and takes the way back away', async () => {
      const { user, app, container } = renderWithApp(<Setup />)
      await startSlowIngest(user, job({ status: 'queued', docs: 0, facts: 0 }))

      expect(screen.getByRole('heading', { level: 2, name: 'Connect the first sources' })).toBeInTheDocument()
      const ingesting = screen.getByRole('button', { name: 'Ingesting' })
      expect(ingesting).toHaveAttribute('aria-disabled', 'true')
      expect(ingesting.querySelector('.spin')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Start first ingest' })).not.toBeInTheDocument()
      expect(screen.queryByText(/documents ·/)).not.toBeInTheDocument()
      expect(progress(container)).toBe('75%')
      expect(app.refresh).not.toHaveBeenCalled()

      fireEvent.click(ingesting)
      expect(api.callsTo('POST', '/ingest')).toHaveLength(1)
    })

    it('asks for the job after 900 ms and shows the result when it is done', async () => {
      const { user, app } = renderWithApp(<Setup />)
      await startSlowIngest(user)
      await tick(500)
      expect(polls()).toHaveLength(0)

      await advanceUntil(() => screen.queryByText('Your memory is ready') !== null)
      expect(polls()).toHaveLength(1)
      expect(polls()[0].params.job_id).toBe('job-1')
      expect(screen.getByText('46 documents · 312 facts')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
      expect(screen.queryByText('Reading…')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open Canonico' })).toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)

      await tick(3000)
      expect(polls()).toHaveLength(1)
    })

    it('keeps asking while the job is queued or running', async () => {
      const answers = [job({ status: 'queued', docs: 0, facts: 0 }), job({ status: 'running', docs: 12, facts: 80 }), job({ status: 'done', docs: 46, facts: 312 })]
      api.get('/ingest/:job_id', () => answers[Math.min(polls().length, answers.length) - 1])
      const { user, app } = renderWithApp(<Setup />)
      await startSlowIngest(user)

      await advanceUntil(() => polls().length === 2)
      expect(screen.getByText('Reading…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Ingesting' })).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()

      await advanceUntil(() => screen.queryByText('Your memory is ready') !== null)
      expect(polls()).toHaveLength(3)
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('says the ingest failed when the job ends in error, and stops asking', async () => {
      api.get('/ingest/:job_id', job({ status: 'error', docs: 3, facts: 0 }))
      const { user, app } = renderWithApp(<Setup />)
      await startSlowIngest(user)

      await advanceUntil(() => screen.queryByText('The ingest failed.') !== null)
      expect(polls()).toHaveLength(1)
      expect(screen.queryByText('Your memory is ready')).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()

      await tick(3000)
      expect(polls()).toHaveLength(1)
    })

    it('says why when the job cannot be read', async () => {
      api.get('/ingest/:job_id', fail(500, 'The ingest worker is gone'))
      const { user, app } = renderWithApp(<Setup />)
      await startSlowIngest(user)

      await advanceUntil(() => screen.queryByText('The ingest worker is gone') !== null)
      expect(polls()[0].params.job_id).toBe('job-1')
      expect(screen.queryByText('Your memory is ready')).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('stops asking when the screen is closed', async () => {
      const { user, unmount } = renderWithApp(<Setup />)
      await startSlowIngest(user)
      unmount()
      await tick(3000)
      expect(polls()).toHaveLength(0)
    })

    it('opens the app once it has reloaded, with a welcome', async () => {
      const gate = deferred<void>()
      const { user, app } = renderWithApp(<Setup />)
      await toSources(user)
      await user.click(screen.getByRole('button', { name: 'Start first ingest' }))
      await title('Your memory is ready')
      vi.mocked(app.refresh).mockClear()
      vi.mocked(app.refresh).mockReturnValue(gate.promise)

      await user.click(screen.getByRole('button', { name: 'Open Canonico' }))
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(location.hash).toBe('')
      expect(screen.queryByText('Acme is set up. Ask your first question.')).not.toBeInTheDocument()

      gate.resolve()
      expect(await screen.findByText('Acme is set up. Ask your first question.')).toBeInTheDocument()
      expect(location.hash).toBe('#/app')
    })
  })

  describe('the rail', () => {
    it('ticks every step once the ingest is running', async () => {
      const { user } = renderWithApp(<Setup />)
      await toSources(user)
      const [one, two, three, four] = railSteps()
      for (const dot of [one, two, three]) {
        expect(dot).toHaveClass('done')
        expect(within(dot as HTMLElement).queryByText(/\d/)).not.toBeInTheDocument()
      }
      expect(four).toHaveClass('on')
      expect(four).toHaveTextContent('4')
    })
  })
})
