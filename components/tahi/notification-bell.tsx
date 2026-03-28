'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { apiPath } from '@/lib/api'

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

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
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

  // Close panel on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close panel on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

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

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative p-2 rounded-lg text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        style={{ minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Bell style={{ width: 16, height: 16 }} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '0.375rem',
              right: '0.375rem',
              minWidth: 16,
              height: 16,
              borderRadius: 99,
              background: 'var(--color-brand)',
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 0.25rem',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card, 0.75rem)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.875rem 1rem 0.75rem',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'var(--color-brand)',
                    background: 'var(--color-brand-50)',
                    padding: '0.0625rem 0.4375rem',
                    borderRadius: 99,
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                className="flex items-center gap-1 text-xs font-medium hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-brand)', background: 'none', border: 'none', cursor: markingAll ? 'not-allowed' : 'pointer', padding: '0.25rem 0.5rem' }}
              >
                <CheckCheck style={{ width: 13, height: 13 }} aria-hidden="true" />
                {markingAll ? 'Marking...' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {loading && notifications.length === 0 ? (
              <div style={{ padding: '1.5rem 1rem' }}>
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse" style={{ marginBottom: '1rem' }}>
                    <div style={{ height: 14, background: 'var(--color-bg-tertiary)', borderRadius: 6, marginBottom: 6, width: '70%' }} />
                    <div style={{ height: 12, background: 'var(--color-bg-secondary)', borderRadius: 6, width: '50%' }} />
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <Bell style={{ width: 24, height: 24, margin: '0 auto 0.625rem', opacity: 0.4 }} aria-hidden="true" />
                <p style={{ fontSize: '0.8125rem' }}>No notifications yet</p>
              </div>
            ) : (
              notifications.map((n, i) => (
                <div
                  key={n.id}
                  onClick={() => { if (!n.read) markOneRead(n.id).catch(() => {}) }}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: i < notifications.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    background: n.read ? 'var(--color-bg)' : 'var(--color-brand-50)',
                    cursor: n.read ? 'default' : 'pointer',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                    {!n.read && (
                      <span
                        style={{
                          width: '0.375rem',
                          height: '0.375rem',
                          borderRadius: '50%',
                          background: 'var(--color-brand)',
                          marginTop: '0.3125rem',
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '0.8125rem',
                          fontWeight: n.read ? 400 : 600,
                          color: 'var(--color-text)',
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--color-text-muted)',
                            margin: '0.125rem 0 0',
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {n.body}
                        </p>
                      )}
                      <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.25rem 0 0' }}>
                        {formatRelative(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
