/**
 * lib/notification-links.ts
 *
 * Client-safe (no DB imports) home for the notification taxonomy and the
 * entity -> route resolver. Both the server helper (lib/notifications.ts) and
 * the notification bell import from here, so the event / entity vocabulary and
 * the deep-link targets can never drift apart.
 *
 * To make a new thing notifiable: add its event to NotificationEventType, its
 * entity to NotificationEntityType, and a case to notificationHref. Then any
 * createNotification({ type, entityType, entityId }) call renders in the bell
 * and deep-links on click, with no other wiring.
 */

export type NotificationEventType =
  | 'request_status_changed'
  | 'request_created'
  | 'new_message'
  // Somebody was handed a request, or added to one as PM or follower. Its own
  // event because the three request assignment routes used to borrow
  // 'task_assigned', which put request rows under the task toggle in settings
  // and made "mute task assignments" silence work hand-overs as well.
  // No notificationHref case: these carry entityType 'request', so the deep
  // link is the request case below, for both audiences.
  | 'request_assigned'
  | 'task_assigned'
  | 'task_status_changed'
  | 'invoice_created'
  | 'invoice_paid'
  | 'invoice_overdue'
  | 'proposal_sent'
  | 'proposal_signed'
  | 'contract_sent'
  | 'contract_signed'
  | 'call_scheduled'
  | 'deal_stage_changed'
  | 'lead_assigned'
  | 'schedule_published'
  | 'announcement_posted'
  | 'retainer_churn_risk'
  | 'retainer_upsell_opportunity'
  | 'delivery_off_track'
  | 'subscription_change_requested'
  | 'lead_high_intent'
  | 'lead_idle_qualifying'
  | 'affiliate_reactivation'
  | 'finance_anomaly'
  | 'daily_summary'
  | 'content_ideation'
  | 'cron_failed'

export type NotificationEntityType =
  | 'request'
  | 'task'
  | 'message'
  | 'invoice'
  | 'organisation'
  | 'contract'
  | 'proposal'
  | 'call'
  | 'deal'
  | 'lead'
  | 'schedule'
  | 'announcement'
  | 'subscription'
  | 'affiliate'
  | 'finance_anomaly'
  | 'system'
  | 'content_week'
  | 'cron'

/**
 * Who is clicking. The two audiences do not share a route map: most admin
 * surfaces 403 or redirect a client session, so one map for both meant a
 * client's bell threw them at a page they cannot open.
 */
export type NotificationAudience = 'team' | 'client'

/**
 * Team (Tahi org) route map. Entities with a detail page deep-link to it;
 * list-only surfaces (calls, announcements) land on the list.
 */
function teamHref(
  entityType: NotificationEntityType,
  entityId: string | null | undefined,
): string | null {
  switch (entityType) {
    case 'request':      return entityId ? `/requests/${entityId}` : '/requests'
    case 'task':         return entityId ? `/tasks/${entityId}` : '/tasks'
    case 'invoice':      return entityId ? `/invoices/${entityId}` : '/invoices'
    case 'organisation': return entityId ? `/clients/${entityId}` : '/clients'
    case 'contract':     return entityId ? `/contracts/${entityId}` : '/contracts'
    case 'proposal':     return entityId ? `/proposals/${entityId}` : '/proposals'
    case 'deal':         return entityId ? `/deals/${entityId}` : '/deals'
    case 'lead':         return entityId ? `/leads/${entityId}` : '/leads'
    case 'schedule':     return entityId ? `/schedules/${entityId}` : '/schedules'
    // Comms ride request threads for both audiences. /messages redirects
    // (an admin to /overview, a client to /requests), so pointing a bell row
    // there was a notification that vanished on click. The resolver cannot do
    // better than the list here: a 'message' notification carries the
    // CONVERSATION id, never the request id. Replies on a request thread are
    // already emitted as entityType 'request' and deep-link through the case
    // above, so this branch only catches standalone conversations.
    case 'message':      return '/requests'
    case 'call':         return '/calls'
    case 'announcement': return '/announcements'
    case 'subscription': return '/billing'
    // Cron / operator surfaces: entity ids are synthetic keys (cron:name,
    // affiliate:code, week:label), so these land on the owning page.
    case 'affiliate':       return '/leads'
    case 'finance_anomaly': return '/financial-reports'
    case 'content_week':    return '/content-studio?tab=ideas'
    case 'cron':            return '/settings/crons'
    case 'system':          return null
    default:             return null
  }
}

/**
 * Client portal route map. Only routes whose page renders for a client session
 * appear here; everything else resolves to null so the bell marks the row read
 * without a bounce.
 *
 * Deliberate nulls: tasks are not a client surface (DECISIONS.md), and
 * /schedules, /contracts, /proposals, /calls, /clients, /deals, /leads all
 * redirect a client back to /requests.
 *
 * `invoice` lands on the portal list rather than /invoices/{id}: the invoice
 * detail page still fetches /api/admin/invoices, which 403s a client. Make it
 * a deep link in the same change that gives the detail page a portal branch.
 */
function clientHref(
  entityType: NotificationEntityType,
  entityId: string | null | undefined,
): string | null {
  switch (entityType) {
    case 'request':      return entityId ? `/requests/${entityId}` : '/requests'
    case 'invoice':      return '/invoices'
    case 'subscription': return '/billing'
    // Their own workspace: name, brands, people and plan all live in settings.
    case 'organisation': return '/settings'
    // Client comms ride request threads; /messages redirects them to /requests.
    case 'message':      return '/requests'
    // Announcements render as banners on the portal home.
    case 'announcement': return '/overview'
    case 'task':
    case 'contract':
    case 'proposal':
    case 'deal':
    case 'lead':
    case 'schedule':
    case 'call':
    case 'affiliate':
    case 'finance_anomaly':
    case 'content_week':
    case 'cron':
    case 'system':
      return null
    default:             return null
  }
}

/**
 * Resolve where a notification click should take the user, for their audience.
 * Returns null when the entity has no navigable route for them (the bell then
 * just marks it read).
 *
 * Defaults to the team map so existing callers keep their behaviour; the bell
 * passes the real audience.
 */
export function notificationHref(
  entityType: NotificationEntityType | null | undefined,
  entityId: string | null | undefined,
  audience: NotificationAudience = 'team',
): string | null {
  if (!entityType) return null
  return audience === 'client'
    ? clientHref(entityType, entityId)
    : teamHref(entityType, entityId)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Kinds: the plain vocabulary the /notifications page filters by.
 *
 * The 30 NotificationEventType values above are an internal vocabulary, and
 * NotificationEntityType is nearly as long. Neither is something a client
 * should meet in a filter row. A KIND is the handful of words a person would
 * actually use ("Requests", "Replies", "Invoices"), and every entity folds
 * into exactly one of them.
 * ──────────────────────────────────────────────────────────────────────────── */

export type NotificationKind =
  | 'request'
  | 'message'
  | 'invoice'
  | 'announcement'
  | 'document'
  | 'task'
  | 'call'
  | 'deal'
  | 'system'

/** ShellIcon names, so a request row wears the glyph the rail wears. */
export type NotificationKindIcon =
  | 'requests' | 'messages' | 'invoices' | 'announcements'
  | 'contracts' | 'tasks' | 'calls' | 'deals' | 'settings'

export interface NotificationKindDef {
  key: NotificationKind
  label: string
  icon: NotificationKindIcon
  /** Drives the row icon's tint. */
  tone: 'work' | 'talk' | 'money' | 'info' | 'muted'
}

export const NOTIFICATION_KINDS: Record<NotificationKind, NotificationKindDef> = {
  request:      { key: 'request',      label: 'Requests',     icon: 'requests',      tone: 'work' },
  message:      { key: 'message',      label: 'Replies',      icon: 'messages',      tone: 'talk' },
  invoice:      { key: 'invoice',      label: 'Invoices',     icon: 'invoices',      tone: 'money' },
  announcement: { key: 'announcement', label: 'Studio notes', icon: 'announcements', tone: 'info' },
  document:     { key: 'document',     label: 'Documents',    icon: 'contracts',     tone: 'info' },
  task:         { key: 'task',         label: 'Tasks',        icon: 'tasks',         tone: 'work' },
  call:         { key: 'call',         label: 'Calls',        icon: 'calls',         tone: 'talk' },
  deal:         { key: 'deal',         label: 'Sales',        icon: 'deals',         tone: 'money' },
  system:       { key: 'system',       label: 'System',       icon: 'settings',      tone: 'muted' },
}

/**
 * Which kinds get a filter chip, per audience.
 *
 * 'document' is deliberately absent from the client list: every entity it
 * covers (contract, proposal, schedule) resolves to null for a client, so the
 * chip could only ever return rows with nothing to open, and usually nothing at
 * all. The /notifications page adds a chip for any kind actually present in the
 * rows it loaded, so the day a client-visible document surface exists the chip
 * comes back on its own, with real rows behind it.
 */
export const CLIENT_NOTIFICATION_KINDS: readonly NotificationKind[] =
  ['request', 'message', 'invoice', 'announcement']
export const TEAM_NOTIFICATION_KINDS: readonly NotificationKind[] =
  ['request', 'task', 'message', 'invoice', 'call', 'deal', 'system']

export function notificationKindsFor(audience: NotificationAudience): NotificationKindDef[] {
  const keys = audience === 'client' ? CLIENT_NOTIFICATION_KINDS : TEAM_NOTIFICATION_KINDS
  return keys.map(k => NOTIFICATION_KINDS[k])
}

/**
 * entityType -> kind. Everything folds in, so no row is unfilterable. The
 * inverse is what the API turns `?kind=` into, so the two cannot drift.
 */
export const ENTITY_TYPES_FOR_KIND: Record<NotificationKind, NotificationEntityType[]> = {
  request:      ['request'],
  message:      ['message'],
  invoice:      ['invoice'],
  announcement: ['announcement'],
  document:     ['contract', 'proposal', 'schedule'],
  task:         ['task'],
  call:         ['call'],
  deal:         ['deal', 'lead', 'affiliate'],
  system:       ['system', 'organisation', 'subscription', 'finance_anomaly', 'content_week', 'cron'],
}

const KIND_BY_ENTITY: Partial<Record<NotificationEntityType, NotificationKind>> = (() => {
  const out: Partial<Record<NotificationEntityType, NotificationKind>> = {}
  for (const kind of Object.keys(ENTITY_TYPES_FOR_KIND) as NotificationKind[]) {
    for (const entity of ENTITY_TYPES_FOR_KIND[kind]) out[entity] = kind
  }
  return out
})()

/** The kind a row belongs to. Anything unrecognised lands in System. */
export function notificationKind(entityType: string | null | undefined): NotificationKind {
  if (!entityType) return 'system'
  return KIND_BY_ENTITY[entityType as NotificationEntityType] ?? 'system'
}

export function isNotificationKind(value: string): value is NotificationKind {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, value)
}

/**
 * The entity types a `?kind=a,b` filter expands to. Unknown kinds are dropped,
 * so a bad param narrows to nothing rather than widening to everything.
 */
export function entityTypesForKinds(kinds: readonly string[]): NotificationEntityType[] {
  const out = new Set<NotificationEntityType>()
  for (const k of kinds) {
    if (!isNotificationKind(k)) continue
    for (const entity of ENTITY_TYPES_FOR_KIND[k]) out.add(entity)
  }
  return Array.from(out)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Facets: the counts the /notifications rail puts beside every row.
 *
 * The rail shows a number on all three views and on every kind, and greys out
 * a kind with nothing behind it. Counting the rows the page happens to have
 * loaded cannot answer that: a kind that is real but absent from page one
 * would read 0 and sit disabled, which is a filter the reader cannot press
 * for rows that do exist.
 *
 * So the API counts them, and this is the pure fold from what SQL can group
 * (entity type x read) to what the rail speaks (kind x view). It lives here
 * beside the kind taxonomy so a new entity type folds into a count and into a
 * filter chip in the same edit.
 * ──────────────────────────────────────────────────────────────────────────── */

export type NotificationKindCounts = Record<NotificationKind, number>

/** One `GROUP BY entity_type, read` row. `read` is nullable in the schema. */
export interface NotificationFacetRow {
  entityType: string | null
  read: boolean | number | null
  n: number
}

export interface NotificationFacets {
  /** Row totals per view, over the same window the page pages under. */
  views: { all: number; unread: number; past: number }
  /** Row totals per kind, per view. Never narrowed by the kind filter itself,
   *  so pressing a kind cannot zero every other one under the reader. */
  kinds: { all: NotificationKindCounts; unread: NotificationKindCounts; past: NotificationKindCounts }
}

function emptyKindCounts(): NotificationKindCounts {
  const out = {} as NotificationKindCounts
  for (const key of Object.keys(NOTIFICATION_KINDS) as NotificationKind[]) out[key] = 0
  return out
}

/**
 * Unread means exactly what `?unread=true` returns, which is `read = 0`.
 *
 * `notifications.read` is nullable, and SQL's `read = 0` does not match NULL.
 * Counting a NULL row as unread here would put a number on the Unread view
 * that the Unread view could never show.
 */
function isUnreadFlag(read: boolean | number | null): boolean {
  return read === false || read === 0
}

/**
 * Fold the two grouped reads into the rail's numbers.
 *
 * @param recent rows at or after the window boundary (All and Unread)
 * @param past   rows before it
 */
export function buildNotificationFacets(
  recent: readonly NotificationFacetRow[],
  past: readonly NotificationFacetRow[],
): NotificationFacets {
  const kinds = { all: emptyKindCounts(), unread: emptyKindCounts(), past: emptyKindCounts() }
  const views = { all: 0, unread: 0, past: 0 }

  for (const row of recent) {
    const n = Number(row.n) || 0
    if (n <= 0) continue
    const kind = notificationKind(row.entityType)
    kinds.all[kind] += n
    views.all += n
    if (isUnreadFlag(row.read)) {
      kinds.unread[kind] += n
      views.unread += n
    }
  }

  for (const row of past) {
    const n = Number(row.n) || 0
    if (n <= 0) continue
    kinds.past[notificationKind(row.entityType)] += n
    views.past += n
  }

  return { views, kinds }
}

/**
 * What the row's "Open ..." affordance says, per audience.
 *
 * This is the honest-deep-link half of the notifications page: when the
 * resolver has no route for this audience the row must render as a statement,
 * not as a link that bounces. Callers render a button only when this returns
 * non-null.
 */
export interface NotificationDestination {
  href: string
  label: string
}

const DEST_LABELS: Partial<Record<NotificationEntityType, { detail: string; list: string }>> = {
  request:         { detail: 'the request',       list: 'Requests' },
  task:            { detail: 'the task',          list: 'Tasks' },
  invoice:         { detail: 'the invoice',       list: 'Invoices' },
  organisation:    { detail: 'the client',        list: 'Clients' },
  contract:        { detail: 'the contract',      list: 'Contracts' },
  proposal:        { detail: 'the proposal',      list: 'Proposals' },
  deal:            { detail: 'the deal',          list: 'Deals' },
  lead:            { detail: 'the lead',          list: 'Leads' },
  schedule:        { detail: 'the schedule',      list: 'Schedules' },
  message:         { detail: 'Requests',          list: 'Requests' },
  call:            { detail: 'Calls',             list: 'Calls' },
  announcement:    { detail: 'Announcements',     list: 'Announcements' },
  subscription:    { detail: 'Billing',           list: 'Billing' },
  affiliate:       { detail: 'Leads',             list: 'Leads' },
  finance_anomaly: { detail: 'Financial reports', list: 'Financial reports' },
  content_week:    { detail: 'Content studio',    list: 'Content studio' },
  cron:            { detail: 'Crons',             list: 'Crons' },
}

/** Client-side overrides: the same entity reads differently in the portal. */
const CLIENT_DEST_LABELS: Partial<Record<NotificationEntityType, string>> = {
  invoice:      'Invoices',
  organisation: 'your account',
  announcement: 'Overview',
  subscription: 'Billing',
  message:      'Requests',
}

export function notificationDestination(
  entityType: NotificationEntityType | string | null | undefined,
  entityId: string | null | undefined,
  audience: NotificationAudience = 'team',
): NotificationDestination | null {
  const entity = (entityType ?? null) as NotificationEntityType | null
  const href = notificationHref(entity, entityId, audience)
  if (!href || !entity) return null
  if (audience === 'client') {
    const override = CLIENT_DEST_LABELS[entity]
    if (override) return { href, label: override }
  }
  const labels = DEST_LABELS[entity]
  if (!labels) return { href, label: 'it' }
  return { href, label: entityId ? labels.detail : labels.list }
}
