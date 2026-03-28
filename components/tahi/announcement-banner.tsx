'use client'

import { useState, useEffect } from 'react'
import { X, Megaphone } from 'lucide-react'
import { apiPath } from '@/lib/api'

interface PortalAnnouncement {
  id: string
  title: string
  body: string
  type: string
  publishedAt: string | null
  expiresAt: string | null
}

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  info: { bg: 'var(--color-brand)', text: '#ffffff', border: 'var(--color-brand-dark)' },
  warning: { bg: '#f97316', text: '#ffffff', border: '#ea580c' },
  success: { bg: '#22c55e', text: '#ffffff', border: '#16a34a' },
  maintenance: { bg: '#6b7280', text: '#ffffff', border: '#4b5563' },
}

const DISMISSED_KEY = 'tahi-dismissed-announcements'

function getDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
    return []
  } catch {
    return []
  }
}

function addDismissedId(id: string) {
  const current = getDismissedIds()
  if (!current.includes(id)) {
    current.push(id)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(current))
  }
}

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([])

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(apiPath('/api/portal/announcements'))
        if (!res.ok) return
        const data = await res.json() as { announcements: PortalAnnouncement[] }
        const dismissed = getDismissedIds()
        setAnnouncements(
          (data.announcements ?? []).filter((a) => !dismissed.includes(a.id))
        )
      } catch {
        // Silently fail
      }
    }
    load()
  }, [])

  function dismiss(id: string) {
    addDismissedId(id)
    setAnnouncements((prev) => prev.filter((a) => a.id !== id))
  }

  if (announcements.length === 0) return null

  return (
    <div className="space-y-2">
      {announcements.map((a) => {
        const styles = TYPE_STYLES[a.type] ?? TYPE_STYLES.info
        return (
          <div
            key={a.id}
            className="flex items-start gap-3 px-4 py-3 rounded-lg"
            style={{
              background: styles.bg,
              color: styles.text,
            }}
            role="alert"
          >
            <Megaphone className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{a.title}</p>
              {a.body && (
                <p className="text-sm opacity-90 mt-0.5">{a.body}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(a.id)}
              className="flex-shrink-0 p-0.5 rounded hover:opacity-80 transition-opacity"
              aria-label={`Dismiss announcement: ${a.title}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
