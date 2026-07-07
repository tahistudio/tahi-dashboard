import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ============================================================
// HELPERS
// ============================================================

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}

// ============================================================
// ORGANISATIONS (Client companies / brands)
// ============================================================

export const organisations = sqliteTable('organisations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  website: text('website'),
  logoUrl: text('logo_url'),
  industry: text('industry'),
  // prospect | active | paused | churned | archived
  status: text('status').notNull().default('prospect'),
  // maintain | scale | tune | launch | hourly | custom | none
  planType: text('plan_type').default('none'),
  stripeCustomerId: text('stripe_customer_id'),
  // Clerk organization id this client signs in through. Null until the client
  // first authenticates: a self-serve signup creates a fresh Clerk org and
  // links it here; an invited client links the org on accept. getPortalAuth
  // resolves a caller's Clerk org back to this D1 row via this column, so the
  // D1 primary key (a stable UUID referenced by every FK) never has to equal
  // the Clerk org id.
  clerkOrgId: text('clerk_org_id'),
  xeroContactId: text('xero_contact_id'),
  // green | amber | red
  healthStatus: text('health_status').default('green'),
  healthNote: text('health_note'),
  onboardingLoomUrl: text('onboarding_loom_url'),
  // JSON: { step_key: boolean }
  onboardingState: text('onboarding_state').default('{}'),
  parentOrgId: text('parent_org_id'),
  preferredCurrency: text('preferred_currency').default('USD'),
  convertedFromProjectId: text('converted_from_project_id'),
  internalNotes: text('internal_notes'),
  // JSON array of brand names, e.g. ["Brand A", "Brand B"]
  brands: text('brands').default('[]'),
  // JSON array of free-form tag strings, e.g. ["enterprise", "at risk"].
  // Used to group/filter clients and their requests. (The managed `tags`
  // table is unused; these are lightweight string labels.)
  tags: text('tags').default('[]'),
  // S13 remaining: CRM extended fields
  // JSON object for arbitrary custom fields, e.g. {"industry_vertical":"SaaS"}
  customFields: text('custom_fields').default('{}'),
  defaultHourlyRate: integer('default_hourly_rate'),
  // micro | small | medium | large | enterprise
  size: text('size'),
  annualRevenue: integer('annual_revenue'),
  // Per-client tracks override (migration 0079). Wins over the plan default for
  // every client, not just custom plans.
  //   auto   = derive tracks from the plan entitlements (+ ghost upsell)
  //   custom = use customSmallTracks / customLargeTracks (no upsell)
  //   off    = one unified board, no per-track split, no upsell
  tracksMode: text('tracks_mode').default('auto'),
  customSmallTracks: integer('custom_small_tracks').default(0),
  customLargeTracks: integer('custom_large_tracks').default(0),
  ...timestamps,
}, (table) => [
  index('idx_orgs_status').on(table.status),
  index('idx_orgs_plan').on(table.planType),
  index('idx_orgs_stripe_customer').on(table.stripeCustomerId),
  // Non-null clerk_org_id must be unique (one D1 org per Clerk org). SQLite
  // treats NULLs as distinct, so unprovisioned orgs all sit at NULL happily.
  uniqueIndex('idx_orgs_clerk_org').on(table.clerkOrgId),
])

// ============================================================
// CONTACTS (People at client orgs)
// ============================================================

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // personId bridges contact to the canonical person identity (added
  // in migration 0018). Nullable for existing rows — new contacts
  // MUST populate via lookup-or-create on email. Backfill of existing
  // rows happens via an email-match script.
  personId: text('person_id'),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  clerkUserId: text('clerk_user_id'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
  // Portal access role — the client-admin authority signal. Deny-by-default:
  // 'member' can only see their own scoped portal view; 'admin' can administer
  // the org's portal (manage contacts, billing visibility, etc). Kept separate
  // from `isPrimary` (single email-targeting flag, one per org) and the
  // free-text `role` (job title). Backfilled to 'admin' where isPrimary=1.
  // 'admin' | 'member'
  portalRole: text('portal_role').notNull().default('member'),
  lastLoginAt: text('last_login_at'),
  ...timestamps,
}, (table) => [
  index('idx_contacts_org').on(table.orgId),
  index('idx_contacts_clerk').on(table.clerkUserId),
  index('idx_contacts_person').on(table.personId),
  index('idx_contacts_email').on(table.email),
])

// ============================================================
// ONBOARDING INVITES (opaque link tokens for client / team onboarding)
// ============================================================
// Flow: an admin creates the client (org row) first, then generates an opaque,
// non-guessable token. The link (/onboarding?token=... or /welcome?token=...)
// carries the engagement context through sign-in and, on first use, joins the
// user to the pre-created org with NO payment step, optionally attaching their
// contract / schedule / proposal. Self-serve signups never need a token.
// Persona is read from this row (server-trusted), never from a spoofable query
// param. See lib/onboarding-invites.ts (create / resolve / consume).
export const onboardingInvites = sqliteTable('onboarding_invites', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // The opaque random string that appears in the link. Non-guessable, unique.
  token: text('token').notNull(),
  // 'client' | 'team'
  flow: text('flow').notNull().default('client'),
  // The pre-created org this invite joins the user to (client flow).
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  // ClientPersona for the client flow: retainer | project | existing_project |
  // existing_retainer | selfserve.
  persona: text('persona'),
  // Optional engagement artefacts already set up for this client.
  contractId: text('contract_id'),
  scheduleId: text('schedule_id'),
  proposalId: text('proposal_id'),
  // Prefill identity, so we never re-ask for what we already hold.
  contactEmail: text('contact_email'),
  contactName: text('contact_name'),
  // Lifecycle. Single-use: usedAt + usedByUserId stamp the consuming user.
  expiresAt: text('expires_at'),
  usedAt: text('used_at'),
  usedByUserId: text('used_by_user_id'),
  // Team member who generated the link.
  createdById: text('created_by_id'),
  ...timestamps,
}, (table) => [
  uniqueIndex('idx_onboarding_invites_token').on(table.token),
  index('idx_onboarding_invites_org').on(table.orgId),
])

// ============================================================
// TEAM MEMBERS (Tahi internal)
// ============================================================

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // personId bridges team_member to the canonical person identity.
  // A team member IS a person — same human, employment-specific role.
  // Nullable for existing rows; new inserts populate via lookup-or-
  // create on email. Existing rows get backfilled via email match.
  personId: text('person_id'),
  name: text('name').notNull(),
  email: text('email').notNull(),
  title: text('title'),
  // admin | member
  role: text('role').notNull().default('member'),
  clerkUserId: text('clerk_user_id'),
  weeklyCapacityHours: real('weekly_capacity_hours').default(40),
  // hourlyCostRate, compensationType, annualSalary live in DB via
  // migration 0016 but are NOT in Drizzle schema to avoid breaking
  // SELECT * before migration is applied. Access via raw SQL.
  // JSON array of skill tags
  skills: text('skills').default('[]'),
  isContractor: integer('is_contractor', { mode: 'boolean' }).default(false),
  slackUserId: text('slack_user_id'),
  avatarUrl: text('avatar_url'),
  reportsToId: text('reports_to_id'),
  department: text('department'),
  // S20: JSON array of role strings, e.g. ["CEO","Developer"]
  roles: text('roles').default('[]'),
  ...timestamps,
}, (table) => [
  index('idx_team_members_clerk').on(table.clerkUserId),
  index('idx_team_members_person').on(table.personId),
])

// ============================================================
// PERMISSIONS (Granular RBAC + ABAC)
//
// Standard RBAC + ABAC hybrid: roles bundle permissions, members
// hold one or more roles, and each grant inside a role can carry a
// SCOPE filter (own / team / specific_orgs / plan_type / track_type
// / status) so a single permission can mean "view all leads" for
// one role and "view leads I own at Glasswall" for another.
//
// Enforcement is a runtime layer applied at the API + UI gate. The
// schema declares everything possible — what's allowed at the API
// is whatever the active roles' permissions cover, intersected with
// their scope filters.
//
// Seeding happens via a one-shot setup endpoint that populates the
// system roles (super_admin / admin / project_manager / task_handler
// / viewer) + the full permission catalogue. Custom roles can be
// added on top.
// ============================================================

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // 'super_admin', 'admin', 'project_manager', 'task_handler',
  // 'viewer', or any custom name. Unique across the workspace.
  name: text('name').notNull().unique(),
  description: text('description'),
  // System roles can't be deleted or renamed. Custom roles can.
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
})

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Resource name: leads | deals | contacts | people | organisations
  // | requests | tasks | invoices | contracts | proposals | schedules
  // | calls | activities | docs | time_entries | subscribers
  // | campaigns | affiliates | reports | settings | team
  // | integrations | calculator | sales_analytics
  resource: text('resource').notNull(),
  // Action verb: view | create | edit | delete | export | share
  // | assign | promote | archive | comment | send | sign | publish
  action: text('action').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_permissions_resource').on(table.resource),
])

export const rolePermissions = sqliteTable('role_permissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: text('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  // Scope narrows the grant to a subset of resource rows:
  //   all            — every row of the resource (default)
  //   own            — rows where ownerId / createdById matches the caller
  //   team           — rows owned by anyone in the caller's team / department
  //   specific_orgs  — scopeValue is a JSON array of organisation ids
  //   plan_type      — scopeValue is e.g. "retainer" / "project"
  //   track_type     — scopeValue is "small" / "large"
  //   status         — scopeValue is a JSON array of allowed status values
  //                    e.g. ["new","qualifying"] on leads
  scopeType: text('scope_type').notNull().default('all'),
  scopeValue: text('scope_value'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_role_permissions_role').on(table.roleId),
  index('idx_role_permissions_perm').on(table.permissionId),
])

export const teamMemberRoles = sqliteTable('team_member_roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamMemberId: text('team_member_id').notNull().references(() => teamMembers.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  // Date range — a role can be temporary (covering a project, or
  // while someone fills in for a colleague). endedAt null = active.
  startedAt: text('started_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  endedAt: text('ended_at'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_team_member_roles_member').on(table.teamMemberId),
  index('idx_team_member_roles_role').on(table.roleId),
  index('idx_team_member_roles_active').on(table.endedAt),
])

// Per-field denial layer: hide salary on team_members for non-admins,
// hide cost_amount on time_entries for task_handlers, etc. Resource
// + field + action combo means "this role CANNOT see/edit this
// field" — additive denials, applied on top of role_permissions
// grants. If no row exists, the field is shown normally.
export const fieldRestrictions = sqliteTable('field_restrictions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  field: text('field').notNull(),
  // view = field hidden from response | edit = field returned but
  // rejected by PATCH for this role
  action: text('action').notNull().default('view'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_field_restrictions_role').on(table.roleId),
  index('idx_field_restrictions_resource').on(table.resource),
])

// Feature visibility (granular permissions, delivery of SPECS/granular-permissions.md).
// Layered on top of #119 RBAC: lets the owner turn whole features or sub-parts
// (page > tab > card, keyed by FEATURE_TREE in lib/feature-tree.ts) on/off for a
// specific role, a specific team member, OR a specific client org. Resolution is
// most-specific-wins (team_member/org override > role grant > default); a `deny`
// beats an `allow` at the same specificity. `reason` is the free-text "why".
export const featureVisibility = sqliteTable('feature_visibility', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Who the rule applies to.
  subjectType: text('subject_type').notNull(), // 'role' | 'team_member' | 'organisation'
  subjectId: text('subject_id').notNull(),     // roleId | teamMemberId | orgId
  // Dotted FEATURE_TREE path, e.g. 'requests', 'requests.board', 'clients.billing_card'.
  featureKey: text('feature_key').notNull(),
  effect: text('effect').notNull().default('deny'), // 'allow' | 'deny'
  reason: text('reason'),                            // free-text why
  createdById: text('created_by_id'),
  ...timestamps,
}, (table) => [
  index('idx_feature_visibility_subject').on(table.subjectType, table.subjectId),
  index('idx_feature_visibility_feature').on(table.featureKey),
  uniqueIndex('idx_feature_visibility_unique').on(table.subjectType, table.subjectId, table.featureKey),
])

// ============================================================
// PROJECTS (One-off engagements)
// ============================================================

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // tune | launch | hourly | custom
  type: text('type').notNull(),
  // fixed | hourly | custom
  billingType: text('billing_type').notNull().default('fixed'),
  name: text('name').notNull(),
  // active | delivered | archived
  status: text('status').notNull().default('active'),
  priceUsd: real('price_usd'),
  hourlyRateUsd: real('hourly_rate_usd'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  startDate: text('start_date'),
  expectedDelivery: text('expected_delivery'),
  deliveredAt: text('delivered_at'),
  // Post-delivery support window expiry
  supportExpiresAt: text('support_expires_at'),
  ...timestamps,
}, (table) => [
  index('idx_projects_org').on(table.orgId),
  index('idx_projects_status').on(table.status),
])

// ============================================================
// SUBSCRIPTIONS (Retainer engagements)
// ============================================================

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // maintain | scale
  planType: text('plan_type').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  // active | paused | cancelled | past_due | trialing
  status: text('status').notNull().default('active'),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  hasPrioritySupport: integer('has_priority_support', { mode: 'boolean' }).default(false),
  hasSeoAddon: integer('has_seo_addon', { mode: 'boolean' }).default(false),
  loyaltyDiscountApplied: integer('loyalty_discount_applied', { mode: 'boolean' }).default(false),
  referralCouponId: text('referral_coupon_id'),
  cancelledAt: text('cancelled_at'),
  cancellationReason: text('cancellation_reason'),
  // S21: Billing tiers
  // monthly | quarterly | annual
  billingInterval: text('billing_interval').default('monthly'),
  // JSON array, e.g. ["seo_dashboard","extra_track","priority_support"]
  includedAddons: text('included_addons').default('[]'),
  discountPercent: real('discount_percent'),
  // ISO country code for GST logic (e.g. "NZ" for 15% GST)
  billingCountry: text('billing_country'),
  ...timestamps,
}, (table) => [
  index('idx_subs_org').on(table.orgId),
  index('idx_subs_status').on(table.status),
  index('idx_subs_stripe').on(table.stripeSubscriptionId),
])

// ============================================================
// TRACKS (Capacity slots per subscription)
// ============================================================

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  subscriptionId: text('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  // small | large
  type: text('type').notNull(),
  isPriorityTrack: integer('is_priority_track', { mode: 'boolean' }).default(false),
  // ID of request currently occupying this track (nullable = track is free)
  currentRequestId: text('current_request_id'),
  ...timestamps,
}, (table) => [
  index('idx_tracks_subscription').on(table.subscriptionId),
])

// ============================================================
// REQUESTS (All work items)
// ============================================================

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  trackId: text('track_id').references(() => tracks.id),
  projectId: text('project_id'),
  brandId: text('brand_id'),
  // Legacy: small_task | large_task | bug_fix | ...  — replaced by `size` below.
  // Kept on the row for read-compat until all callers are migrated off it.
  type: text('type').notNull().default('small_task'),
  // NEW : simplified size system. 'small' | 'large'.
  // Backfill = small_task/bug_fix/content_update/consultation -> 'small', everything else -> 'large'.
  size: text('size').default('small'),
  // design | development | content | strategy | admin | bug
  category: text('category'),
  title: text('title').notNull(),
  // Tiptap JSON stored as text
  description: text('description'),
  // draft | submitted | in_review | in_progress | client_review | delivered | archived
  status: text('status').notNull().default('submitted'),
  // standard | high
  priority: text('priority').notNull().default('standard'),
  assigneeId: text('assignee_id').references(() => teamMembers.id),
  // NEW : one level of nesting. Null = top-level request.
  // Must share orgId with the parent (enforced at insert/update time in API layer).
  // Cascading delete: removing a parent cascades to its children.
  parentRequestId: text('parent_request_id'),
  // NEW : position among sibling sub-requests (lower = earlier in the list).
  // Drag-reorder inside a parent updates this value. Null for top-level requests.
  subPosition: integer('sub_position'),
  // Contact ID or team_member ID
  submittedById: text('submitted_by_id'),
  submittedByType: text('submitted_by_type').default('contact'),
  estimatedHours: real('estimated_hours'),
  // ISO-8601 date strings (YYYY-MM-DD)
  startDate: text('start_date'),
  dueDate: text('due_date'),
  // Position in the queue for its track type (lower = sooner)
  queueOrder: integer('queue_order').default(0),
  revisionCount: integer('revision_count').default(0),
  maxRevisions: integer('max_revisions').default(3),
  scopeFlagged: integer('scope_flagged', { mode: 'boolean' }).default(false),
  // Optional reason given by admin when flagging
  scopeFlagReason: text('scope_flag_reason'),
  // Admin-created on behalf of client (not visible in portal as "client submitted")
  isInternal: integer('is_internal', { mode: 'boolean' }).default(false),
  // JSON: form field responses
  formResponses: text('form_responses').default('{}'),
  // JSON array of tag IDs
  tags: text('tags').default('[]'),
  deliveredAt: text('delivered_at'),
  // Auto-incrementing request number for display (#001, #002, ...)
  requestNumber: integer('request_number'),
  // JSON: array of checklists [{title, items: [{label, done}]}]
  checklists: text('checklists').default('[]'),
  // Delivery spine (#148): the schedule gantt row this request delivers.
  // Null = not mapped to a plan phase. One row -> many requests.
  scheduleRowId: text('schedule_row_id').references(() => scheduleRows.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  index('idx_requests_org').on(table.orgId),
  index('idx_requests_status').on(table.status),
  index('idx_requests_assignee').on(table.assigneeId),
  index('idx_requests_track').on(table.trackId),
  index('idx_requests_number').on(table.requestNumber),
  index('idx_requests_parent').on(table.parentRequestId),
  index('idx_requests_schedule_row').on(table.scheduleRowId),
])

// ============================================================
// REQUEST PARTICIPANTS (multi-assignee + PM + followers)
// ============================================================
// Replaces the single requests.assigneeId with a junction table that
// supports multiple assignees, one optional project manager, and any
// number of followers (team members OR client contacts).
//
// Roles :
//   'pm'        : zero or one per request. Shown prominently.
//   'assignee'  : zero or many. Notified on client replies + status moves.
//   'follower'  : zero or many. Team members OR client contacts. Notified
//                 on status moves (to submitted/in_review/client_review)
//                 and public messages + client feedback. Never notified
//                 of their own actions.
//
// A single person (by participantId + participantType) can have at most
// one role per request. Enforced via unique index.

export const requestParticipants = sqliteTable('request_participants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  requestId: text('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  participantId: text('participant_id').notNull(),
  // 'team_member' | 'contact'
  participantType: text('participant_type').notNull(),
  // 'pm' | 'assignee' | 'follower'
  role: text('role').notNull(),
  addedById: text('added_by_id'),
  addedByType: text('added_by_type'),
  addedAt: text('added_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  // Soft-delete. When a participant is removed, we mark instead of deleting
  // so @mention history and audit logs still resolve their identity.
  removedAt: text('removed_at'),
}, (table) => [
  index('idx_req_part_request').on(table.requestId),
  index('idx_req_part_participant').on(table.participantId, table.participantType),
  index('idx_req_part_role').on(table.role),
])

// ============================================================
// REQUEST READS (per-user unread message tracking)
// ============================================================
// Tracks when each user last "fully read" a request. Messages created
// after lastReadAt are "unread" for that user. Updated 2 seconds after
// a user lands on the request detail page.

export const requestReads = sqliteTable('request_reads', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  requestId: text('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  userType: text('user_type').notNull(), // 'team_member' | 'contact'
  lastReadAt: text('last_read_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_req_reads_request').on(table.requestId),
  index('idx_req_reads_user').on(table.userId, table.userType),
])

// ============================================================
// ACTIVE TIMERS (live time tracking, one per user)
// ============================================================
// A running stopwatch attached to a specific request OR task. Exactly
// one active timer per user globally (enforced by unique index on
// userId). Heartbeat via lastPingAt every 30 seconds; if the app reopens
// with lastPingAt > 2 minutes old we prompt the user to log the elapsed
// time or discard.

export const activeTimers = sqliteTable('active_timers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Clerk user ID — NOT a team_members.id. Same semantics as
  // request_reads.user_id and other Clerk-sourced user columns. No FK
  // because Clerk user IDs live outside the D1 schema.
  userId: text('user_id').notNull(),
  // Exactly one of requestId / taskId / orgId MUST be set (check enforced
  // in API layer). orgId enables "track time against this client" without
  // pinning it to a specific request or task — useful for client calls,
  // admin work, etc.
  requestId: text('request_id').references(() => requests.id, { onDelete: 'cascade' }),
  taskId: text('task_id'),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  startedAt: text('started_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  // When paused, we freeze the elapsed clock at this moment.
  // When null, timer is actively running.
  pausedAt: text('paused_at'),
  // Cumulative paused duration in seconds (for correct elapsed calculation
  // across multiple pause/resume cycles).
  pausedSeconds: integer('paused_seconds').notNull().default(0),
  lastPingAt: text('last_ping_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  notes: text('notes'),
}, (table) => [
  // One active timer per user, globally.
  index('uniq_active_timer_per_user').on(table.userId),
  index('idx_active_timers_request').on(table.requestId),
])

// ============================================================
// REQUEST STEPS (Nested tasks, ClickUp-style)
// ============================================================

export const requestSteps = sqliteTable('request_steps', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  requestId: text('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  // Self-referencing for infinite nesting (null = top-level step)
  parentStepId: text('parent_step_id'),
  title: text('title').notNull(),
  // Tiptap JSON : optional richer description per step
  description: text('description'),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  completedAt: text('completed_at'),
  // Order within the same parent (0-based)
  orderIndex: integer('order_index').default(0),
  assigneeId: text('assignee_id').references(() => teamMembers.id),
  createdById: text('created_by_id'),
  // 'contact' | 'team_member'
  createdByType: text('created_by_type'),
  ...timestamps,
}, (table) => [
  index('idx_steps_request').on(table.requestId),
  index('idx_steps_parent').on(table.parentStepId),
])

// ============================================================
// CONVERSATIONS (Messaging overhaul)
// ============================================================

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // direct | group | org_channel | request_thread
  type: text('type').notNull(),
  name: text('name'),
  orgId: text('org_id'),
  requestId: text('request_id'),
  // internal | external
  visibility: text('visibility').notNull().default('external'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_conversations_org').on(table.orgId),
  index('idx_conversations_request').on(table.requestId),
])

// ============================================================
// CONVERSATION PARTICIPANTS
// ============================================================

export const conversationParticipants = sqliteTable('conversation_participants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  participantId: text('participant_id').notNull(),
  // team_member | contact
  participantType: text('participant_type').notNull(),
  // admin | member
  role: text('role').notNull().default('member'),
  joinedAt: text('joined_at').notNull(),
  lastReadAt: text('last_read_at'),
}, (table) => [
  index('idx_conv_participants_conv').on(table.conversationId),
  index('idx_conv_participants_participant').on(table.participantId, table.participantType),
])

// ============================================================
// MESSAGES (Request threads + org-level messaging)
// ============================================================

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // If null, this is an org-level general message (not request-specific)
  requestId: text('request_id').references(() => requests.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // Link to the new conversations model (nullable for legacy rows)
  conversationId: text('conversation_id'),
  authorId: text('author_id').notNull(),
  // team_member | contact
  authorType: text('author_type').notNull(),
  // Tiptap JSON stored as text
  body: text('body').notNull(),
  // If true, only visible to Tahi team
  isInternal: integer('is_internal', { mode: 'boolean' }).default(false),
  editedAt: text('edited_at'),
  deletedAt: text('deleted_at'),
  ...timestamps,
}, (table) => [
  index('idx_messages_request').on(table.requestId),
  index('idx_messages_org').on(table.orgId),
  index('idx_messages_conversation').on(table.conversationId),
])

// ============================================================
// MESSAGE REACTIONS
// ============================================================

export const messageReactions = sqliteTable('message_reactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// FILES
// ============================================================

export const files = sqliteTable('files', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  requestId: text('request_id').references(() => requests.id, { onDelete: 'set null' }),
  // When attached to a specific message inline (composer attachment),
  // messageId links the file. Files at the request level (general
  // upload, no associated message) leave this null. Set on POST
  // /api/admin/requests/[id]/messages when attachmentFileIds is in
  // the body.
  messageId: text('message_id'),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  uploadedById: text('uploaded_by_id').notNull(),
  // team_member | contact
  uploadedByType: text('uploaded_by_type').notNull(),
  filename: text('filename').notNull(),
  // Cloudflare R2 object key
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  ...timestamps,
}, (table) => [
  index('idx_files_org').on(table.orgId),
  index('idx_files_request').on(table.requestId),
  index('idx_files_message').on(table.messageId),
])

// ============================================================
// VOICE NOTES
// ============================================================

export const voiceNotes = sqliteTable('voice_notes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  durationSeconds: real('duration_seconds'),
  mimeType: text('mime_type').default('audio/ogg'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// INVOICES
// ============================================================

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  projectId: text('project_id'),
  subscriptionId: text('subscription_id'),
  stripeInvoiceId: text('stripe_invoice_id'),
  xeroInvoiceId: text('xero_invoice_id'),
  source: text('source').default('manual'), // 'manual' | 'xero' | 'stripe'
  // draft | sent | viewed | paid | overdue | written_off
  status: text('status').notNull().default('draft'),
  amountUsd: real('amount_usd').notNull(),
  taxAmountUsd: real('tax_amount_usd').default(0),
  discountAmountUsd: real('discount_amount_usd').default(0),
  totalUsd: real('total_usd').notNull(),
  currency: text('currency').default('USD'),
  notes: text('notes'),
  dueDate: text('due_date'),
  sentAt: text('sent_at'),
  viewedAt: text('viewed_at'),
  paidAt: text('paid_at'),
  // Multi-source reconciliation (migration 0055). When an Airwallex
  // deposit lands, the reconciliation pass writes its txn id here.
  // reconciliationStatus: 'matched' (all sources agree) | 'mismatch'
  // (paidAmount differs across sources) | 'unmatched' (Stripe says paid
  // but no Airwallex deposit). Surfaces on the anomaly strip.
  airwallexTxnId: text('airwallex_txn_id'),
  reconciliationStatus: text('reconciliation_status'),
  lastReconciledAt: text('last_reconciled_at'),
  ...timestamps,
}, (table) => [
  index('idx_invoices_org').on(table.orgId),
  index('idx_invoices_status').on(table.status),
  index('idx_invoices_recon_status').on(table.reconciliationStatus),
  index('idx_invoices_stripe').on(table.stripeInvoiceId),
])

// ============================================================
// INVOICE LINE ITEMS
// ============================================================

export const invoiceItems = sqliteTable('invoice_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: real('quantity').default(1),
  unitPriceUsd: real('unit_price_usd').notNull(),
  totalUsd: real('total_usd').notNull(),
}, (table) => [
  index('idx_invoice_items_invoice').on(table.invoiceId),
])

// ============================================================
// TIME ENTRIES
// ============================================================

export const timeEntries = sqliteTable('time_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  requestId: text('request_id').references(() => requests.id, { onDelete: 'set null' }),
  // NEW : allow tracking against a task too (mutually exclusive with requestId
  // in practice, but the DB is permissive — validation lives in the API).
  taskId: text('task_id'),
  teamMemberId: text('team_member_id').notNull().references(() => teamMembers.id),
  hours: real('hours').notNull(),
  hourlyRate: real('hourly_rate'),
  billable: integer('billable', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  date: text('date').notNull(),
  // NEW : exact range when known. Both nullable because some entries are
  // logged as scalar "I spent 6 hours on this" without a specific range.
  // When set, the UI shows "10:15 AM — 1:29 PM (3h 14m)" instead of just the hours.
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  // NEW : how the entry was created. Drives UX (e.g. live-tracked entries
  // get a subtle "⏱ tracked" label; manual entries don't).
  // 'manual' | 'live_timer' | 'imported'
  source: text('source').notNull().default('manual'),
  ...timestamps,
}, (table) => [
  index('idx_time_org').on(table.orgId),
  index('idx_time_member').on(table.teamMemberId),
  index('idx_time_request').on(table.requestId),
  index('idx_time_task').on(table.taskId),
])

// ============================================================
// TASKS (Three-level system)
// ============================================================

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // client_task | internal_client_task | tahi_internal
  type: text('type').notNull(),
  // Null for tahi_internal tasks
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  // Tiptap JSON
  description: text('description'),
  // todo | in_progress | blocked | done
  status: text('status').notNull().default('todo'),
  // standard | high | urgent
  priority: text('priority').notNull().default('standard'),
  // team_member ID or contact ID
  assigneeId: text('assignee_id'),
  assigneeType: text('assignee_type'),
  dueDate: text('due_date'),
  completedAt: text('completed_at'),
  createdById: text('created_by_id'),
  // JSON array of tag IDs
  tags: text('tags').default('[]'),
  // S18: Track queue ordering and request linking
  trackId: text('track_id').references(() => tracks.id),
  // Position in queue within a track (lower = sooner)
  position: integer('position'),
  // Link task to a request
  requestId: text('request_id').references(() => requests.id),
  // Delivery spine (#148): the schedule gantt row this task delivers.
  scheduleRowId: text('schedule_row_id').references(() => scheduleRows.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  index('idx_tasks_org').on(table.orgId),
  index('idx_tasks_type').on(table.type),
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_track').on(table.trackId),
  index('idx_tasks_request').on(table.requestId),
  index('idx_tasks_schedule_row').on(table.scheduleRowId),
])

// ============================================================
// TASK DEPENDENCIES (S16)
// ============================================================

export const taskDependencies = sqliteTable('task_dependencies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  dependsOnTaskId: text('depends_on_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_task_deps_task').on(table.taskId),
  index('idx_task_deps_depends').on(table.dependsOnTaskId),
])

// ============================================================
// TASK TEMPLATES (S17)
// ============================================================

export const taskTemplates = sqliteTable('task_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // client_task | internal_client_task | tahi_internal
  type: text('type').notNull(),
  category: text('category'),
  description: text('description'),
  // standard | high | urgent
  defaultPriority: text('default_priority').notNull().default('standard'),
  // JSON array of title strings
  subtasks: text('subtasks').default('[]'),
  estimatedHours: real('estimated_hours'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
})

// ============================================================
// TASK SUBTASKS
// ============================================================

export const taskSubtasks = sqliteTable('task_subtasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_task_subtasks_task').on(table.taskId),
])

// ============================================================
// MENTIONS (S19)
// ============================================================

export const mentions = sqliteTable('mentions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // task | request | message
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  mentionedId: text('mentioned_id').notNull(),
  // team_member | contact
  mentionedType: text('mentioned_type').notNull(),
  mentionedById: text('mentioned_by_id').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_mentions_mentioned').on(table.mentionedId),
  index('idx_mentions_entity').on(table.entityId),
])

// ============================================================
// TAGS
// ============================================================

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  colour: text('colour').default('#5A824E'),
  // request | org | invoice | task (comma-separated)
  appliesTo: text('applies_to').default('request'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// ANNOUNCEMENTS
// ============================================================

export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  body: text('body').notNull(),
  // info | warning | success | maintenance
  type: text('type').notNull().default('info'),
  // all | plan_type | org
  targetType: text('target_type').notNull().default('all'),
  // Plan type value or org ID (for targeted announcements)
  targetValue: text('target_value'),
  // JSON array of org IDs (when targetType = 'org')
  targetIds: text('target_ids'),
  scheduledAt: text('scheduled_at'),
  publishedAt: text('published_at'),
  expiresAt: text('expires_at'),
  sentByEmail: integer('sent_by_email').default(0),
  emailSentAt: text('email_sent_at'),
  createdById: text('created_by_id'),
  ...timestamps,
})

export const announcementDismissals = sqliteTable('announcement_dismissals', {
  announcementId: text('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  dismissedAt: text('dismissed_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_announcement_dismissals_user').on(table.userId),
])

// ============================================================
// AUTOMATION RULES
// ============================================================

export const automationRules = sqliteTable('automation_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  triggerEvent: text('trigger_event').notNull(),
  // JSON array of condition objects
  conditions: text('conditions').default('[]'),
  // JSON array of action objects
  actions: text('actions').notNull(),
  executionCount: integer('execution_count').default(0),
  lastExecutedAt: text('last_executed_at'),
  ...timestamps,
})

export const automationLog = sqliteTable('automation_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ruleId: text('rule_id').references(() => automationRules.id, { onDelete: 'set null' }),
  triggerEvent: text('trigger_event').notNull(),
  entityId: text('entity_id'),
  // JSON
  actionsExecuted: text('actions_executed'),
  // success | error
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  executedAt: text('executed_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_auto_log_rule').on(table.ruleId),
  index('idx_auto_log_executed').on(table.executedAt),
])

// ============================================================
// OUTGOING WEBHOOK DELIVERIES
// ============================================================

// One row per attempted delivery of a domain event to a registered outgoing
// webhook endpoint. Written best-effort by lib/webhooks.ts fireWebhook so the
// settings > integrations webhooks UI can show a delivery history. Endpoints
// themselves live in the settings key/value store (key prefix
// `webhook_endpoint_`), so endpointId here is that opaque id, not an FK.
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  endpointId: text('endpoint_id'),
  event: text('event').notNull(),
  url: text('url').notNull(),
  // delivered | failed
  status: text('status').notNull(),
  statusCode: integer('status_code'),
  errorMessage: text('error_message'),
  attemptedAt: text('attempted_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_webhook_deliveries_event').on(table.event),
  index('idx_webhook_deliveries_endpoint').on(table.endpointId),
  index('idx_webhook_deliveries_attempted').on(table.attemptedAt),
])

// ============================================================
// NOTIFICATIONS
// ============================================================

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull(),
  // team_member | contact
  userType: text('user_type').notNull(),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  // request | invoice | message | subscription | task | etc.
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  read: integer('read', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_notifications_user').on(table.userId),
  index('idx_notifications_read').on(table.read),
])

// ============================================================
// NOTIFICATION PREFERENCES (per-user x per-event x per-channel)
// ============================================================
// One row per (userId, userType, eventType, channel). Resolution order:
// exact (userId, userType, eventType, channel) row -> the eventType='*'
// default row for that user/channel -> a hardcoded default in code.
// Deny/allow via `enabled`. userType mirrors the notifications table's dual
// identity model so this joins cleanly to (userId, userType). Channels:
// 'in_app' | 'email' | 'slack'. eventType is a NotificationEventType value
// or '*' for the per-user default row.
export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull(),
  // team_member | contact
  userType: text('user_type').notNull(),
  // a NotificationEventType value, or '*' for the per-user default row
  eventType: text('event_type').notNull(),
  // in_app | email | slack
  channel: text('channel').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex('uq_notif_pref').on(
    table.userId,
    table.userType,
    table.eventType,
    table.channel,
  ),
  index('idx_notif_pref_user').on(table.userId, table.userType),
])

// ============================================================
// EXCHANGE RATES CACHE
// ============================================================

export const exchangeRates = sqliteTable('exchange_rates', {
  currency: text('currency').primaryKey(),
  rateToUsd: real('rate_to_usd').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ============================================================
// XERO P&L SNAPSHOTS (monthly summary from Xero)
// ============================================================
// One row per month per report pull. We use a natural key on month_key
// so re-syncing the same month overwrites rather than appending.
export const xeroPnlSnapshots = sqliteTable('xero_pnl_snapshots', {
  monthKey: text('month_key').primaryKey(),  // YYYY-MM
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  totalRevenue: real('total_revenue').notNull().default(0),      // in Xero base currency (NZD for a NZ tenant)
  totalCostOfSales: real('total_cost_of_sales').notNull().default(0),
  totalExpenses: real('total_expenses').notNull().default(0),
  grossProfit: real('gross_profit').notNull().default(0),
  netProfit: real('net_profit').notNull().default(0),
  currency: text('currency').notNull().default('NZD'),
  rawJson: text('raw_json'),  // original Xero response for later re-parsing
  syncedAt: text('synced_at').notNull(),
})

// Per-month per-category expense breakdown from Xero P&L.
// Composite-unique on (month_key, account_code) so re-sync is idempotent.
export const xeroExpenseCategories = sqliteTable('xero_expense_categories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  monthKey: text('month_key').notNull(),
  accountCode: text('account_code'),       // Xero account code (e.g. "400")
  accountName: text('account_name').notNull(),
  section: text('section').notNull(),      // 'cost_of_sales' | 'expense' | 'other'
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('NZD'),
  isRecurring: integer('is_recurring', { mode: 'boolean' }).default(false),
  syncedAt: text('synced_at').notNull(),
}, (table) => [
  index('idx_xero_exp_month').on(table.monthKey),
  index('idx_xero_exp_category').on(table.accountName),
])

// ============================================================
// EXPENSE COMMITMENTS (fixed costs with cadence)
// ============================================================
// User-maintained fixed costs. Xero P&L data is chaotic (accountant
// reclassifications, journal entries, split/unsplit categories) so
// it's unreliable for forecasting. Commitments are the source of
// truth for cash-flow projection and burn rate calculations. Xero
// P&L stays as a separate view of historical actuals.
//
// Each commitment has a cadence (monthly / quarterly / annual / one_off)
// so the forecast correctly spreads it across months:
//   monthly:    amount appears every month
//   quarterly:  amount appears every 3 months starting from nextDueDate
//   annual:     amount appears once a year from nextDueDate
//   one_off:    amount appears only in the month of nextDueDate
//
// Optional linkedXeroAccount field lets us reconcile expected vs actual:
// if you say "Salaries $8,666.66/mo" and Xero shows the same figure in
// the "Salaries" account, the dashboard can flag drift.
export const expenseCommitments = sqliteTable('expense_commitments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  vendor: text('vendor'),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('NZD'),
  // monthly | quarterly | annual | one_off
  cadence: text('cadence').notNull().default('monthly'),
  // contractor | software | salary | insurance | tax | office | marketing | other
  category: text('category').notNull().default('other'),
  // YYYY-MM-DD. Used to place quarterly/annual/one_off in the forecast.
  nextDueDate: text('next_due_date'),
  // YYYY-MM-DD. When this commitment started being paid. Commitments
  // are excluded from any forecast month before startDate so a new
  // hire or subscription doesn't retroactively inflate historical views.
  startDate: text('start_date'),
  // YYYY-MM-DD. When this commitment stops. Commitments are excluded
  // from forecast months after endDate. Used for fixed-term contracts
  // like "StraightIn 4-month contract" — set endDate = contract end so
  // the burn rate naturally drops off when it runs out.
  endDate: text('end_date'),
  // 1-31. For monthly/quarterly cadences, the day-of-month the
  // charge typically hits (e.g. 1 = first of month, 15 = mid-month).
  // Purely informational for now; used to show "next charge ≈ 1 May"
  // in the UI. Forecast math uses cadence + dates.
  billingDayOfMonth: integer('billing_day_of_month'),
  // When false, commitment is excluded from forecast (kept for history)
  active: integer('active', { mode: 'boolean' }).default(true),
  // When true, this is a nice-to-have. False = essential to operate.
  // Powers the "discretionary vs essential" split on /financial-reports
  // and the "if I cut all discretionary" affordability math.
  isDiscretionary: integer('is_discretionary', { mode: 'boolean' }).default(false),
  notes: text('notes'),
  // Optional Xero account name this reconciles against (e.g. "Salaries")
  linkedXeroAccount: text('linked_xero_account'),
  // Last actual Airwallex transaction that matched this commitment
  // (migration 0055). Lets the reconciliation pass surface "expected
  // hit but no bank txn" anomalies.
  lastAirwallexTxnId: text('last_airwallex_txn_id'),
  lastReconciledAt: text('last_reconciled_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_commitments_active').on(table.active),
  index('idx_commitments_category').on(table.category),
])

// Latest bank balances by Xero account.
// Key on Xero's AccountID so resync overwrites.
export const xeroBankBalances = sqliteTable('xero_bank_balances', {
  accountId: text('account_id').primaryKey(),
  accountName: text('account_name').notNull(),
  currency: text('currency').notNull().default('NZD'),
  balance: real('balance').notNull().default(0),
  asOf: text('as_of').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ============================================================
// AIRWALLEX (bank source-of-truth, migration 0055)
// ============================================================
//
// Airwallex is the operating bank — the truth for what cash is actually
// where right now. Xero shows what cash "should" be (per invoice +
// reconciliation state); Airwallex shows what cash IS.
//
// Two tables:
//   airwallex_balances     — current per-account balance, refreshed by
//                            daily sync. One row per account.
//   airwallex_transactions — line-item ledger of inbound/outbound. Joins
//                            to invoices via airwallexTxnId + to
//                            expenseCommitments by description match for
//                            the reconciliation pass.

export const airwallexBalances = sqliteTable('airwallex_balances', {
  // Airwallex's own account id (acct_*). Stable across syncs.
  accountId: text('account_id').primaryKey(),
  accountName: text('account_name').notNull(),
  currency: text('currency').notNull(),
  // Total amount including pending
  balance: real('balance').notNull().default(0),
  // Cleared funds that can be moved/spent right now
  availableBalance: real('available_balance').notNull().default(0),
  asOf: text('as_of').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const airwallexTransactions = sqliteTable('airwallex_transactions', {
  // Airwallex transaction id (their primary key)
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  // Positive = inbound, negative = outbound
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  // Airwallex's category: deposit | withdrawal | fee | conversion | transfer
  type: text('type').notNull(),
  description: text('description'),
  // Free-text counterparty (sender on inbound, recipient on outbound).
  // Used by the AI sanity pass to match against invoice debtors +
  // recurring vendors.
  counterparty: text('counterparty'),
  // ISO datetime the txn settled (vs pending).
  settledAt: text('settled_at'),
  // Cross-source links — populated by the reconciliation pass.
  // Multiple Airwallex txns can map to one Xero entry (split payments).
  linkedXeroId: text('linked_xero_id'),
  linkedStripeId: text('linked_stripe_id'),
  // When this transaction was last reconciled across sources. Null =
  // never reconciled (suspicious, needs review).
  reconciledAt: text('reconciled_at'),
  // For the multi-source-conflict warning strip. 'matched' | 'orphan' |
  // 'mismatch' | 'manual'.
  reconciliationStatus: text('reconciliation_status').default('orphan'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_airwallex_txns_account').on(table.accountId),
  index('idx_airwallex_txns_settled').on(table.settledAt),
  index('idx_airwallex_txns_recon').on(table.reconciliationStatus),
])

// ============================================================
// RESERVES (tax + custom pots, migration 0055)
// ============================================================
//
// Disposable cash = bank balance − reserves. Tax is the obvious one
// (~28% NZ corp rate accrued from revenue); custom pots cover things
// like "$5k buffer for shareholder distribution", "deposit returns
// owed back to clients", etc.
//
// Auto-accrual: when a reserve has accrualRate set, the daily sync
// adds (today's revenue × rate) to accruedAmount. Manual reserves leave
// accrualRate null and just hold whatever Liam manually allocated.

export const reserves = sqliteTable('reserves', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // tax | buffer | deposits | other
  category: text('category').notNull().default('other'),
  currency: text('currency').notNull().default('NZD'),
  // Optional target — e.g. "have $20k tax pot by year-end"
  targetAmount: real('target_amount'),
  // What's currently set aside. Disposable-cash math subtracts this from
  // the bank balance.
  accruedAmount: real('accrued_amount').notNull().default(0),
  // When set (0.0-1.0), the daily sync auto-accrues (revenue × rate)
  // into accruedAmount. 0.28 = NZ corporate tax rate. Null = manual.
  accrualRate: real('accrual_rate'),
  lastAccrualAt: text('last_accrual_at'),
  notes: text('notes'),
  // When false, hidden from the disposable-cash subtotal.
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_reserves_active').on(table.active),
  index('idx_reserves_category').on(table.category),
])

// ============================================================
// CLIENT COSTS (gross margin tracking per client)
// ============================================================
// Captures the costs Tahi incurs to service a particular client so we
// can compute gross margin: invoice revenue - (these costs + logged
// billable hours * defaultHourlyRate).
//
// Category values:
//   contractor — subcontracted work (freelancer, agency partner)
//   software   — paid tools dedicated to this client (Webflow plan, plugins)
//   hours      — generic labour cost entered manually (one-off bucket)
//   other      — misc passthrough costs (stock imagery, domain, etc.)
export const clientCosts = sqliteTable('client_costs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('NZD'),
  category: text('category').notNull().default('other'),
  date: text('date').notNull(),  // YYYY-MM-DD
  recurring: integer('recurring', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_client_costs_org_id').on(table.orgId),
  index('idx_client_costs_date').on(table.date),
])

// ============================================================
// CASE STUDY SUBMISSIONS
// ============================================================

export const caseStudySubmissions = sqliteTable('case_study_submissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // Signed UUID for link-authenticated access (no login required)
  submissionToken: text('submission_token').notNull().unique(),
  projectName: text('project_name'),
  writtenTestimonial: text('written_testimonial'),
  videoUrl: text('video_url'),
  videoStorageKey: text('video_storage_key'),
  npsScore: integer('nps_score'),
  lovedMost: text('loved_most'),
  improve: text('improve'),
  marketingPermission: integer('marketing_permission', { mode: 'boolean' }).default(false),
  logoPermission: integer('logo_permission', { mode: 'boolean' }).default(false),
  caseStudyPermission: integer('case_study_permission', { mode: 'boolean' }).default(false),
  clutchReviewUrl: text('clutch_review_url'),
  // pending | approved | rejected
  status: text('status').notNull().default('pending'),
  // not_sent | asked | declined | deferred | in_progress | completed
  outreachStatus: text('outreach_status').default('not_sent'),
  nextAskAt: text('next_ask_at'),
  neverAsk: integer('never_ask').default(0),
  submittedAt: text('submitted_at'),
  tokenExpiresAt: text('token_expires_at'),
  ...timestamps,
}, (table) => [
  index('idx_case_submissions_org').on(table.orgId),
])

export const caseStudies = sqliteTable('case_studies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  submissionId: text('submission_id').references(() => caseStudySubmissions.id),
  title: text('title').notNull(),
  contentMd: text('content_md'),
  draftGeneratedByAi: integer('draft_generated_by_ai', { mode: 'boolean' }).default(false),
  publishedAt: text('published_at'),
  ...timestamps,
})

// ============================================================
// DOC PAGES (Tahi Knowledge Hub)
// ============================================================

export const docPages = sqliteTable('doc_pages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  parentId: text('parent_id'),
  // brand | services | sales | operations | team | product
  category: text('category').notNull().default('operations'),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  // Tiptap JSON
  contentTiptap: text('content_tiptap'),
  // Plain text for FTS search
  contentText: text('content_text'),
  authorId: text('author_id'),
  ...timestamps,
}, (table) => [
  index('idx_docs_category').on(table.category),
  index('idx_docs_slug').on(table.slug),
])

export const docVersions = sqliteTable('doc_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  pageId: text('page_id').notNull().references(() => docPages.id, { onDelete: 'cascade' }),
  contentTiptap: text('content_tiptap'),
  savedById: text('saved_by_id'),
  savedAt: text('saved_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_doc_versions_page').on(table.pageId),
])

// ============================================================
// INTEGRATIONS
// ============================================================

export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // stripe | xero | mailerlite | hubspot | slack | loom | rewardful | zapier | open_exchange_rates
  service: text('service').notNull().unique(),
  // connected | disconnected | error
  status: text('status').notNull().default('disconnected'),
  // Encrypted tokens
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: text('token_expires_at'),
  // JSON: service-specific config (webhook URLs, org IDs, etc.)
  config: text('config').default('{}'),
  lastSyncedAt: text('last_synced_at'),
  errorMessage: text('error_message'),
  ...timestamps,
})

// ============================================================
// AUDIT LOG
// ============================================================

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text('actor_id'),
  // team_member | contact | system
  actorType: text('actor_type'),
  // created | updated | deleted | impersonated | login | etc.
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  // JSON: before/after values, metadata
  metadata: text('metadata'),
  ipAddress: text('ip_address'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_audit_actor').on(table.actorId),
  index('idx_audit_entity').on(table.entityType, table.entityId),
])

// ============================================================
// SETTINGS (Key-value store)
// ============================================================

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// TEAM MEMBER ACCESS (Scoping rules)
// ============================================================

export const teamMemberAccess = sqliteTable('team_member_access', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamMemberId: text('team_member_id').notNull().references(() => teamMembers.id, { onDelete: 'cascade' }),
  // project_manager | task_handler | viewer
  role: text('role').notNull(),
  // all_clients | plan_type | specific_clients
  scopeType: text('scope_type').notNull(),
  planType: text('plan_type'),
  // all | small | large
  trackType: text('track_type').notNull().default('all'),
  ...timestamps,
}, (table) => [
  index('idx_tma_member').on(table.teamMemberId),
])

export const teamMemberAccessOrgs = sqliteTable('team_member_access_orgs', {
  accessId: text('access_id').notNull().references(() => teamMemberAccess.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
})

// ============================================================
// REQUEST FORMS (Intake forms per category/client)
// ============================================================

export const requestForms = sqliteTable('request_forms', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  category: text('category'),
  orgId: text('org_id'),
  // JSON: [{id, type, label, required, options?}]
  questions: text('questions').notNull().default('[]'),
  isDefault: integer('is_default').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_request_forms_org_cat').on(table.orgId, table.category),
  index('idx_request_forms_default').on(table.isDefault),
])

// ============================================================
// KANBAN COLUMNS (Custom per-client overrides)
// ============================================================

export const kanbanColumns = sqliteTable('kanban_columns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id'),
  label: text('label').notNull(),
  statusValue: text('status_value').notNull(),
  colour: text('colour'),
  position: integer('position').notNull().default(0),
  isDefault: integer('is_default').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_kanban_org').on(table.orgId),
])

// ============================================================
// CONTRACTS
// ============================================================

export const contracts = sqliteTable('contracts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  // nda | sla | msa | sow | other
  type: text('type').notNull(),
  name: text('name').notNull(),
  // draft | sent | signed | expired | cancelled
  status: text('status').notNull().default('draft'),
  storageKey: text('storage_key').notNull(),
  signedStorageKey: text('signed_storage_key'),
  startDate: text('start_date'),
  expiryDate: text('expiry_date'),
  signatoryName: text('signatory_name'),
  signatoryEmail: text('signatory_email'),
  signedAt: text('signed_at'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_contracts_org').on(table.orgId),
])

// ============================================================
// SCHEDULED CALLS
// ============================================================

// ============================================================
// DISCOVERY CALLS (Lead-stage + post-deal calls with transcript +
// outcome + scope capture)
// ============================================================
//
// Distinct from scheduledCalls (which is org-bound NOT NULL and used
// for ongoing client engagement). This table covers the lead → deal
// transition: pre-call prep, the call itself (Google Meet + Gemini
// transcript), outcome tagging, and the scope notes that feed into
// the eventual proposal.
//
// Linked via leadId (always) and optionally dealId (after promotion)
// so the same row tracks the conversation from "qualifying" through
// "won".

export const discoveryCalls = sqliteTable('discovery_calls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Polymorphic parent: any of leadId / dealId / requestId / taskId /
  // orgId can be set. A call usually has one parent but can be linked
  // to several (e.g. an org call that's also tied to a specific deal).
  // At least one must be set at the API layer.
  leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  requestId: text('request_id'),
  taskId: text('task_id'),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'set null' }),
  // Google Calendar linkage. When set, we can sync the event details
  // (attendees, scheduledAt, meetingUrl) back from Calendar on each
  // poll. event_id is the unique Calendar event id.
  googleCalendarEventId: text('google_calendar_event_id'),
  googleMeetUrl: text('google_meet_url'),
  // Display
  title: text('title').notNull(),
  scheduledAt: text('scheduled_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(30),
  // JSON: [{ name, email, role: 'host'|'lead'|'guest' }]
  attendees: text('attendees').notNull().default('[]'),
  // scheduled | completed | cancelled | no_show | rescheduled
  status: text('status').notNull().default('scheduled'),
  // ── Post-call fields ──
  // Raw transcript. Length capped at ~50k chars at the API layer.
  transcript: text('transcript'),
  // gemini_meet | manual_paste | whisper_api
  transcriptSource: text('transcript_source'),
  // AI-generated or human-written call summary.
  summary: text('summary'),
  // good_call | promote | nurture | archive | no_show
  // 'promote' means this call should drive a lead → deal promotion
  // (Liam still does it manually; this just tags intent).
  outcome: text('outcome'),
  outcomeNotes: text('outcome_notes'),
  // ── Scope capture (drives proposal building) ──
  // Free-text notes on what they want built. Pages, design needs,
  // integrations, etc.
  scopeNotes: text('scope_notes'),
  // Budget signal captured on the call. May be a range or one number;
  // null if not discussed.
  budgetMin: integer('budget_min'),
  budgetMax: integer('budget_max'),
  budgetCurrency: text('budget_currency'),
  // urgent | this_quarter | this_year | no_rush
  timeline: text('timeline'),
  // Meeting classification set by the calendar sync. 'discovery' is the
  // default for lead-linked calls; 'client' for existing-org check-ins;
  // 'partnership' for intro/sync meetings with unknown contacts whose
  // titles hint at partnership; 'unclassified' for unmatched events that
  // need triage. Lets the calls index segment without re-running the
  // classifier on read.
  meetingType: text('meeting_type'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_discovery_calls_lead').on(table.leadId),
  index('idx_discovery_calls_deal').on(table.dealId),
  index('idx_discovery_calls_request').on(table.requestId),
  index('idx_discovery_calls_task').on(table.taskId),
  index('idx_discovery_calls_org').on(table.orgId),
  index('idx_discovery_calls_scheduled').on(table.scheduledAt),
  index('idx_discovery_calls_status').on(table.status),
  index('idx_discovery_calls_gcal').on(table.googleCalendarEventId),
  index('idx_discovery_calls_meeting_type').on(table.meetingType),
])

export const scheduledCalls = sqliteTable('scheduled_calls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  scheduledAt: text('scheduled_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(30),
  meetingUrl: text('meeting_url'),
  // JSON: [{id, type, name, email}]
  attendees: text('attendees').notNull().default('[]'),
  // scheduled | completed | cancelled | no_show
  status: text('status').notNull().default('scheduled'),
  notes: text('notes'),
  recordingUrl: text('recording_url'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_calls_org').on(table.orgId),
  index('idx_calls_scheduled').on(table.scheduledAt),
])

// ============================================================
// SERVICES (Service catalogue)
// ============================================================

export const services = sqliteTable('services', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  // Price in cents
  price: integer('price').notNull().default(0),
  currency: text('currency').notNull().default('NZD'),
  isRecurring: integer('is_recurring').notNull().default(0),
  // month | year
  recurringInterval: text('recurring_interval'),
  showInCatalog: integer('show_in_catalog').notNull().default(1),
  // service | topup | addon
  category: text('category'),
  ...timestamps,
})

// ============================================================
// CRM: PIPELINE STAGES
// ============================================================

export const pipelineStages = sqliteTable('pipeline_stages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  probability: integer('probability').notNull().default(0),
  position: integer('position').notNull().default(0),
  colour: text('colour'),
  isDefault: integer('is_default').notNull().default(0),
  isClosedWon: integer('is_closed_won').notNull().default(0),
  isClosedLost: integer('is_closed_lost').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// CRM: DEALS
// ============================================================

export const deals = sqliteTable('deals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'set null' }),
  stageId: text('stage_id').notNull().references(() => pipelineStages.id),
  ownerId: text('owner_id').references(() => teamMembers.id),
  value: integer('value').notNull().default(0),
  currency: text('currency').notNull().default('NZD'),
  valueNzd: integer('value_nzd').notNull().default(0),
  // Split value model — added in migration 0023.
  // upfrontValue: one-time project portion (e.g. $30k upfront for a 3-month build).
  // monthlyValue: recurring retainer portion (e.g. $2k/mo).
  // Either or both can be 0. `value` is preserved as the legacy single number
  // for backward compatibility with reports/charts; new code should compute
  // the headline number as upfront + monthly × forecastHorizonMonths.
  upfrontValue: integer('upfront_value'),
  upfrontValueNzd: integer('upfront_value_nzd'),
  monthlyValue: integer('monthly_value'),
  monthlyValueNzd: integer('monthly_value_nzd'),
  // When the recurring portion starts. If null, falls back to
  // engagement_end_date, then to closed_at / expected_close_date.
  recurringStartDate: text('recurring_start_date'),
  source: text('source'),
  estimatedHoursPerWeek: integer('estimated_hours_per_week').default(0),
  // Engagement model (project vs retainer)
  engagementType: text('engagement_type'), // 'project' | 'retainer' | null
  totalHours: integer('total_hours'),       // project: total hours (e.g. 30)
  hoursPerMonth: integer('hours_per_month'), // retainer: monthly hours
  engagementStartDate: text('engagement_start_date'),
  engagementEndDate: text('engagement_end_date'),
  expectedCloseDate: text('expected_close_date'),
  closedAt: text('closed_at'),
  closeReason: text('close_reason'),
  // Structured close-lost reason (separate from free-text closeReason).
  // One of: price | competitor | timing | scope | no_response | not_a_fit | other
  // Captured on closed-lost so we can measure why deals die without parsing
  // free-text notes (per Sales Strategy doc: "deal-death points").
  lostReason: text('lost_reason'),
  // The single concrete next step on this deal. Replaces "Liam keeps it in
  // his head". Surfaces as an overdue badge in the pipeline.
  nextActionLabel: text('next_action_label'),
  nextActionDueAt: text('next_action_due_at'),
  notes: text('notes'),
  // Nudge control: disable auto-nudges per deal
  autoNudgesDisabled: integer('auto_nudges_disabled').default(0),
  // S22: Won source tracking for close rate analytics
  wonSource: text('won_source'),
  ...timestamps,
}, (table) => [
  index('idx_deals_org').on(table.orgId),
  index('idx_deals_stage').on(table.stageId),
  index('idx_deals_owner').on(table.ownerId),
])

// ============================================================
// CRM: DEAL CONTACTS (Junction)
// ============================================================

export const dealContacts = sqliteTable('deal_contacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  role: text('role'),
}, (table) => [
  index('idx_deal_contacts_deal').on(table.dealId),
  index('idx_deal_contacts_contact').on(table.contactId),
])

// ============================================================
// CRM: ACTIVITIES
// ============================================================

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  // leadId added in migration 0017 so leads share the same activity
  // stream as deals/orgs/contacts. Set on promote so the deal can
  // see the full pre-qualification history.
  leadId: text('lead_id'),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').notNull(),
  scheduledAt: text('scheduled_at'),
  completedAt: text('completed_at'),
  durationMinutes: integer('duration_minutes'),
  outcome: text('outcome'),
  ...timestamps,
}, (table) => [
  index('idx_activities_deal').on(table.dealId),
  index('idx_activities_org').on(table.orgId),
  index('idx_activities_contact').on(table.contactId),
  index('idx_activities_lead').on(table.leadId),
])

// ============================================================
// CRM: PEOPLE (Canonical person identity)
//
// A person is a real human, identified by email. Every role they
// hold — lead, contact at an org, affiliate, email subscriber — is
// a separate row in another table that points back here via
// person_id. One human, many roles, full history preserved as they
// move between companies and lists.
//
// Matching key: email. On insert, the API does lookup-or-create:
// if a person with this email already exists, attach to them;
// otherwise create a new row.
// ============================================================

export const people = sqliteTable('people', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fullName: text('full_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  linkedinUrl: text('linkedin_url'),
  // Enrichment payload (Phase B · 7) lives here as JSON. Job title,
  // company size, industry, etc. when populated by an external API.
  enrichmentData: text('enrichment_data'),
  notes: text('notes'),
  ...timestamps,
}, (table) => [
  index('idx_people_email').on(table.email),
])

// ============================================================
// CRM: LEADS (Pre-qualification stage, separate from deals)
//
// A lead is a prospect we haven't qualified yet. Once a discovery
// call lands and we decide to pursue, the lead promotes to a deal
// (lead.promotedDealId set, status = 'promoted'). Keeping leads
// separate from deals lets us:
//   - Archive dead prospects without polluting pipeline metrics
//   - Compute clean conversion rates (lead → deal → close)
//   - Run different fields on each (leads have a `brief`, deals
//     have engagement type, MRR split, etc.)
// ============================================================

export const leads = sqliteTable('leads', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Canonical person identity. Nullable for back-compat with rows
  // inserted before the people-model bridge; new lead inserts MUST
  // populate this via lookup-or-create on email.
  personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
  // Person fields are denormalised onto the lead row for table
  // rendering speed. Source of truth lives on `people` for any
  // editing / cross-role queries.
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  // Company fields (may not match an existing org yet)
  company: text('company'),
  jobTitle: text('job_title'),
  website: text('website'),
  // Source: webflow | website | email | referral | affiliate | event | cold_outreach | manual | other
  source: text('source').notNull().default('manual'),
  sourceDetail: text('source_detail'),
  // Affiliate attribution — populated when the lead arrived via
  // /r/{code}. Affiliates table doesn't exist yet (Phase C); kept as
  // a free-text id for now so the column is ready when the table is.
  affiliateCode: text('affiliate_code'),
  // Free-text brief — what they want, what we know so far
  brief: text('brief'),
  // Heuristic deal-size estimate. Currency is stored alongside.
  estimatedValue: integer('estimated_value'),
  currency: text('currency').notNull().default('NZD'),
  // ── Firmographics + tech profile (promoted out of `brief` blob in 0047) ──
  // These match the CSV columns the WordPress lead exports dump into
  // `brief` as a `Field: value · Field: value · ...` string. Promoting
  // to first-class columns so they're filterable, editable, and used
  // by the AI scoring rubric instead of buried in prose.
  industry: text('industry'),
  employeeCount: integer('employee_count'),
  /** Banded string e.g. "$10M - $50M". Bands aren't numeric so keep as text. */
  revenueBand: text('revenue_band'),
  /** Approx monthly web traffic (page views). Often null. */
  monthlyVisits: integer('monthly_visits'),
  /** Free-text for now: "Prospect", "Customer", "Partner", "Past client" etc. */
  leadType: text('lead_type'),
  /** Company LinkedIn. */
  linkedinUrl: text('linkedin_url'),
  /** Personal LinkedIn of the actual lead person (preferred for outreach). */
  linkedinPersonalUrl: text('linkedin_personal_url'),
  /** JSON array of tech names from the sniffer, e.g. ["Webflow","HubSpot","GA"]. */
  techStack: text('tech_stack'),
  /** Website CMS / builder — Webflow, WordPress, Framer, Shopify, Squarespace, Wix, Ghost.
   *  Promoted out of techStack because for an agency replacing/competing with these
   *  platforms, the CMS is the single highest-value qualifying signal. */
  cms: text('cms'),
  /** ISO 3166-1 alpha-2 (NZ, AU, US) or free-text country name. */
  country: text('country'),
  yearFounded: integer('year_founded'),
  // Lifecycle:
  //   new           — just landed, untriaged
  //   qualifying    — actively working on it (call scheduled, replies in-flight)
  //   nurturing     — not now, follow up later
  //   promoted      — became a deal (see promotedDealId)
  //   archived      — dead. archiveReason captures why.
  status: text('status').notNull().default('new'),
  archiveReason: text('archive_reason'),
  // Owner — defaults to the creating user via API.
  ownerId: text('owner_id').references(() => teamMembers.id),
  // If/when promoted, this points to the resulting deal so we can
  // walk the full lead → deal → invoice graph.
  promotedDealId: text('promoted_deal_id').references(() => deals.id, { onDelete: 'set null' }),
  promotedAt: text('promoted_at'),
  // ── AI enrichment columns (Phase B · 6) ──
  // Score is 0-100 with a one-line reason captured separately.
  aiScore: integer('ai_score'),
  aiScoreReason: text('ai_score_reason'),
  // Free-text 2-3 paragraph synthesis from web research.
  aiSummary: text('ai_summary'),
  // JSON array of URL strings cited by the enrichment run. Required
  // backing for any factual claim in aiSummary.
  aiSources: text('ai_sources').default('[]'),
  // JSON array of 3 lead-specific discovery questions. The 3 always-
  // ask questions live in settings.discoveryQuestionsTemplate.
  aiQuestions: text('ai_questions').default('[]'),
  // JSON object: structured company signals from enrichment. Shape:
  //   { employeeCount, employeeCountSource, fundingRaised, fundingSource,
  //     fundingStage, pricingVisible, customerCount, decisionMaker,
  //     decisionMakerConfidence, siteTechStack, revenueEstimate }
  // Every populated field has a sibling *Source URL or is omitted.
  aiSignals: text('ai_signals'),
  // Timestamps gating cron runs + UI signalling.
  enrichedAt: text('enriched_at'),
  lastAiRunAt: text('last_ai_run_at'),
  // Cost gate. Sum of input+output tokens across all AI runs on
  // this lead. Surface in UI if a single lead burns >25k tokens.
  aiTokensSpent: integer('ai_tokens_spent').notNull().default(0),
  // When Liam clicks "don't ask again" on the re-enrich confirm
  // dialog, this stays true and the prompt never fires on this
  // lead again (until re-enrichment runs manually).
  enrichRepromptSuppressed: integer('enrich_reprompt_suppressed', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => [
  index('idx_leads_status').on(table.status),
  index('idx_leads_owner').on(table.ownerId),
  index('idx_leads_email').on(table.email),
  index('idx_leads_source').on(table.source),
  index('idx_leads_person').on(table.personId),
  index('idx_leads_ai_run').on(table.lastAiRunAt),
])

// ============================================================
// AI REPLY DRAFTS (first-reply on new inbound + tone learning)
// ============================================================
//
// Captures both the AI's first attempt at a reply AND what Liam
// actually sent. The diff = a tone-training example fed back into
// future drafts as few-shot. By draft ~20, Sonnet should sound like
// Liam.
//
// Lifecycle:
//   pending  → AI drafted, not yet reviewed
//   sent     → Liam clicked Send (with or without edits)
//   dismissed → Liam said "don't send" — still kept as a tone hint
//               (Liam's rejection is information too)

export const aiReplyDrafts = sqliteTable('ai_reply_drafts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  leadId: text('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  // Original Sonnet output (frozen at draft time)
  aiDraftSubject: text('ai_draft_subject'),
  aiDraftBody: text('ai_draft_body').notNull(),
  // What Liam actually sent (may equal aiDraft if untouched)
  finalSubject: text('final_subject'),
  finalBody: text('final_body'),
  // pending | sent | dismissed
  status: text('status').notNull().default('pending'),
  sentAt: text('sent_at'),
  // Resend response id, for delivery tracking later
  resendMessageId: text('resend_message_id'),
  // Token cost gate visibility
  tokensSpent: integer('tokens_spent').default(0),
  ...timestamps,
}, (table) => [
  index('idx_ai_reply_drafts_lead').on(table.leadId),
  index('idx_ai_reply_drafts_status').on(table.status),
])

// ============================================================
// BRANDS (Sub-brands under a client org)
// ============================================================

export const brands = sqliteTable('brands', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  website: text('website'),
  primaryColour: text('primary_colour'),
  notes: text('notes'),
  ...timestamps,
}, (table) => [
  index('idx_brands_org').on(table.orgId),
])

// ============================================================
// BRAND CONTACTS (Junction: brands <-> contacts)
// ============================================================

export const brandContacts = sqliteTable('brand_contacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  brandId: text('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_brand_contacts_brand').on(table.brandId),
  index('idx_brand_contacts_contact').on(table.contactId),
])

// ============================================================
// PLANNED ROLES (Hiring pipeline)
// ============================================================

export const plannedRoles = sqliteTable('planned_roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  department: text('department'),
  priority: text('priority').notNull().default('medium'),
  description: text('description'),
  reportsToId: text('reports_to_id').references(() => teamMembers.id),
  status: text('status').notNull().default('planned'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
})

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Organisation = typeof organisations.$inferSelect
export type NewOrganisation = typeof organisations.$inferInsert
export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type TeamMember = typeof teamMembers.$inferSelect
export type NewTeamMember = typeof teamMembers.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Subscription = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
export type Track = typeof tracks.$inferSelect
export type Request = typeof requests.$inferSelect
export type NewRequest = typeof requests.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type File = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type TimeEntry = typeof timeEntries.$inferSelect
export type NewTimeEntry = typeof timeEntries.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type RequestStep = typeof requestSteps.$inferSelect
export type NewRequestStep = typeof requestSteps.$inferInsert
export type Tag = typeof tags.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NotificationPreference = typeof notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert
export type DocPage = typeof docPages.$inferSelect
export type Integration = typeof integrations.$inferSelect
export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type ConversationParticipant = typeof conversationParticipants.$inferSelect
export type TeamMemberAccess = typeof teamMemberAccess.$inferSelect
export type RequestForm = typeof requestForms.$inferSelect
export type KanbanColumn = typeof kanbanColumns.$inferSelect
export type Contract = typeof contracts.$inferSelect
export type NewContract = typeof contracts.$inferInsert
export type ScheduledCall = typeof scheduledCalls.$inferSelect
export type NewScheduledCall = typeof scheduledCalls.$inferInsert
export type CaseStudySubmission = typeof caseStudySubmissions.$inferSelect
export type Service = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
export type PipelineStage = typeof pipelineStages.$inferSelect
export type NewPipelineStage = typeof pipelineStages.$inferInsert
export type Deal = typeof deals.$inferSelect
export type NewDeal = typeof deals.$inferInsert
export type DealContact = typeof dealContacts.$inferSelect
export type Activity = typeof activities.$inferSelect
export type NewActivity = typeof activities.$inferInsert
export type PlannedRole = typeof plannedRoles.$inferSelect
export type NewPlannedRole = typeof plannedRoles.$inferInsert
export type TaskDependency = typeof taskDependencies.$inferSelect
export type NewTaskDependency = typeof taskDependencies.$inferInsert
export type Brand = typeof brands.$inferSelect
export type NewBrand = typeof brands.$inferInsert
export type BrandContact = typeof brandContacts.$inferSelect
export type NewBrandContact = typeof brandContacts.$inferInsert
export type TaskTemplate = typeof taskTemplates.$inferSelect
export type NewTaskTemplate = typeof taskTemplates.$inferInsert
export type Mention = typeof mentions.$inferSelect
export type NewMention = typeof mentions.$inferInsert

// ============================================================
// NUDGE EMAIL SYSTEM
// ============================================================

export const nudgeTemplates = sqliteTable('nudge_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  category: text('category'), // 'follow_up' | 'check_in' | 'proposal' | 'intro' | 'custom'
  isDefault: integer('is_default').default(0),
  ...timestamps,
})

export const dealNudges = sqliteTable('deal_nudges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  templateId: text('template_id').references(() => nudgeTemplates.id, { onDelete: 'set null' }),
  contactEmails: text('contact_emails').notNull(), // JSON array
  subject: text('subject').notNull(),
  bodyHtml: text('body_html').notNull(),
  status: text('status').notNull().default('draft'), // draft | scheduled | sent | failed | cancelled
  scheduledAt: text('scheduled_at'), // ISO timestamp, null = instant
  sentAt: text('sent_at'),
  triggerRule: text('trigger_rule'), // JSON: { type, stage, days, unless }
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_nudges_deal').on(table.dealId),
  index('idx_nudges_status').on(table.status),
])

// ============================================================
// PROJECT SCHEDULES (Gantt) — Phase 1 of proposal/contract suite
// ============================================================
//
// A `projectSchedule` is one Gantt-style timeline (e.g. "Giant Group 12-week
// build plan"). It can be standalone, or tied to a deal (pre-sale) or an org
// (post-conversion). Rendered as a custom CSS-grid table that matches the
// PDF reference: Phase | Owner | W1…Wn columns, with colored bars per row.
//
// Each schedule owns N `scheduleRows`. Row types:
//   - section_header: a full-width dark band (e.g. "MAIN BUILD PHASES")
//   - task:           a normal row with a colored bar from startWeek → endWeek
//   - gate:           a single-week diamond (sign-off gate)
//   - critical_gate:  red-bordered diamond (critical-path gate)
//
// Owner drives the bar colour:
//   - tahi          → solid brand green
//   - client        → dark green/black
//   - joint         → amber
//   - tahi_parallel → light brand green (parallel workstream)
//
// Public sharing: when shared, a `publicShareToken` is minted and the schedule
// is viewable without auth at `/p/schedule/<token>`. Revoking clears the token.

export const projectSchedules = sqliteTable('project_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Linkage — any combination is allowed. A schedule can attach to a
  // lead (pre-deal, e.g. AI-drafted plan attached to a proposal in
  // sales), a proposal (delivery plan inside a sales deck), a deal
  // (pre-sale Gantt), and/or an org. Cross-linking is the basis for
  // auto-fill across the kit.
  leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  // Cover-page metadata (mirrors the PDF cover)
  title: text('title').notNull(),
  subtitle: text('subtitle'), // e.g. "PROJECT SCHEDULE, GANTT"
  preparedFor: text('prepared_for'),
  preparedBy: text('prepared_by'),
  effectiveDate: text('effective_date'),       // ISO date
  targetLaunchDate: text('target_launch_date'), // ISO date
  // Layout
  numberOfWeeks: integer('number_of_weeks').notNull().default(12),
  // Optional executive overview / notes shown above the gantt grid (Tiptap HTML)
  overviewHtml: text('overview_html'),
  // Status + sharing
  status: text('status').notNull().default('draft'), // draft | shared | archived
  publicShareToken: text('public_share_token'),       // null until shared
  publicSharedAt: text('public_shared_at'),
  // Draft / Publish snapshot (migration 0054). Admin edits live values
  // freely; the public viewer reads `publishedSnapshot` if present so
  // half-finished edits don't leak. Shape mirrors proposals' snapshot:
  //   { schedule: {...}, sections: [...], rows: [...] }
  // null = "not yet published" — public viewer falls back to live so
  // schedules created before this column shipped still work.
  publishedSnapshot: text('published_snapshot'),
  publishedAt: text('published_at'),
  // Audit
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_project_schedules_org').on(table.orgId),
  index('idx_project_schedules_deal').on(table.dealId),
  index('idx_project_schedules_token').on(table.publicShareToken),
])

export const scheduleRows = sqliteTable('schedule_rows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scheduleId: text('schedule_id')
    .notNull()
    .references(() => projectSchedules.id, { onDelete: 'cascade' }),
  // Added in migration 0026: rows belong to a specific gantt SECTION rather
  // than directly to the schedule. The schedule may now have multiple gantt
  // sections (high-level + month-detail breakdowns). Backfill assigned every
  // pre-existing row to a default 'gantt' section per schedule.
  sectionId: text('section_id'),
  // section_header | task | gate | critical_gate
  rowType: text('row_type').notNull(),
  // Display
  label: text('label').notNull(),
  // Owner — only meaningful for `task` rows. Null for headers / gates.
  // Allowed values: 'tahi' | 'client' | 'joint' | 'tahi_parallel'
  owner: text('owner'),
  // 1-based week indices. For `task`: startWeek <= endWeek. For `gate` /
  // `critical_gate`: startWeek === endWeek (the diamond sits in one week).
  // Null for `section_header` rows.
  startWeek: integer('start_week'),
  endWeek: integer('end_week'),
  // Optional risk overlay (the hatched red diagonal stripes in the PDF).
  riskFlag: integer('risk_flag').notNull().default(0),
  // Display order within the schedule.
  position: integer('position').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_schedule_rows_schedule').on(table.scheduleId),
  index('idx_schedule_rows_position').on(table.scheduleId, table.position),
  index('idx_schedule_rows_section').on(table.sectionId),
])

// ─── Schedule sections (migration 0026) ─────────────────────────────────
//
// A `projectSchedule` is now composed of N ordered `scheduleSections`. Each
// section has a type that drives rendering:
//
//   - `overview` / `text`: rich content (Tiptap HTML in `data.html`).
//                          Used for the executive overview slide and any
//                          free-form text section.
//   - `gantt`:             a gantt grid. Rows live in `scheduleRows` with
//                          `section_id` pointing here. Optional `start_week`
//                          / `end_week` filter is used for "month detail"
//                          zoomed views (e.g. W1–W4).
//   - `risk_register`:     a structured risk table.
//                          `data.rows = [{ risk, owner, impact, mitigation,
//                          contractualImplication }]`
//   - `raci_matrix`:       a workstreams × roles grid.
//                          `data = { columns: [{ id, label }], rows: [{ id,
//                          label, group?, cells: { [colId]: 'R'|'A'|'C'|'I' }
//                          }] }`
//
// Storing risk/RACI shape as JSON in `data` avoids a proliferation of small
// tables. If we ever need to query across them (e.g. "find all schedules
// with this owner in their RACI") we can normalise later.

export const scheduleSections = sqliteTable('schedule_sections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scheduleId: text('schedule_id')
    .notNull()
    .references(() => projectSchedules.id, { onDelete: 'cascade' }),
  // overview | gantt | risk_register | raci_matrix | text
  type: text('type').notNull(),
  // Slide title + eyebrow shown in the public viewer.
  title: text('title'),
  subtitle: text('subtitle'),
  // Optional gantt zoom window. Null means "show all weeks of the schedule".
  startWeek: integer('start_week'),
  endWeek: integer('end_week'),
  // Type-specific JSON payload. See module-level docs for shape per type.
  data: text('data'),
  // Per-slide surface treatment for the public viewer:
  //   'light'   — cream surface, ink text (default)
  //   'dark'    — inverted dark-ink surface with light text
  //   'feature' — glassy gradient hero treatment, same vocabulary as the cover
  // Cover slides ignore this column; the viewer always renders the cover with
  // the feature gradient regardless of value.
  themeMode: text('theme_mode').default('light'),
  // Display order.
  position: integer('position').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_schedule_sections_schedule').on(table.scheduleId),
  index('idx_schedule_sections_position').on(table.scheduleId, table.position),
])

// ============================================================
// PROPOSALS (Phase 2) — premium 16:9 slide-deck client proposals
// ============================================================
//
// A `proposal` is a sectioned document like a schedule, but with
// VARIANTS (1-3 packages — Good / Better / Best). Shared sections
// (cover, overview, terms, about, testimonial, text) live on the
// proposal itself. Per-variant content (scope, pricing, timeline,
// CTA) lives in `proposal_variants`. The public viewer renders shared
// sections then a variants picker that switches between package views.
//
// Status flow: draft → shared → (accepted | declined | withdrawn | expired)
//
// Public access: token-based (same pattern as schedules). Acceptance
// creates a row in `proposal_acceptances` capturing who accepted/declined,
// which variant they chose, and an audit trail (IP hash, UA, timestamp).

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Linkage. Any of these can be set; org/deal/lead form the polymorphic
  // parent tree. Lead support added in migration 0053 so a proposal can
  // attach to a lead pre-deal (mirrors schedules → leads from 0049).
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  leadId: text('lead_id'),
  // Cover-page metadata
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  preparedFor: text('prepared_for'),
  preparedBy: text('prepared_by'),
  effectiveDate: text('effective_date'),
  expiresAt: text('expires_at'),
  // Status: draft | shared | accepted | declined | withdrawn | expired
  status: text('status').notNull().default('draft'),
  publicShareToken: text('public_share_token'),
  publicSharedAt: text('public_shared_at'),
  // When status flips to accepted / declined.
  decidedAt: text('decided_at'),
  decidedVariantId: text('decided_variant_id'),
  // Draft / Publish model (Phase 9). The admin edits live values freely;
  // the public viewer reads `publishedSnapshot` if present so unpublished
  // edits don't leak. Snapshot shape mirrors the template snapshot:
  //   { proposal: {...}, sections: [...], variants: [...] }
  // null means "no published version yet" — viewer can fall back to live
  // OR show a "not yet published" state, depending on context.
  publishedSnapshot: text('published_snapshot'),
  publishedAt: text('published_at'),
  // Cover slide theme — separate from per-section themes (which live on
  // section.data.theme). One of: 'brand_glass' (suggested default),
  // 'toned_light', 'light', or 'dark'. Palette lookup lives in
  // app/p/proposal/[token]/proposal-viewer.tsx :: coverPalette().
  coverTheme: text('cover_theme').default('brand_glass'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_proposals_org').on(table.orgId),
  index('idx_proposals_deal').on(table.dealId),
  index('idx_proposals_token').on(table.publicShareToken),
  index('idx_proposals_status').on(table.status),
])

// ─── Sections shared across all variants (cover content, terms, etc.) ──
//
// Section types:
//   - cover         (rendered on the public viewer's cover slide; data.html for body copy)
//   - overview      (Tiptap HTML in data.html — executive summary)
//   - terms         (Tiptap HTML — terms & conditions, payment, warranties)
//   - about         (about Tahi Studio block, can include logo/imagery)
//   - testimonial   (data.quote, data.author, data.role, data.avatarUrl)
//   - scope_shared  (Tiptap HTML — scope content that's same across variants)
//   - text          (free-form Tiptap, for any extra slide)
//
// Per-variant scope/pricing/timeline lives in `proposal_variants`, NOT here.

export const proposalSections = sqliteTable('proposal_sections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposals.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title'),
  subtitle: text('subtitle'),
  data: text('data'), // JSON
  // Per-slide surface treatment for the public viewer:
  //   'light'   — cream surface, ink text (default)
  //   'dark'    — inverted dark-ink surface with light text
  //   'feature' — glassy gradient hero treatment, same vocabulary as the cover
  // The cover slide is always rendered in feature/brand-glass regardless of value.
  themeMode: text('theme_mode').default('light'),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_proposal_sections_proposal').on(table.proposalId),
  index('idx_proposal_sections_position').on(table.proposalId, table.position),
])

// ─── Variants (the "packages" — Good / Better / Best) ──────────────────
//
// Each variant has its own scope content, pricing block (split-value
// model: oneOffAmount + monthlyAmount + currency), pricing notes, and
// optional timeline reference (a project_schedule). Render order is
// driven by `position`; an isFeatured flag bubbles the "recommended"
// variant in the picker.

export const proposalVariants = sqliteTable('proposal_variants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposals.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                 // e.g. "Standard build"
  tagline: text('tagline'),                      // optional subtitle/punchline
  oneOffAmount: integer('one_off_amount').notNull().default(0),
  monthlyAmount: integer('monthly_amount').notNull().default(0),
  currency: text('currency').notNull().default('NZD'),
  // Scope content as Tiptap HTML. Renderer trusts the HTML — only admin
  // users author it, and the public viewer escapes via React's
  // dangerouslySetInnerHTML which is intentional here for rich content.
  scopeHtml: text('scope_html'),
  pricingNotesHtml: text('pricing_notes_html'),
  // Optional reference to a project_schedule for the timeline embed.
  timelineScheduleId: text('timeline_schedule_id').references(() => projectSchedules.id, { onDelete: 'set null' }),
  // CTA label (defaults to "Accept this package")
  ctaLabel: text('cta_label'),
  isFeatured: integer('is_featured').notNull().default(0),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_proposal_variants_proposal').on(table.proposalId),
  index('idx_proposal_variants_position').on(table.proposalId, table.position),
])

// ─── Acceptances (audit trail for accept/decline) ──────────────────────

export const proposalAcceptances = sqliteTable('proposal_acceptances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposals.id, { onDelete: 'cascade' }),
  variantId: text('variant_id').references(() => proposalVariants.id, { onDelete: 'set null' }),
  // accepted | declined
  status: text('status').notNull(),
  acceptorName: text('acceptor_name'),
  acceptorEmail: text('acceptor_email'),
  acceptorRole: text('acceptor_role'),
  comment: text('comment'),
  // sha256(ip + ENCRYPTION_KEY) — never plaintext.
  acceptorIpHash: text('acceptor_ip_hash'),
  acceptorCountry: text('acceptor_country'),
  acceptorUa: text('acceptor_ua'),
  acceptedAt: text('accepted_at').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_proposal_acceptances_proposal').on(table.proposalId),
  index('idx_proposal_acceptances_status').on(table.status),
])

// ============================================================
// CONTRACTS — E-SIGNATURE SYSTEM (Phase 3)
// ============================================================
//
// Distinct from the legacy `contracts` table (which tracks file-uploaded
// PDFs in R2). The e-sign system is composed of:
//
//   contract_templates    — reusable boilerplate with {{variable}} slots
//   contract_documents    — a specific instance of a contract being signed,
//                           HTML body after variable substitution, public
//                           share token, status (draft|sent|partially_signed|
//                           signed|expired|cancelled)
//   contract_signers      — N signers per document (Tahi + client +
//                           witnesses). Each has a position (sign order),
//                           role, name, email, and per-signer status.
//   contract_signatures   — the actual signature records: signature image
//                           data URL, IP hash, UA, country, and a sha256
//                           hash chain (each new signature includes the
//                           previous hash) for tamper evidence.
//
// Variable substitution happens at draft → sent transition: variableValues
// JSON is merged into bodyHtml using template's variableDefs to produce
// the final HTML body that signers see.
//
// Multi-party flow: contract.status flips to 'partially_signed' on the
// first signature, then 'signed' once every signer's status === 'signed'.
//
// Per-signer URL: /dashboard/p/contract/<token>/sign/<signerId> — same
// public token for all signers, but signerId param tells the server which
// row to mark as signed.

/**
 * Proposal templates — reusable proposal blueprints that can be instantiated
 * with one click into a real proposal. The `snapshot` field stores a frozen
 * copy of the sections + variants at template-save time. At create time
 * the snapshot is unpacked into fresh proposal_sections + proposal_variants
 * rows, with optional {{variable}} substitution applied across all HTML
 * content (mirroring contract templates).
 */
export const proposalTemplates = sqliteTable('proposal_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  // Frozen JSON. Shape:
  //   { title, subtitle, sections: [{type, title, subtitle, data, position}],
  //     variants: [{name, tagline, oneOffAmount, monthlyAmount, currency,
  //                 scopeHtml, pricingNotesHtml, ctaLabel, isFeatured, position}] }
  snapshot: text('snapshot').notNull(),
  // Optional declarative variable definitions for the form when creating.
  variableDefs: text('variable_defs'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
})

/**
 * Schedule templates — reusable schedule blueprints. Mirrors the proposal
 * template pattern: `snapshot` is a frozen JSON capture of {scheduleMeta,
 * sections, rows} at template-save time. At create time the snapshot is
 * unpacked into fresh schedule_sections + schedule_rows rows on a brand-new
 * project_schedules row.
 *
 * Snapshot shape:
 *   {
 *     scheduleMeta: { title, subtitle, preparedBy, numberOfWeeks, overviewHtml },
 *     sections: [{ type, title, subtitle, startWeek, endWeek, data, position }],
 *     rows: [{ sectionIndex, rowType, label, owner, startWeek, endWeek,
 *              riskFlag, position }]
 *   }
 *
 * Row.sectionIndex points at sections[index] so when we instantiate the
 * template we can map old (template-time) section IDs to freshly-minted ones.
 */
export const scheduleTemplates = sqliteTable('schedule_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  // Frozen JSON snapshot — see module-level docs for shape.
  snapshot: text('snapshot').notNull(),
  isDefault: integer('is_default').notNull().default(0),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
})

export const contractTemplates = sqliteTable('contract_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // nda | sla | msa | sow | mou | other
  type: text('type').notNull(),
  // The HTML body with {{variable}} slots. Tiptap-style content; admin-authored.
  bodyHtml: text('body_html').notNull(),
  // JSON: array of variable defs the template references, e.g.
  //   [{ key: 'client_name', label: 'Client name', required: true },
  //    { key: 'deal_value',  label: 'Deal value',  required: true }]
  variableDefs: text('variable_defs'),
  isDefault: integer('is_default').notNull().default(0),
  description: text('description'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_contract_templates_type').on(table.type),
])

export const contractDocuments = sqliteTable('contract_documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').references(() => organisations.id, { onDelete: 'cascade' }),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  // Lead support added in migration 0053 — mirrors schedule's lead_id so
  // a contract can attach to a lead before the deal exists (pre-sign).
  leadId: text('lead_id'),
  proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  templateId: text('template_id').references(() => contractTemplates.id, { onDelete: 'set null' }),
  // nda | sla | msa | sow | mou | other
  type: text('type').notNull(),
  name: text('name').notNull(),
  // draft | sent | partially_signed | signed | expired | cancelled
  status: text('status').notNull().default('draft'),
  // Snapshotted HTML body AFTER variable substitution. Static once the
  // contract is sent; admin can edit the underlying values during draft.
  bodyHtml: text('body_html').notNull(),
  // JSON: { key: value } pairs that filled the template slots.
  variableValues: text('variable_values'),
  // Public share token. Same token used by every signer; the per-signer
  // routing is via `signerId` URL param.
  publicShareToken: text('public_share_token'),
  publicSharedAt: text('public_shared_at'),
  // R2 storage key for the final stamped PDF, populated after fully signed.
  signedStorageKey: text('signed_storage_key'),
  // Timestamps for the document lifecycle.
  sentAt: text('sent_at'),
  signedAt: text('signed_at'),
  expiresAt: text('expires_at'),
  // Final tamper-evident hash for the entire signing chain.
  finalHash: text('final_hash'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_contract_documents_org').on(table.orgId),
  index('idx_contract_documents_deal').on(table.dealId),
  index('idx_contract_documents_token').on(table.publicShareToken),
  index('idx_contract_documents_status').on(table.status),
])

export const contractSigners = sqliteTable('contract_signers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  contractId: text('contract_id').notNull().references(() => contractDocuments.id, { onDelete: 'cascade' }),
  // tahi | client | other  (witness retired May 2026 — never used in practice)
  role: text('role').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  // 1-based position in the signing order. Some flows enforce sequential;
  // for v1 we accept signatures in any order.
  position: integer('position').notNull().default(0),
  // pending | signed | skipped
  status: text('status').notNull().default('pending'),
  signedAt: text('signed_at'),
  // signatureId points to the contract_signatures row when this signer has signed.
  signatureId: text('signature_id'),
  ...timestamps,
}, (table) => [
  index('idx_contract_signers_contract').on(table.contractId),
  index('idx_contract_signers_email').on(table.email),
])

export const contractSignatures = sqliteTable('contract_signatures', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  contractId: text('contract_id').notNull().references(() => contractDocuments.id, { onDelete: 'cascade' }),
  signerId: text('signer_id').notNull().references(() => contractSigners.id, { onDelete: 'cascade' }),
  // Base64 PNG data URL of the canvas signature drawing. Stored inline —
  // it's typically <30KB, way under D1's row size limits.
  signatureDataUrl: text('signature_data_url').notNull(),
  // Audit metadata. IP is hashed (sha256+ENCRYPTION_KEY).
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  country: text('country'),
  // Tamper-evident hash chain. Each new signature = sha256(prevChainHash
  // || signerId || signatureDataUrl || timestamp). Changing ANY signature
  // breaks the chain for all subsequent signatures.
  chainHash: text('chain_hash').notNull(),
  signedAt: text('signed_at').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_contract_signatures_contract').on(table.contractId),
  index('idx_contract_signatures_signer').on(table.signerId),
])

// ============================================================
// SHARE-VIEW ANALYTICS — generic across schedules/proposals/contracts
// ============================================================
//
// One row per "viewing session" of a public-shared resource. The browser
// generates a stable sessionId (UUID in localStorage) the first time it
// visits any /p/* link; that lets us count unique viewers without auth.
//
// Privacy: IPs are hashed (sha256 + ENCRYPTION_KEY) so analytics never
// store the plaintext address. We keep the Cloudflare CF-IPCountry header
// for country-level breakdowns.
//
// Lifecycle: the public viewer POSTs once on mount to create the event,
// then heartbeats every 30s + on visibilitychange/beforeunload to update
// endedAt + durationMs. For multi-slide resources (proposals), the
// pagesViewed JSON array tracks which slides came into view.

export const shareViewEvents = sqliteTable('share_view_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Polymorphic target. No FK because cascading on resource delete is
  // handled in the resource's own DELETE handler.
  resourceType: text('resource_type').notNull(), // 'schedule' | 'proposal' | 'contract'
  resourceId: text('resource_id').notNull(),
  // The token used to access — useful when tokens are rotated and you
  // want to attribute pre-rotation traffic separately.
  shareToken: text('share_token').notNull(),
  // Stable browser-generated UUID. Same browser → same sessionId across
  // visits, so unique-viewer count is COUNT DISTINCT(sessionId).
  sessionId: text('session_id').notNull(),
  // Optional viewer self-identification (we never auto-collect this).
  viewerName: text('viewer_name'),
  viewerEmail: text('viewer_email'),
  // sha256(ip + ENCRYPTION_KEY). Never stores plaintext IP.
  viewerIpHash: text('viewer_ip_hash'),
  // From Cloudflare CF-IPCountry header. Null if unavailable.
  viewerCountry: text('viewer_country'),
  // Truncated to 200 chars to avoid storing massive UAs.
  viewerUa: text('viewer_ua'),
  // document.referrer at first event creation.
  referrer: text('referrer'),
  // JSON array of slide/page IDs that came into view. Null/empty for
  // single-page resources like schedules.
  pagesViewed: text('pages_viewed'),
  // Lifecycle timestamps. endedAt + durationMs are updated on heartbeats.
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => [
  index('idx_share_view_events_resource').on(table.resourceType, table.resourceId),
  index('idx_share_view_events_session').on(table.sessionId),
  index('idx_share_view_events_started_at').on(table.startedAt),
])

/**
 * Project calculator — internal pricing helper.
 *
 * Captures a sized estimate for a deal: scope hours, timeline, retainer
 * shape, currency, complexity multiplier. Computes a recommendation
 * (floor / target / stretch) using the team's effective hourly rate +
 * contractor cost + tool licence overhead. Reads pipeline + booked
 * hours to flag capacity risk for the calculation window.
 *
 * `inputs` and `outputs` are JSON blobs — the route handler is the
 * source of truth for the shape (lib/calculator/types.ts). Storing both
 * lets us replay a calculation without re-running the math, and surface
 * "what we quoted vs what we delivered" later when the deal closes.
 *
 * Anchored to a deal whenever possible so the dashboard can offer
 * "draft proposal from this calculation" + "pull this calc into the
 * gantt + contract" later. dealId may be null for sandbox/exploration.
 */
export const projectCalculations = sqliteTable('project_calculations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dealId: text('deal_id'),
  orgId: text('org_id'),
  name: text('name').notNull(),
  // Active calc per deal — surfaced first when re-opening the deal.
  isActive: integer('is_active').notNull().default(1),
  // JSON snapshot of {scope, timeline, retainer, client} — see
  // lib/calculator/types.ts CalculationInputs.
  inputs: text('inputs').notNull(),
  // JSON snapshot of {cost, recommendation, capacity, benchmarks,
  // pacing} — see lib/calculator/types.ts CalculationOutputs.
  // Stored so we can render a historical calc without re-running.
  outputs: text('outputs').notNull(),
  // Cross-link back to the artefact this calc produced (if any).
  // Format: 'proposal:<id>' | 'schedule:<id>' | 'contract:<id>'.
  // Null until the operator hits "use this for X".
  linkedArtefactRef: text('linked_artefact_ref'),
  createdById: text('created_by_id').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_project_calculations_deal').on(table.dealId),
  index('idx_project_calculations_org').on(table.orgId),
])

// ── Cron run log ───────────────────────────────────────────────────────
//
// Every cron writes a row here on completion so /settings/automations
// can show "last run" status without re-running the cron.
export const cronRuns = sqliteTable('cron_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  cron: text('cron').notNull(),
  status: text('status').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  summary: text('summary'),
  error: text('error'),
  ranAt: text('ran_at').notNull(),
}, (table) => [
  index('idx_cron_runs_cron').on(table.cron),
  index('idx_cron_runs_ran_at').on(table.ranAt),
])

// ── Public viewer per-section dwell ────────────────────────────────────
//
// shareViewEvents above tracks each viewing SESSION. shareSectionViews
// records each time within a session that a SECTION becomes visible.
// IntersectionObserver in the public viewer fires enter/exit per section
// and the batched POST lands here. Feeds the heatmap / dwell chart /
// drop-off funnel in ShareAnalyticsCard.
export const shareSectionViews = sqliteTable('share_section_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  sessionId: text('session_id').notNull(),
  sectionId: text('section_id').notNull(),
  dwellMs: integer('dwell_ms').notNull().default(0),
  enteredAt: text('entered_at').notNull(),
  exitedAt: text('exited_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_share_section_views_resource').on(table.resourceType, table.resourceId),
  index('idx_share_section_views_session').on(table.sessionId),
  index('idx_share_section_views_section').on(table.sectionId),
])

// ============================================================
// CONTENT ENGINE (Phase I) — content clusters, ideas, blog health
// ============================================================
//
// Slice 0 puts the three tables in place. Population comes later:
//   - content_clusters : seeded via a future settings endpoint or
//     hand-inserted in Slice 1.
//   - content_ideas    : populated weekly by the Monday cron in Slice 1.
//   - blog_health      : one row per public URL on tahi.studio. Refreshed
//     by the manual scan endpoint in Slice 0 (POST /api/admin/content/
//     health/scan); future Slice 0.5 wires a weekly cron.

/**
 * Content clusters — the topical pillars (the "8 from WORKFLOWS Phase I"):
 * each pillar has a slug + name + description. Ideas hang off a cluster
 * so we can balance topic coverage week-over-week.
 */
export const contentClusters = sqliteTable('content_clusters', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  // active | paused | archived
  status: text('status').notNull().default('active'),
  ...timestamps,
})

/**
 * Content ideas — agent-proposed weekly slate. `signalSources` is a JSON
 * payload describing which signal feeds contributed (e.g. GSC near-miss
 * queries, GA4 traffic decay, competitor gaps); `sourceSignal` is the
 * human-readable single-line summary surfaced in the UI. `liamOpinion`
 * + `liamAnswers` capture Liam's notes during the weekly review.
 */
export const contentIdeas = sqliteTable('content_ideas', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  clusterId: text('cluster_id').references(() => contentClusters.id),
  title: text('title').notNull(),
  angle: text('angle'),
  targetKeyword: text('target_keyword'),
  sourceSignal: text('source_signal'),
  signalSources: text('signal_sources'),
  recommendedWordCount: integer('recommended_word_count'),
  rationale: text('rationale'),
  // 'Liam' | 'Staci' — author classification hint
  brand: text('brand'),
  // 0-100, agent-generated
  score: integer('score'),
  // proposed | approved | rejected | drafted | scheduled | published
  status: text('status').notNull().default('proposed'),
  // ISO week label, e.g. "2026-W22"
  weekLabel: text('week_label'),
  liamOpinion: text('liam_opinion'),
  // JSON: [{q, a}]
  liamAnswers: text('liam_answers'),
  ...timestamps,
}, (table) => [
  index('idx_content_ideas_status').on(table.status),
  index('idx_content_ideas_week').on(table.weekLabel),
])

/**
 * Blog health — one row per URL on tahi.studio. The URL is the primary
 * key; scans overwrite the row so this is always the LATEST snapshot.
 * `raw` keeps the full GSC URL Inspection response for debugging /
 * future field promotion. `source` records where we discovered the URL
 * (sitemap | webflow_collection | manual) so we can audit drift.
 */
export const blogHealth = sqliteTable('blog_health', {
  url: text('url').primaryKey(),
  lastCheckedAt: text('last_checked_at').notNull(),
  // PASS | PARTIAL | FAIL | NEUTRAL | UNKNOWN
  indexStatus: text('index_status'),
  coverageState: text('coverage_state'),
  pageFetchState: text('page_fetch_state'),
  robotsTxtState: text('robots_txt_state'),
  indexingState: text('indexing_state'),
  userCanonical: text('user_canonical'),
  googleCanonical: text('google_canonical'),
  // Populated by Slice 6 — internal-link audit.
  inboundInternalLinks: integer('inbound_internal_links').default(0),
  // Optional — populated when we crawl the page body.
  wordCount: integer('word_count'),
  // JSON dump of full GSC response for debugging.
  raw: text('raw'),
  // sitemap | webflow_collection | manual
  source: text('source').notNull().default('sitemap'),
  ...timestamps,
}, (table) => [
  index('idx_blog_health_status').on(table.indexStatus),
  index('idx_blog_health_checked').on(table.lastCheckedAt),
])

/**
 * Content drafts — Phase I · Slice 2. One row per drafting run, FK'd to
 * the content_ideas row that kicked it off. Stores every intermediate
 * stage of the multi-agent chain so we can retry, debug, and show
 * progress to Liam. A failed run keeps the partial outputs around for
 * inspection. Re-drafting an idea inserts a fresh row rather than
 * overwriting, so we keep an audit trail.
 *
 * Status lifecycle:
 *   queued -> researching -> drafting -> reviewing -> finalising -> ready
 *   (any step may transition to "failed" with errorMessage set)
 */
export const contentDrafts = sqliteTable('content_drafts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ideaId: text('idea_id').notNull().references(() => contentIdeas.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),
  // Research outputs
  researchSummary: text('research_summary'),
  // JSON [{ url, title? }] — only 200-status URLs make it here.
  validatedCitations: text('validated_citations'),
  // Draft outputs
  bodyMarkdown: text('body_markdown'),
  bodyHtml: text('body_html'),
  title: text('title'),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  postExcerpt: text('post_excerpt'),
  shortenedName: text('shortened_name'),
  summary: text('summary'),
  keyTakeaways: text('key_takeaways'),
  // JSON [{ q, a }] 4-6 entries.
  faqsJson: text('faqs_json'),
  // 'liam' | 'staci'
  authorSlug: text('author_slug'),
  mainCategorySlug: text('main_category_slug'),
  // JSON string array of additional category slugs.
  otherCategorySlugs: text('other_category_slugs'),
  // definition | how-to | opinion | comparison | general
  postType: text('post_type'),
  // Reviewer feedback
  salesNotes: text('sales_notes'),
  readabilityNotes: text('readability_notes'),
  // QA
  contentScore: integer('content_score'),
  scoreBreakdown: text('score_breakdown'),
  // Cover
  coverSvgUrl: text('cover_svg_url'),
  coverTemplate: text('cover_template'),
  // Final schema + hreflang
  schemaJsonLd: text('schema_json_ld'),
  hreflangBlock: text('hreflang_block'),
  // Error info (populated when status='failed')
  errorMessage: text('error_message'),
  // Publishing — Slice 5
  // Set once the draft has been pushed to Webflow (live or staged).
  publishedWebflowItemId: text('published_webflow_item_id'),
  // When Liam picked "auto" or "custom", scheduledFor is the ISO datetime
  // the publish cron will flip the staged item live. When mode='now' the
  // pipeline publishes immediately and leaves scheduledFor null.
  scheduledFor: text('scheduled_for'),
  // When the item actually went live. Null while staged-pending-schedule.
  publishedAt: text('published_at'),
  // Public URL of the published post (e.g. https://www.tahi.studio/blog/<slug>)
  publishUrl: text('publish_url'),
  // Round-table concurrency lock (Slice 9). Set to ISO now when a stage
  // starts running; cleared when it finishes. runStage refuses to act if
  // this is set + recent (<90s), so overlapping cron + front-end polls
  // can't run the same stage twice and double-insert reviews.
  stageLockedAt: text('stage_locked_at'),
  // Pause/resume (Slice 9). When Liam pauses a draft mid-pipeline we move
  // status -> 'paused' and stash the stage it was at here. Resume restores
  // status to this value so the orchestrator picks up exactly where it
  // left off (no re-running completed stages). Cron skips 'paused' drafts.
  pausedFromStatus: text('paused_from_status'),
  // 'legacy_audit' = a shadow draft created to evaluate an existing
  // published post (not a new piece of content). Audit drafts skip the
  // writer + headline + cover + structuring stages — they just run the
  // strategist (legacy mode) → reviewers → editor → sign-off → land at
  // status='audited' with the score + critiques as the output. They are
  // never published; Liam picks "Apply improvements" on the audit later
  // to PATCH Webflow with a revised body.
  // null = a normal new-content draft.
  originSource: text('origin_source'),
  // The Webflow CMS item id this audit shadow draft targets. Only set
  // when originSource='legacy_audit'.
  auditTargetWebflowId: text('audit_target_webflow_id'),
  ...timestamps,
}, (table) => [
  index('idx_content_drafts_idea').on(table.ideaId),
  index('idx_content_drafts_status').on(table.status),
  index('idx_content_drafts_scheduled').on(table.scheduledFor),
])

/**
 * Link suggestions — Phase I · Slice 6. One row per "patch a link FROM
 * old_post INTO new_post" proposal. Generated by lib/link-analyzer, kept
 * pending until Liam approves each via the Links tab in /content-studio.
 *
 * State flow:
 *   pending  → approved → applied   (PATCH lands in Webflow as staged edit)
 *   pending  → rejected             (terminal, no Webflow side-effect)
 *
 * Apply verifies contextBefore + contextAfter still match the live source
 * body. If the body has drifted since the suggestion was generated, the
 * apply route returns 409 and Liam re-runs the scan to refresh.
 *
 * Capped at 2 suggestions per source post (don't over-link from one page)
 * and 8 per target post (sweet spot for in-week link velocity). Caps are
 * enforced in the analyzer, not the schema, so future tweaks don't need
 * a migration.
 */
export const linkSuggestions = sqliteTable('link_suggestions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // The "new" post that needs inbound links
  targetUrl: text('target_url').notNull(),
  targetTitle: text('target_title'),
  targetPublishedAt: text('target_published_at'),
  // The "old" post we're suggesting a link FROM
  sourceWebflowId: text('source_webflow_id').notNull(),
  sourceUrl: text('source_url').notNull(),
  sourceTitle: text('source_title'),
  // The patch
  matchPhrase: text('match_phrase').notNull(),
  contextBefore: text('context_before'),
  contextAfter: text('context_after'),
  proposedAnchorText: text('proposed_anchor_text').notNull(),
  justification: text('justification'),
  confidence: integer('confidence').notNull(),
  // pending | approved | applied | rejected
  status: text('status').notNull().default('pending'),
  appliedAt: text('applied_at'),
  ...timestamps,
}, (table) => [
  index('idx_link_suggestions_status').on(table.status),
  index('idx_link_suggestions_target').on(table.targetUrl),
  index('idx_link_suggestions_source').on(table.sourceWebflowId),
])

/**
 * Publish history — Phase I · Slice 5. One row per publish (live or
 * scheduled). Used by the publish-scheduler to enforce two rules:
 *   1. Max 3 posts per rolling 7-day window
 *   2. 14-day topical cooldown — no two posts on the same cluster within
 *      14 days of each other (warning to UI, never blocks)
 *
 * Rows stay forever — every successful publish creates one and we never
 * delete. That's also how /content-studio's Scheduled / Published table
 * gets its data without re-querying Webflow.
 *
 * draftId is nullable because future manual publishes (Webflow-direct,
 * outside the dashboard) might still want to land here via a sync job.
 */
export const publishHistory = sqliteTable('publish_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  webflowItemId: text('webflow_item_id').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  clusterSlug: text('cluster_slug'),
  targetKeyword: text('target_keyword'),
  // ISO datetime the post is (or was) scheduled to go live. For mode='now'
  // this equals createdAt.
  publishedAt: text('published_at').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_publish_history_published').on(table.publishedAt),
  index('idx_publish_history_cluster').on(table.clusterSlug),
])

/**
 * Blog backfill log — Phase I · Slice 6.5. One row per item we touch
 * during a backfill run. Lets the UI show per-item status + lets us
 * resume failed runs without re-touching items already patched.
 *
 * runId groups every row from a single run so the dashboard can list
 * recent runs with their summary. fieldsWritten is a JSON array of CMS
 * slugs we successfully PATCH'd so a partial-success row still tells
 * us exactly what landed.
 *
 * status:
 *   success — every field patched cleanly
 *   failed  — Anthropic call, Webflow PATCH, or pre-flight read failed
 *   skipped — item filtered out (e.g. already has FAQ #1 in `missing` mode)
 */
export const blogBackfillLog = sqliteTable('blog_backfill_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  webflowItemId: text('webflow_item_id').notNull(),
  postUrl: text('post_url').notNull(),
  postTitle: text('post_title'),
  runId: text('run_id').notNull(),
  // success | failed | skipped
  status: text('status').notNull(),
  // JSON array of CMS slugs we wrote, e.g. ["faq-question-1","schema",...]
  fieldsWritten: text('fields_written'),
  errorMessage: text('error_message'),
  faqsGenerated: integer('faqs_generated'),
  takeawaysGenerated: integer('takeaways_generated'),
  schemaCharsWritten: integer('schema_chars_written'),
  durationMs: integer('duration_ms'),
  ...timestamps,
}, (table) => [
  index('idx_blog_backfill_run').on(table.runId),
  index('idx_blog_backfill_status').on(table.status),
])

/**
 * Round-table drafting — Phase I · Slice 9.
 *
 * The single-prompt `lib/blog-writer.ts` is being replaced with a
 * multi-stage panel: SERP analyst → researcher → strategist → headline
 * lab → writer → 20+ reviewers → editor → sign-off. Each non-data stage
 * gets a row in `draftReviews`. Revisions get a row in `draftRevisions`
 * (immutable history of every body version). The editor's tie-breaking
 * decisions get a row in `editorOverrides` so we can build a calibration
 * loop where Liam side-with reviewers and the system learns weights over
 * time.
 *
 * `draftVariants` holds the loser-drafts from high-priority articles
 * where the writer produced 2 candidate angles in parallel.
 *
 * `postScorecards` is the morning-after-publish view: GSC indexing,
 * GA4/Matomo sessions, SE Ranking position, conversion attribution.
 * One row per published post, updated nightly by a cron.
 *
 * `aiCostLog` is per-stage cost tracking. Every Anthropic / OpenAI /
 * Perplexity / Replicate call writes one row with model + tokens +
 * estimated USD. Lets us enforce the per-article cap and aggregate
 * spend by stage / reviewer / post.
 */

export const draftRevisions = sqliteTable('draft_revisions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  // 1-indexed per draft. Revision 1 is the writer's first output;
  // editor-merged revisions are 2, 3, etc. Capped at 4 by the orchestrator.
  revisionNumber: integer('revision_number').notNull(),
  // writer_initial | editor_merge | writer_retry | editor_signoff
  source: text('source').notNull(),
  bodyHtml: text('body_html').notNull(),
  bodyMarkdown: text('body_markdown'),
  wordCount: integer('word_count'),
  // Optional reason this revision was produced (e.g. "Anti-AI gate failed at 27%, rewrite")
  reason: text('reason'),
  ...timestamps,
}, (table) => [
  index('idx_draft_revisions_draft').on(table.draftId, table.revisionNumber),
])

export const draftReviews = sqliteTable('draft_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  // Which revision this review was performed against (lets us see how
  // reviewer opinions changed across rewrites).
  revisionNumber: integer('revision_number').notNull(),
  // strategist | headline_lab | writer | seo_aeo | sales | marketing |
  // brand_tone | icp_reader | anti_ai | tahi_voice | originality |
  // internal_links | accessibility | legal_risk | hook | closing_cta |
  // pacing | citations | visual_layout | featured_snippet |
  // voice_search | skim_test | counter_argument | unique_angle |
  // mobile_reading | emotional_resonance | editor | signoff
  reviewerKey: text('reviewer_key').notNull(),
  // 0-100, reviewer's score for this revision. null for non-scoring
  // reviewers (e.g. researcher).
  score: integer('score'),
  // 'pass' | 'soft_fail' | 'hard_fail' — hard_fail means veto-power
  // reviewers blocked the revision; soft_fail = Editor can override.
  verdict: text('verdict'),
  // Concise reviewer summary for the conflict UI.
  summary: text('summary'),
  // JSON: structured critique payload specific to the reviewer.
  // e.g. for SEO: { keywordDensity, missingHeadings, ... }
  //      for Sales: { ctaStrength, pathToCallScore, suggestions: [...] }
  critique: text('critique'),
  // Voice weight applied to this reviewer when the editor merged.
  // Strategist sets these based on funnel intent.
  weight: text('weight'),  // stored as text JSON to allow fine-grained per-stage values
  // Time taken so we can spot slow reviewers
  durationMs: integer('duration_ms'),
  ...timestamps,
}, (table) => [
  index('idx_draft_reviews_draft').on(table.draftId, table.revisionNumber),
  index('idx_draft_reviews_reviewer').on(table.reviewerKey),
  index('idx_draft_reviews_verdict').on(table.verdict),
])

export const editorOverrides = sqliteTable('editor_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  // Two reviewers disagreed. Editor picked one. Liam can later side with
  // the other in the conflicts UI; that override is logged here.
  reviewerA: text('reviewer_a').notNull(),
  reviewerB: text('reviewer_b').notNull(),
  topic: text('topic'),                 // freeform e.g. "paragraph 4 retention"
  editorPicked: text('editor_picked').notNull(),  // 'a' | 'b' | 'compromise'
  editorReasoning: text('editor_reasoning'),
  // Liam's override (null until reviewed)
  liamSidedWith: text('liam_sided_with'),   // 'a' | 'b' | 'editor' | null
  liamReasoning: text('liam_reasoning'),
  reviewedAt: text('reviewed_at'),
  ...timestamps,
}, (table) => [
  index('idx_editor_overrides_draft').on(table.draftId),
  index('idx_editor_overrides_unreviewed').on(table.liamSidedWith),
])

export const draftVariants = sqliteTable('draft_variants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  draftId: text('draft_id').notNull().references(() => contentDrafts.id, { onDelete: 'cascade' }),
  // Variant index — strategist requests 2 for high-priority posts.
  // 'A' / 'B' / 'C'. The winning variant's body lives on contentDrafts.
  variantLabel: text('variant_label').notNull(),
  angle: text('angle'),                 // strategist's one-liner for this angle
  bodyHtml: text('body_html').notNull(),
  bodyMarkdown: text('body_markdown'),
  panelScore: integer('panel_score'),   // 0-100 mean across reviewers
  selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
  editorReasoning: text('editor_reasoning'),
  ...timestamps,
}, (table) => [
  index('idx_draft_variants_draft').on(table.draftId),
])

export const postScorecards = sqliteTable('post_scorecards', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // One row per published post — keyed on the Webflow item id so refreshes
  // overwrite, not stack.
  webflowItemId: text('webflow_item_id').notNull().unique(),
  draftId: text('draft_id').references(() => contentDrafts.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  publishedAt: text('published_at').notNull(),
  // GSC
  gscIndexStatus: text('gsc_index_status'),    // PASS / PARTIAL / FAIL
  gscFirstIndexedAt: text('gsc_first_indexed_at'),
  gscImpressions7d: integer('gsc_impressions_7d'),
  gscClicks7d: integer('gsc_clicks_7d'),
  gscAvgPosition7d: integer('gsc_avg_position_7d'),  // x100 for 2dp precision
  gscImpressions30d: integer('gsc_impressions_30d'),
  gscClicks30d: integer('gsc_clicks_30d'),
  gscAvgPosition30d: integer('gsc_avg_position_30d'),
  // GA4
  ga4Sessions7d: integer('ga4_sessions_7d'),
  ga4Sessions30d: integer('ga4_sessions_30d'),
  ga4AvgEngagementSec: integer('ga4_avg_engagement_sec'),
  ga4ConversionEvents30d: integer('ga4_conversion_events_30d'),
  // Matomo (optional, if key configured)
  matomoVisits30d: integer('matomo_visits_30d'),
  matomoAvgTimeSec: integer('matomo_avg_time_sec'),
  // SE Ranking
  seRankingTargetPos: integer('se_ranking_target_pos'),
  seRankingTopKeywords: text('se_ranking_top_keywords'),   // JSON [{kw, pos}]
  // Internal — links landed pointing here
  inboundInternalLinks: integer('inbound_internal_links').notNull().default(0),
  // Backlinks (manual or from Ahrefs/SE Ranking)
  backlinks30d: integer('backlinks_30d').notNull().default(0),
  // Editor's predictions at publish-time for accountability
  predictedWordCount: integer('predicted_word_count'),
  predictedRank30d: integer('predicted_rank_30d'),
  predictedSessions30d: integer('predicted_sessions_30d'),
  // Last refresh
  lastRefreshedAt: text('last_refreshed_at'),
  ...timestamps,
}, (table) => [
  index('idx_post_scorecards_published').on(table.publishedAt),
])

export const aiCostLog = sqliteTable('ai_cost_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // What did this call belong to? Most calls tie back to a draft. Some
  // (ideation cron, backfill) tie to other surfaces — we'll use scope to
  // group those.
  scope: text('scope').notNull(),                  // 'draft' | 'ideation' | 'backfill' | 'links' | 'health'
  scopeId: text('scope_id'),                       // draft.id / idea.id / runId etc
  // What stage was this? Maps to draftReviews.reviewerKey for review
  // calls, or 'researcher', 'cover_generator', 'embedding' etc.
  stage: text('stage').notNull(),
  // Provider + model
  provider: text('provider').notNull(),            // 'anthropic' | 'openai' | 'perplexity' | 'replicate'
  model: text('model').notNull(),
  // Usage
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  // For non-token services (image gen, embeddings billed per call)
  callUnits: integer('call_units'),
  // Estimated USD cost. We compute this in-app per provider rate sheet
  // so we don't have to wait for invoice reconciliation.
  estimatedUsdCents: integer('estimated_usd_cents').notNull(),
  // Optional friendly note
  note: text('note'),
  ...timestamps,
}, (table) => [
  index('idx_ai_cost_log_scope').on(table.scope, table.scopeId),
  index('idx_ai_cost_log_stage').on(table.stage),
  index('idx_ai_cost_log_created').on(table.createdAt),
])

/**
 * Live site index. Weekly cron pulls tahi.studio/sitemap.xml, diffs
 * against this table, and Haiku-summarises any new or changed page.
 * The round-table writer reads this as its "what exists on the site
 * + what each page is about" context for internal linking.
 *
 * The glossary auto-link step at publish also walks this table for
 * rows where type='glossary' to wrap first-mentions of any term in the
 * body with [term](url).
 */
export const siteIndex = sqliteTable('site_index', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  url: text('url').notNull().unique(),               // absolute, e.g. https://www.tahi.studio/blog/x
  relativeUrl: text('relative_url').notNull(),       // /blog/x — used for matching internal links
  // 'blog' | 'glossary' | 'service' | 'work' | 'about' | 'contact' | 'page' | 'other'
  type: text('type').notNull(),
  title: text('title'),                              // <title> or H1 of the page
  // Haiku one-line summary of what the page is about — used in writer prompt.
  summary: text('summary'),
  // SHA-256 of the page body. Cron only re-summarises when this changes.
  contentHash: text('content_hash'),
  // ISO. When did the sitemap last contain this URL?
  lastSeenAt: text('last_seen_at').notNull(),
  // ISO. When was the summary last computed?
  summarisedAt: text('summarised_at'),
  // Set true when a sitemap pull no longer returns this URL. Excluded
  // from writer context but kept as a tombstone.
  isActive: integer('is_active').notNull().default(1),
  // text-embedding-3-small vector as JSON [number, ...]. Computed when
  // summary changes. Used by related-posts at publish + back-link cron.
  embedding: text('embedding'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_site_index_type').on(table.type),
  index('idx_site_index_active').on(table.isActive),
])

/**
 * Back-link queue. Every time a new blog post actually goes LIVE on
 * tahi.studio (publish-now or scheduled-flip), an entry is added. The
 * back-link cron drains the queue: for each new post, finds the top
 * old posts where the new one is contextually relevant (embedding
 * similarity >= 0.72), and inserts an inline contextual link in each.
 *
 * Spam guards prevent any single old post becoming a link farm:
 *  - 5 old posts max get a link from any one new post
 *  - 8 system-added back-links lifetime per old post
 *  - 30-day cooldown between system back-links on the same old post
 *  - similarity threshold 0.72
 */
export const backlinkQueue = sqliteTable('backlink_queue', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // The newly published post (target of incoming back-links).
  newPostUrl: text('new_post_url').notNull(),
  newPostSlug: text('new_post_slug').notNull(),
  newPostWebflowId: text('new_post_webflow_id'),
  // 'queued' | 'processing' | 'done' | 'failed'
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  // JSON [{ oldPostUrl, oldPostWebflowId, similarity, linkedAt }]
  applied: text('applied'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  processedAt: text('processed_at'),
}, (table) => [
  index('idx_backlink_queue_status').on(table.status),
])

/**
 * Per-old-post back-link count + last-applied timestamp. Used by the
 * cron to enforce the lifetime cap (max 8) + cooldown (30 days).
 */
export const backlinkStats = sqliteTable('backlink_stats', {
  postUrl: text('post_url').primaryKey(),
  postWebflowId: text('post_webflow_id'),
  totalApplied: integer('total_applied').notNull().default(0),
  lastAppliedAt: text('last_applied_at'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

// ============================================================
// SITEMAP (Liam + Staci's planning surface — /sitemap route)
// ============================================================

/**
 * Planning library for the upcoming Tahi marketing site redesign.
 * One row per planned page / CMS collection / grouping section.
 * Tree structure via nullable parentId — unbounded depth, UI guides
 * away from nesting past 3-4 levels.
 *
 * Gated to business@tahi.studio + staci@tahi.studio at the route
 * layer. Long-lived planning artefact — will outlive the redesign.
 */
export const sitemapNodes = sqliteTable('sitemap_nodes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  // 'page' | 'cms_collection' | 'section'
  nodeType: text('node_type').notNull().default('page'),
  title: text('title').notNull(),
  slug: text('slug'),
  url: text('url'),  // live or target URL; nullable when not yet decided
  purpose: text('purpose'),
  icpAudience: text('icp_audience'),
  primaryKeyword: text('primary_keyword'),
  aeoIntent: text('aeo_intent'),
  positioningVertical: text('positioning_vertical'),
  successMetric: text('success_metric'),
  // 'idea' | 'spec_done' | 'design_done' | 'webflow_done' | 'live' | 'parked'
  status: text('status').notNull().default('idea'),
  specialFeatures: text('special_features'),
  designNotes: text('design_notes'),
  contentNotes: text('content_notes'),
  // One content block per line. Staci uses this as a design shopping
  // list: "FAQs · pricing comparison · testimonial section · ROI
  // calculator · hero with case-study logos · 3-step process …".
  contentBlocksNeeded: text('content_blocks_needed'),
  targetLaunchDate: text('target_launch_date'),
  // Tiptap JSON for the freeform notes block at the bottom of each doc
  bodyTiptap: text('body_tiptap'),
  createdBy: text('created_by'),
  lastEditedBy: text('last_edited_by'),
  ...timestamps,
}, (table) => ({
  parentIdx: index('idx_sitemap_nodes_parent').on(table.parentId),
  statusIdx: index('idx_sitemap_nodes_status').on(table.status),
}))

/**
 * Sub-agent review history per node. One row per (node × reviewer
 * × run). Keeps the full critique payload + suggestions so the UI
 * can show review-over-time without re-running.
 */
export const sitemapNodeReviews = sqliteTable('sitemap_node_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  nodeId: text('node_id').notNull(),
  // 'seo_aeo' | 'icp' | 'brand_voice' | 'cro' | 'sales' | 'marketing'
  reviewerKey: text('reviewer_key').notNull(),
  score: integer('score'),
  summary: text('summary'),
  // JSON array of {priority, suggestion} or just strings
  suggestions: text('suggestions'),
  // JSON — full critique payload from the model
  critique: text('critique'),
  costCents: integer('cost_cents').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
}, (table) => ({
  nodeIdx: index('idx_sitemap_node_reviews_node').on(table.nodeId),
  reviewerIdx: index('idx_sitemap_node_reviews_reviewer').on(table.reviewerKey),
}))

