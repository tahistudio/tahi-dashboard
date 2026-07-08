import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { resolvePermissions } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/danger/export
 *
 * Super-admin-only JSON export of the core business tables. Powers the Danger
 * Zone "Export all data" action (components/tahi/settings/sections/danger-zone.tsx).
 *
 * Scope: every core business table a workspace owner would want to walk away
 * with, including team, projects, messaging, files (R2 references only, not
 * the binary objects), contracts, docs and the audit log. It EXCLUDES
 * `integrations` and `settings` (they hold connection config / tokens / keys)
 * and any other secret-bearing surface. Each table is row-capped so a large
 * workspace can't blow the worker's memory / response size; the payload's
 * `counts` + `rowCap` let the client surface truncation honestly.
 *
 * Gated on super-admin explicitly (not just Tahi-org admin) because a full data
 * dump is the most sensitive read in the product.
 */

const ROW_CAP = 5000

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const drizzle = (await db()) as unknown as D1

  // Super-admin only. The MCP service token resolves to admin (not super_admin)
  // and is intentionally NOT allowed to trigger a full dump.
  const access = await resolvePermissions(drizzle, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Core business tables only. No integrations, no settings, no auth tokens.
  const [
    organisations,
    contacts,
    teamMembers,
    projects,
    tracks,
    requests,
    tasks,
    taskSubtasks,
    invoices,
    invoiceItems,
    subscriptions,
    deals,
    timeEntries,
    messages,
    files,
    contracts,
    tags,
    announcements,
    docPages,
    auditLog,
  ] = await Promise.all([
    drizzle.select().from(schema.organisations).limit(ROW_CAP),
    drizzle.select().from(schema.contacts).limit(ROW_CAP),
    drizzle.select().from(schema.teamMembers).limit(ROW_CAP),
    drizzle.select().from(schema.projects).limit(ROW_CAP),
    drizzle.select().from(schema.tracks).limit(ROW_CAP),
    drizzle.select().from(schema.requests).limit(ROW_CAP),
    drizzle.select().from(schema.tasks).limit(ROW_CAP),
    drizzle.select().from(schema.taskSubtasks).limit(ROW_CAP),
    drizzle.select().from(schema.invoices).limit(ROW_CAP),
    drizzle.select().from(schema.invoiceItems).limit(ROW_CAP),
    drizzle.select().from(schema.subscriptions).limit(ROW_CAP),
    drizzle.select().from(schema.deals).limit(ROW_CAP),
    drizzle.select().from(schema.timeEntries).limit(ROW_CAP),
    drizzle.select().from(schema.messages).limit(ROW_CAP),
    drizzle.select().from(schema.files).limit(ROW_CAP),
    drizzle.select().from(schema.contracts).limit(ROW_CAP),
    drizzle.select().from(schema.tags).limit(ROW_CAP),
    drizzle.select().from(schema.announcements).limit(ROW_CAP),
    drizzle.select().from(schema.docPages).limit(ROW_CAP),
    drizzle.select().from(schema.auditLog).limit(ROW_CAP),
  ])

  const tables = {
    organisations,
    contacts,
    teamMembers,
    projects,
    tracks,
    requests,
    tasks,
    taskSubtasks,
    invoices,
    invoiceItems,
    subscriptions,
    deals,
    timeEntries,
    messages,
    files,
    contracts,
    tags,
    announcements,
    docPages,
    auditLog,
  }

  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(tables)) counts[name] = rows.length

  const exportedAt = new Date().toISOString()
  const filename = `tahi-export-${exportedAt.slice(0, 10)}.json`

  const payload = {
    exportedAt,
    rowCap: ROW_CAP,
    counts,
    tables,
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
