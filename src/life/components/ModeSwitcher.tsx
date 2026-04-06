// ModeSwitcher — dropdown pill in the topbar. Clicking opens a menu of all
// modes with their description; picking one persists via setActiveMode and
// updates the store so everything downstream (gates, automation, brainstorm)
// sees the new mode on the next tick.
import React, { useState, useRef, useEffect } from 'react'
import { useLifeStore } from '../store'
import { MODE_LIST, setActiveMode, type ModeId } from '../lib/modes'

const ModeSwitcher: React.FC = () => {
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const mode = useLifeStore((s) => s.mode)
  const setMode = useLifeStore((s) => s.setMode)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const pick = async (id: ModeId) => {
    if (!lifeUser) return
    const preset = MODE_LIST.find((m) => m.id === id) ?? null
    setMode(preset)
    setOpen(false)
    if (preset) {
      try {
        await setActiveMode(lifeUser.id, id)
      } catch {/* non-fatal */}
    }
  }

  if (!mode) return null

  const accent = mode.accent ?? 'var(--ws-accent, var(--accent))'

  return (
    <div className="mode-switcher" ref={menuRef}>
      <button
        className="mode-pill"
        onClick={() => setOpen((o) => !o)}
        title={mode.description}
        style={{
          ['--mode-accent' as string]: accent,
        }}
      >
        <span className="mode-dot" />
        <span>{mode.label.toLowerCase()}</span>
      </button>
      {open && (
        <div className="mode-menu">
          {MODE_LIST.map((m) => {
            const active = m.id === mode.id
            return (
              <button
                key={m.id}
                className={`mode-menu-item ${active ? 'active' : ''}`}
                onClick={() => pick(m.id)}
                style={{ ['--mode-accent' as string]: m.accent ?? 'var(--ws-accent, var(--accent))' }}
              >
                <div className="mode-menu-head">
                  <span className="mode-dot" />
                  <strong>{m.label}</strong>
                </div>
                <div className="mode-menu-desc">{m.description}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ModeSwitcher
