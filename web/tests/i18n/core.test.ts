import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentLocale, makeFormatters, storeLocale, translate } from '../../src/i18n/core'

describe('translate', () => {
  it('looks up nested keys', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel')
    expect(translate('it', 'common.cancel')).toBe('Annulla')
    expect(translate('en', 'shell.sourceTypes.github')).toBe('GitHub')
  })

  it('fills {placeholders}, numbers included', () => {
    expect(translate('en', 'common.requires', { role: 'editor' })).toBe('Requires editor')
    expect(translate('en', 'common.loadError', { message: 404 })).toBe('Could not load this. 404')
  })

  it('leaves a placeholder in place when its value is missing or null', () => {
    expect(translate('en', 'common.requires')).toBe('Requires {role}')
    expect(translate('en', 'common.requires', { role: null })).toBe('Requires {role}')
    expect(translate('en', 'common.requires', { other: 'x' })).toBe('Requires {role}')
  })

  it('returns the key itself when nothing is found', () => {
    expect(translate('en', 'nope.missing')).toBe('nope.missing')
    expect(translate('it', 'nope.missing')).toBe('nope.missing')
  })

  it('does not return a whole namespace as a string', () => {
    expect(translate('en', 'common')).toBe('common')
    expect(translate('en', 'common.cancel.deeper')).toBe('common.cancel.deeper')
  })

  it('picks the plural form from `count`', () => {
    const p = { doc: 'final report', date: '28 Nov 2025' }
    expect(translate('en', 'review.conflicts.keepSub', { ...p, count: 1 })).toContain('The other fact will be retired')
    expect(translate('en', 'review.conflicts.keepSub', { ...p, count: 2 })).toContain('The other 2 facts will be retired')
    expect(translate('en', 'review.conflicts.keepSub', { ...p, count: 0 })).toContain('The other 0 facts')
  })

  it('uses the plain key when there are no plural forms', () => {
    expect(translate('en', 'common.requires', { role: 'admin', count: 3 })).toBe('Requires admin')
  })

  it('a non-numeric count is not a plural', () => {
    expect(translate('en', 'review.conflicts.keepSub', { count: '2' })).toBe('review.conflicts.keepSub')
  })
})

describe('locale', () => {
  afterEach(() => {
    vi.resetModules()
  })

  const load = async () => {
    vi.resetModules()
    return import('../../src/i18n/core')
  }

  it('remembers the chosen locale', () => {
    storeLocale('it')
    expect(currentLocale()).toBe('it')
    expect(localStorage.getItem('canonico-lang')).toBe('it')
    storeLocale('en')
    expect(currentLocale()).toBe('en')
  })

  it('starts from the saved locale', async () => {
    localStorage.setItem('canonico-lang', 'it')
    expect((await load()).currentLocale()).toBe('it')
  })

  it('ignores a saved value that is not a locale and looks at the browser', async () => {
    localStorage.setItem('canonico-lang', 'fr')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['it-IT', 'en'])
    expect((await load()).currentLocale()).toBe('it')
  })

  it('takes the first browser language it supports', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'de', 'en-US', 'it'])
    expect((await load()).currentLocale()).toBe('en')
  })

  it('falls back to English', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    expect((await load()).currentLocale()).toBe('en')
  })

  it('uses navigator.language when navigator.languages is empty', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([])
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('it-CH')
    expect((await load()).currentLocale()).toBe('it')
  })

  it('works when storage is not available', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const core = await load()
    expect(core.currentLocale()).toBe('en')
    expect(() => core.storeLocale('it')).not.toThrow()
    expect(core.currentLocale()).toBe('it')
  })
})

describe('makeFormatters', () => {
  const en = makeFormatters('en')
  const it_ = makeFormatters('it')

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats dates day-month-year', () => {
    expect(en.fmtDate('2025-11-28')).toBe('28 Nov 2025')
    expect(it_.fmtDate('2025-11-28')).toBe('28 nov 2025')
    expect(en.fmtDateShort('2025-11-28')).toBe('28 Nov')
  })

  it('a date without a time does not shift across midnight', () => {
    expect(en.fmtDate('2025-01-01')).toBe('1 Jan 2025')
    expect(en.fmtDate('2025-12-31')).toBe('31 Dec 2025')
  })

  it('abbreviates September with three letters', () => {
    expect(en.fmtDate('2025-09-12')).toBe('12 Sep 2025')
    expect(en.fmtDateShort('2025-09-12')).toBe('12 Sep')
  })

  it('formats times and date-times', () => {
    expect(en.fmtTime('2026-11-14T14:05:00Z')).toBe('14:05')
    expect(en.fmtDateTime('2026-11-14T14:05:00Z')).toBe('14 Nov, 14:05')
    expect(it_.fmtDateTime('2026-11-14T14:05:00Z')).toBe('14 nov, 14:05')
  })

  it('shows a dash for a missing value', () => {
    for (const f of [en.fmtDate, en.fmtDateShort, en.fmtTime, en.fmtDateTime, en.fmtWhen]) {
      expect(f(null)).toBe('—')
      expect(f(undefined)).toBe('—')
      expect(f('')).toBe('—')
    }
  })

  it('shows a value that is not a date as it is', () => {
    expect(en.fmtDate('last Monday')).toBe('last Monday')
    expect(en.fmtDateTime('n/a')).toBe('n/a')
  })

  it('fmtWhen shows only the time for today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T16:00:00Z'))
    expect(en.fmtWhen('2026-11-14T09:12:00Z')).toBe('09:12')
    expect(en.fmtWhen('2026-11-13T09:12:00Z')).toBe('13 Nov, 09:12')
  })

  it('isToday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T16:00:00Z'))
    expect(en.isToday('2026-11-14T00:30:00Z')).toBe(true)
    expect(en.isToday('2026-11-14')).toBe(true)
    expect(en.isToday('2026-11-13T23:59:00Z')).toBe(false)
    expect(en.isToday(null)).toBe(false)
    expect(en.isToday(undefined)).toBe(false)
  })

  it('formats numbers by locale', () => {
    expect(en.fmtNum(1234567)).toBe('1,234,567')
    expect(it_.fmtNum(1234567)).toBe('1.234.567')
    expect(en.fmtNum(0)).toBe('0')
    expect(en.fmtNum(null)).toBe('—')
    expect(en.fmtNum(undefined)).toBe('—')
    expect(en.fmtNum(1.23456, { maximumFractionDigits: 2 })).toBe('1.23')
  })

  it('formats money in dollars with two decimals', () => {
    expect(en.fmtMoney(0.42)).toBe('US$0.42')
    expect(en.fmtMoney(5)).toBe('US$5.00')
    expect(it_.fmtMoney(12345.5).replace(/\s/g, ' ')).toBe('12.345,50 USD')
    expect(en.fmtMoney(null)).toBe('—')
  })

  it('formats a ratio as a whole percentage', () => {
    expect(en.fmtPct(0.256)).toBe('26%')
    expect(en.fmtPct(1)).toBe('100%')
    expect(en.fmtPct(0)).toBe('0%')
    expect(en.fmtPct(undefined)).toBe('—')
  })
})
