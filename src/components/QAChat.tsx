import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { Paper, QAMessage } from '../types'
import { claudeChat } from '../lib/anthropic'
import { dbSaveQA, dbGetQAHistory } from '../lib/supabase'
import { useAppStore } from '../store'

interface QAChatProps {
  paper: Paper
}

const QUICK_PROMPTS = [
  'Explain the main contribution',
  'What are the limitations?',
  'How does this compare to prior work?',
  'Summarize the methodology',
  'What are potential applications?',
]

const QAChat: React.FC<QAChatProps> = ({ paper }) => {
  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const qaMessages = useAppStore((s) => s.qaMessages)
  const qaLoading = useAppStore((s) => s.qaLoading)
  const addQAMessage = useAppStore((s) => s.addQAMessage)
  const setQAMessages = useAppStore((s) => s.setQAMessages)
  const setQALoading = useAppStore((s) => s.setQALoading)

  const userId = useAppStore((s) => s.currentUser?.id)

  // Load history on mount
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    dbGetQAHistory(userId, paper.id).then((history) => {
      if (!cancelled) setQAMessages(history)
    })
    return () => { cancelled = true }
  }, [paper.id, userId, setQAMessages])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [qaMessages, qaLoading])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || qaLoading || !userId) return

      const userMsg: QAMessage = {
        paper_id: paper.id,
        role: 'user',
        content: text.trim(),
      }

      addQAMessage(userMsg)
      setInput('')
      setQALoading(true)

      try {
        await dbSaveQA(userId, paper.id, 'user', userMsg.content)

        const systemPrompt = `You are a research paper assistant. You are helping the user understand a paper.

Paper: "${paper.title}"
Authors: ${paper.authors ?? 'Unknown'}
Abstract: ${paper.abstract ?? 'Not available'}
Problem: ${paper.problem ?? 'Not available'}
Method: ${paper.method ?? 'Not available'}
Finding: ${paper.finding ?? 'Not available'}

Answer questions about this paper concisely and accurately. Use markdown formatting.`

        const allMessages = [
          ...qaMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: userMsg.role, content: userMsg.content },
        ]

        const response = await claudeChat(systemPrompt, allMessages)

        const assistantMsg: QAMessage = {
          paper_id: paper.id,
          role: 'assistant',
          content: response,
        }

        addQAMessage(assistantMsg)
        await dbSaveQA(userId, paper.id, 'assistant', response)
      } catch (err) {
        const errorMsg: QAMessage = {
          paper_id: paper.id,
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        }
        addQAMessage(errorMsg)
      } finally {
        setQALoading(false)
      }
    },
    [paper, qaMessages, qaLoading, addQAMessage, setQALoading, userId]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(input)
      }
    },
    [input, sendMessage]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="qa-chips">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            className="qa-chip"
            onClick={() => sendMessage(prompt)}
            disabled={qaLoading}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="qa-messages" ref={messagesRef}>
        {qaMessages.length === 0 && !qaLoading && (
          <div style={{ color: 'var(--text3)', fontSize: '0.82rem', textAlign: 'center', padding: '40px 0' }}>
            Ask a question about this paper to get started.
          </div>
        )}
        {qaMessages.map((msg, i) => (
          <div key={i} className="qa-message">
            <div className={`qa-avatar ${msg.role}`}>
              {msg.role === 'user' ? 'U' : 'AI'}
            </div>
            <div
              className="qa-bubble"
              dangerouslySetInnerHTML={{ __html: msg.content }}
            />
          </div>
        ))}
        {qaLoading && (
          <div className="qa-message">
            <div className="qa-avatar assistant">AI</div>
            <div className="typing-indicator">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className="qa-input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this paper..."
          disabled={qaLoading}
          rows={1}
        />
        <button
          className="btn btn-primary"
          onClick={() => sendMessage(input)}
          disabled={qaLoading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

export default QAChat
