// Google OAuth wrapper for the Life app. Uses Google Identity Services
// (implicit/token flow). We get a ~1-hour access token that we store in
// life_integrations for persistence + cache in memory. When it expires we
// silently re-issue by calling requestAccessToken({ prompt: '' }).
//
// Env:
//   VITE_GOOGLE_CLIENT_ID — OAuth client ID with calendar.readonly + events
//   redirect URI: same-origin (GIS handles this)
import { loadGis } from './gisLoader'
import { upsertIntegration, getIntegration, deleteIntegration } from '../db'
import type { LifeIntegration } from '../../types'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

interface TokenCache {
  userId: string
  accessToken: string
  expiresAt: number
}

let cached: TokenCache | null = null
type TokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}
let tokenClient: TokenClient | null = null

export function getClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function isGoogleConfigured(): boolean {
  return Boolean(getClientId())
}

async function ensureClient(): Promise<void> {
  if (tokenClient) return
  const clientId = getClientId()
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID not set')
  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google Identity Services did not initialize')
  // Callback is overridden per request.
  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    prompt: 'consent',
    callback: () => {/* overridden */},
  })
}

/**
 * Request a fresh access token. If `silent` is true, attempts silent reissue
 * (no popup) — only works if the user previously consented.
 */
function requestToken(silent: boolean): Promise<{ accessToken: string; expiresIn: number }> {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error('token client not initialized'))
    // Rebind callback for this request. Cast acceptable since we control shape.
    const clientAny = tokenClient as unknown as {
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void
      error_callback: (err: { type: string; message?: string }) => void
      requestAccessToken: (overrides?: { prompt?: string }) => void
    }
    clientAny.callback = (resp) => {
      if (resp.error || !resp.access_token) {
        reject(new Error(resp.error ?? 'Google token request failed'))
        return
      }
      resolve({
        accessToken: resp.access_token,
        expiresIn: resp.expires_in ?? 3600,
      })
    }
    clientAny.error_callback = (err) => reject(new Error(err.message ?? err.type))
    clientAny.requestAccessToken({ prompt: silent ? '' : 'consent' })
  })
}

/**
 * Connect a new Google account for this user. Pops up the consent screen,
 * then stores the resulting token in life_integrations.
 */
export async function connectGoogle(userId: string): Promise<LifeIntegration> {
  await ensureClient()
  const { accessToken, expiresIn } = await requestToken(false)
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  cached = { userId, accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  return upsertIntegration({
    userId,
    provider: 'google_calendar',
    accessToken,
    expiresAt,
  })
}

/**
 * Get a valid access token. Checks in-memory cache first, then the DB,
 * then silently re-issues if expired.
 */
export async function getAccessToken(userId: string): Promise<string> {
  // Hot cache
  if (cached && cached.userId === userId && cached.expiresAt - 30_000 > Date.now()) {
    return cached.accessToken
  }
  // Cold cache — check DB
  const row = await getIntegration(userId, 'google_calendar')
  if (row && row.expires_at && new Date(row.expires_at).getTime() - 30_000 > Date.now()) {
    cached = {
      userId,
      accessToken: row.access_token,
      expiresAt: new Date(row.expires_at).getTime(),
    }
    return row.access_token
  }
  // Expired or missing — silent reissue (may fall back to popup if not consented)
  await ensureClient()
  const { accessToken, expiresIn } = await requestToken(true)
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  cached = { userId, accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  await upsertIntegration({
    userId,
    provider: 'google_calendar',
    accessToken,
    expiresAt,
  })
  return accessToken
}

export async function disconnectGoogle(userId: string): Promise<void> {
  cached = null
  await deleteIntegration(userId, 'google_calendar')
}
