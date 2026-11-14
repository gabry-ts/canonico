import { call, client, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { useApi } from '../../lib/useApi'
import { useApp } from '../../lib/store'
import { Ic } from '../../ui/Icon'
import { Empty, Skeleton } from '../../ui/overlays'
import { asList, CardHead, ErrorBox, ITEM_ICON, ITEM_TYPES, TagChip, tagSort, type Item, type Source } from './shared'

type Fact = Schemas['Fact']
type ItemType = (typeof ITEM_TYPES)[number]
export type ItemFilter = { type: string; tag: string }

/** Received items of a project (uploads, webhook posts, synced documents), with type and tag filters. */
export function ItemsCard({
  pid,
  open,
  setOpen,
  filter,
  setFilter,
  sources,
}: {
  pid: string
  open: string | null
  setOpen: (id: string | null) => void
  filter: ItemFilter
  setFilter: (f: ItemFilter) => void
  sources: Source[]
}) {
  const { t, fmtDate } = useI18n()
  const { version } = useApp()
  const st = useApi(
    () =>
      call(
        client.GET('/projects/{project_id}/items', {
          params: {
            path: { project_id: pid },
            query: { limit: 200, type: filter.type === 'all' ? undefined : (filter.type as ItemType), tag: filter.tag === 'all' ? undefined : filter.tag },
          },
        }),
      ),
    [pid, filter.type, filter.tag, version],
  )
  const all = useApi(() => call(client.GET('/projects/{project_id}/items', { params: { path: { project_id: pid }, query: { limit: 200 } } })).then((d) => asList<Item>(d)), [pid, version])
  const tags = [...new Set((all.data ?? []).flatMap((i) => i.tags ?? []))].sort(tagSort)
  const list = asList<Item>(st.data)
  const total = all.data?.length ?? 0
  const filtered = filter.type !== 'all' || filter.tag !== 'all'

  const filters = (
    <div className="flex items-center gap-2">
      <select className="input input-sm !w-auto !h-8" value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })} aria-label={t('home.items.filterType')}>
        <option value="all">{t('home.items.allTypes')}</option>
        {ITEM_TYPES.map((k) => (
          <option key={k} value={k}>
            {t('home.itemType.' + k)}
          </option>
        ))}
      </select>
      <select className="input input-sm !w-auto !h-8 max-w-[190px]" value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })} aria-label={t('home.items.filterTag')}>
        <option value="all">{t('home.items.anyTag')}</option>
        {tags.map((tg) => (
          <option key={tg} value={tg}>
            {tg}
          </option>
        ))}
      </select>
    </div>
  )

  let body
  if (st.error && !st.data) body = <ErrorBox message={st.error} onRetry={st.reload} />
  else if (!st.data)
    body = (
      <div className="p-5">
        <Skeleton rows={3} className="h-11" />
      </div>
    )
  else if (!list.length)
    body = (
      <Empty icon="inbox" title={filtered ? t('home.items.noMatch') : t('home.items.emptyTitle')}>
        {filtered ? t('home.items.noMatchText') : t('home.items.emptyText')}
        {filtered && (
          <div>
            <button className="btn btn-outline btn-sm mt-4" onClick={() => setFilter({ type: 'all', tag: 'all' })}>
              {t('home.items.clear')}
            </button>
          </div>
        )}
      </Empty>
    )
  else
    body = list.map((i) => {
      const isOpen = open === i.id
      const src = i.source_id ? sources.find((s) => s.id === i.source_id) : undefined
      const origin = src ? src.label : i.routed_by === 'tag_rule' ? t('home.items.orgWebhook') : t('home.items.manual')
      return (
        <div key={i.id} className="border-b last:border-b-0" id={`item-${i.id}`}>
          <button
            className={`w-full flex items-center gap-3 px-5 py-3 text-left transition hover:bg-accent/40 ${isOpen ? 'bg-muted/45' : ''}`}
            onClick={() => setOpen(isOpen ? null : i.id)}
            aria-expanded={isOpen}
            aria-controls={`xp-item-${i.id}`}
          >
            <span className="w-8 h-8 rounded-md bg-muted grid place-items-center text-muted-foreground shrink-0">
              <Ic n={ITEM_ICON[i.type] ?? 'doc'} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium truncate">{i.title}</span>
              <span className="mt-1 flex items-center gap-1.5 flex-wrap text-[12px] text-muted-foreground">
                <span>{t('home.itemType.' + i.type)}</span>
                <span aria-hidden="true">·</span>
                <span className="mr-1">{origin}</span>
                {(i.tags ?? []).map((tg) => (
                  <TagChip key={tg} tag={tg} />
                ))}
              </span>
            </span>
            <span className="mono text-[12px] text-muted-foreground shrink-0 hidden sm:block w-[96px] text-right">{fmtDate(i.date)}</span>
            <span className="shrink-0 w-[70px] text-right text-[12.5px] text-muted-foreground">{t('home.items.facts', { count: i.facts_count })}</span>
            <Ic n="down" className="xchev" />
          </button>
          <div className={`xr ${isOpen ? 'open' : ''}`} id={`xp-item-${i.id}`} inert={!isOpen}>
            <div className="xp">
              <div>
                <div className="xbody px-5 pt-1 pb-4">{isOpen && <ItemDetail item={i} />}</div>
              </div>
            </div>
          </div>
        </div>
      )
    })

  return (
    <div className="card overflow-hidden" id="itemsCard">
      <CardHead title={t('home.items.title')} right={filters} sub={st.data ? t('home.items.count', { n: list.length, total }) : undefined} />
      {body}
    </div>
  )
}

function ItemDetail({ item }: { item: Item }) {
  const { t, fmtDateTime } = useI18n()
  const { openFact } = useApp()
  const st = useApi(
    () =>
      Promise.all([
        call(client.GET('/items/{item_id}', { params: { path: { item_id: item.id } } })),
        call(client.GET('/documents/{doc_id}/facts', { params: { path: { doc_id: item.document_id } } })).catch(() => [] as Fact[]),
      ]),
    [item.id],
  )
  if (st.error && !st.data) return <ErrorBox message={st.error} onRetry={st.reload} />
  if (!st.data) return <Skeleton rows={2} className="h-6" />
  const [d, factsRaw] = st.data
  const facts = asList<Fact>(factsRaw)
  return (
    <>
      <dl className="kv !grid-cols-[96px_1fr]">
        {item.participants && item.participants.length > 0 && (
          <>
            <dt>{t('home.items.participants')}</dt>
            <dd>{item.participants.join(', ')}</dd>
          </>
        )}
        {d.text_excerpt && (
          <>
            <dt>{t('home.items.text')}</dt>
            <dd className="text-muted-foreground">“{d.text_excerpt}”</dd>
          </>
        )}
        <dt>{t('home.items.document')}</dt>
        <dd className="mono text-[12.5px] truncate">{item.document_id}</dd>
        <dt>{t('home.items.received')}</dt>
        <dd className="mono text-[12.5px]">
          {fmtDateTime(item.received_at)} · {item.id}
        </dd>
      </dl>
      <div className="mt-4 mb-1 text-[12.5px] font-medium text-muted-foreground">{t('home.items.factsTitle')}</div>
      {facts.length ? (
        <ul className="-mx-3">
          {facts.map((f) => (
            <li key={f.id}>
              <FactRow f={f} onOpen={() => openFact(f.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">{item.facts_count ? t('home.items.factsElsewhere', { count: item.facts_count }) : t('home.items.noFacts')}</p>
      )}
    </>
  )
}

export function FactRow({ f, onOpen }: { f: Fact; onOpen: () => void }) {
  const { t } = useI18n()
  const retired = f.status === 'retired'
  const cls = retired ? 'retired' : f.superseded_by ? 'superseded' : f.type === 'OPEN' ? 'open' : f.pinned ? 'binding' : 'line'
  const label = retired ? t('fact.status.retired') : f.superseded_by ? t('fact.status.superseded') : t('fact.type.' + f.type)
  return (
    <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent text-left" onClick={onOpen}>
      <span className={`flex-1 min-w-0 truncate text-[13.5px] ${retired ? 'strike' : ''}`}>{f.value}</span>
      <span className={'badge ' + cls}>{label}</span>
      <span className="mono text-[11.5px] text-muted-foreground w-[48px] text-right">{f.id}</span>
    </button>
  )
}
