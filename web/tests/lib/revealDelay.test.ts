import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealConfig, revealDelayMs, sleep } from '../../src/lib/revealDelay'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('revealDelayMs', () => {
  it('is zero when disabled', () => {
    expect(revealDelayMs(100)).toBe(0)
  })

  it('stays between 1.2 s and 2.5 s and grows with the answer', () => {
    revealConfig.enabled = true
    const rnd = vi.spyOn(Math, 'random')
    rnd.mockReturnValue(0)
    expect(revealDelayMs(0)).toBe(1200)
    expect(revealDelayMs(100)).toBeGreaterThan(1200)
    rnd.mockReturnValue(0.999)
    expect(revealDelayMs(10_000)).toBe(2500)
  })

  it('is a short 600 ms with reduced motion', () => {
    revealConfig.enabled = true
    const mm = window.matchMedia
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: true })) as typeof window.matchMedia
    expect(revealDelayMs(500)).toBe(600)
    window.matchMedia = mm
  })
})

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers()
    let done = false
    void sleep(1000).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})
