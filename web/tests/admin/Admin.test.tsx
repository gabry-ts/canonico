import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Admin from '../../src/admin/Admin'
import { AppContext } from '../../src/lib/appContext'
import { api, deferred, fail, offline } from '../helpers/api'
import { auditEvent, me, MEMBERS, org, PERMISSIONS, project, PROJECTS, source, stats } from '../helpers/fixtures'
import { config, docVersion, githubPreview, inboundResult, mailConfig, mockAdmin, projectMail, searchResult, syncJob } from '../helpers/org'
import { makeApp, renderI18n, renderWithApp } from '../helpers/render'

const GH = source({ id: 'src-gh', project_id: 'proj-clearpath', type: 'github', label: 'gabry-ts/canonico', items: 12, last_synced_at: '2026-11-14T09:12:00Z' })

/** The content of a card, found by its title. */
const card = (title: string) => within(screen.getByRole('heading', { level: 2, name: title }).closest('.card') as HTMLElement)
const toastText = (text: string) => screen.findByText(text, { selector: '.toast *' })

/** The result box of an action, found by the endpoint written on it. Waits for it to appear. */
const resultOf = (ep: string) =>
  waitFor(() => {
    const box = screen.getAllByRole('status').find((b) => b.querySelector('span')?.textContent === ep)
    if (!box) throw new Error(`no result box for ${ep}`)
    return box
  })
/** The status code written on a result box ("200", "409", "error"). */
const codeOf = (box: HTMLElement) => box.querySelectorAll('span')[1].textContent!.split(' · ').at(-1)
const bodyOf = (box: HTMLElement) => box.lastElementChild as HTMLElement

/** Render as the owner with every read answered, and wait for the first load. */
async function open(routes: Parameters<typeof mockAdmin>[0] = {}, app: Parameters<typeof renderWithApp>[1] = {}) {
  mockAdmin(routes)
  const view = renderWithApp(<Admin />, app)
  await screen.findByText(/^Provider|^Offline mode: no spend/)
  await waitFor(() => expect(view.container.querySelector('.skel')).not.toBeInTheDocument())
  return view
}

describe('Admin', () => {
  describe('who can use it', () => {
    it('shows only a placeholder until the identity is known, and asks nothing', () => {
      const { container } = renderWithApp(<Admin />, { me: null })
      expect(container.querySelector('.skel')).toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
      expect(api.calls).toHaveLength(0)
    })

    it.each([
      ['an admin', MEMBERS.marco, 'You are acting as Marco (admin). Switch identity from the user menu.'],
      ['an editor', MEMBERS.sara, 'You are acting as Sara (editor). Switch identity from the user menu.'],
      ['a viewer', MEMBERS.luca, 'You are acting as Luca (viewer). Switch identity from the user menu.'],
    ])('%s sees that it requires the owner, no control and no request', (_who, as, text) => {
      renderWithApp(<Admin />, { me: me({ as }) })
      expect(screen.getByRole('heading', { level: 1, name: 'Demo control' })).toBeInTheDocument()
      expect(screen.getByText('Requires owner.')).toBeInTheDocument()
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByText('online')).not.toBeInTheDocument()
      expect(api.calls).toHaveLength(0)
    })

    it('the owner gets every card and the page asks only for what it shows', async () => {
      await open()
      expect(screen.getByRole('heading', { level: 1, name: 'Demo control' })).toBeInTheDocument()
      expect(screen.getByText('Presenter controls for the live demo. Every action here calls the real backend.')).toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Demo state', 'Mail', 'Document library', 'GitHub', 'Projects and sources', 'Recent audit', 'Current identity'])
      expect(screen.queryByText('Requires owner.')).not.toBeInTheDocument()
      expect(api.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([
        'GET /audit',
        'GET /config',
        'GET /documents/library%2Fonboarding-standard/versions',
        'GET /me',
        'GET /projects/proj-clearpath/sources',
        'GET /projects/proj-internal/sources',
        'GET /stats',
      ])
      expect(api.unhandled).toEqual([])
    })

    it('says online or offline next to the title', async () => {
      await open()
      expect(screen.getByText('online')).toHaveClass('badge')
      expect(screen.queryByText('offline · replay')).not.toBeInTheDocument()
    })

    it('says offline when the backend replays stored runs', async () => {
      await open({ config: config({ offline_mode: true }) })
      expect(screen.getByText('offline · replay')).toHaveClass('badge')
      expect(screen.queryByText('online')).not.toBeInTheDocument()
    })

    it.each([
      ['the stats', '/stats'],
      ['the configuration', '/config'],
    ])('says so when %s cannot be loaded', async (_what, path) => {
      mockAdmin()
      api.get(path, fail(500, 'database is locked'))
      renderWithApp(<Admin />)
      expect(await screen.findByText('Could not load the demo state. database is locked')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset demo' })).toBeInTheDocument()
    })

    it('loads everything again when the data changed', async () => {
      mockAdmin()
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp({ version: 1 })}>
          <Admin />
        </AppContext.Provider>,
      )
      await screen.findByText(/^Provider/)
      await waitFor(() => expect(api.calls).toHaveLength(7))

      mockAdmin({ stats: stats({ cost: { spent_usd: 1.5, cap_usd: 5 } }) })
      rerender(
        <AppContext.Provider value={makeApp({ version: 2 })}>
          <Admin />
        </AppContext.Provider>,
      )
      expect(await screen.findByText('$1.50')).toBeInTheDocument()
      await waitFor(() => expect(api.calls).toHaveLength(14))
      expect(api.unhandled).toEqual([])
    })
  })

  describe('reset', () => {
    it('says when the demo was last reset, or never', async () => {
      await open()
      expect(screen.getByText('Restores the seeded memory and returns the app to step 1. Last reset never.')).toBeInTheDocument()
    })

    it('shows the time of the last reset', async () => {
      await open({ stats: stats({ last_reset_at: '2026-11-14T08:05:00Z' }) })
      expect(screen.getByText('Restores the seeded memory and returns the app to step 1. Last reset 14 Nov, 08:05.')).toBeInTheDocument()
    })

    it('asks before resetting, and Cancel changes nothing', async () => {
      api.post('/demo/reset', stats())
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Reset demo' }))

      expect(screen.getByText('Reset to the seeded state?')).toBeInTheDocument()
      expect(screen.getByText('Memory, audit log, answers and every change made in this session are replaced.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reset demo' })).not.toBeInTheDocument()

      await user.click(card('Demo state').getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByText('Reset to the seeded state?')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset demo' })).toBeInTheDocument()
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(0)
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('resets on confirm, shows what was restored, says so and refreshes', async () => {
      api.post('/demo/reset', stats({ facts_total: 30, open_conflicts: 2, open_questions: 3 }))
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Reset demo' }))
      await user.click(screen.getByRole('button', { name: 'Confirm reset' }))

      const box = await resultOf('POST /demo/reset')
      expect(bodyOf(box)).toHaveTextContent('Seeded memory restored. 30 facts, 2 open conflicts, 3 open questions.')
      expect(bodyOf(box)).not.toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('200')
      expect(await toastText('Demo reset. The app is back at step 1.')).toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Reset to the seeded state?')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset demo' })).toBeInTheDocument()
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(1)
      expect(api.unhandled).toEqual([])
    })

    it('cannot be confirmed twice while the reset runs', async () => {
      const gate = deferred()
      api.post('/demo/reset', () => gate.promise)
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Reset demo' }))
      const confirm = screen.getByRole('button', { name: 'Confirm reset' })
      await user.click(confirm)

      expect(confirm).toBeDisabled()
      await user.click(confirm)
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(1)

      gate.resolve(stats())
      await resultOf('POST /demo/reset')
      await toastText('Demo reset. The app is back at step 1.')
    })

    it('shows the error and its status when the reset fails, without toast or refresh', async () => {
      api.post('/demo/reset', fail(409, 'An ingest is running'))
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Reset demo' }))
      await user.click(screen.getByRole('button', { name: 'Confirm reset' }))

      const box = await resultOf('POST /demo/reset')
      expect(bodyOf(box)).toHaveTextContent('An ingest is running')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('409')
      expect(screen.queryByText('Reset to the seeded state?')).not.toBeInTheDocument()
      expect(screen.queryByText('Demo reset. The app is back at step 1.')).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })
  })

  describe('health', () => {
    it('shows the status and the version of the backend, without refreshing', async () => {
      api.get('/health', { status: 'ok', version: '1.4.2' })
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Check now' }))

      const box = await resultOf('GET /health')
      expect(bodyOf(box)).toHaveTextContent('{ status: "ok", version: "1.4.2" }')
      expect(codeOf(box)).toBe('200')
      expect(app.refresh).not.toHaveBeenCalled()
    })

    it('is busy while the check runs', async () => {
      const gate = deferred()
      api.get('/health', () => gate.promise)
      const { user } = await open()
      const check = screen.getByRole('button', { name: 'Check now' })
      await user.click(check)
      expect(check).toBeDisabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      gate.resolve({ status: 'ok', version: '1.4.2' })
      await resultOf('GET /health')
      expect(check).toBeEnabled()
    })

    it('shows the error and its status when the backend is unwell', async () => {
      api.get('/health', fail(503, 'Service unavailable'))
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Check now' }))
      const box = await resultOf('GET /health')
      expect(bodyOf(box)).toHaveTextContent('Service unavailable')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('503')
      expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled()
    })

    it('shows an error when the backend cannot be reached, and a later check replaces it', async () => {
      api.get('/health', offline)
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Check now' }))
      expect(bodyOf(await resultOf('GET /health'))).toHaveClass('text-destructive')

      api.get('/health', { status: 'ok', version: '1.4.2' })
      await user.click(screen.getByRole('button', { name: 'Check now' }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('{ status: "ok", version: "1.4.2" }'))
      expect(bodyOf(screen.getByRole('status'))).not.toHaveClass('text-destructive')
    })
  })

  describe('cost', () => {
    const bar = (container: HTMLElement) => container.querySelector<HTMLElement>('.bar.neutral i')!

    it('shows what was spent against the cap, the provider and the answer model', async () => {
      const { container } = await open({ stats: stats({ cost: { spent_usd: 0.42, cap_usd: 5 } }) })
      const state = card('Demo state')
      expect(state.getByText('$0.42')).toBeInTheDocument()
      expect(state.getByText('$5.00')).toBeInTheDocument()
      expect(state.getByText('Provider anthropic · answer model claude-sonnet')).toBeInTheDocument()
      expect(parseFloat(bar(container).style.width)).toBeCloseTo(8.4)
    })

    it('groups thousands and keeps two decimals', async () => {
      await open({ stats: stats({ cost: { spent_usd: 1234.5, cap_usd: 20000 } }) })
      expect(card('Demo state').getByText('$1,234.50')).toBeInTheDocument()
      expect(card('Demo state').getByText('$20,000.00')).toBeInTheDocument()
    })

    it('fills the bar and no more when the spend is over the cap', async () => {
      const { container } = await open({ stats: stats({ cost: { spent_usd: 7.5, cap_usd: 5 } }) })
      expect(bar(container).style.width).toBe('100%')
    })

    it('leaves the bar empty when there is no cap', async () => {
      const { container } = await open({ stats: stats({ cost: { spent_usd: 1, cap_usd: 0 } }) })
      expect(bar(container).style.width).toBe('0%')
      expect(card('Demo state').getByText('$0.00')).toBeInTheDocument()
    })

    it('shows dashes when the stats cannot be loaded', async () => {
      mockAdmin()
      api.get('/stats', fail(500, 'database is locked'))
      const { container } = renderWithApp(<Admin />)
      await screen.findByText('Could not load the demo state. database is locked')
      const line = card('Demo state').getByText('Cost vs cap').parentElement!
      expect(line).toHaveTextContent('Cost vs cap— of —')
      expect(bar(container).style.width).toBe('0%')
    })

    it('shows a dash for a provider the backend does not name', async () => {
      await open({ config: { ...config(), provider: undefined } })
      expect(card('Demo state').getByText('Provider — · answer model claude-sonnet')).toBeInTheDocument()
    })

    it('says there is no spend in offline mode', async () => {
      await open({ config: config({ offline_mode: true }) })
      expect(card('Demo state').getByText('Offline mode: no spend')).toBeInTheDocument()
      expect(screen.queryByText(/^Provider/)).not.toBeInTheDocument()
    })
  })

  describe('offline demo mode', () => {
    const toggle = () => screen.getByRole('switch', { name: 'Offline demo mode' })

    it('cannot be switched until the configuration is loaded', async () => {
      mockAdmin()
      const gate = deferred()
      api.get('/config', () => gate.promise)
      renderWithApp(<Admin />)
      await screen.findByText('$0.42')
      expect(toggle()).toBeDisabled()
      expect(toggle()).toHaveAttribute('aria-checked', 'false')

      gate.resolve(config())
      await waitFor(() => expect(toggle()).toBeEnabled())
    })

    it('reflects the mode of the backend', async () => {
      await open({ config: config({ offline_mode: true }) })
      expect(toggle()).toHaveAttribute('aria-checked', 'true')
      expect(toggle()).toHaveClass('on')
    })

    it('switches it on, says so, refreshes and reads the configuration again', async () => {
      let off = false
      mockAdmin()
      api.get('/config', () => config({ offline_mode: off }))
      api.patch('/config', (req) => {
        off = (req.body as { offline_mode: boolean }).offline_mode
        return config({ offline_mode: off })
      })
      const { user, app } = renderWithApp(<Admin />)
      await screen.findByText(/^Provider/)
      expect(toggle()).toHaveAttribute('aria-checked', 'false')
      await user.click(toggle())

      expect(await toastText('Offline demo mode on. Answers replay stored runs.')).toBeInTheDocument()
      expect(api.last('PATCH', '/config')!.body).toEqual({ offline_mode: true })
      const box = await resultOf('PATCH /config')
      expect(bodyOf(box)).toHaveTextContent('offline_mode: true')
      expect(codeOf(box)).toBe('200')
      await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
      expect(toggle()).toHaveClass('on')
      expect(screen.getByText('offline · replay')).toBeInTheDocument()
      expect(screen.getByText('Offline mode: no spend')).toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.callsTo('GET', '/config')).toHaveLength(2)
      expect(api.unhandled).toEqual([])
    })

    it('switches it off and says so', async () => {
      let off = true
      mockAdmin()
      api.get('/config', () => config({ offline_mode: off }))
      api.patch('/config', (req) => {
        off = (req.body as { offline_mode: boolean }).offline_mode
        return config({ offline_mode: off })
      })
      const { user } = renderWithApp(<Admin />)
      await screen.findByText('Offline mode: no spend')
      await user.click(toggle())

      expect(await toastText('Offline demo mode off.')).toBeInTheDocument()
      expect(api.last('PATCH', '/config')!.body).toEqual({ offline_mode: false })
      await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'))
      expect(toggle()).not.toHaveClass('on')
      expect(screen.getByText('online')).toBeInTheDocument()
    })

    it('shows the error and stays as it was when the backend refuses', async () => {
      api.patch('/config', fail(403, 'Requires owner'))
      const { user, app } = await open()
      await user.click(toggle())

      const box = await resultOf('PATCH /config')
      expect(bodyOf(box)).toHaveTextContent('Requires owner')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('403')
      expect(toggle()).toHaveAttribute('aria-checked', 'false')
      expect(toggle()).toBeEnabled()
      expect(screen.queryByText(/Offline demo mode (on|off)/)).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(api.callsTo('GET', '/config')).toHaveLength(1)
    })
  })

  describe('demo email', () => {
    it('sends it and shows where it was routed, the facts created and what they supersede', async () => {
      api.post('/demo/send-email', inboundResult({ facts_created: ['M-400', 'M-401'], supersedes_created: [{ fact_id: 'M-400', supersedes: 'M-106' }, { fact_id: 'M-401', supersedes: 'M-107' }] }))
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Send' }))

      const box = await resultOf('POST /demo/send-email')
      expect(within(box).getByText('Routed to ClearPath engagement by MR-1.')).toBeInTheDocument()
      expect(within(box).getByText('Facts created: M-400, M-401.')).toBeInTheDocument()
      expect(within(box).getByText('M-400 supersedes M-106.')).toBeInTheDocument()
      expect(within(box).getByText('M-401 supersedes M-107.')).toBeInTheDocument()
      expect(codeOf(box)).toBe('200')
      expect(api.last('POST', '/demo/send-email')!.body).toBeUndefined()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])
    })

    it('says when no rule matched and no fact was extracted', async () => {
      api.post('/demo/send-email', inboundResult({ routed_project_id: null, rule_id: null, facts_created: [], supersedes_created: [] }))
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Send' }))
      const box = await resultOf('POST /demo/send-email')
      expect(within(box).getByText('No rule matched, kept in the organisation inbox.')).toBeInTheDocument()
      expect(within(box).getByText('No facts extracted.')).toBeInTheDocument()
      expect(within(box).queryByText(/supersedes/)).not.toBeInTheDocument()
    })

    it('shows the id of a project that is not listed and a dash for a missing rule', async () => {
      api.post('/demo/send-email', inboundResult({ routed_project_id: 'proj-gone', rule_id: null }))
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Send' }))
      expect(within(await resultOf('POST /demo/send-email')).getByText('Routed to proj-gone by —.')).toBeInTheDocument()
    })

    it('shows the error and does not refresh when it was already sent', async () => {
      api.post('/demo/send-email', fail(409, 'The demo email was already sent'))
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Send' }))
      const box = await resultOf('POST /demo/send-email')
      expect(bodyOf(box)).toHaveTextContent('The demo email was already sent')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('409')
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    })
  })

  describe('polling the mailbox', () => {
    it('says when there is nothing new', async () => {
      api.post('/mail/poll', { polled: 0, results: [] })
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Poll now' }))

      const box = await resultOf('POST /mail/poll')
      expect(bodyOf(box)).toHaveTextContent('Mailbox empty. Nothing new.')
      expect(api.last('POST', '/mail/poll')!.body).toEqual({})
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('shows how many emails were read and where each one went', async () => {
      api.post('/mail/poll', {
        polled: 2,
        results: [
          inboundResult({ message_id: '<a@x>', routed_project_id: 'proj-internal', rule_id: 'MR-2', facts_created: ['M-501'], supersedes_created: [] }),
          inboundResult({ message_id: '<b@x>', routed_project_id: null, rule_id: null, facts_created: [], supersedes_created: [] }),
        ],
      })
      const { user } = await open()
      await user.click(screen.getByRole('button', { name: 'Poll now' }))

      const box = within(await resultOf('POST /mail/poll'))
      expect(box.getByText('2 read.')).toBeInTheDocument()
      expect(box.getByText('Routed to Internal by MR-2.')).toBeInTheDocument()
      expect(box.getByText('Facts created: M-501.')).toBeInTheDocument()
      expect(box.getByText('No rule matched, kept in the organisation inbox.')).toBeInTheDocument()
      expect(box.getByText('No facts extracted.')).toBeInTheDocument()
    })

    it('shows the error when the poll fails', async () => {
      api.post('/mail/poll', fail(500, 'IMAP timeout'))
      const { user, app } = await open()
      await user.click(screen.getByRole('button', { name: 'Poll now' }))
      const box = await resultOf('POST /mail/poll')
      expect(bodyOf(box)).toHaveTextContent('IMAP timeout')
      expect(codeOf(box)).toBe('500')
      expect(app.refresh).not.toHaveBeenCalled()
    })
  })

  describe('composing an email', () => {
    const send = () => screen.getByRole('button', { name: 'Send to webhook' })

    it('starts with a sample email addressed to the inbound address of the organisation', async () => {
      await open({}, { org: org({ mail_config: mailConfig({ inbound_address: 'brain@meridianlabs.org' }) }) })
      expect(screen.getByLabelText('From')).toHaveValue('client@meridianlabs.org')
      expect(screen.getByLabelText('To')).toHaveValue('brain@meridianlabs.org')
      expect(screen.getByLabelText('Subject')).toHaveValue('Onboarding target, final check')
      expect(screen.getByLabelText('Text')).toHaveValue('We keep the onboarding target at 5 weeks, as agreed.')
      expect(send()).toBeEnabled()
    })

    it('leaves the recipient empty when the organisation has no inbound address', async () => {
      await open()
      expect(screen.getByLabelText('To')).toHaveValue('')
    })

    it('posts the email as typed, trimmed, with a new message id and the current time', async () => {
      api.post('/mail/inbound', inboundResult())
      const before = Date.now()
      const { user, app } = await open({}, { org: org({ mail_config: mailConfig() }) })
      for (const [label, value] of [
        ['From', ' anna@clearpath.com '],
        ['To', ' pilot@meridianlabs.org '],
        ['Subject', '  Pilot size '],
        ['Text', '  The pilot has 12 consultants. '],
      ]) {
        await user.clear(screen.getByLabelText(label))
        await user.type(screen.getByLabelText(label), value)
      }
      await user.click(send())

      const box = await resultOf('POST /mail/inbound')
      expect(within(box).getByText('Routed to ClearPath engagement by MR-1.')).toBeInTheDocument()
      expect(within(box).getByText('M-400 supersedes M-106.')).toBeInTheDocument()
      const body = api.last('POST', '/mail/inbound')!.body as { message_id: string; date: string }
      expect(body).toEqual({
        message_id: expect.stringMatching(/^<admin-\d+@admin\.local>$/),
        from: 'anna@clearpath.com',
        to: ['pilot@meridianlabs.org'],
        cc: [],
        subject: 'Pilot size',
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        text: 'The pilot has 12 consultants.',
        attachments: [],
      })
      expect(Date.parse(body.date)).toBeGreaterThanOrEqual(before)
      expect(Date.parse(body.date)).toBeLessThanOrEqual(Date.now())
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])
    })

    it('sends to the inbound address of the organisation unless the recipient is edited', async () => {
      api.post('/mail/inbound', inboundResult())
      const { user } = await open({}, { org: org({ mail_config: mailConfig({ inbound_address: 'brain@meridianlabs.org' }) }) })
      await user.click(send())
      await resultOf('POST /mail/inbound')
      expect(api.last('POST', '/mail/inbound')!.body).toMatchObject({ from: 'client@meridianlabs.org', to: ['brain@meridianlabs.org'], subject: 'Onboarding target, final check' })
    })

    it.each(['From', 'Text'])('cannot be sent with an empty %s', async (label) => {
      api.post('/mail/inbound', inboundResult())
      const { user } = await open()
      await user.clear(screen.getByLabelText(label))
      await user.type(screen.getByLabelText(label), '   ')
      expect(send()).toBeDisabled()
      await user.click(send())
      expect(api.callsTo('POST', '/mail/inbound')).toHaveLength(0)

      await user.type(screen.getByLabelText(label), 'x')
      expect(send()).toBeEnabled()
    })

    it('shows the error when the webhook refuses the email', async () => {
      api.post('/mail/inbound', fail(422, 'Recipient is not an inbound address'))
      const { user, app } = await open()
      await user.type(screen.getByLabelText('To'), 'nobody@nowhere.org')
      await user.click(send())
      const box = await resultOf('POST /mail/inbound')
      expect(bodyOf(box)).toHaveTextContent('Recipient is not an inbound address')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('422')
      expect(app.refresh).not.toHaveBeenCalled()
    })
  })

  describe('document library', () => {
    const VERSIONS = [
      docVersion({ version: 1, version_label: 'v1', uploaded_at: '2026-11-10T08:00:00Z' }),
      docVersion({ version: 2, version_label: null, uploaded_at: '2026-11-12T10:30:00Z', facts_superseded: ['M-110', 'M-111'] }),
    ]
    const versions = () =>
      card('Document library')
        .getAllByRole('listitem')
        .map((li) => Array.from(li.children).map((c) => c.textContent))

    it('lists the versions of the sample document, newest first, the newest one binding', async () => {
      await open({ versions: VERSIONS })
      expect(screen.getByLabelText('Document id')).toHaveValue('library/onboarding-standard')
      expect(api.last('GET', '/documents/:doc_id/versions')!.params.doc_id).toBe('library/onboarding-standard')
      expect(versions()).toEqual([
        ['v2', '12 Nov, 10:30', 'M-110, M-111', 'Binding'],
        ['v1', '10 Nov, 08:00', 'Superseded'],
      ])
      const lib = card('Document library')
      expect(lib.getByText('Binding')).toHaveClass('badge', 'binding')
      expect(lib.getByText('Superseded')).toHaveClass('badge', 'superseded')
      expect(lib.getByText('M-110, M-111')).toHaveClass('strike')
    })

    it('shows a version without upload time', async () => {
      await open({ versions: [docVersion({ version: 4, version_label: 'final', uploaded_at: undefined, facts_superseded: undefined })] })
      expect(versions()).toEqual([['final', '', 'Binding']])
    })

    it.each([
      ['has no versions', () => []],
      ['is not found', () => fail(404, 'Document not found')],
    ])('says so when the document %s', async (_what, answer) => {
      mockAdmin()
      api.get('/documents/:doc_id/versions', answer)
      renderWithApp(<Admin />)
      expect(await card('Document library').findByText('No versions found for this document.')).toBeInTheDocument()
      expect(card('Document library').queryByRole('listitem')).not.toBeInTheDocument()
      await screen.findByText(/^Provider/)
      await waitFor(() => expect(api.callsTo('GET', '/me')).toHaveLength(1))
    })

    it('Show versions loads another document', async () => {
      mockAdmin()
      api.get('/documents/:doc_id/versions', (req) => (req.params.doc_id === 'library/pricing' ? [docVersion({ document_id: 'library/pricing', version: 7, version_label: 'v7' })] : VERSIONS))
      const { user } = renderWithApp(<Admin />)
      await card('Document library').findByText('v2')
      await user.clear(screen.getByLabelText('Document id'))
      await user.type(screen.getByLabelText('Document id'), '  library/pricing ')
      expect(api.callsTo('GET', '/documents/:doc_id/versions')).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: 'Show versions' }))

      expect(await card('Document library').findByText('v7')).toBeInTheDocument()
      expect(api.last('GET', '/documents/:doc_id/versions')!.params.doc_id).toBe('library/pricing')
      await waitFor(() => expect(versions()).toEqual([['v7', '10 Nov, 08:00', 'Binding']]))
    })

    it('Show versions on the same document loads it again', async () => {
      const { user } = await open({ versions: VERSIONS })
      await card('Document library').findByText('v2')
      api.get('/documents/:doc_id/versions', [...VERSIONS, docVersion({ version: 3, version_label: 'v3', uploaded_at: '2026-11-14T10:00:00Z' })])
      await user.click(screen.getByRole('button', { name: 'Show versions' }))

      expect(await card('Document library').findByText('v3')).toBeInTheDocument()
      expect(api.callsTo('GET', '/documents/:doc_id/versions')).toHaveLength(2)
      expect(versions().map((v) => v[0])).toEqual(['v3', 'v2', 'v1'])
    })

    describe('uploading a version', () => {
      const upload = () => screen.getByRole('button', { name: 'Upload version' })

      it('suggests the next version number as the label', async () => {
        await open({ versions: VERSIONS })
        await card('Document library').findByText('v2')
        expect(screen.getByLabelText('Version label')).toHaveAttribute('placeholder', 'v3')
        expect(screen.getByLabelText('Version label')).toHaveValue('')
        expect(screen.getByLabelText('New text')).toHaveValue('Onboarding SLA: 5 weeks.')
      })

      it('suggests v1 for a document without versions', async () => {
        await open({ versions: [] })
        await card('Document library').findByText('No versions found for this document.')
        expect(screen.getByLabelText('Version label')).toHaveAttribute('placeholder', 'v1')
      })

      it('counts from the highest version, whatever the order', async () => {
        await open({ versions: [docVersion({ version: 9, version_label: 'v9' }), docVersion({ version: 3, version_label: 'v3' })] })
        await card('Document library').findByText('v9')
        expect(screen.getByLabelText('Version label')).toHaveAttribute('placeholder', 'v10')
      })

      it('stores the text under the suggested label, shows what it superseded, refreshes and lists the versions again', async () => {
        api.post('/documents/:doc_id/versions', {
          version: docVersion({ version: 3, version_label: 'v3' }),
          facts_created: ['M-600'],
          supersedes_created: [{ fact_id: 'M-600', supersedes: 'M-110' }],
        })
        const { user, app } = await open({ versions: VERSIONS })
        await card('Document library').findByText('v2')
        await user.clear(screen.getByLabelText('New text'))
        await user.type(screen.getByLabelText('New text'), '  Onboarding SLA: 4 weeks. ')
        await user.click(upload())

        const box = await resultOf('POST /documents/{doc_id}/versions')
        expect(within(box).getByText('Version v3 stored.')).toBeInTheDocument()
        expect(within(box).getByText('M-600 supersedes M-110.')).toBeInTheDocument()
        expect(within(box).queryByText('No fact superseded.')).not.toBeInTheDocument()
        expect(codeOf(box)).toBe('201')
        const sent = api.last('POST', '/documents/:doc_id/versions')!
        expect(sent.params.doc_id).toBe('library/onboarding-standard')
        expect(sent.body).toEqual({ version_label: 'v3', text: 'Onboarding SLA: 4 weeks.' })
        expect(app.refresh).toHaveBeenCalledTimes(1)
        await waitFor(() => expect(api.callsTo('GET', '/documents/:doc_id/versions')).toHaveLength(2))
        expect(api.unhandled).toEqual([])
      })

      it('uses the typed label, then empties the field', async () => {
        api.post('/documents/:doc_id/versions', { version: docVersion({ version: 3, version_label: null }), facts_created: [], supersedes_created: [] })
        const { user } = await open({ versions: VERSIONS })
        await card('Document library').findByText('v2')
        await user.type(screen.getByLabelText('Version label'), ' 2026-final ')
        await user.click(upload())

        const box = await resultOf('POST /documents/{doc_id}/versions')
        expect(within(box).getByText('Version v3 stored.')).toBeInTheDocument()
        expect(within(box).getByText('No fact superseded.')).toBeInTheDocument()
        expect(api.last('POST', '/documents/:doc_id/versions')!.body).toEqual({ version_label: '2026-final', text: 'Onboarding SLA: 5 weeks.' })
        await waitFor(() => expect(screen.getByLabelText('Version label')).toHaveValue(''))
      })

      it('uploads to the document whose versions are shown', async () => {
        mockAdmin()
        api.get('/documents/:doc_id/versions', (req) => [docVersion({ document_id: req.params.doc_id, version: req.params.doc_id === 'library/pricing' ? 7 : 1, version_label: null })])
        api.post('/documents/:doc_id/versions', { version: docVersion({ document_id: 'library/pricing', version: 8, version_label: 'v8' }), facts_created: [], supersedes_created: [] })
        const { user } = renderWithApp(<Admin />)
        await card('Document library').findByText('v1')
        await user.clear(screen.getByLabelText('Document id'))
        await user.type(screen.getByLabelText('Document id'), 'library/pricing')
        await user.click(screen.getByRole('button', { name: 'Show versions' }))
        await card('Document library').findByText('v7')
        await user.click(upload())

        expect(within(await resultOf('POST /documents/{doc_id}/versions')).getByText('Version v8 stored.')).toBeInTheDocument()
        const sent = api.last('POST', '/documents/:doc_id/versions')!
        expect(sent.params.doc_id).toBe('library/pricing')
        expect(sent.body).toEqual({ version_label: 'v8', text: 'Onboarding SLA: 5 weeks.' })
      })

      it('cannot be uploaded without text', async () => {
        api.post('/documents/:doc_id/versions', {})
        const { user } = await open({ versions: VERSIONS })
        await user.clear(screen.getByLabelText('New text'))
        await user.type(screen.getByLabelText('New text'), '  ')
        expect(upload()).toBeDisabled()
        await user.click(upload())
        expect(api.callsTo('POST', '/documents/:doc_id/versions')).toHaveLength(0)
      })

      it('shows the error, keeps the label and does not refresh when the upload fails', async () => {
        api.post('/documents/:doc_id/versions', fail(409, 'Version label already used'))
        const { user, app } = await open({ versions: VERSIONS })
        await card('Document library').findByText('v2')
        await user.type(screen.getByLabelText('Version label'), 'v2')
        await user.click(upload())

        const box = await resultOf('POST /documents/{doc_id}/versions')
        expect(bodyOf(box)).toHaveTextContent('Version label already used')
        expect(bodyOf(box)).toHaveClass('text-destructive')
        expect(codeOf(box)).toBe('409')
        expect(screen.getByLabelText('Version label')).toHaveValue('v2')
        expect(app.refresh).not.toHaveBeenCalled()
        expect(api.callsTo('GET', '/documents/:doc_id/versions')).toHaveLength(1)
      })
    })
  })

  describe('GitHub', () => {
    const syncButtons = () => card('GitHub').getAllByRole('button', { name: /^Sync/ })
    const tick = (ms = 1000) => act(() => vi.advanceTimersByTimeAsync(ms))

    it('says when no project has a GitHub source', async () => {
      await open()
      expect(card('GitHub').getByText('No GitHub source in the projects yet. Add one below, or preview a repository.')).toBeInTheDocument()
      expect(card('GitHub').queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    })

    it('shows the error instead of "no GitHub source" when the sources cannot be loaded, and loads them again on retry', async () => {
      mockAdmin()
      api.get('/projects/:project_id/sources', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Admin />)
      expect(await card('GitHub').findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(card('GitHub').queryByText(/No GitHub source/)).not.toBeInTheDocument()
      expect(card('GitHub').getByRole('button', { name: 'Preview' })).toBeInTheDocument()

      mockAdmin({ sources: { 'proj-clearpath': [GH], 'proj-internal': [] } })
      await user.click(card('GitHub').getByRole('button', { name: 'Try again' }))
      expect(await card('GitHub').findByText('gabry-ts/canonico')).toBeInTheDocument()
      expect(card('GitHub').queryByText('Could not load this. database is locked')).not.toBeInTheDocument()
    })

    it('says nothing about GitHub sources while they load', async () => {
      mockAdmin()
      const gate = deferred()
      api.get('/projects/:project_id/sources', () => gate.promise)
      renderWithApp(<Admin />)
      await screen.findByText(/^Provider/)
      expect(card('GitHub').queryByText(/No GitHub source/)).not.toBeInTheDocument()

      gate.resolve({ items: [] })
      expect(await card('GitHub').findByText(/No GitHub source/)).toBeInTheDocument()
    })

    it('lists the GitHub sources of every project with their items and last sync', async () => {
      await open({
        sources: {
          'proj-clearpath': [source(), GH],
          'proj-internal': [source({ id: 'src-gh2', project_id: 'proj-internal', type: 'github', label: 'meridian/handbook', items: undefined, last_synced_at: null })],
        },
      })
      const gh = card('GitHub')
      expect(gh.getByText('gabry-ts/canonico')).toBeInTheDocument()
      expect(gh.getByText('12 items, last sync 14 Nov, 09:12.')).toBeInTheDocument()
      expect(gh.getByText('meridian/handbook')).toBeInTheDocument()
      expect(gh.getByText('0 items, last sync —.')).toBeInTheDocument()
      expect(gh.queryByText('ClearPath documents')).not.toBeInTheDocument()
      expect(gh.queryByText(/No GitHub source/)).not.toBeInTheDocument()
      expect(syncButtons()).toHaveLength(2)
    })

    it('reads the sources from a bare array too', async () => {
      mockAdmin()
      api.get('/projects/:project_id/sources', (req) => (req.params.project_id === 'proj-clearpath' ? [GH] : {}))
      renderWithApp(<Admin />)
      expect(await card('GitHub').findByText('gabry-ts/canonico')).toBeInTheDocument()
      expect(syncButtons()).toHaveLength(1)
      await screen.findByText(/^Provider/)
      await waitFor(() => expect(api.callsTo('GET', '/me')).toHaveLength(1))
    })

    it('follows the sync job second by second, then shows what it added and refreshes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const states = [syncJob({ status: 'running' }), syncJob({ status: 'done', items_added: 3, facts_created: 2 })]
      api.post('/sources/:source_id/sync', syncJob({ status: 'queued' }))
      api.get('/sync-jobs/:job_id', () => states.shift())
      const { user, app, container } = await open({
        sources: { 'proj-clearpath': [GH], 'proj-internal': [source({ id: 'src-gh2', project_id: 'proj-internal', type: 'github', label: 'meridian/handbook' })] },
      })
      await user.click(syncButtons()[0])

      expect(await card('GitHub').findByText('job J-1 · queued')).toBeInTheDocument()
      expect(api.last('POST', '/sources/:source_id/sync')!.params.source_id).toBe('src-gh')
      expect(syncButtons().map((b) => b.textContent)).toEqual(['Syncing', 'Sync now'])
      for (const b of syncButtons()) expect(b).toBeDisabled()
      const bar = () => container.querySelector<HTMLElement>('.bar:not(.neutral) i')!
      expect(bar().style.width).toBe('15%')
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(0)

      await tick()
      expect(await card('GitHub').findByText('job J-1 · running')).toBeInTheDocument()
      expect(bar().style.width).toBe('60%')
      expect(api.last('GET', '/sync-jobs/:job_id')!.params.job_id).toBe('J-1')

      await tick()
      const box = await resultOf('POST /sources/{source_id}/sync')
      expect(bodyOf(box)).toHaveTextContent('Sync done. 3 items added, 2 facts created.')
      expect(bodyOf(box)).not.toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('200')
      await waitFor(() => expect(syncButtons().map((b) => b.textContent)).toEqual(['Sync now', 'Sync now']))
      for (const b of syncButtons()) expect(b).toBeEnabled()
      expect(card('GitHub').queryByText(/^job J-1/)).not.toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(2)

      await tick(5000)
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(2)
      expect(api.unhandled).toEqual([])
    })

    it('does not poll when the sync is done at once, and shows zero for missing counts', async () => {
      api.post('/sources/:source_id/sync', syncJob({ status: 'done' }))
      const { user, app } = await open({ sources: { 'proj-clearpath': [GH] } })
      await user.click(syncButtons()[0])

      const box = await resultOf('POST /sources/{source_id}/sync')
      expect(bodyOf(box)).toHaveTextContent('Sync done. 0 items added, 0 facts created.')
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(0)
      await waitFor(() => expect(syncButtons()[0]).toBeEnabled())
    })

    it('says when the job ends in error', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.post('/sources/:source_id/sync', syncJob({ status: 'running' }))
      api.get('/sync-jobs/:job_id', syncJob({ status: 'error' }))
      const { user } = await open({ sources: { 'proj-clearpath': [GH] } })
      await user.click(syncButtons()[0])
      await card('GitHub').findByText('job J-1 · running')
      await tick()

      const box = await resultOf('POST /sources/{source_id}/sync')
      expect(bodyOf(box)).toHaveTextContent('Sync failed.')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('error')
      await waitFor(() => expect(syncButtons()[0]).toBeEnabled())
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(1)
    })

    it('shows the error when the sync cannot start, without refreshing', async () => {
      api.post('/sources/:source_id/sync', fail(409, 'A sync is already running'))
      const { user, app } = await open({ sources: { 'proj-clearpath': [GH] } })
      await user.click(syncButtons()[0])

      const box = await resultOf('POST /sources/{source_id}/sync')
      expect(bodyOf(box)).toHaveTextContent('A sync is already running')
      expect(bodyOf(box)).toHaveClass('text-destructive')
      expect(codeOf(box)).toBe('409')
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(syncButtons()[0]).toBeEnabled())
      expect(syncButtons()[0]).toHaveTextContent('Sync now')
    })

    it('shows the error when the job can no longer be read', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.post('/sources/:source_id/sync', syncJob({ status: 'queued' }))
      api.get('/sync-jobs/:job_id', fail(404, 'Job not found'))
      const { user, app } = await open({ sources: { 'proj-clearpath': [GH] } })
      await user.click(syncButtons()[0])
      await card('GitHub').findByText('job J-1 · queued')
      await tick()

      const box = await resultOf('POST /sources/{source_id}/sync')
      expect(bodyOf(box)).toHaveTextContent('Job not found')
      expect(codeOf(box)).toBe('404')
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(syncButtons()[0]).toBeEnabled())
    })

    it('stops following the job when the screen is left', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      api.post('/sources/:source_id/sync', syncJob({ status: 'queued' }))
      api.get('/sync-jobs/:job_id', syncJob({ status: 'running' }))
      const { user, unmount } = await open({ sources: { 'proj-clearpath': [GH] } })
      await user.click(syncButtons()[0])
      await card('GitHub').findByText('job J-1 · queued')

      unmount()
      await tick(10_000)
      expect(api.callsTo('GET', '/sync-jobs/:job_id')).toHaveLength(1)
    })

    describe('repository preview', () => {
      const preview = () => screen.getByRole('button', { name: 'Preview' })

      it('describes the repository without refreshing', async () => {
        api.post('/sources/github/preview', githubPreview({ full_name: 'gabry-ts/canonico', open_issues: 7, default_branch: 'main', has_readme: true }))
        const { user, app } = await open()
        expect(screen.getByLabelText('Repository preview')).toHaveValue('https://github.com/gabry-ts/canonico')
        await user.click(preview())

        const box = await resultOf('POST /sources/github/preview')
        expect(bodyOf(box)).toHaveTextContent('gabry-ts/canonico: 7 open issues, branch main, README found.')
        expect(codeOf(box)).toBe('200')
        expect(api.last('POST', '/sources/github/preview')!.body).toEqual({ repo_url: 'https://github.com/gabry-ts/canonico' })
        expect(app.refresh).not.toHaveBeenCalled()
        expect(api.unhandled).toEqual([])
      })

      it('sends the typed address, trimmed, and says when there is no README', async () => {
        api.post('/sources/github/preview', githubPreview({ full_name: 'meridian/handbook', open_issues: 0, default_branch: 'trunk', has_readme: false }))
        const { user } = await open()
        await user.clear(screen.getByLabelText('Repository preview'))
        await user.type(screen.getByLabelText('Repository preview'), '  https://github.com/meridian/handbook ')
        await user.click(preview())

        expect(bodyOf(await resultOf('POST /sources/github/preview'))).toHaveTextContent('meridian/handbook: 0 open issues, branch trunk, no README.')
        expect(api.last('POST', '/sources/github/preview')!.body).toEqual({ repo_url: 'https://github.com/meridian/handbook' })
      })

      it('cannot be asked without an address', async () => {
        api.post('/sources/github/preview', githubPreview())
        const { user } = await open()
        await user.clear(screen.getByLabelText('Repository preview'))
        await user.type(screen.getByLabelText('Repository preview'), '  ')
        expect(preview()).toBeDisabled()
        await user.click(preview())
        expect(api.callsTo('POST', '/sources/github/preview')).toHaveLength(0)
      })

      it('shows the error for a repository that cannot be read', async () => {
        api.post('/sources/github/preview', fail(404, 'Repository not found or private'))
        const { user } = await open()
        await user.click(preview())
        const box = await resultOf('POST /sources/github/preview')
        expect(bodyOf(box)).toHaveTextContent('Repository not found or private')
        expect(bodyOf(box)).toHaveClass('text-destructive')
        expect(codeOf(box)).toBe('404')
        expect(preview()).toBeEnabled()
      })
    })
  })

  describe('projects and sources', () => {
    const item = (id: string) => within(card('Projects and sources').getByText(id).closest('li') as HTMLElement)
    const create = () => card('Projects and sources').getByRole('button', { name: 'Create project' })

    it('lists every project with its id and its sources', async () => {
      await open({ sources: { 'proj-clearpath': [source(), GH], 'proj-internal': [] } })
      expect(item('proj-clearpath').getByText('ClearPath engagement')).toBeInTheDocument()
      expect(item('proj-clearpath').getByText('documents · ClearPath documents')).toHaveAttribute('title', 'src-clearpath-docs')
      expect(item('proj-clearpath').getByText('github · gabry-ts/canonico')).toHaveClass('tag')
      expect(item('proj-clearpath').queryByText('No sources.')).not.toBeInTheDocument()
      expect(item('proj-internal').getByText('Internal')).toBeInTheDocument()
      expect(item('proj-internal').getByText('No sources.')).toBeInTheDocument()
    })

    it('shows a placeholder while the sources load', async () => {
      mockAdmin()
      const gate = deferred()
      api.get('/projects/:project_id/sources', () => gate.promise)
      renderWithApp(<Admin />)
      await screen.findByText(/^Provider/)
      const projects = screen.getByRole('heading', { level: 2, name: 'Projects and sources' }).closest('.card')!
      expect(projects.querySelector('.skel')).toBeInTheDocument()
      expect(card('Projects and sources').queryByText('proj-clearpath')).not.toBeInTheDocument()

      gate.resolve({ items: [] })
      expect(await card('Projects and sources').findByText('proj-clearpath')).toBeInTheDocument()
      expect(projects.querySelector('.skel')).not.toBeInTheDocument()
    })

    it('shows the error instead of "no sources" when the sources cannot be loaded, keeps the projects, and loads them again on retry', async () => {
      mockAdmin()
      api.get('/projects/:project_id/sources', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Admin />)
      expect(await card('Projects and sources').findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(card('Projects and sources').queryByText('No sources.')).not.toBeInTheDocument()
      expect(item('proj-internal').getByRole('button', { name: 'Add source' })).toBeInTheDocument()

      mockAdmin({ sources: { 'proj-clearpath': [source()], 'proj-internal': [] } })
      await user.click(card('Projects and sources').getByRole('button', { name: 'Try again' }))
      expect(await item('proj-clearpath').findByText('documents · ClearPath documents')).toBeInTheDocument()
      expect(item('proj-internal').getByText('No sources.')).toBeInTheDocument()
      expect(card('Projects and sources').queryByText('Could not load this. database is locked')).not.toBeInTheDocument()
    })

    it('Add source opens the dialog for that project, and closing it leaves the page as it was', async () => {
      const { user } = await open()
      api.get('/projects/:project_id/mail', (req) => projectMail({ project_id: req.params.project_id }))
      await user.click(item('proj-internal').getByRole('button', { name: 'Add source' }))

      const dialog = within(await screen.findByRole('dialog'))
      expect(dialog.getByRole('heading', { name: 'Add source' })).toBeInTheDocument()
      expect(dialog.getByText('Internal · step 1 of 3')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/mail').map((c) => c.params.project_id)).toEqual(['proj-internal']))
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/sources')).toHaveLength(3))

      await user.click(dialog.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('creates a project with a description, says so, empties the form and refreshes', async () => {
      api.post('/projects', project({ id: 'proj-pilot', name: 'Pilot' }))
      const { user, app } = await open()
      expect(create()).toBeDisabled()
      await user.type(screen.getByLabelText('Project name'), '  Pilot ')
      await user.type(screen.getByLabelText('Description (optional)'), ' Twelve consultants. ')
      await user.click(create())

      expect(await toastText('Project created.')).toBeInTheDocument()
      expect(api.last('POST', '/projects')!.body).toEqual({ name: 'Pilot', description: 'Twelve consultants.' })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      expect(screen.getByLabelText('Project name')).toHaveValue('')
      expect(screen.getByLabelText('Description (optional)')).toHaveValue('')
      await waitFor(() => expect(create()).toBeDisabled())
      expect(api.unhandled).toEqual([])
    })

    it('sends no description when the field is empty', async () => {
      api.post('/projects', project({ id: 'proj-pilot', name: 'Pilot' }))
      const { user } = await open()
      await user.type(screen.getByLabelText('Project name'), 'Pilot')
      await user.type(screen.getByLabelText('Description (optional)'), '   ')
      await user.click(create())
      expect(await toastText('Project created.')).toBeInTheDocument()
      expect(api.last('POST', '/projects')!.body).toEqual({ name: 'Pilot', description: null })
    })

    it('cannot be created without a name, or twice while it is being created', async () => {
      const gate = deferred()
      api.post('/projects', () => gate.promise)
      const { user } = await open()
      await user.type(screen.getByLabelText('Project name'), '   ')
      expect(create()).toBeDisabled()
      await user.click(create())
      expect(api.callsTo('POST', '/projects')).toHaveLength(0)

      await user.type(screen.getByLabelText('Project name'), 'Pilot')
      expect(create()).toBeEnabled()
      await user.click(create())
      expect(create()).toBeDisabled()
      await user.click(create())
      expect(api.callsTo('POST', '/projects')).toHaveLength(1)

      gate.resolve(project({ id: 'proj-pilot', name: 'Pilot' }))
      await toastText('Project created.')
    })

    it('says why when the project cannot be created, and keeps the form', async () => {
      api.post('/projects', fail(409, 'A project with this name exists'))
      const { user, app } = await open()
      await user.type(screen.getByLabelText('Project name'), 'Internal')
      await user.type(screen.getByLabelText('Description (optional)'), 'Again')
      await user.click(create())

      expect(await toastText('That did not work. A project with this name exists')).toBeInTheDocument()
      expect(screen.getByLabelText('Project name')).toHaveValue('Internal')
      expect(screen.getByLabelText('Description (optional)')).toHaveValue('Again')
      await waitFor(() => expect(create()).toBeEnabled())
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.queryByText('Project created.')).not.toBeInTheDocument()
    })
  })

  describe('recent audit', () => {
    const EVENTS = [
      auditEvent({ id: 'A-4', at: '2026-11-14T10:30:00Z', actor: 'mem-giulia', action: 'retire', fact_id: 'M-105', reason: 'Out of date' }),
      auditEvent({ id: 'A-3', at: '2026-11-14T10:00:00Z', actor: 'system', actor_role: null, action: 'ingest', fact_id: null, reason: null }),
      auditEvent({ id: 'A-2', at: '2026-11-14T09:30:00Z', actor: 'mem-sara', action: 'undo', fact_id: 'M-106', reason: 'Oops' }),
      auditEvent({ id: 'A-1', at: '2026-11-14T09:00:00Z', actor: 'system', actor_role: null, action: 'classify', fact_id: 'M-107', reason: 'Automatic' }),
      auditEvent({ id: 'A-0', at: '2026-11-14T08:00:00Z', actor: 'mem-giulia', action: 'reset', fact_id: null, reason: 'Demo reset' }),
    ]
    const rows = () => card('Recent audit').getAllByRole('listitem')
    const rowOf = (text: string) => within(card('Recent audit').getByText(text).closest('li') as HTMLElement)

    it('asks for the last eight events and shows action, reason, fact and time of each', async () => {
      await open({ audit: EVENTS })
      expect(api.last('GET', '/audit')!.query.get('limit')).toBe('8')
      expect(rows()).toHaveLength(5)
      const retire = rowOf('Out of date')
      expect(retire.getByText('retire')).toHaveClass('badge')
      expect(retire.getByRole('button', { name: 'M-105' })).toBeInTheDocument()
      expect(retire.getByText('14 Nov, 10:30')).toBeInTheDocument()
    })

    it('shows a dash for an event without reason and no fact link for an event without fact', async () => {
      await open({ audit: EVENTS })
      const ingest = within(card('Recent audit').getByText('ingest').closest('li') as HTMLElement)
      expect(ingest.getByText('—')).toBeInTheDocument()
      expect(ingest.queryByRole('button')).not.toBeInTheDocument()
    })

    it('offers Undo only on what a person did to a fact, and not on an undo', async () => {
      await open({ audit: EVENTS })
      expect(rowOf('Out of date').getByRole('button', { name: 'Undo' })).toBeEnabled()
      expect(rowOf('Oops').queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
      expect(rowOf('Automatic').queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
      expect(rowOf('Demo reset').queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
      expect(card('Recent audit').getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    })

    it('says when the log is empty', async () => {
      await open({ audit: [] })
      expect(card('Recent audit').getByText('Nothing in the audit log yet.')).toBeInTheDocument()
      expect(card('Recent audit').queryByRole('listitem')).not.toBeInTheDocument()
    })

    it('shows the error instead of "nothing in the log" when the log cannot be loaded, and loads it again on retry', async () => {
      mockAdmin()
      api.get('/audit', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Admin />)
      expect(await card('Recent audit').findByText('Could not load this. database is locked')).toBeInTheDocument()
      expect(card('Recent audit').queryByText('Nothing in the audit log yet.')).not.toBeInTheDocument()

      api.get('/audit', EVENTS)
      await user.click(card('Recent audit').getByRole('button', { name: 'Try again' }))
      expect(await card('Recent audit').findByText('Out of date')).toBeInTheDocument()
      expect(card('Recent audit').queryByText('Could not load this. database is locked')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/audit')).toHaveLength(2)
    })

    it('shows a placeholder while the log loads', async () => {
      mockAdmin()
      const gate = deferred()
      api.get('/audit', () => gate.promise)
      renderWithApp(<Admin />)
      await screen.findByText(/^Provider/)
      const audit = screen.getByRole('heading', { level: 2, name: 'Recent audit' }).closest('.card')!
      expect(audit.querySelector('.skel')).toBeInTheDocument()
      expect(card('Recent audit').queryByText('Nothing in the audit log yet.')).not.toBeInTheDocument()

      gate.resolve(EVENTS)
      expect(await card('Recent audit').findByText('Out of date')).toBeInTheDocument()
      expect(audit.querySelector('.skel')).not.toBeInTheDocument()
    })

    it('opens the fact drawer from the fact id', async () => {
      const { user, app } = await open({ audit: EVENTS })
      await user.click(rowOf('Out of date').getByRole('button', { name: 'M-105' }))
      expect(app.openFact).toHaveBeenCalledWith('M-105')
    })

    it('undoes an event as the current person, says so and refreshes', async () => {
      const gate = deferred()
      api.post('/audit/:event_id/undo', () => gate.promise)
      const { user, app } = await open({ audit: EVENTS })
      const undo = rowOf('Out of date').getByRole('button', { name: 'Undo' })
      await user.click(undo)
      expect(undo).toBeDisabled()

      gate.resolve({})
      expect(await toastText('Undone.')).toBeInTheDocument()
      const sent = api.last('POST', '/audit/:event_id/undo')!
      expect(sent.params.event_id).toBe('A-4')
      expect(sent.body).toEqual({ actor: 'Giulia', reason: 'Undone from demo control.' })
      await waitFor(() => expect(app.refresh).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(undo).toBeEnabled())
      expect(api.unhandled).toEqual([])
    })

    it('says why when the undo is refused, without refreshing', async () => {
      api.post('/audit/:event_id/undo', fail(409, 'Already undone'))
      const { user, app } = await open({ audit: EVENTS })
      await user.click(rowOf('Out of date').getByRole('button', { name: 'Undo' }))

      expect(await toastText('That did not work. Already undone')).toBeInTheDocument()
      await waitFor(() => expect(rowOf('Out of date').getByRole('button', { name: 'Undo' })).toBeEnabled())
      expect(app.refresh).not.toHaveBeenCalled()
      expect(screen.queryByText('Undone.')).not.toBeInTheDocument()
    })
  })

  describe('current identity', () => {
    it('shows who the backend says you are, with role, id and permissions', async () => {
      await open({ me: me() })
      const who = card('Current identity')
      expect(who.getByText('Giulia Ferri')).toBeInTheDocument()
      expect(who.getByText('Giulia Ferri').parentElement).toHaveTextContent('Giulia Ferri · owner mem-giulia')
      expect(PERMISSIONS.owner.map((p) => who.getByText(p)).every((el) => el.classList.contains('tag'))).toBe(true)
      expect(who.getAllByText(/^[a-z_]+$/, { selector: '.tag' })).toHaveLength(PERMISSIONS.owner.length)
    })

    it('shows the answer of the backend rather than what the app remembers', async () => {
      const fresh = me({ as: MEMBERS.giulia, role: 'owner', permissions: ['ask', 'admin_demo'] })
      await open({ me: { ...fresh, member: { ...MEMBERS.giulia, name: 'Giulia Ferri Rossi' } } })
      const who = card('Current identity')
      expect(await who.findByText('Giulia Ferri Rossi')).toBeInTheDocument()
      expect(who.getAllByText(/^[a-z_]+$/, { selector: '.tag' }).map((x) => x.textContent)).toEqual(['ask', 'admin_demo'])
    })

    it('falls back to what the app knows when the backend does not answer', async () => {
      mockAdmin()
      api.get('/me', fail(500, 'database is locked'))
      renderWithApp(<Admin />)
      await screen.findByText(/^Provider/)
      await waitFor(() => expect(api.callsTo('GET', '/me')).toHaveLength(1))
      const who = card('Current identity')
      expect(who.getByText('Giulia Ferri').parentElement).toHaveTextContent('Giulia Ferri · owner mem-giulia')
      expect(who.getByText('admin_demo')).toBeInTheDocument()
    })
  })

  describe('quick search', () => {
    const input = () => screen.getByLabelText('Quick search')
    const button = () => card('Current identity').getByRole('button', { name: 'Search' })
    const hits = () => card('Current identity').getAllByRole('listitem')

    it('cannot be run without a query', async () => {
      api.get('/search', { query: '', total: 0, results: [] })
      const { user } = await open()
      expect(input()).toHaveAttribute('placeholder', 'Search facts and documents')
      expect(button()).toBeDisabled()
      await user.type(input(), '   {Enter}')
      expect(button()).toBeDisabled()
      expect(api.callsTo('GET', '/search')).toHaveLength(0)
    })

    it('searches the current project and lists facts and documents', async () => {
      api.get('/search', {
        query: 'onboarding',
        total: 2,
        results: [searchResult({ kind: 'fact', id: 'M-106', snippet: 'Onboarding target is 3–4 weeks.' }), searchResult({ kind: 'document', id: '01-scope/project-brief', snippet: 'Project brief, onboarding.' })],
      })
      const { user, app } = await open()
      await user.type(input(), '  onboarding ')
      await user.click(button())

      expect(await card('Current identity').findByText('Onboarding target is 3–4 weeks.')).toBeInTheDocument()
      const sent = api.last('GET', '/search')!
      expect(sent.query.get('q')).toBe('onboarding')
      expect(sent.query.get('project_id')).toBe('proj-clearpath')
      expect(hits().map((li) => li.textContent)).toEqual(['M-106Onboarding target is 3–4 weeks.', '01-scope/project-briefProject brief, onboarding.'])
      expect(within(hits()[0]).getByRole('button', { name: 'M-106' })).toBeInTheDocument()
      expect(within(hits()[1]).queryByRole('button')).not.toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      await waitFor(() => expect(button()).toBeEnabled())
      expect(api.unhandled).toEqual([])
    })

    it('searches the whole organisation in organisation scope, and on Enter', async () => {
      api.get('/search', { query: 'pilot', total: 0, results: [] })
      const { user } = await open({}, { scope: 'org' })
      await user.type(input(), 'pilot{Enter}')

      expect(await card('Current identity').findByText('No results.')).toBeInTheDocument()
      const sent = api.last('GET', '/search')!
      expect(sent.query.get('q')).toBe('pilot')
      expect(sent.query.has('project_id')).toBe(false)
      expect(card('Current identity').queryByRole('listitem')).not.toBeInTheDocument()
    })

    it('opens the fact drawer from a fact', async () => {
      api.get('/search', { query: 'x', total: 1, results: [searchResult({ id: 'M-204' })] })
      const { user, app } = await open()
      await user.type(input(), 'x{Enter}')
      await user.click(await card('Current identity').findByRole('button', { name: 'M-204' }))
      expect(app.openFact).toHaveBeenCalledWith('M-204')
    })

    it('shows the first six results only', async () => {
      const results = Array.from({ length: 9 }, (_, i) => searchResult({ id: `M-${700 + i}`, snippet: `Result ${i + 1}` }))
      api.get('/search', { query: 'x', total: 9, results })
      const { user } = await open()
      await user.type(input(), 'x{Enter}')
      await card('Current identity').findByText('Result 1')
      expect(hits()).toHaveLength(6)
      expect(card('Current identity').getByText('Result 6')).toBeInTheDocument()
      expect(card('Current identity').queryByText('Result 7')).not.toBeInTheDocument()
    })

    it('is busy while the search runs', async () => {
      const gate = deferred()
      api.get('/search', () => gate.promise)
      const { user } = await open()
      await user.type(input(), 'x')
      await user.click(button())
      expect(button()).toBeDisabled()

      gate.resolve({ query: 'x', total: 0, results: [] })
      expect(await card('Current identity').findByText('No results.')).toBeInTheDocument()
      expect(button()).toBeEnabled()
    })

    it('says why when the search fails and keeps the previous results', async () => {
      api.get('/search', { query: 'x', total: 1, results: [searchResult({ id: 'M-204', snippet: 'Kept' })] })
      const { user } = await open()
      await user.type(input(), 'x{Enter}')
      await card('Current identity').findByText('Kept')

      api.get('/search', fail(400, 'Query too short'))
      await user.type(input(), 'y{Enter}')
      expect(await toastText('That did not work. Query too short')).toBeInTheDocument()
      expect(card('Current identity').getByText('Kept')).toBeInTheDocument()
      await waitFor(() => expect(button()).toBeEnabled())
    })
  })

  describe('with other projects', () => {
    it('asks for the sources of each project, and of none when there is no project', async () => {
      mockAdmin()
      renderWithApp(<Admin />, { projects: [] })
      await screen.findByText(/^Provider/)
      await waitFor(() => expect(api.callsTo('GET', '/me')).toHaveLength(1))
      expect(api.callsTo('GET', '/projects/:project_id/sources')).toHaveLength(0)
      expect(card('Projects and sources').queryByRole('listitem')).not.toBeInTheDocument()
      expect(card('GitHub').getByText(/No GitHub source/)).toBeInTheDocument()
    })

    it('reads the sources again when a project is added', async () => {
      mockAdmin()
      const { rerender } = renderI18n(
        <AppContext.Provider value={makeApp()}>
          <Admin />
        </AppContext.Provider>,
      )
      await card('Projects and sources').findByText('proj-internal')

      rerender(
        <AppContext.Provider value={makeApp({ projects: [...PROJECTS, project({ id: 'proj-pilot', name: 'Pilot' })] })}>
          <Admin />
        </AppContext.Provider>,
      )
      expect(await card('Projects and sources').findByText('proj-pilot')).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/sources').filter((c) => c.params.project_id === 'proj-pilot')).toHaveLength(1))
      await waitFor(() => expect(card('Projects and sources').getByText('proj-pilot').closest('li')).toHaveTextContent('documents · ClearPath documents'))
    })
  })
})
