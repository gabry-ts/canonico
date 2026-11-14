import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Answer, AskError, Pending, UserMsg, WrongAnswer } from '../../../src/screens/ask/Chat'
import { askResponse, AUDIT, chainFact, contestedResponse, noAnswerResponse, ONBOARDING } from '../../helpers/ask'
import { renderI18n, renderWithApp } from '../../helpers/render'

const compare = () => screen.getByRole('switch', { name: 'Compare with plain retrieval' })

describe('UserMsg', () => {
  it('shows the question with who asked it and when', () => {
    const { container } = renderWithApp(<UserMsg text="How long does onboarding take?" time="10:30" />)
    expect(screen.getByText('How long does onboarding take?')).toBeInTheDocument()
    expect(screen.getByText('10:30')).toBeInTheDocument()
    expect(screen.getByText('Giulia')).toBeInTheDocument()
    expect(container.querySelector('.avatar')).toHaveTextContent('G')
    expect(container.querySelector('.avatar')).not.toHaveClass('sys')
  })

  it('falls back to the system avatar when nobody is known', () => {
    const { container } = renderWithApp(<UserMsg text="Anyone there?" time="10:30" />, { me: null })
    expect(screen.getByText('Anyone there?')).toBeInTheDocument()
    expect(container.querySelector('.avatar')).toHaveClass('sys')
    expect(container.querySelector('.avatar')).not.toHaveTextContent('G')
  })
})

describe('WrongAnswer', () => {
  it('shows the stale figure of the plain assistant, struck through and marked wrong', () => {
    renderWithApp(<WrongAnswer fact={undefined} />)
    expect(screen.getByText('Company assistant')).toBeInTheDocument()
    expect(screen.getByText('plain retrieval')).toBeInTheDocument()
    expect(screen.getByText('Mon 09:12')).toBeInTheDocument()
    expect(screen.getByText('Four weeks.')).toHaveClass('strike')
    expect(screen.getByLabelText('Wrong answer')).toHaveTextContent('Wrong')
  })

  it('cites nothing until the old fact is known', () => {
    renderWithApp(<WrongAnswer fact={undefined} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/from:/)).not.toBeInTheDocument()
  })

  it('cites the document and the date of the old fact, and opens it on click', async () => {
    const { user, app } = renderWithApp(<WrongAnswer fact={ONBOARDING.preview} />)
    expect(screen.getByText(/from:/)).toBeInTheDocument()
    expect(screen.getByText('20 Nov 2025')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'final presentation' }))
    expect(app.openFact).toHaveBeenCalledWith('M-105')
  })

  it('writes September with three letters', () => {
    renderWithApp(<WrongAnswer fact={ONBOARDING.kickoff} />)
    expect(screen.getByText('12 Sep 2025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'kickoff' })).toBeInTheDocument()
  })
})

describe('Answer', () => {
  describe('with a binding fact', () => {
    it('shows the first sentence as the answer, with the binding badge, the source and the verbatim quote', () => {
      renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />)
      expect(screen.getByText('Canonico')).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement')).toBeInTheDocument()
      expect(screen.getByText('10:31')).toBeInTheDocument()
      expect(screen.getByText('binding')).toHaveClass('badge', 'binding')
      expect(screen.getByText('Three to four weeks.')).toBeInTheDocument()
      expect(screen.queryByText(/That is the figure/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'final report' })).toBeInTheDocument()
      expect(screen.getByText('28 Nov 2025')).toBeInTheDocument()
      expect(screen.getByText('No ticket')).toBeInTheDocument()
      expect(screen.getByText('“New consultants should reach autonomy in three to four weeks.”')).toBeInTheDocument()
    })

    it('shows the whole answer when it is not a sentence', () => {
      renderWithApp(<Answer res={askResponse({ answer: '  3–4 weeks  ' })} time="10:31" titles={{}} />)
      expect(screen.getByText('3–4 weeks')).toBeInTheDocument()
    })

    it('opens the binding fact from its citation', async () => {
      const { user, app } = renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />)
      await user.click(screen.getByRole('button', { name: 'final report' }))
      expect(app.openFact).toHaveBeenCalledWith('M-106')
    })

    it('says the whole organisation was asked in organisation scope', () => {
      renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />, { scope: 'org' })
      expect(screen.getByText('Whole organisation')).toBeInTheDocument()
      expect(screen.queryByText('ClearPath engagement')).not.toBeInTheDocument()
    })

    it('cites an email by the title seen in the topic chain', () => {
      const email = chainFact({ id: 'E-301', value: '5 weeks', doc_id: 'mail/msg-301', date: '2026-11-14' })
      renderWithApp(<Answer res={askResponse({ binding: email })} time="10:31" titles={{ 'mail/msg-301': 'Email: Onboarding target confirmed' }} />)
      expect(screen.getByRole('button', { name: 'email · Onboarding target confirmed' })).toBeInTheDocument()
    })

    it('cites an email by its id when no title is known', () => {
      const email = chainFact({ id: 'E-301', value: '5 weeks', doc_id: 'mail/msg-301', date: '2026-11-14' })
      renderWithApp(<Answer res={askResponse({ binding: email })} time="10:31" titles={{}} />)
      expect(screen.getByRole('button', { name: 'msg 301' })).toBeInTheDocument()
    })

    it('says nothing about a change when the answer is the same as before', () => {
      renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />)
      expect(screen.queryByText(/Changed because/)).not.toBeInTheDocument()
      expect(screen.queryByText('Pinned fact wins.')).not.toBeInTheDocument()
    })

    it('explains why the answer changed, without doubling the full stop', () => {
      renderWithApp(<Answer res={askResponse({ changed_because: 'Giulia retired the 4-week figure. ' })} time="10:31" titles={{}} />)
      expect(screen.getByText('Changed because Giulia retired the 4-week figure.')).toBeInTheDocument()
      expect(screen.getByText('The old figure stays in history. Nothing is deleted.')).toBeInTheDocument()
    })

    it('shows no change note for a reason that is only punctuation', () => {
      renderWithApp(<Answer res={askResponse({ changed_because: ' . ' })} time="10:31" titles={{}} />)
      expect(screen.queryByText(/Changed because/)).not.toBeInTheDocument()
    })

    it('says a pinned fact wins, instead of the change', () => {
      const pinned = { ...ONBOARDING.report, pinned: true }
      renderWithApp(<Answer res={askResponse({ binding: pinned, changed_because: 'Giulia pinned it' })} time="10:31" titles={{}} />)
      expect(screen.getByText('Pinned fact wins.')).toBeInTheDocument()
      expect(screen.getByText('3–4 weeks stays binding over newer versions until it is unpinned.')).toBeInTheDocument()
      expect(screen.queryByText(/Changed because/)).not.toBeInTheDocument()
    })
  })

  describe('compare with plain retrieval', () => {
    it('is off until asked for', () => {
      renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />)
      expect(compare()).toHaveAttribute('aria-checked', 'false')
      expect(screen.queryByText(/Plain retrieval · top hit by similarity,/)).not.toBeInTheDocument()
    })

    it('shows the top hit of plain retrieval, scrolls it into view and hides it again', async () => {
      const { user } = renderWithApp(<Answer res={askResponse()} time="10:31" titles={{}} />)
      await user.click(compare())

      expect(compare()).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByText(/Plain retrieval · top hit by similarity,/)).toBeInTheDocument()
      expect(screen.getByText('meeting-005-final-presentation')).toBeInTheDocument()
      expect(screen.getByText('“Onboarding will take four weeks.”')).toBeInTheDocument()
      expect(screen.getByText('Plain retrieval returns the closest text. It does not know which version is current or what was retired.')).toBeInTheDocument()
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })

      await user.click(compare())
      expect(compare()).toHaveAttribute('aria-checked', 'false')
      expect(screen.queryByText('“Onboarding will take four weeks.”')).not.toBeInTheDocument()
    })

    it('says when plain retrieval found nothing', async () => {
      const { user } = renderWithApp(<Answer res={askResponse({ plain_retrieval: undefined })} time="10:31" titles={{}} />)
      await user.click(compare())
      expect(screen.getByText('Plain retrieval returned nothing for this question.')).toBeInTheDocument()
      expect(screen.queryByText(/top hit by similarity/)).not.toBeInTheDocument()
    })
  })

  describe('contested', () => {
    const tile = (name: RegExp) => screen.getByRole('button', { name })

    it('shows the disagreement instead of one value', () => {
      renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      expect(screen.getByText('contested')).toHaveClass('badge', 'contested')
      expect(screen.getByText('No single binding value')).toBeInTheDocument()
      expect(screen.getByText('The team leads give three different estimates and nobody measured the queue.')).toBeInTheDocument()
      expect(screen.getByText('Select an estimate to see its source.')).toBeInTheDocument()
      expect(screen.queryByText('No ticket')).not.toBeInTheDocument()
    })

    it('splits each estimate into the value and who gave it', () => {
      renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      expect(within(tile(/^3–4 business days/)).getByText('Marco Fiore, audit team lead')).toBeInTheDocument()
      expect(within(tile(/^5–7 business days/)).getByText('Sara Conti, delivery lead')).toBeInTheDocument()
      expect(tile(/^2 business days/)).toHaveTextContent(/^2 business days$/)
    })

    it('lays three estimates on three columns and two on two', () => {
      const first = renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      expect(tile(/^2 business days/).parentElement).toHaveClass('grid-cols-3')
      first.unmount()

      renderWithApp(<Answer res={contestedResponse({ conflicts: [AUDIT.marco, AUDIT.sara] })} time="10:32" titles={{}} />)
      expect(tile(/^5–7 business days/).parentElement).toHaveClass('grid-cols-2')
    })

    it('reveals the source of the selected estimate and opens its fact', async () => {
      const { user, app } = renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      await user.click(tile(/^3–4 business days/))

      expect(tile(/^3–4 business days/)).toHaveAttribute('aria-pressed', 'true')
      expect(tile(/^5–7 business days/)).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('“We turn a report around in three to four days.”')).toBeInTheDocument()
      expect(screen.getByText('2 Oct 2025')).toBeInTheDocument()
      expect(screen.queryByText('Select an estimate to see its source.')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'audit review' }))
      expect(app.openFact).toHaveBeenCalledWith('M-201')
    })

    it('switches to another estimate and closes on a second click', async () => {
      const { user } = renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      await user.click(tile(/^3–4 business days/))
      await user.click(tile(/^5–7 business days/))
      expect(tile(/^3–4 business days/)).toHaveAttribute('aria-pressed', 'false')
      expect(tile(/^5–7 business days/)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('“From my side it is closer to a week.”')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'email 012' })).toBeInTheDocument()
      expect(screen.queryByText('“We turn a report around in three to four days.”')).not.toBeInTheDocument()

      await user.click(tile(/^5–7 business days/))
      expect(tile(/^5–7 business days/)).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByText('“From my side it is closer to a week.”')).not.toBeInTheDocument()
      expect(screen.getByText('Select an estimate to see its source.')).toBeInTheDocument()
    })

    it('can be compared with plain retrieval too', async () => {
      const { user } = renderWithApp(<Answer res={contestedResponse()} time="10:32" titles={{}} />)
      await user.click(compare())
      expect(screen.getByText('email-external-012')).toBeInTheDocument()
      expect(screen.getByText('“From my side it is closer to a week.”')).toBeInTheDocument()
    })
  })

  describe('without an answer', () => {
    it('says nothing in memory answers the question', () => {
      renderWithApp(<Answer res={noAnswerResponse()} time="10:33" titles={{}} />)
      expect(screen.getByText('no answer')).toHaveClass('badge', 'line')
      expect(screen.getByText('Nothing in memory answers this')).toBeInTheDocument()
      expect(screen.getByText('No document in this project talks about that.')).toBeInTheDocument()
      expect(screen.getByText('10:33')).toBeInTheDocument()
    })

    it('still offers the comparison with plain retrieval', async () => {
      const { user } = renderWithApp(<Answer res={noAnswerResponse()} time="10:33" titles={{}} />)
      await user.click(compare())
      expect(screen.getByText('Plain retrieval returned nothing for this question.')).toBeInTheDocument()
    })

    it('treats a binding status without a binding fact as no answer', () => {
      renderWithApp(<Answer res={askResponse({ binding: null, answer: 'The binding fact was just retired.' })} time="10:33" titles={{}} />)
      expect(screen.getByText('Nothing in memory answers this')).toBeInTheDocument()
      expect(screen.getByText('The binding fact was just retired.')).toBeInTheDocument()
      expect(screen.queryByText('No ticket')).not.toBeInTheDocument()
    })
  })
})

describe('Pending', () => {
  it('says the memory is being read', () => {
    renderI18n(<Pending />)
    expect(screen.getByText('Canonico')).toBeInTheDocument()
    expect(screen.getByText('Canonico is typing…')).toBeInTheDocument()
  })
})

describe('AskError', () => {
  it('says the question could not be answered and why', () => {
    renderI18n(<AskError message="The model is not reachable" />)
    expect(screen.getByText('The question could not be answered. The model is not reachable')).toBeInTheDocument()
  })
})
