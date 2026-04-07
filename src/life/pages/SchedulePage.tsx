import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import type {
  EventClickArg,
  EventDropArg,
  EventInput,
  DatesSetArg,
  DateSelectArg,
} from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'

import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import {
  listTasksInRangeAllWorkspaces,
  listTimeBlocksInRange,
  updateTask,
  deleteTimeBlock,
} from '../lib/db'
import CalendarCreateModal from '../components/CalendarCreateModal'
import type { LifeTask, LifeTimeBlock, LifeWorkspace } from '../types'

const QUESTION_TAG = 'question'

// Distinct, accessible colors per source. Work=blue, Personal=violet,
// Question=amber, Time block=teal. These also appear in the legend.
const COLORS = {
  work: { bg: '#2563eb', border: '#1d4ed8' },
  personal: { bg: '#7c3aed', border: '#6d28d9' },
  question: { bg: '#f59e0b', border: '#d97706' },
  block: { bg: '#0d9488', border: '#0f766e' },
  done: { bg: '#9ca3af', border: '#6b7280' },
}

interface ParsedEvent extends EventInput {
  extendedProps: {
    kind: 'task' | 'block'
    task?: LifeTask
    block?: LifeTimeBlock
    workspaceKind?: 'work' | 'personal' | null
    isQuestion?: boolean
  }
}

function workspaceKindOf(
  workspaceId: string,
  workspaces: LifeWorkspace[]
): 'work' | 'personal' | null {
  const ws = workspaces.find((w) => w.id === workspaceId)
  return ws?.kind ?? null
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

function timeBlockToEvent(b: LifeTimeBlock): ParsedEvent {
  // life_time_blocks store start/end as minutes-since-midnight against the
  // local-display date. Build the ISO by appending the offset to the date.
  const startH = Math.floor(b.start_minute / 60)
  const startM = b.start_minute % 60
  const endH = Math.floor(b.end_minute / 60)
  const endM = b.end_minute % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return {
    id: `block:${b.id}`,
    title: `▦ ${b.label}`,
    start: `${b.date}T${pad(startH)}:${pad(startM)}:00`,
    end: `${b.date}T${pad(endH)}:${pad(endM)}:00`,
    backgroundColor: COLORS.block.bg,
    borderColor: COLORS.block.border,
    textColor: '#ffffff',
    classNames: ['life-evt', 'life-evt-block'],
    editable: false,
    extendedProps: { kind: 'block', block: b },
  }
}

function taskToEvent(
  t: LifeTask,
  workspaces: LifeWorkspace[]
): ParsedEvent | null {
  const isQuestion = Array.isArray(t.tags) && t.tags.includes(QUESTION_TAG)
  const kind = workspaceKindOf(t.workspace_id, workspaces)
  const palette =
    t.status === 'done'
      ? COLORS.done
      : isQuestion
      ? COLORS.question
      : kind === 'work'
      ? COLORS.work
      : COLORS.personal

  const titlePrefix = isQuestion ? '❓ ' : kind === 'work' ? '💼 ' : '🏠 '
  const baseTitle = `${titlePrefix}${t.title}`

  if (t.start_at) {
    const dur = t.estimate_min && t.estimate_min > 0 ? t.estimate_min : 30
    return {
      id: `task:${t.id}`,
      title: baseTitle,
      start: t.start_at,
      end: addMinutesIso(t.start_at, dur),
      backgroundColor: palette.bg,
      borderColor: palette.border,
      textColor: '#ffffff',
      classNames: ['life-evt', `life-evt-${kind ?? 'personal'}`],
      extendedProps: {
        kind: 'task',
        task: t,
        workspaceKind: kind,
        isQuestion,
      },
    }
  }
  if (t.scheduled_for) {
    return {
      id: `task:${t.id}`,
      title: baseTitle,
      start: t.scheduled_for,
      allDay: true,
      backgroundColor: palette.bg,
      borderColor: palette.border,
      textColor: '#ffffff',
      classNames: ['life-evt', 'life-evt-allday', `life-evt-${kind ?? 'personal'}`],
      extendedProps: {
        kind: 'task',
        task: t,
        workspaceKind: kind,
        isQuestion,
      },
    }
  }
  return null
}

const SchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)

  const [tasks, setTasks] = useState<LifeTask[]>([])
  const [blocks, setBlocks] = useState<LifeTimeBlock[]>([])
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'work' | 'personal' | 'questions'>('all')
  const [loading, setLoading] = useState(false)
  const calendarRef = useRef<FullCalendar | null>(null)
  const [createSelection, setCreateSelection] = useState<{
    start: Date
    end: Date
    allDay: boolean
  } | null>(null)

  // Re-load whenever the visible date range changes (FullCalendar fires
  // datesSet on mount, on view-change, on prev/next).
  const onDatesSet = useCallback((arg: DatesSetArg) => {
    const from = arg.startStr.slice(0, 10)
    const to = arg.endStr.slice(0, 10)
    setRange({ from, to })
  }, [])

  const load = useCallback(async () => {
    if (!lifeUser || !range) return
    setLoading(true)
    try {
      const [t, b] = await Promise.all([
        listTasksInRangeAllWorkspaces(lifeUser.id, range.from, range.to),
        listTimeBlocksInRange(lifeUser.id, range.from, range.to),
      ])
      setTasks(t)
      setBlocks(b)
    } finally {
      setLoading(false)
    }
  }, [lifeUser, range])

  useEffect(() => {
    load()
  }, [load])

  const events: ParsedEvent[] = useMemo(() => {
    const out: ParsedEvent[] = []
    for (const t of tasks) {
      // Respect filter and (when not "All") respect the active workspace too.
      if (filter === 'work' && workspaceKindOf(t.workspace_id, workspaces) !== 'work') continue
      if (filter === 'personal' && workspaceKindOf(t.workspace_id, workspaces) !== 'personal')
        continue
      if (filter === 'questions' && !(t.tags ?? []).includes(QUESTION_TAG)) continue
      // When activeWorkspace is set (not "All"), and the user picked filter=all,
      // still scope to the active workspace so the switcher means something.
      if (
        filter === 'all' &&
        activeWorkspace &&
        t.workspace_id !== activeWorkspace.id
      )
        continue
      const ev = taskToEvent(t, workspaces)
      if (ev) out.push(ev)
    }
    for (const b of blocks) {
      if (
        filter === 'all' &&
        activeWorkspace &&
        b.workspace_id !== activeWorkspace.id
      )
        continue
      if (filter === 'work' && workspaceKindOf(b.workspace_id, workspaces) !== 'work') continue
      if (filter === 'personal' && workspaceKindOf(b.workspace_id, workspaces) !== 'personal')
        continue
      if (filter === 'questions') continue
      out.push(timeBlockToEvent(b))
    }
    return out
  }, [tasks, blocks, workspaces, filter, activeWorkspace])

  const onEventClick = (arg: EventClickArg) => {
    const props = arg.event.extendedProps as ParsedEvent['extendedProps']
    if (props.kind !== 'task' || !props.task) return
    if (props.isQuestion) navigate('/life/questions')
    else navigate('/life/todos')
  }

  const onEventDrop = async (arg: EventDropArg) => {
    if (!lifeUser) return
    const props = arg.event.extendedProps as ParsedEvent['extendedProps']
    if (props.kind !== 'task' || !props.task) {
      arg.revert()
      return
    }
    const task = props.task
    try {
      if (arg.event.allDay) {
        await updateTask(lifeUser.id, task.id, {
          scheduled_for: arg.event.startStr.slice(0, 10),
          start_at: null,
        })
      } else if (arg.event.start) {
        const startIso = arg.event.start.toISOString()
        await updateTask(lifeUser.id, task.id, {
          scheduled_for: arg.event.startStr.slice(0, 10),
          start_at: startIso,
        })
      }
      load()
    } catch (e) {
      console.error(e)
      arg.revert()
    }
  }

  const onEventResize = async (arg: EventResizeDoneArg) => {
    if (!lifeUser) return
    const props = arg.event.extendedProps as ParsedEvent['extendedProps']
    if (props.kind !== 'task' || !props.task) {
      arg.revert()
      return
    }
    const start = arg.event.start
    const end = arg.event.end
    if (!start || !end) {
      arg.revert()
      return
    }
    const minutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000))
    try {
      await updateTask(lifeUser.id, props.task.id, { estimate_min: minutes })
      load()
    } catch (e) {
      console.error(e)
      arg.revert()
    }
  }

  // Drag-select an empty slot → open the create modal. The user picks task
  // vs focus block, recurrence, etc. Tasks land in life_tasks so they show
  // up on the Todos page and are individually editable.
  const onSelect = (arg: DateSelectArg) => {
    setCreateSelection({ start: arg.start, end: arg.end, allDay: arg.allDay })
    arg.view.calendar.unselect()
  }

  // Right-click a time block to delete it (FC has no native right-click,
  // so we attach via eventDidMount).
  const onEventDidMount = (info: { event: { extendedProps: ParsedEvent['extendedProps']; id: string }, el: HTMLElement }) => {
    const props = info.event.extendedProps as ParsedEvent['extendedProps']
    if (props.kind !== 'block' || !props.block) return
    const block = props.block
    info.el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      if (!lifeUser) return
      if (confirm(`Delete time block "${block.label}"?`)) {
        deleteTimeBlock(lifeUser.id, block.id).then(load)
      }
    })
  }

  const counts = useMemo(() => {
    const c = { work: 0, personal: 0, question: 0, block: blocks.length }
    for (const t of tasks) {
      if ((t.tags ?? []).includes(QUESTION_TAG)) c.question++
      else if (workspaceKindOf(t.workspace_id, workspaces) === 'work') c.work++
      else c.personal++
    }
    return c
  }, [tasks, blocks, workspaces])

  return (
    <LifeLayout title="Calendar">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'work', 'personal', 'questions'] as const).map((f) => (
            <button
              key={f}
              className={`life-btn ${filter === f ? 'primary' : ''}`}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f === 'all' ? 'United' : f}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="life-cal-legend">
          <Legend color={COLORS.work.bg} label={`Work · ${counts.work}`} />
          <Legend color={COLORS.personal.bg} label={`Personal · ${counts.personal}`} />
          <Legend color={COLORS.question.bg} label={`Questions · ${counts.question}`} />
          <Legend color={COLORS.block.bg} label={`Focus blocks · ${counts.block}`} />
        </div>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Drag events to reschedule, drag the bottom edge to resize, or drag-select an empty slot
        to create a focus block. Right-click a block to delete it. United view shows work +
        personal together; prefix new tasks with <code>Ofc</code> or <code>Prs</code> to file
        them automatically.
      </p>

      <div className={`life-fc-wrap ${loading ? 'loading' : ''}`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          buttonText={{
            today: 'today',
            month: 'month',
            week: 'week',
            day: 'day',
            list: 'agenda',
          }}
          firstDay={1}
          nowIndicator
          selectable
          selectMirror
          editable
          eventResizableFromStart={false}
          dayMaxEventRows={4}
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          scrollTime={`${(lifeUser?.work_start_hour ?? 9).toString().padStart(2, '0')}:00:00`}
          allDaySlot
          height="auto"
          contentHeight="auto"
          expandRows
          events={events}
          datesSet={onDatesSet}
          eventClick={onEventClick}
          eventDrop={onEventDrop}
          eventResize={onEventResize}
          select={onSelect}
          eventDidMount={onEventDidMount as never}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        />
      </div>

      {createSelection && (
        <CalendarCreateModal
          start={createSelection.start}
          end={createSelection.end}
          allDay={createSelection.allDay}
          onClose={() => setCreateSelection(null)}
          onCreated={load}
        />
      )}
    </LifeLayout>
  )
}

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 2,
        background: color,
        display: 'inline-block',
      }}
    />
    {label}
  </span>
)

export default SchedulePage
