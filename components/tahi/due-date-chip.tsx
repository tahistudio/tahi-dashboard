'use client'

/**
 * <DueDateChip>. The toned, relative due-date chip every Requests surface
 * shares: overdue paints the danger tokens with a warning glyph, work due
 * inside three days paints the amber "due soon" tokens, and anything further
 * out is plain muted text with a calendar glyph.
 *
 * Finished work has no deadline worth showing, so a delivered, cancelled or
 * archived request drops the tone and reads as plain text. The kanban card
 * suppresses the chip for delivered work entirely (BoardItem.hideDueChip),
 * because the timeline still needs the date the card no longer prints.
 *
 * `dueDateState` and `formatDueDateLabel` are exported as pure functions so
 * a caller can reuse the rule without rendering the chip, and so both are
 * unit tested (components/tahi/__tests__/due-date-chip.test.ts).
 */

import * as React from 'react'
import { AlertTriangle, Calendar } from 'lucide-react'
import { REQUEST_CLOSED_STATUSES, TASK_CLOSED_STATUSES } from '@/lib/status-config'

/** How a due date reads right now. */
export type DueDateState = 'overdue' | 'due-soon' | 'on-track'

/**
 * The two closed-status vocabularies, re-exported from lib/status-config.ts
 * so this module stays the one import a chip caller needs, without owning a
 * second copy of either list. REQUEST_CLOSED_STATUSES stays the default
 * below, so every existing caller keeps its behaviour with no edit; a task
 * surface passes TASK_CLOSED_STATUSES, whose only finished status is `done`.
 */
export { REQUEST_CLOSED_STATUSES, TASK_CLOSED_STATUSES }

/** How many days ahead still counts as "due soon". */
export const DUE_SOON_DAYS = 3

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/**
 * The tone a stored `YYYY-MM-DD` due date earns. Null when there is no date
 * or the work is already finished, which is the caller's cue to render the
 * date plainly (or not at all).
 */
export function dueDateState(
  dueDate: string | null | undefined,
  status: string,
  now: Date = new Date(),
  closedStatuses: readonly string[] = REQUEST_CLOSED_STATUSES,
): DueDateState | null {
  if (!dueDate || closedStatuses.includes(status)) return null
  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59`)
  const ms = due.getTime()
  if (Number.isNaN(ms)) return null
  const days = (ms - now.getTime()) / 86_400_000
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due-soon'
  return 'on-track'
}

/** Day and short month, e.g. "15 Sep". Built by hand so it reads the same
 *  in every locale the studio works in. Returns null for an unparseable
 *  value, so the caller can fall back to the raw string. */
export function formatDueDateLabel(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null
  const d = new Date(`${dueDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
}

const TONE: Record<DueDateState, { bg: string; text: string }> = {
  overdue:    { bg: 'var(--color-overdue-bg)',   text: 'var(--color-overdue-text)'   },
  'due-soon': { bg: 'var(--color-due-soon-bg)',  text: 'var(--color-due-soon-text)'  },
  'on-track': { bg: 'transparent',               text: 'var(--color-text-muted)'     },
}

export function DueDateChip({
  dueDate,
  status,
  size = 'md',
  overdue = false,
  closedStatuses,
}: {
  dueDate: string | null | undefined
  status: string
  /** `sm` is the kanban card and other dense surfaces. */
  size?: 'sm' | 'md'
  /**
   * Force the overdue tone. For callers that already hold the answer, or
   * whose `dueDate` is a display string rather than a stored date and so
   * cannot be measured here.
   */
  overdue?: boolean
  /**
   * Which statuses count as finished for this surface. Defaults to the
   * request vocabulary; a task surface passes TASK_CLOSED_STATUSES so a done
   * task with a past date stops reading as overdue.
   */
  closedStatuses?: readonly string[]
}) {
  if (!dueDate) return null
  const state = overdue ? 'overdue' : dueDateState(dueDate, status, undefined, closedStatuses)
  const label = formatDueDateLabel(dueDate) ?? dueDate
  const tone = TONE[state ?? 'on-track']
  const tinted = state === 'overdue' || state === 'due-soon'
  const glyph = size === 'sm' ? '0.625rem' : '0.6875rem'

  return (
    <span
      className="inline-flex items-center font-medium"
      style={{
        gap: '0.1875rem',
        padding: tinted ? '0.125rem 0.375rem' : 0,
        borderRadius: 'var(--radius-sm)',
        fontSize: size === 'sm' ? '0.6875rem' : '0.75rem',
        background: tone.bg,
        color: tone.text,
      }}
    >
      {state === 'overdue'
        ? <AlertTriangle aria-hidden="true" style={{ width: glyph, height: glyph }} />
        : <Calendar aria-hidden="true" style={{ width: glyph, height: glyph }} />}
      {label}
    </span>
  )
}
