import { requireManualCronAdmin } from '@/lib/cron-admin-access'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { is, and } from 'drizzle-orm'
import { SQLiteTable, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import { FEATURE_TREE } from '@/lib/feature-tree'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireStudioAdmin, internalOrgFilter } from '@/lib/internal-route-access'
import { requireFeature } from '@/lib/require-feature'
import { assertCronAuth } from '@/lib/cron-runs'

const FIXED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["billing/financial-health",["GET"]],
  ["billing/monthly-email",["POST"]],
  ["billing/xero-export",["POST"]],
  ["capacity/forecast",["GET"]],
  ["capacity",["GET","PATCH"]],
  ["capacity/start-date",["POST"]],
  ["content/audits/[id]/improve",["POST"]],
  ["content/audits",["GET","POST"]],
  ["content/backfill-settings",["GET","POST"]],
  ["content/backfill/process",["POST"]],
  ["content/backfill/runs/[runId]",["GET"]],
  ["content/backfill/runs",["GET"]],
  ["content/backfill/start",["POST"]],
  ["content/bulk-backfill",["POST"]],
  ["content/clusters",["GET"]],
  ["content/clusters/seed",["POST"]],
  ["content/conflicts/[id]",["PATCH"]],
  ["content/cover/generate",["POST"]],
  ["content/cover/preview",["POST"]],
  ["content/coverage-audit",["GET"]],
  ["content/drafts/[id]/advance",["POST"]],
  ["content/drafts/[id]/approve-brief",["POST"]],
  ["content/drafts/[id]/force-approve",["POST"]],
  ["content/drafts/[id]/pause",["POST"]],
  ["content/drafts/[id]/pipeline",["GET"]],
  ["content/drafts/[id]/publish",["POST"]],
  ["content/drafts/[id]/regenerate-cover",["POST"]],
  ["content/drafts/[id]/reject-brief",["POST"]],
  ["content/drafts/[id]/repair-schema",["POST"]],
  ["content/drafts/[id]/restart",["POST"]],
  ["content/drafts/[id]/restructure",["POST"]],
  ["content/drafts/[id]/resume",["POST"]],
  ["content/drafts/[id]/retry",["POST"]],
  ["content/drafts/[id]",["GET","DELETE"]],
  ["content/drafts/[id]/send-to-staci",["POST"]],
  ["content/drafts/[id]/set-cover",["POST"]],
  ["content/drafts/[id]/suggest-edits",["POST"]],
  ["content/drafts/recompute-bucket-scores",["POST"]],
  ["content/drafts",["GET"]],
  ["content/field-audit",["GET"]],
  ["content/glossary/[id]/audit",["POST"]],
  ["content/glossary/[id]/backfill",["POST"]],
  ["content/glossary/boost-underperformers",["GET","POST"]],
  ["content/glossary/generate",["POST"]],
  ["content/glossary/index-schema",["GET"]],
  ["content/glossary/inspect",["GET"]],
  ["content/glossary/publish",["POST"]],
  ["content/health/indexnow",["POST"]],
  ["content/health",["GET"]],
  ["content/health/scan",["POST"]],
  ["content/health/sitemap",["GET"]],
  ["content/ideas/[id]/round-table",["POST"]],
  ["content/ideas/[id]",["PATCH"]],
  ["content/ideas/manual",["POST"]],
  ["content/ideas",["GET"]],
  ["content/links/[id]/apply",["POST"]],
  ["content/links/[id]/reject",["POST"]],
  ["content/links/scan",["POST"]],
  ["content/links/suggestions",["GET"]],
  ["content/posts/[id]/backfill",["POST"]],
  ["content/posts/[id]/schema/rebuild",["POST"]],
  ["content/posts/schema/rebuild-all",["POST"]],
  ["content/schedule",["GET"]],
  ["content/schema/unwrap-existing",["POST"]],
  ["content/scorecards/refresh",["POST"]],
  ["content/site-index",["GET"]],
  ["content/spend",["GET"]],
  ["content/webflow-status",["GET"]],
  ["cron/affiliate-reactivation",["POST"]],
  ["cron/auto-promote-calls",["POST"]],
  ["cron/backlink-process",["POST"]],
  ["cron/content-auto-backfill",["POST"]],
  ["cron/content-gap-hunt",["POST"]],
  ["cron/daily-summary",["POST"]],
  ["cron/delivery-watch",["POST"]],
  ["cron/finance-anomaly-scan",["POST"]],
  ["cron/ideation",["POST"]],
  ["cron/indexing-reverser",["POST"]],
  ["cron/leads-ai",["POST"]],
  ["cron/link-engine-scan",["POST"]],
  ["cron/post-scorecard-sync",["POST"]],
  ["cron/pre-call-digest",["POST"]],
  ["cron/publish-scheduled",["POST"]],
  ["cron/round-table-advance",["POST"]],
  ["cron/schema-watchdog",["POST"]],
  ["cron/site-index-sync",["POST"]],
  ["cron/snapshot-metrics",["POST"]],

  ["cron/sync-stripe",["POST"]],
  ["cron/sync-xero",["POST"]],
  ["crons",["GET"]],
  ["crons/suggest-from-transcripts",["POST"]],
  ["crons/sweep",["POST"]],
  ["exchange-rates",["GET","POST"]],
  ["financial-reports/anomalies",["GET"]],
  ["financial-reports/backfill-mrr",["POST"]],
  ["financial-reports/subscriptions-audit",["GET"]],
  ["financial-reports/summary",["GET"]],
  ["guide",["GET"]],
  ["health",["GET","POST"]],
  ["integrations/airwallex/sync",["POST"]],
  ["integrations/google/sync-calendar",["POST"]],
  ["integrations/google/sync-drive-transcripts",["POST"]],
  ["integrations/rewardful/sync",["POST"]],
  ["integrations/stripe/import-invoices",["POST"]],
  ["integrations/stripe/import-payments",["POST"]],
  ["integrations/stripe/provision",["POST","GET"]],
  ["integrations/xero/import-invoices",["POST"]],
  ["integrations/xero/match-contacts",["GET","PATCH"]],
  ["integrations/xero/sync-balances",["POST"]],
  ["integrations/xero/sync-payments",["POST"]],
  ["integrations/xero/sync-pnl",["POST"]],
  ["integrations/zapier",["GET","POST"]],
  ["overview/brief/refresh",["POST"]],
  ["overview/brief",["GET"]],
  ["overview/me",["GET"]],
  ["overview/replies-waiting",["GET"]],
  ["overview",["GET"]],
  ["overview/wire",["GET"]],
  ["planned-roles/[id]",["PATCH","DELETE"]],
  ["planned-roles",["GET","POST"]],
  ["reports/ai-cost",["GET"]],
  ["reports/billing-summary",["GET"]],
  ["reports/cash-flow-forecast",["GET"]],
  ["reports/client-profitability",["GET"]],
  ["reports/invoice-aging",["GET"]],
  ["reports/response-time",["GET"]],
  ["reports/retainer-alerts",["POST"]],
  ["reports/retainer-health",["GET"]],
  ["reports/sales",["GET"]],
  ["reports/utilization",["GET"]],
  ["seed",["POST"]],
  ["settings",["GET","PATCH"]],
  ["team/[id]/access",["GET","PUT"]],
  ["team/org-chart",["GET"]],
]
const modules: Record<string, () => Promise<unknown>> = {
  '../admin/billing/financial-health/route.ts': () => import('@/app/api/admin/billing/financial-health/route'),
  '../admin/billing/monthly-email/route.ts': () => import('@/app/api/admin/billing/monthly-email/route'),
  '../admin/billing/xero-export/route.ts': () => import('@/app/api/admin/billing/xero-export/route'),
  '../admin/capacity/forecast/route.ts': () => import('@/app/api/admin/capacity/forecast/route'),
  '../admin/capacity/route.ts': () => import('@/app/api/admin/capacity/route'),
  '../admin/capacity/start-date/route.ts': () => import('@/app/api/admin/capacity/start-date/route'),
  '../admin/content/audits/[id]/improve/route.ts': () => import('@/app/api/admin/content/audits/[id]/improve/route'),
  '../admin/content/audits/route.ts': () => import('@/app/api/admin/content/audits/route'),
  '../admin/content/backfill-settings/route.ts': () => import('@/app/api/admin/content/backfill-settings/route'),
  '../admin/content/backfill/process/route.ts': () => import('@/app/api/admin/content/backfill/process/route'),
  '../admin/content/backfill/runs/[runId]/route.ts': () => import('@/app/api/admin/content/backfill/runs/[runId]/route'),
  '../admin/content/backfill/runs/route.ts': () => import('@/app/api/admin/content/backfill/runs/route'),
  '../admin/content/backfill/start/route.ts': () => import('@/app/api/admin/content/backfill/start/route'),
  '../admin/content/bulk-backfill/route.ts': () => import('@/app/api/admin/content/bulk-backfill/route'),
  '../admin/content/clusters/route.ts': () => import('@/app/api/admin/content/clusters/route'),
  '../admin/content/clusters/seed/route.ts': () => import('@/app/api/admin/content/clusters/seed/route'),
  '../admin/content/conflicts/[id]/route.ts': () => import('@/app/api/admin/content/conflicts/[id]/route'),
  '../admin/content/cover/generate/route.ts': () => import('@/app/api/admin/content/cover/generate/route'),
  '../admin/content/cover/preview/route.ts': () => import('@/app/api/admin/content/cover/preview/route'),
  '../admin/content/coverage-audit/route.ts': () => import('@/app/api/admin/content/coverage-audit/route'),
  '../admin/content/drafts/[id]/advance/route.ts': () => import('@/app/api/admin/content/drafts/[id]/advance/route'),
  '../admin/content/drafts/[id]/approve-brief/route.ts': () => import('@/app/api/admin/content/drafts/[id]/approve-brief/route'),
  '../admin/content/drafts/[id]/force-approve/route.ts': () => import('@/app/api/admin/content/drafts/[id]/force-approve/route'),
  '../admin/content/drafts/[id]/pause/route.ts': () => import('@/app/api/admin/content/drafts/[id]/pause/route'),
  '../admin/content/drafts/[id]/pipeline/route.ts': () => import('@/app/api/admin/content/drafts/[id]/pipeline/route'),
  '../admin/content/drafts/[id]/publish/route.ts': () => import('@/app/api/admin/content/drafts/[id]/publish/route'),
  '../admin/content/drafts/[id]/regenerate-cover/route.ts': () => import('@/app/api/admin/content/drafts/[id]/regenerate-cover/route'),
  '../admin/content/drafts/[id]/reject-brief/route.ts': () => import('@/app/api/admin/content/drafts/[id]/reject-brief/route'),
  '../admin/content/drafts/[id]/repair-schema/route.ts': () => import('@/app/api/admin/content/drafts/[id]/repair-schema/route'),
  '../admin/content/drafts/[id]/restart/route.ts': () => import('@/app/api/admin/content/drafts/[id]/restart/route'),
  '../admin/content/drafts/[id]/restructure/route.ts': () => import('@/app/api/admin/content/drafts/[id]/restructure/route'),
  '../admin/content/drafts/[id]/resume/route.ts': () => import('@/app/api/admin/content/drafts/[id]/resume/route'),
  '../admin/content/drafts/[id]/retry/route.ts': () => import('@/app/api/admin/content/drafts/[id]/retry/route'),
  '../admin/content/drafts/[id]/route.ts': () => import('@/app/api/admin/content/drafts/[id]/route'),
  '../admin/content/drafts/[id]/send-to-staci/route.ts': () => import('@/app/api/admin/content/drafts/[id]/send-to-staci/route'),
  '../admin/content/drafts/[id]/set-cover/route.ts': () => import('@/app/api/admin/content/drafts/[id]/set-cover/route'),
  '../admin/content/drafts/[id]/suggest-edits/route.ts': () => import('@/app/api/admin/content/drafts/[id]/suggest-edits/route'),
  '../admin/content/drafts/recompute-bucket-scores/route.ts': () => import('@/app/api/admin/content/drafts/recompute-bucket-scores/route'),
  '../admin/content/drafts/route.ts': () => import('@/app/api/admin/content/drafts/route'),
  '../admin/content/field-audit/route.ts': () => import('@/app/api/admin/content/field-audit/route'),
  '../admin/content/glossary/[id]/audit/route.ts': () => import('@/app/api/admin/content/glossary/[id]/audit/route'),
  '../admin/content/glossary/[id]/backfill/route.ts': () => import('@/app/api/admin/content/glossary/[id]/backfill/route'),
  '../admin/content/glossary/boost-underperformers/route.ts': () => import('@/app/api/admin/content/glossary/boost-underperformers/route'),
  '../admin/content/glossary/generate/route.ts': () => import('@/app/api/admin/content/glossary/generate/route'),
  '../admin/content/glossary/index-schema/route.ts': () => import('@/app/api/admin/content/glossary/index-schema/route'),
  '../admin/content/glossary/inspect/route.ts': () => import('@/app/api/admin/content/glossary/inspect/route'),
  '../admin/content/glossary/publish/route.ts': () => import('@/app/api/admin/content/glossary/publish/route'),
  '../admin/content/health/indexnow/route.ts': () => import('@/app/api/admin/content/health/indexnow/route'),
  '../admin/content/health/route.ts': () => import('@/app/api/admin/content/health/route'),
  '../admin/content/health/scan/route.ts': () => import('@/app/api/admin/content/health/scan/route'),
  '../admin/content/health/sitemap/route.ts': () => import('@/app/api/admin/content/health/sitemap/route'),
  '../admin/content/ideas/[id]/round-table/route.ts': () => import('@/app/api/admin/content/ideas/[id]/round-table/route'),
  '../admin/content/ideas/[id]/route.ts': () => import('@/app/api/admin/content/ideas/[id]/route'),
  '../admin/content/ideas/manual/route.ts': () => import('@/app/api/admin/content/ideas/manual/route'),
  '../admin/content/ideas/route.ts': () => import('@/app/api/admin/content/ideas/route'),
  '../admin/content/links/[id]/apply/route.ts': () => import('@/app/api/admin/content/links/[id]/apply/route'),
  '../admin/content/links/[id]/reject/route.ts': () => import('@/app/api/admin/content/links/[id]/reject/route'),
  '../admin/content/links/scan/route.ts': () => import('@/app/api/admin/content/links/scan/route'),
  '../admin/content/links/suggestions/route.ts': () => import('@/app/api/admin/content/links/suggestions/route'),
  '../admin/content/posts/[id]/backfill/route.ts': () => import('@/app/api/admin/content/posts/[id]/backfill/route'),
  '../admin/content/posts/[id]/schema/rebuild/route.ts': () => import('@/app/api/admin/content/posts/[id]/schema/rebuild/route'),
  '../admin/content/posts/schema/rebuild-all/route.ts': () => import('@/app/api/admin/content/posts/schema/rebuild-all/route'),
  '../admin/content/schedule/route.ts': () => import('@/app/api/admin/content/schedule/route'),
  '../admin/content/schema/unwrap-existing/route.ts': () => import('@/app/api/admin/content/schema/unwrap-existing/route'),
  '../admin/content/scorecards/refresh/route.ts': () => import('@/app/api/admin/content/scorecards/refresh/route'),
  '../admin/content/site-index/route.ts': () => import('@/app/api/admin/content/site-index/route'),
  '../admin/content/spend/route.ts': () => import('@/app/api/admin/content/spend/route'),
  '../admin/content/webflow-status/route.ts': () => import('@/app/api/admin/content/webflow-status/route'),
  '../admin/cron/affiliate-reactivation/route.ts': () => import('@/app/api/admin/cron/affiliate-reactivation/route'),
  '../admin/cron/auto-promote-calls/route.ts': () => import('@/app/api/admin/cron/auto-promote-calls/route'),
  '../admin/cron/backlink-process/route.ts': () => import('@/app/api/admin/cron/backlink-process/route'),
  '../admin/cron/content-auto-backfill/route.ts': () => import('@/app/api/admin/cron/content-auto-backfill/route'),
  '../admin/cron/content-gap-hunt/route.ts': () => import('@/app/api/admin/cron/content-gap-hunt/route'),
  '../admin/cron/daily-summary/route.ts': () => import('@/app/api/admin/cron/daily-summary/route'),
  '../admin/cron/delivery-watch/route.ts': () => import('@/app/api/admin/cron/delivery-watch/route'),
  '../admin/cron/finance-anomaly-scan/route.ts': () => import('@/app/api/admin/cron/finance-anomaly-scan/route'),
  '../admin/cron/ideation/route.ts': () => import('@/app/api/admin/cron/ideation/route'),
  '../admin/cron/indexing-reverser/route.ts': () => import('@/app/api/admin/cron/indexing-reverser/route'),
  '../admin/cron/leads-ai/route.ts': () => import('@/app/api/admin/cron/leads-ai/route'),
  '../admin/cron/link-engine-scan/route.ts': () => import('@/app/api/admin/cron/link-engine-scan/route'),
  '../admin/cron/post-scorecard-sync/route.ts': () => import('@/app/api/admin/cron/post-scorecard-sync/route'),
  '../admin/cron/pre-call-digest/route.ts': () => import('@/app/api/admin/cron/pre-call-digest/route'),
  '../admin/cron/publish-scheduled/route.ts': () => import('@/app/api/admin/cron/publish-scheduled/route'),
  '../admin/cron/round-table-advance/route.ts': () => import('@/app/api/admin/cron/round-table-advance/route'),
  '../admin/cron/schema-watchdog/route.ts': () => import('@/app/api/admin/cron/schema-watchdog/route'),
  '../admin/cron/site-index-sync/route.ts': () => import('@/app/api/admin/cron/site-index-sync/route'),
  '../admin/cron/snapshot-metrics/route.ts': () => import('@/app/api/admin/cron/snapshot-metrics/route'),
  '../admin/cron/suggestion-digest/route.ts': () => import('@/app/api/admin/cron/suggestion-digest/route'),
  '../admin/cron/sync-stripe/route.ts': () => import('@/app/api/admin/cron/sync-stripe/route'),
  '../admin/cron/sync-xero/route.ts': () => import('@/app/api/admin/cron/sync-xero/route'),
  '../admin/crons/route.ts': () => import('@/app/api/admin/crons/route'),
  '../admin/crons/suggest-from-transcripts/route.ts': () => import('@/app/api/admin/crons/suggest-from-transcripts/route'),
  '../admin/crons/sweep/route.ts': () => import('@/app/api/admin/crons/sweep/route'),
  '../admin/exchange-rates/route.ts': () => import('@/app/api/admin/exchange-rates/route'),
  '../admin/financial-reports/anomalies/route.ts': () => import('@/app/api/admin/financial-reports/anomalies/route'),
  '../admin/financial-reports/backfill-mrr/route.ts': () => import('@/app/api/admin/financial-reports/backfill-mrr/route'),
  '../admin/financial-reports/subscriptions-audit/route.ts': () => import('@/app/api/admin/financial-reports/subscriptions-audit/route'),
  '../admin/financial-reports/summary/route.ts': () => import('@/app/api/admin/financial-reports/summary/route'),
  '../admin/guide/route.ts': () => import('@/app/api/admin/guide/route'),
  '../admin/health/route.ts': () => import('@/app/api/admin/health/route'),
  '../admin/integrations/airwallex/sync/route.ts': () => import('@/app/api/admin/integrations/airwallex/sync/route'),
  '../admin/integrations/google/sync-calendar/route.ts': () => import('@/app/api/admin/integrations/google/sync-calendar/route'),
  '../admin/integrations/google/sync-drive-transcripts/route.ts': () => import('@/app/api/admin/integrations/google/sync-drive-transcripts/route'),
  '../admin/integrations/rewardful/sync/route.ts': () => import('@/app/api/admin/integrations/rewardful/sync/route'),
  '../admin/integrations/stripe/import-invoices/route.ts': () => import('@/app/api/admin/integrations/stripe/import-invoices/route'),
  '../admin/integrations/stripe/import-payments/route.ts': () => import('@/app/api/admin/integrations/stripe/import-payments/route'),
  '../admin/integrations/stripe/provision/route.ts': () => import('@/app/api/admin/integrations/stripe/provision/route'),
  '../admin/integrations/xero/import-invoices/route.ts': () => import('@/app/api/admin/integrations/xero/import-invoices/route'),
  '../admin/integrations/xero/match-contacts/route.ts': () => import('@/app/api/admin/integrations/xero/match-contacts/route'),
  '../admin/integrations/xero/sync-balances/route.ts': () => import('@/app/api/admin/integrations/xero/sync-balances/route'),
  '../admin/integrations/xero/sync-payments/route.ts': () => import('@/app/api/admin/integrations/xero/sync-payments/route'),
  '../admin/integrations/xero/sync-pnl/route.ts': () => import('@/app/api/admin/integrations/xero/sync-pnl/route'),
  '../admin/integrations/zapier/route.ts': () => import('@/app/api/admin/integrations/zapier/route'),
  '../admin/overview/brief/refresh/route.ts': () => import('@/app/api/admin/overview/brief/refresh/route'),
  '../admin/overview/brief/route.ts': () => import('@/app/api/admin/overview/brief/route'),
  '../admin/overview/me/route.ts': () => import('@/app/api/admin/overview/me/route'),
  '../admin/overview/replies-waiting/route.ts': () => import('@/app/api/admin/overview/replies-waiting/route'),
  '../admin/overview/route.ts': () => import('@/app/api/admin/overview/route'),
  '../admin/overview/wire/route.ts': () => import('@/app/api/admin/overview/wire/route'),
  '../admin/planned-roles/[id]/route.ts': () => import('@/app/api/admin/planned-roles/[id]/route'),
  '../admin/planned-roles/route.ts': () => import('@/app/api/admin/planned-roles/route'),
  '../admin/reports/ai-cost/route.ts': () => import('@/app/api/admin/reports/ai-cost/route'),
  '../admin/reports/billing-summary/route.ts': () => import('@/app/api/admin/reports/billing-summary/route'),
  '../admin/reports/cash-flow-forecast/route.ts': () => import('@/app/api/admin/reports/cash-flow-forecast/route'),
  '../admin/reports/client-profitability/route.ts': () => import('@/app/api/admin/reports/client-profitability/route'),
  '../admin/reports/invoice-aging/route.ts': () => import('@/app/api/admin/reports/invoice-aging/route'),
  '../admin/reports/response-time/route.ts': () => import('@/app/api/admin/reports/response-time/route'),
  '../admin/reports/retainer-alerts/route.ts': () => import('@/app/api/admin/reports/retainer-alerts/route'),
  '../admin/reports/retainer-health/route.ts': () => import('@/app/api/admin/reports/retainer-health/route'),
  '../admin/reports/sales/route.ts': () => import('@/app/api/admin/reports/sales/route'),
  '../admin/reports/utilization/route.ts': () => import('@/app/api/admin/reports/utilization/route'),
  '../admin/seed/route.ts': () => import('@/app/api/admin/seed/route'),
  '../admin/settings/route.ts': () => import('@/app/api/admin/settings/route'),
  '../admin/team/[id]/access/route.ts': () => import('@/app/api/admin/team/[id]/access/route'),
  '../admin/team/org-chart/route.ts': () => import('@/app/api/admin/team/org-chart/route'),
}
type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>
const CASES = FIXED.flatMap(([path, methods]) => methods.map(method => ({ path, method })))
const schemaValues: unknown[] = Object.values(schema)
const TABLES = schemaValues.filter((table): table is AnySQLiteTable => is(table, SQLiteTable))
const A = 'org-a'
const B = 'org-b'
let fixture: ReturnType<typeof permissionSqlite>

async function invoke(path: string, method: string, body?: object, query = '') {
  const loaded = await modules['../admin/' + path + '/route.ts']() as Record<string, Handler>
  const url = 'http://localhost/api/admin/' + path.replace(/\[[^/]+\]/g, B) + query
  const request = new NextRequest(url, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return loaded[method](request, { params: Promise.resolve({ id: B, runId: B }) })
}

function useUser(userId: string) {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId: 'org_tahi', sessionId: 'test' })
}
function setFeature(effect: 'allow' | 'deny', feature: string) {
  fixture.insert(schema.featureVisibility, {
    id: effect + '-' + feature, subject_type: 'team_member', subject_id: 'member', feature_key: feature, effect,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.stubEnv('TAHI_CRON_SECRET', '')
  vi.stubEnv('CRON_SECRET', '')
  fixture = permissionSqlite(TABLES, [
    'ALTER TABLE organisations ADD COLUMN custom_mrr integer',
    'ALTER TABLE organisations ADD COLUMN billing_model text',
    'ALTER TABLE organisations ADD COLUMN retainer_start_date text',
    'ALTER TABLE organisations ADD COLUMN retainer_end_date text',
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  useUser('user_member')
  for (const [name, id, user] of [
    ['project_manager', 'member', 'user_member'], ['admin', 'admin', 'user_admin'], ['super_admin', 'super', 'user_super'],
  ]) {
    fixture.insert(schema.roles, { id: 'role-' + id, name })
    fixture.insert(schema.teamMembers, { id, clerk_user_id: user, name: id, role: id === 'member' ? 'member' : 'admin', weekly_capacity_hours: 40 })
    fixture.insert(schema.teamMemberRoles, { id: 'assignment-' + id, team_member_id: id, role_id: 'role-' + id, ended_at: null })
  }
  for (const resource of ['organisations', 'requests', 'tasks', 'invoices', 'deals', 'time_entries', 'capacity', 'reports', 'settings', 'content_studio', 'financial_reports', 'billing', 'team', 'leads']) {
    fixture.insert(schema.permissions, { id: resource, resource, action: 'view' })
    fixture.insert(schema.rolePermissions, { id: resource, role_id: 'role-member', permission_id: resource })
  }
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'member', role: 'project_manager', scope_type: 'specific_clients', track_type: 'all' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: A })
  fixture.insert(schema.exchangeRates, { currency: 'NZD', rate_to_usd: 1 })
  fixture.insert(schema.pipelineStages, { id: 'open', name: 'Open', slug: 'open', position: 1, probability: 50, is_closed_won: 0, is_closed_lost: 0 })
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  for (const [org, suffix, name, hours] of [[A, 'a', 'Allowed client', 2], [B, 'b', 'ForbiddenMarker', 1000]] as const) {
    fixture.insert(schema.organisations, { id: org, name, status: 'active', preferred_currency: 'NZD', custom_mrr: 1000, billing_model: 'retainer', created_at: now })
    fixture.insert(schema.requests, { id: 'request-' + suffix, org_id: org, title: name, status: 'submitted', assignee_id: 'member', due_date: today, queue_order: 7, created_at: now, updated_at: now })
    fixture.insert(schema.tasks, { id: 'task-' + suffix, org_id: org, title: name, status: 'todo', assignee_id: 'member', assignee_type: 'team_member', due_date: today, updated_at: now })
    fixture.insert(schema.subscriptions, { id: 'sub-' + suffix, org_id: org, status: 'active', plan_type: 'maintain', current_period_start: now })
    fixture.insert(schema.tracks, { id: 'track-' + suffix, subscription_id: 'sub-' + suffix, type: 'small' })
    fixture.insert(schema.timeEntries, { id: 'time-' + suffix, org_id: org, request_id: 'request-' + suffix, team_member_id: 'member', billable: 1, hours, hourly_rate: 100, date: today })
    fixture.insert(schema.invoices, { id: 'invoice-' + suffix, org_id: org, status: 'sent', total_usd: hours * 100, currency: 'NZD', due_date: today })
    fixture.insert(schema.invoices, { id: 'paid-' + suffix, org_id: org, status: 'paid', total_usd: hours * 100, currency: 'NZD', paid_at: now })
    fixture.insert(schema.messages, { id: 'message-' + suffix, org_id: org, request_id: 'request-' + suffix, author_id: 'contact-' + suffix, author_type: 'contact', body: name, is_internal: 0, deleted_at: null, created_at: now })
    fixture.insert(schema.requestParticipants, { id: 'part-' + suffix, request_id: 'request-' + suffix, participant_id: 'member', participant_type: 'team_member', role: 'assignee', added_at: now, removed_at: null })
    fixture.insert(schema.deals, { id: 'deal-' + suffix, org_id: org, title: name, stage_id: 'open', value: hours * 100, value_nzd: hours * 100, estimated_hours_per_week: hours, expected_close_date: today })
    fixture.insert(schema.caseStudySubmissions, { id: 'review-' + suffix, org_id: org, submitted_at: now, nps_score: 8 })
  }
})
afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe('T1.6 internal route guards', () => {
  it.each(CASES)('refuses a denied scoped seat before business data: $method $path', async ({ path, method }) => {
    for (const feature of FEATURE_TREE.filter(node => node.parent === null)) setFeature('deny', feature.key)
    const response = await invoke(path, method)
    expect(response.status).toBe(403)
    expect(fixture.queries.filter(query => /(?:FROM|UPDATE|INSERT INTO|DELETE FROM) "(?:organisations|requests|tasks|invoices|content_drafts)"/i.test(query))).toEqual([])
  })

  it.each([{"path":"billing/financial-health","method":"GET"},{"path":"billing/monthly-email","method":"POST"},{"path":"billing/xero-export","method":"POST"},{"path":"cron/affiliate-reactivation","method":"POST"},{"path":"cron/auto-promote-calls","method":"POST"},{"path":"cron/backlink-process","method":"POST"},{"path":"cron/content-auto-backfill","method":"POST"},{"path":"cron/content-gap-hunt","method":"POST"},{"path":"cron/daily-summary","method":"POST"},{"path":"cron/delivery-watch","method":"POST"},{"path":"cron/finance-anomaly-scan","method":"POST"},{"path":"cron/ideation","method":"POST"},{"path":"cron/indexing-reverser","method":"POST"},{"path":"cron/leads-ai","method":"POST"},{"path":"cron/link-engine-scan","method":"POST"},{"path":"cron/post-scorecard-sync","method":"POST"},{"path":"cron/pre-call-digest","method":"POST"},{"path":"cron/publish-scheduled","method":"POST"},{"path":"cron/round-table-advance","method":"POST"},{"path":"cron/schema-watchdog","method":"POST"},{"path":"cron/site-index-sync","method":"POST"},{"path":"cron/snapshot-metrics","method":"POST"},{"path":"cron/sync-stripe","method":"POST"},{"path":"cron/sync-xero","method":"POST"},{"path":"crons","method":"GET"},{"path":"crons/suggest-from-transcripts","method":"POST"},{"path":"crons/sweep","method":"POST"},{"path":"financial-reports/anomalies","method":"GET"},{"path":"financial-reports/backfill-mrr","method":"POST"},{"path":"financial-reports/subscriptions-audit","method":"GET"},{"path":"financial-reports/summary","method":"GET"},{"path":"health","method":"GET"},{"path":"integrations/airwallex/sync","method":"POST"},{"path":"integrations/google/sync-calendar","method":"POST"},{"path":"integrations/google/sync-drive-transcripts","method":"POST"},{"path":"integrations/rewardful/sync","method":"POST"},{"path":"integrations/stripe/import-invoices","method":"POST"},{"path":"integrations/stripe/import-payments","method":"POST"},{"path":"integrations/xero/import-invoices","method":"POST"},{"path":"integrations/xero/match-contacts","method":"GET"},{"path":"integrations/xero/match-contacts","method":"PATCH"},{"path":"integrations/xero/sync-balances","method":"POST"},{"path":"integrations/xero/sync-payments","method":"POST"},{"path":"integrations/xero/sync-pnl","method":"POST"},{"path":"reports/ai-cost","method":"GET"},{"path":"reports/billing-summary","method":"GET"},{"path":"reports/cash-flow-forecast","method":"GET"},{"path":"seed","method":"POST"},{"path":"settings","method":"GET"},{"path":"settings","method":"PATCH"}])('refuses workspace-wide execution even with features granted: $method $path', async ({ path, method }) => {
    expect((await invoke(path, method)).status).toBe(403)
  })

  it.each(['user_admin', 'user_super', 'api-service'])('preserves privileged guard bypasses for %s', async userId => {
    const auth = { userId, orgId: 'org_tahi' }
    for (const feature of ['content_studio', 'capacity', 'team', 'help', 'overview', 'settings', 'settings.integrations', 'financial_reports']) {
      expect(await requireFeature(auth, feature)).toBeNull()
      expect(await requireStudioAdmin(auth, feature)).toBeNull()
    }
  })

  it('keeps verified cron secrets independent of scoped session permissions', async () => {
    vi.stubEnv('TAHI_CRON_SECRET', 'scheduler-secret')
    for (const headers of [{ 'x-cron-secret': 'scheduler-secret' }, { authorization: 'Bearer scheduler-secret' }] as ReadonlyArray<Record<string, string>>) {
      const result = await assertCronAuth(new NextRequest('http://localhost/api/admin/crons/sweep', { method: 'POST', headers }))
      expect(result).toEqual({ ok: true, userId: 'system' })
    }
    const member = await assertCronAuth(new NextRequest('http://localhost/api/admin/crons/sweep', { method: 'POST' }))
    expect(member).toEqual({ ok: true, userId: 'user_member' })
    expect(await requireManualCronAdmin(new NextRequest('http://localhost/api/admin/crons/sweep', { method: 'POST' }), 'settings')).toHaveProperty('status', 403)
  })

  it.each([
    { path: 'capacity', method: 'GET', query: '?orgId=' + B },
    { path: 'capacity', method: 'PATCH', body: { requestId: 'request-b', queueOrder: 99 } },
    { path: 'health', method: 'POST', body: { orgId: B } },
    { path: 'integrations/stripe/provision', method: 'POST', body: { orgId: B, planType: 'maintain' } },
    { path: 'integrations/stripe/provision', method: 'GET', query: '?invoiceId=invoice-b' },
    { path: 'integrations/zapier', method: 'POST', body: { action: 'create_request', orgId: B, title: 'New' } },
    { path: 'integrations/zapier', method: 'POST', body: { action: 'update_status', requestId: 'request-b', status: 'delivered' } },
    { path: 'team/[id]/access', method: 'PUT', body: { role: 'project_manager', scopeType: 'all_clients' } },
    { path: 'team/[id]/access', method: 'GET' },
  ])('blocks an out-of-scope target or permission grant with features enabled: $method $path', async ({ path, method, body, query }) => {
    const before = fixture.rows(schema.requests)
    expect((await invoke(path, method, body, query)).status).toBe(403)
    expect(fixture.rows(schema.requests)).toEqual(before)
  })

  it.each([
    'overview', 'overview/wire', 'overview/replies-waiting', 'reports/retainer-health',
    'reports/client-profitability', 'reports/invoice-aging', 'reports/sales', 'capacity/forecast',
  ])('runs SQL-scoped lists before caps: %s', async path => {
    const response = await invoke(path, 'GET')
    expect(response.status).toBe(200)
    const payload: unknown = await response.json()
    expect(JSON.stringify(payload)).not.toContain('ForbiddenMarker')
    expect(JSON.stringify(payload)).not.toContain('org-b')
    expect(JSON.stringify(payload)).not.toContain('request-b')
    expect(fixture.errors).toEqual([])
    if (path === 'overview') expect(payload).toMatchObject({ kpis: { activeClients: 1, openRequests: 1, inProgress: 0 }, recentRequests: [{ id: 'request-a' }] })
    if (path === 'overview/replies-waiting') expect(payload).toMatchObject({ threads: [{ id: 'request-a' }] })
    if (path === 'reports/retainer-health' || path === 'reports/client-profitability') expect(payload).toMatchObject({ clients: [{ orgId: A }] })
  })

  it('removes withdrawn client scope from personal tasks, requests, replies and wire events', async () => {
    const response = await invoke('overview/me', 'GET')
    expect(await response.json()).toMatchObject({ openWork: 2, dueToday: 2, repliesWaiting: 1 })
    const wire = await invoke('overview/wire', 'GET', undefined, '?scope=me')
    const payload: unknown = await wire.json()
    expect(JSON.stringify(payload)).not.toContain('ForbiddenMarker')
    expect(JSON.stringify(payload)).not.toContain('part-b')
    expect(fixture.errors).toEqual([])
  })

  it('scopes operational aggregates and automated health writes to allowed clients', async () => {
    const utilization = await invoke('reports/utilization', 'GET')
    expect(await utilization.json()).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ id: 'member', billableHours: 2 })]) })
    const replies = await invoke('reports/response-time', 'GET')
    expect(replies.status).toBe(200)
    const start = await invoke('capacity/start-date', 'POST', { estimatedHoursPerWeek: 1 })
    expect(await start.json()).toMatchObject({ committedHours: 8 })
    const health = await invoke('health', 'POST', {})
    expect(await health.json()).toEqual({ updated: 1 })
    const outside = fixture.rows(schema.organisations).find(row => row.id === B)
    expect(outside?.health_status).toBeNull()
    const alerts = await invoke('reports/retainer-alerts', 'POST', {})
    expect(alerts.status).toBe(200)
    expect(JSON.stringify(await alerts.json())).not.toContain('org-b')
    expect(fixture.errors).toEqual([])
  })
  it('filters clients before the overview row cap', async () => {
    for (let index = 0; index < 12; index++) fixture.insert(schema.requests, {
      id: 'hidden-' + index, org_id: B, title: 'ForbiddenMarker', status: 'submitted', updated_at: '2020-01-01',
    })
    const response = await invoke('overview', 'GET')
    expect(await response.json()).toMatchObject({ recentRequests: [{ id: 'request-a' }] })
  })

  it.each(['user_admin', 'user_super', 'api-service'])('keeps all clients visible in the overview for %s', async userId => {
    useUser(userId)
    const response = await invoke('overview', 'GET')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ kpis: { activeClients: 2, openRequests: 2 }, recentRequests: expect.arrayContaining([
      expect.objectContaining({ id: 'request-a' }), expect.objectContaining({ id: 'request-b' }),
    ]) })
  })

  it('uses the authenticated caller for scoping even when a recorded actor is privileged', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'test',
      mcpActor: { teamMemberId: 'super', clerkUserId: 'user_super', profile: 'full' },
    })
    expect((await invoke('capacity', 'GET', undefined, '?orgId=' + B)).status).toBe(403)
    expect((await invoke('settings', 'GET')).status).toBe(403)
  })

  it('returns no org-owned work after every client grant is removed', async () => {
    fixture.sqlite.exec('DELETE FROM team_member_access_orgs; DELETE FROM team_member_access')
    expect(await (await invoke('overview', 'GET')).json()).toMatchObject({ kpis: { activeClients: 0, openRequests: 0 }, recentRequests: [] })
    expect(await (await invoke('overview/me', 'GET')).json()).toMatchObject({ openWork: 0, dueToday: 0, repliesWaiting: 0 })
    expect(await (await invoke('overview/replies-waiting', 'GET')).json()).toEqual({ threads: [] })
    expect(await (await invoke('reports/retainer-health', 'GET')).json()).toEqual({ clients: [] })
    expect(await (await invoke('health', 'POST', {})).json()).toEqual({ updated: 0 })
  })

  it.each([30, 120])('composes four fences without multiplying D1 binds for a %i-client scope', async size => {
    const scope = { kind: 'some' as const, orgIds: [A, ...Array.from({ length: size - 1 }, (_, index) => 'client-' + index)] }
    const query = fixture.database.select({ id: schema.organisations.id }).from(schema.organisations)
      .where(and(...Array.from({ length: 4 }, () => internalOrgFilter(scope, schema.organisations.id))))
    expect(query.toSQL().params).toHaveLength(0)
    expect(await query).toEqual([{ id: A }])
  })

  it('rejects unsafe IDs before building scope literals, including null-owned rows', async () => {
    const malicious = ["org-b') OR 1 = 1 --", 'bad id', 'x'.repeat(65)]
    const predicate = internalOrgFilter({ kind: 'some', orgIds: [A, ...malicious] }, schema.organisations.id)
    const query = fixture.database.select({ id: schema.organisations.id }).from(schema.organisations).where(predicate)
    expect(query.toSQL().sql).not.toContain('OR 1 = 1')
    expect(query.toSQL().params).toHaveLength(0)
    expect(await query).toEqual([{ id: A }])
    fixture.insert(schema.tasks, { id: 'internal-task', org_id: null, title: 'Internal task' })
    const rejected = internalOrgFilter({ kind: 'some', orgIds: malicious }, schema.tasks.orgId, true)
    expect(await fixture.database.select().from(schema.tasks).where(rejected)).toEqual([])
  })

  it('checks both message ownership and linked request ownership before counts and row caps', async () => {
    const later = new Date(Date.now() + 60_000).toISOString()
    fixture.insert(schema.messages, {
      id: 'foreign-message-on-allowed-request', org_id: B, request_id: 'request-a',
      author_id: 'foreign', author_type: 'team_member', body: 'ForbiddenMarker', is_internal: 0, created_at: later,
    })
    fixture.insert(schema.messages, {
      id: 'allowed-message-on-foreign-request', org_id: A, request_id: 'request-b',
      author_id: 'foreign', author_type: 'contact', body: 'ForbiddenMarker', is_internal: 0, created_at: later,
    })
    const overview = await invoke('overview', 'GET')
    expect(await overview.json()).toMatchObject({ overnight: { clientReplies: 1 } })
    const me = await invoke('overview/me', 'GET')
    expect(await me.json()).toMatchObject({ repliesWaiting: 1 })
    const replies = await invoke('overview/replies-waiting', 'GET')
    const payload: unknown = await replies.json()
    expect(payload).toMatchObject({ threads: [{ id: 'request-a', lastSnippet: 'Allowed client' }] })
    expect(JSON.stringify(payload)).not.toContain('ForbiddenMarker')
    const wire = await invoke('overview/wire', 'GET', undefined, '?scope=me')
    const events: unknown = await wire.json()
    expect(JSON.stringify(events)).not.toContain('foreign-message-on-allowed-request')
    expect(JSON.stringify(events)).not.toContain('allowed-message-on-foreign-request')
    expect(fixture.errors).toEqual([])
  })

  it.each([
    { orgId: A, requestId: 'request-b', taskId: null },
    { orgId: B, requestId: 'request-a', taskId: null },
    { orgId: A, requestId: null, taskId: 'task-b' },
    { orgId: B, requestId: null, taskId: 'task-a' },
  ])('hides a caller-owned timer whose org or linked target is outside current client scope: $orgId $requestId $taskId', async ({ orgId, requestId, taskId }) => {
    fixture.insert(schema.activeTimers, {
      id: 'timer', user_id: 'user_member', org_id: orgId, request_id: requestId, task_id: taskId,
      started_at: new Date().toISOString(), paused_seconds: 0,
    })
    expect(await (await invoke('overview/me', 'GET')).json()).toMatchObject({ timer: null })
    expect(await (await invoke('overview', 'GET')).json()).toMatchObject({ activeTimer: { running: false, label: null } })
    expect(fixture.errors).toEqual([])
  })

})


