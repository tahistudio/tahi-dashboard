'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiPath } from '@/lib/api'
import { Popover } from '@/components/tahi/popover'
import { ShellIcon } from '@/components/tahi/shell-icons'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  userId: string
  userType: string
  eventType: string
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  read: boolean
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch { return '' }
}

function iconFor(n: Notification) {
  switch (n.entityType) {
    case 'request':      return <ShellIcon n="requests" s={16} />
    case 'invoice':      return <ShellIcon n="invoices" s={16} />
    case 'message':      return <ShellIcon n="messages" s={16} />
    case 'task':         return <ShellIcon n="tasks" s={16} />
    case 'organisation':
    case 'client':       return <ShellIcon n="clients" s={16} />
    default:             return <ShellIcon n="bell" s={16} />
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/notifications'))
      if (!res.ok) return
      const json = await res.json() as { items?: Notification[]; unreadCount?: number }
      setNotifications(json.items ?? [])
      setUnreadCount(json.unreadCount ?? 0)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + SSE for real-time updates
  useEffect(() => {
    fetchNotifications().catch(() => {})

    // Connect to SSE stream for real-time notifications
    let eventSource: EventSource | null = null
    try {
      eventSource = new EventSource(apiPath('/api/notifications/stream'))

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type: string
            notification?: Notification
          }
          if (data.type === 'notification' && data.notification) {
            const n = data.notification
            setNotifications(prev => {
              // Avoid duplicates
              if (prev.some(existing => existing.id === n.id)) return prev
              return [n, ...prev]
            })
            setUnreadCount(prev => prev + 1)
          }
        } catch {
          // Ignore parse errors from pings
        }
      }

      eventSource.onerror = () => {
        // On error, fall back to polling
        eventSource?.close()
        eventSource = null
      }
    } catch {
      // EventSource not supported or failed, fall back to polling
    }

    // Fallback poll every 60 seconds
    const interval = setInterval(() => {
      fetchNotifications().catch(() => {})
    }, 60000)

    return () => {
      clearInterval(interval)
      eventSource?.close()
    }
  }, [fetchNotifications])

  const markAllRead = useCallback(async () => {
    setMarkingAll(true)
    try {
      await fetch(apiPath('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {
      // silent
    } finally {
      setMarkingAll(false)
    }
  }, [])

  const markOneRead = useCallback(async (id: string) => {
    try {
      await fetch(apiPath('/api/notifications'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      // silent
    }
  }, [])

  const handleToggle = useCallback(() => {
    setOpen(prev => !prev)
    if (!open) {
      fetchNotifications().catch(() => {})
    }
  }, [open, fetchNotifications])

  const openNotification = useCallback((n: Notification) => {
    if (!n.read) markOneRead(n.id).catch(() => {})
    setOpen(false)
  }, [markOneRead])

  const hasUnread = unreadCount > 0

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        className={'tb-bell' + (hasUnread ? ' has-unread' : '')}
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <ShellIcon n="bell" s={18} />
        {hasUnread && <span className="tb-bell-dot" aria-hidden="true" />}
      </button>

      <Popover
        anchorRef={buttonRef}
        open={open}
        onClose={() => setOpen(false)}
        width="23.75rem"
        align="end"
        maxHeight="32rem"
        mobileFullWidth
      >
        <div className="notif">
          <div className="notif-head">
            <h4>Notifications</h4>
            {hasUnread && (
              <button
                className="notif-read"
                onClick={markAllRead}
                disabled={markingAll}
              >
                <ShellIcon n="checks" s={16} />
                {markingAll ? 'Marking...' : 'Mark all as read'}
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading && notifications.length === 0 ? (
              <div style={{ padding: '0.5rem 0.25rem' }}>
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="animate-pulse"
                    style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.75rem' }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--color-bg-tertiary)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, background: 'var(--color-bg-tertiary)', borderRadius: 6, marginBottom: 6, width: '70%' }} />
                      <div style={{ height: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, width: '40%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="notif-empty">
                <span className="notif-empty-ic">
                  <ShellIcon n="bell" s={20} />
                </span>
                You are all caught up.
                <small>New activity will show up here.</small>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  className={'notif-row' + (!n.read ? ' unread' : '')}
                  onClick={() => openNotification(n)}
                >
                  <span className="notif-ic">
                    {iconFor(n)}
                    {!n.read && <span className="notif-dot" aria-hidden="true" />}
                  </span>
                  <span className="notif-body">
                    <b data-private>{n.title}</b>
                    {n.body && (
                      <span
                        data-private
                        style={{
                          fontSize: '0.8125rem',
                          color: 'var(--color-text-muted)',
                          lineHeight: 1.4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {n.body}
                      </span>
                    )}
                    <span className="notif-time">{formatRelative(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}
