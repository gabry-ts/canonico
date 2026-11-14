import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTheme } from '../../src/lib/theme'
import { setSystemDark, systemThemeListeners } from '../setup'

const isDark = () => document.documentElement.classList.contains('dark')

describe('useTheme', () => {
  it('follows the system by default', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
    expect(isDark()).toBe(false)
    expect(localStorage.getItem('canonico-theme')).toBeNull()
  })

  it('is dark when the system is dark', () => {
    setSystemDark(true)
    renderHook(() => useTheme())
    expect(isDark()).toBe(true)
  })

  it('follows the system when it changes, while on "system"', () => {
    renderHook(() => useTheme())
    act(() => setSystemDark(true))
    expect(isDark()).toBe(true)
    act(() => setSystemDark(false))
    expect(isDark()).toBe(false)
  })

  it('starts from the saved choice', () => {
    localStorage.setItem('canonico-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark')
    expect(isDark()).toBe(true)
  })

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('canonico-theme', 'sepia')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
  })

  it('applies and remembers an explicit choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('dark'))
    expect(result.current[0]).toBe('dark')
    expect(isDark()).toBe(true)
    expect(localStorage.getItem('canonico-theme')).toBe('dark')

    act(() => result.current[1]('light'))
    expect(isDark()).toBe(false)
    expect(localStorage.getItem('canonico-theme')).toBe('light')
  })

  it('an explicit choice does not follow the system', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('light'))
    expect(systemThemeListeners()).toBe(0)
    act(() => setSystemDark(true))
    expect(isDark()).toBe(false)
  })

  it('going back to "system" forgets the choice and follows the system again', () => {
    localStorage.setItem('canonico-theme', 'light')
    setSystemDark(true)
    const { result } = renderHook(() => useTheme())
    expect(isDark()).toBe(false)
    act(() => result.current[1]('system'))
    expect(isDark()).toBe(true)
    expect(localStorage.getItem('canonico-theme')).toBeNull()
    expect(systemThemeListeners()).toBe(1)
  })

  it('stops listening to the system when unmounted', () => {
    const { unmount } = renderHook(() => useTheme())
    expect(systemThemeListeners()).toBe(1)
    unmount()
    expect(systemThemeListeners()).toBe(0)
  })

  it('works when storage is not available', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('system')
    act(() => result.current[1]('dark'))
    expect(isDark()).toBe(true)
  })
})
