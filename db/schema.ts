import {
  sqliteTable,
  text,
  integer,
  real,
  index,
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
  // S13 remaining: CRM extended fields
  // JSON object for arbitrary custom fields, e.g. {"industry_vertical":"SaaS"}
  customFields: text('custom_fields').default('{}'),
  defaultHourlyRate: integer('default_hourly_rate'),
  // micro | small | medium | large | enterprise
  size: text('size'),
  annualRevenue: integer('annual_revenue'),
  ...timestamps,
}, (table) => [
  index('idx_orgs_status').on(table.status),
  index('idx_orgs_plan').on(table.planType),
])

// ============================================================
// CONTACTS (People at client orgs)
// ============================================================

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  clerkUserId: text('clerk_user_id'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
  lastLoginAt: text('last_login_at'),
  ...timestamps,
}, (table) => [
  index('idx_contacts_org').on(table.orgId),
  index('idx_contacts_clerk').on(table.clerkUserId),
])

// ============================================================
// TEAM MEMBERS (Tahi internal)
// ============================================================

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull(),
  title: text('title'),
  // admin | member
  role: text('role').notNull().default('member'),
  clerkUserId: text('clerk_user_id'),
  weeklyCapacityHours: real('weekly_capacity_hours').default(40),
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
})

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
})

// ============================================================
// REQUESTS (All work items)
// ============================================================

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  trackId: text('track_id').references(() => tracks.id),
  projectId: text('project_id'),
  brandId: text('brand_id'),
  // small_task | large_task | bug_fix | content_update | new_feature | consultation | custom
  type: text('type').notNull().default('small_task'),
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
  ...timestamps,
}, (table) => [
  index('idx_requests_org').on(table.orgId),
  index('idx_requests_status').on(table.status),
  index('idx_requests_assignee').on(table.assigneeId),
  index('idx_requests_track').on(table.trackId),
  index('idx_requests_number').on(table.requestNumber),
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
})

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
  ...timestamps,
}, (table) => [
  index('idx_invoices_org').on(table.orgId),
  index('idx_invoices_status').on(table.status),
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
})

// ============================================================
// TIME ENTRIES
// ============================================================

export const timeEntries = sqliteTable('time_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
  requestId: text('request_id').references(() => requests.id, { onDelete: 'set null' }),
  teamMemberId: text('team_member_id').notNull().references(() => teamMembers.id),
  hours: real('hours').notNull(),
  hourlyRate: real('hourly_rate'),
  billable: integer('billable', { mode: 'boolean' }).default(true),
  notes: text('notes'),
  date: text('date').notNull(),
  ...timestamps,
}, (table) => [
  index('idx_time_org').on(table.orgId),
  index('idx_time_member').on(table.teamMemberId),
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
  ...timestamps,
}, (table) => [
  index('idx_tasks_org').on(table.orgId),
  index('idx_tasks_type').on(table.type),
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_track').on(table.trackId),
  index('idx_tasks_request').on(table.requestId),
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
})

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
})

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
})

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
// EXCHANGE RATES CACHE
// ============================================================

export const exchangeRates = sqliteTable('exchange_rates', {
  currency: text('currency').primaryKey(),
  rateToUsd: real('rate_to_usd').notNull(),
  updatedAt: text('updated_at').notNull(),
})

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
})

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
})

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
})

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
})

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
})

// ============================================================
// CRM: ACTIVITIES
// ============================================================

export const activities = sqliteTable('activities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dealId: text('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
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
