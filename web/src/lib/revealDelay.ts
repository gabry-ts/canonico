/** Natural pause before an answer shows, so the chat feels like someone is writing. */
export const revealConfig = { enabled: true }

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Random 1.2-2.2 s, a little longer for long answers, never above 2.5 s. 600 ms with reduced motion. */
export function revealDelayMs(answerLength: number): number {
  if (!revealConfig.enabled) return 0
  if (reduced()) return 600
  return Math.min(2500, 1200 + Math.random() * 1000 + Math.min(answerLength, 400) * 1.5)
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
