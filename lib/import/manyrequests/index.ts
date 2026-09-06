/**
 * lib/import/manyrequests
 *
 * The silent ManyRequests importer.
 *
 * THE PRIME DIRECTIVE. Nothing in this directory may reach a mailer, an invite,
 * or a notification. The importer reads the ManyRequests REST API and writes D1
 * with Drizzle directly. It calls no /api/admin or /api/portal route, and it
 * imports nothing from lib/notifications, lib/notification-email,
 * lib/request-status-effects, lib/events, lib/email, lib/announcement-emails,
 * @clerk/* or app/**. That is enforced by a static test over the whole module
 * graph, not by convention.
 *
 * The reason the rule is "no routes at all" rather than "stub the mailer":
 * POST /api/admin/clients emails a portal invite BY DEFAULT (the gate is
 * `body.sendInvite !== false`, opt-out not opt-in), PATCHing a request to
 * delivered or client_review fans an email out to every contact at the client
 * org, and three routes fetch https://api.resend.com/emails themselves rather
 * than going through lib/email.ts, so a stubbed mailer would not cover them.
 *
 * The three layers of the guarantee, in order of strength:
 *   1. No mail-capable module is in the import graph (static test).
 *   2. Imported contacts get no clerkUserId and imported orgs get no
 *      clerkOrgId, so no notification can resolve to a human on an imported
 *      row even if one were somehow reached.
 *   3. The mail probe: the suppression log and the notification table are
 *      counted before and after every run, dry or applied, and reported.
 */

export {
  createManyRequestsClient,
  manyRequestsBaseUrlFromEnv,
  manyRequestsTokenFromEnv,
  ManyRequestsReadError,
  MANYREQUESTS_DEFAULT_BASE_URL,
  MANYREQUESTS_TOKEN_MISSING,
  type ManyRequestsClient,
  type ManyRequestsClientOptions,
} from './client'

export {
  buildFormResponses,
  commentKey,
  extractRequestBrief,
  invoiceItemKey,
  mapBillingInterval,
  mapInvoiceMoney,
  mapInvoicePaidAt,
  mapInvoiceStatus,
  mapOrgStatus,
  mapPlanType,
  mapRequestPriority,
  mapRequestStatus,
  mapSubscriptionStatus,
  resolveCommentAuthor,
  subscriptionKey,
  unescapeHtmlEntities,
  type ClosedRuling,
} from './map'

export {
  CONTACT_EMAIL_REPLACEMENTS,
  DEFAULT_PLAN_OPTIONS,
  diffFields,
  MANYREQUESTS_TEAM,
  ORG_NAME_MATCHES,
  ORG_SKIP,
  PLAN_BUILDERS,
  projectPlan,
  sameValue,
  type ImportSnapshot,
  type ImportSource,
  type PlanOptions,
} from './plan'

export { applyEntityPlan, countsFor, ENTITY_TABLE, readImportSnapshot, readMailProbe } from './upsert'

export { fetchImportSource, mailProbesAgree, runImport, SAMPLE_LIMIT, type RunImportOptions } from './run'

export {
  DEMO_REQUEST_TITLES,
  DUMMY_ORGS,
  isDemoRequestTitle,
  isProtectedOrg,
  matchesDummyAllowlist,
  planWipeDemo,
  PROTECTED_ORG_IDS,
  runCleanup,
  type CleanupInput,
  type CleanupPlan,
} from './cleanup'

export {
  IMPORT_ENTITIES,
  IMPORT_ENTITY_ORDER,
  isImportEntity,
  type EntityCounts,
  type EntityPlan,
  type ImportEntity,
  type ImportResult,
  type MailProbe,
  type SkippedRow,
} from './types'
