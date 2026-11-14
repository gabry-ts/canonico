import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '../../src/i18n/en.json'
import itDict from '../../src/i18n/it.json'

type Dict = { [key: string]: string | Dict }

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src')

function flatten(d: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'string') out[prefix + k] = v
    else Object.assign(out, flatten(v, prefix + k + '.'))
  }
  return out
}

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path, keep)
    return keep(name) ? [path] : []
  })
}

const EN = flatten(en as Dict)
const IT = flatten(itDict as Dict)
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
const PLURAL = /_(zero|one|two|few|many|other)$/

describe('dictionaries', () => {
  it('English and Italian have the same keys', () => {
    expect(Object.keys(IT).filter((k) => !(k in EN))).toEqual([])
    expect(Object.keys(EN).filter((k) => !(k in IT))).toEqual([])
  })

  it('no string is empty', () => {
    expect(Object.keys(EN).filter((k) => !EN[k].trim())).toEqual([])
    expect(Object.keys(IT).filter((k) => !IT[k].trim())).toEqual([])
  })

  it('a translation uses the same placeholders as the English string', () => {
    // A singular form may spell the number out ("La versione…") and drop {count}.
    const wrong = Object.keys(EN).filter((k) => {
      const e = placeholders(EN[k])
      const i = placeholders(IT[k] ?? '')
      if (k.endsWith('_one')) return i.some((p) => !e.includes(p)) || e.some((p) => p !== 'count' && !i.includes(p))
      return e.join() !== i.join()
    })
    expect(wrong).toEqual([])
  })

  it('every plural has the "one" and "other" forms and nothing else', () => {
    for (const dict of [EN, IT]) {
      const plural = Object.keys(dict).filter((k) => PLURAL.test(k))
      expect(plural.filter((k) => !/_(one|other)$/.test(k))).toEqual([])
      const bases = new Set(plural.map((k) => k.replace(PLURAL, '')))
      expect([...bases].filter((b) => !(b + '_one' in dict) || !(b + '_other' in dict))).toEqual([])
    }
  })

  it('has a name for every role and every route', async () => {
    const { ROUTES } = await import('../../src/lib/router')
    for (const dict of [EN, IT]) {
      expect(['owner', 'admin', 'editor', 'viewer'].filter((r) => !dict['roles.' + r])).toEqual([])
      expect(ROUTES.filter((r) => !dict['nav.' + r])).toEqual([])
    }
  })

  it('the per-screen string files are merged into the dictionaries', () => {
    // src/<area>/strings.<locale>.json is the source of the namespace <area>; scripts/i18n-merge.py copies it.
    const parts = files(SRC, (n) => /^strings\.(en|it)\.json$/.test(n))
    expect(parts.length).toBeGreaterThan(0)
    for (const path of parts) {
      const locale = /strings\.(en|it)\.json$/.exec(path)![1]
      const namespace = path.split('/').at(-2)!
      const merged = (locale === 'en' ? en : itDict) as Dict
      expect(merged[namespace], `${relative(SRC, path)} is not merged: run scripts/i18n-merge.py ${namespace}`).toEqual(JSON.parse(readFileSync(path, 'utf8')))
    }
  })

  it('every key the code asks for exists', () => {
    const missing: string[] = []
    for (const path of files(SRC, (n) => /\.tsx?$/.test(n) && n !== 'schema.ts')) {
      const code = readFileSync(path, 'utf8')
      // t('some.key') and t('some.key', {…}); keys built at run time (t('nav.' + route)) are not literals and are skipped.
      for (const m of code.matchAll(/(?<![\w.])t\(\s*'([^']+)'\s*[,)]/g)) {
        const key = m[1]
        if (!(key in EN) && !(key + '_other' in EN)) missing.push(`${relative(SRC, path)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })
})
