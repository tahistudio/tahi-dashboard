/**
 * lib/import/manyrequests/map.ts
 *
 * The field map, as code. One pure function per vocabulary and one per entity,
 * so every mapping decision is testable without a database, a network or a
 * mock. Nothing in this file writes anything.
 *
 * The three mappings that are judgement calls rather than lookups are marked
 * NEEDS RULING and are surfaced in the dry run rather than buried:
 *
 *   1. ManyRequests 'Closed' is is_closed, NOT is_completed. Roughly 34 rows
 *      carry it and the titles read like finished or abandoned work rather
 *      than cancellations. The default lands them on `cancelled` and every one
 *      is listed in the plan, so Liam can rule before the apply.
 *   2. 'Pending response' means "waiting on the client". D1 has no waiting-on
 *      field yet (the polymorphic blockers slice is where that lives), so it
 *      collapses to `on_hold` and the reason is recorded in formResponses.
 *   3. A ManyRequests plan name ("Glasswall Custom Retainer") has no home in
 *      D1's five-value planType vocabulary. The guess is recorded next to the
 *      verbatim source name in subscriptions.mrServiceName so it stays
 *      auditable.
 */

import type {
  MrInvoice,
  MrRefish,
  MrRequest,
  MrRequestComment,
  MrRequestField,
} from './types'

// ── primitives ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The display name of a value that may be a bare string or an embedded ref. */
export function refName(value: MrRefish): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (isRecord(value) && typeof value.name === 'string') return value.name.trim() || null
  return null
}

/** The id of an embedded ref, as the TEXT key every manyrequestsId column holds. */
export function refId(value: MrRefish): string | null {
  if (isRecord(value)) {
    const raw = value.id
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return null
}

export function refEmail(value: MrRefish): string | null {
  if (isRecord(value) && typeof value.email === 'string') {
    const trimmed = value.email.trim().toLowerCase()
    return trimmed || null
  }
  return null
}

/** A ManyRequests id as the TEXT key. Numbers and strings both land here. */
export function externalKey(value: number | string | null | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed ? trimmed : null
}

/** A currency code, upper-cased. ManyRequests sends GBP, EUR, USD, NZD. */
export function normaliseCurrency(value: unknown, fallback = 'USD'): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : fallback
}

/** An ISO timestamp, or null. Anything unparseable is dropped rather than
 *  written as a string D1 readers would then have to defend against. */
export function normaliseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/** A YYYY-MM-DD date, which is what requests.dueDate / startDate hold. */
export function normaliseDate(value: unknown): string | null {
  const iso = normaliseTimestamp(value)
  return iso ? iso.slice(0, 10) : null
}

export function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Undo the HTML entity escaping the ManyRequests API applies to comment
 * bodies: it returns `That&#039;s` and `&quot;`.
 *
 * IT NEVER PRODUCES MARKUP. `&lt;`, `&gt;` and `&amp;` are left exactly as
 * they arrived, and the numeric decoder refuses the three code points that
 * would spell them (`&#60;`, `&#62;`, `&#38;` and their hex forms). An escaped
 * `&lt;img src=x onerror=...&gt;` in a five-year-old client comment is TEXT and
 * must stay text: turning it back into live markup and storing the result is
 * how an old comment becomes a stored XSS against an admin reading /messages.
 * The importer sanitises on the way in as well (plan.ts wraps every body in
 * sanitizeRichText), so this is the belt to that pair of braces.
 *
 * The cost is that a client who genuinely typed `&lt;` sees `&lt;` rather than
 * `<`, which the render-time escape then prints as the literal text they
 * typed. That is the correct trade at an untrusted boundary.
 */
const MARKUP_CODE_POINTS = new Set([0x26, 0x3c, 0x3e])

export function unescapeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code)
      if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return _match
      if (MARKUP_CODE_POINTS.has(point)) return _match
      return String.fromCodePoint(point)
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => {
      const point = Number.parseInt(code, 16)
      if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return _match
      if (MARKUP_CODE_POINTS.has(point)) return _match
      return String.fromCodePoint(point)
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// ── request status ───────────────────────────────────────────────────────────

/** What a ManyRequests 'Closed' request becomes. Liam's call, not the mapper's. */
export type ClosedRuling = 'cancelled' | 'delivered' | 'archived'

export interface MappedRequestStatus {
  status: string
  /** True when the source status means the work finished. Drives deliveredAt. */
  delivered: boolean
  /** True when the mapping is a guess a human still has to confirm. */
  needsRuling: boolean
  /** Set when meaning was lost in the collapse, recorded on the row. */
  note: string | null
}

/**
 * ManyRequests status -> D1 requests.status.
 *
 * The D1 vocabulary is REQUEST_STATUSES in lib/status-config.ts: draft,
 * submitted, in_review, in_progress, client_review, on_hold, delivered,
 * cancelled, archived. `in_review` has no ManyRequests source and is simply
 * unused by the import.
 */
export function mapRequestStatus(
  value: unknown,
  closedRuling: ClosedRuling = 'cancelled',
): MappedRequestStatus {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (key) {
    case 'submitted':
      return { status: 'submitted', delivered: false, needsRuling: false, note: null }
    case 'in progress':
    case 'in_progress':
      return { status: 'in_progress', delivered: false, needsRuling: false, note: null }
    case 'awaiting approval':
      return { status: 'client_review', delivered: false, needsRuling: false, note: null }
    case 'pending response':
      // Waiting on the CLIENT. D1 has no waiting-on field yet, so the reason
      // is preserved on the row instead of being lost in the collapse.
      return {
        status: 'on_hold',
        delivered: false,
        needsRuling: false,
        note: 'ManyRequests status "Pending response" (waiting on the client). Collapsed to on_hold because D1 has no waiting-on field yet.',
      }
    case 'on hold':
    case 'on_hold':
      return { status: 'on_hold', delivered: false, needsRuling: false, note: null }
    case 'queued':
      return {
        status: 'submitted',
        delivered: false,
        needsRuling: false,
        note: 'ManyRequests status "Queued". D1 expresses a queue with queueOrder on a submitted request.',
      }
    case 'completed':
      return { status: 'delivered', delivered: true, needsRuling: false, note: null }
    case 'closed':
      // NEEDS RULING. is_closed is not is_completed, and the titles read like
      // finished or abandoned work rather than cancellations.
      return {
        status: closedRuling,
        delivered: closedRuling === 'delivered',
        needsRuling: true,
        note: 'ManyRequests status "Closed" (is_closed, not is_completed). Mapped by the closedAs ruling, not by evidence on the row.',
      }
    default:
      return {
        status: 'submitted',
        delivered: false,
        needsRuling: true,
        note: `Unrecognised ManyRequests status ${JSON.stringify(value)}. Landed on submitted.`,
      }
  }
}

/**
 * ManyRequests priority -> D1 requests.priority.
 *
 * D1's writable vocabulary is exactly two values (REQUEST_PRIORITIES in
 * lib/request-vocabulary.ts: standard, high), so a ManyRequests `low` maps to
 * `standard` rather than introducing a third value no picker offers and no
 * status chip styles. The source value is kept verbatim in formResponses, so
 * nothing is lost. Only 6 of the 329 requests carry a priority at all.
 */
export function mapRequestPriority(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return key === 'high' ? 'high' : 'standard'
}

// ── organisation, invoice, subscription vocabularies ─────────────────────────

/**
 * ManyRequests subscription_status -> D1 organisations.status.
 *
 * `paused` maps to `paused` rather than to `active`: D1 has a real paused
 * status with its own chip (ORG_STATUS_CONFIG), so flattening it would lose a
 * state the dashboard can already render.
 */
export function mapOrgStatus(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (key) {
    case 'subscribed':
    case 'expiring':
      return 'active'
    case 'paused':
      return 'paused'
    case 'unsubscribed':
      return 'churned'
    default:
      return 'active'
  }
}

/** ManyRequests invoice status -> D1 invoices.status. */
export function mapInvoiceStatus(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (key) {
    case 'draft':
      return 'draft'
    case 'pending':
    case 'in progress':
      return 'sent'
    case 'paid':
      return 'paid'
    case 'refunded':
    case 'failed':
      return 'written_off'
    default:
      return 'draft'
  }
}

/** ManyRequests subscription status -> D1 subscriptions.status. */
export function mapSubscriptionStatus(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (key === 'canceled' || key === 'cancelled') return 'cancelled'
  if (key === 'paused') return 'paused'
  return 'active'
}

/** ManyRequests billing_period -> D1 subscriptions.billingInterval. */
export function mapBillingInterval(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (key === 'quarterly') return 'quarterly'
  if (key === 'annually' || key === 'annual' || key === 'yearly') return 'annual'
  return 'monthly'
}

/**
 * A ManyRequests service name -> D1 subscriptions.planType.
 *
 * NEEDS RULING, and deliberately crude: an hour-bank retainer is `hourly`,
 * anything with Growth or Total in the name is `scale`, everything else that
 * recurs is `maintain`. The verbatim source name is stored alongside in
 * mrServiceName so the guess is always checkable.
 */
export function mapPlanType(serviceName: string | null): string {
  const name = (serviceName ?? '').toLowerCase()
  if (!name) return 'none'
  if (name.includes('hour') || name.includes('retainer')) return 'hourly'
  if (name.includes('growth') || name.includes('total') || name.includes('scale')) return 'scale'
  return 'maintain'
}

// ── request brief + form responses ───────────────────────────────────────────

const BRIEF_FIELD_LABEL = 'description and supporting links/information'

/**
 * The brief. `description` on the API is almost always null; the real text is
 * the answer to the "Description and supporting links/information" textarea in
 * `fields[]`. The exact label is preferred, then any textarea, then the API's
 * own description, so a request whose form differs still lands with a brief.
 */
export function extractRequestBrief(request: MrRequest): string | null {
  const fields = Array.isArray(request.fields) ? request.fields : []

  const labelled = fields.find(
    (field) => (field.label ?? '').trim().toLowerCase() === BRIEF_FIELD_LABEL,
  )
  const fromLabel = fieldValueToText(labelled)
  if (fromLabel) return fromLabel

  const textarea = fields.find((field) => (field.type ?? '').trim().toLowerCase() === 'textarea')
  const fromTextarea = fieldValueToText(textarea)
  if (fromTextarea) return fromTextarea

  if (typeof request.description === 'string' && request.description.trim()) {
    return unescapeHtmlEntities(request.description.trim())
  }
  return null
}

function fieldValueToText(field: MrRequestField | undefined): string | null {
  if (!field) return null
  const value = field.value
  if (typeof value === 'string' && value.trim()) return unescapeHtmlEntities(value.trim())
  if (Array.isArray(value)) {
    const joined = value.filter((entry): entry is string => typeof entry === 'string').join(', ')
    return joined.trim() ? unescapeHtmlEntities(joined.trim()) : null
  }
  return null
}

/**
 * requests.formResponses. The whole `fields[]` array goes in verbatim so
 * nothing the client typed is lost, alongside the source-only values D1 has no
 * column for (the rating, tracked hours, the service name, the second and
 * subsequent assignees, the original priority and any status note).
 */
export function buildFormResponses(
  request: MrRequest,
  extras: {
    statusNote?: string | null
    serviceName?: string | null
    extraAssignees?: string[]
  } = {},
): string {
  const payload: Record<string, unknown> = {
    _manyrequests: {
      id: externalKey(request.id),
      number: request.number ?? null,
      status: request.status ?? null,
      priority: request.priority ?? null,
      service: refName(request.service),
      brand: refName(request.brand),
      assignees: (Array.isArray(request.assignees) ? request.assignees : [])
        .map((entry) => refName(entry))
        .filter((entry): entry is string => Boolean(entry)),
      trackedHours: request.hours?.tracked_hours ?? null,
      commentsTotal: request.comments_total ?? null,
      fields: Array.isArray(request.fields) ? request.fields : [],
    },
  }
  const mr = payload._manyrequests as Record<string, unknown>
  if (extras.statusNote) mr.statusNote = extras.statusNote
  if (extras.serviceName) mr.serviceName = extras.serviceName
  if (extras.extraAssignees && extras.extraAssignees.length > 0) {
    mr.unassignedExtraAssignees = extras.extraAssignees
  }
  return JSON.stringify(payload)
}

// ── comments ─────────────────────────────────────────────────────────────────

/**
 * The idempotency key for a comment. ManyRequests exposes NO id on the comment
 * shape, so the key is the composite the reconciliation named: the request's
 * ManyRequests id, the comment timestamp, and a slug of the author name. Two
 * identical replies from one author in the same second would collide; that is
 * the known limit of this key and it is why the column is unique (a collision
 * is refused rather than duplicated).
 */
export function commentKey(requestExternalId: string, comment: MrRequestComment): string | null {
  const createdAt = normaliseTimestamp(comment.created_at)
  const author = refName(comment.author)
  if (!createdAt || !author) return null
  const slug = author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `mr:comment:${requestExternalId}:${createdAt}:${slug}`
}

export type AuthorType = 'team_member' | 'contact'

export interface ResolvedAuthor {
  authorId: string
  authorType: AuthorType
}

/**
 * A comment author NAME to a D1 identity.
 *
 * Team first, then the client contacts of the request's own org, then the
 * contacts of any org. Scoping the contact lookup to the org first is what
 * stops a common name at one client resolving to a namesake at another.
 *
 * Returns null when nothing resolves; the caller skips the comment with a
 * reason rather than inventing an author, because a mis-attributed author on a
 * client-visible thread is the worst failure mode this import has.
 */
export function resolveCommentAuthor(
  authorName: string | null,
  index: {
    teamIdByName: ReadonlyMap<string, string>
    contactIdByOrgAndName: ReadonlyMap<string, string>
    contactIdByName: ReadonlyMap<string, string>
  },
  orgId: string | null,
): ResolvedAuthor | null {
  if (!authorName) return null
  const key = authorName.trim().toLowerCase()
  if (!key) return null

  const team = index.teamIdByName.get(key)
  if (team) return { authorId: team, authorType: 'team_member' }

  if (orgId) {
    const scoped = index.contactIdByOrgAndName.get(`${orgId}::${key}`)
    if (scoped) return { authorId: scoped, authorType: 'contact' }
  }

  const anyContact = index.contactIdByName.get(key)
  if (anyContact) return { authorId: anyContact, authorType: 'contact' }

  return null
}

// ── invoices ─────────────────────────────────────────────────────────────────

export interface MappedInvoiceMoney {
  amountUsd: number
  totalUsd: number
  taxAmountUsd: number
  discountAmountUsd: number
  currency: string
}

/**
 * The money on an invoice.
 *
 * The columns are named amountUsd / totalUsd / taxAmountUsd /
 * discountAmountUsd and they DO NOT hold USD: D1 already stores GBP, EUR, NZD
 * and AUD in them alongside a separate `currency` column, and this import adds
 * GBP 3125 and EUR 500 rows to that pile. The names are a legacy this import
 * follows rather than fixes, because renaming them is a separate slice that
 * touches every finance reader.
 *
 * `amountUsd` takes the subtotal (pre-tax, pre-discount) and `totalUsd` takes
 * the charged amount, matching how the Stripe and Xero importers fill them.
 */
export function mapInvoiceMoney(invoice: MrInvoice): MappedInvoiceMoney {
  const total = normaliseNumber(invoice.amount) ?? normaliseNumber(invoice.subtotal) ?? 0
  const subtotal = normaliseNumber(invoice.subtotal) ?? total
  return {
    amountUsd: subtotal,
    totalUsd: total,
    taxAmountUsd: normaliseNumber(invoice.taxes_amount) ?? 0,
    discountAmountUsd: normaliseNumber(invoice.discount) ?? 0,
    currency: normaliseCurrency(invoice.currency),
  }
}

/** The positional key for a line item. See db/schema.ts invoiceItems. */
export function invoiceItemKey(invoiceNumber: string, lineIndex: number): string {
  return `${invoiceNumber}#${lineIndex}`
}

/**
 * paidAt. Only a paid invoice gets one. ManyRequests sends `paid_at` on the
 * paid rows; when it is missing on a row that says paid, `created_at` is the
 * honest fallback for a historical ledger row and null would leave the invoice
 * looking unreconciled forever.
 */
export function mapInvoicePaidAt(invoice: MrInvoice, mappedStatus: string): string | null {
  if (mappedStatus !== 'paid') return null
  return normaliseTimestamp(invoice.paid_at) ?? normaliseTimestamp(invoice.created_at)
}

/**
 * The subscription key. ManyRequests exposes no id on the organization-services
 * shape, so the key is (org id, service name, created_at), which is what makes
 * a re-run of the subscriptions entity an update rather than a duplicate.
 */
export function subscriptionKey(
  orgExternalId: string,
  serviceName: string | null,
  createdAt: string | null,
): string {
  const service = (serviceName ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `mr:subscription:${orgExternalId}:${service}:${createdAt ?? 'unknown'}`
}
