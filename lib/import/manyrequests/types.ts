/**
 * lib/import/manyrequests/types.ts
 *
 * The wire shapes of the ManyRequests REST API (v1) and the shape of an import
 * plan. Everything the API returns is typed loosely on purpose: it is an
 * external system we do not control, it is being switched off, and a field that
 * is documented as present has been observed absent on older rows (90 of the
 * 329 requests carry `number: null`, most requests carry `description: null`
 * with the real brief in `fields[]`). Every mapper therefore reads defensively
 * and every optional field is `| null | undefined`.
 *
 * NOTHING IN THIS DIRECTORY MAY IMPORT lib/notifications, lib/notification-email,
 * lib/request-status-effects, lib/events, lib/email, lib/announcement-emails,
 * @clerk/*, or anything under app/. That is enforced by a static test
 * (lib/import/manyrequests/__tests__/import-no-mail-imports.test.ts) which walks
 * the whole module graph from this directory, because the reason the importer
 * writes D1 directly instead of going through the API layer is that three
 * routes call the Resend REST endpoint themselves and would not respect a
 * stubbed mailer.
 */

// ── ManyRequests wire shapes ─────────────────────────────────────────────────

/** A nested reference. ManyRequests embeds people and orgs by name, and on the
 *  request shape assignees and comment authors are NAMES ONLY, never ids. */
export interface MrRef {
  id?: number | string | null
  name?: string | null
  email?: string | null
}

/** A value that may arrive as a bare string or as an embedded reference. */
export type MrRefish = MrRef | string | null | undefined

export interface MrOrganization {
  id: number | string
  name?: string | null
  owner?: MrRef | null
  members_count?: number | null
  created_at?: string | null
  /** subscribed | paused | expiring | unsubscribed */
  subscription_status?: string | null
  /** The retainer hour bank. `hours` is what remains and can be negative. */
  balance?: {
    hours?: number | null
    purchased_hours?: number | null
    hours_purchased?: number | null
  } | null
}

export interface MrClient {
  id: number | string
  name?: string | null
  email?: string | null
  organization?: MrRef | null
  created_at?: string | null
  is_owner?: boolean | null
}

export interface MrRequestField {
  id?: number | string | null
  label?: string | null
  type?: string | null
  value?: unknown
}

export interface MrRequestComment {
  /** A display NAME. There is no id and no email on this shape. */
  author?: MrRefish
  content?: string | null
  is_internal?: boolean | null
  created_at?: string | null
}

export interface MrRequest {
  id: number | string
  /** null on the 90 pre-numbering rows. Never renumbered by the import. */
  number?: number | null
  title?: string | null
  /** Submitted | In progress | Awaiting Approval | Pending response | On hold | Queued | Completed | Closed */
  status?: string | null
  /** low | medium | high | null */
  priority?: string | null
  client?: MrRefish
  organization?: MrRefish
  service?: MrRefish
  brand?: MrRefish
  due_date?: string | null
  created_at?: string | null
  updated_at?: string | null
  /** Almost always null. The real brief lives in `fields[]`. */
  description?: string | null
  assignees?: MrRefish[] | null
  tags?: MrRefish[] | null
  fields?: MrRequestField[] | null
  /** Only the 10 most recent come back; `comments_total` is the real count. */
  comments?: MrRequestComment[] | null
  comments_total?: number | null
  hours?: {
    time_estimate_hours?: number | null
    tracked_hours?: number | null
  } | null
}

export interface MrInvoiceLine {
  name?: string | null
  quantity?: number | null
  unit_price?: number | null
  subtotal?: number | null
}

export interface MrInvoice {
  /** The NUMBER is the identifier on this API, e.g. "INV-2025000024". */
  number: string
  /** draft | pending | paid | refunded | failed | in progress */
  status?: string | null
  amount?: number | null
  subtotal?: number | null
  discount?: number | null
  taxes_amount?: number | null
  currency?: string | null
  created_at?: string | null
  paid_at?: string | null
  organization?: MrRefish
  line_items?: MrInvoiceLine[] | null
  taxes?: unknown[] | null
}

export interface MrServicePricingVariation {
  id?: number | string | null
  price?: number | null
  billing_period?: string | null
  hours?: number | null
  credits?: number | null
  enabled?: boolean | null
}

export interface MrService {
  id: number | string
  name?: string | null
  description?: string | null
  /** recurring | one_off */
  type?: string | null
  status?: string | null
  currency?: string | null
  price?: number | null
  hours?: number | null
  credits?: number | null
  is_for_sale?: boolean | null
  pricing_variations?: MrServicePricingVariation[] | null
}

export interface MrBrand {
  id: number | string
  name?: string | null
  logo_url?: string | null
  website?: string | null
}

/** One row of GET /organizations/{id}/services. No id is exposed. */
export interface MrSubscription {
  service?: MrRefish
  /** active | canceled */
  status?: string | null
  /** Monthly | Quarterly | Annually */
  billing_period?: string | null
  /** Who the plan is billed to. May name a soft-deleted client. */
  member?: MrRefish
  hours_per_period?: number | null
  credits_per_period?: number | null
  created_at?: string | null
}

// ── Import plan shapes ───────────────────────────────────────────────────────

export const IMPORT_ENTITIES = [
  'team',
  'organisations',
  'contacts',
  'brands',
  'services',
  'subscriptions',
  'requests',
  'messages',
  'invoices',
] as const

export type ImportEntity = (typeof IMPORT_ENTITIES)[number]

export function isImportEntity(value: unknown): value is ImportEntity {
  return typeof value === 'string' && (IMPORT_ENTITIES as readonly string[]).includes(value)
}

/**
 * Entity order is a dependency order, not a preference. Team must precede
 * messages or every one of Nathan Day's client-facing replies mis-attributes;
 * organisations must precede contacts, requests and invoices; requests must
 * precede messages.
 */
export const IMPORT_ENTITY_ORDER: readonly ImportEntity[] = IMPORT_ENTITIES

/** A row the import refused, with the reason a human needs to act on it. */
export interface SkippedRow {
  /** The ManyRequests key, when the row had one. */
  manyrequestsId: string | null
  /** A human label: an org name, a request title, an invoice number. */
  label: string
  reason: string
}

/**
 * A row the import would create.
 *
 * `table` overrides the entity's own table for the few rows that land
 * elsewhere: the team entity writes team_member_roles alongside team_members,
 * and the invoices entity writes invoice_items alongside invoices. Everything
 * an entity touches therefore stays inside one reviewable plan.
 */
export interface PlannedInsert {
  manyrequestsId: string
  label: string
  values: Record<string, unknown>
  table?: string
}

/** A row the import would change, with only the fields that actually differ. */
export interface PlannedUpdate {
  /** The existing D1 primary key. */
  id: string
  manyrequestsId: string
  label: string
  changes: Record<string, unknown>
  table?: string
}

/**
 * An IMPORTED row that no longer exists upstream. Only ever a row this import
 * created (its manyrequestsId is set), never a hand-made one, and today only
 * invoice line items: a source invoice whose lines change would otherwise keep
 * its old positional lines forever.
 */
export interface PlannedDelete {
  id: string
  manyrequestsId: string
  label: string
  table: string
}

export interface EntityPlan {
  entity: ImportEntity
  /** The D1 table this entity writes to, for the runbook and the audit row. */
  table: string
  toInsert: PlannedInsert[]
  toUpdate: PlannedUpdate[]
  toDelete: PlannedDelete[]
  /** Source rows that matched an existing row with nothing to change. */
  unchanged: number
  skipped: SkippedRow[]
  /**
   * Field-map entries with no D1 column, reported rather than silently
   * dropped: a ManyRequests rating, a second assignee, a per-line tax.
   */
  unmapped: string[]
}

/** The counts a caller sees, whether the run was a dry run or an apply. */
export interface EntityCounts {
  entity: ImportEntity
  table: string
  toInsert: number
  toUpdate: number
  toDelete: number
  unchanged: number
  skipped: number
  /** Rows actually written. Always 0 on a dry run. */
  inserted: number
  updated: number
  deleted: number
}

/**
 * The email-safety probe. Read before and after every run, dry or applied.
 *
 * `suppressions` is the row count of `email_suppressions`, the withheld-send
 * log that the email allowlist writes to BEFORE it looks at the Resend key. If
 * the importer ever reached a mailer, that number would move. It is `null`
 * when the table does not exist yet (its migration is a separate slice), which
 * is not a failure: `notifications` is the second, independent witness and is
 * always present. `createNotifications` inserts a bell row for every recipient
 * it resolves, so an unchanged notifications count is direct evidence that no
 * notification helper was reached either.
 */
export interface MailProbe {
  suppressions: number | null
  notifications: number
}

export interface ImportResult {
  dryRun: boolean
  entities: EntityCounts[]
  /** Per entity, the first 20 rows that would be written. Dry run only. */
  samples: Record<string, unknown[]>
  /** Per entity, the refusals with their reasons. */
  skipped: Record<string, SkippedRow[]>
  unmapped: Record<string, string[]>
  mailProbeBefore: MailProbe
  mailProbeAfter: MailProbe
  /**
   * True when both probes agree. False is a hard signal that something in the
   * run reached a notification or mail path and the run should be treated as
   * suspect even though it reports success.
   */
  mailSilent: boolean
  warnings: string[]
}
