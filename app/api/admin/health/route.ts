import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// -- GET /api/admin/health — diagnostic endpoint (no auth needed) -----------
export async function GET() {
  const checks: Record<string, string> = {}
  checks.js = 'ok'
  checks.timestamp = new Date().toISOString()

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    checks.cfContext = env ? 'ok' : 'env is falsy'
    checks.envKeys = Object.keys(env ?? {}).join(', ')

    if (env?.DB) {
      checks.d1Binding = 'present'
      try {
        const r = await (env.DB as D1Database).prepare('SELECT 1 as t').first()
        checks.d1Query = r ? 'ok' : 'null'
      } catch (e) { checks.d1Query = `err: ${e instanceof Error ? e.message : e}` }

      try {
        const r = await (env.DB as D1Database).prepare('SELECT COUNT(*) as c FROM organisations').first()
        checks.orgCount = JSON.stringify(r)
      } catch (e) { checks.orgCount = `err: ${e instanceof Error ? e.message : e}` }

      try {
        const r = await (env.DB as D1Database).prepare('PRAGMA table_info(organisations)').all()
        const cols = (r.results ?? []).map((c: Record<string, unknown>) => c.name)
        checks.orgColumns = cols.join(', ')
      } catch (e) { checks.orgColumns = `err: ${e instanceof Error ? e.message : e}` }
    } else {
      checks.d1Binding = 'MISSING'
    }

    try {
      const database = await db()
      checks.dbHelper = database ? 'ok' : 'falsy'
    } catch (e) { checks.dbHelper = `err: ${e instanceof Error ? e.message : e}` }

  } catch (e) {
    checks.cfContext = `err: ${e instanceof Error ? e.message : e}`
  }

  return NextResponse.json(checks)
}

// -- POST /api/admin/health ---------------------------------------------------
// Recalculates health scores for all orgs (or a specific orgId).
// Body: { orgId?: string }
// Scoring (0-100):
//   +20 Has active requests
//   +20 Last request within 30 days
//   +20 No overdue invoices
//   +20 Recent activity (requests or messages in last 14 days)
//   +20 Has at least one contact with email
// Maps to: healthy (70+), at_risk (40-69), critical (<40)
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { orgId?: string }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Get all active orgs or a specific one
  let orgs
  if (body.orgId) {
    orgs = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, body.orgId))
  } else {
    orgs = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.status, 'active'))
  }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

  let updated = 0

  for (const org of orgs) {
    let score = 0

    // 1. Has active requests? (+20)
    const activeRequests = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, org.id),
        sql`${schema.requests.status} NOT IN ('delivered', 'archived')`,
      ))
    if ((activeRequests[0]?.count ?? 0) > 0) score += 20

    // 2. Last request within 30 days? (+20)
    const recentRequests = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, org.id),
        gte(schema.requests.createdAt, thirtyDaysAgo),
      ))
    if ((recentRequests[0]?.count ?? 0) > 0) score += 20

    // 3. No overdue invoices? (+20)
    const overdueInvoices = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, org.id),
        eq(schema.invoices.status, 'overdue'),
      ))
    if ((overdueInvoices[0]?.count ?? 0) === 0) score += 20

    // 4. Recent activity in last 14 days? (+20)
    const recentActivity = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, org.id),
        gte(schema.requests.updatedAt, fourteenDaysAgo),
      ))
    const recentMessages = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.orgId, org.id),
        gte(schema.messages.createdAt, fourteenDaysAgo),
      ))
    if ((recentActivity[0]?.count ?? 0) > 0 || (recentMessages[0]?.count ?? 0) > 0) score += 20

    // 5. Has at least one contact with email? (+20)
    const contactsWithEmail = await drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.contacts)
      .where(and(
        eq(schema.contacts.orgId, org.id),
        sql`${schema.contacts.email} IS NOT NULL AND ${schema.contacts.email} != ''`,
      ))
    if ((contactsWithEmail[0]?.count ?? 0) > 0) score += 20

    // Map score to healthStatus
    const healthStatus = score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red'

    await drizzle
      .update(schema.organisations)
      .set({
        healthStatus,
        updatedAt: now.toISOString(),
      })
      .where(eq(schema.organisations.id, org.id))

    updated++
  }

  return NextResponse.json({ updated })
}
