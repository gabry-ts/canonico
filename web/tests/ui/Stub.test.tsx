import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Stub from '../../src/ui/Stub'
import { renderI18n } from '../helpers/render'

describe('Stub', () => {
  it('names the screen and says it is being built', () => {
    renderI18n(<Stub route="sources" />)
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByText('This screen is being built.')).toBeInTheDocument()
  })
})
