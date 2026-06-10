/**
 * lib/delivery-status-labels.ts — presentational maps for delivery status.
 *
 * Pure data (no React), so both client components (gantt-grid, cards, widgets)
 * and server code (the delivery-watch cron) can import the same source of truth.
 * Colours are hardcoded hex (brand-locked visual, like OWNER_BG).
 */

import type { DeliveryStatus } from '@/lib/delivery-status'

export const DELIVERY_STATUS_COLOR: Record<DeliveryStatus, string> = {
  done: '#4ade80',
  in_progress: '#60a5fa',
  not_started: '#cbd5e1',
  at_risk: '#fb923c',
  delayed: '#f87171',
  blocked: '#b91c1c',
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  done: 'Done',
  in_progress: 'In progress',
  not_started: 'Not started',
  at_risk: 'At risk',
  delayed: 'Delayed',
  blocked: 'Blocked',
}
