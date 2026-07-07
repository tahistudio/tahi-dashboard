/**
 * GET /api/admin/crons
 *
 * Lists every scheduled job + its most recent run from cron_runs. Used by
 * /settings/automations to give visibility into "is this thing alive."
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface CronDef {
  cron: string                    // matches cron_runs.cron
  label: string
  description: string
  endpoint: string                // POST URL to trigger manually
  schedule: string                // human-readable cadence
}

const CRONS: CronDef[] = [
  {
    cron: 'pre-call-digest',
    label: 'Pre-call digest',
    description: 'Emails business@tahi.studio 25-35 min before each discovery call with lead context, score and questions.',
    endpoint: '/api/admin/cron/pre-call-digest',
    schedule: 'Every 5 min',
  },
  {
    cron: 'auto-promote-calls',
    label: 'Auto-promote calls to deals',
    description: 'When a call outcome is set to "promote", auto-creates a deal and stamps the activity.',
    endpoint: '/api/admin/cron/auto-promote-calls',
    schedule: 'Every 10 min',
  },
  {
    cron: 'affiliate-reactivation',
    label: 'Affiliate reactivation',
    description: 'Notifies you about affiliate codes idle 60+ days so you can re-engage them.',
    endpoint: '/api/admin/cron/affiliate-reactivation',
    schedule: 'Daily',
  },
  {
    cron: 'daily-summary',
    label: 'Daily activity summary',
    description: 'Morning digest of yesterday + today: leads, calls, replies, anything noteworthy.',
    endpoint: '/api/admin/cron/daily-summary',
    schedule: 'Daily (07:00 NZT)',
  },
  {
    cron: 'leads-ai',
    label: 'Lead scoring + auto-enrichment',
    description: 'Re-scores active leads with the ICP rubric. Anything scoring ≥60 gets queued for Sonnet enrichment.',
    endpoint: '/api/admin/cron/leads-ai',
    schedule: 'Every 30 min',
  },
  {
    cron: 'sync-calendar',
    label: 'Calendar auto-pull',
    description: 'Pulls upcoming Google Meet calls into discovery_calls and classifies each (discovery / client / partnership / unclassified).',
    endpoint: '/api/admin/integrations/google/sync-calendar',
    schedule: 'Every 15 min',
  },
  {
    cron: 'sync-drive-transcripts',
    label: 'Gemini transcript pull',
    description: 'Scans Drive for "Notes by Gemini" docs, matches them to calls by time + attendee, writes transcript + summary.',
    endpoint: '/api/admin/integrations/google/sync-drive-transcripts',
    schedule: 'Every 30 min',
  },
  {
    cron: 'sync-airwallex',
    label: 'Airwallex bank sync',
    description: 'Pulls current account balances + the last 30 days of transactions from Airwallex. Powers the disposable-cash strip + reconciliation on /financial-reports.',
    endpoint: '/api/admin/integrations/airwallex/sync',
    schedule: 'Daily 06:00 NZT',
  },
  {
    cron: 'finance-anomaly-scan',
    label: 'Finance anomaly scan (AI)',
    description: 'Sonnet walks bank balances + commitments + AR + pipeline + MRR and surfaces 0-8 anomalies worth a look. Findings drop into Notifications as finance_anomaly events, deduped across 30-day windows.',
    endpoint: '/api/admin/cron/finance-anomaly-scan',
    schedule: 'Weekly Mon 07:00 NZT + Monthly 1st',
  },
  {
    cron: 'ideation',
    label: 'Content ideation',
    description: 'Pulls GA4 + GSC + sitemap signals, asks Sonnet for 6-8 content ideas, drops them into /content-studio Ideas tab for triage. Disabled by default — toggle on in Settings → Content engine signals.',
    endpoint: '/api/admin/cron/ideation',
    schedule: 'Weekly Mon 08:00 UK (disabled by default)',
  },
  {
    cron: 'draft-approved-ideas',
    label: 'Content drafting',
    description: 'Picks up approved content ideas without a draft and runs the multi-agent drafting pipeline (researcher, writer, sales + readability reviewers, EIC). Disabled by default — flip content.draftingEnabled to true in settings once you trust the loop. Max 1-3 drafts per tick to keep token spend predictable.',
    endpoint: '/api/admin/cron/draft-approved-ideas',
    schedule: 'Hourly (disabled by default)',
  },
  {
    cron: 'link-engine-scan',
    label: 'Internal link engine',
    description: 'Scans every blog post published in the last 14 days, finds phrases in older posts where an inbound link to the fresh post would land naturally, drops the patches into /content-studio Links tab for Liam to approve. Disabled by default — toggle on via content.linkEngineEnabled setting.',
    endpoint: '/api/admin/cron/link-engine-scan',
    schedule: 'Weekly Mon 09:00 UK (disabled by default)',
  },
  {
    cron: 'delivery-watch',
    label: 'Delivery off-track watch',
    description: 'Scans active engagements (schedules with linked requests/tasks) and notifies the owner when a client\'s delivery rollup is blocked / delayed / at risk. One ping per off-track client per 23h.',
    endpoint: '/api/admin/cron/delivery-watch',
    schedule: 'Daily (or every few hours)',
  },
  {
    cron: 'round-table-advance',
    label: 'Round table orchestrator',
    description: 'Hand-cranks the round-table drafting pipeline forward by one stage per draft (oldest first, up to 3 drafts per tick). Picks up any draft in a non-terminal status (queued, researching, strategising, headline_lab, drafting, reviewing, editing, signing_off, covering). Drafts continue until ready_for_publish, failed, or cost_capped. Safe to run frequently — each stage has its own cost cap check.',
    endpoint: '/api/admin/cron/round-table-advance',
    schedule: 'Every 5 min (disabled by default)',
  },
]

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings')
  if (denied) return denied

  const database = await db() as unknown as D1

  // Fetch the latest 10 runs per cron — small, single query per cron.
  // Could be one window-function query but D1 doesn't love window funcs,
  // so we run a tight loop.
  const items = await Promise.all(CRONS.map(async (cron) => {
    const runs = await database
      .select({
        id: schema.cronRuns.id,
        status: schema.cronRuns.status,
        durationMs: schema.cronRuns.durationMs,
        summary: schema.cronRuns.summary,
        error: schema.cronRuns.error,
        ranAt: schema.cronRuns.ranAt,
      })
      .from(schema.cronRuns)
      .where(eq(schema.cronRuns.cron, cron.cron))
      .orderBy(desc(schema.cronRuns.ranAt))
      .limit(10)

    return {
      ...cron,
      lastRun: runs[0] ?? null,
      recentRuns: runs,
    }
  }))

  return NextResponse.json({ items })
}
