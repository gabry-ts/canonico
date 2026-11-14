import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePerm } from '../../src/lib/perm'
import { storeLocale } from '../../src/i18n/core'
import { me, MEMBERS, PERMISSIONS } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

function Probe({ perm, run }: { perm: string; run: (...a: unknown[]) => void }) {
  const p = usePerm()
  return (
    <button {...p.attrs(perm)} onClick={p.guard(perm, () => run('clicked', 42))}>
      {p.can(perm) ? 'allowed' : 'forbidden'}
    </button>
  )
}

const as = (m: keyof typeof MEMBERS) => ({ me: me({ as: MEMBERS[m] }) })

describe('usePerm', () => {
  it('lets an allowed action through, with its arguments, and adds no attributes', async () => {
    const run = vi.fn()
    const { user } = renderWithApp(<Probe perm="retire_fact" run={run} />, as('sara'))
    const btn = screen.getByRole('button', { name: 'allowed' })
    expect(btn).not.toHaveAttribute('aria-disabled')
    expect(btn).not.toHaveAttribute('data-tip')
    await user.click(btn)
    expect(run).toHaveBeenCalledWith('clicked', 42)
    expect(document.querySelector('.toast')).toBeNull()
  })

  it('greys out a forbidden action and explains instead of running it', async () => {
    const run = vi.fn()
    const { user } = renderWithApp(<Probe perm="retire_fact" run={run} />, as('luca'))
    const btn = screen.getByRole('button', { name: 'forbidden' })
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAttribute('data-tip', 'Requires editor')
    await user.click(btn)
    expect(run).not.toHaveBeenCalled()
    expect(await screen.findByText('Requires editor', { selector: '.toast *' })).toBeInTheDocument()
  })

  it.each([
    ['ask', 'viewer'],
    ['read_facts', 'viewer'],
    ['retire_fact', 'editor'],
    ['restore_fact', 'editor'],
    ['correct_fact', 'editor'],
    ['resolve_conflict', 'editor'],
    ['manage_sources', 'admin'],
    ['manage_mail', 'admin'],
    ['manage_members', 'admin'],
    ['admin_demo', 'owner'],
    ['something_new', 'owner'],
  ])('%s names "%s" as the role it needs', (perm, role) => {
    renderWithApp(<Probe perm={perm} run={() => {}} />, { me: null })
    expect(screen.getByRole('button')).toHaveAttribute('data-tip', `Requires ${role}`)
  })

  it('names the lowest role that really has each permission', () => {
    // The tooltip table in perm.ts has to agree with the roles of the backend (api/app/access.py).
    const order = ['viewer', 'editor', 'admin', 'owner'] as const
    for (const perm of PERMISSIONS.owner) {
      const lowest = order.find((r) => (PERMISSIONS[r] as string[]).includes(perm))!
      const { unmount } = renderWithApp(<Probe perm={perm} run={() => {}} />, { me: null })
      expect(screen.getByRole('button'), perm).toHaveAttribute('data-tip', `Requires ${lowest}`)
      unmount()
    }
  })

  it('nobody is allowed anything before the identity is known', () => {
    renderWithApp(<Probe perm="ask" run={() => {}} />, { me: null })
    expect(screen.getByRole('button', { name: 'forbidden' })).toBeInTheDocument()
  })

  it('explains in the current language', () => {
    storeLocale('it')
    try {
      renderWithApp(<Probe perm="manage_sources" run={() => {}} />, as('luca'))
      expect(screen.getByRole('button')).toHaveAttribute('data-tip', 'Richiede il ruolo amministratore')
    } finally {
      storeLocale('en')
    }
  })
})
