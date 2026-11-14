import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Schemas } from '../../src/api/client'
import Maintenance from '../../src/screens/Maintenance'
import { api, deferred, fail } from '../helpers/api'
import { auditEvent, fact, maintenanceItem, me, MEMBERS } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const PENDING = maintenanceItem()
const STALE = maintenanceItem({
  id: 'MQ-2',
  fact: fact({ id: 'M-150', value: 'Quarterly review', doc_id: '01-scope/requirements', date: '2025-08-01' }),
  reason: 'stale',
  detail: 'Not confirmed by any source in 90 days.',
})
const APPROVED = maintenanceItem({
  id: 'MQ-3',
  fact: fact({ id: 'M-160', value: 'Weekly steering call', status: 'retired' }),
  reason: 'low_confidence',
  detail: 'Extracted with low confidence.',
  status: 'approved',
})
const DISMISSED = maintenanceItem({ id: 'MQ-4', fact: fact({ id: 'M-170', value: 'Budget ceiling' }), reason: 'stale', detail: 'Old but still valid.', status: 'dismissed' })

function queue(list: Schemas['MaintenanceItem'][]) {
  api.get('/maintenance/queue', (req) => list.filter((m) => m.status === (req.query.get('status') ?? 'pending')))
}
const row = (text: string) => within(screen.getByText(text).closest('tr')!)

beforeEach(() => {
  queue([PENDING, STALE, APPROVED, DISMISSED])
  api.get('/audit', [])
})

describe('Maintenance', () => {
  it('loads the three lists of the project and counts them on the tabs', async () => {
    renderWithApp(<Maintenance />)
    expect(await screen.findByRole('tab', { name: 'Pending2' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Approved1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dismissed1' })).toBeInTheDocument()
    const calls = api.callsTo('GET', '/maintenance/queue')
    expect(calls.map((c) => c.query.get('status')).sort()).toEqual(['approved', 'dismissed', 'pending'])
    expect(calls.every((c) => c.query.get('project_id') === 'proj-clearpath' && c.query.get('limit') === '200')).toBe(true)
  })

  it('shows each proposal with the fact, its source, why it was proposed and the two decisions', async () => {
    renderWithApp(<Maintenance />)
    const r = row((await screen.findByText('≈6 weeks')).textContent!)
    expect(r.getByText(/project brief/)).toBeInTheDocument()
    expect(r.getByText('22 Aug 2025')).toBeInTheDocument()
    expect(r.getByText('M-101')).toBeInTheDocument()
    expect(r.getByText('Superseded, still retrievable')).toHaveClass('badge', 'conflict')
    expect(r.getByText('A newer fact replaced this one but it can still be retrieved.')).toBeInTheDocument()
    expect(r.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
    expect(r.getByRole('button', { name: 'Approve retire' })).toBeEnabled()
    expect(row('Quarterly review').getByText('Stale')).toHaveClass('badge', 'retired')
  })

  it('opens the fact drawer from a row', async () => {
    const { user, app } = renderWithApp(<Maintenance />)
    await user.click(await screen.findByText('≈6 weeks'))
    expect(app.openFact).toHaveBeenCalledWith('M-101')
  })

  it('says when a list is empty, each in its own words', async () => {
    queue([])
    const { user } = renderWithApp(<Maintenance />)
    expect(await screen.findByText('The queue is empty')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Approved0' }))
    expect(screen.getByText('Nothing approved yet')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Dismissed0' }))
    expect(screen.getByText('Nothing dismissed yet')).toBeInTheDocument()
  })

  it('shows the error and loads again on retry', async () => {
    api.get('/maintenance/queue', fail(500, 'database is locked'))
    const { user } = renderWithApp(<Maintenance />)
    expect(await screen.findByText('Could not load this. database is locked')).toBeInTheDocument()
    queue([PENDING])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('≈6 weeks')).toBeInTheDocument()
  })

  describe('deciding', () => {
    it('approving retires the fact as the current person, refreshes and confirms', async () => {
      api.post('/maintenance/:id/approve', {})
      const { user, app } = renderWithApp(<Maintenance />)
      await screen.findByText('≈6 weeks')
      await user.click(row('≈6 weeks').getByRole('button', { name: 'Approve retire' }))
      expect(await screen.findByText('Fact retired. Nothing is deleted.')).toBeInTheDocument()
      const sent = api.last('POST', '/maintenance/:id/approve')!
      expect(sent.params.id).toBe('MQ-1')
      expect(sent.body).toEqual({ actor: 'Giulia' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.callsTo('POST', '/maintenance/:id/dismiss')).toHaveLength(0)
    })

    it('dismissing leaves the fact alone and confirms', async () => {
      api.post('/maintenance/:id/dismiss', {})
      const { user, app } = renderWithApp(<Maintenance />)
      await screen.findByText('Quarterly review')
      await user.click(row('Quarterly review').getByRole('button', { name: 'Dismiss' }))
      expect(await screen.findByText('Proposal dismissed. The fact stays as it is.')).toBeInTheDocument()
      const sent = api.last('POST', '/maintenance/:id/dismiss')!
      expect(sent.params.id).toBe('MQ-2')
      expect(sent.body).toEqual({ actor: 'Giulia' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('disables the buttons of the row while the decision is on its way', async () => {
      const gate = deferred()
      api.post('/maintenance/:id/approve', () => gate.promise)
      const { user } = renderWithApp(<Maintenance />)
      await screen.findByText('≈6 weeks')
      await user.click(row('≈6 weeks').getByRole('button', { name: 'Approve retire' }))
      expect(row('≈6 weeks').getByRole('button', { name: 'Approve retire' })).toBeDisabled()
      expect(row('≈6 weeks').getByRole('button', { name: 'Dismiss' })).toBeDisabled()
      expect(row('Quarterly review').getByRole('button', { name: 'Approve retire' })).toBeEnabled()
      gate.resolve({})
      expect(await screen.findByText('Fact retired. Nothing is deleted.')).toBeInTheDocument()
      expect(row('≈6 weeks').getByRole('button', { name: 'Approve retire' })).toBeEnabled()
    })

    it('offers Undo in the toast for the events an approval created', async () => {
      let approved = false
      api.post('/maintenance/:id/approve', () => {
        approved = true
        return {}
      })
      api.get('/audit', () =>
        approved
          ? [auditEvent({ id: 'A-21', action: 'retire', fact_id: 'M-101' }), auditEvent({ id: 'A-20', action: 'approve', fact_id: 'M-101' }), auditEvent({ id: 'A-19', action: 'dismiss' })]
          : [],
      )
      api.post('/audit/:id/undo', {})
      const { user } = renderWithApp(<Maintenance />)
      await screen.findByText('≈6 weeks')
      await user.click(row('≈6 weeks').getByRole('button', { name: 'Approve retire' }))
      const toast = within((await screen.findByText('Fact retired. Nothing is deleted.')).closest('.toast') as HTMLElement)
      await user.click(toast.getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-21', 'A-20'])
    })

    it('says why when the backend refuses, and does not refresh', async () => {
      api.post('/maintenance/:id/approve', fail(403, 'Role viewer lacks permission retire_fact.'))
      const { user, app } = renderWithApp(<Maintenance />)
      await screen.findByText('≈6 weeks')
      await user.click(row('≈6 weeks').getByRole('button', { name: 'Approve retire' }))
      expect(await screen.findByText('That did not work. Role viewer lacks permission retire_fact.')).toBeInTheDocument()
      expect(app.refresh).not.toHaveBeenCalled()
      expect(row('≈6 weeks').getByRole('button', { name: 'Approve retire' })).toBeEnabled()
    })

    it('a viewer cannot decide', async () => {
      const { user } = renderWithApp(<Maintenance />, { me: me({ as: MEMBERS.luca }) })
      await screen.findByText('≈6 weeks')
      for (const name of ['Dismiss', 'Approve retire']) {
        const btn = row('≈6 weeks').getByRole('button', { name })
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        expect(btn).toHaveAttribute('data-tip', 'Requires editor')
        await user.click(btn)
      }
      expect(await screen.findAllByText('Requires editor', { selector: '.toast *' })).toHaveLength(2)
      expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    })
  })

  describe('decided items', () => {
    it('approved items are struck through and can be undone', async () => {
      api.get('/audit', [
        auditEvent({ id: 'A-31', action: 'retire', fact_id: 'M-160', at: '2026-11-14T10:00:01Z' }),
        auditEvent({ id: 'A-30', action: 'approve', fact_id: 'M-160', at: '2026-11-14T10:00:00Z' }),
        auditEvent({ id: 'A-29', action: 'dismiss', fact_id: 'M-160', at: '2026-11-14T10:00:00Z' }),
        auditEvent({ id: 'A-12', action: 'retire', fact_id: 'M-160', at: '2026-11-10T10:00:00Z' }),
        auditEvent({ id: 'A-11', action: 'retire', fact_id: 'M-999', at: '2026-11-14T10:00:00Z' }),
      ])
      api.post('/audit/:id/undo', {})
      const { user, app } = renderWithApp(<Maintenance />)
      await user.click(await screen.findByRole('tab', { name: 'Approved1' }))
      expect(screen.getByText('Weekly steering call')).toHaveClass('strike')
      expect(row('Weekly steering call').getByText('Low confidence')).toHaveClass('badge', 'open')
      expect(row('Weekly steering call').queryByRole('button', { name: 'Approve retire' })).not.toBeInTheDocument()

      await user.click(row('Weekly steering call').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      // Only the approval and the retirement it caused, not the older retirement of the same fact.
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-31', 'A-30'])
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('dismissed items are not struck through and undo the dismissal', async () => {
      api.get('/audit', [auditEvent({ id: 'A-41', action: 'dismiss', fact_id: 'M-170' }), auditEvent({ id: 'A-40', action: 'retire', fact_id: 'M-170' })])
      api.post('/audit/:id/undo', {})
      const { user } = renderWithApp(<Maintenance />)
      await user.click(await screen.findByRole('tab', { name: 'Dismissed1' }))
      expect(screen.getByText('Budget ceiling')).not.toHaveClass('strike')
      await user.click(row('Budget ceiling').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Undone. Everything is back as before.')).toBeInTheDocument()
      expect(api.callsTo('POST', '/audit/:id/undo').map((c) => c.params.id)).toEqual(['A-41'])
    })

    it('points to the audit log when the decision cannot be found', async () => {
      const { user } = renderWithApp(<Maintenance />)
      await user.click(await screen.findByRole('tab', { name: 'Approved1' }))
      await user.click(row('Weekly steering call').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('Could not find the change to undo. Use the audit log.')).toBeInTheDocument()
      expect(row('Weekly steering call').getByRole('button', { name: 'Undo' })).toBeEnabled()
    })

    it('says why when the undo fails', async () => {
      api.get('/audit', [auditEvent({ id: 'A-31', action: 'approve', fact_id: 'M-160' })])
      api.post('/audit/:id/undo', fail(409, 'Already undone'))
      const { user } = renderWithApp(<Maintenance />)
      await user.click(await screen.findByRole('tab', { name: 'Approved1' }))
      await user.click(row('Weekly steering call').getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText('That did not work. Already undone')).toBeInTheDocument()
    })
  })
})
