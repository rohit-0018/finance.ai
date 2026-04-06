// Weekly AI 1:1 — a guided five-question interview with the agent. At the
// end we persist the answers and the agent's synthesis into the journal row
// for today so the EOD flow can pick them up.
import React, { useState } from 'react'
import LifeLayout from '../LifeLayout'
import { useLifeStore } from '../store'
import { upsertJournalEntry } from '../lib/db'
import { todayLocal } from '../lib/time'
import { WEEKLY_ONEONE_QUESTIONS, synthesizeOneOne } from '../lib/weeklyOneOne'

const WeeklyOneOnePage: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState('')
  const [synthesis, setSynthesis] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const q = WEEKLY_ONEONE_QUESTIONS[step]
  const isLast = step === WEEKLY_ONEONE_QUESTIONS.length - 1

  const next = async () => {
    if (!lifeUser) return
    if (current.trim().length < 10) {
      alert('One line minimum — please answer honestly.')
      return
    }
    const updated = { ...answers, [q.id]: current.trim() }
    setAnswers(updated)
    setCurrent('')
    if (!isLast) {
      setStep(step + 1)
      return
    }
    // Synthesize + persist
    setBusy(true)
    try {
      const text = await synthesizeOneOne(lifeUser, updated)
      setSynthesis(text)
      await upsertJournalEntry(lifeUser.id, todayLocal(lifeUser.timezone), {
        summary: `Weekly 1:1 synthesis:\n${text}`,
        wins: updated.pattern,
        blockers: updated.lies,
        tomorrow: updated.commitment,
      })
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <LifeLayout title="Weekly 1:1">
      {!synthesis ? (
        <div className="life-card accented" style={{ maxWidth: 640, margin: '40px auto' }}>
          <div className="kicker">
            Question {step + 1} of {WEEKLY_ONEONE_QUESTIONS.length}
          </div>
          <div className="big">{q.question}</div>
          <textarea
            rows={5}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Be honest. You'll read this later."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              marginTop: 10,
            }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="life-btn primary" onClick={next} disabled={busy}>
              {isLast ? (busy ? 'Synthesizing…' : 'Finish') : 'Next'}
            </button>
          </div>
        </div>
      ) : (
        <div className="life-card accented" style={{ maxWidth: 640, margin: '40px auto' }}>
          <h3>Synthesis</h3>
          <p className="big" style={{ whiteSpace: 'pre-wrap' }}>
            {synthesis}
          </p>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #888)', marginTop: 8 }}>
            Saved to today's journal.
          </div>
        </div>
      )}
    </LifeLayout>
  )
}

export default WeeklyOneOnePage
