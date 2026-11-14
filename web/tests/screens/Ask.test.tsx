import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Ask from '../../src/screens/Ask'
import { api, deferred, fail, offline } from '../helpers/api'
import { askResponse, AUDIT, auditChain, chain, chainFact, contestedResponse, noAnswerResponse, ONBOARDING, QUESTION, QUESTION_2, retiredPreview, type AskResponse, type ChainFact } from '../helpers/ask'
import { me, MEMBERS } from '../helpers/fixtures'
import { mockShell, renderWithApp, renderWithProviders } from '../helpers/render'

const DEFAULT_REASON = 'The final report sets 3–4 weeks. The 4-week figure was a verbal preview.'
const STEPS = ['Last Monday', 'What the AI believes', 'Retire the old figure', 'Today', 'Contested', 'New email', 'New version']

/** The figure the client confirms by email on step 6: it replaces the final report. */
const EMAIL = chainFact({
  id: 'E-301',
  value: '5 weeks',
  doc_id: 'mail/msg-301',
  doc_title: 'Email: Onboarding target confirmed',
  date: '2026-11-14',
  quote: 'Following our call, we confirm the onboarding target at 5 weeks.',
  supersedes: 'M-106',
})

/**
 * What the fake backend remembers. The routes below read it, so the chain and the answers change when the
 * screen retires, restores, sends the email or resets, like the real backend.
 */
type World = { retired: boolean; email: boolean; extra: ChainFact[] }
let world: World

function onboarding() {
  const preview = world.retired ? retiredPreview() : ONBOARDING.preview
  const report: ChainFact = world.email ? { ...ONBOARDING.report, type: 'SUPERSEDED', superseded_by: 'E-301' } : ONBOARDING.report
  return chain({ facts: [...world.extra, ONBOARDING.brief, ONBOARDING.kickoff, preview, report, ...(world.email ? [EMAIL] : [])] })
}

function answer(question: string): AskResponse {
  if (question === QUESTION_2) return contestedResponse()
  if (world.email) return askResponse({ question, answer: 'Five weeks. The client confirmed it by email.', binding: EMAIL, changed_because: 'a new email from the client set 5 weeks' })
  return askResponse({ question, changed_because: world.retired ? 'Giulia retired the 4-week figure.' : null })
}

beforeEach(() => {
  world = { retired: false, email: false, extra: [] }
  api.get('/topics/:topic_id/chain', (req) => (req.params.topic_id === 'audit-turnaround' ? auditChain() : onboarding()))
  api.post('/ask', (req) => answer((req.body as { question: string }).question))
  api.post('/facts/:fact_id/retire', () => {
    world.retired = true
    return retiredPreview()
  })
  api.post('/facts/:fact_id/restore', () => {
    world.retired = false
    return ONBOARDING.preview
  })
  api.post('/demo/send-email', () => {
    world.email = true
    return { message_id: 'msg-301', routed_project_id: 'proj-clearpath', document_id: 'mail/msg-301', facts_created: ['E-301'], supersedes_created: [{ fact_id: 'E-301', supersedes: 'M-106' }] }
  })
  api.post('/documents/:doc_id/versions', { version: { document_id: 'library/onboarding-standard', version: 2 }, facts_created: [], supersedes_created: [] })
  api.post('/demo/reset', () => {
    world = { retired: false, email: false, extra: [] }
    return {}
  })
})

const bar = () => within(screen.getByText('Demo').parentElement!)
const chat = () => within(screen.getByRole('region', { name: 'Chat' }))
const panel = () => within(screen.getByRole('complementary', { name: 'What the AI believes' }))
const composer = () => screen.getByRole('textbox', { name: 'Question' })
const next = (name: string) => bar().getByRole('button', { name })
const stepMark = (n: number) => screen.getByLabelText(`Step ${n}: ${STEPS[n - 1]}`)
const onStep = (n: number) => expect(stepMark(n)).toHaveAttribute('aria-current', 'step')
const asks = () => api.callsTo('POST', '/ask')
const posts = () => api.calls.filter((c) => c.method === 'POST').map((c) => c.path)
/** The top bar is idle again: the request behind the last step has been answered. */
const settled = (name: string) => waitFor(() => expect(next(name)).toBeEnabled())

/** Renders the screen and waits for the topic chain (the old fact gets its citation). */
async function start(over: Parameters<typeof renderWithApp>[1] = {}) {
  const view = renderWithApp(<Ask />, over)
  await screen.findByRole('button', { name: 'final presentation' })
  return view
}

const toStep2 = (user: UserEvent) => user.click(next('Open memory'))
async function toStep3(user: UserEvent) {
  await toStep2(user)
  await user.click(next('Retire “4 weeks”'))
}
/** Through the retirement when the old figure is still active, straight to the question when it is already retired. */
async function toStep4(user: UserEvent) {
  if (world.retired) {
    await toStep2(user)
    await user.click(next('Ask again'))
  } else {
    await toStep3(user)
    await user.click(next('Confirm retire'))
  }
  await chat().findByText('Three to four weeks.')
  await settled('Next question')
}
async function toStep5(user: UserEvent) {
  await toStep4(user)
  await user.click(next('Next question'))
  await chat().findByText('No single binding value')
}
async function toStep6(user: UserEvent) {
  await toStep5(user)
  await user.click(next('Send demo email'))
  await chat().findByText('Five weeks.')
  await settled('Upload new version')
}
async function toStep7(user: UserEvent) {
  await toStep6(user)
  await user.click(next('Upload new version'))
  await waitFor(() => expect(chat().getAllByText('Five weeks.')).toHaveLength(2))
  await settled('Restart')
}

describe('Ask', () => {
  describe('at the start', () => {
    it('replays last Monday: the question, the wrong answer and the old fact it came from', async () => {
      const { user, app } = await start()
      expect(chat().getByText('Last Monday')).toBeInTheDocument()
      expect(chat().getByText(QUESTION)).toBeInTheDocument()
      expect(chat().getAllByText('Mon 09:12')).toHaveLength(2)
      expect(chat().getByText('Four weeks.')).toHaveClass('strike')
      expect(chat().getByText('20 Nov 2025')).toBeInTheDocument()

      await user.click(chat().getByRole('button', { name: 'final presentation' }))
      expect(app.openFact).toHaveBeenCalledWith('M-105')
    })

    it('loads the onboarding topic and asks nothing', async () => {
      await start()
      expect(api.callsTo('GET', '/topics/:topic_id/chain').map((c) => c.params.topic_id)).toEqual(['onboarding-target'])
      expect(posts()).toEqual([])
      expect(chat().queryByText('Today')).not.toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('is on step 1 of 7, with the memory still closed', async () => {
      await start()
      onStep(1)
      for (let n = 2; n <= 7; n++) expect(stepMark(n)).not.toHaveAttribute('aria-current')
      expect(within(stepMark(1)).getByText('1')).toHaveClass('on')
      expect(within(stepMark(2)).getByText('2')).not.toHaveClass('on')
      expect(within(stepMark(2)).getByText('2')).not.toHaveClass('done')
      expect(within(stepMark(1)).getByText('Last Monday')).toBeInTheDocument()
      expect(within(stepMark(2)).queryByText('What the AI believes')).not.toBeInTheDocument()
      expect(stepMark(3)).toHaveAttribute('data-tip', '3. Retire the old figure')
      expect(screen.getByText('Last Monday the company assistant answered four weeks. It came from the final presentation, which was already out of date.')).toBeInTheDocument()
      expect(next('Open memory')).toBeEnabled()
      expect(bar().queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()
      expect(panel().queryByText('3–4 weeks')).not.toBeInTheDocument()
    })

    it('puts the demo question in the composer and names the project it asks', async () => {
      await start()
      expect(composer()).toHaveValue(QUESTION)
      expect(composer()).toHaveAttribute('placeholder', 'Ask the company brain…')
      expect(screen.getByText('Asking')).toHaveTextContent('Asking ClearPath engagement')
      expect(screen.getByText('Answers cite the binding fact and its verbatim source.')).toBeInTheDocument()
    })

    it('names the whole organisation in organisation scope', async () => {
      await start({ scope: 'org' })
      expect(screen.getByText('Asking')).toHaveTextContent('Asking Whole organisation')
    })

    it('leaves the wrong answer without a source when the topic does not hold the old fact', async () => {
      api.get('/topics/:topic_id/chain', chain({ facts: [ONBOARDING.report] }))
      const { user } = renderWithApp(<Ask />)
      await toStep2(user)
      await panel().findByRole('button', { name: /from the final report/ })
      expect(chat().getByText('Four weeks.')).toBeInTheDocument()
      expect(chat().queryByRole('button', { name: 'final presentation' })).not.toBeInTheDocument()
    })
  })

  describe('opening the memory', () => {
    it('moves to step 2 and shows what the AI believes', async () => {
      const { user } = await start()
      await toStep2(user)

      onStep(2)
      expect(within(stepMark(1)).getByText('1')).toHaveClass('done')
      expect(within(stepMark(2)).getByText('2')).toHaveClass('on')
      expect(screen.getByText('The memory shows the binding fact, the versions it replaced, and one old version that is still active.')).toBeInTheDocument()
      expect(panel().getByText('Onboarding target · ClearPath engagement')).toBeInTheDocument()
      expect(within(panel().getByRole('button', { name: /from the final report/ })).getByText('3–4 weeks')).toBeInTheDocument()
      expect(panel().getByText('still active')).toBeInTheDocument()
      expect(panel().queryByText('The memory behind every answer')).not.toBeInTheDocument()
      expect(next('Retire “4 weeks”')).toBeEnabled()
      expect(bar().getByRole('button', { name: 'Back' })).toBeEnabled()
      expect(posts()).toEqual([])
    })

    it('opens from the button of the panel too', async () => {
      const { user } = await start()
      await user.click(panel().getByRole('button', { name: 'Show what the AI believes' }))
      onStep(2)
      expect(panel().getByText('still active')).toBeInTheDocument()
    })

    it('closes again on Back', async () => {
      const { user } = await start()
      await toStep2(user)
      await user.click(bar().getByRole('button', { name: 'Back' }))

      onStep(1)
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()
      expect(bar().queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      expect(next('Open memory')).toBeInTheDocument()
    })

    it('says why when the topic could not be loaded', async () => {
      api.get('/topics/:topic_id/chain', fail(500, 'database is locked'))
      const { user } = renderWithApp(<Ask />)
      await toStep2(user)
      expect(await panel().findByText('The memory for this topic could not be loaded. database is locked')).toBeInTheDocument()
      expect(chat().queryByRole('button', { name: 'final presentation' })).not.toBeInTheDocument()
    })

    it('shows the fact opened from the panel in the drawer', async () => {
      const { user, app } = await start()
      await toStep2(user)
      await user.click(panel().getByRole('button', { name: /from the final report/ }))
      expect(app.openFact).toHaveBeenCalledWith('M-106')
    })
  })

  describe('retiring the old figure', () => {
    it('opens the retire form with the suggested reason on step 3', async () => {
      const { user } = await start()
      await toStep3(user)

      onStep(3)
      expect(panel().getByLabelText('Reason')).toHaveValue(DEFAULT_REASON)
      expect(next('Confirm retire')).toBeEnabled()
      expect(screen.getByText('Giulia retires the old figure with a reason. Nothing is deleted: it is kept in history, marked as retired.')).toBeInTheDocument()
      expect(posts()).toEqual([])
    })

    it('moves to step 3 when the form is opened from the panel', async () => {
      const { user } = await start()
      await toStep2(user)
      await user.click(panel().getByRole('button', { name: 'Retire' }))
      onStep(3)
      expect(panel().getByLabelText('Reason')).toHaveValue(DEFAULT_REASON)
    })

    it('goes back to step 2 on Cancel and on Back', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.click(panel().getByRole('button', { name: 'Cancel' }))
      onStep(2)
      expect(panel().queryByLabelText('Reason')).not.toBeInTheDocument()

      await user.click(next('Retire “4 weeks”'))
      onStep(3)
      await user.click(bar().getByRole('button', { name: 'Back' }))
      onStep(2)
      expect(panel().queryByLabelText('Reason')).not.toBeInTheDocument()
      expect(posts()).toEqual([])
    })

    it('a viewer sees the step greyed out and a click only explains why', async () => {
      const { user } = await start({ me: me({ as: MEMBERS.luca }) })
      await toStep2(user)
      const retire = next('Retire “4 weeks”')
      expect(retire).toHaveAttribute('aria-disabled', 'true')
      expect(retire).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(retire)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      onStep(2)
      expect(panel().queryByLabelText('Reason')).not.toBeInTheDocument()
    })

    it('records the answer as it stands, retires the fact, then asks again on step 4', async () => {
      const { user, app } = await start()
      await toStep3(user)
      await user.click(next('Confirm retire'))

      expect(await screen.findByText('Retired 4 weeks. The next answer will not use it.')).toBeInTheDocument()
      await chat().findByText('Three to four weeks.')
      await settled('Next question')

      expect(posts()).toEqual(['/ask', '/facts/M-105/retire', '/ask'])
      expect(asks()[0].body).toEqual({ question: QUESTION, project_id: 'proj-clearpath', include_plain_retrieval: false })
      expect(api.last('POST', '/facts/:fact_id/retire')!.body).toEqual({ reason: DEFAULT_REASON, actor: 'Giulia' })
      expect(asks()[1].body).toEqual({ question: QUESTION, project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(app.refresh).toHaveBeenCalled()

      onStep(4)
      expect(screen.getByText('Same question today. The answer comes from the final report, and nobody had to open a ticket.')).toBeInTheDocument()
      expect(chat().getByText('Today')).toBeInTheDocument()
      expect(chat().getAllByText(QUESTION)).toHaveLength(2)
      expect(chat().getByText('Changed because Giulia retired the 4-week figure.')).toBeInTheDocument()
      expect(chat().getByRole('button', { name: 'final report' })).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('shows the fact as retired in the panel afterwards', async () => {
      const { user } = await start()
      await toStep4(user)
      expect(panel().queryByLabelText('Reason')).not.toBeInTheDocument()
      expect(panel().queryByText('still active')).not.toBeInTheDocument()
      expect(panel().getByText('retired by Giulia · today')).toBeInTheDocument()
      expect(panel().getByRole('button', { name: 'Restore' })).toBeEnabled()
      expect(api.callsTo('GET', '/topics/:topic_id/chain')).toHaveLength(2)
    })

    it('retires from the Confirm button of the panel as well', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.click(panel().getByRole('button', { name: 'Confirm retire' }))
      await chat().findByText('Three to four weeks.')
      await settled('Next question')
      expect(posts()).toEqual(['/ask', '/facts/M-105/retire', '/ask'])
      onStep(4)
    })

    it('sends the reason the person wrote, trimmed', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.clear(panel().getByLabelText('Reason'))
      await user.type(panel().getByLabelText('Reason'), '  The report is the source of truth  ')
      await user.click(next('Confirm retire'))
      await settled('Next question')
      expect(api.last('POST', '/facts/:fact_id/retire')!.body).toEqual({ reason: 'The report is the source of truth', actor: 'Giulia' })
    })

    it('sends the actor id when the person has no display name', async () => {
      const { user } = await start({ actorName: '', actor: 'mem-giulia' })
      await toStep3(user)
      await user.click(next('Confirm retire'))
      await settled('Next question')
      expect(api.last('POST', '/facts/:fact_id/retire')!.body).toEqual({ reason: DEFAULT_REASON, actor: 'mem-giulia' })
    })

    it('asks the whole organisation in organisation scope', async () => {
      const { user } = await start({ scope: 'org' })
      await toStep3(user)
      await user.click(next('Confirm retire'))
      await settled('Next question')
      expect(asks()).toHaveLength(2)
      for (const call of asks()) expect(call.body).not.toHaveProperty('project_id')
    })

    it('asks for a reason before sending anything', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.clear(panel().getByLabelText('Reason'))
      await user.click(next('Confirm retire'))

      expect(panel().getByText('Add a reason so the next person knows why.')).toBeInTheDocument()
      expect(panel().getByLabelText('Reason')).toHaveClass('invalid')
      onStep(3)
      expect(posts()).toEqual([])

      await user.type(panel().getByLabelText('Reason'), '   ')
      expect(panel().queryByText('Add a reason so the next person knows why.')).not.toBeInTheDocument()
      await user.click(panel().getByRole('button', { name: 'Confirm retire' }))
      expect(panel().getByText('Add a reason so the next person knows why.')).toBeInTheDocument()
      expect(posts()).toEqual([])
    })

    it('says why when the backend refuses, and keeps the form open', async () => {
      api.post('/facts/:fact_id/retire', fail(403, 'Requires editor role'))
      const { user, app } = await start()
      await toStep3(user)
      await user.click(next('Confirm retire'))

      expect(await screen.findByText('That did not work. Requires editor role')).toBeInTheDocument()
      await settled('Confirm retire')
      onStep(3)
      expect(panel().getByLabelText('Reason')).toHaveValue(DEFAULT_REASON)
      expect(panel().getByText('still active')).toBeInTheDocument()
      expect(posts()).toEqual(['/ask', '/facts/M-105/retire'])
      expect(app.refresh).not.toHaveBeenCalled()
      expect(chat().queryByText('Today')).not.toBeInTheDocument()
    })

    it('retires even when the answer could not be recorded, and shows the failed question in the chat', async () => {
      api.post('/ask', fail(503, 'The model is not reachable'))
      const { user } = await start()
      await toStep3(user)
      await user.click(next('Confirm retire'))

      expect(await screen.findByText('Retired 4 weeks. The next answer will not use it.')).toBeInTheDocument()
      expect(await chat().findByText('The question could not be answered. The model is not reachable')).toBeInTheDocument()
      expect(posts()).toEqual(['/ask', '/facts/M-105/retire', '/ask'])
      onStep(4)
      expect(chat().queryByText('Looking in memory…')).not.toBeInTheDocument()
    })

    it('locks the screen while the retirement is sent', async () => {
      const gate = deferred()
      api.post('/facts/:fact_id/retire', () => gate.promise)
      const { user } = await start()
      await toStep3(user)
      await user.click(next('Confirm retire'))

      await waitFor(() => expect(api.callsTo('POST', '/facts/:fact_id/retire')).toHaveLength(1))
      expect(next('Confirm retire')).toBeDisabled()
      expect(next('Confirm retire').querySelector('.spin')).toBeInTheDocument()
      expect(bar().getByRole('button', { name: 'Back' })).toBeDisabled()
      expect(bar().getByRole('button', { name: 'Restart' })).toBeDisabled()
      expect(panel().getByRole('button', { name: 'Confirm retire' })).toBeDisabled()
      expect(panel().getByRole('button', { name: 'Cancel' })).toBeDisabled()

      // The arrow keys are locked too.
      await user.keyboard('{ArrowRight}{ArrowLeft}')
      onStep(3)
      expect(panel().getByLabelText('Reason')).toBeInTheDocument()

      world.retired = true
      gate.resolve(retiredPreview())
      await settled('Next question')
      expect(next('Next question').querySelector('.spin')).not.toBeInTheDocument()
      expect(api.callsTo('POST', '/facts/:fact_id/retire')).toHaveLength(1)
    })

    it('steps back without retiring when the panel moved to another topic', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.clear(composer())
      await user.type(composer(), QUESTION_2 + '{Enter}')
      await panel().findByText('no binding value')

      await user.click(next('Confirm retire'))
      onStep(2)
      expect(api.callsTo('POST', '/facts/:fact_id/retire')).toHaveLength(0)
    })

    it('offers to ask again, not to retire, while the panel shows another topic', async () => {
      const { user } = await start()
      await toStep2(user)
      await user.clear(composer())
      await user.type(composer(), QUESTION_2 + '{Enter}')
      await panel().findByText('no binding value')
      expect(bar().queryByRole('button', { name: /^Retire/ })).not.toBeInTheDocument()

      await user.click(next('Ask again'))
      expect(await chat().findByText('Three to four weeks.')).toBeInTheDocument()
      onStep(4)
      expect(composer()).toHaveValue(QUESTION)
      expect(api.callsTo('POST', '/facts/:fact_id/retire')).toHaveLength(0)
      expect(await panel().findByText('still active')).toBeInTheDocument()
    })

    it('does not ask again or move the step when a fact is retired later in the demo', async () => {
      world.retired = true
      const { user } = await start()
      await toStep6(user)
      await user.click(panel().getByRole('button', { name: 'Restore' }))
      await user.click(await panel().findByRole('button', { name: 'Retire' }))
      onStep(6)
      const before = asks().length

      await user.click(panel().getByRole('button', { name: 'Confirm retire' }))
      expect(await screen.findByText('Retired 4 weeks. The next answer will not use it.')).toBeInTheDocument()
      expect(await panel().findByText('retired by Giulia · today')).toBeInTheDocument()
      await settled('Upload new version')
      onStep(6)
      expect(asks()).toHaveLength(before)
    })
  })

  describe('when nothing is left to retire', () => {
    beforeEach(() => {
      world.retired = true
    })

    it('offers to ask again and goes straight to step 4', async () => {
      const { user, app } = await start()
      await toStep2(user)
      expect(bar().queryByRole('button', { name: /^Retire/ })).not.toBeInTheDocument()

      await user.click(next('Ask again'))
      expect(await chat().findByText('Three to four weeks.')).toBeInTheDocument()
      onStep(4)
      expect(posts()).toEqual(['/ask'])
      expect(asks()[0].body).toEqual({ question: QUESTION, project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(app.refresh).toHaveBeenCalled()
    })

    it('lets a viewer ask again', async () => {
      const { user } = await start({ me: me({ as: MEMBERS.luca }) })
      await toStep2(user)
      expect(next('Ask again')).not.toHaveAttribute('aria-disabled')
      await user.click(next('Ask again'))
      expect(await chat().findByText('Three to four weeks.')).toBeInTheDocument()
      onStep(4)
    })
  })

  describe('going back from step 4', () => {
    it('restores the retired fact, clears the chat of today and returns to step 2', async () => {
      const { user, app } = await start()
      await toStep4(user)
      vi.mocked(app.refresh).mockClear()
      await user.click(bar().getByRole('button', { name: 'Back' }))

      expect(await screen.findByText('Restored 4 weeks.')).toBeInTheDocument()
      expect(await panel().findByText('still active')).toBeInTheDocument()
      const sent = api.last('POST', '/facts/:fact_id/restore')!
      expect(sent.params.fact_id).toBe('M-105')
      expect(sent.body).toEqual({ actor: 'Giulia' })
      onStep(2)
      expect(chat().queryByText('Today')).not.toBeInTheDocument()
      expect(chat().queryByText('Three to four weeks.')).not.toBeInTheDocument()
      expect(chat().getAllByText(QUESTION)).toHaveLength(1)
      expect(chat().getByText('Four weeks.')).toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      await settled('Retire “4 weeks”')
    })

    it('starts today again after the chat was cleared', async () => {
      const { user } = await start()
      await toStep4(user)
      await user.click(bar().getByRole('button', { name: 'Back' }))
      await panel().findByText('still active')
      await settled('Retire “4 weeks”')

      await user.click(next('Retire “4 weeks”'))
      await user.click(next('Confirm retire'))
      await chat().findByText('Three to four weeks.')
      expect(chat().getAllByText('Today')).toHaveLength(1)
      expect(chat().getAllByText('Three to four weeks.')).toHaveLength(1)
    })

    it('restores the last retired fact when the demo one is not among them', async () => {
      api.get(
        '/topics/:topic_id/chain',
        chain({ facts: [{ ...ONBOARDING.brief, status: 'retired' }, { ...ONBOARDING.kickoff, status: 'retired' }, ONBOARDING.report] }),
      )
      const { user } = renderWithApp(<Ask />)
      await toStep2(user)
      await user.click(await bar().findByRole('button', { name: 'Ask again' }))
      await chat().findByText('Three to four weeks.')
      await user.click(bar().getByRole('button', { name: 'Back' }))

      expect(await screen.findByText('Restored 5 weeks.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/facts/:fact_id/restore').map((c) => c.params.fact_id)).toEqual(['M-103'])
    })

    it('only clears the chat when the topic has no retired fact', async () => {
      api.get('/topics/:topic_id/chain', chain({ facts: [ONBOARDING.report] }))
      const { user } = renderWithApp(<Ask />)
      await toStep2(user)
      await user.click(await bar().findByRole('button', { name: 'Ask again' }))
      await chat().findByText('Three to four weeks.')
      await user.click(bar().getByRole('button', { name: 'Back' }))

      onStep(2)
      expect(chat().queryByText('Today')).not.toBeInTheDocument()
      expect(chat().queryByText('Three to four weeks.')).not.toBeInTheDocument()
      expect(posts()).toEqual(['/ask'])
    })

    it('a viewer is told that restoring needs an editor', async () => {
      world.retired = true
      const { user } = await start({ me: me({ as: MEMBERS.luca }) })
      await toStep4(user)
      await user.click(bar().getByRole('button', { name: 'Back' }))

      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      onStep(4)
      expect(chat().getByText('Three to four weeks.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/facts/:fact_id/restore')).toHaveLength(0)
    })

    it('says why when the restore fails, and stays on step 4', async () => {
      api.post('/facts/:fact_id/restore', fail(409, 'Already active'))
      const { user } = await start()
      await toStep4(user)
      await user.click(bar().getByRole('button', { name: 'Back' }))

      expect(await screen.findByText('That did not work. Already active')).toBeInTheDocument()
      await settled('Next question')
      onStep(4)
      expect(chat().getByText('Three to four weeks.')).toBeInTheDocument()
      expect(panel().getByText('retired by Giulia · today')).toBeInTheDocument()
    })

    it('restores as the actor id when the person has no display name', async () => {
      world.retired = true
      const { user } = await start({ actorName: '', actor: 'mem-giulia' })
      await toStep4(user)
      await user.click(panel().getByRole('button', { name: 'Restore' }))
      expect(await screen.findByText('Restored 4 weeks.')).toBeInTheDocument()
      expect(api.last('POST', '/facts/:fact_id/restore')!.body).toEqual({ actor: 'mem-giulia' })
    })

    it('restores from the panel and keeps the chat', async () => {
      const { user } = await start()
      await toStep4(user)
      await user.click(panel().getByRole('button', { name: 'Restore' }))

      expect(await screen.findByText('Restored 4 weeks.')).toBeInTheDocument()
      expect(await panel().findByText('still active')).toBeInTheDocument()
      expect(api.last('POST', '/facts/:fact_id/restore')!.body).toEqual({ actor: 'Giulia' })
      onStep(2)
      expect(chat().getByText('Today')).toBeInTheDocument()
      expect(chat().getByText('Three to four weeks.')).toBeInTheDocument()
    })
  })

  describe('the contested question', () => {
    it('asks the second question on step 5 and shows the disagreement in the chat and in the panel', async () => {
      const { user } = await start()
      await toStep4(user)
      await user.click(next('Next question'))

      expect(await chat().findByText('No single binding value')).toBeInTheDocument()
      onStep(5)
      expect(composer()).toHaveValue(QUESTION_2)
      expect(chat().getByText(QUESTION_2)).toBeInTheDocument()
      expect(asks().at(-1)!.body).toEqual({ question: QUESTION_2, project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(screen.getByText('A question with no single answer. Canonico shows the disagreement instead of picking a number.')).toBeInTheDocument()

      expect(await panel().findByText('3 different estimates and no measurement, so no version is binding.')).toBeInTheDocument()
      expect(panel().getByText('Audit turnaround · ClearPath engagement')).toBeInTheDocument()
      expect(api.last('GET', '/topics/:topic_id/chain')!.params.topic_id).toBe('audit-turnaround')
      expect(chat().getAllByText('Today')).toHaveLength(1)
      expect(next('Send demo email')).toBeEnabled()
      expect(api.unhandled).toEqual([])
    })

    it('has no way back from step 5', async () => {
      const { user } = await start()
      await toStep5(user)
      expect(bar().queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      await user.keyboard('{ArrowLeft}')
      onStep(5)
      expect(chat().getByText('No single binding value')).toBeInTheDocument()
    })
  })

  describe('the email from the client', () => {
    beforeEach(() => {
      world.retired = true
    })

    it('sends the demo email, says where it was routed and asks the first question again on step 6', async () => {
      const { user } = await start()
      await toStep5(user)
      await user.click(next('Send demo email'))

      expect(await chat().findByText('New email from the client · routed to ClearPath engagement')).toBeInTheDocument()
      expect(await chat().findByText('Five weeks.')).toBeInTheDocument()
      await settled('Upload new version')
      onStep(6)
      expect(api.callsTo('POST', '/demo/send-email')).toHaveLength(1)
      expect(api.last('POST', '/demo/send-email')!.body).toBeUndefined()
      expect(composer()).toHaveValue(QUESTION)
      expect(asks().at(-1)!.body).toEqual({ question: QUESTION, project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(chat().getByText('Changed because a new email from the client set 5 weeks.')).toBeInTheDocument()
      expect(screen.getByText('An email from the client is routed to the project by a mail rule. Its figure supersedes the current one.')).toBeInTheDocument()
      expect(api.unhandled).toEqual([])
    })

    it('shows the onboarding topic again, with the email as the binding fact cited by its title', async () => {
      const { user } = await start()
      await toStep6(user)
      expect(await panel().findByText('from the email · Onboarding target confirmed')).toBeInTheDocument()
      expect(panel().getByText('Onboarding target · ClearPath engagement')).toBeInTheDocument()
      expect(panel().queryByText('no binding value')).not.toBeInTheDocument()
      expect(await chat().findByRole('button', { name: 'email · Onboarding target confirmed' })).toBeInTheDocument()
    })

    it('names the project the email was routed to', async () => {
      api.post('/demo/send-email', { message_id: 'msg-301', routed_project_id: 'proj-internal', document_id: 'mail/msg-301', facts_created: [], supersedes_created: [] })
      const { user } = await start()
      await toStep5(user)
      await user.click(next('Send demo email'))
      expect(await chat().findByText('New email from the client · routed to Internal')).toBeInTheDocument()
    })

    it('names the current project when no rule routed the email', async () => {
      api.post('/demo/send-email', { message_id: 'msg-301', routed_project_id: null, document_id: 'mail/msg-301', facts_created: [], supersedes_created: [] })
      const { user } = await start()
      await toStep5(user)
      await user.click(next('Send demo email'))
      expect(await chat().findByText('New email from the client · routed to ClearPath engagement')).toBeInTheDocument()
    })

    it('carries on when the email was already received', async () => {
      api.post('/demo/send-email', fail(409, 'Already sent'))
      const { user } = await start()
      await toStep5(user)
      await user.click(next('Send demo email'))

      expect(await screen.findByText('The demo email was already received.')).toBeInTheDocument()
      expect(await chat().findByText('New email from the client · routed to ClearPath engagement')).toBeInTheDocument()
      await settled('Upload new version')
      onStep(6)
      expect(asks().at(-1)!.body).toMatchObject({ question: QUESTION })
      expect(screen.queryByText(/That did not work/)).not.toBeInTheDocument()
    })

    it('says why when the email cannot be sent, and stays on step 5', async () => {
      api.post('/demo/send-email', fail(500, 'mailbox is down'))
      const { user } = await start()
      await toStep5(user)
      const before = asks().length
      await user.click(next('Send demo email'))

      expect(await screen.findByText('That did not work. mailbox is down')).toBeInTheDocument()
      await settled('Send demo email')
      onStep(5)
      expect(chat().queryByText(/New email from the client/)).not.toBeInTheDocument()
      expect(asks()).toHaveLength(before)
      expect(panel().getByText('no binding value')).toBeInTheDocument()
    })

    it('locks the step while the email is sent', async () => {
      const gate = deferred()
      api.post('/demo/send-email', () => gate.promise)
      const { user } = await start()
      await toStep5(user)
      await user.click(next('Send demo email'))

      await waitFor(() => expect(next('Send demo email')).toBeDisabled())
      expect(next('Send demo email').querySelector('.spin')).toBeInTheDocument()
      expect(bar().getByRole('button', { name: 'Restart' })).toBeDisabled()

      gate.resolve({ message_id: 'msg-301', routed_project_id: 'proj-clearpath', document_id: 'mail/msg-301', facts_created: [], supersedes_created: [] })
      await settled('Upload new version')
      expect(api.callsTo('POST', '/demo/send-email')).toHaveLength(1)
    })
  })

  describe('the new version of the standard', () => {
    beforeEach(() => {
      world.retired = true
    })

    it('uploads the new version of the library document and asks again on step 7', async () => {
      const { user } = await start()
      await toStep6(user)
      const before = asks().length
      await user.click(next('Upload new version'))

      expect(await chat().findByText('Onboarding standard v2 uploaded to the document library')).toBeInTheDocument()
      await settled('Restart')
      onStep(7)
      const sent = api.last('POST', '/documents/:doc_id/versions')!
      expect(sent.params.doc_id).toBe('library/onboarding-standard')
      expect(sent.body).toEqual({ text: 'Onboarding target: 5 weeks to autonomy.' })
      expect(asks()).toHaveLength(before + 1)
      expect(asks().at(-1)!.body).toEqual({ question: QUESTION, project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(composer()).toHaveValue(QUESTION)
      expect(screen.getByText('A new version of the onboarding standard is uploaded. The previous version is superseded and the new one becomes the source.')).toBeInTheDocument()
      expect(within(stepMark(6)).getByText('6')).toHaveClass('done')
      expect(api.unhandled).toEqual([])
    })

    it('names the document by the title seen in the topic and the version the backend gave', async () => {
      world.extra = [chainFact({ id: 'L-201', value: '6 weeks', type: 'SUPERSEDED', doc_id: 'library/onboarding-standard', doc_title: 'Onboarding Standard 2025', date: '2025-06-01' })]
      api.post('/documents/:doc_id/versions', { version: { document_id: 'library/onboarding-standard', version: 4 }, facts_created: [], supersedes_created: [] })
      const { user } = await start()
      await toStep6(user)
      await user.click(next('Upload new version'))
      expect(await chat().findByText('Onboarding Standard 2025 v4 uploaded to the document library')).toBeInTheDocument()
    })

    it('says why when the upload fails, and stays on step 6', async () => {
      api.post('/documents/:doc_id/versions', fail(413, 'The document is too large'))
      const { user } = await start()
      await toStep6(user)
      const before = asks().length
      await user.click(next('Upload new version'))

      expect(await screen.findByText('That did not work. The document is too large')).toBeInTheDocument()
      await settled('Upload new version')
      onStep(6)
      expect(chat().queryByText(/uploaded to the document library/)).not.toBeInTheDocument()
      expect(asks()).toHaveLength(before)
    })
  })

  describe('restarting the demo', () => {
    it('resets the demo from the last step and starts over', async () => {
      world.retired = true
      const { user, app } = await start()
      await toStep7(user)
      expect(bar().getAllByRole('button', { name: 'Restart' })).toHaveLength(1)
      vi.mocked(app.refresh).mockClear()
      await user.click(next('Restart'))

      expect(await screen.findByText('Demo reset. Memory is back at the seed.')).toBeInTheDocument()
      await settled('Open memory')
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      onStep(1)
      expect(chat().queryByText('Today')).not.toBeInTheDocument()
      expect(chat().queryByText('Five weeks.')).not.toBeInTheDocument()
      expect(chat().queryByText(/uploaded to the document library/)).not.toBeInTheDocument()
      expect(chat().getAllByText(QUESTION)).toHaveLength(1)
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()
      expect(composer()).toHaveValue(QUESTION)
      expect(api.unhandled).toEqual([])
    })

    it('resets from the restart button of an earlier step', async () => {
      const { user } = await start()
      await toStep3(user)
      const restart = bar().getByRole('button', { name: 'Restart' })
      expect(restart).toHaveAttribute('data-tip', 'Reset the demo to the seed')
      expect(restart).not.toHaveAttribute('aria-disabled')
      await user.click(restart)

      expect(await screen.findByText('Demo reset. Memory is back at the seed.')).toBeInTheDocument()
      onStep(1)
      expect(posts()).toEqual(['/demo/reset'])
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()

      await toStep2(user)
      expect(panel().queryByLabelText('Reason')).not.toBeInTheDocument()
    })

    it('returns the panel to the onboarding topic after a contested answer', async () => {
      world.retired = true
      const { user } = await start()
      await toStep5(user)
      await panel().findByText('no binding value')
      await user.click(bar().getByRole('button', { name: 'Restart' }))
      await screen.findByText('Demo reset. Memory is back at the seed.')

      await toStep2(user)
      expect(await panel().findByText('still active')).toBeInTheDocument()
      expect(panel().queryByText('no binding value')).not.toBeInTheDocument()
      expect(composer()).toHaveValue(QUESTION)
    })

    it('only the owner can reset: an admin sees the button greyed out and a click explains why', async () => {
      const { user } = await start({ me: me({ as: MEMBERS.marco }) })
      const restart = bar().getByRole('button', { name: 'Restart' })
      expect(restart).toHaveAttribute('aria-disabled', 'true')
      expect(restart).toHaveAttribute('data-tip', 'Requires owner')

      await user.click(restart)
      expect(await screen.findByText('Requires owner', { selector: '.toast *' })).toBeInTheDocument()
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(0)
    })

    it('an admin cannot restart from the last step either', async () => {
      world.retired = true
      const { user } = await start({ me: me({ as: MEMBERS.marco }) })
      await toStep7(user)
      expect(next('Restart')).toHaveAttribute('aria-disabled', 'true')
      expect(next('Restart')).toHaveAttribute('data-tip', 'Requires owner')

      await user.click(next('Restart'))
      expect(await screen.findByText('Requires owner', { selector: '.toast *' })).toBeInTheDocument()
      onStep(7)
      expect(api.callsTo('POST', '/demo/reset')).toHaveLength(0)
    })

    it('says why when the reset fails, and changes nothing', async () => {
      api.post('/demo/reset', fail(500, 'snapshot missing'))
      const { user, app } = await start()
      await toStep3(user)
      await user.click(bar().getByRole('button', { name: 'Restart' }))

      expect(await screen.findByText('That did not work. snapshot missing')).toBeInTheDocument()
      await settled('Confirm retire')
      onStep(3)
      expect(panel().getByLabelText('Reason')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
    })
  })

  describe('asking a question of your own', () => {
    it('shows the question, a placeholder while the memory is read, then the answer', async () => {
      const gate = deferred<AskResponse>()
      api.post('/ask', () => gate.promise)
      const { user, app } = await start()
      await user.clear(composer())
      await user.type(composer(), 'What is the onboarding target?{Enter}')

      expect(await chat().findByText('Looking in memory…')).toBeInTheDocument()
      expect(chat().getByText('Today')).toBeInTheDocument()
      expect(chat().getByText('What is the onboarding target?')).toBeInTheDocument()
      expect(chat().getAllByText('Giulia')).toHaveLength(2)
      expect(asks()).toHaveLength(1)
      expect(asks()[0].body).toEqual({ question: 'What is the onboarding target?', project_id: 'proj-clearpath', include_plain_retrieval: true })
      expect(app.refresh).not.toHaveBeenCalled()

      gate.resolve(askResponse())
      expect(await chat().findByText('Three to four weeks.')).toBeInTheDocument()
      expect(chat().queryByText('Looking in memory…')).not.toBeInTheDocument()
      expect(chat().getByText('“New consultants should reach autonomy in three to four weeks.”')).toBeInTheDocument()
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(composer()).toHaveValue('What is the onboarding target?')
    })

    it('sends the question from the Ask button, without the spaces around it', async () => {
      const { user } = await start()
      await user.clear(composer())
      await user.type(composer(), '  Who signs the report?  ')
      await user.click(screen.getByRole('button', { name: 'Ask' }))

      expect(await chat().findByText('Who signs the report?')).toBeInTheDocument()
      expect(asks()[0].body).toMatchObject({ question: 'Who signs the report?' })
    })

    it('asks the whole organisation in organisation scope', async () => {
      const { user } = await start({ scope: 'org' })
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await chat().findByText('Three to four weeks.')
      expect(asks()[0].body).toEqual({ question: QUESTION, include_plain_retrieval: true })
      expect(asks()[0].body).not.toHaveProperty('project_id')
      // The composer and the answer both name the scope.
      expect(chat().getAllByText('Whole organisation')).toHaveLength(2)
    })

    it('sends nothing for an empty question', async () => {
      const { user } = await start()
      await user.clear(composer())
      expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()

      await user.type(composer(), '   {Enter}')
      expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
      expect(asks()).toHaveLength(0)
      expect(chat().queryByText('Today')).not.toBeInTheDocument()

      await user.type(composer(), 'x')
      expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled()
    })

    it('writes "Today" once, before the first question', async () => {
      const { user } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await chat().findByText('Three to four weeks.')
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await waitFor(() => expect(chat().getAllByText('Three to four weeks.')).toHaveLength(2))

      expect(chat().getAllByText('Today')).toHaveLength(1)
      expect(chat().getAllByText(QUESTION)).toHaveLength(3)
    })

    it('shows the reason in the chat when the question fails', async () => {
      api.post('/ask', fail(500, 'The model is not reachable'))
      const { user, app } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))

      expect(await chat().findByText('The question could not be answered. The model is not reachable')).toBeInTheDocument()
      expect(chat().queryByText('Looking in memory…')).not.toBeInTheDocument()
      expect(chat().getAllByText(QUESTION)).toHaveLength(2)
      expect(app.refresh).not.toHaveBeenCalled()
      onStep(1)
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()
    })

    it('answers the next question after a failed one', async () => {
      api.post('/ask', fail(500, 'The model is not reachable'))
      const { user } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await chat().findByText('The question could not be answered. The model is not reachable')

      api.post('/ask', askResponse())
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      expect(await chat().findByText('Three to four weeks.')).toBeInTheDocument()
      expect(chat().getByText('The question could not be answered. The model is not reachable')).toBeInTheDocument()
    })

    it('says so when the backend cannot be reached', async () => {
      api.post('/ask', offline)
      const { user } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      expect(await chat().findByText('The question could not be answered. network')).toBeInTheDocument()
    })

    it('says when nothing in memory answers, and leaves the panel as it was', async () => {
      api.post('/ask', noAnswerResponse())
      const { user, app } = await start()
      await user.clear(composer())
      await user.type(composer(), 'Who waters the plants?{Enter}')

      expect(await chat().findByText('Nothing in memory answers this')).toBeInTheDocument()
      expect(chat().getByText('No document in this project talks about that.')).toBeInTheDocument()
      expect(panel().getByText('The memory behind every answer')).toBeInTheDocument()
      expect(api.callsTo('GET', '/topics/:topic_id/chain')).toHaveLength(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      onStep(1)
    })

    it('opens the panel on the topic of the answer, without moving the demo', async () => {
      const { user } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))

      expect(await panel().findByText('still active')).toBeInTheDocument()
      expect(panel().queryByText('The memory behind every answer')).not.toBeInTheDocument()
      onStep(1)
      expect(next('Open memory')).toBeInTheDocument()
    })

    it('loads the topic of an answer about something else', async () => {
      const policy = { ...AUDIT.other, type: 'DECISION' as const }
      api.get('/topics/:topic_id/chain', (req) => (req.params.topic_id === 'audit-turnaround' ? auditChain({ facts: [policy] }) : onboarding()))
      api.post('/ask', askResponse({ answer: 'Every Friday.', binding: policy }))
      const { user } = await start()
      await user.clear(composer())
      await user.type(composer(), 'When is the queue reviewed?{Enter}')

      expect(await panel().findByText('Audit turnaround · ClearPath engagement')).toBeInTheDocument()
      expect(panel().getByText('from the audit policy')).toBeInTheDocument()
      expect(api.callsTo('GET', '/topics/:topic_id/chain').map((c) => c.params.topic_id)).toEqual(['onboarding-target', 'audit-turnaround'])
      expect(next('Open memory')).toBeInTheDocument()
    })

    it('shows the disagreement in the panel for a contested answer, and the binding fact again for the next one', async () => {
      const { user } = await start()
      await user.clear(composer())
      await user.type(composer(), QUESTION_2 + '{Enter}')
      expect(await panel().findByText('no binding value')).toBeInTheDocument()
      expect(within(panel().getByRole('button', { name: /^3–4 business days/ })).getByText('Marco Fiore')).toBeInTheDocument()

      await user.clear(composer())
      await user.type(composer(), QUESTION + '{Enter}')
      expect(await panel().findByText('still active')).toBeInTheDocument()
      expect(panel().queryByText('no binding value')).not.toBeInTheDocument()
    })

    it('opens the fact cited by an answer', async () => {
      const { user, app } = await start()
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await user.click(await chat().findByRole('button', { name: 'final report' }))
      expect(app.openFact).toHaveBeenCalledWith('M-106')
    })
  })

  describe('keyboard', () => {
    it('moves forward with the right arrow and back with the left arrow', async () => {
      const { user } = await start()
      await user.keyboard('{ArrowRight}')
      onStep(2)
      await user.keyboard('{ArrowRight}')
      onStep(3)
      expect(panel().getByLabelText('Reason')).toHaveValue(DEFAULT_REASON)

      await user.keyboard('{ArrowLeft}')
      onStep(2)
      await user.keyboard('{ArrowLeft}')
      onStep(1)
      await user.keyboard('{ArrowLeft}')
      onStep(1)
    })

    it('runs the step of the moment, not the first one', async () => {
      const { user } = await start()
      await toStep3(user)
      await user.keyboard('{ArrowRight}')
      await chat().findByText('Three to four weeks.')
      expect(posts()).toEqual(['/ask', '/facts/M-105/retire', '/ask'])
      onStep(4)
    })

    it('leaves the arrows to the composer and to the reason while typing', async () => {
      const { user } = await start()
      await user.click(composer())
      await user.keyboard('{ArrowRight}')
      onStep(1)

      await toStep3(user)
      await user.click(panel().getByLabelText('Reason'))
      await user.keyboard('{ArrowLeft}{ArrowRight}')
      onStep(3)
      expect(posts()).toEqual([])
    })

    it.each(['Shift', 'Control', 'Alt', 'Meta'])('ignores the arrows with %s held', async (key) => {
      const { user } = await start()
      await user.keyboard(`{${key}>}{ArrowRight}{/${key}}`)
      onStep(1)
    })

    it('ignores the arrows while a dialog or a drawer is open', async () => {
      const { user } = await start()
      const scrim = document.createElement('div')
      scrim.className = 'scrim'
      document.body.appendChild(scrim)
      try {
        await user.keyboard('{ArrowRight}')
        onStep(1)
      } finally {
        scrim.remove()
      }
      await user.keyboard('{ArrowRight}')
      onStep(2)
    })

    it('stops listening when the screen is closed', async () => {
      // On step 3 the right arrow retires the fact: a listener left behind would still send the requests.
      const { user, unmount } = await start()
      await toStep3(user)
      unmount()
      await user.keyboard('{ArrowRight}')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(posts()).toEqual([])
    })
  })

  describe('with the real app state', () => {
    it('reloads the topic when the memory changes', async () => {
      mockShell()
      api.post('/ask', noAnswerResponse())
      const { user } = renderWithProviders(<Ask />)
      await screen.findByRole('button', { name: 'final presentation' })
      expect(await screen.findByText('Asking')).toHaveTextContent('Asking ClearPath engagement')
      expect(api.callsTo('GET', '/topics/:topic_id/chain')).toHaveLength(1)

      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await chat().findByText('Nothing in memory answers this')
      await waitFor(() => expect(api.callsTo('GET', '/topics/:topic_id/chain')).toHaveLength(2))
      expect(api.unhandled).toEqual([])
    })
  })
})
