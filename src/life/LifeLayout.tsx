import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { useLifeStore } from './store'
import {
  ensureLifeUser,
  listTasksForDate,
  updateLifeUser,
  getStreak,
  ensureDefaultWorkspaces,
  listValues,
  listHorizons,
} from './lib/db'
import { isLifeDbConfigured } from './lib/supabaseLife'
import { isAfterEod, todayLocal } from './lib/time'
import { getAlignmentScore, type AlignmentSnapshot } from './lib/alignment'
import {
  browserNotificationsGranted,
  requestBrowserNotifications,
  startReminderScheduler,
} from './lib/notifier'
import { startEmailScheduler } from './lib/emailNotifier'
import { startAutomationEngine } from './lib/automationEngine'
import { maybeInjectFiveYearTask } from './lib/fiveYearInjection'
import { getActiveMode } from './lib/modes'
import ModeSwitcher from './components/ModeSwitcher'
import type { LifeTask } from './types'
import AgentDock from './components/AgentDock'
import NotificationBell from './components/NotificationBell'
import EodModal from './components/EodModal'
import WorkspaceSwitcher from './components/WorkspaceSwitcher'

interface NavItem { path: string; label: string; icon: React.ReactNode }
interface NavGroup { id: string; label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'plan',
    label: 'Plan',
    items: [
      { path: '/life', label: 'Today', icon: <Icon kind="sun" /> },
      { path: '/life/calendar', label: 'Calendar', icon: <Icon kind="clock" /> },
      { path: '/life/todos', label: 'Todos', icon: <Icon kind="check" /> },
      { path: '/life/questions', label: 'Questions', icon: <Icon kind="question" /> },
    ],
  },
  {
    id: 'focus',
    label: 'Focus',
    items: [
      { path: '/life/projects', label: 'Projects', icon: <Icon kind="layers" /> },
      { path: '/life/goals', label: 'Goals', icon: <Icon kind="target" /> },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { path: '/life/finance', label: 'Finance', icon: <Icon kind="wallet" /> },
    ],
  },
  {
    id: 'reflect',
    label: 'Reflect',
    items: [
      { path: '/life/journal', label: 'Journal', icon: <Icon kind="edit" /> },
      { path: '/life/review', label: 'Review', icon: <Icon kind="trend" /> },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { path: '/life/integrations', label: 'Integrations', icon: <Icon kind="link" /> },
    ],
  },
]

function Icon({ kind }: { kind: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'icon' }
  switch (kind) {
    case 'sun':
      return (<svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>)
    case 'layers':
      return (<svg {...p}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>)
    case 'target':
      return (<svg {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>)
    case 'book':
      return (<svg {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>)
    case 'edit':
      return (<svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>)
    case 'clock':
      return (<svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>)
    case 'trend':
      return (<svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>)
    case 'sparkles':
      return (<svg {...p}><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>)
    case 'link':
      return (<svg {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>)
    case 'briefcase':
      return (<svg {...p}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>)
    case 'heart':
      return (<svg {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>)
    case 'bulb':
      return (<svg {...p}><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.73V17h8v-2.27A7 7 0 0 0 12 2z" /></svg>)
    case 'brain':
      return (<svg {...p}><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3v0a3 3 0 0 0 3 3v2a3 3 0 0 0 6 0v-2a3 3 0 0 0 3-3v0a3 3 0 0 0 3-3v0a3 3 0 0 0-3-3V6a3 3 0 0 0-6 0" /></svg>)
    case 'check':
      return (<svg {...p}><polyline points="20 6 9 17 4 12" /></svg>)
    case 'question':
      return (<svg {...p}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>)
    case 'wallet':
      return (<svg {...p}><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>)
    default:
      return null
  }
}

interface LifeLayoutProps {
  title: string
  children: React.ReactNode
}

const LifeLayout: React.FC<LifeLayoutProps> = ({ title, children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = useAppStore((s) => s.currentUser)
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const setLifeUser = useLifeStore((s) => s.setLifeUser)
  const setWorkspaces = useLifeStore((s) => s.setWorkspaces)
  const setActiveWorkspace = useLifeStore((s) => s.setActiveWorkspace)
  const setValuesStore = useLifeStore((s) => s.setValues)
  const setHorizonsStore = useLifeStore((s) => s.setHorizons)
  const activeWorkspace = useLifeStore((s) => s.activeWorkspace)
  const mode = useLifeStore((s) => s.mode)
  const setModeStore = useLifeStore((s) => s.setMode)
  const toggleAgent = useLifeStore((s) => s.toggleAgent)
  const [eodOpen, setEodOpen] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [notifGranted, setNotifGranted] = useState(browserNotificationsGranted())
  const [streak, setStreak] = useState(0)
  const [alignment, setAlignment] = useState<AlignmentSnapshot | null>(null)
  const todayTasksRef = useRef<LifeTask[]>([])

  // Sync papermind admin -> life_users on first /life mount
  useEffect(() => {
    if (!currentUser || lifeUser) return
    if (!isLifeDbConfigured()) return
    ensureLifeUser({
      papermindUserId: currentUser.id,
      username: currentUser.username,
      displayName: currentUser.display_name ?? null,
    })
      .then(setLifeUser)
      .catch((err) => setBootError((err as Error).message))
  }, [currentUser, lifeUser, setLifeUser])

  // Phase 0: ensure the user has workspaces + preload values / horizons /
  // active mode (Phase 10) so gates, automation, and brainstorm agents have
  // the full context from first paint.
  useEffect(() => {
    if (!lifeUser) return
    let cancelled = false
    ;(async () => {
      try {
        const ws = await ensureDefaultWorkspaces(lifeUser.id)
        if (cancelled) return
        setWorkspaces(ws)
        const active =
          ws.find((w) => w.id === lifeUser.active_workspace_id) ??
          ws.find((w) => w.kind === 'personal') ??
          ws[0] ??
          null
        setActiveWorkspace(active)
        const [values, horizons, mode] = await Promise.all([
          listValues(lifeUser.id),
          listHorizons(lifeUser.id),
          getActiveMode(lifeUser.id),
        ])
        if (cancelled) return
        setValuesStore(values)
        setHorizonsStore(horizons)
        setModeStore(mode)
      } catch (err) {
        if (!cancelled) setBootError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lifeUser, setWorkspaces, setActiveWorkspace, setValuesStore, setHorizonsStore, setModeStore])

  // Auto-prompt EOD modal once after EOD hour, once per session
  useEffect(() => {
    if (!lifeUser) return
    const key = `life_eod_prompted_${new Date().toDateString()}`
    if (sessionStorage.getItem(key)) return
    if (isAfterEod(lifeUser.eod_hour, lifeUser.timezone)) {
      sessionStorage.setItem(key, '1')
      setEodOpen(true)
    }
  }, [lifeUser])

  // Streak counter — refresh on mount + when EOD modal closes
  useEffect(() => {
    if (!lifeUser) return
    getStreak(lifeUser.id, todayLocal(lifeUser.timezone)).then(setStreak).catch(() => {})
  }, [lifeUser, eodOpen])

  // Alignment score — trailing 7 days, re-compute on workspace switch
  useEffect(() => {
    if (!lifeUser) return
    let cancelled = false
    getAlignmentScore(lifeUser.id, activeWorkspace?.id ?? null)
      .then((snap) => {
        if (!cancelled) setAlignment(snap)
      })
      .catch(() => {/* non-fatal */})
    return () => {
      cancelled = true
    }
  }, [lifeUser, activeWorkspace?.id, eodOpen])

  // Phase 7 automation engine — task reminders, escalation, drift, SLA
  useEffect(() => {
    if (!lifeUser) return
    const workspaces = useLifeStore.getState().workspaces
    if (workspaces.length === 0) return
    const stop = startAutomationEngine({
      user: lifeUser,
      workspaces,
      onNavigate: (path) => navigate(path),
    })
    // Phase 9: weekly 5-year default injection — once per ISO week, silently
    // picks an active five-year horizon and schedules one tiny task.
    const personal = workspaces.find((w) => w.kind === 'personal')
    maybeInjectFiveYearTask(lifeUser, personal?.id ?? null).catch(() => {/* non-fatal */})
    return stop
  }, [lifeUser, navigate])

  // Browser notification scheduler
  useEffect(() => {
    if (!lifeUser) return
    let cancelled = false
    const refreshTasks = () =>
      listTasksForDate(lifeUser.id, todayLocal(lifeUser.timezone))
        .then((t) => {
          if (!cancelled) todayTasksRef.current = t
        })
        .catch(() => {/* ignore */})
    refreshTasks()
    const refreshId = setInterval(refreshTasks, 5 * 60_000)

    const stop = startReminderScheduler({
      user: lifeUser,
      todayTasks: () => todayTasksRef.current,
      onEod: () => setEodOpen(true),
      onFinanceLog: () => navigate('/life/finance'),
      onOpenTodos: () => navigate('/life/todos'),
      dueDigest: async () => {
        try {
          const now = Date.now()
          const dayMs = 86_400_000
          const endOfTomorrow = new Date(now + 2 * dayMs)
          endOfTomorrow.setHours(23, 59, 59, 999)
          // Pull all open tasks with a due_at within (-30 days, +2 days].
          const { data, error } = await (await import('./lib/db/_client')).lifeDb()
            .from('life_tasks')
            .select('*')
            .eq('user_id', lifeUser.id)
            .in('status', ['todo', 'doing'])
            .gte('due_at', new Date(now - 30 * dayMs).toISOString())
            .lte('due_at', endOfTomorrow.toISOString())
            .limit(200)
          if (error) return null
          const overdue: LifeTask[] = []
          const dueToday: LifeTask[] = []
          const dueTomorrow: LifeTask[] = []
          const todayStr = new Date().toDateString()
          const tomorrowStr = new Date(now + dayMs).toDateString()
          for (const t of (data ?? []) as LifeTask[]) {
            if (!t.due_at) continue
            const d = new Date(t.due_at)
            if (d.getTime() < now) overdue.push(t)
            else if (d.toDateString() === todayStr) dueToday.push(t)
            else if (d.toDateString() === tomorrowStr) dueTomorrow.push(t)
          }
          return { overdue, dueToday, dueTomorrow }
        } catch {
          return null
        }
      },
    })
    // Email notification poller — fires Gmail messages for opted-in tasks
    // whose start_at has just passed. No-ops gracefully when Google isn't
    // connected.
    const stopEmail = startEmailScheduler({ userId: lifeUser.id })

    return () => {
      cancelled = true
      clearInterval(refreshId)
      stop()
      stopEmail()
    }
  }, [lifeUser, notifGranted])

  const enableNotifications = async () => {
    const ok = await requestBrowserNotifications()
    if (ok && lifeUser) {
      try {
        await updateLifeUser(lifeUser.id, { notify_browser: true })
        setLifeUser({ ...lifeUser, notify_browser: true })
      } catch {/* ignore */}
      setNotifGranted(true)
    }
  }

  if (!isLifeDbConfigured()) {
    return (
      <div className="life-app">
        <div className="life-main">
          <div className="life-config-warn">
            <h2>Life DB not configured</h2>
            <p>The Life app uses a separate Supabase project from papermind. Add these to your <code style={{ display: 'inline', padding: '0 4px' }}>.env</code> and reload:</p>
            <code>
{`VITE_LIFE_SUPABASE_URL=https://<your-life-project>.supabase.co
VITE_LIFE_SUPABASE_ANON_KEY=<anon-key>
LIFE_DATABASE_URL=postgresql://...`}
            </code>
            <p style={{ marginTop: 12 }}>Then run <code style={{ display: 'inline', padding: '0 4px' }}>npm run life:db:push</code> to materialize the schema.</p>
          </div>
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="life-app">
        <div className="life-main">
          <div className="life-config-warn">
            <h2>Could not initialize Life user</h2>
            <p>{bootError}</p>
            <p>Make sure <code style={{ display: 'inline', padding: '0 4px' }}>life_users</code> exists in the Life database (<code style={{ display: 'inline', padding: '0 4px' }}>npm run life:db:push</code>).</p>
          </div>
        </div>
      </div>
    )
  }

  const accent = activeWorkspace?.accent_color ?? '#6c63ff'
  const workspaceKind = activeWorkspace?.kind ?? 'personal'

  return (
    <div
      className={`life-app life-ws-${workspaceKind}`}
      style={{ ['--ws-accent' as string]: accent }}
    >
      <aside className="life-sidebar">
        <div className="life-sidebar-header">
          <span className="dot" />
          <span>Life</span>
          <button className="back" onClick={() => navigate('/')}>← back</button>
        </div>

        <WorkspaceSwitcher />

        <nav className="life-nav">
          {NAV_GROUPS.map((group) => (
            <div className="life-nav-group" key={group.id}>
              <div className="life-nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active =
                  item.path === '/life'
                    ? location.pathname === '/life'
                    : location.pathname.startsWith(item.path)
                return (
                  <button
                    key={item.path}
                    className={active ? 'active' : ''}
                    onClick={() => navigate(item.path)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="life-sidebar-footer">
          {lifeUser && (
            <>
              <div>{lifeUser.display_name ?? lifeUser.username}</div>
              <div>tz: {lifeUser.timezone}</div>
              <div>EOD: {lifeUser.eod_hour}:00</div>
            </>
          )}
        </div>
      </aside>

      <main className="life-main">
        <header className="life-topbar">
          <h1>{title}</h1>
          {streak > 0 && mode?.streak !== 'paused' && (
            <span className="life-streak-pill" title="Consecutive days with closed journal">
              {streak}d
            </span>
          )}
          {mode?.streak === 'paused' && (
            <span
              className="life-streak-pill paused"
              title="Streak paused while in Recovery mode"
            >
              paused
            </span>
          )}
          <ModeSwitcher />
          {alignment && alignment.sample > 0 && (
            <span
              className={`life-align-pill ${alignment.rating}`}
              title={`${alignment.sample} tasks in last ${alignment.windowDays}d traced to a quarterly goal`}
            >
              aligned {Math.round(alignment.rate * 100)}%
            </span>
          )}
          <div className="spacer" />
          {!notifGranted && (
            <button className="life-btn" onClick={enableNotifications} title="Get EOD + task-due reminders">
              🔔 Enable
            </button>
          )}
          <ThemeMenu />
          <button className="life-btn" onClick={() => setEodOpen(true)}>
            Close the day
          </button>
          <NotificationBell />
          <button className="icon-btn" onClick={toggleAgent} title="Open Life copilot">
            <Icon kind="sparkles" />
          </button>
        </header>

        <div className="life-content">{children}</div>
      </main>

      <AgentDock />
      {eodOpen && <EodModal onClose={() => setEodOpen(false)} />}
    </div>
  )
}

// Lightweight theme picker — reuses the papermind store so changes also apply
// to the rest of the app. Themes share CSS variables on <html data-theme="…">
// which the .life-app aliases pick up automatically.
const THEMES: Array<{ id: 'light' | 'dark' | 'sepia' | 'midnight' | 'forest'; label: string; emoji: string }> = [
  { id: 'light', label: 'Light', emoji: '☀️' },
  { id: 'dark', label: 'Dark', emoji: '🌙' },
  { id: 'sepia', label: 'Sepia', emoji: '📜' },
  { id: 'midnight', label: 'Midnight', emoji: '🌌' },
  { id: 'forest', label: 'Forest', emoji: '🌲' },
]

const ThemeMenu: React.FC = () => {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="life-btn"
        onClick={() => setOpen((v) => !v)}
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current.emoji} {current.label}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: '110%',
              minWidth: 160,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 4,
              boxShadow: 'var(--shadow-md, 0 10px 30px rgba(0,0,0,0.25))',
              zIndex: 9999,
            }}
          >
            {THEMES.map((t) => (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={t.id === theme}
                onClick={() => {
                  setTheme(t.id)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 12px',
                  background: t.id === theme ? 'var(--accent-light, var(--bg3))' : 'none',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>{t.emoji}</span>
                <span>{t.label}</span>
                {t.id === theme && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default LifeLayout
