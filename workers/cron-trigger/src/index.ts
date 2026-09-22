/**
 * Fires the dashboard's recurring cron endpoints on a schedule.
 *
 * This replaces the `schedule:` block that used to live in
 * .github/workflows/dashboard-crons.yml. GitHub Actions scheduled
 * workflows are measured to drop 2 to 5 runs an hour against 12 or more
 * configured schedules, which silently starved several dashboard crons.
 * Cloudflare Cron Triggers fire reliably, so the schedule now lives here;
 * the GitHub workflow keeps only its manual workflow_dispatch path.
 *
 * Every dashboard cron endpoint is idempotent and short-circuits when
 * there is nothing to do, so a duplicate or slightly late fire is safe.
 */
import { cronToTargets, targetToPath } from './schedule'

interface Env {
  DASHBOARD_URL?: string
  TAHI_CRON_SECRET?: string
}

const FETCH_TIMEOUT_MS = 120_000

async function fireTarget(baseUrl: string, secret: string, target: string): Promise<void> {
  const path = targetToPath[target] ?? `cron/${target}`
  const url = `${baseUrl}/api/admin/${path}`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-cron-secret': secret,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (response.status < 200 || response.status >= 300) {
      console.error(`cron target "${target}" POST ${url} returned ${response.status}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`cron target "${target}" POST ${url} failed: ${message}`)
  }
}

async function runSchedule(cron: string, env: Env): Promise<void> {
  const targets = cronToTargets[cron]
  if (!targets || targets.length === 0) {
    console.error(`cron trigger fired with an unmapped schedule: "${cron}"`)
    return
  }
  const dashboardUrl = env.DASHBOARD_URL
  const secret = env.TAHI_CRON_SECRET
  if (!dashboardUrl || !secret) {
    console.error('cron trigger is missing DASHBOARD_URL or TAHI_CRON_SECRET')
    return
  }
  const base = dashboardUrl.replace(/\/+$/, '')
  // Sequential, in the order listed for this schedule, so overlapping
  // targets (e.g. the morning briefing slot) fire in a stable order.
  for (const target of targets) {
    await fireTarget(base, secret, target)
  }
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSchedule(event.cron, env))
  },

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, crons: Object.keys(cronToTargets).length })
    }
    return new Response('Not found', { status: 404 })
  },
}
