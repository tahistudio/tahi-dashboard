/**
 * Pure mapping tables for the cron trigger worker.
 *
 * These mirror the case statements that used to live in
 * .github/workflows/dashboard-crons.yml (the "Pick endpoint(s) based on
 * schedule" step and the target-to-URL switch inside "Call the dashboard
 * cron endpoint(s)"). Kept in their own module, with no Cloudflare Workers
 * types, so app/api/__tests__/cron-trigger-schedule.test.ts can import them
 * directly even though workers/** is excluded from the app's Vitest run.
 */

// Cloudflare cron trigger string -> the dashboard cron target(s) that fire
// on that schedule. Mirrors dashboard-crons.yml lines 141-159. Multiple
// cron strings can point at overlapping target lists (e.g. the two morning
// briefing slots), and that is intentional: each schedule tick maps to its
// own row here, exactly like the old case statement.
export const cronToTargets: Record<string, string[]> = {
  '2,17,32,47 * * * *': ['sync-calendar'],
  '7,37 * * * *': ['sync-drive-transcripts'],
  '12,42 * * * *': ['suggest-from-transcripts'],
  '*/10 * * * *': ['pre-call-digest'],
  '5,20,35,50 * * * *': ['auto-promote-calls'],
  '0 17 * * *': ['leads-ai'],
  '0 15 * * *': ['sync-xero', 'sync-stripe'],
  '0 19 * * *': ['daily-summary', 'ai-briefing', 'overview-brief'],
  '0 20 * * *': ['daily-summary', 'ai-briefing', 'overview-brief'],
  '0 19 * * MON': ['affiliate-reactivation'],
  '0 18 * * *': ['sync-airwallex', 'snapshot-metrics'],
  '0 21 * * MON': ['finance-anomaly-scan'],
  '0 21 1 * *': ['finance-anomaly-scan'],
  '0 22 * * SUN': ['content-auto-backfill'],
  '30 19 * * SUN': ['content-gap-hunt'],
  '0 23 * * SUN': ['schema-watchdog'],
  '0 20 * * SUN': ['indexing-reverser'],
  '3,18,33,48 * * * *': ['publish-scheduled'],
}

// Targets whose URL doesn't follow the default /api/admin/cron/<target>
// shape. Mirrors dashboard-crons.yml lines 190-199.
const SPECIAL_TARGET_PATHS: Record<string, string> = {
  'sync-calendar': 'integrations/google/sync-calendar',
  'sync-drive-transcripts': 'integrations/google/sync-drive-transcripts',
  // The suggester sits under /crons/ (plural), not /cron/, per the CN.1
  // build contract. Named explicitly so the default case below cannot
  // quietly 404 it.
  'suggest-from-transcripts': 'crons/suggest-from-transcripts',
  'sync-airwallex': 'integrations/airwallex/sync',
  'ai-briefing': 'ai/briefing/cron',
  'overview-brief': 'overview/brief/refresh',
}

function buildTargetToPath(): Record<string, string> {
  const targets = new Set<string>()
  for (const values of Object.values(cronToTargets)) {
    for (const target of values) targets.add(target)
  }
  const result: Record<string, string> = {}
  for (const target of targets) {
    result[target] = SPECIAL_TARGET_PATHS[target] ?? `cron/${target}`
  }
  return result
}

// Dashboard cron target -> the path under /api/admin/ that fires it.
// Every target reachable from cronToTargets is present here; anything not
// listed in SPECIAL_TARGET_PATHS falls back to cron/<target>.
export const targetToPath: Record<string, string> = buildTargetToPath()
