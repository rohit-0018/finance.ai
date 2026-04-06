import React, { useEffect, useState } from 'react'
import { useLifeStore } from '../store'
import { closeOutDay, getJournalEntry, createNotification } from '../lib/db'
import { todayLocal } from '../lib/time'

interface Props {
  onClose: () => void
}

const EodModal: React.FC<Props> = ({ onClose }) => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const [summary, setSummary] = useState('')
  const [wins, setWins] = useState('')
  const [blockers, setBlockers] = useState('')
  const [tomorrow, setTomorrow] = useState('')
  const [energy, setEnergy] = useState<number>(3)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!lifeUser) return
    getJournalEntry(lifeUser.id, todayLocal(lifeUser.timezone))
      .then((entry) => {
        if (entry) {
          setSummary(entry.summary ?? '')
          setWins(entry.wins ?? '')
          setBlockers(entry.blockers ?? '')
          setTomorrow(entry.tomorrow ?? '')
          if (entry.energy != null) setEnergy(entry.energy)
        }
      })
      .catch(() => {/* ignore */})
  }, [lifeUser])

  const save = async () => {
    if (!lifeUser) return
    setSaving(true)
    try {
      await closeOutDay(lifeUser.id, todayLocal(lifeUser.timezone), {
        summary, wins, blockers, tomorrow, energy,
      })
      try {
        await createNotification({
          userId: lifeUser.id,
          kind: 'eod_reminder',
          title: 'Day closed',
          body: 'Summary saved. See you tomorrow.',
        })
      } catch {/* ignore */}
      onClose()
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Could not save: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="life-modal-overlay" onClick={onClose}>
      <div className="life-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Close the day</h2>
        <p className="subtitle">{todayLocal(lifeUser?.timezone)} — take 2 minutes. Future you needs this.</p>

        <label>Summary — what did today actually look like?</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A few honest sentences. Not a list." />

        <label>Wins</label>
        <textarea value={wins} onChange={(e) => setWins(e.target.value)} placeholder="What moved? What did you finish?" />

        <label>Blockers</label>
        <textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="What's stuck? What do you need from someone else?" />

        <label>Tomorrow's most important thing</label>
        <textarea value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} placeholder="The one thing. Not three." />

        <label>Energy today</label>
        <div className="life-modal-energy">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={energy === n ? 'active' : ''}
              onClick={() => setEnergy(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="life-modal-actions">
          <button className="life-btn" onClick={onClose}>Cancel</button>
          <button className="life-btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Close the day'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EodModal
