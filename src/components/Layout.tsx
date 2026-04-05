import React, { useCallback, useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../store'

function NavIcon({ icon }: { icon: string }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (icon) {
    case 'grid':
      return <svg {...props}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
    case 'bookmark':
      return <svg {...props}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
    case 'edit':
      return <svg {...props}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
    case 'rss':
      return <svg {...props}><path d="M4 11a9 9 0 019 9" /><path d="M4 4a16 16 0 0116 16" /><circle cx="5" cy="19" r="1" /></svg>
    case 'settings':
      return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    case 'users':
      return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    default:
      return null
  }
}

interface LayoutProps {
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const currentUser = useAppStore((s) => s.currentUser)
  const isAdmin = useAppStore((s) => s.isAdmin)
  const logout = useAppStore((s) => s.logout)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleNav = useCallback(
    (path: string) => {
      navigate(path)
      setMobileOpen(false)
    },
    [navigate]
  )

  const handleLogout = useCallback(() => {
    logout()
    navigate('/')
  }, [logout, navigate])

  const navItems = useMemo(() => {
    const items = [
      { path: '/', label: 'Feed', icon: 'grid' },
      { path: '/saved', label: 'Saved', icon: 'bookmark' },
      { path: '/notes', label: 'Notes', icon: 'edit' },
      { path: '/feeds', label: 'Feeds', icon: 'rss' },
    ]
    if (isAdmin()) {
      items.push({ path: '/admin', label: 'Admin', icon: 'settings' })
    }
    return items
  }, [isAdmin])

  const userInitial = currentUser?.display_name?.[0] ?? currentUser?.username?.[0] ?? '?'

  return (
    <div className="app-layout">
      {mobileOpen && (
        <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon" />
          <span>PaperMind</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => handleNav(item.path)}
            >
              <NavIcon icon={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {currentUser && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {userInitial.toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">
                {currentUser.display_name ?? currentUser.username}
              </div>
              <div className="sidebar-user-role">
                {currentUser.is_admin ? 'Admin' : 'Member'}
              </div>
            </div>
            <button className="btn btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}

        <div className="sidebar-footer">
          <button
            className="collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
          >
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </button>
        </div>
      </aside>

      <main className={`main-content ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span style={{ fontWeight: 650, fontSize: '0.95rem', letterSpacing: '-0.02em' }}>PaperMind</span>
          <div style={{ width: 36 }} />
        </div>
        {children}
      </main>
    </div>
  )
}

export default Layout
