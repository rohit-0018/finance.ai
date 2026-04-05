import React, { useState, useCallback } from 'react'
import { dbLogin, dbRegister } from '../lib/supabase'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

const LoginPage: React.FC = () => {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!username.trim() || !password.trim()) return

      setLoading(true)
      try {
        if (mode === 'login') {
          const user = await dbLogin(username.trim(), password)
          setCurrentUser(user)
          toast.success(`Welcome back, ${user.display_name ?? user.username}!`)
        } else {
          const user = await dbRegister(username.trim(), password, displayName.trim())
          setCurrentUser(user)
          toast.success('Account created!')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Authentication failed')
      } finally {
        setLoading(false)
      }
    },
    [mode, username, password, displayName, setCurrentUser]
  )

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-icon" style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: 8 }} />
          <span style={{ fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.03em' }}>
            PaperMind
          </span>
        </div>

        <p className="login-subtitle">
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>

          {mode === 'register' && (
            <div className="login-field">
              <label htmlFor="displayName">Display Name</label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name (optional)"
              />
            </div>
          )}

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' ? (
            <>
              Don&apos;t have an account?{' '}
              <button onClick={() => setMode('register')}>Sign up</button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => setMode('login')}>Sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginPage
