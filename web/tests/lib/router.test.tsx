import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { nav, parseHash, routePath, ROUTES, useRoute } from '../../src/lib/router'
import { goto } from '../helpers/render'

describe('parseHash', () => {
  it.each(ROUTES)('knows the route "%s"', (r) => {
    expect(parseHash('#/' + r)).toEqual({ r, sub: null })
  })

  it('an empty or unknown hash is the Ask screen', () => {
    expect(parseHash('')).toEqual({ r: 'app', sub: null })
    expect(parseHash('#')).toEqual({ r: 'app', sub: null })
    expect(parseHash('#/')).toEqual({ r: 'app', sub: null })
    expect(parseHash('#/nope')).toEqual({ r: 'app', sub: null })
  })

  it('#/home is another name for the dashboard', () => {
    expect(parseHash('#/home')).toEqual({ r: 'dashboard', sub: null })
    expect(parseHash('#/home/x')).toEqual({ r: 'dashboard', sub: 'x' })
    expect(parseHash('#/homepage')).toEqual({ r: 'app', sub: null })
  })

  it('keeps the sub-path of an unknown route', () => {
    expect(parseHash('#/nope/x')).toEqual({ r: 'app', sub: 'x' })
  })

  it('reads the part after the route as the sub-path', () => {
    expect(parseHash('#/memory/M-106')).toEqual({ r: 'memory', sub: 'M-106' })
    expect(parseHash('#/projects/proj-clearpath/src-1')).toEqual({ r: 'projects', sub: 'proj-clearpath/src-1' })
    expect(parseHash('#/settings/members')).toEqual({ r: 'settings', sub: 'members' })
  })

  it('accepts a hash without the leading slash', () => {
    expect(parseHash('#memory/M-106')).toEqual({ r: 'memory', sub: 'M-106' })
  })

  it('decodes the sub-path', () => {
    expect(parseHash('#/memory/M%20106')).toEqual({ r: 'memory', sub: 'M 106' })
    expect(parseHash('#/login/memory%2FM-106')).toEqual({ r: 'login', sub: 'memory/M-106' })
  })

  it('a trailing slash is no sub-path', () => {
    expect(parseHash('#/memory/')).toEqual({ r: 'memory', sub: null })
  })

  it('reads the current address by default', () => {
    location.hash = '#/audit'
    expect(parseHash()).toEqual({ r: 'audit', sub: null })
  })
})

describe('routePath', () => {
  it('is the inverse of parseHash', () => {
    expect(routePath({ r: 'memory', sub: null })).toBe('memory')
    expect(routePath({ r: 'memory', sub: 'M-106' })).toBe('memory/M-106')
    expect(routePath(parseHash('#/projects/proj-clearpath/src-1'))).toBe('projects/proj-clearpath/src-1')
  })
})

describe('nav', () => {
  it('goes to the path and adds a history entry, so Back returns', () => {
    const entries = history.length
    nav('memory/M-106')
    expect(location.hash).toBe('#/memory/M-106')
    expect(history.length).toBe(entries + 1)
  })

  it('with replace it goes to the path without adding a history entry', () => {
    nav('login')
    const entries = history.length
    nav('app', { replace: true })
    expect(location.hash).toBe('#/app')
    expect(history.length).toBe(entries)
  })

  it('tells the router', async () => {
    const heard = new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }))
    nav('audit')
    await heard
    expect(parseHash()).toEqual({ r: 'audit', sub: null })
  })
})

describe('useRoute', () => {
  function Probe() {
    const route = useRoute()
    return <div data-testid="route">{routePath(route)}</div>
  }

  it('follows the address', () => {
    location.hash = '#/conflicts'
    render(<Probe />)
    expect(screen.getByTestId('route')).toHaveTextContent('conflicts')
    act(() => goto('memory/M-106'))
    expect(screen.getByTestId('route')).toHaveTextContent('memory/M-106')
  })

  it('stops listening when unmounted', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Probe />)
    unmount()
    expect(remove).toHaveBeenCalledWith('hashchange', expect.any(Function))
  })
})
