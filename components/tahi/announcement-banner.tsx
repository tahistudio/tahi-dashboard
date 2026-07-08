'use client'

/**
 * <AnnouncementBanner>. Client-facing broadcast strip (Studio Ledger app-shell
 * "announcement bar" design). Fetches the active, targeted, non-dismissed
 * announcements for the signed-in user from /api/portal/announcements and
 * renders each as a forest-gradient strip above the top bar, styled by type.
 *
 * Dismissing one persists server-side (POST .../dismiss writes
 * announcementDismissals) so it stays gone across devices and reloads; a
 * localStorage cache also hides it instantly on click and on the next paint
 * before the fetch resolves.
 *
 * Self-gating: renders nothing when there is nothing to show, so the dashboard
 * layout mounts it unconditionally. Forest chrome is hardcoded hex in
 * app-shell.css (.ann-bar), the sanctioned CLAUDE.md exception alongside the
 * impersonation banner it sits with.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiPath } from '@/lib/api'

interface PortalAnnouncement {
  id: string
  title: string
  body: string
  type: string
  publishedAt: string | null
  expiresAt: string | null
  /** Optional lead emoji; falls back to a per-type default when absent. */
  emoji?: string | null
  /** Optional call to action; both label and url must be set to render. */
  ctaLabel?: string | null
  ctaUrl?: string | null
}

const TONES = ['info', 'success', 'warning', 'maintenance']

// Per-type lead emoji used when the announcement carries none of its own.
const EMOJI_BY_TYPE: Record<string, string> = {
  info: '\u{1F4E3}',
  success: '✨',
  warning: '⚠️',
  maintenance: '\u{1F6E0}️',
}

const DISMISSED_KEY = 'tahi-dismissed-announcements'

function getDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function addDismissedId(id: string) {
  try {
    const current = getDismissedIds()
    if (!current.includes(id)) localStorage.setItem(DISMISSED_KEY, JSON.stringify([...current, id]))
  } catch {
    // localStorage unavailable: server dismissal is still the source of truth.
  }
}

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(apiPath('/api/portal/announcements'))
        if (!res.ok) return
        const data = (await res.json()) as { announcements?: PortalAnnouncement[] }
        if (cancelled) return
        const dismissed = getDismissedIds()
        setAnnouncements((data.announcements ?? []).filter((a) => !dismissed.includes(a.id)))
      } catch {
        // silent: offline, or not a portal user (admins see none targeted).
      }
    })()
    return () => { cancelled = true }
  }, [])

  const dismiss = useCallback((id: string) => {
    // Optimistic: hide instantly and cache locally, then persist server-side so
    // the next fetch (any device) already excludes it.
    addDismissedId(id)
    setAnnouncements((prev) => prev.filter((a) => a.id !== id))
    fetch(apiPath(`/api/portal/announcements/${id}/dismiss`), { method: 'POST' }).catch(() => {})
  }, [])

  if (announcements.length === 0) return null

  return (
    <>
      {announcements.map((a) => {
        const tone = TONES.includes(a.type) ? a.type : 'info'
        const emoji = a.emoji || EMOJI_BY_TYPE[tone] || EMOJI_BY_TYPE.info
        const hasCta = Boolean(a.ctaLabel && a.ctaUrl)
        return (
          <div key={a.id} className={`ann-bar ann-${tone}`} role="status">
            <span className="ann-emoji" aria-hidden="true">{emoji}</span>
            <div className="ann-txt">
              <b>{a.title}</b>
              {a.body && <span>{a.body}</span>}
            </div>
            {hasCta && (
              <a className="ann-cta" href={a.ctaUrl ?? undefined} target="_blank" rel="noopener noreferrer">
                {a.ctaLabel}
              </a>
            )}
            <button
              className="ann-x"
              onClick={() => dismiss(a.id)}
              aria-label={`Dismiss announcement: ${a.title}`}
            >
              &times;
            </button>
          </div>
        )
      })}
    </>
  )
}
