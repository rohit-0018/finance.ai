// Work / Personal switcher. Lives in the sidebar header. Keyboard shortcuts
// ⌘1 / ⌘2 (or ctrl on non-mac). Persists active_workspace_id back to the DB,
// invalidates the query cache so everything re-fetches under the new scope.
import React, { useEffect } from 'react'
import { useLifeStore } from '../store'
import { updateLifeUser } from '../lib/db'
import { invalidateAll } from '../lib/useLifeQuery'
import { forgetDefaultWorkspace } from '../lib/db/_defaults'
import type { LifeWorkspace } from '../types'

const WorkspaceSwitcher: React.FC = () => {
  const workspaces = useLifeStore((s) => s.workspaces)
  const active = useLifeStore((s) => s.activeWorkspace)
  const setActive = useLifeStore((s) => s.setActiveWorkspace)
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const setLifeUser = useLifeStore((s) => s.setLifeUser)

  const switchTo = React.useCallback(
    (ws: LifeWorkspace) => {
      if (!lifeUser || ws.id === active?.id) return
      setActive(ws)
      invalidateAll()
      forgetDefaultWorkspace(lifeUser.id)
      // Persist — ignore failure, it's a preference not a constraint.
      updateLifeUser(lifeUser.id, { active_workspace_id: ws.id }).catch(() => {})
      setLifeUser({ ...lifeUser, active_workspace_id: ws.id })
    },
    [lifeUser, active?.id, setActive, setLifeUser]
  )

  // Keyboard shortcuts: ⌘1 = first workspace, ⌘2 = second, etc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = parseInt(e.key, 10)
      if (isNaN(n) || n < 1 || n > workspaces.length) return
      e.preventDefault()
      switchTo(workspaces[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workspaces, switchTo])

  if (workspaces.length === 0) return null

  return (
    <div className="life-workspace-switcher" role="tablist" aria-label="Workspace">
      {workspaces.map((w, i) => {
        const isActive = w.id === active?.id
        return (
          <button
            key={w.id}
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'active' : ''}
            onClick={() => switchTo(w)}
            title={`${w.name} (⌘${i + 1})`}
            style={{
              // Drive the accent from the data, so custom accents still work.
              ['--ws-accent' as string]: w.accent_color,
            }}
          >
            <span className="ws-dot" />
            <span>{w.name}</span>
            <span className="ws-kbd">⌘{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

export default WorkspaceSwitcher
