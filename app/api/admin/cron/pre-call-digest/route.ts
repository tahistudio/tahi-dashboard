/**
 * POST /api/admin/cron/pre-call-digest
 *
 * Fires once every ~5 minutes from a scheduled trigger. Finds
 * discovery_calls that:
 *   - Have status='scheduled'
 *   - Have scheduledAt in the next 25-35 min window
 *   - Haven't already been sent a pre-call digest (checked via
 *     activities row of type 'call_digest_sent')
 *
 * For each: composes a pre-call brief email (lead context, AI score,
 * AI briefing, discovery questions, sources, Meet link, etc.) and
 * sends to a single recipient (default: business@tahi.studio,
 * overridable via settings 'calls.preCallDigestEmail').
 *
 * Idempotency: stamps an activity row after each send so the cron is
 * safe to re-run at any cadence.
 *
 * Auth:
 *   - Tahi admin via session, OR
 *   - Bearer CRON_SECRET for unattended schedule pings
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { render } from '@react-email/render'
import { Resend } from 'resend'
import { PreCallDigestEmail, type PreCallDigestEmailProps } from '@/emails/pre-call-digest'
import { publicUrl } from '@/lib/app-url'

export const dynamic = 'force-dynamic'

// Send between 25 and 35 minutes before the call — gives the cron
// breathing room to fire every 5 min without missing a slot.
const WINDOW_START_MIN = 25
const WINDOW_END_MIN = 35

interface AttendeeLite {
  name?: string
  email?: string
}

export async function POST(req: NextRequest) {
  // Auth: admin OR cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && authHeader === `Bearer ${cronSecret}`
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }

  const database = await db()

  // Resolve recipient: settings override → default
  const [recipientSetting] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'calls.preCallDigestEmail'))
    .limit(1)
  const recipient = recipientSetting?.value?.trim() || 'business@tahi.studio'

  // Find calls in the window
  const now = Date.now()
  const windowStart = new Date(now + WINDOW_START_MIN * 60_000).toISOString()
  const windowEnd = new Date(now + WINDOW_END_MIN * 60_000).toISOString()

  const candidates = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      durationMinutes: schema.discoveryCalls.durationMinutes,
      googleMeetUrl: schema.discoveryCalls.googleMeetUrl,
      attendees: schema.discoveryCalls.attendees,
      status: schema.discoveryCalls.status,
      leadId: schema.discoveryCalls.leadId,
      dealId: schema.discoveryCalls.dealId,
      requestId: schema.discoveryCalls.requestId,
      taskId: schema.discoveryCalls.taskId,
      orgId: schema.discoveryCalls.orgId,
    })
    .from(schema.discoveryCalls)
    .where(and(
      eq(schema.discoveryCalls.status, 'scheduled'),
      gte(schema.discoveryCalls.scheduledAt, windowStart),
      lte(schema.discoveryCalls.scheduledAt, windowEnd),
    ))

  // Deduplicate against already-sent digests (activity row with
  // type='call_digest_sent' and description containing the call id).
  const alreadySent = candidates.length > 0
    ? await database
        .select({ description: schema.activities.description })
        .from(schema.activities)
        .where(and(
          eq(schema.activities.type, 'call_digest_sent'),
          sql`${schema.activities.createdAt} > datetime('now', '-2 hours')`,
        ))
    : []
  const sentCallIds = new Set(
    alreadySent
      .map(a => a.description?.match(/call:([0-9a-f-]{36})/i)?.[1])
      .filter((x): x is string => !!x)
  )

  const toProcess = candidates.filter(c => !sentCallIds.has(c.id))

  const resend = new Resend(apiKey)
  const results: Array<{ callId: string; status: 'sent' | 'skipped' | 'failed'; detail?: string }> = []

  for (const call of toProcess) {
    try {
      // Resolve lead context (if leadId set)
      let lead: typeof schema.leads.$inferSelect | null = null
      if (call.leadId) {
        const [row] = await database
          .select()
          .from(schema.leads)
          .where(eq(schema.leads.id, call.leadId))
          .limit(1)
        lead = row ?? null
      }

      // Resolve "with whom" — prefer attendees JSON, fall back to lead
      let withName = call.title
      let withSubtitle: string | null = null
      try {
        const att = JSON.parse(call.attendees) as AttendeeLite[]
        const guest = att.find(a => a.email && !a.email.includes('tahi.studio'))
        if (guest?.name || guest?.email) {
          withName = guest.name ?? guest.email ?? withName
        }
      } catch { /* ignore */ }
      if (lead) {
        withName = lead.name
        withSubtitle = lead.company ?? lead.jobTitle ?? null
      }

      // Resolve parent href
      let parentHref = '/calls'
      if (call.leadId) parentHref = `/leads/${call.leadId}`
      else if (call.dealId) parentHref = `/deals?deal=${call.dealId}`
      else if (call.orgId) parentHref = `/clients/${call.orgId}`
      else if (call.requestId) parentHref = `/requests/${call.requestId}`

      // Parse AI summary (snapshot/fit/watchOuts JSON when available)
      let aiSnapshot: string | null = null
      let aiFit: string | null = null
      let aiWatchOuts: string | null = null
      if (lead?.aiSummary) {
        try {
          const parsed = JSON.parse(lead.aiSummary)
          if (parsed && typeof parsed === 'object') {
            aiSnapshot = parsed.snapshot ?? null
            aiFit = parsed.fit ?? null
            aiWatchOuts = parsed.watchOuts ?? null
          }
        } catch {
          // Plain-text summary fallback
          aiSnapshot = lead.aiSummary.slice(0, 400)
        }
      }

      // Discovery questions — always-ask template + lead-specific
      const [tplRow] = await database
        .select({ value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.key, 'leads.discoveryQuestionsTemplate'))
        .limit(1)
      let questions: string[] = []
      if (tplRow?.value) {
        try {
          const tpl = JSON.parse(tplRow.value)
          if (Array.isArray(tpl)) questions.push(...tpl.filter((q): q is string => typeof q === 'string'))
        } catch { /* ignore */ }
      }
      if (lead?.aiQuestions) {
        try {
          const raw = JSON.parse(lead.aiQuestions)
          if (Array.isArray(raw)) {
            for (const q of raw) {
              if (typeof q === 'string') questions.push(q)
              else if (q && typeof q.text === 'string') questions.push(q.text)
            }
          }
        } catch { /* ignore */ }
      }
      questions = questions.slice(0, 8)

      // Sources
      let sources: string[] = []
      if (lead?.aiSources) {
        try {
          const raw = JSON.parse(lead.aiSources)
          if (Array.isArray(raw)) sources = raw.filter((s): s is string => typeof s === 'string').slice(0, 3)
        } catch { /* ignore */ }
      }

      // Tech stack
      let techStack: string[] = []
      if (lead?.techStack) {
        try {
          const raw = JSON.parse(lead.techStack)
          if (Array.isArray(raw)) techStack = raw.filter((s): s is string => typeof s === 'string')
        } catch { /* ignore */ }
      }

      const dashboardUrl = publicUrl('').replace(/\/$/, '')
      const props: PreCallDigestEmailProps = {
        callTitle: call.title,
        scheduledAt: call.scheduledAt,
        meetingUrl: call.googleMeetUrl,
        durationMinutes: call.durationMinutes,
        withName,
        withSubtitle,
        parentHref,
        dashboardUrl,
        leadEmail: lead?.email,
        leadCompany: lead?.company,
        industry: lead?.industry,
        employeeCount: lead?.employeeCount,
        revenueBand: lead?.revenueBand,
        cms: lead?.cms,
        techStack,
        country: lead?.country,
        aiScore: lead?.aiScore,
        aiScoreReason: lead?.aiScoreReason,
        aiSnapshot,
        aiFit,
        aiWatchOuts,
        questions,
        sources,
      }

      const html = await render(PreCallDigestEmail(props))
      const subject = `Pre-call: ${withName} in ~30 min`

      await resend.emails.send({
        from: 'Tahi Studio <notifications@tahi.studio>',
        to: [recipient],
        subject,
        html,
      })

      // Stamp activity for idempotency (description carries the call
      // id so the cron's dedup check works on the next tick).
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'call_digest_sent',
        title: `Pre-call digest sent: ${withName}`,
        description: `call:${call.id}`,
        leadId: call.leadId,
        dealId: call.dealId,
        createdById: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      results.push({ callId: call.id, status: 'sent' })
    } catch (err) {
      results.push({
        callId: call.id,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    windowStart,
    windowEnd,
    candidates: candidates.length,
    alreadySent: candidates.length - toProcess.length,
    processed: results.length,
    results,
  })
}
