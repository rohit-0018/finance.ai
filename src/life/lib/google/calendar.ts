// Google Calendar API — thin wrapper over the REST endpoints so we don't pull
// in googleapis SDK (it's node-only and huge). Everything goes through
// https://www.googleapis.com/calendar/v3.
//
// Per-workspace mapping: each workspace stores its preferred calendarId in
// the integration's meta json, e.g.:
//   meta: { calendars: { "<workspace_id>": "primary" | "abc123@group..." } }
//
// We default to 'primary' if no mapping exists.
import { getAccessToken } from './auth'
import { getIntegration, upsertIntegration } from '../db'
import type { LifeTask } from '../../types'

const API = 'https://www.googleapis.com/calendar/v3'

export interface GoogleEvent {
  id: string
  summary?: string
  description?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  status?: string
  htmlLink?: string
  attendees?: Array<{ email: string; responseStatus?: string }>
}

async function apiFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getAccessToken(userId)
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Calendar ${res.status}: ${text || res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ─── Calendar selection per workspace ────────────────────────────────
export async function getCalendarIdForWorkspace(
  userId: string,
  workspaceId: string
): Promise<string> {
  const row = await getIntegration(userId, 'google_calendar')
  const meta = (row?.meta ?? {}) as { calendars?: Record<string, string> }
  return meta.calendars?.[workspaceId] ?? 'primary'
}

export async function setCalendarIdForWorkspace(
  userId: string,
  workspaceId: string,
  calendarId: string
): Promise<void> {
  const row = await getIntegration(userId, 'google_calendar')
  if (!row) throw new Error('Google Calendar not connected')
  const meta = { ...(row.meta as Record<string, unknown>) } as {
    calendars?: Record<string, string>
  }
  meta.calendars = { ...(meta.calendars ?? {}), [workspaceId]: calendarId }
  await upsertIntegration({
    userId,
    provider: 'google_calendar',
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope,
    expiresAt: row.expires_at,
    meta,
  })
}

// ─── Listing calendars (for the picker) ──────────────────────────────
export interface GoogleCalendarListEntry {
  id: string
  summary: string
  primary?: boolean
  backgroundColor?: string
}

export async function listCalendars(
  userId: string
): Promise<GoogleCalendarListEntry[]> {
  const data = await apiFetch<{ items: GoogleCalendarListEntry[] }>(
    userId,
    '/users/me/calendarList'
  )
  return data.items ?? []
}

// ─── Event read ──────────────────────────────────────────────────────
export interface ListEventsOpts {
  calendarId?: string
  timeMin: string // ISO
  timeMax: string // ISO
  maxResults?: number
}

export async function listEvents(
  userId: string,
  opts: ListEventsOpts
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults ?? 100),
  })
  const cal = encodeURIComponent(opts.calendarId ?? 'primary')
  const data = await apiFetch<{ items: GoogleEvent[] }>(
    userId,
    `/calendars/${cal}/events?${params.toString()}`
  )
  return data.items ?? []
}

// ─── Event write ─────────────────────────────────────────────────────
export interface CreateEventInput {
  calendarId?: string
  summary: string
  description?: string
  startIso: string
  endIso: string
  timeZone?: string
}

export async function createEvent(
  userId: string,
  input: CreateEventInput
): Promise<GoogleEvent> {
  const cal = encodeURIComponent(input.calendarId ?? 'primary')
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startIso, timeZone: input.timeZone },
    end: { dateTime: input.endIso, timeZone: input.timeZone },
  }
  return apiFetch<GoogleEvent>(userId, `/calendars/${cal}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function updateEvent(
  userId: string,
  eventId: string,
  input: Partial<CreateEventInput>
): Promise<GoogleEvent> {
  const cal = encodeURIComponent(input.calendarId ?? 'primary')
  const body: Record<string, unknown> = {}
  if (input.summary) body.summary = input.summary
  if (input.description) body.description = input.description
  if (input.startIso) body.start = { dateTime: input.startIso, timeZone: input.timeZone }
  if (input.endIso) body.end = { dateTime: input.endIso, timeZone: input.timeZone }
  return apiFetch<GoogleEvent>(
    userId,
    `/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deleteEvent(
  userId: string,
  eventId: string,
  calendarId = 'primary'
): Promise<void> {
  const cal = encodeURIComponent(calendarId)
  const token = await getAccessToken(userId)
  const res = await fetch(
    `${API}/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent ${res.status}: ${res.statusText}`)
  }
}

// ─── Task ↔ Event bridge ─────────────────────────────────────────────

/** Build a calendar event payload from a LifeTask. Returns null if the task
 *  has no start/due window (can't schedule an undated task). */
export function taskToEventInput(
  task: LifeTask,
  calendarId: string,
  timeZone: string
): CreateEventInput | null {
  if (!task.start_at) return null
  const startIso = task.start_at
  const endIso =
    task.due_at ??
    new Date(new Date(startIso).getTime() + (task.estimate_min ?? 30) * 60_000).toISOString()
  const parts: string[] = []
  if (task.when_where) parts.push(`When/where: ${task.when_where}`)
  if (task.first_action) parts.push(`First action: ${task.first_action}`)
  if (task.notes) parts.push(task.notes)
  return {
    calendarId,
    summary: task.title,
    description: parts.join('\n\n') || undefined,
    startIso,
    endIso,
    timeZone,
  }
}
