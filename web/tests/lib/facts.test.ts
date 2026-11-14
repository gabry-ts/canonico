import { describe, expect, it } from 'vitest'
import { bindingOf, docLabel, factState, headline, heldByPin, shortDoc } from '../../src/lib/facts'
import { fact } from '../helpers/fixtures'

describe('shortDoc', () => {
  it('keeps the last path segment', () => {
    expect(shortDoc('07-documents/report-final')).toBe('report-final')
    expect(shortDoc('03-internal-comms/email/email-internal-001')).toBe('email-internal-001')
  })

  it('returns the id itself when there is no folder or the id ends with a slash', () => {
    expect(shortDoc('handbook')).toBe('handbook')
    expect(shortDoc('library/')).toBe('library/')
  })
})

describe('docLabel', () => {
  it.each([
    ['07-documents/report-final', 'final report'],
    ['07-documents/presentation-interim', 'presentation interim'],
    ['05-meetings/meeting-005-final-presentation', 'final presentation'],
    ['05-meetings/meeting-002-discovery-ops', 'discovery ops'],
    ['02-subject/observation-001-onboarding', 'onboarding'],
    ['02-subject/observation-002-v2-client-intake', 'client intake'],
    ['03-internal-comms/email/email-internal-001', 'email 001'],
    ['04-external-comms/email/email-external-012', 'email 012'],
    ['01-scope/statement-of-work', 'statement of work'],
    ['library/onboarding_standard', 'onboarding standard'],
    ['01-scope/requirements', 'requirements'],
  ])('%s -> %s', (id, label) => {
    expect(docLabel(id)).toBe(label)
  })

  it('falls back to the short id when nothing readable is left', () => {
    expect(docLabel('05-meetings/meeting-001')).toBe('meeting-001')
    expect(docLabel('x/---')).toBe('---')
  })
})

describe('bindingOf', () => {
  it('is null without facts or without an active one', () => {
    expect(bindingOf([])).toBeNull()
    expect(bindingOf([fact({ status: 'retired' })])).toBeNull()
  })

  it('picks the latest active fact', () => {
    const old = fact({ id: 'M-1', date: '2025-08-22' })
    const recent = fact({ id: 'M-2', date: '2025-11-28' })
    expect(bindingOf([recent, old])?.id).toBe('M-2')
    expect(bindingOf([old, recent])?.id).toBe('M-2')
  })

  it('on equal dates the later fact in the list wins', () => {
    const a = fact({ id: 'M-1', date: '2025-11-28' })
    const b = fact({ id: 'M-2', date: '2025-11-28' })
    expect(bindingOf([a, b])?.id).toBe('M-2')
  })

  it('never picks a retired, superseded or open fact', () => {
    const facts = [
      fact({ id: 'M-1', date: '2025-08-01' }),
      fact({ id: 'M-2', date: '2025-12-01', status: 'retired' }),
      fact({ id: 'M-3', date: '2025-12-02', type: 'SUPERSEDED' }),
      fact({ id: 'M-4', date: '2025-12-03', type: 'OPEN' }),
    ]
    expect(bindingOf(facts)?.id).toBe('M-1')
  })

  it('a pinned active fact beats a newer one', () => {
    const pinned = fact({ id: 'M-1', date: '2025-08-01', pinned: true })
    const newer = fact({ id: 'M-2', date: '2025-12-01' })
    expect(bindingOf([pinned, newer])?.id).toBe('M-1')
  })

  it('with several pinned facts the latest pinned one wins', () => {
    const facts = [fact({ id: 'M-1', date: '2025-08-01', pinned: true }), fact({ id: 'M-2', date: '2025-09-01', pinned: true }), fact({ id: 'M-3', date: '2025-12-01' })]
    expect(bindingOf(facts)?.id).toBe('M-2')
  })

  it('ignores the pin of a retired fact', () => {
    const facts = [fact({ id: 'M-1', date: '2025-08-01', pinned: true, status: 'retired' }), fact({ id: 'M-2', date: '2025-07-01' })]
    expect(bindingOf(facts)?.id).toBe('M-2')
  })

  it('a pinned superseded fact is still binding: the pin is the human decision', () => {
    const facts = [fact({ id: 'M-1', type: 'SUPERSEDED', pinned: true }), fact({ id: 'M-2' })]
    expect(bindingOf(facts)?.id).toBe('M-1')
  })
})

describe('heldByPin', () => {
  const pinned = fact({ id: 'M-1', date: '2025-08-01', pinned: true })

  it('is empty without a binding fact or when the binding fact is not pinned', () => {
    const newer = fact({ id: 'M-2', date: '2025-12-01' })
    expect(heldByPin([newer], null)).toEqual([])
    expect(heldByPin([newer], fact({ id: 'M-1', date: '2025-08-01' }))).toEqual([])
  })

  it('lists the active facts newer than the pinned one', () => {
    const newer = fact({ id: 'M-2', date: '2025-12-01' })
    const older = fact({ id: 'M-3', date: '2025-07-01' })
    const sameDay = fact({ id: 'M-4', date: '2025-08-01' })
    expect(heldByPin([pinned, newer, older, sameDay], pinned).map((f) => f.id)).toEqual(['M-2'])
  })

  it('leaves out retired, superseded and open facts', () => {
    const facts = [
      pinned,
      fact({ id: 'M-2', date: '2025-12-01', status: 'retired' }),
      fact({ id: 'M-3', date: '2025-12-01', type: 'SUPERSEDED' }),
      fact({ id: 'M-4', date: '2025-12-01', type: 'OPEN' }),
    ]
    expect(heldByPin(facts, pinned)).toEqual([])
  })
})

describe('factState', () => {
  it('retired wins over everything else', () => {
    const f = fact({ status: 'retired', pinned: true, type: 'OPEN' })
    expect(factState(f, f, [f])).toEqual({ key: 'retired', cls: 'retired', label: 'fact.status.retired', dim: true })
  })

  it('the binding fact of the topic', () => {
    const f = fact()
    expect(factState(f, f)).toEqual({ key: 'binding', cls: 'binding', label: 'fact.status.binding', dim: false })
  })

  it('a newer fact held back by a pin', () => {
    const pinned = fact({ id: 'M-1', pinned: true })
    const newer = fact({ id: 'M-2' })
    expect(factState(newer, pinned, [newer]).key).toBe('held')
  })

  it('superseded by type is dimmed', () => {
    expect(factState(fact({ type: 'SUPERSEDED' }), null)).toMatchObject({ key: 'superseded', dim: true })
  })

  it('an open question', () => {
    expect(factState(fact({ type: 'OPEN' }))).toMatchObject({ key: 'open', cls: 'open', label: 'fact.status.open', dim: false })
  })

  it.each(['DECISION', 'CONSTRAINT'] as const)('a replaced %s nobody retired is "still active"', (type) => {
    expect(factState(fact({ type, superseded_by: 'M-200' }))).toEqual({ key: 'conflict', cls: 'conflict', label: 'fact.status.stillActive', dim: false })
  })

  it.each(['EVIDENCE', 'HYPOTHESIS'] as const)('a replaced %s is just superseded', (type) => {
    expect(factState(fact({ type, superseded_by: 'M-200' }))).toMatchObject({ key: 'superseded', dim: true })
  })

  it('anything else is plain active, with the "ok" badge', () => {
    expect(factState(fact())).toEqual({ key: 'active', cls: 'ok', label: 'fact.status.active', dim: false })
    expect(factState(fact({ id: 'M-1' }), fact({ id: 'M-2' }))).toMatchObject({ key: 'active' })
  })
})

describe('headline', () => {
  it('takes the first sentence', () => {
    expect(headline('Three to four weeks. That is the target since November.')).toBe('Three to four weeks.')
    expect(headline('Is it settled? Not yet.')).toBe('Is it settled?')
    expect(headline('Done! Next.')).toBe('Done!')
  })

  it('does not cut inside a number or an abbreviation without a following space', () => {
    expect(headline('It costs 3.5 days per audit. More later.')).toBe('It costs 3.5 days per audit.')
  })

  it('returns the whole trimmed text when there is no sentence end', () => {
    expect(headline('  no full stop here  ')).toBe('no full stop here')
    expect(headline('')).toBe('')
  })
})
