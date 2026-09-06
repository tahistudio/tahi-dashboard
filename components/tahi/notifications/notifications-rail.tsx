'use client'

/**
 * <NotificationsRail>. The left rail on /notifications: three views (All,
 * Unread, Past) with counts, then the kinds with counts, then a foot carrying
 * Clear filters and Email preferences.
 *
 * The same component fills the desktop rail and the mobile Filters sheet; the
 * sheet passes `touch` for 44px targets. Every row is <RailViewItem> from
 * components/tahi/rail, which is the control the Requests and Tasks rails are
 * made of, so a notification view row and a task view row are the same object.
 *
 * Two things this rail does that the others do not:
 *
 *  - UNREAD IS A VIEW, not a second lens. The three rooms are mutually
 *    exclusive, so only one row is ever lit and the kinds underneath stay
 *    plain multi-select toggles. The old page had a Past tab AND an unread
 *    chip, which is four states drawn as two controls.
 *  - A KIND WITH NOTHING BEHIND IT IS GREYED rather than hidden. Hiding it
 *    would make the rail's own contents shift under the reader every time a
 *    row arrived; greying it says the filter exists and is empty, and it stays
 *    in the tab order so that statement reaches a keyboard too. The counts
 *    are the server's (`?facets=true`), never the loaded page's, so a kind
 *    that is real but absent from page one is not drawn as an empty one.
 */

import * as React from 'react'
import Link from 'next/link'
import { RailGroupLabel, RailViewItem } from '@/components/tahi/rail/rail-controls'
import { ShellIcon } from '@/components/tahi/shell-icons'
import type { NotificationKind, NotificationKindDef } from '@/lib/notification-links'

/** The three rooms. Mutually exclusive; `all` is the last thirty days. */
export type NotificationView = 'all' | 'unread' | 'past'

export const NOTIFICATION_VIEWS: readonly { key: NotificationView; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'past', label: 'Past' },
]

export type NotificationViewCounts = Record<NotificationView, number>

export interface NotificationsRailProps {
  view: NotificationView
  onViewChange: (next: NotificationView) => void
  /** Null until a read has landed: a rail that says "Requests 5" before the
   *  first response is guessing. */
  viewCounts: NotificationViewCounts | null
  kindDefs: readonly NotificationKindDef[]
  kindCounts: Partial<Record<NotificationKind, number>> | null
  kinds: readonly NotificationKind[]
  onToggleKind: (kind: NotificationKind) => void
  onClearFilters: () => void
  /** Where Email preferences goes. The studio lands on the settings
   *  Notifications section; a client lands on the same section, which is the
   *  Account group of their own settings. */
  prefsHref: string
  /**
   * Which of the two the reader is looking at. The sheet is the same list
   * with its edges taken off, because below 1024px the frame around it
   * already carries them: the views are the segmented track above the feed,
   * Clear filters is the sheet's own foot, and Email preferences is the card
   * at the end of the feed. Drawing any of them twice would put two controls
   * with one accessible name on screen at once.
   */
  variant?: 'rail' | 'sheet'
  /** 44px targets. Set inside the mobile sheet. */
  touch?: boolean
}

const FOOT_LINK_CLASS = 'tahi-focus-ring inline-flex items-center'

function footStyle(touch: boolean): React.CSSProperties {
  return {
    gap: '0.4375rem',
    minHeight: touch ? '2.75rem' : '2rem',
    padding: '0 0.5rem',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
  }
}

/** Brand ink on text is --color-link, never --color-brand-dark: brand-dark has
 *  no `.dark` override, so it lands at roughly 2.2:1 on the dark rail surface.
 *  --color-link is the same #425F39 in light and lifts to #93C98A in dark. */
function hoverOn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = 'var(--color-link)'
  e.currentTarget.style.background = 'var(--color-bg-secondary)'
}

function hoverOff(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.color = 'var(--color-text-muted)'
  e.currentTarget.style.background = 'transparent'
}

export function NotificationsRail({
  view,
  onViewChange,
  viewCounts,
  kindDefs,
  kindCounts,
  kinds,
  onToggleKind,
  onClearFilters,
  prefsHref,
  variant = 'rail',
  touch = false,
}: NotificationsRailProps): React.ReactElement {
  const full = variant === 'rail'
  const anyKind = kinds.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
      {full && (
        <div>
          <RailGroupLabel>Views</RailGroupLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {NOTIFICATION_VIEWS.map(v => (
              <RailViewItem
                key={v.key}
                label={v.label}
                count={viewCounts ? viewCounts[v.key] : null}
                active={view === v.key}
                onClick={() => onViewChange(v.key)}
                touch={touch}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <RailGroupLabel>Kinds</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {kindDefs.map(k => {
            const n = kindCounts ? (kindCounts[k.key] ?? 0) : null
            const empty = n === 0 && !kinds.includes(k.key)
            return (
              <RailViewItem
                key={k.key}
                label={k.label}
                icon={<ShellIcon n={k.icon} s={14} />}
                count={n}
                active={kinds.includes(k.key)}
                disabled={empty}
                title={empty ? `Nothing under ${k.label.toLowerCase()} here yet` : undefined}
                onClick={() => onToggleKind(k.key)}
                touch={touch}
              />
            )
          })}
        </div>
      </div>

      {/* The foot. Clear filters only appears once there is something to
          clear; Email preferences is always here, because it is a destination
          rather than a page action and the header has no room for a second
          button beside the title. */}
      {full && (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.125rem' }}>
        {anyKind && (
          <button
            type="button"
            onClick={onClearFilters}
            className={FOOT_LINK_CLASS}
            style={footStyle(touch)}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            Clear filters
          </button>
        )}
        <Link
          href={prefsHref}
          className={FOOT_LINK_CLASS}
          style={footStyle(touch)}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <span aria-hidden="true" style={{ display: 'flex', color: 'var(--color-text-subtle)' }}>
            <ShellIcon n="settings" s={14} />
          </span>
          Email preferences
        </Link>
      </div>
      )}
    </div>
  )
}
