/**
 * POST /api/admin/cron/auto-promote-calls
 *
 * Scans completed discovery_calls where the outcome was tagged
 * 'promote' (either manually or via Sonnet extract apply) and
 * auto-promotes the linked lead to a deal — if the lead isn't
 * already promoted.
 *
 * Idempotent: skips leads with promotedDealId already set, and
 * stamps an activity row so the cron doesn't re-fire on already-
 * processed calls.
 *
 * Auth:
 *   - Tahi admin session, OR
 *   - Bearer CRON_SECRET for scheduled pings
 *
 * Settings:
 *   leads.autoPromoteFromCalls (bool, default true) master toggle
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface ProcessResult {
  callId: string
  leadId: string
  status: 'promoted' | 'skipped' | 'failed'
  dealId?: string
  detail?: string
}

export async function POST(req: NextRequest) {
  // Auth: admin OR cron secret (x-cron-secret header or Bearer auth).
  // TAHI_CRON_SECRET first, falls back to CRON_SECRET for env-var parity.
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const database = await db()

  // Master toggle (defaults ON)
  const [toggleRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.autoPromoteFromCalls'))
    .limit(1)
  const enabled = toggleRow?.value !== 'false'
  if (!enabled) {
    return NextResponse.json({ skipped: 'leads.autoPromoteFromCalls is disabled in settings' })
  }

  // Candidate calls: outcome='promote', has a leadId, not already
  // auto-processed (no activity row of type 'auto_promoted_from_call'
  // with description containing the call id).
  const candidates = await database
    .select({
      id: schema.discoveryCalls.id,
      leadId: schema.discoveryCalls.leadId,
      title: schema.discoveryCalls.title,
      summary: schema.discoveryCalls.summary,
      outcomeNotes: schema.discoveryCalls.outcomeNotes,
      scopeNotes: schema.discoveryCalls.scopeNotes,
      budgetMin: schema.discoveryCalls.budgetMin,
      budgetMax: schema.discoveryCalls.budgetMax,
      budgetCurrency: schema.discoveryCalls.budgetCurrency,
    })
    .from(schema.discoveryCalls)
    .where(and(
      eq(schema.discoveryCalls.outcome, 'promote'),
      isNotNull(schema.discoveryCalls.leadId),
    ))

  if (candidates.length === 0) {
    return NextResponse.json({ scanned: 0, promoted: 0, results: [] })
  }

  // Dedup against already-processed calls
  const recent = await database
    .select({ description: schema.activities.description })
    .from(schema.activities)
    .where(and(
      eq(schema.activities.type, 'auto_promoted_from_call'),
      sql`${schema.activities.createdAt} > datetime('now', '-30 days')`,
    ))
  const processedCallIds = new Set(
    recent
      .map(a => a.description?.match(/call:([0-9a-f-]{36})/i)?.[1])
      .filter((x): x is string => !!x)
  )
  const toProcess = candidates.filter(c => !processedCallIds.has(c.id))

  const results: ProcessResult[] = []
  let promoted = 0

  for (const call of toProcess) {
    if (!call.leadId) continue

    // Check lead isn't already promoted
    const [lead] = await database
      .select({
        id: schema.leads.id,
        name: schema.leads.name,
        company: schema.leads.company,
        promotedDealId: schema.leads.promotedDealId,
        status: schema.leads.status,
      })
      .from(schema.leads)
      .where(eq(schema.leads.id, call.leadId))
      .limit(1)

    if (!lead) {
      results.push({ callId: call.id, leadId: call.leadId, status: 'skipped', detail: 'Lead not found' })
      continue
    }
    if (lead.promotedDealId || lead.status === 'promoted') {
      results.push({ callId: call.id, leadId: call.leadId, status: 'skipped', detail: `Already promoted to ${lead.promotedDealId}` })
      continue
    }

    // Call the promote endpoint internally. Passes createOrg=true so
    // a fresh organisation is created if none exists yet, plus seeds
    // the deal value from the call's budget signal when present.
    try {
      const initialValue = call.budgetMax ?? call.budgetMin ?? null
      const promoteBody: Record<string, unknown> = {
        createOrg: true,
        sourceCallId: call.id,
      }
      if (initialValue && initialValue > 0) {
        // Treat budget as one-off upfront unless the lead's brief
        // suggested retainer — conservative default.
        promoteBody.upfrontValue = initialValue
        if (call.budgetCurrency) promoteBody.currency = call.budgetCurrency
      }
      if (call.scopeNotes || call.summary) {
        // Seed the deal notes with the call's scope notes + summary.
        promoteBody.notes = [call.summary, call.scopeNotes].filter(Boolean).join('\n\n')
      }

      const res = await fetch(
        new URL(`/api/admin/leads/${call.leadId}/promote`, req.url).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
            Cookie: req.headers.get('cookie') ?? '',
          },
          body: JSON.stringify(promoteBody),
        },
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        results.push({
          callId: call.id,
          leadId: call.leadId,
          status: 'failed',
          detail: err.error ?? `HTTP ${res.status}`,
        })
        continue
      }
      const data = await res.json() as { dealId?: string }
      const dealId = data.dealId ?? null

      // Stamp activity for dedup + audit
      const now = new Date().toISOString()
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'auto_promoted_from_call',
        title: `Auto-promoted ${lead.name} from call outcome`,
        description: `call:${call.id}${dealId ? ` deal:${dealId}` : ''}${initialValue ? ` value:${initialValue} ${call.budgetCurrency ?? 'NZD'}` : ''}`,
        leadId: call.leadId,
        dealId,
        createdById: 'system',
        createdAt: now,
        updatedAt: now,
      })

      promoted++
      results.push({
        callId: call.id,
        leadId: call.leadId,
        status: 'promoted',
        dealId: dealId ?? undefined,
        detail: initialValue ? `Seeded with ${initialValue} ${call.budgetCurrency ?? 'NZD'} from call budget` : undefined,
      })
    } catch (err) {
      results.push({
        callId: call.id,
        leadId: call.leadId,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    scanned: candidates.length,
    alreadyProcessed: candidates.length - toProcess.length,
    promoted,
    results,
  })
  void isNull
  void ne
}
