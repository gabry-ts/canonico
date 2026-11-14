import { useState } from 'react'
import { call, client } from '../api/client'
import { useI18n } from '../i18n'
import { useApi } from '../lib/useApi'
import { useApp } from '../lib/store'
import AddSourceDialog from '../ui/AddSourceDialog'
import { Ic } from '../ui/Icon'
import { AnswersCard, Attention, Feed, FixMetric, HealthCard } from './home/cards'
import { SourcesTable } from './home/SourcesTable'
import { CardHead, PageHead, PageWrap } from './home/shared'

export default function Dashboard() {
  const { t } = useI18n()
  const app = useApp()
  const org = app.scope === 'org'
  const pid = app.pid
  const [adding, setAdding] = useState(false)
  const stats = useApi(() => call(client.GET('/stats', { params: { query: { project_id: pid } } })), [pid, app.version])

  const right = (
    <div className="seg" role="group" aria-label={t('shell.scope')}>
      <button className={org ? '' : 'on'} onClick={() => app.setScope('project')}>
        <Ic n="folder" className="sm" />
        {t('shell.scopeProject')}
      </button>
      <button className={org ? 'on' : ''} onClick={() => app.setScope('org')}>
        <Ic n="org" className="sm" />
        {t('shell.scopeOrg')}
      </button>
    </div>
  )
  const sub = org
    ? t('home.dash.subOrg', { org: app.org?.name ?? '', count: app.projects.length })
    : t('home.dash.subProject', { project: app.project?.name ?? '' })

  return (
    <PageWrap>
      <PageHead title={t('nav.dashboard')} sub={sub} right={right} />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <CardHead title={t('home.attention.title')} />
          <Attention pid={pid} />
        </div>
        <FixMetric stats={stats.data} error={stats.error} onRetry={stats.reload} />
        <div className="xl:col-span-2 card overflow-hidden">
          <CardHead
            title={t('home.feed.title')}
            right={
              <a href="#/audit" className="btn btn-ghost btn-sm">
                {t('nav.audit')} <Ic n="arrow" className="sm" />
              </a>
            }
          />
          <Feed pid={pid} />
        </div>
        <AnswersCard stats={stats.data} error={stats.error} onRetry={stats.reload} />
        <div className="xl:col-span-3">
          <HealthCard stats={stats.data} error={stats.error} onRetry={stats.reload}>
            <div className="flex items-center justify-between gap-3 px-5 h-11 border-b">
              <h3 className="text-[13px] font-medium">
                {t('home.src.title')} <span className="text-muted-foreground font-normal">· {app.project?.name}</span>
              </h3>
              <a href={'#/projects/' + app.projectId} className="btn btn-ghost btn-sm">
                {t('home.openProject')} <Ic n="arrow" className="sm" />
              </a>
            </div>
            <SourcesTable pid={app.projectId} onAdd={() => setAdding(true)} />
          </HealthCard>
        </div>
      </div>
      {adding && <AddSourceDialog projectId={app.projectId} onClose={() => setAdding(false)} />}
    </PageWrap>
  )
}
