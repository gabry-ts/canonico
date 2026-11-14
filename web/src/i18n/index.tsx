import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import en from './en.json'
import it from './it.json'

export type Locale = 'en' | 'it'
export const LOCALES: Locale[] = ['en', 'it']
type Params = Record<string, string | number | null | undefined>
type Dict = { [key: string]: string | Dict }

const dicts: Record<Locale, Dict> = { en: en as Dict, it: it as Dict }
const INTL: Record<Locale, string> = { en: 'en-GB', it: 'it-IT' }
const STORAGE_KEY = 'canonico-lang'

function lookup(d: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = d
  for (const part of key.split('.')) {
    if (cur == null || typeof cur === 'string') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** Translate `key` ("namespace.name"). `{param}` placeholders are replaced; with `count`, `key_one` / `key_other` are tried first. */
export function translate(locale: Locale, key: string, params?: Params): string {
  let s: string | undefined
  if (params && typeof params.count === 'number') {
    const rule = new Intl.PluralRules(INTL[locale]).select(params.count)
    s = lookup(dicts[locale], `${key}_${rule}`) ?? lookup(dicts[locale], `${key}_other`)
  }
  s ??= lookup(dicts[locale], key)
  if (s === undefined && locale !== 'en') return translate('en', key, params)
  if (s === undefined) return key
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params && params[k] != null ? String(params[k]) : m))
}

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'it') return saved
  } catch {
    // storage unavailable
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const l of langs) {
    const two = (l || '').slice(0, 2).toLowerCase()
    if (two === 'it') return 'it'
    if (two === 'en') return 'en'
  }
  return 'en'
}

let current: Locale = detect()
/** Current UI locale, readable outside React (used for the Accept-Language header). */
export const currentLocale = () => current

const dateOnly = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00') : new Date(iso))

function makeFormatters(locale: Locale) {
  const tag = INTL[locale]
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, o)
  const safe = (iso: string | null | undefined, f: Intl.DateTimeFormat) => {
    if (!iso) return '—'
    const d = dateOnly(iso)
    return Number.isNaN(d.getTime()) ? String(iso) : f.format(d)
  }
  const full = fmt({ day: 'numeric', month: 'short', year: 'numeric' })
  const short = fmt({ day: 'numeric', month: 'short' })
  const time = fmt({ hour: '2-digit', minute: '2-digit' })
  const dateTime = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const isToday = (iso: string | null | undefined) => {
    if (!iso) return false
    const d = dateOnly(iso)
    return d.toDateString() === new Date().toDateString()
  }
  return {
    /** 28 Nov 2025 */
    fmtDate: (iso: string | null | undefined) => safe(iso, full),
    /** 28 Nov */
    fmtDateShort: (iso: string | null | undefined) => safe(iso, short),
    /** 14:05 */
    fmtTime: (iso: string | null | undefined) => safe(iso, time),
    /** 14 Nov, 14:05 */
    fmtDateTime: (iso: string | null | undefined) => safe(iso, dateTime),
    /** Time when the instant is today, otherwise date and time. */
    fmtWhen: (iso: string | null | undefined) => (isToday(iso) ? safe(iso, time) : safe(iso, dateTime)),
    isToday,
    fmtNum: (n: number | null | undefined, o?: Intl.NumberFormatOptions) =>
      n == null ? '—' : new Intl.NumberFormat(tag, o).format(n),
    fmtMoney: (n: number | null | undefined) =>
      n == null ? '—' : new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n),
    fmtPct: (n: number | null | undefined) =>
      n == null ? '—' : new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }).format(n),
  }
}

type I18n = ReturnType<typeof makeFormatters> & {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, params?: Params) => string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(current)
  const setLocale = useCallback((l: Locale) => {
    current = l
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // storage unavailable
    }
    setLocaleState(l)
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      ...makeFormatters(locale),
    }),
    [locale, setLocale],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n outside I18nProvider')
  return v
}
