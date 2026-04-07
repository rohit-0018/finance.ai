// Gmail send + profile helper.
//
// The OAuth flow in ./auth.ts already requests gmail.send + userinfo.email
// scopes, so once the user has connected Google in Integrations we can:
//   1. Look up the email address attached to their token (one-shot, cached
//      in life_integrations.meta.email).
//   2. Send a Gmail directly from the browser using the REST API.
//
// We use the Gmail v1 REST endpoint so there's no extra SDK to load. The
// message is built as a tiny RFC 5322 string and base64url-encoded — Gmail
// rejects standard base64.
//
// If the user later prefers an MCP-server-driven flow (e.g. Claude/Anthropic
// MCP for Gmail), only `sendNotificationEmail` needs to change. Callers go
// through that single entry point.

import { getAccessToken } from './auth'
import { getIntegration, upsertIntegration } from '../db'

interface GmailProfile {
  emailAddress: string
}

/** Resolve the connected Gmail address. Caches into integration meta. */
export async function getConnectedEmail(userId: string): Promise<string | null> {
  const row = await getIntegration(userId, 'google_calendar')
  if (!row) return null
  const cached = (row.meta as { email?: string } | null)?.email
  if (cached) return cached
  try {
    const token = await getAccessToken(userId)
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as GmailProfile
    if (!json.emailAddress) return null
    // Persist to integration meta so we don't ping the API every time.
    await upsertIntegration({
      userId,
      provider: 'google_calendar',
      accessToken: row.access_token,
      refreshToken: row.refresh_token ?? undefined,
      scope: row.scope ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      meta: { ...(row.meta ?? {}), email: json.emailAddress },
    })
    return json.emailAddress
  } catch {
    return null
  }
}

/** RFC-5322 plain-text message wrapped in base64url for Gmail's send API. */
function buildRawMessage(opts: { from: string; to: string; subject: string; body: string }): string {
  // Use crlf line endings — Gmail is strict about RFC compliance.
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
  ].join('\r\n')
  const message = `${headers}\r\n\r\n${opts.body}`
  // Browser-safe base64url. btoa needs binary so encode utf-8 first.
  const utf8 = unescape(encodeURIComponent(message))
  return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface SendEmailInput {
  userId: string
  /** Optional override; defaults to the connected Gmail address (self-send). */
  to?: string
  subject: string
  body: string
}

export interface SendEmailResult {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Send a notification email via the user's connected Gmail account.
 * Returns ok=false instead of throwing so callers (cron-style pollers) can
 * retry next tick without blowing up the schedule.
 */
export async function sendNotificationEmail(input: SendEmailInput): Promise<SendEmailResult> {
  try {
    const address = input.to ?? (await getConnectedEmail(input.userId))
    if (!address) return { ok: false, error: 'no connected gmail address' }
    const token = await getAccessToken(input.userId)
    const raw = buildRawMessage({
      from: address,
      to: address,
      subject: input.subject,
      body: input.body,
    })
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return { ok: false, error: `${resp.status} ${text}` }
    }
    const json = (await resp.json()) as { id?: string }
    return { ok: true, messageId: json.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
