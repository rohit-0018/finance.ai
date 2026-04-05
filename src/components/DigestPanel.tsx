import React from 'react'

interface DigestPanelProps {
  problem: string | null
  method: string | null
  finding: string | null
}

const cards = [
  { key: 'problem', label: 'Problem', color: 'var(--coral)' },
  { key: 'method', label: 'Method', color: 'var(--accent)' },
  { key: 'finding', label: 'Finding', color: 'var(--green)' },
] as const

const DigestPanel: React.FC<DigestPanelProps> = ({ problem, method, finding }) => {
  const values: Record<string, string | null> = { problem, method, finding }

  const hasAny = problem || method || finding
  if (!hasAny) return null

  return (
    <div className="digest-cards">
      {cards.map(({ key, label, color }) => {
        const text = values[key]
        if (!text) return null
        return (
          <div
            key={key}
            className="digest-card"
            style={{ borderLeftColor: color }}
          >
            <div className="digest-card-label" style={{ color }}>
              {label}
            </div>
            <div className="digest-card-text">{text}</div>
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(DigestPanel)
