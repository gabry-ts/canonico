import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Route } from '../../src/lib/router'
import Sidebar from '../../src/shell/Sidebar'
import { api, deferred, fail } from '../helpers/api'
import { me, MEMBERS, project, source, stats } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'

const at = (r: Route['r'], sub: string | null = null): Route => ({ r, sub })
const link = (name: RegExp | string) => screen.getByRole('link', { name })

describe('Sidebar', () => {
  describe('navigation', () => {
    it('links to every screen and marks the current one', () => {
      renderWithApp(<Sidebar route={at('memory')} open={false} onPalette={() => {}} />, { stats: null })
      const hrefs = Object.fromEntries(
        ['Home', 'Ask', 'Memory', 'Conflicts', 'Open questions', 'Maintenance', 'Sources', 'Audit log', 'Settings', 'Demo control'].map((n) => [n, link(n).getAttribute('href')]),
      )
      expect(hrefs).toEqual({
        Home: '#/dashboard',
        Ask: '#/app',
        Memory: '#/memory',
        Conflicts: '#/conflicts',
        'Open questions': '#/open-questions',
        Maintenance: '#/maintenance',
        Sources: '#/sources',
        'Audit log': '#/audit',
        Settings: '#/settings',
        'Demo control': '#/admin',
      })
      expect(link('Memory')).toHaveAttribute('aria-current', 'page')
      expect(link('Memory')).toHaveClass('on')
      expect(link('Ask')).not.toHaveAttribute('aria-current')
    })

    it('shows the counters of the current scope', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, {
        stats: stats({ facts_total: 1234, open_conflicts: 2, open_questions: 3, maintenance_pending: 4 }),
      })
      expect(link(/^Memory/)).toHaveTextContent('1,234')
      expect(within(link(/^Conflicts/)).getByText('2')).toHaveClass('count', 'warn')
      expect(within(link(/^Open questions/)).getByText('3')).toHaveClass('count', 'violet')
      expect(within(link(/^Maintenance/)).getByText('4')).toHaveClass('count')
    })

    it('prefers the "needs attention" count of open conflicts', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, {
        stats: stats({ open_conflicts: 2, needs_attention: { conflicts_open: 5 } }),
      })
      expect(within(link(/^Conflicts/)).getByText('5')).toBeInTheDocument()
    })

    it('hides counters that are zero, and all of them until the stats arrive', () => {
      const { unmount } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, {
        stats: stats({ facts_total: 0, open_conflicts: 0, open_questions: 0, maintenance_pending: 0 }),
      })
      expect(link(/^Memory/)).toHaveTextContent('Memory0')
      expect(link(/^Conflicts/)).toHaveTextContent(/^Conflicts$/)
      expect(link(/^Open questions/)).toHaveTextContent(/^Open questions$/)
      expect(link(/^Maintenance/)).toHaveTextContent(/^Maintenance$/)
      unmount()
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { stats: null })
      expect(link(/^Memory/)).toHaveTextContent(/^Memory$/)
    })

    it('shows the organisation, linking to its settings', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      expect(link(/Meridian Labs/)).toHaveAttribute('href', '#/settings')
    })

    it('opens the command palette from the search button', async () => {
      const onPalette = vi.fn()
      const { user } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={onPalette} />)
      await user.click(screen.getByRole('button', { name: /Search or jump to/ }))
      expect(onPalette).toHaveBeenCalledTimes(1)
    })

    it('locks Demo control for everyone but the owner', () => {
      const { unmount } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { me: me({ as: MEMBERS.marco }) })
      expect(link('Demo control').querySelectorAll('svg')).toHaveLength(2)
      unmount()
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      expect(link('Demo control').querySelectorAll('svg')).toHaveLength(1)
    })

    it('is hidden on small screens until opened', () => {
      const { rerender } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      const nav = screen.getByRole('complementary', { name: 'Primary' })
      expect(nav).toHaveClass('hidden', 'lg:flex')
      rerender(<Sidebar route={at('app')} open onPalette={() => {}} />)
      expect(nav).toHaveClass('fixed')
      expect(nav).not.toHaveClass('hidden')
    })

    it('shows who is acting with title and role', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { me: me({ as: MEMBERS.sara, title: 'Analyst' }) })
      const who = screen.getByRole('button', { name: /Sara Conti/ })
      expect(who).toHaveTextContent('Analyst · editor')
      expect(who).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('shows only the role when the person has no title', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { me: me({ as: MEMBERS.luca, title: null }) })
      expect(screen.getByRole('button', { name: /Luca Neri/ })).toHaveTextContent(/Luca Neriviewer$/)
    })
  })

  describe('scope', () => {
    it('toggles between the project and the whole organisation', async () => {
      const { user, app } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      const whole = screen.getByRole('button', { name: 'Whole organisation' })
      expect(whole).toHaveAttribute('aria-pressed', 'false')
      await user.click(whole)
      expect(app.setScope).toHaveBeenCalledWith('org')
    })

    it('goes back to the project when already on the organisation', async () => {
      const { user, app } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { scope: 'org' })
      const whole = screen.getByRole('button', { name: 'Whole organisation' })
      expect(whole).toHaveAttribute('aria-pressed', 'true')
      expect(whole).toHaveClass('on')
      await user.click(whole)
      expect(app.setScope).toHaveBeenCalledWith('project')
    })
  })

  describe('projects', () => {
    it('lists the projects and marks the others as isolated', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      expect(screen.getByRole('button', { name: 'ClearPath engagement' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Internalisolated' })).toBeInTheDocument()
    })

    it('highlights the current project only on its overview', () => {
      const { rerender } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />)
      expect(screen.getByRole('button', { name: 'ClearPath engagement' })).not.toHaveClass('on')
      rerender(<Sidebar route={at('projects', 'proj-clearpath')} open={false} onPalette={() => {}} />)
      expect(screen.getByRole('button', { name: 'ClearPath engagement' })).toHaveClass('on')
    })

    it('choosing a project selects it, returns to project scope and opens its overview', async () => {
      const { user, app } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { scope: 'org' })
      await user.click(screen.getByRole('button', { name: 'Internalisolated' }))
      expect(app.setProjectId).toHaveBeenCalledWith('proj-internal')
      expect(app.setScope).toHaveBeenCalledWith('project')
      expect(location.hash).toBe('#/projects/proj-internal')
    })

    it('lists the sources of the current project with name, size and status', () => {
      renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, {
        sources: [
          source({ id: 's-docs', type: 'documents', label: 'ClearPath documents', items: 46, status: 'ok' }),
          source({ id: 's-lib', type: 'document_library', label: 'ClearPath library', items: 1200, status: 'syncing' }),
          source({ id: 's-mail', type: 'mail', label: 'Inbox', items: 0, status: 'error' }),
          source({ id: 's-hook', type: 'webhook', label: 'Meeting notes hook', items: undefined, status: 'idle' }),
          source({ id: 's-gh', type: 'github', label: 'meridian/tooling', items: 3 }),
        ],
      })
      const names = ['Documents46', 'Document library1,200', 'Mail0', 'Meeting notes hook', 'meridian/tooling3']
      for (const name of names) expect(screen.getByRole('button', { name })).toBeInTheDocument()
      const dot = (name: string) => screen.getByRole('button', { name }).querySelector('.dot')!
      expect(dot('Documents46').className).toBe('dot ')
      expect(dot('Document library1,200')).toHaveClass('sync')
      expect(dot('Mail0')).toHaveClass('warn')
      expect(dot('Meeting notes hook')).toHaveClass('idle')
    })

    it('a source opens inside its project overview', async () => {
      const { user } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { sources: [source({ id: 's-docs' })] })
      await user.click(screen.getByRole('button', { name: 'Documents46' }))
      expect(location.hash).toBe('#/projects/proj-clearpath/s-docs')
    })
  })

  describe('new project', () => {
    const open = async (over = {}) => {
      const view = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, over)
      await view.user.click(screen.getByRole('button', { name: 'New project' }))
      return view
    }

    it('needs a name', async () => {
      const { user } = await open()
      const dialog = within(screen.getByRole('dialog'))
      expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled()
      await user.type(dialog.getByLabelText('Name'), '   ')
      expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled()
      await user.keyboard('{Enter}')
      expect(api.calls).toHaveLength(0)
    })

    it('creates the project, switches to it, opens its overview and confirms', async () => {
      api.post('/projects', (req) => project({ id: 'proj-new', ...(req.body as object) }))
      const { user, app } = await open()
      const dialog = within(screen.getByRole('dialog'))
      await user.type(dialog.getByLabelText('Name'), '  Northwind audit ')
      await user.type(dialog.getByLabelText('Description'), ' Year-end audit ')
      await user.click(dialog.getByRole('button', { name: 'Create project' }))

      expect(await screen.findByText('Project Northwind audit created')).toBeInTheDocument()
      expect(api.last('POST', '/projects')!.body).toEqual({ name: 'Northwind audit', description: 'Year-end audit' })
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(app.setProjectId).toHaveBeenCalledWith('proj-new')
      expect(location.hash).toBe('#/projects/proj-new')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('sends no description when it is empty, and Enter in the name submits', async () => {
      api.post('/projects', project({ id: 'proj-new', name: 'Northwind' }))
      const { user } = await open()
      await user.type(within(screen.getByRole('dialog')).getByLabelText('Name'), 'Northwind{Enter}')
      await waitFor(() => expect(api.last('POST', '/projects')?.body).toEqual({ name: 'Northwind' }))
    })

    it('cannot be sent twice while it is being created', async () => {
      const gate = deferred()
      api.post('/projects', () => gate.promise)
      const { user } = await open()
      const dialog = within(screen.getByRole('dialog'))
      await user.type(dialog.getByLabelText('Name'), 'Northwind')
      await user.click(dialog.getByRole('button', { name: 'Create project' }))
      expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled()
      await user.type(dialog.getByLabelText('Name'), '{Enter}')
      expect(api.callsTo('POST', '/projects')).toHaveLength(1)
      gate.resolve(project({ id: 'proj-new', name: 'Northwind' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('says why when it fails and keeps the dialog with what was typed', async () => {
      api.post('/projects', fail(409, 'A project with this name exists.'))
      const { user, app } = await open()
      const dialog = within(screen.getByRole('dialog'))
      await user.type(dialog.getByLabelText('Name'), 'Internal')
      await user.click(dialog.getByRole('button', { name: 'Create project' }))
      expect(await screen.findByText('That did not work. A project with this name exists.')).toBeInTheDocument()
      expect(dialog.getByLabelText('Name')).toHaveValue('Internal')
      expect(dialog.getByRole('button', { name: 'Create project' })).toBeEnabled()
      expect(app.setProjectId).not.toHaveBeenCalled()
      expect(location.hash).toBe('')
    })

    it('Cancel closes the dialog', async () => {
      const { user } = await open()
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('an editor cannot create projects', async () => {
      const { user } = renderWithApp(<Sidebar route={at('app')} open={false} onPalette={() => {}} />, { me: me({ as: MEMBERS.sara }) })
      const add = screen.getByRole('button', { name: 'New project' })
      expect(add).toHaveAttribute('aria-disabled', 'true')
      expect(add).toHaveAttribute('data-tip', 'Requires admin')
      await user.click(add)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Requires admin', { selector: '.toast *' })).toBeInTheDocument()
    })
  })
})
