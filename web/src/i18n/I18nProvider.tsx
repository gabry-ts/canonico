import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { currentLocale, I18nContext, makeFormatters, storeLocale, translate, type I18n, type Locale } from './core'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale)
  const setLocale = useCallback((l: Locale) => {
    storeLocale(l)
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
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
