import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Login from '../../src/screens/Login'
import { api, deferred, fail, offline } from '../helpers/api'
import { login, me, MEMBERS } from '../helpers/fixtures'
import { goto, renderWithApp } from '../helpers/render'

const email = () => screen.getByLabelText('Email')
const password = () => screen.getByLabelText('Password')
const submit = () => screen.getByRole('button', { name: 'Sign in' })
const demo = () => screen.getByRole('button', { name: 'Continue with the demo account' })

async function fill(user: ReturnType<typeof renderWithApp>['user'], mail = 'giulia@meridianlabs.org', pass = 'correct horse') {
  await user.type(email(), mail)
  await user.type(password(), pass)
}

describe('Login', () => {
  it('is a labelled email and password form, focused on the email', () => {
    goto('login')
    renderWithApp(<Login />)
    expect(screen.getByRole('heading', { name: 'Sign in to Canonico' })).toBeInTheDocument()
    expect(email()).toHaveAttribute('type', 'email')
    expect(email()).toHaveAttribute('autocomplete', 'username')
    expect(email()).toHaveFocus()
    expect(password()).toHaveAttribute('type', 'password')
    expect(password()).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('can be read in Italian', async () => {
    goto('login')
    const { user } = renderWithApp(<Login />)
    await user.click(screen.getByRole('button', { name: 'it' }))
    expect(screen.getByRole('heading', { name: 'Accedi a Canonico' })).toBeInTheDocument()
  })

  describe('with email and password', () => {
    it.each([
      ['both are empty', '', ''],
      ['the password is empty', 'giulia@meridianlabs.org', ''],
      ['the email is only spaces', '   ', 'secret'],
    ])('asks for both when %s, without calling the backend', async (_, mail, pass) => {
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      if (mail) await user.type(email(), mail)
      if (pass) await user.type(password(), pass)
      await user.click(submit())
      expect(screen.getByRole('alert')).toHaveTextContent('Enter your email and password.')
      expect(api.calls).toHaveLength(0)
      expect(app.signIn).not.toHaveBeenCalled()
    })

    it('signs in with the trimmed email and the password as typed', async () => {
      const answer = login()
      api.post('/auth/login', answer)
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      await fill(user, '  giulia@meridianlabs.org ', ' pass word ')
      await user.click(submit())
      await waitFor(() => expect(app.signIn).toHaveBeenCalledWith(answer))
      expect(api.last('POST', '/auth/login')!.body).toEqual({ email: 'giulia@meridianlabs.org', password: ' pass word ' })
    })

    it('submits with Enter', async () => {
      api.post('/auth/login', login())
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      await fill(user)
      await user.keyboard('{Enter}')
      await waitFor(() => expect(app.signIn).toHaveBeenCalledTimes(1))
    })

    it('says when the credentials are wrong, and can be tried again', async () => {
      api.post('/auth/login', fail(401, 'Invalid credentials', 'unauthorized'))
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      await fill(user)
      await user.click(submit())
      expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
      expect(app.signIn).not.toHaveBeenCalled()
      expect(submit()).toBeEnabled()
      expect(password()).toHaveValue('correct horse')

      api.post('/auth/login', login())
      await user.click(submit())
      await waitFor(() => expect(app.signIn).toHaveBeenCalledTimes(1))
    })

    it('says when the backend cannot be reached', async () => {
      api.post('/auth/login', offline)
      goto('login')
      const { user } = renderWithApp(<Login />)
      await fill(user)
      await user.click(submit())
      expect(await screen.findByRole('alert')).toHaveTextContent('The backend is not reachable. Try again in a moment.')
    })

    it('shows the backend message for any other failure', async () => {
      api.post('/auth/login', fail(429, 'Too many attempts'))
      goto('login')
      const { user } = renderWithApp(<Login />)
      await fill(user)
      await user.click(submit())
      expect(await screen.findByRole('alert')).toHaveTextContent('That did not work. Too many attempts')
    })

    it('clears the previous error when trying again', async () => {
      const gate = deferred()
      goto('login')
      const { user } = renderWithApp(<Login />)
      await user.click(submit())
      expect(screen.getByRole('alert')).toBeInTheDocument()
      api.post('/auth/login', () => gate.promise)
      await fill(user)
      await user.click(submit())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      gate.resolve(login())
    })

    it('is busy while signing in: both buttons are disabled and a second submit is ignored', async () => {
      const gate = deferred()
      api.post('/auth/login', () => gate.promise)
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      await fill(user)
      await user.click(submit())
      expect(submit()).toBeDisabled()
      expect(demo()).toBeDisabled()
      expect(submit().querySelector('.spin')).not.toBeNull()
      await user.type(password(), '{Enter}')
      expect(api.callsTo('POST', '/auth/login')).toHaveLength(1)
      gate.resolve(login())
      await waitFor(() => expect(app.signIn).toHaveBeenCalledTimes(1))
      // It stays busy until the app replaces the page, so nothing flashes back to an enabled form.
      expect(submit()).toBeDisabled()
    })
  })

  describe('with the demo account', () => {
    it('signs in without credentials', async () => {
      const answer = login({ token: 'tok-demo' })
      api.post('/auth/demo-login', answer)
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      expect(screen.getByText('No password needed. You enter as the owner of the demo organisation.')).toBeInTheDocument()
      await user.click(demo())
      await waitFor(() => expect(app.signIn).toHaveBeenCalledWith(answer))
      expect(api.last('POST', '/auth/demo-login')!.body).toBeUndefined()
    })

    it('shows the spinner on the demo button only', async () => {
      const gate = deferred()
      api.post('/auth/demo-login', () => gate.promise)
      goto('login')
      const { user } = renderWithApp(<Login />)
      await user.click(demo())
      expect(demo().querySelector('.spin')).not.toBeNull()
      expect(submit().querySelector('.spin')).toBeNull()
      expect(submit()).toBeDisabled()
      gate.resolve(login())
    })

    it('says when the server has demo sign-in turned off, and removes the button', async () => {
      api.post('/auth/demo-login', fail(404, 'Not found', 'not_found'))
      goto('login')
      const { user, app } = renderWithApp(<Login />)
      await user.click(demo())
      expect(await screen.findByText('Demo sign-in is turned off on this server.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue with the demo account' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(submit()).toBeEnabled()
      expect(app.signIn).not.toHaveBeenCalled()
    })

    it('reports other failures like a failed sign-in', async () => {
      api.post('/auth/demo-login', offline)
      goto('login')
      const { user } = renderWithApp(<Login />)
      await user.click(demo())
      expect(await screen.findByRole('alert')).toHaveTextContent('The backend is not reachable. Try again in a moment.')
      expect(demo()).toBeEnabled()
    })
  })

  describe('where it goes afterwards', () => {
    const signInAt = async (hash: string, over = {}) => {
      api.post('/auth/demo-login', login())
      goto(hash)
      const entries = history.length
      const { user, app } = renderWithApp(<Login />, over)
      await user.click(demo())
      await waitFor(() => expect(app.signIn).toHaveBeenCalled())
      return { hash: location.hash, added: history.length - entries }
    }

    it('#/login goes to the Ask screen, replacing the sign-in page in the history', async () => {
      expect(await signInAt('login')).toEqual({ hash: '#/app', added: 0 })
    })

    it('#/login/<path> goes back to that path', async () => {
      expect(await signInAt('login/memory/M-106')).toEqual({ hash: '#/memory/M-106', added: 0 })
    })

    it('never returns to the sign-in page itself', async () => {
      expect(await signInAt('login/login/again')).toEqual({ hash: '#/app', added: 0 })
    })

    it('stays on the address when the page replaced another screen', async () => {
      expect(await signInAt('conflicts', { signInRequired: true, me: null })).toEqual({ hash: '#/conflicts', added: 0 })
    })
  })

  describe('continuing without signing in', () => {
    it('is offered when the backend does not require a sign-in, pointing at the target', () => {
      goto('login/memory/M-106')
      renderWithApp(<Login />)
      expect(screen.getByRole('link', { name: 'Continue without signing in' })).toHaveAttribute('href', '#/memory/M-106')
    })

    it('is not offered when the backend requires a sign-in', () => {
      goto('login')
      renderWithApp(<Login />, { signInRequired: true, me: null })
      expect(screen.queryByRole('link', { name: 'Continue without signing in' })).not.toBeInTheDocument()
    })

    it('is not offered when the page replaced another screen', () => {
      goto('memory')
      renderWithApp(<Login />, { signInRequired: true, me: null })
      expect(screen.queryByRole('link', { name: 'Continue without signing in' })).not.toBeInTheDocument()
    })
  })

  describe('already signed in', () => {
    it('shows who is signed in instead of the form', () => {
      goto('login/audit')
      renderWithApp(<Login />, { signedIn: true, me: me({ as: MEMBERS.marco }) })
      expect(screen.getByRole('heading', { name: 'You are signed in' })).toBeInTheDocument()
      expect(screen.getByText('Marco Fiore')).toBeInTheDocument()
      expect(screen.getByText('marco@meridianlabs.org')).toBeInTheDocument()
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Continue to the app' })).toHaveAttribute('href', '#/audit')
    })

    it('continues to the Ask screen by default', () => {
      goto('login')
      renderWithApp(<Login />, { signedIn: true })
      expect(screen.getByRole('link', { name: 'Continue to the app' })).toHaveAttribute('href', '#/app')
    })

    it('can sign out', async () => {
      goto('login')
      const { user, app } = renderWithApp(<Login />, { signedIn: true })
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(app.signOut).toHaveBeenCalledTimes(1)
    })

    it('shows a placeholder while the identity is loading', () => {
      goto('login')
      renderWithApp(<Login />, { signedIn: true, me: null })
      expect(screen.getByText('…')).toBeInTheDocument()
    })
  })
})
