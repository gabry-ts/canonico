import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react'
import { call, client, errMsg } from '../api/client'
import { useI18n } from '../i18n'
import { nav } from '../lib/router'
import { useApp } from '../lib/store'
import { useApi } from '../lib/useApi'
import { downloadExport, members, NO_FILTERS, setFilters } from '../screens/memory/api'
import { Ic, type IconName } from './Icon'
import { toast, toastError } from './toast'

type Item = { kind: 'fact' | 'tag' | 'goto' | 'action'; label: string; meta?: string; icon: IconName; run: () => void }

const VIEWS: [string, string, IconName][] = [
  ['dashboard', 'nav.dashboard', 'ask'],
  ['app', 'nav.app', 'ask'],
  ['memory', 'nav.memory', 'memory'],
  ['conflicts', 'nav.conflicts', 'conflict'],
  ['open-questions', 'nav.open-questions', 'question'],
  ['maintenance', 'nav.maintenance', 'archive'],
  ['sources', 'nav.sources', 'sources'],
  ['projects', 'nav.projects', 'folder'],
  ['audit', 'nav.audit', 'audit'],
  ['settings', 'nav.settings', 'settings'],
  ['settings/members', 'memory.palette.members', 'users'],
  ['settings/roles', 'memory.palette.roles', 'shield'],
  ['admin', 'nav.admin', 'admin'],
  ['setup', 'nav.setup', 'play'],
]

/** Command palette (⌘K): search facts and jump to screens (GET /search). */
export default function Palette({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 160)
    return () => clearTimeout(h)
  }, [q])

  const search = useApi(
    dq ? () => call(client.GET('/search', { params: { query: { q: dq, kind: 'fact', project_id: app.pid, limit: 6 } } })) : null,
    [dq, app.pid],
  )
  const tags = useApi(() => call(client.GET('/tags', { params: { query: { project_id: app.pid } } })), [app.pid])
  const mems = useApi(() => members(), [])

  const items: Item[] = useMemo(() => {
    const ql = q.toLowerCase().trim()
    const done = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const facts: Item[] = ql
      ? (search.data?.results ?? [])
          .filter((r) => r.kind === 'fact')
          .slice(0, 6)
          .map((r) => ({ kind: 'fact', label: r.snippet, meta: r.id, icon: 'memory', run: done(() => app.openFact(r.id)) }))
      : []
    const tq = ql.replace(/^#/, '')
    const tagHits: Item[] = tq
      ? (tags.data ?? [])
          .filter((x) => x.tag.toLowerCase().includes(tq))
          .slice(0, 5)
          .map((x) => ({
            kind: 'tag',
            label: x.tag,
            meta: t('memory.palette.tagFacts', { count: x.count }),
            icon: 'tag',
            run: done(() => {
              setFilters({ ...NO_FILTERS, tag: x.tag })
              app.openFact(null)
              nav('memory')
            }),
          }))
      : []
    const views: Item[] = VIEWS.map(([path, key, icon]) => ({ kind: 'goto' as const, label: t(key), icon, run: done(() => nav(path)) })).filter(
      (v) => !ql || v.label.toLowerCase().includes(ql),
    )
    const acts: Item[] = [
      {
        kind: 'action' as const,
        label: t('memory.palette.exportMemory'),
        icon: 'archive' as IconName,
        run: done(() => {
          downloadExport()
            .then((n) => toast(t('memory.exported', { count: n })))
            .catch((e) => toastError(t('common.actionError', { message: errMsg(e) })))
        }),
      },
      {
        kind: 'action' as const,
        label: t('memory.palette.toggleTheme'),
        icon: 'moon' as IconName,
        run: done(() => {
          const dark = !document.documentElement.classList.contains('dark')
          document.documentElement.classList.toggle('dark', dark)
          try {
            localStorage.setItem('canonico-theme', dark ? 'dark' : 'light')
          } catch {
            // storage unavailable
          }
        }),
      },
      ...(mems.data ?? []).map((mb) => ({
        kind: 'action' as const,
        label: t('memory.palette.actAs', { name: mb.name, role: t('roles.' + mb.org_role) }),
        icon: 'users' as IconName,
        run: done(() => app.setActor(mb.id)),
      })),
    ].filter((a) => !ql || a.label.toLowerCase().includes(ql))
    return [...facts, ...tagHits, ...views, ...acts]
  }, [q, search.data, tags.data, mems.data, t, app, onClose])

  const cur = Math.min(i, Math.max(0, items.length - 1))
  useEffect(() => {
    list.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [cur])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const onKey = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setI((x) => Math.min(items.length - 1, x + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setI((x) => Math.max(0, x - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[cur]?.run()
    }
  }

  const head = { fact: 'memory.palette.facts', tag: 'memory.palette.tags', goto: 'memory.palette.goto', action: 'memory.palette.actions' }
  let last = ''

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="overlay dialog !top-[12vh] !w-[min(600px,calc(100vw-32px))] overflow-hidden" role="dialog" aria-modal="true" aria-label={t('memory.palette.label')}>
        <div className="flex items-center gap-3 px-4 h-12 border-b">
          <Ic n="search" className="text-muted-foreground" />
          <input
            ref={input}
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground"
            placeholder={t('memory.palette.placeholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setI(0)
            }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palList"
          />
          <span className="kbd">esc</span>
        </div>
        <div id="palList" ref={list} className="max-h-[52vh] overflow-y-auto scroll p-1.5 pb-2" role="listbox">
          {items.length ? (
            items.map((it, n) => {
              const h = it.kind !== last ? (
                <div className="menu-label !pt-3" key={'h-' + it.kind}>
                  {t(head[it.kind])}
                </div>
              ) : null
              last = it.kind
              return [
                h,
                <button
                  key={it.kind + n}
                  className={'menu-item w-full ' + (n === cur ? 'active' : '')}
                  role="option"
                  aria-selected={n === cur}
                  onMouseMove={() => n !== cur && setI(n)}
                  onClick={it.run}
                >
                  <Ic n={it.icon} className="text-muted-foreground" />
                  <span className="flex-1 truncate text-left">{it.label}</span>
                  {it.meta && <span className="mono text-[11.5px] text-muted-foreground">{it.meta}</span>}
                </button>,
              ]
            })
          ) : (
            <div className="px-4 py-10 text-center text-[13.5px] text-muted-foreground">{t('memory.palette.noResults', { q })}</div>
          )}
        </div>
        <div className="px-4 h-9 border-t flex items-center gap-4 text-[12px] text-muted-foreground">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> {t('memory.palette.move')}
          </span>
          <span>
            <span className="kbd">↵</span> {t('memory.palette.open')}
          </span>
        </div>
      </div>
    </>
  )
}
