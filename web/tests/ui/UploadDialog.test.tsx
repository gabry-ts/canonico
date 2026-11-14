import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../src/api/client'
import type { AppState } from '../../src/lib/appContext'
import UploadDialog from '../../src/ui/UploadDialog'
import { api, deferred, fail, offline } from '../helpers/api'
import { fact, source, topic } from '../helpers/fixtures'
import { renderWithApp } from '../helpers/render'
import { LIBRARY, libraryDoc, mockLibrary, mutations, PID, pinToday, textFile, TODAY } from '../helpers/sources'

type Item = Schemas['InboundItem']

function result(over: Partial<Schemas['InboundItemResult']> = {}): Schemas['InboundItemResult'] {
  return {
    item_id: 'IT-9',
    project_id: PID,
    routed_by: 'project_id',
    rule_id: null,
    document_id: 'uploads/kickoff',
    facts_created: [],
    supersedes_created: [],
    audit_event_id: null,
    duplicate: false,
    ...over,
  }
}

function open(over: Partial<AppState> = {}, projectId = PID) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const view = renderWithApp(<UploadDialog projectId={projectId} onClose={onClose} onDone={onDone} />, over)
  return { ...view, onClose, onDone }
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const radio = (name: string) => screen.getByRole('radio', { name })
const toast = (text: string) => screen.findByText(text, { selector: '.toast *' })
const tagInput = () => screen.getByRole('textbox', { name: 'Add tag' })
const picker = () => screen.getByLabelText(/or choose a file|click to change/)
const sent = () => api.last('POST', '/projects/:project_id/items')!.body as Item
/** The tags offered under the tag field, in order. */
const suggested = () => {
  const label = screen.queryByText('Suggested')
  return label ? within(label.parentElement!).getAllByRole('button').map((b) => b.textContent) : []
}
/** A line of the result ("Sent to project", "Topic", "Facts created", "Superseded facts"). */
const line = (title: string) => within(screen.getByText(title).parentElement!)

async function fill(user: UserEvent, { title = 'Kickoff', text = 'We agreed on four weeks.' } = {}) {
  await user.type(screen.getByLabelText('Title'), title)
  await user.type(screen.getByLabelText('Text'), text)
}

/** Fills the form, uploads it and waits for the result of the backend. */
async function uploaded(user: UserEvent, answer: Schemas['InboundItemResult'], tags: string[] = []) {
  api.post('/projects/:project_id/items', answer)
  await fill(user)
  for (const tag of tags) await user.type(tagInput(), `${tag}{Enter}`)
  await user.click(button('Upload'))
  await screen.findByRole('heading', { name: answer.duplicate ? 'Already received' : 'Upload processed' })
}

beforeEach(() => {
  pinToday()
  api.get('/tags', [])
  api.get('/topics', [])
  api.get('/projects/:project_id/sources', [])
})

describe('UploadDialog', () => {
  describe('the form', () => {
    it('names the project it uploads to', () => {
      open()
      expect(screen.getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement · meeting transcripts, documents, notes and tickets')).toBeInTheDocument()
      expect(screen.getByText('To ClearPath engagement, unless a tag rule sends it elsewhere')).toBeInTheDocument()
    })

    it('shows the project id when the project is not among the ones the person sees', () => {
      open({}, 'proj-gone')
      expect(screen.getByText('proj-gone · meeting transcripts, documents, notes and tickets')).toBeInTheDocument()
      expect(screen.getByText('To proj-gone, unless a tag rule sends it elsewhere')).toBeInTheDocument()
    })

    it('starts as a meeting dated today, with nothing else filled in', () => {
      open()
      expect(within(screen.getByRole('radiogroup', { name: 'Type' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Meeting', 'Document', 'Note', 'Ticket'])
      expect(radio('Meeting')).toBeChecked()
      expect(radio('Meeting')).toHaveClass('on')
      expect(radio('Document')).not.toBeChecked()
      expect(screen.getByLabelText('Title')).toHaveValue('')
      expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', 'e.g. Steering committee 12 Nov')
      expect(screen.getByLabelText('Date')).toHaveValue(TODAY)
      expect(screen.getByLabelText('Participants')).toHaveValue('')
      expect(screen.getByLabelText('Text')).toHaveValue('')
      expect(screen.getByText('or choose a file · TXT, Markdown, VTT')).toBeInTheDocument()
    })

    it('asks for participants on a meeting, for the document it replaces on a document, for neither otherwise', async () => {
      const { user } = open()
      await user.click(radio('Document'))
      expect(radio('Document')).toBeChecked()
      expect(radio('Meeting')).not.toBeChecked()
      expect(screen.queryByLabelText('Participants')).not.toBeInTheDocument()
      expect(screen.getByLabelText(/^New version of…/)).toHaveValue('')
      expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', 'Title')

      for (const type of ['Note', 'Ticket']) {
        await user.click(radio(type))
        expect(radio(type)).toBeChecked()
        expect(screen.queryByLabelText('Participants')).not.toBeInTheDocument()
        expect(screen.queryByLabelText(/^New version of…/)).not.toBeInTheDocument()
      }
    })

    it('asks the backend for the tags, the topics and the sources of the project', async () => {
      mockLibrary()
      open()
      await waitFor(() => expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(1))
      expect(api.last('GET', '/sources/:source_id/documents')!.params.source_id).toBe('src-library')
      expect(api.last('GET', '/projects/:project_id/sources')!.params.project_id).toBe(PID)
      expect(api.last('GET', '/tags')!.query.get('project_id')).toBe(PID)
      expect(api.last('GET', '/topics')!.query.get('project_id')).toBe(PID)
      expect(api.unhandled).toEqual([])
    })

    it('closes from Cancel, from the close button and with Escape, without uploading', async () => {
      const { user, onClose, onDone } = open()
      await user.click(button('Cancel'))
      expect(onClose).toHaveBeenCalledTimes(1)
      await user.click(button('Close'))
      expect(onClose).toHaveBeenCalledTimes(2)
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(3)
      expect(onDone).not.toHaveBeenCalled()
      expect(mutations()).toEqual([])
    })
  })

  describe('the sample', () => {
    const SAMPLE: Item = {
      type: 'meeting',
      title: 'Steering committee 12 Nov',
      date: '2026-11-12T09:00:00Z',
      text: 'We agreed the onboarding target stays at 3–4 weeks.',
      tags: ['clearpath', 'meeting', 'topic:onboarding-target'],
      participants: ['Sara Conti', 'Marco Bianchi'],
    }

    it('is offered in the sample project and fills the whole form', async () => {
      const { user } = open()
      expect(screen.getByText('Sample:')).toBeInTheDocument()
      await user.click(radio('Note'))
      await user.click(button('Fill sample'))

      expect(radio('Meeting')).toBeChecked()
      expect(screen.getByLabelText('Title')).toHaveValue('Steering committee 12 Nov')
      expect(screen.getByLabelText('Date')).toHaveValue('2026-11-12')
      expect(screen.getByLabelText('Participants')).toHaveValue('Sara Conti, Marco Bianchi')
      expect(screen.getByLabelText('Text')).toHaveValue('We agreed the onboarding target stays at 3–4 weeks.')
      for (const tag of SAMPLE.tags!) expect(button(`Remove tag ${tag}`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Fill sample' })).not.toBeInTheDocument()
      expect(screen.queryByText('Sample:')).not.toBeInTheDocument()
    })

    it('uploads as filled', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.click(button('Fill sample'))
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toEqual(SAMPLE)
    })

    it('clears the errors of a form that was refused', async () => {
      const { user } = open()
      await user.click(button('Upload'))
      expect(screen.getByText('Give the item a title.')).toBeInTheDocument()

      await user.click(button('Fill sample'))
      expect(screen.queryByText('Give the item a title.')).not.toBeInTheDocument()
      expect(screen.queryByText('Paste the text or choose a file.')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Title')).not.toHaveClass('invalid')
    })

    it('is not offered in another project', () => {
      open({}, 'proj-internal')
      expect(screen.queryByRole('button', { name: 'Fill sample' })).not.toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('wants a title and a text, and sends nothing without them', async () => {
      const { user, onDone } = open()
      await user.click(button('Upload'))

      expect(screen.getByText('Give the item a title.')).toBeInTheDocument()
      expect(screen.getByText('Paste the text or choose a file.')).toBeInTheDocument()
      expect(screen.queryByText('Pick a date.')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveClass('invalid')
      expect(screen.getByLabelText('Text')).toHaveClass('invalid')
      expect(screen.getByLabelText('Date')).not.toHaveClass('invalid')
      expect(mutations()).toEqual([])
      expect(onDone).not.toHaveBeenCalled()
    })

    it('does not take spaces for a title or a text', async () => {
      const { user } = open()
      await fill(user, { title: '   ', text: '  ' })
      await user.click(button('Upload'))

      expect(screen.getByText('Give the item a title.')).toBeInTheDocument()
      expect(screen.getByText('Paste the text or choose a file.')).toBeInTheDocument()
      expect(mutations()).toEqual([])
    })

    it('wants a date', async () => {
      const { user } = open()
      await fill(user)
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } })
      await user.click(button('Upload'))

      expect(screen.getByText('Pick a date.')).toBeInTheDocument()
      expect(screen.getByLabelText('Date')).toHaveClass('invalid')
      expect(screen.queryByText('Give the item a title.')).not.toBeInTheDocument()
      expect(mutations()).toEqual([])
    })

    it('drops the errors once the form is complete and uploads', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.click(button('Upload'))
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(api.callsTo('POST', '/projects/:project_id/items')).toHaveLength(1)
    })
  })

  describe('choosing a file', () => {
    it('takes the text and the title from the file and shows its name', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.upload(picker(), textFile('Weekly sync.vtt', 'WEBVTT\n\nWe agreed on four weeks.', 'text/vtt'))

      await waitFor(() => expect(screen.getByLabelText('Text')).toHaveValue('WEBVTT\n\nWe agreed on four weeks.'))
      expect(screen.getByLabelText('Title')).toHaveValue('Weekly sync')
      expect(screen.getByText('Weekly sync.vtt')).toBeInTheDocument()
      expect(screen.getByText('· click to change')).toBeInTheDocument()
      expect(screen.queryByText('or choose a file · TXT, Markdown, VTT')).not.toBeInTheDocument()

      await user.click(button('Upload'))
      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toMatchObject({ title: 'Weekly sync', text: 'WEBVTT\n\nWe agreed on four weeks.' })
    })

    it('keeps a title already typed and replaces a text already pasted', async () => {
      const { user } = open()
      await fill(user, { title: 'My title', text: 'Old text' })
      await user.upload(picker(), textFile('notes.md', '# New text', 'text/markdown'))

      await waitFor(() => expect(screen.getByLabelText('Text')).toHaveValue('# New text'))
      expect(screen.getByLabelText('Title')).toHaveValue('My title')
    })

    it('keeps the chosen file when the file picker is closed without choosing', async () => {
      const { user } = open()
      await user.upload(picker(), textFile('notes.txt', 'Four weeks.'))
      await screen.findByText('notes.txt')
      fireEvent.change(picker(), { target: { files: [] } })

      expect(screen.getByText('notes.txt')).toBeInTheDocument()
      expect(screen.getByLabelText('Text')).toHaveValue('Four weeks.')
      expect(screen.getByLabelText('Title')).toHaveValue('notes')
    })

    it('accepts text, Markdown and subtitle files, one at a time', () => {
      open()
      expect(picker()).toHaveAttribute('accept', '.txt,.md,.markdown,.vtt,text/plain,text/markdown,text/vtt')
      expect(picker()).not.toHaveAttribute('multiple')
    })
  })

  describe('tags', () => {
    it('sends the tags typed, lower-cased and without duplicates', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await fill(user)
      await user.type(tagInput(), 'Kick Off{Enter}clearpath,clearpath{Enter}')
      expect(button('Remove tag kick-off')).toBeInTheDocument()
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent().tags).toEqual(['kick-off', 'clearpath'])
    })

    it('sends an empty list when there are none, and not the ones removed', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await fill(user)
      await user.type(tagInput(), 'draft{Enter}')
      await user.click(button('Remove tag draft'))
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent().tags).toEqual([])
    })

    it('suggests the five most used tags, the type and the first topic, seven at most', async () => {
      api.get(
        '/tags',
        ['clearpath', 'kickoff', 'pricing', 'legal', 'pilot', 'sixth'].map((tag, i) => ({ tag, count: 9 - i })),
      )
      api.get('/topics', [topic(), topic({ id: 'pilot-size', label: 'Pilot size' }), topic({ id: 'audit-turnaround' })])
      open()
      await waitFor(() => expect(suggested()).toEqual(['clearpath', 'kickoff', 'pricing', 'legal', 'pilot', 'meeting', 'topic:onboarding-target']))
      expect(button('topic:onboarding-target')).toHaveClass('tag', 'topic')
      expect(button('clearpath')).not.toHaveClass('topic')
    })

    it('suggests the first two topics when there is room, and each tag once', async () => {
      api.get('/tags', { items: [{ tag: 'meeting', count: 4 }, { tag: 'topic:onboarding-target', count: 2 }] })
      api.get('/topics', { items: [topic(), topic({ id: 'pilot-size' }), topic({ id: 'audit-turnaround' })] })
      open()
      await waitFor(() => expect(suggested()).toEqual(['meeting', 'topic:onboarding-target', 'topic:pilot-size']))
    })

    it('suggests the type that is selected', async () => {
      const { user } = open()
      expect(suggested()).toEqual(['meeting'])
      await user.click(radio('Ticket'))
      expect(suggested()).toEqual(['ticket'])
    })

    it('still suggests the type when the tags and the topics cannot be read', async () => {
      api.get('/tags', fail(500))
      api.get('/topics', fail(500))
      open()
      await waitFor(() => expect(api.callsTo('GET', '/topics')).toHaveLength(1))
      expect(suggested()).toEqual(['meeting'])
    })

    it('adds a suggestion on click and stops suggesting it', async () => {
      api.get('/tags', [{ tag: 'clearpath', count: 5 }])
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await waitFor(() => expect(suggested()).toEqual(['clearpath', 'meeting']))
      await user.click(button('clearpath'))

      expect(button('Remove tag clearpath')).toBeInTheDocument()
      expect(suggested()).toEqual(['meeting'])

      await user.click(button('meeting'))
      expect(screen.queryByText('Suggested')).not.toBeInTheDocument()

      await fill(user)
      await user.click(button('Upload'))
      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent().tags).toEqual(['clearpath', 'meeting'])
    })

    it('suggests a tag again once it is removed', async () => {
      const { user } = open()
      await user.click(button('meeting'))
      expect(suggested()).toEqual([])
      await user.click(button('Remove tag meeting'))
      expect(suggested()).toEqual(['meeting'])
    })
  })

  describe('what is sent', () => {
    it('sends a meeting to the project with its date at nine and the participants as a list', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await fill(user, { title: '  Kickoff  ', text: '  We agreed on four weeks.  ' })
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-02' } })
      await user.type(screen.getByLabelText('Participants'), ' Sara Conti ,Marco Bianchi,, ')
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(mutations()).toEqual([`POST /projects/${PID}/items`])
      expect(sent()).toEqual({
        type: 'meeting',
        title: 'Kickoff',
        date: '2026-10-02T09:00:00Z',
        text: 'We agreed on four weeks.',
        tags: [],
        participants: ['Sara Conti', 'Marco Bianchi'],
      })
      expect(api.unhandled).toEqual([])
    })

    it('sends a meeting without participants as an empty list', async () => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toEqual({ type: 'meeting', title: 'Kickoff', date: `${TODAY}T09:00:00Z`, text: 'We agreed on four weeks.', tags: [], participants: [] })
    })

    it.each([
      ['Note', 'note'],
      ['Ticket', 'ticket'],
    ])('sends a %s without the participants typed for a meeting', async (label, type) => {
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.type(screen.getByLabelText('Participants'), 'Sara Conti')
      await user.click(radio(label))
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toEqual({ type, title: 'Kickoff', date: `${TODAY}T09:00:00Z`, text: 'We agreed on four weeks.', tags: [] })
    })

    it('uploads to the project the dialog was opened for', async () => {
      api.post('/projects/:project_id/items', result({ project_id: 'proj-internal' }))
      const { user } = open({}, 'proj-internal')
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(api.last('POST', '/projects/:project_id/items')!.params.project_id).toBe('proj-internal')
      expect(api.last('GET', '/tags')!.query.get('project_id')).toBe('proj-internal')
    })
  })

  describe('a document', () => {
    it('can replace a document of the library, listed with its current version', async () => {
      mockLibrary([libraryDoc({ id: '07-documents/report-final' }), libraryDoc({ id: 'doc-brief', title: 'Project brief', current_version: null, version: 4 }), { id: 'doc-bare', title: 'Notes' }])
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.click(radio('Document'))
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      expect(within(screen.getByLabelText(/^New version of…/)).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Not a new version',
        'Final report · v2 current',
        'Project brief · v4 current',
        'Notes · v1 current',
      ])
      expect(screen.getByText('The previous version stays in history. Facts it restates with a different value are superseded.')).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText(/^New version of…/), '07-documents/report-final')
      await fill(user, { title: 'Final report v3' })
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toEqual({ type: 'document', title: 'Final report v3', date: `${TODAY}T09:00:00Z`, text: 'We agreed on four weeks.', tags: [], version_of: '07-documents/report-final' })
    })

    it('is a new document when no version is chosen', async () => {
      mockLibrary()
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.click(radio('Document'))
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).toEqual({ type: 'document', title: 'Kickoff', date: `${TODAY}T09:00:00Z`, text: 'We agreed on four weeks.', tags: [] })
    })

    it('forgets the document to replace when the type is changed to something else', async () => {
      mockLibrary()
      api.post('/projects/:project_id/items', result())
      const { user } = open()
      await user.click(radio('Document'))
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText(/^New version of…/), 'doc-report')
      await user.click(radio('Note'))
      await fill(user)
      await user.click(button('Upload'))

      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(sent()).not.toHaveProperty('version_of')
    })

    it('reads the documents of the library from an { items } answer', async () => {
      api.get('/projects/:project_id/sources', { items: [source(), LIBRARY] })
      api.get('/sources/:source_id/documents', { items: [libraryDoc()] })
      const { user } = open()
      await user.click(radio('Document'))
      expect(await screen.findByRole('option', { name: 'Final report · v2 current' })).toBeInTheDocument()
    })

    it('offers no document to replace when the project has no library, without asking for its documents', async () => {
      api.get('/projects/:project_id/sources', [source()])
      const { user } = open()
      await user.click(radio('Document'))
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/sources')).toHaveLength(1))
      expect(within(screen.getByLabelText(/^New version of…/)).getAllByRole('option')).toHaveLength(1)
      expect(api.callsTo('GET', '/sources/:source_id/documents')).toHaveLength(0)
      expect(api.unhandled).toEqual([])
    })

    it('offers no document to replace when the sources cannot be read', async () => {
      api.get('/projects/:project_id/sources', fail(500, 'sources are down'))
      const { user } = open()
      await user.click(radio('Document'))
      await waitFor(() => expect(api.callsTo('GET', '/projects/:project_id/sources')).toHaveLength(1))
      expect(within(screen.getByLabelText(/^New version of…/)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not a new version'])
    })
  })

  describe('while the backend works', () => {
    it('replaces the form with a wait message until the answer comes', async () => {
      const gate = deferred()
      api.post('/projects/:project_id/items', () => gate.promise)
      const { user, app, onClose, onDone } = open()
      await fill(user)
      await user.click(button('Upload'))

      expect(screen.getByText('Routing by tags and extracting facts…')).toHaveAttribute('aria-busy', 'true')
      expect(button('Processing…')).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
      expect(screen.getByText('ClearPath engagement')).toBeInTheDocument()
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument()
      expect(onDone).not.toHaveBeenCalled()

      await user.click(button('Processing…'))
      expect(api.callsTo('POST', '/projects/:project_id/items')).toHaveLength(1)
      await user.click(button('Close'))
      expect(onClose).toHaveBeenCalledTimes(1)

      gate.resolve(result())
      expect(await screen.findByRole('heading', { name: 'Upload processed' })).toBeInTheDocument()
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
    })

    it('goes back to the form as it was and says why when the backend refuses', async () => {
      api.post('/projects/:project_id/items', fail(422, 'The text is too short'))
      const { user, app, onDone } = open()
      await fill(user)
      await user.type(screen.getByLabelText('Participants'), 'Sara Conti')
      await user.type(tagInput(), 'kickoff{Enter}')
      await user.click(button('Upload'))

      expect(await toast('That did not work. The text is too short')).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Kickoff')
      expect(screen.getByLabelText('Text')).toHaveValue('We agreed on four weeks.')
      expect(screen.getByLabelText('Participants')).toHaveValue('Sara Conti')
      expect(button('Remove tag kickoff')).toBeInTheDocument()
      expect(onDone).not.toHaveBeenCalled()
      expect(app.refresh).not.toHaveBeenCalled()

      api.post('/projects/:project_id/items', result())
      await user.click(button('Upload'))
      expect(await screen.findByRole('heading', { name: 'Upload processed' })).toBeInTheDocument()
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('goes back to the form when the backend is unreachable', async () => {
      api.post('/projects/:project_id/items', offline)
      const { user } = open()
      await fill(user)
      await user.click(button('Upload'))

      expect(await toast('That did not work. network')).toBeInTheDocument()
      expect(button('Upload')).toBeInTheDocument()
    })
  })

  describe('the result', () => {
    it('names the item and says it stayed in the project when no tag rule matched', async () => {
      const { user, app, onClose, onDone } = open()
      await uploaded(user, result())

      expect(screen.getByText('Kickoff')).toBeInTheDocument()
      expect(screen.getByText('Item received:')).toBeInTheDocument()
      expect(screen.getByText('IT-9')).toBeInTheDocument()
      expect(line('Sent to project').getByText('ClearPath engagement')).toBeInTheDocument()
      expect(line('Sent to project').getByText('no tag rule matched, kept in the project you uploaded from')).toBeInTheDocument()
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)
      expect(api.unhandled).toEqual([])

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('names the project and the tag rule that moved the item elsewhere', async () => {
      const { user } = open()
      await uploaded(user, result({ project_id: 'proj-internal', routed_by: 'tag_rule', rule_id: 'TR-2' }))

      expect(line('Sent to project').getByText('Internal')).toBeInTheDocument()
      expect(line('Sent to project').getByText('by tag rule TR-2')).toBeInTheDocument()
      expect(screen.queryByText('ClearPath engagement')).not.toBeInTheDocument()
    })

    it('shows the id of a project the person does not see', async () => {
      const { user } = open()
      await uploaded(user, result({ project_id: 'proj-secret', routed_by: 'tag_rule', rule_id: 'TR-7' }))
      expect(line('Sent to project').getByText('proj-secret')).toBeInTheDocument()
    })

    it('says that no topic was set when there is no topic tag', async () => {
      const { user } = open()
      await uploaded(user, result(), ['kickoff'])
      expect(line('Topic').getByText('No topic tag. Add one like topic:onboarding-target to place the facts.')).toBeInTheDocument()
    })

    it('names the topic set by a topic tag', async () => {
      api.get('/topics', [topic()])
      const { user } = open()
      await uploaded(user, result(), ['kickoff', 'topic:onboarding-target'])

      expect(line('Topic').getByText('Onboarding target')).toBeInTheDocument()
      expect(line('Topic').getByText('set by')).toBeInTheDocument()
      expect(line('Topic').getByText('topic:onboarding-target')).toHaveClass('tag', 'topic')
      expect(screen.queryByText(/^No topic tag/)).not.toBeInTheDocument()
    })

    it('shows the id of a topic that has no label or is not known yet', async () => {
      api.get('/topics', [{ id: 'pilot-size' }])
      const { user } = open()
      await uploaded(user, result(), ['topic:pilot-size'])
      expect(line('Topic').getByText('pilot-size')).toBeInTheDocument()
    })

    it('counts no facts and no superseded facts without asking for any', async () => {
      const { user } = open()
      await uploaded(user, result())

      expect(line('Facts created').getByText('0')).toBeInTheDocument()
      expect(line('Superseded facts').getByText('0')).toBeInTheDocument()
      expect(screen.queryByText(/Kept as evidence/)).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/facts/:fact_id')).toHaveLength(0)
    })

    it('lists the facts created and opens one on click', async () => {
      api.get('/facts/:fact_id', (req) =>
        req.params.fact_id === 'M-301' ? fact({ id: 'M-301', value: 'Four weeks', type: 'DECISION' }) : fact({ id: 'M-302', value: 'Old target', type: 'EVIDENCE', status: 'retired' }),
      )
      const { user, app } = open()
      await uploaded(user, result({ facts_created: ['M-301', 'M-302'] }))

      const first = await screen.findByRole('button', { name: /Four weeks/ })
      expect(line('Facts created').getByText('2')).toBeInTheDocument()
      expect(within(first).getByText('Decision')).toHaveClass('badge')
      expect(within(first).getByText('M-301')).toBeInTheDocument()
      const second = button(/Old target/)
      expect(within(second).getByText('Retired')).toHaveClass('badge', 'retired')
      expect(within(second).getByText('Old target')).toHaveClass('strike')
      expect(api.callsTo('GET', '/facts/:fact_id').map((c) => c.params.fact_id)).toEqual(['M-301', 'M-302'])
      expect(screen.getByText(/Kept as evidence\. The binding fact does not change\./)).toBeInTheDocument()

      await user.click(second)
      expect(app.openFact).toHaveBeenCalledWith('M-302')
      expect(api.unhandled).toEqual([])
    })

    it('shows placeholders while the facts load', async () => {
      const gate = deferred()
      api.get('/facts/:fact_id', async (req) => {
        await gate.promise
        return fact({ id: req.params.fact_id, value: `value of ${req.params.fact_id}` })
      })
      const { user, container } = open()
      await uploaded(user, result({ facts_created: ['M-301', 'M-302'] }))

      expect(container.querySelectorAll('.skel')).toHaveLength(2)
      expect(line('Facts created').getByText('2')).toBeInTheDocument()
      gate.resolve(undefined)
      expect(await screen.findByText('value of M-302')).toBeInTheDocument()
      expect(container.querySelectorAll('.skel')).toHaveLength(0)
    })

    it('falls back to the fact ids, still clickable, when the facts cannot be read', async () => {
      api.get('/facts/:fact_id', fail(500))
      const { user, app } = open()
      await uploaded(user, result({ facts_created: ['M-301', 'M-302'] }))

      await user.click(await screen.findByRole('button', { name: 'M-302' }))
      expect(button('M-301')).toBeInTheDocument()
      expect(app.openFact).toHaveBeenCalledWith('M-302')
    })

    it('lists which fact replaces which, each opening its fact', async () => {
      api.get('/facts/:fact_id', (req) => fact({ id: req.params.fact_id, value: `value of ${req.params.fact_id}` }))
      const { user, app } = open()
      await uploaded(user, result({ facts_created: ['M-301'], supersedes_created: [{ fact_id: 'M-301', supersedes: 'M-106' }] }))
      await screen.findByText('value of M-301')

      const superseded = line('Superseded facts')
      expect(superseded.getByText('1')).toBeInTheDocument()
      expect(superseded.getByText('replaces')).toBeInTheDocument()
      expect(screen.queryByText(/Kept as evidence/)).not.toBeInTheDocument()

      await user.click(superseded.getByRole('button', { name: 'M-301' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-301')
      await user.click(superseded.getByRole('button', { name: 'M-106' }))
      expect(app.openFact).toHaveBeenLastCalledWith('M-106')
    })

    it('says when the same content was already received, and creates nothing', async () => {
      const { user, app, onClose, onDone } = open()
      await uploaded(user, result({ duplicate: true, item_id: 'IT-3', facts_created: ['M-301'] }))

      expect(screen.getByText('Duplicate')).toBeInTheDocument()
      expect(screen.getByText('Same content as item IT-3. Nothing new was created.')).toBeInTheDocument()
      expect(screen.queryByText('Item received:')).not.toBeInTheDocument()
      expect(screen.queryByText('Facts created')).not.toBeInTheDocument()
      expect(api.callsTo('GET', '/facts/:fact_id')).toHaveLength(0)
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(app.refresh).toHaveBeenCalledTimes(1)

      await user.click(button('Done'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('starts an empty form of the same type and date for another upload', async () => {
      mockLibrary()
      const { user, onClose } = open()
      await user.click(radio('Document'))
      await screen.findByRole('option', { name: 'Final report · v2 current' })
      await user.selectOptions(screen.getByLabelText(/^New version of…/), 'doc-report')
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-02' } })
      await user.upload(picker(), textFile('report.md', '# Report', 'text/markdown'))
      await screen.findByText('report.md')
      await uploaded(user, result(), ['kickoff'])
      await user.click(button('Upload another'))

      expect(screen.getByRole('heading', { name: 'Upload' })).toBeInTheDocument()
      expect(radio('Document')).toBeChecked()
      expect(screen.getByLabelText('Date')).toHaveValue('2026-10-02')
      expect(screen.getByLabelText('Title')).toHaveValue('')
      expect(screen.getByLabelText('Text')).toHaveValue('')
      expect(screen.getByLabelText(/^New version of…/)).toHaveValue('')
      expect(screen.queryByRole('button', { name: 'Remove tag kickoff' })).not.toBeInTheDocument()
      expect(screen.getByText('or choose a file · TXT, Markdown, VTT')).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()

      await fill(user, { title: 'Second', text: 'Another text.' })
      await user.click(button('Upload'))
      await screen.findByRole('heading', { name: 'Upload processed' })
      expect(api.callsTo('POST', '/projects/:project_id/items')).toHaveLength(2)
      expect(sent()).toEqual({ type: 'document', title: 'Second', date: '2026-10-02T09:00:00Z', text: 'Another text.', tags: [] })
    })

    it('forgets the participants of the previous meeting', async () => {
      const { user } = open()
      await user.type(screen.getByLabelText('Participants'), 'Sara Conti')
      await uploaded(user, result())
      await user.click(button('Upload another'))
      expect(screen.getByLabelText('Participants')).toHaveValue('')
    })
  })

  it('works without an onDone callback', async () => {
    api.post('/projects/:project_id/items', result())
    const { user, app } = renderWithApp(<UploadDialog projectId={PID} onClose={() => {}} />)
    await fill(user)
    await user.click(button('Upload'))

    expect(await screen.findByRole('heading', { name: 'Upload processed' })).toBeInTheDocument()
    expect(app.refresh).toHaveBeenCalledTimes(1)
  })
})
