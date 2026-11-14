import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnswersCard, Attention, Feed, FixMetric, HealthCard } from '../../../src/screens/home/cards'
import { api, deferred, fail } from '../../helpers/api'
import { auditEvent, conflict, fact, maintenanceItem, openQuestion, stats } from '../../helpers/fixtures'
import { renderI18n, renderWithApp } from '../../helpers/render'

describe('Attention', () => {
  const STALE = [
    maintenanceItem({ id: 'MQ-1' }),
    maintenanceItem({ id: 'MQ-2', reason: 'low_confidence', fact: fact({ id: 'M-102', value: 'Maybe eight weeks' }) }),
    maintenanceItem({ id: 'MQ-3', fact: fact({ id: 'M-103', value: '5 business days', doc_id: '04-external-comms/email/email-external-012' }) }),
    maintenanceItem({ id: 'MQ-4', fact: fact({ id: 'M-104', value: 'Third stale fact' }) }),
  ]
  const CONFLICTS = [
    conflict({
      id: 'C-1',
      topic: 'audit-turnaround',
      facts: [fact({ id: 'M-201', value: '3–4 business days' }), fact({ id: 'M-202', value: '5 business days' }), fact({ id: 'M-203', value: 'One week' })],
    }),
  ]
  const QUESTIONS = [
    openQuestion({ id: 'Q-1', question: 'How many consultants join the pilot?' }),
    openQuestion({ id: 'Q-2', question: 'Who signs off the budget?' }),
    openQuestion({ id: 'Q-3', question: 'When does phase two start?' }),
  ]
  /** The column under a title: a link to the screen that deals with it. */
  const column = (title: string) => screen.getByText(title).closest('a')!
  const count = (title: string) => column(title).querySelector('.mono')!

  beforeEach(() => {
    api.get('/maintenance/queue', STALE)
    api.get('/conflicts', CONFLICTS)
    api.get('/open-questions', QUESTIONS)
  })

  it('asks for what is pending or open in the project', async () => {
    renderWithApp(<Attention pid="proj-internal" />)
    await screen.findByText('Open conflicts')
    const queue = api.last('GET', '/maintenance/queue')!.query
    expect(Object.fromEntries(queue)).toEqual({ project_id: 'proj-internal', status: 'pending', limit: '50' })
    expect(Object.fromEntries(api.last('GET', '/conflicts')!.query)).toEqual({ project_id: 'proj-internal', status: 'open' })
    expect(Object.fromEntries(api.last('GET', '/open-questions')!.query)).toEqual({ project_id: 'proj-internal', status: 'open' })
    expect(api.unhandled).toEqual([])
  })

  it('asks for the whole organisation when there is no project', async () => {
    renderWithApp(<Attention pid={undefined} />)
    await screen.findByText('Open conflicts')
    expect(Object.fromEntries(api.last('GET', '/maintenance/queue')!.query)).toEqual({ status: 'pending', limit: '50' })
    expect(Object.fromEntries(api.last('GET', '/conflicts')!.query)).toEqual({ status: 'open' })
    expect(Object.fromEntries(api.last('GET', '/open-questions')!.query)).toEqual({ status: 'open' })
  })

  it('counts each kind, shows the first two of each and links to its screen', async () => {
    renderWithApp(<Attention pid="proj-clearpath" />)
    await screen.findByText('Open conflicts')

    // Only superseded facts that can still be retrieved count as stale: three of the four in the queue.
    expect(column('Superseded, still active')).toHaveAttribute('href', '#/maintenance')
    expect(count('Superseded, still active')).toHaveTextContent(/^3$/)
    expect(count('Superseded, still active')).toHaveClass('text-warning-text')
    expect(column('Superseded, still active')).toHaveTextContent('≈6 weeks · project brief')
    expect(column('Superseded, still active')).toHaveTextContent('5 business days · email 012')
    expect(column('Superseded, still active')).not.toHaveTextContent('Maybe eight weeks')
    expect(column('Superseded, still active')).not.toHaveTextContent('Third stale fact')

    expect(column('Open conflicts')).toHaveAttribute('href', '#/conflicts')
    expect(count('Open conflicts')).toHaveTextContent(/^1$/)
    expect(count('Open conflicts')).toHaveClass('text-warning-text')
    expect(column('Open conflicts')).toHaveTextContent('Audit turnaround · 3–4 business days / 5 business days')
    expect(column('Open conflicts')).not.toHaveTextContent('One week')

    expect(column('Open questions')).toHaveAttribute('href', '#/open-questions')
    expect(count('Open questions')).toHaveTextContent(/^3$/)
    expect(count('Open questions')).toHaveClass('text-open-text')
    expect(column('Open questions')).toHaveTextContent('How many consultants join the pilot?')
    expect(column('Open questions')).toHaveTextContent('Who signs off the budget?')
    expect(column('Open questions')).not.toHaveTextContent('When does phase two start?')
  })

  it('says which kinds are clear when only one needs a person', async () => {
    api.get('/maintenance/queue', [])
    api.get('/open-questions', [])
    renderWithApp(<Attention pid="proj-clearpath" />)
    await screen.findByText('Open conflicts')
    expect(column('Superseded, still active')).toHaveTextContent('All clear.')
    expect(count('Superseded, still active')).toHaveTextContent(/^0$/)
    expect(count('Superseded, still active')).not.toHaveClass('text-warning-text')
    expect(column('Open questions')).toHaveTextContent('No open questions.')
    expect(count('Open questions')).not.toHaveClass('text-open-text')
    expect(column('Open conflicts')).not.toHaveTextContent('No open conflicts.')
  })

  it('says there are no open conflicts next to stale facts', async () => {
    api.get('/conflicts', [])
    renderWithApp(<Attention pid="proj-clearpath" />)
    await screen.findByText('Open conflicts')
    expect(column('Open conflicts')).toHaveTextContent('No open conflicts.')
    expect(count('Open conflicts')).toHaveTextContent(/^0$/)
    expect(count('Open conflicts')).not.toHaveClass('text-warning-text')
  })

  it('says nothing needs a person when all three are empty', async () => {
    api.get('/maintenance/queue', [maintenanceItem({ reason: 'stale' })])
    api.get('/conflicts', [])
    api.get('/open-questions', [])
    renderWithApp(<Attention pid="proj-clearpath" />)
    expect(await screen.findByText('Nothing needs a person here.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('treats an answer that is not a list as empty', async () => {
    api.get('/maintenance/queue', { items: STALE })
    api.get('/conflicts', {})
    api.get('/open-questions', {})
    renderWithApp(<Attention pid="proj-clearpath" />)
    expect(await screen.findByText('Nothing needs a person here.')).toBeInTheDocument()
  })

  it('shows nothing while loading', async () => {
    const gate = deferred()
    api.get('/conflicts', () => gate.promise)
    renderWithApp(<Attention pid="proj-clearpath" />)
    expect(screen.queryByText('Nothing needs a person here.')).not.toBeInTheDocument()
    expect(screen.queryByText('Open conflicts')).not.toBeInTheDocument()

    gate.resolve(CONFLICTS)
    expect(await screen.findByText('Open conflicts')).toBeInTheDocument()
  })

  it.each(['/maintenance/queue', '/conflicts', '/open-questions'])('shows the error when %s fails and loads again on retry', async (path) => {
    api.get(path, fail(500, 'database is locked'))
    const { user } = renderWithApp(<Attention pid="proj-clearpath" />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    expect(screen.queryByText('Open conflicts')).not.toBeInTheDocument()

    api.get(path, [])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Superseded, still active')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

describe('Feed', () => {
  const EVENTS = [
    auditEvent({ id: 'A-3', at: '2026-11-14T10:30:00Z', actor: 'Giulia Ferri', action: 'retire', fact_id: 'M-105', reason: 'Out of date' }),
    auditEvent({ id: 'A-2', at: '2026-11-13T18:05:00Z', actor: 'system', actor_role: null, action: 'ingest', fact_id: null, reason: null }),
    auditEvent({ id: 'A-1', at: '2026-11-12T09:00:00Z', actor: 'Sara Conti', action: 'resolve', fact_id: 'M-201', reason: 'Client confirmed by email' }),
  ]
  const lines = () => screen.getAllByRole('listitem')

  beforeEach(() => {
    // Events of today show the time alone: pin today.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
    api.get('/audit', EVENTS)
  })

  it('asks for the last eight events of the project', async () => {
    renderWithApp(<Feed pid="proj-internal" />)
    await screen.findByText('Out of date')
    expect(Object.fromEntries(api.last('GET', '/audit')!.query)).toEqual({ project_id: 'proj-internal', limit: '8' })
  })

  it('asks for the whole organisation when there is no project', async () => {
    renderWithApp(<Feed pid={undefined} />)
    await screen.findByText('Out of date')
    expect(Object.fromEntries(api.last('GET', '/audit')!.query)).toEqual({ limit: '8' })
  })

  it('asks for and shows as many events as its limit, even when more come back', async () => {
    renderWithApp(<Feed pid="proj-clearpath" limit={2} />)
    await screen.findByText('Out of date')
    expect(api.last('GET', '/audit')!.query.get('limit')).toBe('2')
    expect(lines()).toHaveLength(2)
    expect(screen.queryByText('Client confirmed by email')).not.toBeInTheDocument()
  })

  it('tells who did what to which fact, why and when', async () => {
    renderWithApp(<Feed pid="proj-clearpath" />)
    await screen.findByText('Out of date')
    expect(lines()).toHaveLength(3)
    expect(lines()[0]).toHaveTextContent('Giulia retired M-105')
    expect(within(lines()[0]).getByText('Out of date')).toBeInTheDocument()
    // Today: the time. Another day: date and time.
    expect(within(lines()[0]).getByText('10:30')).toBeInTheDocument()
    expect(lines()[2]).toHaveTextContent('Sara resolved a conflict on M-201')
    expect(within(lines()[2]).getByText('12 Nov, 09:00')).toBeInTheDocument()
  })

  it('shows what the system did under the name of the product, without a fact or a reason', async () => {
    renderWithApp(<Feed pid="proj-clearpath" />)
    await screen.findByText('Out of date')
    expect(lines()[1]).toHaveTextContent('Canonico ingested')
    expect(within(lines()[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(lines()[1]).getByText('13 Nov, 18:05')).toBeInTheDocument()
  })

  it('treats an event without an actor as done by the system', async () => {
    api.get('/audit', [auditEvent({ actor: '', action: 'classify', fact_id: 'M-106', reason: null })])
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText('Canonico')).toBeInTheDocument()
    expect(lines()[0]).toHaveTextContent('Canonico classified M-106')
  })

  it.each([
    ['restore', 'restored'],
    ['create', 'added'],
    ['patch', 'corrected'],
    ['pin', 'pinned'],
    ['unpin', 'unpinned'],
    ['supersede', 'superseded'],
    ['unlink', 'unlinked'],
    ['close', 'closed a question on'],
    ['approve', 'approved retiring'],
    ['dismiss', 'kept'],
    ['merge', 'merged topics on'],
    ['delete_document', 'deleted a document'],
    ['undo', 'undid a change on'],
    ['import', 'imported data'],
    ['reset', 'reset the demo'],
  ] as const)('words the action %s as "%s"', async (action, words) => {
    api.get('/audit', [auditEvent({ actor: 'Marco Fiore', action, fact_id: null, reason: null })])
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(lines()[0]).toHaveTextContent(`Marco ${words}`)
  })

  it('shows an action it has no words for as it comes', async () => {
    api.get('/audit', [{ ...auditEvent({ actor: 'Marco Fiore', fact_id: null, reason: null }), action: 'archive_topic' }])
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText('archive_topic')).toBeInTheDocument()
  })

  it('opens the fact drawer from the fact id', async () => {
    const { user, app } = renderWithApp(<Feed pid="proj-clearpath" />)
    await user.click(await screen.findByRole('button', { name: 'M-105' }))
    expect(app.openFact).toHaveBeenCalledWith('M-105')
  })

  it('says when nothing changed yet', async () => {
    api.get('/audit', [])
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText('Nothing changed yet')).toBeInTheDocument()
    expect(screen.getByText('Retirements, new versions and incoming emails show up here as they happen.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('treats an answer that is not a list as empty', async () => {
    api.get('/audit', { items: EVENTS })
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText('Nothing changed yet')).toBeInTheDocument()
  })

  it('shows nothing while loading', async () => {
    const gate = deferred()
    api.get('/audit', () => gate.promise)
    renderWithApp(<Feed pid="proj-clearpath" />)
    expect(screen.queryByText('Nothing changed yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()

    gate.resolve(EVENTS)
    expect(await screen.findByText('Out of date')).toBeInTheDocument()
  })

  it('shows the error and loads again on retry', async () => {
    api.get('/audit', fail(500, 'database is locked'))
    const { user } = renderWithApp(<Feed pid="proj-clearpath" />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()

    api.get('/audit', EVENTS)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Out of date')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

/** The coloured segments of the bar at the top of a card: [class, width] of each. */
const segments = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.h-2.overflow-hidden > span')).map((s) => [s.className, s.style.width])

describe('AnswersCard', () => {
  const line = (label: string) => screen.getByText(label).closest('li')!

  it('counts binding, contested and unanswered questions since a date', () => {
    const { container } = renderI18n(<AnswersCard stats={stats({ answers: { binding: 6, contested: 3, no_answer: 1, since: '2026-11-10' } })} />)
    expect(screen.getByRole('heading', { name: 'Answers' })).toBeInTheDocument()
    expect(screen.getByText('since 10 Nov')).toHaveClass('badge')
    expect(line('Binding')).toHaveTextContent(/^Binding6$/)
    expect(line('Contested')).toHaveTextContent(/^Contested3$/)
    expect(line('No answer')).toHaveTextContent(/^No answer1$/)
    expect(screen.getByText(/^Contested answers show the disagreement/)).toBeInTheDocument()
    expect(segments(container)).toEqual([
      ['bg-primary', '60%'],
      ['bg-warning', '30%'],
      ['bg-muted-foreground/40', '10%'],
    ])
  })

  it('leaves the kinds without answers out of the bar', () => {
    const { container } = renderI18n(<AnswersCard stats={stats({ answers: { binding: 3, no_answer: 1 } })} />)
    expect(line('Contested')).toHaveTextContent(/^Contested0$/)
    expect(segments(container)).toEqual([
      ['bg-primary', '75%'],
      ['bg-muted-foreground/40', '25%'],
    ])
    expect(screen.queryByText(/^since/)).not.toBeInTheDocument()
  })

  it('shows zeros and an empty bar when no question was asked', () => {
    const { container } = renderI18n(<AnswersCard stats={stats()} />)
    expect(line('Binding')).toHaveTextContent(/^Binding0$/)
    expect(line('Contested')).toHaveTextContent(/^Contested0$/)
    expect(line('No answer')).toHaveTextContent(/^No answer0$/)
    expect(segments(container)).toEqual([])
  })

  it.each([null, undefined])('shows only its title while the figures load (%s)', (none) => {
    renderI18n(<AnswersCard stats={none} />)
    expect(screen.getByRole('heading', { name: 'Answers' })).toBeInTheDocument()
    expect(screen.queryByText('Binding')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Contested answers show/)).not.toBeInTheDocument()
  })

  it('shows the error with a retry instead of a placeholder when the figures cannot be loaded', async () => {
    const retry = vi.fn()
    const { user, container } = renderI18n(<AnswersCard stats={undefined} error="stats offline" onRetry={retry} />)
    expect(screen.getByText('Could not load this. stats offline')).toBeInTheDocument()
    expect(container.querySelector('.skel')).not.toBeInTheDocument()
    expect(screen.queryByText('Binding')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('FixMetric', () => {
  const fix = (median: number | null, samples?: number) => stats({ time_to_fix_seconds: { median, samples } })

  it.each([
    ['the backend reports no measure', stats()],
    ['the median is missing', fix(null, 0)],
    ['the measure is empty', stats({ time_to_fix_seconds: {} })],
  ])('says the time is not measured when %s', (_, value) => {
    renderI18n(<FixMetric stats={value} />)
    expect(screen.getByRole('heading', { name: 'Time to fix a wrong fact' })).toBeInTheDocument()
    expect(screen.getByText('—')).toHaveClass('text-muted-foreground')
    expect(screen.getByText('not measured')).toHaveClass('badge', 'open')
    expect(screen.getByText('Not measured yet')).toBeInTheDocument()
    expect(screen.getByText(/^Someone new to the project finds the wrong fact/)).toBeInTheDocument()
  })

  it.each([
    [0, '0 s'],
    [42, '42 s'],
    [41.6, '42 s'],
    [60, '1 min 0 s'],
    [125, '2 min 5 s'],
    [3725.2, '62 min 5 s'],
  ])('shows a median of %s seconds as "%s"', (median, shown) => {
    renderI18n(<FixMetric stats={fix(median, 12)} />)
    expect(screen.getByText(shown)).not.toHaveClass('text-muted-foreground')
    expect(screen.queryByText('not measured')).not.toBeInTheDocument()
    expect(screen.queryByText('Not measured yet')).not.toBeInTheDocument()
  })

  it.each([null, undefined])('shows a placeholder and does not say "not measured" while the figures load (%s)', (none) => {
    const { container } = renderI18n(<FixMetric stats={none} />)
    expect(screen.getByRole('heading', { name: 'Time to fix a wrong fact' })).toBeInTheDocument()
    expect(container.querySelector('.skel')).toBeInTheDocument()
    expect(screen.queryByText('not measured')).not.toBeInTheDocument()
    expect(screen.queryByText('Not measured yet')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows the error with a retry instead of "not measured" when the figures cannot be loaded', async () => {
    const retry = vi.fn()
    const { user } = renderI18n(<FixMetric stats={undefined} error="stats offline" onRetry={retry} />)
    expect(screen.getByText('Could not load this. stats offline')).toBeInTheDocument()
    expect(screen.queryByText('not measured')).not.toBeInTheDocument()
    expect(screen.queryByText('Not measured yet')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it.each([
    [1, 'Median of 1 test'],
    [12, 'Median of 12 tests'],
    [1234, 'Median of 1,234 tests'],
    [undefined, 'Median of 0 tests'],
  ])('says how many tests the median comes from (%s)', (samples, shown) => {
    renderI18n(<FixMetric stats={fix(42, samples)} />)
    expect(screen.getByText(shown)).toBeInTheDocument()
  })
})

describe('HealthCard', () => {
  const HEALTH = stats({
    facts_total: 1234,
    documents: 46,
    topics: 12,
    by_status: { active: 900, retired: 334 },
    by_type: { DECISION: 10, EVIDENCE: 40, HYPOTHESIS: 20 },
    open_conflicts: 2,
    maintenance_pending: 4,
  })
  const listUnder = (title: string) => within(screen.getByText(title).parentElement!).getAllByRole('listitem')
  const texts = (title: string) => listUnder(title).map((li) => li.textContent)
  const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!

  it('sums up facts, documents and topics', () => {
    renderI18n(<HealthCard stats={HEALTH} />)
    expect(screen.getByRole('heading', { name: 'Memory health' })).toBeInTheDocument()
    expect(screen.getByText('1,234 facts · 46 documents · 12 topics')).toBeInTheDocument()
  })

  it('uses the singular for one fact', () => {
    renderI18n(<HealthCard stats={stats({ facts_total: 1, documents: 3, topics: 2 })} />)
    expect(screen.getByText('1 fact · 3 documents · 2 topics')).toBeInTheDocument()
  })

  it('splits the facts by status, in proportion on the bar', () => {
    const { container } = renderI18n(<HealthCard stats={stats({ facts_total: 40, by_status: { active: 30, retired: 10, contested: 0, archived: 0 } })} />)
    expect(texts('By status')).toEqual(['Active30', 'Retired10', 'Contested0', 'archived0'])
    expect(segments(container)).toEqual([
      ['bg-foreground/35', '75%'],
      ['bg-muted-foreground/50', '25%'],
    ])
  })

  it('gives a status it does not know a neutral colour and its raw name', () => {
    const { container } = renderI18n(<HealthCard stats={stats({ facts_total: 10, by_status: { binding: 5, parked: 5 } })} />)
    expect(texts('By status')).toEqual(['Binding5', 'parked5'])
    expect(segments(container)).toEqual([
      ['bg-primary', '50%'],
      ['bg-foreground/20', '50%'],
    ])
  })

  it('prefers the newer facts_by_status and facts_by_type over the old fields', () => {
    renderI18n(
      <HealthCard
        stats={stats({ facts_total: 12, by_status: { active: 99 }, by_type: { DECISION: 99 }, facts_by_status: { binding: 4, superseded: 6, open: 2 }, facts_by_type: { CONSTRAINT: 7, OPEN: 5 } })}
      />,
    )
    expect(texts('By status')).toEqual(['Binding4', 'Superseded6', 'Open question2'])
    expect(texts('By type')).toEqual(['Constraint7', 'Open question5'])
  })

  it('lists the types from the most to the least frequent, bars relative to the first', () => {
    renderI18n(<HealthCard stats={{ ...HEALTH, by_type: { DECISION: 10, EVIDENCE: 40, HYPOTHESIS: 20, custom_type: 4 } }} />)
    expect(texts('By type')).toEqual(['Evidence40', 'Hypothesis20', 'Decision10', 'custom_type4'])
    expect(listUnder('By type').map((li) => li.querySelector<HTMLElement>('.bar i')!.style.width)).toEqual(['100%', '50%', '25%', '10%'])
  })

  it('formats large numbers', () => {
    renderI18n(<HealthCard stats={{ ...HEALTH, by_type: { EVIDENCE: 1200 } }} />)
    expect(texts('By status')).toEqual(['Active900', 'Retired334'])
    expect(texts('By type')).toEqual(['Evidence1,200'])
  })

  it('shows what is waiting: stale facts, open conflicts and reviews', () => {
    renderI18n(<HealthCard stats={{ ...HEALTH, needs_attention: { stale_active: 3 } }} />)
    expect(figure('Superseded, still active')).toHaveTextContent(/^3$/)
    expect(figure('Open conflicts')).toHaveTextContent(/^2$/)
    expect(figure('Waiting for review')).toHaveTextContent(/^4$/)
  })

  it('counts stale facts as zero when the backend does not report them', () => {
    renderI18n(<HealthCard stats={HEALTH} />)
    expect(figure('Superseded, still active')).toHaveTextContent(/^0$/)
  })

  it('shows an empty bar for an empty memory', () => {
    const { container } = renderI18n(<HealthCard stats={stats({ facts_total: 0, documents: 0, topics: 0, by_status: { active: 0 }, by_type: {} })} />)
    expect(screen.getByText('0 facts · 0 documents · 0 topics')).toBeInTheDocument()
    expect(segments(container)).toEqual([])
    expect(texts('By status')).toEqual(['Active0'])
    expect(screen.getByText('By type')).toBeInTheDocument()
  })

  it.each([null, undefined])('shows only its title while the figures load (%s)', (none) => {
    renderI18n(<HealthCard stats={none} />)
    expect(screen.getByRole('heading', { name: 'Memory health' })).toBeInTheDocument()
    expect(screen.queryByText('By status')).not.toBeInTheDocument()
    expect(screen.queryByText(/facts ·/)).not.toBeInTheDocument()
  })

  it('shows the error with a retry instead of a placeholder when the figures cannot be loaded, and still what is under it', async () => {
    const retry = vi.fn()
    const { user, container } = renderI18n(
      <HealthCard stats={undefined} error="stats offline" onRetry={retry}>
        <p>Sources of the project</p>
      </HealthCard>,
    )
    expect(screen.getByText('Could not load this. stats offline')).toBeInTheDocument()
    expect(container.querySelector('.skel')).not.toBeInTheDocument()
    expect(screen.getByText('Sources of the project')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('renders what the page puts under it, loaded or not', () => {
    const { rerender } = renderI18n(
      <HealthCard stats={undefined}>
        <p>Sources of the project</p>
      </HealthCard>,
    )
    expect(screen.getByText('Sources of the project')).toBeInTheDocument()
    rerender(
      <HealthCard stats={HEALTH}>
        <p>Sources of the project</p>
      </HealthCard>,
    )
    expect(screen.getByText('Sources of the project')).toBeInTheDocument()
    expect(screen.getByText('By status')).toBeInTheDocument()
  })
})
