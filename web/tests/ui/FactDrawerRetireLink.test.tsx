import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FactDrawer from '../../src/ui/FactDrawer'
import { api } from '../helpers/api'
import { fact } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const retired = fact({
  id: 'M-1408',
  value: 'Old rule',
  status: 'retired',
  retired_by: 'mem-sara',
  retired_at: '2025-11-20T10:00:00Z',
  retired_reason: 'Out of date',
  superseded_by: 'M-1409',
})

function open(action: string, changes: Record<string, unknown>) {
  api.get('/facts/:id', retired)
  api.get('/facts/:id/history', [{ version: 2, at: '2025-11-20T10:00:00Z', actor: 'mem-sara', action, changes, snapshot: retired }])
  renderWithApp(<FactDrawer id="M-1408" onClose={() => {}} />)
}

describe('Replaced by on a retired fact', () => {
  it('is hidden when the retire only linked the fact to the binding one', async () => {
    open('retire', { superseded_by: { from: null, to: 'M-1409' } })
    await screen.findByRole('heading', { name: 'Old rule' })
    expect(screen.getByText(/Out of date/)).toBeInTheDocument()
    expect(screen.queryByText('Replaced by', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('stays when the fact was really superseded', async () => {
    open('retire', {})
    await screen.findByRole('heading', { name: 'Old rule' })
    expect(screen.getByText('Replaced by', { selector: 'dt' })).toBeInTheDocument()
  })
})
