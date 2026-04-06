// Task ↔ Google Calendar sync. Two directions:
//
//   pushTask(task)   — create or update the google_event_id on the task
//   pullEvents(range) — returns google events so the dashboard can render
//                       meetings that don't exist as tasks
//
// Full-day bidirectional sync (webhooks → our DB) is out of scope for Phase
// 3. Today we poll on demand from the dashboard + commit flows.
import {
  createEvent,
  updateEvent,
  deleteEvent,
  listEvents,
  taskToEventInput,
  getCalendarIdForWorkspace,
  type GoogleEvent,
} from './calendar'
import { updateTask } from '../db'
import type { LifeTask, LifeUser } from '../../types'

export async function pushTaskToCalendar(
  user: LifeUser,
  task: LifeTask
): Promise<string | null> {
  const calendarId = await getCalendarIdForWorkspace(user.id, task.workspace_id)
  const input = taskToEventInput(task, calendarId, user.timezone)
  if (!input) return null
  if (task.google_event_id) {
    await updateEvent(user.id, task.google_event_id, input)
    return task.google_event_id
  }
  const created = await createEvent(user.id, input)
  await updateTask(user.id, task.id, { google_event_id: created.id })
  return created.id
}

export async function removeTaskFromCalendar(
  user: LifeUser,
  task: LifeTask
): Promise<void> {
  if (!task.google_event_id) return
  const calendarId = await getCalendarIdForWorkspace(user.id, task.workspace_id)
  await deleteEvent(user.id, task.google_event_id, calendarId)
  await updateTask(user.id, task.id, { google_event_id: null })
}

export interface DayWindow {
  startIso: string
  endIso: string
}

export function dayWindow(date: Date = new Date()): DayWindow {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const end = new Date(d)
  end.setDate(end.getDate() + 1)
  return { startIso: d.toISOString(), endIso: end.toISOString() }
}

export async function pullEventsForWindow(
  user: LifeUser,
  workspaceId: string,
  window: DayWindow
): Promise<GoogleEvent[]> {
  const calendarId = await getCalendarIdForWorkspace(user.id, workspaceId)
  return listEvents(user.id, {
    calendarId,
    timeMin: window.startIso,
    timeMax: window.endIso,
    maxResults: 200,
  })
}
