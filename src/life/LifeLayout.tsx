import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { useHiddenNav } from '../lib/navHidden'
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
    id: 'read',
    label: 'Read',
    items: [
      { path: '/life/articles', label: 'Articles', icon: <Icon kind="edit" /> },
      { path: '/life/reader', label: 'Reader', icon: <Icon kind="book" /> },
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
    case 'menu':
      return (<svg {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>)
    case 'close':
      return (<svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>)
    case 'more':
      return (<svg {...p}><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>)
    case 'grid':
      return (<svg {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>)
    case 'settings':
      // Simple sliders/tune icon — reliable across all themes and renders
      // cleanly at 16px unlike a complex multi-path gear.
      return (<svg {...p}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>)
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [navSettingsOpen, setNavSettingsOpen] = useState(false)
  // Admin control: hide nav items from both sidebars. Shared across
  // Layout.tsx and LifeLayout via a single localStorage key.
  const [hiddenNav, saveHiddenNav] = useHiddenNav()
  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !hiddenNav.includes(i.path)) }))
    .filter((g) => g.items.length > 0)
  const todayTasksRef = useRef<LifeTask[]>([])

  // Auto-close drawer/overflow on route change so navigation feels snappy on mobile.
  useEffect(() => {
    setDrawerOpen(false)
    setOverflowOpen(false)
  }, [location.pathname])

  // Lock body scroll while drawer is open (mobile only — desktop sidebar is static).
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

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

  // Bottom nav: 4 most-used destinations + a "More" trigger that opens the
  // full drawer. Order chosen to match thumb reach on mobile.
  const BOTTOM_NAV: NavItem[] = [
    { path: '/life', label: 'Today', icon: <Icon kind="sun" /> },
    { path: '/life/todos', label: 'Todos', icon: <Icon kind="check" /> },
    { path: '/life/projects', label: 'Projects', icon: <Icon kind="layers" /> },
    { path: '/life/finance', label: 'Money', icon: <Icon kind="wallet" /> },
  ]

  const sidebarContent = (
    <>
      <div className="life-sidebar-header">
        <span className="dot" />
        <span>Life</span>
        <button
          className="life-nav-settings-btn"
          aria-label="Nav visibility"
          title="Choose which sections appear here"
          onClick={() => setNavSettingsOpen(true)}
        >
          <Icon kind="settings" />
        </button>
        <button
          className="life-drawer-close"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        >
          <Icon kind="close" />
        </button>
        <button className="back" onClick={() => navigate('/')}>← back</button>
      </div>

      <WorkspaceSwitcher />

      <nav className="life-nav" aria-label="Life sections">
        {visibleGroups.map((group) => (
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
    </>
  )

  return (
    <div
      className={`life-app life-ws-${workspaceKind}${drawerOpen ? ' drawer-open' : ''}`}
      style={{ ['--ws-accent' as string]: accent }}
    >
      {/* Desktop sidebar — hidden via CSS on mobile */}
      <aside className="life-sidebar life-sidebar-desktop">
        {sidebarContent}
      </aside>

      {/* Mobile drawer — portal'd to body so it isn't clipped by main's
          stacking context. Wrapped in `.life-app` so all the CSS variable
          aliases (--text-muted, --hover, --ws-accent) still apply. */}
      {createPortal(
        <div
          className={`life-app life-ws-${workspaceKind} life-portal-root`}
          style={{ ['--ws-accent' as string]: accent }}
        >
          <div
            className={`life-drawer-backdrop${drawerOpen ? ' open' : ''}`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={`life-sidebar life-sidebar-mobile${drawerOpen ? ' open' : ''}`}
            aria-hidden={!drawerOpen}
            role="dialog"
            aria-label="Navigation"
          >
            {sidebarContent}
          </aside>
        </div>,
        document.body
      )}

      <main className="life-main">
        <header className="life-topbar">
          <button
            className="life-hamburger"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon kind="menu" />
          </button>

          <h1>{title}</h1>

          <div className="life-topbar-pills">
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
            {alignment && alignment.sample > 0 && (
              <span
                className={`life-align-pill ${alignment.rating}`}
                title={`${alignment.sample} tasks in last ${alignment.windowDays}d traced to a quarterly goal`}
              >
                aligned {Math.round(alignment.rate * 100)}%
              </span>
            )}
          </div>

          <div className="spacer" />

          {/* Desktop-only inline controls */}
          <div className="life-topbar-desktop-actions">
            <ModeSwitcher />
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
          </div>

          {/* Mobile-only condensed controls */}
          <div className="life-topbar-mobile-actions">
            <button className="icon-btn" onClick={toggleAgent} aria-label="Open Life copilot">
              <Icon kind="sparkles" />
            </button>
            <NotificationBell />
            <div style={{ position: 'relative' }}>
              <button
                className="icon-btn"
                onClick={() => setOverflowOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={overflowOpen}
                aria-label="More actions"
              >
                <Icon kind="more" />
              </button>
              {overflowOpen && (
                <>
                  <div
                    onClick={() => setOverflowOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                  />
                  <div className="life-overflow-menu" role="menu">
                    <button
                      className="life-overflow-item"
                      onClick={() => { setOverflowOpen(false); setEodOpen(true) }}
                    >
                      ✅ Close the day
                    </button>
                    {!notifGranted && (
                      <button
                        className="life-overflow-item"
                        onClick={() => { setOverflowOpen(false); enableNotifications() }}
                      >
                        🔔 Enable notifications
                      </button>
                    )}
                    <div className="life-overflow-divider" />
                    <div className="life-overflow-section">
                      <ModeSwitcher />
                    </div>
                    <div className="life-overflow-section">
                      <ThemeMenu />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="life-content">{children}</div>

        {/* Mobile bottom nav — hidden via CSS on desktop */}
        <nav className="life-bottomnav" aria-label="Primary">
          {BOTTOM_NAV.map((item) => {
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
          <button onClick={() => setDrawerOpen(true)} aria-label="More sections">
            <Icon kind="grid" />
            <span>More</span>
          </button>
        </nav>
      </main>

      <AgentDock />
      {eodOpen && <EodModal onClose={() => setEodOpen(false)} />}
      {navSettingsOpen && (
        <NavVisibilityModal
          hidden={hiddenNav}
          onChange={saveHiddenNav}
          onClose={() => setNavSettingsOpen(false)}
        />
      )}
    </div>
  )
}

// Main papermind nav items. Mirrors Layout.tsx's admin navItems so the
// admin can toggle visibility of the entire papermind sidebar from inside
// Life. Articles is intentionally absent — for admins it only appears
// under Life → Read → Articles.
const MAIN_NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Feed', icon: null },
  { path: '/saved', label: 'Saved', icon: null },
  { path: '/notes', label: 'Notes', icon: null },
  { path: '/interests', label: 'Interests', icon: null },
  { path: '/feeds', label: 'Feeds', icon: null },
  { path: '/admin/articles', label: 'Approvals', icon: null },
  { path: '/life', label: 'Life', icon: null },
  { path: '/admin', label: 'Admin', icon: null },
]

// Admin nav visibility — toggles which items show up in BOTH the main
// papermind sidebar and the Life sidebar / mobile drawer. Persisted via
// useHiddenNav → localStorage. Pages stay reachable by URL even when hidden.
const NavVisibilityModal: React.FC<{
  hidden: string[]
  onChange: (next: string[]) => void
  onClose: () => void
}> = ({ hidden, onChange, onClose }) => {
  const toggle = (path: string) => {
    onChange(hidden.includes(path) ? hidden.filter((p) => p !== path) : [...hidden, path])
  }
  const Row = ({ path, label }: { path: string; label: string }) => {
    const visible = !hidden.includes(path)
    return (
      <label className={`life-nav-modal-row${visible ? '' : ' off'}`}>
        <span className="life-nav-modal-row-label">{label}</span>
        <span className={`life-nav-modal-switch${visible ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={visible}
            onChange={() => toggle(path)}
          />
          <span className="life-nav-modal-switch-track">
            <span className="life-nav-modal-switch-thumb" />
          </span>
        </span>
      </label>
    )
  }

  return createPortal(
    <div className="life-nav-modal-backdrop" onClick={onClose}>
      <div className="life-nav-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="life-nav-modal-header">
          <div>
            <h3>Navigation visibility</h3>
            <p className="life-nav-modal-hint">
              Hide any section from the sidebars. Pages stay reachable by URL.
            </p>
          </div>
          <button className="life-nav-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="life-nav-modal-body">
          <div className="life-nav-modal-group">
            <div className="life-nav-modal-group-label life-nav-modal-group-papermind">
              Papermind
            </div>
            {MAIN_NAV_ITEMS.map((item) => (
              <Row key={item.path} path={item.path} label={item.label} />
            ))}
          </div>

          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="life-nav-modal-group">
              <div className="life-nav-modal-group-label life-nav-modal-group-life">
                Life · {group.label}
              </div>
              {group.items.map((item) => (
                <Row key={item.path} path={item.path} label={item.label} />
              ))}
            </div>
          ))}
        </div>

        <div className="life-nav-modal-footer">
          <button className="life-nav-modal-ghost" onClick={() => onChange([])}>
            Show all
          </button>
          <button className="life-nav-modal-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
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
