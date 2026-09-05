/**
 * lib/status-config.ts
 *
 * Shared status and category colour configurations, plus the canonical
 * ordered status vocabularies for requests and tasks. Consumers (the
 * requests list inline chip, the bulk action menus, the kanban board, the
 * request detail chip select, and tasks-content) all drive off the single
 * REQUEST_STATUSES / TASK_STATUSES exports below so status order, labels,
 * and tones never diverge across surfaces.
 */

import type { BadgeTone } from '@/components/tahi/badge'

export interface StatusStyle {
  label: string
  dot: string
  bg: string
  text: string
  border: string
}

export const REQUEST_STATUS_CONFIG: Record<string, StatusStyle> = {
  draft:         { label: 'Draft',         dot: 'var(--status-draft-dot)',          bg: 'var(--status-draft-bg)',          text: 'var(--status-draft-text)',         border: 'var(--status-draft-border)'         },
  submitted:     { label: 'Submitted',     dot: 'var(--status-submitted-dot)',      bg: 'var(--status-submitted-bg)',      text: 'var(--status-submitted-text)',     border: 'var(--status-submitted-border)'     },
  in_review:     { label: 'In Review',     dot: 'var(--status-in-review-dot)',      bg: 'var(--status-in-review-bg)',      text: 'var(--status-in-review-text)',     border: 'var(--status-in-review-border)'     },
  in_progress:   { label: 'In Progress',   dot: 'var(--status-in-progress-dot)',    bg: 'var(--status-in-progress-bg)',    text: 'var(--status-in-progress-text)',   border: 'var(--status-in-progress-border)'   },
  client_review: { label: 'Client Review', dot: 'var(--status-client-review-dot)',  bg: 'var(--status-client-review-bg)',  text: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  // on_hold reuses the amber warning tokens (visually matches in_review's
  // hue family) and cancelled reuses the red danger tokens. Both token
  // families carry a verified .dark override, so these read correctly in
  // dark mode without new status tokens.
  on_hold:       { label: 'On Hold',       dot: 'var(--badge-warning-dot)',         bg: 'var(--badge-warning-bg)',         text: 'var(--badge-warning-text)',        border: 'var(--badge-warning-border)'        },
  delivered:     { label: 'Delivered',     dot: 'var(--status-delivered-dot)',      bg: 'var(--status-delivered-bg)',      text: 'var(--status-delivered-text)',     border: 'var(--status-delivered-border)'     },
  cancelled:     { label: 'Cancelled',     dot: 'var(--badge-danger-dot)',          bg: 'var(--badge-danger-bg)',          text: 'var(--badge-danger-text)',         border: 'var(--badge-danger-border)'         },
  archived:      { label: 'Archived',      dot: 'var(--status-archived-dot)',       bg: 'var(--status-archived-bg)',       text: 'var(--status-archived-text)',      border: 'var(--status-archived-border)'      },
}

export interface CategoryStyle {
  bg: string
  color: string
}

export const CATEGORY_CONFIG: Record<string, CategoryStyle> = {
  design:      { bg: 'var(--cat-design-bg)',      color: 'var(--cat-design-text)'      },
  development: { bg: 'var(--cat-development-bg)', color: 'var(--cat-development-text)' },
  content:     { bg: 'var(--cat-content-bg)',      color: 'var(--cat-content-text)'     },
  strategy:    { bg: 'var(--cat-strategy-bg)',     color: 'var(--cat-strategy-text)'    },
  admin:       { bg: 'var(--cat-admin-bg)',        color: 'var(--cat-admin-text)'       },
  bug:         { bg: 'var(--cat-bug-bg)',          color: 'var(--cat-bug-text)'         },
}

export const ORG_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border?: string }> = {
  prospect: { label: 'Prospect', bg: 'var(--status-submitted-bg)',   text: 'var(--status-submitted-text)',   border: 'var(--status-submitted-border)' },
  active:   { label: 'Active',   bg: 'var(--status-delivered-bg)',   text: 'var(--status-delivered-text)',   border: 'var(--status-delivered-border)' },
  paused:   { label: 'Paused',   bg: 'var(--status-in-review-bg)',   text: 'var(--status-in-review-text)',   border: 'var(--status-in-review-border)' },
  churned:  { label: 'Churned',  bg: 'var(--color-danger-bg)',       text: 'var(--color-danger)' },
  archived: { label: 'Archived', bg: 'var(--status-archived-bg)',    text: 'var(--status-archived-text)',    border: 'var(--status-archived-border)' },
}

export const INVOICE_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border?: string }> = {
  draft:       { label: 'Draft',       bg: 'var(--status-draft-bg)',      text: 'var(--status-draft-text)',      border: 'var(--status-draft-border)' },
  sent:        { label: 'Sent',        bg: 'var(--status-submitted-bg)',  text: 'var(--status-submitted-text)',  border: 'var(--status-submitted-border)' },
  viewed:      { label: 'Viewed',      bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  paid:        { label: 'Paid',        bg: 'var(--status-delivered-bg)',  text: 'var(--status-delivered-text)',  border: 'var(--status-delivered-border)' },
  overdue:     { label: 'Overdue',     bg: 'var(--color-danger-bg)',      text: 'var(--color-danger)' },
  written_off: { label: 'Written off', bg: 'var(--status-archived-bg)',   text: 'var(--status-archived-text)',   border: 'var(--status-archived-border)' },
}

// ── Canonical status vocabularies ────────────────────────────────────────────

/** One status option: the stored slug, its display label, and the Badge
 *  tone that renders it. Shared shape for requests and tasks so a single
 *  <StatusChipSelect options={...}> can drive off either list. */
export interface StatusOption {
  value: string
  label: string
  tone: BadgeTone
}

/**
 * The one ordered request-status vocabulary. Lifecycle order, left to
 * right, matching the default kanban columns. The list inline chip, the
 * bulk menu, the board, and the request-detail chip select all map over
 * this so ordering / labels / tones stay in lockstep. `draft` is a
 * pre-submission state kept out of the pickers (still styled via
 * REQUEST_STATUS_CONFIG for any request that carries it).
 */
export const REQUEST_STATUSES: readonly StatusOption[] = [
  { value: 'submitted',     label: 'Submitted',     tone: 'info'     },
  { value: 'in_review',     label: 'In Review',     tone: 'warning'  },
  { value: 'in_progress',   label: 'In Progress',   tone: 'teal'     },
  { value: 'client_review', label: 'Client Review', tone: 'purple'   },
  { value: 'on_hold',       label: 'On Hold',       tone: 'warning'  },
  { value: 'delivered',     label: 'Delivered',     tone: 'positive' },
  { value: 'cancelled',     label: 'Cancelled',     tone: 'danger'   },
  { value: 'archived',      label: 'Archived',      tone: 'neutral'  },
]

/**
 * Statuses a one-click chip may pick, wherever a request's status is edited
 * inline (the list column, the detail Actions card). Archived is the one
 * exception: it is destructive, so it lives once in the bulk bar's Danger
 * section behind a confirm rather than one unguarded click away in a cell.
 * Both surfaces read this so they cannot state opposite rules for the same
 * action.
 */
export const EDITABLE_STATUSES: readonly StatusOption[] =
  REQUEST_STATUSES.filter((s) => s.value !== 'archived')

/**
 * Statuses a brand new request may be created at. Delivered and cancelled
 * carry side effects that belong to the status PATCH, so the POST rejects
 * them and the board must not offer a quick-add it knows will 400.
 *
 * This lives here, not in the route, because a route module may only export
 * HTTP methods and route config: the server whitelist and the board's
 * quick-add gate could otherwise only be kept in step by hand. The client
 * side reads it from here now; app/api/admin/requests/route.ts still keeps
 * its own copy and should import this one instead.
 */
export const CREATABLE_STATUSES: readonly string[] = REQUEST_STATUSES
  .map((s) => s.value)
  .filter((v) => v !== 'delivered' && v !== 'cancelled')

/** Whether a new request may be created straight into this status. Custom
 *  kanban columns are checked through here too, so a client-renamed
 *  Delivered column is gated the same way. */
export function canCreateAtStatus(status: string): boolean {
  return CREATABLE_STATUSES.includes(status)
}

/**
 * The one ordered task-status vocabulary. Replaces the three divergent
 * maps that disagreed on Blocked (two TASK_STATUS_CONFIG copies plus a
 * TASK_STATUS_TONE). Settled tones: todo neutral, in_progress info,
 * blocked danger, done positive.
 */
export const TASK_STATUSES: readonly StatusOption[] = [
  { value: 'todo',        label: 'To Do',       tone: 'neutral'  },
  { value: 'in_progress', label: 'In Progress', tone: 'info'     },
  { value: 'blocked',     label: 'Blocked',     tone: 'danger'   },
  { value: 'done',        label: 'Done',        tone: 'positive' },
]

/**
 * The token quad for each task status, matching REQUEST_STATUS_CONFIG's
 * shape so the rail select, the status chip and the board column header can
 * all read one map. Reuses the request pipeline's tokens where the meaning
 * lines up (todo reads as submitted, done reads as delivered) and the shared
 * danger tokens for blocked, all of which carry a verified .dark override.
 */
export const TASK_STATUS_CONFIG: Record<string, StatusStyle> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',   bg: 'var(--status-submitted-bg)',   text: 'var(--status-submitted-text)',   border: 'var(--status-submitted-border)'   },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--badge-danger-dot)',       bg: 'var(--badge-danger-bg)',       text: 'var(--badge-danger-text)',       border: 'var(--badge-danger-border)'       },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',   bg: 'var(--status-delivered-bg)',   text: 'var(--status-delivered-text)',   border: 'var(--status-delivered-border)'   },
}

/** value -> tone lookups, derived from the arrays so they cannot drift. */
export const REQUEST_STATUS_TONE: Record<string, BadgeTone> = Object.fromEntries(
  REQUEST_STATUSES.map((s) => [s.value, s.tone] as [string, BadgeTone]),
)

export const TASK_STATUS_TONE: Record<string, BadgeTone> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.value, s.tone] as [string, BadgeTone]),
)

/** value -> label lookups, derived from the same arrays. */
export const REQUEST_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  REQUEST_STATUSES.map((s) => [s.value, s.label] as [string, string]),
)

export const TASK_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.value, s.label] as [string, string]),
)
