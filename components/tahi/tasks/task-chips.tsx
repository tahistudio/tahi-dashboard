'use client'

/**
 * The small pieces every Tasks view shares: the level chip, the request chip,
 * the completion tick, the status badge and the subtask badge.
 *
 * All five come straight off the prototype's tasks.css and are sized in rem
 * against the same tokens the Requests chips use, so a row of tasks and a row
 * of requests read as one system.
 *
 * The level chip is deliberately the widest of them: it carries the client
 * avatar, and the container query on the row lets the OTHER chips give up
 * their icons first. The title never gives up width.
 */

import * as React from 'react'
import { Check, Inbox, Leaf, Lock, Users } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { TASK_STATUS_LABELS, TASK_STATUS_TONE } from '@/lib/status-config'
import { TASK_LEVEL_LABELS, type TaskLevel } from '@/lib/tasks-views'

export const LEVEL_ICON: Record<TaskLevel, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  client_task: Users,
  internal_client_task: Lock,
  tahi_internal: Leaf,
}

/** One tint per level. Client borrows the in-progress tokens, Internal the
 *  in-review ones, and Tahi mixes the brand tint against the page so it stays
 *  quiet in both themes. Every token here carries a .dark override. */
const LEVEL_TINT: Record<TaskLevel, { bg: string; text: string; border: string }> = {
  client_task: {
    bg: 'var(--status-in-progress-bg)',
    text: 'var(--status-in-progress-text)',
    border: 'var(--status-in-progress-border)',
  },
  internal_client_task: {
    bg: 'var(--status-in-review-bg)',
    text: 'var(--status-in-review-text)',
    border: 'var(--status-in-review-border)',
  },
  tahi_internal: {
    bg: 'color-mix(in srgb, var(--color-brand-100) 70%, var(--color-bg))',
    text: 'var(--color-brand-dark)',
    border: 'color-mix(in srgb, var(--color-brand) 30%, transparent)',
  },
}

export function LevelChip({ level, clientName, compact = false }: {
  level: TaskLevel
  /** Renders a client avatar after the label. Omit for a Tahi task. */
  clientName?: string | null
  /** Board cards use the icon alone: 1.25rem tall, no label, no avatar. */
  compact?: boolean
}) {
  const Icon = LEVEL_ICON[level]
  const tint = LEVEL_TINT[level]
  const label = TASK_LEVEL_LABELS[level] ?? level

  if (compact) {
    return (
      <span
        className="inline-flex items-center justify-center"
        title={label}
        aria-label={label}
        role="img"
        style={{
          width: '1.25rem',
          height: '1.25rem',
          flexShrink: 0,
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${tint.border}`,
          background: tint.bg,
          color: tint.text,
        }}
      >
        <Icon size={11} aria-hidden />
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: '0.25rem',
        height: '1.375rem',
        padding: '0 0.5rem',
        flexShrink: 0,
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${tint.border}`,
        background: tint.bg,
        color: tint.text,
        fontSize: '0.6875rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={11} aria-hidden />
      {label}
      {clientName && (
        <>
          <span aria-hidden="true" style={{ opacity: 0.5 }}>/</span>
          <Avatar name={clientName} size={14} noRing tooltip={clientName} />
        </>
      )}
    </span>
  )
}

export function RequestChip({ requestId, requestNumber, onOpen }: {
  requestId: string
  /** Rendered as the repo's #042 reference when known, otherwise the chip
   *  shows just the icon and the word Request. */
  requestNumber?: number | null
  /** Called instead of navigating, so the caller can stop the row click. */
  onOpen: (requestId: string) => void
}) {
  const label = requestNumber != null
    ? `#${String(requestNumber).padStart(3, '0')}`
    : 'Request'

  return (
    <button
      type="button"
      className="tahi-focus-ring inline-flex items-center h-11 md:h-[1.375rem]"
      title={`Open request ${label}`}
      aria-label={`Open request ${label}`}
      onClick={e => { e.stopPropagation(); onOpen(requestId) }}
      style={{
        gap: '0.25rem',
        padding: '0 0.5rem',
        flexShrink: 0,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg)',
        fontFamily: 'inherit',
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.color = 'var(--color-brand-dark)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      <Inbox size={11} aria-hidden />
      {label}
    </button>
  )
}

/** Visual diameter of the circle, per size. */
const TICK_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: '1.0625rem',
  md: '1.25rem',
  lg: '1.5rem',
}

const TICK_GLYPH: Record<'sm' | 'md' | 'lg', number> = { sm: 10, md: 12, lg: 14 }

/**
 * The hit box is 2.75rem below md and 2rem above it, with a negative margin
 * that pulls the extra back out of the layout so the circle still reads at
 * its own size. Static class strings, one per size, because a Tailwind class
 * may never be built at runtime.
 */
const TICK_HIT: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-11 w-11 md:h-8 md:w-8 -m-[0.84375rem] md:-m-[0.46875rem]',
  md: 'h-11 w-11 md:h-8 md:w-8 -m-3 md:-m-1.5',
  lg: 'h-11 w-11 md:h-8 md:w-8 -m-2.5 md:-m-1',
}

export function TaskTick({ done, blocked = false, size = 'md', disabled = false, title, onToggle }: {
  done: boolean
  /** Dashed danger ring: the task is stalled and reads that way before you
   *  open it. */
  blocked?: boolean
  /** 'sm' 1.0625rem inside the subtask panel, 'md' 1.25rem on a row,
   *  'lg' 1.5rem in the detail head. */
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /** The task title, for the accessible name. */
  title: string
  onToggle: () => void
}) {
  const diameter = TICK_SIZE[size]
  const hint = blocked && !done ? 'Blocked. Complete anyway' : done ? 'Reopen' : 'Mark done'

  // Hover is React state rather than a direct style write because the circle
  // is a child of the hit box, so there is no `currentTarget` to paint. The
  // reset on leave is unconditional and the paint is derived, so a click that
  // flips `done` under a stationary cursor cannot strand the hover colour.
  const [hovered, setHovered] = React.useState(false)
  const previewing = hovered && !done && !disabled

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reopen ${title}` : `Complete ${title}`}
      aria-disabled={disabled || undefined}
      title={hint}
      className={`tahi-focus-ring group inline-flex items-center justify-center flex-shrink-0 ${TICK_HIT[size]}`}
      onClick={e => {
        e.stopPropagation()
        if (disabled) return
        onToggle()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 0,
        border: 'none',
        borderRadius: 'var(--radius-full)',
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* group-active rather than active, so a press anywhere in the hit box
          scales the circle, not only a press that lands on the circle. */}
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center group-active:scale-90"
        style={{
          width: diameter,
          height: diameter,
          borderRadius: 'var(--radius-full)',
          border: done
            ? '1.5px solid var(--color-brand)'
            : blocked
              // Hover keeps the dash, which is what says blocked, and only
              // moves its colour, so the signal survives the feedback.
              ? `1.5px dashed ${previewing ? 'var(--color-brand)' : 'var(--color-danger)'}`
              : `1.5px solid ${previewing ? 'var(--color-brand)' : 'var(--color-border)'}`,
          background: done ? 'var(--color-brand)' : 'var(--color-bg)',
          color: done
            ? 'var(--color-text-on-dark)'
            // A ghosted tick under the cursor says what the click will do.
            : previewing ? 'color-mix(in srgb, var(--color-brand) 45%, transparent)' : 'transparent',
          transition: 'background-color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out), transform var(--motion-quick) var(--ease-out)',
        }}
      >
        <Check size={TICK_GLYPH[size]} aria-hidden />
      </span>
    </button>
  )
}

export function TaskStatusBadge({ status, size = 'sm' }: {
  status: string
  size?: 'sm' | 'md'
}) {
  return (
    <Badge tone={TASK_STATUS_TONE[status] ?? 'neutral'} variant="soft" size={size} leader="dot">
      {TASK_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

export function SubtaskBadge({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  const complete = done >= total
  return (
    <span
      className="inline-flex items-center tabular-nums"
      title={`${done} of ${total} subtasks done`}
      style={{
        gap: '0.1875rem',
        flexShrink: 0,
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: complete ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
        whiteSpace: 'nowrap',
      }}
    >
      <Check size={10} aria-hidden />
      {done}/{total}
    </span>
  )
}
