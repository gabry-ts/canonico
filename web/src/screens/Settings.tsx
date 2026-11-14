import { useState } from 'react'
import { useI18n } from '../i18n'
import { nav, useRoute } from '../lib/router'
import { useApp } from '../lib/store'
import { usePerm } from '../lib/perm'
import { Ic } from '../ui/Icon'
import { TopbarActions } from '../shell/Topbar'
import { call, client } from '../api/client'
import { useApi } from '../lib/useApi'
import { HooksRow, OrgCard, OrgMailCard } from './org/OrgTab'
import { InviteDialog, MembersTab, RolesTab } from './org/Members'
import { PageHead, PageWrap } from './org/ui'

const TABS = ['org', 'members', 'roles'] as const

export default function Settings() {
  const { t } = useI18n()
  const app = useApp()
  const { sub } = useRoute()
  const { can, attrs } = usePerm()
  const tab = (TABS as readonly string[]).includes(sub ?? '') ? (sub as (typeof TABS)[number]) : 'org'
  const [invite, setInvite] = useState(false)
  const members = useApi(() => call(client.GET('/org/members')), [app.version])
  const label = { org: t('org.settings.tabOrg'), members: t('org.settings.tabMembers'), roles: t('org.settings.tabRoles') }
  return (
    <PageWrap max={1180}>
      {tab === 'members' && (
        <TopbarActions>
          <button className="btn btn-primary btn-sm" {...attrs('manage_members')} onClick={() => can('manage_members') && setInvite(true)}>
            <Ic n="plus" className="sm" />
            {t('org.settings.invite')}
          </button>
        </TopbarActions>
      )}
      <PageHead
        title={t('nav.settings')}
        sub={t('org.settings.sub', { org: app.org?.name ?? '' })}
        right={
          <div className="seg" role="tablist">
            {TABS.map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => nav(k === 'org' ? 'settings' : 'settings/' + k)}>
                {label[k]}
                {k === 'members' && members.data && <span className="mono text-[11px] text-muted-foreground">{members.data.total}</span>}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'org' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <OrgCard />
            <OrgMailCard />
          </div>
          <HooksRow />
        </>
      )}
      {tab === 'members' && <MembersTab />}
      {tab === 'roles' && <RolesTab />}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
    </PageWrap>
  )
}
