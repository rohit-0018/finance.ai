import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLifeStore } from '../store'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../lib/db'
import type { LifeNotification } from '../types'
import { localTime } from '../lib/time'

const NotificationBell: React.FC = () => {
  const navigate = useNavigate()
  const lifeUser = useLifeStore((s) => s.lifeUser)
  const setUnreadCount = useLifeStore((s) => s.setUnreadCount)
  const unreadCount = useLifeStore((s) => s.unreadCount)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LifeNotification[]>([])

  const load = useCallback(async () => {
    if (!lifeUser) return
    try {
      const list = await listNotifications(lifeUser.id, 30)
      setItems(list)
      setUnreadCount(list.filter((n) => !n.read).length)
    } catch {
      /* swallow until configured */
    }
  }, [lifeUser, setUnreadCount])

  useEffect(() => {
    load()
    if (!lifeUser) return
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load, lifeUser])

  const onClickItem = async (n: LifeNotification) => {
    if (!lifeUser) return
    if (!n.read) {
      try {
        await markNotificationRead(lifeUser.id, n.id)
      } catch {/* ignore */}
    }
    if (n.link) navigate(n.link)
    setOpen(false)
    load()
  }

  const onMarkAll = async () => {
    if (!lifeUser) return
    try {
      await markAllNotificationsRead(lifeUser.id)
    } catch {/* ignore */}
    load()
  }

  return (
    <>
      <button
        className="icon-btn"
        onClick={() => setOpen(!open)}
        title="Notifications"
        aria-label="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="life-notif-dropdown">
          <header>
            <span>Notifications</span>
            <button onClick={onMarkAll}>Mark all read</button>
          </header>
          {items.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted, #888)' }}>
              No notifications yet
            </div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`life-notif-item ${n.read ? '' : 'unread'}`}
                onClick={() => onClickItem(n)}
              >
                <div className="title">{n.title}</div>
                {n.body && <div className="body">{n.body}</div>}
                <div className="time">{localTime(n.created_at)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}

export default NotificationBell
