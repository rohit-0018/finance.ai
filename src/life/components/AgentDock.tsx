import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useLifeStore } from '../store'
import { listAgentMessages, saveAgentMessage, listTasksForProject, listJournalEntries } from '../lib/db'
import { chat } from '../lib/agent'
import type { LifeAgentMessage } from '../types'

const AgentDock: React.FC = () => {
  const open = useLifeStore((s) => s.agentOpen)
  const setOpen = useLifeStore((s) => s.setAgentOpen)
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const project = useLifeStore((s) => s.agentProject)

  const [messages, setMessages] = useState<LifeAgentMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reload thread when scope changes
  useEffect(() => {
    if (!lifeUser || !open) return
    let cancelled = false
    listAgentMessages(lifeUser.id, project?.id ?? null, 100)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs)
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
    return () => {
      cancelled = true
    }
  }, [lifeUser, project, open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const send = useCallback(async () => {
    if (!lifeUser || !input.trim() || thinking) return
    const text = input.trim()
    setInput('')
    setThinking(true)

    const userMsg = await saveAgentMessage({
      userId: lifeUser.id,
      projectId: project?.id ?? null,
      role: 'user',
      content: text,
    })
    setMessages((prev) => [...prev, userMsg])

    try {
      const [recentTasks, recentJournal] = project
        ? await Promise.all([
            listTasksForProject(lifeUser.id, project.id, 20),
            listJournalEntries(lifeUser.id, 5),
          ])
        : [[], await listJournalEntries(lifeUser.id, 5)]

      const reply = await chat({
        project: project ?? null,
        history: messages,
        userMessage: text,
        recentTasks,
        recentJournal,
      })

      const assistantMsg = await saveAgentMessage({
        userId: lifeUser.id,
        projectId: project?.id ?? null,
        role: 'assistant',
        content: reply,
      })
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errMsg = await saveAgentMessage({
        userId: lifeUser.id,
        projectId: project?.id ?? null,
        role: 'assistant',
        content: `⚠️ ${(err as Error).message}`,
      })
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setThinking(false)
    }
  }, [lifeUser, project, input, messages, thinking])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <aside className={`life-agent-dock ${open ? 'open' : ''}`}>
      <div className="life-agent-header">
        <div className="avatar">L</div>
        <div className="titles">
          <div className="name">Life copilot</div>
          <div className="scope">{project ? `Project: ${project.name}` : 'Global thread'}</div>
        </div>
        <button className="close" onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="life-agent-messages" ref={scrollRef}>
        {messages.length === 0 && !thinking && (
          <div className="life-agent-msg assistant">
            Hi. {project
              ? `Ask me about "${project.name}" — what's missing, what's next, or what to tackle now.`
              : `Ask me about your day, your goals, or anything you want to think through.`}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`life-agent-msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {thinking && <div className="life-agent-msg thinking">Thinking…</div>}
      </div>

      <div className="life-agent-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={project ? `Ask about ${project.name}…` : 'Ask anything…'}
          rows={1}
        />
        <button onClick={send} disabled={!input.trim() || thinking}>
          Send
        </button>
      </div>
    </aside>
  )
}

export default AgentDock
