import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Route } from '../../src/lib/router'
import Topbar, { TopbarActions } from '../../src/shell/Topbar'
import { me, MEMBERS } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const at = (r: Route['r'], sub: string | null = null): Route => ({ r, sub })
const crumbs = () => within(screen.getByRole('navigation', { name: 'Breadcrumb' }))

describe('Topbar', () => {
  describe('breadcrumb', () => {
    it('is the project and the screen in project scope', () => {
      renderWithApp(<Topbar route={at('memory')} onNav={() => {}} />)
      expect(crumbs().getByText('ClearPath engagement')).toBeInTheDocument()
      expect(crumbs().getByText('Memory')).toBeInTheDocument()
    })

    it('is the organisation and the screen in organisation scope', () => {
      renderWithApp(<Topbar route={at('conflicts')} onNav={() => {}} />, { scope: 'org' })
      expect(crumbs().getByText('Meridian Labs')).toBeInTheDocument()
      expect(crumbs().getByText('Conflicts')).toBeInTheDocument()
    })

    it.each(['settings', 'admin', 'audit'] as const)('%s always belongs to the organisation', (r) => {
      renderWithApp(<Topbar route={at(r)} onNav={() => {}} />)
      expect(crumbs().getByText('Meridian Labs')).toBeInTheDocument()
      expect(crumbs().queryByText('ClearPath engagement')).not.toBeInTheDocument()
    })

    it('the project overview reads "Projects › project name"', () => {
      renderWithApp(<Topbar route={at('projects', 'proj-internal')} onNav={() => {}} />, { projectId: 'proj-internal' })
      expect(crumbs().getByText('Projects')).toBeInTheDocument()
      expect(crumbs().getByText('Internal')).toBeInTheDocument()
    })

    it('falls back to the screen name while there is no project', () => {
      renderWithApp(<Topbar route={at('projects')} onNav={() => {}} />, { projects: [], project: undefined })
      expect(crumbs().getByText('Overview')).toBeInTheDocument()
    })
  })

  describe('scope switch', () => {
    it('is on the Ask screen only', () => {
      const { unmount } = renderWithApp(<Topbar route={at('app')} onNav={() => {}} />)
      expect(screen.getByRole('group', { name: 'Scope' })).toBeInTheDocument()
      unmount()
      renderWithApp(<Topbar route={at('memory')} onNav={() => {}} />)
      expect(screen.queryByRole('group', { name: 'Scope' })).not.toBeInTheDocument()
    })

    it('marks the current scope and switches it', async () => {
      const { user, app } = renderWithApp(<Topbar route={at('app')} onNav={() => {}} />)
      const group = within(screen.getByRole('group', { name: 'Scope' }))
      expect(group.getByRole('button', { name: 'Project' })).toHaveClass('on')
      expect(group.getByRole('button', { name: 'Organisation' })).not.toHaveClass('on')
      await user.click(group.getByRole('button', { name: 'Organisation' }))
      expect(app.setScope).toHaveBeenCalledWith('org')
      await user.click(group.getByRole('button', { name: 'Project' }))
      expect(app.setScope).toHaveBeenCalledWith('project')
    })

    it('marks Organisation in organisation scope', () => {
      renderWithApp(<Topbar route={at('app')} onNav={() => {}} />, { scope: 'org' })
      expect(within(screen.getByRole('group', { name: 'Scope' })).getByRole('button', { name: 'Organisation' })).toHaveClass('on')
    })
  })

  it('the menu button opens the navigation', async () => {
    const onNav = vi.fn()
    const { user } = renderWithApp(<Topbar route={at('app')} onNav={onNav} />)
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(onNav).toHaveBeenCalledTimes(1)
  })

  it('shows who is acting, with their title', () => {
    renderWithApp(<Topbar route={at('app')} onNav={() => {}} />, { me: me({ as: MEMBERS.sara, title: 'Analyst' }) })
    const who = screen.getByRole('button', { name: 'Demo identity' })
    expect(who).toHaveTextContent('Sara')
    expect(who).toHaveTextContent('· Analyst')
  })

  it('shows a placeholder until the identity is known', () => {
    renderWithApp(<Topbar route={at('app')} onNav={() => {}} />, { me: null })
    expect(screen.getByRole('button', { name: 'Demo identity' })).toHaveTextContent('…')
  })

  it('has the language and theme controls', () => {
    renderWithApp(<Topbar route={at('app')} onNav={() => {}} />)
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument()
  })

  it('hosts the primary action of the current screen', () => {
    renderWithApp(
      <>
        <Topbar route={at('memory')} onNav={() => {}} />
        <TopbarActions>
          <button>Export</button>
        </TopbarActions>
      </>,
    )
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('button', { name: 'Export' }))
  })
})
