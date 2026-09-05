import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'
import { requireScheduleAccess } from '@/app/api/admin/_sales-access/artifact-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * Token format: 32-character URL-safe base64 derived from 24 random bytes.
 * crypto.getRandomValues is used (Workers-safe, cryptographically random).
 * Collisions over the lifetime of this app are vanishingly improbable.
 */
function mintShareToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  // Convert to URL-safe base64 (replace + → -, / → _, strip padding).
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── POST /api/admin/schedules/[id]/share ───────────────────────────────
// Mint (or rotate) a public share token for the schedule. Returns the
// token; caller composes the URL on the client side.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const denied = await requireScheduleAccess(database, { userId, orgId }, id)
  if (denied) return denied

  // If a token already exists, return it (idempotent share). Pass ?rotate=1
  // to force a new token (revokes the previous one).
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const [existing] = await database
    .select({
      token: schema.projectSchedules.publicShareToken,
      publishedSnapshot: schema.projectSchedules.publishedSnapshot,
    })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)

  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  // Sharing publishes a first snapshot. The public viewer and the client's
  // home both read publishedSnapshot and fall back to the LIVE rows when there
  // is none, so a schedule that was shared and never published served whatever
  // the studio happened to be typing at the time: a renamed phase, a moved
  // launch date, a half-written row. Taking the snapshot at the moment the link
  // is minted means a shared schedule always shows a state somebody chose to
  // share, and the live fall-through becomes dead for new data.
  //
  // Only when there is none. An existing published state is never clobbered by
  // a re-share (or a token rotation), because that would silently publish edits
  // the studio has not pressed Republish on.
  const firstSnapshot = existing.publishedSnapshot ? null : await buildSnapshot(database, id)

  const published = firstSnapshot
    ? { publishedSnapshot: JSON.stringify(firstSnapshot), publishedAt: now }
    : {}

  let token = existing.token
  if (!token || rotate) {
    token = mintShareToken()
    await database
      .update(schema.projectSchedules)
      .set({
        publicShareToken: token,
        publicSharedAt: now,
        status: 'shared',
        updatedAt: now,
        ...published,
      })
      .where(eq(schema.projectSchedules.id, id))
  } else {
    // Token exists, but make sure status reflects shared state.
    await database
      .update(schema.projectSchedules)
      .set({ status: 'shared', updatedAt: now, ...published })
      .where(eq(schema.projectSchedules.id, id))
  }

  return NextResponse.json({ token, status: 'shared', published: !!firstSnapshot })
}

/**
 * The same snapshot POST /api/admin/schedules/[id]/publish writes: the cover,
 * the sections and the rows, each ordered by position. Kept local because a
 * route module may only export HTTP methods; publish/route.ts is the shape's
 * source of truth and the two must be changed together.
 */
async function buildSnapshot(database: D1, id: string) {
  const [schedule] = await database
    .select({
      title: schema.projectSchedules.title,
      subtitle: schema.projectSchedules.subtitle,
      preparedFor: schema.projectSchedules.preparedFor,
      preparedBy: schema.projectSchedules.preparedBy,
      effectiveDate: schema.projectSchedules.effectiveDate,
      targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      numberOfWeeks: schema.projectSchedules.numberOfWeeks,
      overviewHtml: schema.projectSchedules.overviewHtml,
    })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)
  if (!schedule) return null

  const [sections, rows] = await Promise.all([
    database.select({
      id: schema.scheduleSections.id,
      type: schema.scheduleSections.type,
      title: schema.scheduleSections.title,
      subtitle: schema.scheduleSections.subtitle,
      startWeek: schema.scheduleSections.startWeek,
      endWeek: schema.scheduleSections.endWeek,
      data: schema.scheduleSections.data,
      themeMode: schema.scheduleSections.themeMode,
      position: schema.scheduleSections.position,
    })
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, id))
      .orderBy(asc(schema.scheduleSections.position)),
    database.select({
      id: schema.scheduleRows.id,
      sectionId: schema.scheduleRows.sectionId,
      rowType: schema.scheduleRows.rowType,
      label: schema.scheduleRows.label,
      owner: schema.scheduleRows.owner,
      startWeek: schema.scheduleRows.startWeek,
      endWeek: schema.scheduleRows.endWeek,
      riskFlag: schema.scheduleRows.riskFlag,
      position: schema.scheduleRows.position,
    })
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.scheduleId, id))
      .orderBy(asc(schema.scheduleRows.position)),
  ])

  return { schedule, sections, rows }
}

// ── DELETE /api/admin/schedules/[id]/share ─────────────────────────────
// Revoke the public share token. Existing public links will 404 after this.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const denied = await requireScheduleAccess(database, { userId, orgId }, id)
  if (denied) return denied

  await database
    .update(schema.projectSchedules)
    .set({
      publicShareToken: null,
      publicSharedAt: null,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.projectSchedules.id, id))

  return NextResponse.json({ success: true })
}
