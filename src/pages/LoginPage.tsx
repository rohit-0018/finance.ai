import React, { useState, useCallback } from 'react'
import { dbLogin } from '../lib/supabase'
import { useAppStore } from '../store'
import toast from 'react-hot-toast'

const LoginPage: React.FC = () => {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!username.trim() || !password.trim()) return

      setLoading(true)
      try {
        const user = await dbLogin(username.trim(), password)
        setCurrentUser(user)
        toast.success(`Welcome, ${user.display_name ?? user.username}!`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Login failed')
      } finally {
        setLoading(false)
      }
    },
    [username, password, setCurrentUser]
  )

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="var(--accent)" />
            <path d="M8 7h10a4 4 0 010 8H8zm0 10h12a4 4 0 010 8H8z" fill="var(--bg)" opacity=".9" />
            <circle cx="24" cy="24" r="5" fill="var(--green)" />
            <path d="M22 24l1.5 1.5L27 22" stroke="var(--bg)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: '1.3rem', letterSpacing: '-0.03em' }}>
            @paperai
          </span>
        </div>

        <p className="login-subtitle">Sign in to your account</p>

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

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ fontSize: '0.78rem', color: 'var(--text3)', textAlign: 'center' }}>
          Contact your admin if you need an account.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
