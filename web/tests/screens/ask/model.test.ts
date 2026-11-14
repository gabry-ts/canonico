import { describe, expect, it } from 'vitest'
import { sep, sourceLabel, splitValue, viewOf, type Chain, type ChainFact } from '../../../src/screens/ask/model'
import { fact, topic } from '../../helpers/fixtures'

const chainFact = (over: Partial<ChainFact> = {}): ChainFact => ({ ...fact(), ...over })
const chain = (facts: ChainFact[]): Chain => ({ topic: topic(), facts })

describe('sourceLabel', () => {
  it('labels a corpus document from its id', () => {
    expect(sourceLabel(fact({ doc_id: '07-documents/report-final' }))).toBe('final report')
  })

  it('ignores a title on a corpus document', () => {
    expect(sourceLabel(chainFact({ doc_id: '07-documents/report-final', doc_title: 'Final report v3' }))).toBe('final report')
  })

  it.each(['mail/msg-1', 'library/onboarding-standard', 'upload/notes', 'uploads/notes'])('uses the title of %s', (doc_id) => {
    expect(sourceLabel(chainFact({ doc_id, doc_title: 'Onboarding standard v2' }))).toBe('Onboarding standard v2')
  })

  it('shortens the "Email:" prefix of a mail title', () => {
    expect(sourceLabel(chainFact({ doc_id: 'mail/msg-1', doc_title: 'Email: Turnaround update' }))).toBe('email · Turnaround update')
    expect(sourceLabel(chainFact({ doc_id: 'mail/msg-1', doc_title: 'EMAIL:Turnaround update' }))).toBe('email · Turnaround update')
  })

  it('takes the title from the map when the fact has none', () => {
    const titles = { 'library/onboarding-standard': 'Onboarding standard v2' }
    expect(sourceLabel(fact({ doc_id: 'library/onboarding-standard' }), titles)).toBe('Onboarding standard v2')
    expect(sourceLabel(chainFact({ doc_id: 'library/onboarding-standard', doc_title: null }), titles)).toBe('Onboarding standard v2')
  })

  it('the title on the fact wins over the map', () => {
    expect(sourceLabel(chainFact({ doc_id: 'library/x', doc_title: 'From the fact' }), { 'library/x': 'From the map' })).toBe('From the fact')
  })

  it('falls back to the id label without a title', () => {
    expect(sourceLabel(fact({ doc_id: 'library/onboarding-standard' }))).toBe('onboarding standard')
    expect(sourceLabel(fact({ doc_id: 'library/onboarding-standard' }), {})).toBe('onboarding standard')
  })
})

describe('viewOf', () => {
  it('is empty without a chain', () => {
    expect(viewOf(undefined)).toEqual({ binding: null, replaced: [], stillActive: [], retired: [] })
    expect(viewOf(chain([]))).toEqual({ binding: null, replaced: [], stillActive: [], retired: [] })
  })

  it('splits a chain into the binding fact, what it replaced, what is still active and what is retired', () => {
    const binding = chainFact({ id: 'M-106', date: '2025-11-28' })
    const replaced = chainFact({ id: 'M-101', date: '2025-08-22', type: 'SUPERSEDED', superseded_by: 'M-106' })
    const stillActive = chainFact({ id: 'M-105', date: '2025-10-01', type: 'DECISION', superseded_by: 'M-106' })
    const retired = chainFact({ id: 'M-100', date: '2025-07-01', status: 'retired' })
    const v = viewOf(chain([replaced, stillActive, retired, binding]))
    expect(v.binding?.id).toBe('M-106')
    expect(v.replaced.map((f) => f.id)).toEqual(['M-101'])
    expect(v.stillActive.map((f) => f.id)).toEqual(['M-105'])
    expect(v.retired.map((f) => f.id)).toEqual(['M-100'])
  })

  it('uses the binding fact the answer names', () => {
    const a = chainFact({ id: 'M-1', date: '2025-08-01' })
    const b = chainFact({ id: 'M-2', date: '2025-11-01' })
    expect(viewOf(chain([a, b]), 'M-1').binding?.id).toBe('M-1')
  })

  it('ignores a named binding fact that is retired or not in the chain', () => {
    const a = chainFact({ id: 'M-1', date: '2025-08-01', status: 'retired' })
    const b = chainFact({ id: 'M-2', date: '2025-11-01' })
    expect(viewOf(chain([a, b]), 'M-1').binding?.id).toBe('M-2')
    expect(viewOf(chain([a, b]), 'M-999').binding?.id).toBe('M-2')
    expect(viewOf(chain([a, b]), null).binding?.id).toBe('M-2')
  })

  it('a replaced EVIDENCE fact is not "still active"', () => {
    const binding = chainFact({ id: 'M-2', date: '2025-11-01' })
    const evidence = chainFact({ id: 'M-1', date: '2025-08-01', type: 'EVIDENCE', superseded_by: 'M-2' })
    const v = viewOf(chain([evidence, binding]))
    expect(v.stillActive).toEqual([])
    expect(v.replaced).toEqual([])
  })

  it('a retired superseded fact is listed as retired only', () => {
    const binding = chainFact({ id: 'M-2', date: '2025-11-01' })
    const old = chainFact({ id: 'M-1', type: 'SUPERSEDED', status: 'retired', superseded_by: 'M-2' })
    const v = viewOf(chain([old, binding]))
    expect(v.replaced).toEqual([])
    expect(v.retired.map((f) => f.id)).toEqual(['M-1'])
  })

  it('has no binding fact when everything is retired', () => {
    const v = viewOf(chain([chainFact({ id: 'M-1', status: 'retired' })]))
    expect(v.binding).toBeNull()
    expect(v.retired).toHaveLength(1)
  })
})

describe('splitValue', () => {
  it('separates a trailing note in brackets', () => {
    expect(splitValue('3–4 business days (Marco Fiore, audit team lead)')).toEqual(['3–4 business days', 'Marco Fiore, audit team lead'])
    expect(splitValue('5 weeks(draft)  ')).toEqual(['5 weeks', 'draft'])
  })

  it('leaves a value without brackets alone', () => {
    expect(splitValue('3–4 weeks')).toEqual(['3–4 weeks', null])
    expect(splitValue('')).toEqual(['', null])
  })

  it('only splits on brackets at the end', () => {
    expect(splitValue('(roughly) 6 weeks')).toEqual(['(roughly) 6 weeks', null])
  })

  it('takes the last pair of brackets', () => {
    expect(splitValue('6 weeks (baseline) (project brief)')).toEqual(['6 weeks (baseline)', 'project brief'])
  })
})

describe('sep', () => {
  it('writes September with three letters', () => {
    expect(sep('12 Sept 2025')).toBe('12 Sep 2025')
    expect(sep('12 Sep 2025')).toBe('12 Sep 2025')
    expect(sep('12 September 2025')).toBe('12 September 2025')
    expect(sep('28 Nov 2025')).toBe('28 Nov 2025')
  })
})
