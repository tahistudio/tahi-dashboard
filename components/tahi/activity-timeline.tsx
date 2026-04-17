/**
 * <ActivityTimeline> + <ActivityItem> — unified CRM / audit / activity feed.
 *
 * Replaces bespoke implementations on deal-detail, client-detail, and
 * contact-detail pages. Driven by a single shared palette (categorical,
 * not semantic — DESIGN.md red-fatigue rule).
 *
 *   <ActivityTimeline>
 *     <ActivityItem
 *       type="call"
 *       title="Called Acme"
 *       timestamp="2d ago"
 *       actor="Liam"
 *       description="Discussed pricing and next steps"
 *     />
 *     <ActivityItem type="email" title="Proposal sent" timestamp="3h ago" />
 *   </ActivityTimeline>
 *
 * Supported types (extend ACTIVITY_TYPE_META below to add more):
 *   call      blue (phone/telecom)
 *   meeting   purple (face-to-face)
 *   email     teal (communication)
 *   note      muted (passive capture)
 *   task      brand green (action taken)
 *   status    neutral (system-generated status change)
 */

import React from 'react'
import { Phone, Video, Mail, FileText, Check, Activity } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ActivityType = 'call' | 'meeting' | 'email' | 'note' | 'task' | 'status'

interface TypeMeta {
  icon: LucideIcon
  bg: string
  fg: string
  label: string
}

/** Shared activity type palette. Categorical — keep it off the semantic
 *  danger/warning/success tokens so the UI doesn't read any activity
 *  as alarming. */
export const ACTIVITY_TYPE_META: Record<ActivityType, TypeMeta> = {
  call:    { icon: Phone,    bg: 'var(--status-submitted-bg)',     fg: 'var(--status-submitted-text)',     label: 'Call'    },
  meeting: { icon: Video,    bg: 'var(--status-client-review-bg)', fg: 'var(--status-client-review-text)', label: 'Meeting' },
  email:   { icon: Mail,     bg: 'var(--status-in-progress-bg)',   fg: 'var(--status-in-progress-text)',   label: 'Email'   },
  note:    { icon: FileText, bg: 'var(--color-bg-secondary)',      fg: 'var(--color-text-muted)',          label: 'Note'    },
  task:    { icon: Check,    bg: 'var(--color-brand-50)',          fg: 'var(--color-brand)',               label: 'Task'    },
  status:  { icon: Activity, bg: 'var(--color-bg-tertiary)',       fg: 'var(--color-text-muted)',          label: 'Status'  },
}

// ── Timeline root ───────────────────────────────────────────────────────────

interface TimelineProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function ActivityTimeline({ children, className, style }: TimelineProps) {
  return (
    <ol
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        listStyle: 'none',
        padding: 0,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </ol>
  )
}

// ── Timeline item ───────────────────────────────────────────────────────────

interface ItemProps {
  /** Activity type — drives icon + colour. */
  type: ActivityType
  /** Bold title line. */
  title: React.ReactNode
  /** Right-side timestamp text (e.g. "2d ago", "3h ago"). */
  timestamp?: React.ReactNode
  /** Who did it (name or avatar). */
  actor?: React.ReactNode
  /** Optional multi-line description below the title. */
  description?: React.ReactNode
  /** Optional footer slot (actions, links, metadata). */
  children?: React.ReactNode
  /** Optional link — wraps the whole item. */
  href?: string
  className?: string
  style?: React.CSSProperties
}

export function ActivityItem({
  type,
  title,
  timestamp,
  actor,
  description,
  children,
  className,
  style,
}: ItemProps) {
  const meta = ACTIVITY_TYPE_META[type] ?? ACTIVITY_TYPE_META.status
  const Icon = meta.icon

  return (
    <li
      className={className}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        ...style,
      }}
    >
      {/* Icon in a leaf-radius wrapper */}
      <div
        className="flex items-center justify-center flex-shrink-0"
        aria-hidden="true"
        style={{
          width: '2rem',
          height: '2rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: meta.bg,
          color: meta.fg,
        }}
      >
        <Icon size={14} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-start justify-between" style={{ gap: 'var(--space-2)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)' }}>
              {title}
            </div>
            {(actor || description) && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-0-5)' }}>
                {actor && <span>{actor}</span>}
                {actor && description && <span> · </span>}
                {description}
              </div>
            )}
          </div>
          {timestamp && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {timestamp}
            </div>
          )}
        </div>
        {children && <div style={{ marginTop: 'var(--space-2)' }}>{children}</div>}
      </div>
    </li>
  )
}
