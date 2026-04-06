// Integrations — Phase 3 ships with just Google Calendar. Later phases add
// GitHub / Linear / Slack / Notion.
//
// UX:
//   - If no GOOGLE_CLIENT_ID env, show a config warning.
//   - If not connected, show "Connect Google Calendar" button → popup flow.
//   - If connected, show the list of calendars for each workspace so the user
//     can pick which calendar each workspace writes to (Work → work calendar,
//     Personal → personal calendar).
import React, { useCallback, useEffect, useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  connectGoogle,
  disconnectGoogle,
  isGoogleConfigured,
} from '../lib/google/auth'
import {
  listCalendars,
  setCalendarIdForWorkspace,
  getCalendarIdForWorkspace,
  type GoogleCalendarListEntry,
} from '../lib/google/calendar'
import { getIntegration } from '../lib/db'
import type { LifeIntegration, LifeWorkspace } from '../types'

const IntegrationsPage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)

  const [integration, setIntegration] = useState<LifeIntegration | null>(null)
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!lifeUser) return
    setLoading(true)
    setError(null)
    try {
      const row = await getIntegration(lifeUser.id, 'google_calendar')
      setIntegration(row)
      if (row) {
        const cals = await listCalendars(lifeUser.id)
        setCalendars(cals)
        const next: Record<string, string> = {}
        for (const w of workspaces) {
          next[w.id] = await getCalendarIdForWorkspace(lifeUser.id, w.id)
        }
        setPicks(next)
      } else {
        setCalendars([])
        setPicks({})
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, workspaces])

  useEffect(() => {
    load()
  }, [load])

  const handleConnect = async () => {
    if (!lifeUser) return
    try {
      await connectGoogle(lifeUser.id)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDisconnect = async () => {
    if (!lifeUser) return
    await disconnectGoogle(lifeUser.id)
    setIntegration(null)
    setCalendars([])
    setPicks({})
  }

  const handlePick = async (workspace: LifeWorkspace, calendarId: string) => {
    if (!lifeUser) return
    setPicks((p) => ({ ...p, [workspace.id]: calendarId }))
    await setCalendarIdForWorkspace(lifeUser.id, workspace.id, calendarId)
  }

  if (!isGoogleConfigured()) {
    return (
      <LifeLayout title="Integrations">
        <div className="life-card">
          <h3>Google Calendar</h3>
          <p className="big">
            Set <code>VITE_GOOGLE_CLIENT_ID</code> in your <code>.env</code> and reload.
            Create an OAuth 2.0 Client ID in the Google Cloud Console with scope{' '}
            <code>calendar.events</code>, and add your local dev URL to the authorized
            JavaScript origins.
          </p>
        </div>
      </LifeLayout>
    )
  }

  return (
    <LifeLayout title="Integrations">
      <div className="life-card accented">
        <h3>Google Calendar</h3>
        {error && <p className="gate gate-block">{error}</p>}
        {!integration ? (
          <>
            <p className="big">
              Connect Google Calendar so committed plans become real calendar events, and
              your dashboard's "Now" card reflects what your calendar actually says.
            </p>
            <div>
              <button className="life-btn primary" onClick={handleConnect} disabled={loading}>
                Connect Google Calendar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="big">
              Connected. Pick the calendar each workspace should write to. Work plans
              will land on your work calendar, personal on personal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {workspaces.map((w) => (
                <div
                  key={w.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
                >
                  <span className="kicker" style={{ minWidth: 80 }}>
                    {w.name}
                  </span>
                  <select
                    value={picks[w.id] ?? 'primary'}
                    onChange={(e) => handlePick(w, e.target.value)}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.summary}
                        {c.primary ? ' (primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <button className="life-btn" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    </LifeLayout>
  )
}

export default IntegrationsPage
