import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray, notInArray, gte, isNotNull, desc, asc } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { resolvePermissions, can } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { overnightCutoff, daysPastDue } from '@/lib/overview-aggregates'

export const dynamic = 'force-dynamic'

export type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Settings key for the once-per-day cached brief. Mirrors the AI briefing's
// 'ai_briefing_latest' cadence: computed once each morning (7/8am NZ cron),
// re-runnable on demand, and served from cache on every page load in between.
export const BRIEF_CACHE_KEY = 'overview_brief_latest'

// Each brief row maps to the design's DailyBrief accordion row:
//   tone -> the coloured status dot ('' = neutral, used by "While you slept")
//   verb -> the optional action button label (null = no action)
//   to   -> the nav id the action routes to (go(to))
//   text -> the assembled, human-readable line (money baked NZD, wire-style)
interface BriefRow {
  tone: 'risk' | 'warn' | 'ok' | ''
  verb: string | null
  to: string
  text: string
}

export interface BriefResult {
  urgent: BriefRow[]
  week: BriefRow[]
  slept: BriefRow[]
}

interface CachedBrief extends BriefResult {
  generatedAt: string
}

// Server-side NZD formatting. Amounts are already converted to NZD upstream
// (this is presentation, NOT an FX rate). Mirrors TheWire's NZD-baked labels.
function fmtNzd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-NZ')
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

// ── computeBrief ──────────────────────────────────────────────────────────────
// Assembles the owner "Daily brief" from REAL signals, permission-gated per
// source. Every section returns an honest empty array when nothing qualifies;
// nothing is fabricated. Every query is wrapped so a missing table/column can
// never blow up the caller. Shared by the GET recompute path and the refresh
// endpoint so there is exactly one source of truth.
//
// `auth` is the resolved (userId, orgId). The scheduled cron passes the
// unrestricted owner identity (api-service + Tahi org) so it produces the full
// owner brief; a live admin GET passes their own auth (same gating as before).
export async function computeBrief(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
): Promise<BriefResult> {
  const access = await resolvePermissions(drizzle, auth)
  const canSeeInvoices = can(access, 'invoices')
  const canSeeContracts = can(access, 'contracts')
  const canSeeCalls = can(access, 'calls')
  const canSeeRequests = can(access, 'requests')
  const canSeeMessages = can(access, 'messages')

  // Org scoping: null = unrestricted (admin / all_clients); [] = deny all;
  // otherwise the allowed org ids. Client/request/invoice rows are filtered.
  const allowedOrgs = await resolveAccessScoping(drizzle, auth.userId)
  const denyAll = Array.isArray(allowedOrgs) && allowedOrgs.length === 0

  const rateMap: RateMap = await (async () => {
    try {
      const rates = await drizzle.select().from(schema.exchangeRates)
      return buildRateMap(rates)
    } catch {
      return buildRateMap([])
    }
  })()

  const now = new Date()
  const nowIso = now.toISOString()
  const since = overnightCutoff(now)

  const urgent: BriefRow[] = []
  const week: BriefRow[] = []
  const slept: BriefRow[] = []

  // ── URGENT: oldest overdue invoices (gated on invoices) ────────────────────
  if (canSeeInvoices && !denyAll) {
    try {
      const conditions = [inArray(schema.invoices.status, ['sent', 'overdue'])]
      if (allowedOrgs) conditions.push(inArray(schema.invoices.orgId, allowedOrgs))
      const rows = await drizzle
        .select({
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
          dueDate: schema.invoices.dueDate,
          orgName: schema.organisations.name,
        })
        .from(schema.invoices)
        .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
        .where(and(...conditions))

      const overdue = rows
        .map(r => ({
          amountNzd: toNzd(r.totalUsd, r.currency ?? 'USD', rateMap),
          days: daysPastDue(r.dueDate ?? null, now),
          orgName: r.orgName,
        }))
        .filter(r => r.days > 0)
        .sort((a, b) => b.days - a.days)
        .slice(0, 2)

      for (const r of overdue) {
        urgent.push({
          tone: 'risk',
          verb: 'Nudge',
          to: 'invoices',
          text: `${r.orgName ?? 'A client'} · ${fmtNzd(r.amountNzd)} overdue ${r.days} ${plural(r.days, 'day', 'days')}`,
        })
      }
    } catch {
      // Invoices table missing — skip this source.
    }
  }

  // ── URGENT: today's discovery calls with no prep note (gated on calls) ──────
  if (canSeeCalls) {
    try {
      // NZ studio day, so a "2:30pm today" call is grouped correctly regardless
      // of the UTC offset baked into scheduledAt by the calendar sync.
      const nzDay = now.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
      const calls = await drizzle
        .select({
          title: schema.discoveryCalls.title,
          scheduledAt: schema.discoveryCalls.scheduledAt,
          scopeNotes: schema.discoveryCalls.scopeNotes,
          summary: schema.discoveryCalls.summary,
          status: schema.discoveryCalls.status,
        })
        .from(schema.discoveryCalls)
        .where(eq(schema.discoveryCalls.status, 'scheduled'))
        .orderBy(asc(schema.discoveryCalls.scheduledAt))
        .limit(60)

      const todayNoPrep = calls
        .filter(c => {
          const d = new Date(c.scheduledAt)
          if (!Number.isFinite(d.getTime())) return false
          const callDay = d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
          const hasPrep = !!(c.scopeNotes?.trim() || c.summary?.trim())
          return callDay === nzDay && !hasPrep
        })
        .slice(0, 2)

      for (const c of todayNoPrep) {
        const time = new Date(c.scheduledAt).toLocaleTimeString('en-NZ', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Pacific/Auckland',
        })
        urgent.push({
          tone: 'warn',
          verb: 'Prep note',
          to: 'calls',
          text: `${c.title} · ${time} — no prep note yet`,
        })
      }
    } catch {
      // Discovery calls table missing — skip this source.
    }
  }

  // ── WEEK: unsigned contracts expiring within 21 days (gated on contracts) ───
  if (canSeeContracts && !denyAll) {
    try {
      const horizon = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString()
      const conditions = [
        inArray(schema.contractDocuments.status, ['draft', 'sent', 'partially_signed']),
        isNotNull(schema.contractDocuments.expiresAt),
        gte(schema.contractDocuments.expiresAt, nowIso),
      ]
      if (allowedOrgs) conditions.push(inArray(schema.contractDocuments.orgId, allowedOrgs))
      const rows = await drizzle
        .select({
          name: schema.contractDocuments.name,
          expiresAt: schema.contractDocuments.expiresAt,
          orgName: schema.organisations.name,
        })
        .from(schema.contractDocuments)
        .leftJoin(schema.organisations, eq(schema.contractDocuments.orgId, schema.organisations.id))
        .where(and(...conditions))
        .orderBy(asc(schema.contractDocuments.expiresAt))
        .limit(10)

      const soon = rows
        .filter(r => r.expiresAt != null && r.expiresAt <= horizon)
        .slice(0, 3)

      for (const r of soon) {
        const days = Math.max(
          0,
          Math.ceil((new Date(r.expiresAt as string).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
        )
        urgentContractText(week, r.orgName, r.name, days)
      }
    } catch {
      // Contract documents table missing — skip this source.
    }
  }

  // ── WEEK: overdue requests (gated on requests + org scoping) ────────────────
  if (canSeeRequests && !denyAll) {
    try {
      const conditions = [
        isNotNull(schema.requests.dueDate),
        notInArray(schema.requests.status, ['delivered', 'archived', 'cancelled', 'draft']),
      ]
      if (allowedOrgs) conditions.push(inArray(schema.requests.orgId, allowedOrgs))
      const rows = await drizzle
        .select({
          title: schema.requests.title,
          dueDate: schema.requests.dueDate,
          orgName: schema.organisations.name,
        })
        .from(schema.requests)
        .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
        .where(and(...conditions))
        .orderBy(asc(schema.requests.dueDate))
        .limit(50)

      const overdue = rows
        .map(r => ({ title: r.title, orgName: r.orgName, days: daysPastDue(r.dueDate ?? null, now) }))
        .filter(r => r.days > 0)
        .sort((a, b) => b.days - a.days)
        .slice(0, 3)

      for (const r of overdue) {
        const lead = r.orgName ? `${r.orgName} — ` : ''
        week.push({
          tone: 'warn',
          verb: 'Open',
          to: 'requests',
          text: `${lead}${r.title} ${r.days} ${plural(r.days, 'day', 'days')} overdue`,
        })
      }
    } catch {
      // Requests table missing — skip this source.
    }
  }

  // ── SLEPT: payments cleared overnight (gated on invoices) ───────────────────
  if (canSeeInvoices && !denyAll) {
    try {
      const conditions = [eq(schema.invoices.status, 'paid'), gte(schema.invoices.paidAt, since)]
      if (allowedOrgs) conditions.push(inArray(schema.invoices.orgId, allowedOrgs))
      const rows = await drizzle
        .select({
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
          orgName: schema.organisations.name,
          paidAt: schema.invoices.paidAt,
        })
        .from(schema.invoices)
        .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
        .where(and(...conditions))
        .orderBy(desc(schema.invoices.paidAt))
        .limit(4)

      for (const r of rows) {
        slept.push({
          tone: '',
          verb: null,
          to: 'invoices',
          text: `${r.orgName ?? 'A client'} paid ${fmtNzd(toNzd(r.totalUsd, r.currency ?? 'USD', rateMap))}`,
        })
      }
    } catch {
      // Invoices table missing — skip this source.
    }
  }

  // ── SLEPT: deliveries completed overnight (gated on requests + scoping) ──────
  if (canSeeRequests && !denyAll) {
    try {
      const conditions = [eq(schema.requests.status, 'delivered'), gte(schema.requests.updatedAt, since)]
      if (allowedOrgs) conditions.push(inArray(schema.requests.orgId, allowedOrgs))
      const rows = await drizzle
        .select({
          title: schema.requests.title,
          orgName: schema.organisations.name,
          updatedAt: schema.requests.updatedAt,
        })
        .from(schema.requests)
        .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
        .where(and(...conditions))
        .orderBy(desc(schema.requests.updatedAt))
        .limit(4)

      for (const r of rows) {
        const lead = r.orgName ? `${r.orgName} — ` : ''
        slept.push({
          tone: '',
          verb: null,
          to: 'requests',
          text: `${lead}${r.title} delivered`,
        })
      }
    } catch {
      // Requests table missing — skip this source.
    }
  }

  // ── SLEPT: client replies overnight (summary row) ───────────────────────────
  if (canSeeMessages) {
    try {
      const replies = await drizzle
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(
          inArray(schema.messages.authorType, ['contact', 'client']),
          gte(schema.messages.createdAt, since),
        ))
      const n = replies.length
      if (n > 0) {
        slept.push({
          tone: '',
          verb: null,
          to: 'messages',
          text: `${n} client ${plural(n, 'reply', 'replies')} came in overnight`,
        })
      }
    } catch {
      // Messages table missing — skip this source.
    }
  }

  return { urgent, week, slept }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

// Read the cached brief from settings. Returns null on a missing / corrupt /
// shape-mismatched row so the caller safely falls through to a recompute.
export async function readBriefCache(drizzle: D1): Promise<CachedBrief | null> {
  try {
    const [row] = await drizzle
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, BRIEF_CACHE_KEY))
      .limit(1)
    if (!row?.value) return null
    const parsed = JSON.parse(row.value) as Partial<CachedBrief>
    if (
      typeof parsed.generatedAt !== 'string' ||
      !Array.isArray(parsed.urgent) ||
      !Array.isArray(parsed.week) ||
      !Array.isArray(parsed.slept)
    ) {
      return null
    }
    return { urgent: parsed.urgent, week: parsed.week, slept: parsed.slept, generatedAt: parsed.generatedAt }
  } catch {
    return null
  }
}

// Upsert the computed brief into settings (select-then-update/insert, matching
// the AI briefing cache write, since settings.key is the primary key).
export async function writeBriefCache(drizzle: D1, result: BriefResult, generatedAt: string): Promise<void> {
  const value = JSON.stringify({ ...result, generatedAt })
  const existing = await drizzle
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, BRIEF_CACHE_KEY))
    .limit(1)
  if (existing.length > 0) {
    await drizzle
      .update(schema.settings)
      .set({ value, updatedAt: generatedAt })
      .where(eq(schema.settings.key, BRIEF_CACHE_KEY))
  } else {
    await drizzle.insert(schema.settings).values({ key: BRIEF_CACHE_KEY, value, updatedAt: generatedAt })
  }
}

// Fresh when generated within ~20h OR on the same UTC calendar day. A future
// timestamp (clock skew) is treated as stale so we recompute rather than trust
// it. Keeps the once-daily cadence: one morning generation carries the whole day.
export function isBriefFresh(generatedAt: string, now: Date): boolean {
  const gen = new Date(generatedAt)
  if (!Number.isFinite(gen.getTime())) return false
  const ageHours = (now.getTime() - gen.getTime()) / (1000 * 60 * 60)
  if (ageHours < 0) return false
  if (ageHours <= 20) return true
  return gen.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
}

// ── GET /api/admin/overview/brief ─────────────────────────────────────────────
// Serves the cached brief when it was generated today (same UTC day or <20h).
// Otherwise recomputes with the caller's own permissions, caches it, and
// returns it. Response shape is unchanged ({ urgent, week, slept }) plus a
// generatedAt stamp the card uses for its "Updated ..." line.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1
  const now = new Date()

  const cached = await readBriefCache(drizzle)
  if (cached && isBriefFresh(cached.generatedAt, now)) {
    return NextResponse.json({
      urgent: cached.urgent,
      week: cached.week,
      slept: cached.slept,
      generatedAt: cached.generatedAt,
    })
  }

  const result = await computeBrief(drizzle, auth)
  const generatedAt = now.toISOString()
  await writeBriefCache(drizzle, result, generatedAt)
  return NextResponse.json({ ...result, generatedAt })
}

// Small helper so the contract row assembly stays out of the main flow.
function urgentContractText(
  target: BriefRow[],
  orgName: string | null,
  name: string,
  days: number,
): void {
  const lead = orgName ? `${orgName} — ` : ''
  const when = days === 0 ? 'expires today' : `expires in ${days} ${plural(days, 'day', 'days')}`
  target.push({
    tone: 'warn',
    verb: 'Send',
    to: 'contracts',
    text: `${lead}${name} unsigned, ${when}`,
  })
}
