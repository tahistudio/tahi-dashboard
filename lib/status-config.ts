/**
 * lib/status-config.ts
 *
 * Shared status and category color configurations.
 * Used by status-badge.tsx and request-list.tsx to avoid duplicate definitions.
 */

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
  delivered:     { label: 'Delivered',     dot: 'var(--status-delivered-dot)',      bg: 'var(--status-delivered-bg)',      text: 'var(--status-delivered-text)',     border: 'var(--status-delivered-border)'     },
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
