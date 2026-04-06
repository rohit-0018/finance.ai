import React, { useEffect, useRef, useState } from 'react'
import { useLifeStore } from '../store'
import { createTask } from '../lib/db'
import { todayLocal, tomorrowLocal } from '../lib/time'

interface ParseResult {
  title: string
  scheduled_for: string | null
  priority: number
  tags: string[]
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

  if (/\btomorrow\b/i.test(s)) {
    scheduled_for = tomorrowLocal()
    s = s.replace(/\btomorrow\b/i, '').trim()
  } else if (/\btoday\b/i.test(s)) {
    scheduled_for = todayLocal()
    s = s.replace(/\btoday\b/i, '').trim()
  }

  s = s.replace(/!([1-5])\b/g, (_m, p) => {
    priority = parseInt(p, 10)
    return ''
  }).trim()

  s = s.replace(/#(\w+)/g, (_m, t) => {
    tags.push(t)
    return ''
  }).trim()

  return { title: s.replace(/\s+/g, ' '), scheduled_for, priority, tags }
}

interface Props {
  onCreated?: () => void
  defaultProjectId?: string | null
}

const QuickAddBar: React.FC<Props> = ({ onCreated, defaultProjectId = null }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
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
      await createTask({
        userId: lifeUser.id,
        title: parsed.title,
        scheduled_for: parsed.scheduled_for,
        priority: parsed.priority,
        tags: parsed.tags,
        project_id: defaultProjectId,
        source: 'quickadd',
      })
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
        placeholder="Quick add a task — e.g. 'Fix login !1 #auth tomorrow'"
      />
      <kbd>⌘K</kbd>
    </div>
  )
}

export default QuickAddBar
