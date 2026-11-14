import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import FactDrawer from '../../src/ui/FactDrawer'
import { api } from '../helpers/api'
import { fact, topic } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

describe('pin on a binding but unpinned fact', () => {
  it('opens the pin form and posts the pin', async () => {
    const f = fact({ id: 'M-904', topic: 'travel-booking', value: 'Book 5 days ahead', type: 'CONSTRAINT', pinned: false })
    api.get('/facts/:id', f)
    api.get('/topics/:id/chain', { topic: topic({ id: 'travel-booking', label: 'Travel', fact_ids: ['M-904'] }), facts: [f] })
    api.post('/facts/:id/pin', { ...f, pinned: true })
    const user = userEvent.setup()
    renderWithApp(<FactDrawer id="M-904" onClose={() => {}} />)
    await screen.findByRole('heading', { name: f.value })
    await user.click(screen.getAllByRole('button', { name: 'Pin as binding' })[0])
    await user.type(screen.getByRole('textbox', { name: /^Reason/ }), 'Signed off')
    await user.click(screen.getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(api.callsTo('POST', '/facts/:id/pin')).toHaveLength(1))
  })
})
