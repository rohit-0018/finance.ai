import React, { useEffect, useRef, useState } from 'react'
import { useLifeStore } from '../store'
import { createTask } from '../lib/db'
import { todayLocal, tomorrowLocal } from '../lib/time'
import { resolveWorkspaceFromTitle } from '../lib/prefixRouter'
import { createTaskSeries, type RecurrencePreset } from '../lib/recurring'

interface ParseResult {
  title: string
  scheduled_for: string | null
  priority: number
  tags: string[]
  recurrence: RecurrencePreset
  intervalDays: number
}

// Tiny natural-language parser:
//   "Fix login bug !1 #auth tomorrow"
//   "Call mom today"
//   "Read Anthropic docs !2 #learn"
function parseInput(raw: string): ParseResult {
  let s = raw.trim()
  let scheduled_for: string | null = todayLocal()
  let priority = 3
  const tags: string[] = []
  let recurrence: RecurrencePreset = 'none'
  let intervalDays = 1

  if (/\btomorrow\b/i.test(s)) {
    scheduled_for = tomorrowLocal()
    s = s.replace(/\btomorrow\b/i, '').trim()
  } else if (/\btoday\b/i.test(s)) {
    scheduled_for = todayLocal()
    s = s.replace(/\btoday\b/i, '').trim()
  }

  // Recurrence keywords. The order matters — match the most specific first.
  //   "every weekday"     → weekdays
  //   "weekly" / "every week" → weekly
  //   "monthly"           → monthly
  //   "daily" / "every day" → daily
  //   "every 3 days"      → every_n_days
  if (/\bevery\s+weekday\b|\bweekdays\b/i.test(s)) {
    recurrence = 'weekdays'
    s = s.replace(/\bevery\s+weekday\b|\bweekdays\b/i, '').trim()
  } else if (/\bevery\s+(\d+)\s+days?\b/i.test(s)) {
    const m = s.match(/\bevery\s+(\d+)\s+days?\b/i)!
    intervalDays = Math.max(1, parseInt(m[1], 10))
    recurrence = 'every_n_days'
    s = s.replace(/\bevery\s+\d+\s+days?\b/i, '').trim()
  } else if (/\b(weekly|every\s+week)\b/i.test(s)) {
    recurrence = 'weekly'
    s = s.replace(/\b(weekly|every\s+week)\b/i, '').trim()
  } else if (/\bmonthly\b/i.test(s)) {
    recurrence = 'monthly'
    s = s.replace(/\bmonthly\b/i, '').trim()
  } else if (/\b(daily|every\s+day)\b/i.test(s)) {
    recurrence = 'daily'
    s = s.replace(/\b(daily|every\s+day)\b/i, '').trim()
  }

  s = s.replace(/!([1-5])\b/g, (_m, p) => {
    priority = parseInt(p, 10)
    return ''
  }).trim()

  s = s.replace(/#(\w+)/g, (_m, t) => {
    tags.push(t)
    return ''
  }).trim()

  return {
    title: s.replace(/\s+/g, ' '),
    scheduled_for,
    priority,
    tags,
    recurrence,
    intervalDays,
  }
}

interface Props {
  onCreated?: () => void
  defaultProjectId?: string | null
}

const QuickAddBar: React.FC<Props> = ({ onCreated, defaultProjectId = null }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const workspaces = useLifeStore((s) => s.workspaces)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = async () => {
    if (!lifeUser || !value.trim() || busy) return
    setBusy(true)
    try {
      const parsed = parseInput(value)
      if (!parsed.title) return
      // Route Ofc/Prs prefixes to the right workspace before saving.
      const routed = resolveWorkspaceFromTitle(
        parsed.title,
        workspaces,
        activeWorkspace?.id ?? null
      )
      if (parsed.recurrence === 'none') {
        await createTask({
          userId: lifeUser.id,
          workspaceId: routed.workspaceId ?? undefined,
          title: routed.title,
          scheduled_for: parsed.scheduled_for,
          priority: parsed.priority,
          tags: parsed.tags,
          project_id: defaultProjectId,
          source: 'quickadd',
        })
      } else {
        // Recurring tasks materialize the next 60 days as concrete rows so
        // they show up everywhere (Todos, Calendar, Today) and stay editable.
        await createTaskSeries({
          userId: lifeUser.id,
          workspaceId: routed.workspaceId ?? undefined,
          title: routed.title,
          priority: parsed.priority,
          tags: parsed.tags,
          project_id: defaultProjectId,
          fromDate: parsed.scheduled_for ?? undefined,
          recurrence: {
            preset: parsed.recurrence,
            intervalDays: parsed.intervalDays,
          },
        })
      }
      setValue('')
      onCreated?.()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Failed to add task: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="life-quickadd">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="Quick add — 'Ofc standup !1 daily' or 'Prs gym every 2 days'"
      />
      <kbd>⌘K</kbd>
    </div>
  )
}

export default QuickAddBar
