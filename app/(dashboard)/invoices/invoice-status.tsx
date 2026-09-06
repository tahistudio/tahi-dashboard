/**
 * What state an invoice is in, said once.
 *
 * The list and the detail page each carried their own status map and their own
 * overdue rule, and they had already drifted: the list painted Sent amber and
 * Viewed blue through <Badge>, while the detail page hand-rolled a pill off a
 * second table where Sent and Viewed shared one colour. Same invoice, two
 * readings, on two screens one click apart.
 *
 * So the vocabulary, the derived overdue status and the badge all live here,
 * and both surfaces import them. Same reason <SourceBadge> lives next door.
 */

import { Badge, type BadgeTone } from '@/components/tahi/badge'

/**
 * Status -> label + badge tone. paid=positive, overdue=danger, viewed=info,
 * sent=warning, draft=neutral, written_off=neutral. This is the list's
 * mapping, which follows the spec's reading of INVOICE_STATUS_CONFIG.
 */
export const INVOICE_STATUS_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  draft:       { label: 'Draft',       tone: 'neutral'  },
  sent:        { label: 'Sent',        tone: 'warning'  },
  viewed:      { label: 'Viewed',      tone: 'info'     },
  overdue:     { label: 'Overdue',     tone: 'danger'   },
  paid:        { label: 'Paid',        tone: 'positive' },
  written_off: { label: 'Written Off', tone: 'neutral'  },
}

/**
 * Is this bill past its due date and still owed?
 *
 * A paid or written-off invoice is never overdue, whatever the date says: the
 * money has landed or the debt has been let go, and painting either of them
 * red would put a false chase on the page.
 */
export function isInvoiceOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'paid' || status === 'written_off') return false
  return new Date(dueDate + 'T23:59:59') < new Date()
}

/**
 * The status to SHOW, which is not always the status stored.
 *
 * `overdue` is derived, never written: only a sent invoice past its due date
 * reads as overdue. A draft that has sat around is not overdue, because nobody
 * has been asked for the money yet.
 */
export function effectiveInvoiceStatus(invoice: { status: string; dueDate: string | null }): string {
  return isInvoiceOverdue(invoice.dueDate, invoice.status) && invoice.status === 'sent'
    ? 'overdue'
    : invoice.status
}

/** The one status pill for an invoice, on any surface. */
export function InvoiceStatusBadge({
  status,
  dueDate,
  size = 'sm',
}: {
  status: string
  dueDate: string | null
  size?: 'sm' | 'md'
}) {
  const cfg = INVOICE_STATUS_TONE[effectiveInvoiceStatus({ status, dueDate })]
    ?? INVOICE_STATUS_TONE['draft']
  return <Badge tone={cfg.tone} variant="soft" size={size}>{cfg.label}</Badge>
}
