import { useI18n } from '../i18n'
import { useApp } from './store'
import { toast } from '../ui/toast'

const MIN_ROLE: Record<string, string> = {
  ask: 'viewer',
  read_facts: 'viewer',
  retire_fact: 'editor',
  restore_fact: 'editor',
  correct_fact: 'editor',
  resolve_conflict: 'editor',
  manage_sources: 'admin',
  manage_mail: 'admin',
  manage_members: 'admin',
  admin_demo: 'owner',
}

/**
 * Permission helpers for the current demo identity.
 * `attrs(perm)` spreads onto a button: greys it out with a "Requires editor" tooltip when not allowed.
 * `guard(perm, fn)` wraps the click handler so a forbidden click shows a toast instead of calling the API.
 */
export function usePerm() {
  const { can } = useApp()
  const { t } = useI18n()
  const requires = (perm: string) => t('common.requires', { role: t('roles.' + (MIN_ROLE[perm] || 'owner')) })
  return {
    can,
    attrs: (perm: string) => (can(perm) ? {} : { 'aria-disabled': true as const, 'data-tip': requires(perm) }),
    guard:
      <A extends unknown[]>(perm: string, fn: (...a: A) => void) =>
      (...a: A) => {
        if (!can(perm)) {
          toast(requires(perm), { icon: 'lock' })
          return
        }
        fn(...a)
      },
  }
}
