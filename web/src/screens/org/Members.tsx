import { useState } from 'react'
import { call, client, errMsg, type Schemas } from '../../api/client'
import { useI18n } from '../../i18n'
import { useApp } from '../../lib/store'
import { useApi } from '../../lib/useApi'
import { usePerm } from '../../lib/perm'
import { Avatar, Ic } from '../../ui/Icon'
import { Dialog } from '../../ui/overlays'
import { toast, toastError } from '../../ui/toast'
import { ROLE_ORDER } from './roles'
import { FieldErr, Loading } from './ui'

type Role = Schemas['Role']
const ROLES_DESC = [...ROLE_ORDER] as Role[]

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const app = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [err, setErr] = useState<{ name?: string; email?: string }>({})
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const e: typeof err = {}
    if (!name.trim()) e.name = t('org.members.nameErr')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) e.email = t('org.members.emailErr')
    setErr(e)
    if (e.name || e.email) return
    setBusy(true)
    try {
      await call(client.POST('/org/members', { body: { name: name.trim(), email: email.trim(), org_role: role } }))
      toast(t('org.members.invitedToast', { name: name.trim() }), { icon: 'send' })
      await app.refresh()
      onClose()
    } catch (x) {
      toastError(errMsg(x))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('org.members.inviteTitle')}
      sub={t('org.members.inviteSub', { org: app.org?.name ?? '' })}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {t('org.members.send')}
          </button>
        </>
      }
    >
      <label className="label" htmlFor="dName">
        {t('org.members.name')}
      </label>
      <input id="dName" className={'input ' + (err.name ? 'invalid' : '')} value={name} placeholder={t('org.members.namePh')} onChange={(e) => setName(e.target.value)} autoFocus />
      <FieldErr msg={err.name} />
      <label className="label mt-4" htmlFor="dEmail">
        {t('org.members.email')}
      </label>
      <input id="dEmail" className={'input ' + (err.email ? 'invalid' : '')} value={email} placeholder={t('org.members.emailPh')} onChange={(e) => setEmail(e.target.value)} />
      <FieldErr msg={err.email} />
      <label className="label mt-4" htmlFor="dRole">
        {t('org.members.role')}
      </label>
      <select id="dRole" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {[...ROLES_DESC].reverse().map((r) => (
          <option key={r} value={r}>
            {t('roles.' + r)} · {t('org.roles.desc_' + r)}
          </option>
        ))}
      </select>
    </Dialog>
  )
}

export function MembersTab() {
  const { t } = useI18n()
  const app = useApp()
  const { can, attrs } = usePerm()
  const members = useApi(() => call(client.GET('/org/members')), [app.version])
  const projRoles = useApi(
    async () => {
      const out: Record<string, Record<string, Schemas['ProjectMember']>> = {}
      await Promise.all(
        app.projects.map(async (p) => {
          const list = await call(client.GET('/projects/{project_id}/members', { params: { path: { project_id: p.id } } }))
          const arr = Array.isArray(list) ? list : ((list as { items?: Schemas['ProjectMember'][] }).items ?? [])
          out[p.id] = Object.fromEntries(arr.map((m) => [m.member_id, m]))
        }),
      )
      return out
    },
    [app.version, app.projects.map((p) => p.id).join(',')],
  )
  const roleOpts = [...ROLES_DESC].reverse()

  const setOrgRole = async (m: Schemas['Member'], role: Role) => {
    try {
      await call(client.PATCH('/org/members/{member_id}', { params: { path: { member_id: m.id } }, body: { org_role: role } }))
      toast(t('org.members.roleChanged', { name: m.name, role: t('roles.' + role) }), { icon: 'check' })
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
      void members.reload()
    }
  }
  const setProjRole = async (m: Schemas['Member'], pid: string, pname: string, role: string) => {
    try {
      if (role) {
        await call(client.PUT('/projects/{project_id}/members/{member_id}', { params: { path: { project_id: pid, member_id: m.id } }, body: { member_id: m.id, role: role as Role } }))
        toast(t('org.members.projRoleChanged', { name: m.name, project: pname }), { icon: 'check' })
      } else {
        await call(client.DELETE('/projects/{project_id}/members/{member_id}', { params: { path: { project_id: pid, member_id: m.id } } }))
        toast(t('org.members.projRoleReset', { name: m.name, project: pname }), { icon: 'check' })
      }
      await app.refresh()
    } catch (e) {
      toastError(errMsg(e))
      void projRoles.reload()
    }
  }
  const resend = async (m: Schemas['Member']) => {
    try {
      await call(client.PATCH('/org/members/{member_id}', { params: { path: { member_id: m.id } }, body: { email: m.email } }))
      toast(t('org.members.resent', { name: m.name }), { icon: 'send' })
    } catch (e) {
      toastError(errMsg(e))
    }
  }

  if (members.loading && !members.data) return <div className="card"><Loading /></div>
  if (members.error)
    return (
      <div className="card p-5 text-[13.5px]">
        {t('common.loadError', { message: members.error })} <button className="link" onClick={() => void members.reload()}>{t('common.retry')}</button>
      </div>
    )
  const list = members.data?.items ?? []
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('org.members.member')}</th>
              <th>{t('org.members.orgRole')}</th>
              <th>{t('org.members.status')}</th>
              {app.projects.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.name} />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {m.name}
                        {m.id === app.actor && <span className="text-[12px] text-muted-foreground font-normal"> {t('org.members.you')}</span>}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    className="input input-sm !w-[112px]"
                    value={m.org_role}
                    disabled={!can('manage_members')}
                    {...attrs('manage_members')}
                    onChange={(e) => void setOrgRole(m, e.target.value as Role)}
                    aria-label={t('org.members.orgRole')}
                  >
                    {roleOpts.map((r) => (
                      <option key={r} value={r}>
                        {t('roles.' + r)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {m.status === 'invited' ? (
                    <span className="badge line">{t('org.members.invited')}</span>
                  ) : (
                    <span className="badge ok">
                      <span className="bd !bg-success"></span>
                      {t('org.members.active')}
                    </span>
                  )}
                </td>
                {app.projects.map((p) => {
                  const pr = projRoles.data?.[p.id]?.[m.id]
                  const explicit = pr && !pr.inherited ? pr.role : ''
                  return (
                    <td key={p.id}>
                      <div className="flex items-center gap-2">
                        <select
                          className="input input-sm !w-[118px]"
                          value={explicit}
                          disabled={!can('manage_members')}
                          {...attrs('manage_members')}
                          onChange={(e) => void setProjRole(m, p.id, p.name, e.target.value)}
                          aria-label={p.name}
                        >
                          <option value="">{t('org.members.inherit')}</option>
                          {roleOpts.map((r) => (
                            <option key={r} value={r}>
                              {t('roles.' + r)}
                            </option>
                          ))}
                        </select>
                        {explicit ? <span className="badge line">{t('org.members.override')}</span> : <span className="badge">{t('org.members.inheritedRole', { role: t('roles.' + m.org_role) })}</span>}
                      </div>
                    </td>
                  )
                })}
                <td className="text-right">
                  {m.status === 'invited' && (
                    <button className="btn btn-ghost btn-sm" {...attrs('manage_members')} onClick={() => can('manage_members') && void resend(m)}>
                      {t('org.members.resend')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="px-5 py-3 border-t bg-muted/30 text-[12.5px] text-muted-foreground">{t('org.members.footer')}</footer>
    </div>
  )
}

export function RolesTab() {
  const { t } = useI18n()
  const roles = useApi(() => call(client.GET('/roles')), [])
  if (roles.loading && !roles.data) return <div className="card"><Loading /></div>
  if (roles.error) return <div className="card p-5 text-[13.5px]">{t('common.loadError', { message: roles.error })}</div>
  const data = roles.data ?? []
  const order = ['viewer', 'editor', 'admin', 'owner']
  const cols = order.map((r) => data.find((x) => x.role === r)).filter((x): x is Schemas['RolePermissions'] => !!x)
  const perms = Array.from(new Set(data.flatMap((r) => r.permissions as string[])))
  const rank = (p: string) => cols.findIndex((c) => (c.permissions as string[]).includes(p))
  perms.sort((a, b) => rank(a) - rank(b))
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('org.roles.permission')}</th>
              {cols.map((c) => (
                <th key={c.role} className="text-center">
                  {t('roles.' + c.role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-[12.5px] text-muted-foreground">{t('org.roles.purpose')}</td>
              {cols.map((c) => (
                <td key={c.role} className="text-center text-[12.5px] text-muted-foreground">
                  {t('org.roles.desc_' + c.role)}
                </td>
              ))}
            </tr>
            {perms.map((p) => (
              <tr key={p}>
                <td>
                  <div className="font-medium">{t('org.roles.perm_' + p)}</div>
                  <div className="mono text-[11.5px] text-muted-foreground">{p}</div>
                </td>
                {cols.map((c) => (
                  <td key={c.role} className="text-center">
                    {(c.permissions as string[]).includes(p) ? (
                      <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-primary-soft text-primary-text" aria-label={t('org.roles.allowed')}>
                        <Ic n="check" className="sm" />
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50" aria-label={t('org.roles.denied')}>
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="px-5 py-3 border-t bg-muted/30 text-[12.5px] text-muted-foreground">{t('org.roles.footer')}</footer>
    </div>
  )
}
