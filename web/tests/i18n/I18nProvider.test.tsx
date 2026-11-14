import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { I18nProvider, useI18n } from '../../src/i18n'
import { currentLocale, storeLocale } from '../../src/i18n/core'

function Probe() {
  const { t, locale, setLocale, fmtDate, fmtNum } = useI18n()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t('common.cancel')}</span>
      <span data-testid="plural">{t('review.conflicts.keepSub', { doc: 'brief', date: 'today', count: 1 })}</span>
      <span data-testid="date">{fmtDate('2025-11-28')}</span>
      <span data-testid="num">{fmtNum(12345.5)}</span>
      <button onClick={() => setLocale('it')}>it</button>
      <button onClick={() => setLocale('en')}>en</button>
    </div>
  )
}

describe('I18nProvider', () => {
  it('starts in the current locale and sets <html lang>', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('text')).toHaveTextContent('Cancel')
    expect(document.documentElement.lang).toBe('en')
  })

  it('starts in Italian when that is the remembered locale', () => {
    storeLocale('it')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('text')).toHaveTextContent('Annulla')
    expect(document.documentElement.lang).toBe('it')
  })

  it('switching language changes texts, formats, <html lang>, storage and the locale sent to the API', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('date')).toHaveTextContent('28 Nov 2025')
    expect(screen.getByTestId('num')).toHaveTextContent('12,345.5')

    await user.click(screen.getByRole('button', { name: 'it' }))
    expect(screen.getByTestId('locale')).toHaveTextContent('it')
    expect(screen.getByTestId('text')).toHaveTextContent('Annulla')
    expect(screen.getByTestId('date')).toHaveTextContent('28 nov 2025')
    expect(screen.getByTestId('num')).toHaveTextContent('12.345,5')
    expect(document.documentElement.lang).toBe('it')
    expect(localStorage.getItem('canonico-lang')).toBe('it')
    expect(currentLocale()).toBe('it')

    await user.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByTestId('text')).toHaveTextContent('Cancel')
    expect(currentLocale()).toBe('en')
  })

  it('translates plurals through t()', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('plural')).toHaveTextContent('The other fact will be retired')
  })

  it('useI18n fails loudly outside the provider', () => {
    const quiet = console.error
    console.error = () => {}
    try {
      expect(() => render(<Probe />)).toThrow('useI18n outside I18nProvider')
    } finally {
      console.error = quiet
    }
  })
})
