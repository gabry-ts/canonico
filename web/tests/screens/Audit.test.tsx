import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import Audit from '../../src/screens/Audit'
import { api, fail } from '../helpers/api'
import { auditEvent, fact, me, MEMBERS } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const EVENTS = [
  auditEvent({ id: 'A-3', at: '2026-11-14T10:30:00Z', actor: 'mem-giulia', actor_role: 'owner', action: 'retire', fact_id: 'M-105', reason: 'Out of date' }),
  auditEvent({ id: 'A-2', at: '2026-11-14T10:00:00Z', actor: 'system', actor_role: null, action: 'ingest', fact_id: null, reason: null }),
  auditEvent({ id: 'A-1', at: '2026-11-14T09:00:00Z', actor: 'mem-sara', actor_role: 'editor', action: 'undo', fact_id: 'M-106', reason: 'Oops' }),
]

// `useFact` caches by data version and fact id for the whole file, so every test uses its own version.
let version = 100
const row = (text: string) => screen.getByText(text).closest('tr')!

beforeEach(() => {
  version++
  api.get('/audit', EVENTS)
  api.get('/org/members', { items: Object.values(MEMBERS), total: 4 })
  api.get('/facts/:id', (req) => fact({ id: req.params.id, value: `value of ${req.params.id}` }))
})

describe('Audit', () => {
  it('lists the events with who, what, which fact and why', async () => {
    renderWithApp(<Audit />, { version })
    const retire = within(await screen.findByText('Out of date').then((el) => el.closest('tr')!))
    expect(retire.getByText('14 Nov, 10:30')).toBeInTheDocument()
    expect(await retire.findByText('Giulia Ferri')).toBeInTheDocument()
    expect(retire.getByText('owner')).toBeInTheDocument()
    expect(retire.getByText('Retired')).toHaveClass('badge', 'retired')
    expect(await retire.findByText('value of M-105')).toBeInTheDocument()
    expect(retire.getByText('M-105')).toBeInTheDocument()
  })

  it('asks for the last 200 events', async () => {
    renderWithApp(<Audit />, { version })
    await screen.findByText('Out of date')
    expect(api.last('GET', '/audit')!.query.get('limit')).toBe('200')
  })

  it('shows system events as automatic, without a fact and without Undo', async () => {
    renderWithApp(<Audit />, { version })
    const sys = within(await screen.findByText('Ingested').then((el) => el.closest('tr')!))
    expect(sys.getByText('System')).toBeInTheDocument()
    expect(sys.getByText('automatic')).toBeInTheDocument()
    expect(sys.getAllByText('—')).toHaveLength(2)
    expect(sys.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('offers Undo on what a person did, except on an undo itself', async () => {
    renderWithApp(<Audit />, { version })
    await screen.findByText('Out of date')
    expect(within(row('Out of date')).getByRole('button', { name: 'Undo' })).toBeEnabled()
    expect(within(row('Oops')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('filters people and system events with the tabs', async () => {
    const { user } = renderWithApp(<Audit />, { version })
    await screen.findByText('Out of date')
    expect(screen.getByRole('tab', { name: 'All3' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: 'People' }))
    expect(screen.getByText('Out of date')).toBeInTheDocument()
    expect(screen.getByText('Oops')).toBeInTheDocument()
    expect(screen.queryByText('Ingested')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'System' }))
    expect(screen.getByText('Ingested')).toBeInTheDocument()
    expect(screen.queryByText('Out of date')).not.toBeInTheDocument()
  })

  it('says when there are no events', async () => {
    api.get('/audit', [])
    renderWithApp(<Audit />, { version })
    expect(await screen.findByText('No events yet')).toBeInTheDocument()
  })

  it('says when a tab has no events', async () => {
    api.get('/audit', [EVENTS[0]])
    const { user } = renderWithApp(<Audit />, { version })
    await screen.findByText('Out of date')
    await user.click(screen.getByRole('tab', { name: 'System' }))
    expect(screen.getByText('No events yet')).toBeInTheDocument()
  })

  it('shows the error and loads again on retry', async () => {
    api.get('/audit', fail(500, 'database is locked'))
    const { user } = renderWithApp(<Audit />, { version })
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()

    api.get('/audit', EVENTS)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Out of date')).toBeInTheDocument()
  })

  it('opens the fact drawer from the fact cell', async () => {
    const { user, app } = renderWithApp(<Audit />, { version })
    await user.click(await screen.findByText('value of M-105'))
    expect(app.openFact).toHaveBeenCalledWith('M-105')
  })

  it('shows the id of an actor that is no longer a member', async () => {
    api.get('/audit', [auditEvent({ actor: 'mem-gone', actor_role: 'editor', reason: 'Left the company' })])
    renderWithApp(<Audit />, { version })
    expect(within(await screen.findByText('Left the company').then((el) => el.closest('tr')!)).getByText('mem-gone')).toBeInTheDocument()
  })

  describe('undo', () => {
    it('undoes the event as the current person, marks the row and refreshes', async () => {
      api.post('/audit/:id/undo', {})
      const { user, app } = renderWithApp(<Audit />, { version })
      await screen.findByText('Out of date')
      await user.click(within(row('Out of date')).getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      const sent = api.last('POST', '/audit/:id/undo')!
      expect(sent.params.id).toBe('A-3')
      expect(sent.body).toEqual({ actor: 'Giulia', reason: 'Undone from the review screens.' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(within(row('Out of date')).getByText('undone')).toBeInTheDocument()
      expect(row('Out of date')).toHaveClass('opacity-55')
      expect(within(row('Out of date')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    })

    it('says why when the backend refuses, and leaves the row as it was', async () => {
      api.post('/audit/:id/undo', fail(409, 'Already undone'))
      const { user, app } = renderWithApp(<Audit />, { version })
      await screen.findByText('Out of date')
      await user.click(within(row('Out of date')).getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('That did not work. Already undone')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(within(row('Out of date')).getByRole('button', { name: 'Undo' })).toBeEnabled()
      expect(row('Out of date')).not.toHaveClass('opacity-55')
    })

    it('a viewer sees the button greyed out and a click only explains why', async () => {
      api.post('/audit/:id/undo', {})
      const { user } = renderWithApp(<Audit />, { version, me: me({ as: MEMBERS.luca }) })
      await screen.findByText('Out of date')
      const undo = within(row('Out of date')).getByRole('button', { name: 'Undo' })
      expect(undo).toHaveAttribute('aria-disabled', 'true')
      expect(undo).toHaveAttribute('data-tip', 'Requires editor')

      await user.click(undo)
      expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
      await waitFor(() => expect(api.callsTo('POST', '/audit/:id/undo')).toHaveLength(0))
    })
  })
})
