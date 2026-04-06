// DropModal — enforces drop-with-reason for tasks and projects.
// Contract-mode projects cannot be silently deleted; they must go through
// this modal and the reason is recorded in life_drops for retro analysis.
import React, { useState } from 'react'
import { recordDrop, updateTaskStatus, updateProject } from '../lib/db'
import type { DropKind } from '../types'

interface Props {
  userId: string
  kind: DropKind
  refId: string
  title: string
  onClose: () => void
  onDropped?: () => void
}

const DropModal: React.FC<Props> = ({ userId, kind, refId, title, onClose, onDropped }) => {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (reason.trim().length < 10) {
      alert('Reason must be at least 10 characters — not a one-word excuse.')
      return
    }
    setSubmitting(true)
    try {
      await recordDrop({ userId, kind, refId, title, reason: reason.trim() })
      if (kind === 'task') {
        await updateTaskStatus(userId, refId, 'dropped')
      } else {
        await updateProject(userId, refId, { status: 'dropped' })
      }
      onDropped?.()
      onClose()
    } catch (err) {
      alert(`Drop failed: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="focus-overlay" role="dialog" aria-label="Drop with reason">
      <div className="focus-card" style={{ padding: '32px 28px', alignItems: 'stretch', textAlign: 'left' }}>
        <div className="focus-kicker">Drop {kind}</div>
        <div style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>{title}</div>
        <p className="focus-hint" style={{ textAlign: 'left' }}>
          Dropping is fine. It goes into the drop log so next month's retro can
          spot patterns. One honest sentence: what changed?
        </p>
        <textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Priority shifted to X, no longer needed this quarter"
          style={{
            padding: 10,
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '0.88rem',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="life-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="life-btn primary" onClick={submit} disabled={submitting || reason.trim().length < 10}>
            {submitting ? 'Dropping…' : 'Drop it'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DropModal
