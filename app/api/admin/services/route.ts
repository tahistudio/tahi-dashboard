import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { requireAccessToOrg } from '@/lib/require-access'
import { readServiceVisibility } from '@/lib/service-catalogue'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/services ─────────────────────────────────────────────────
// The studio's catalogue editor.
//
// A row is either GLOBAL (org_id NULL, every client sees it) or PRIVATE to one
// organisation (migration 0097). Without ?orgId this answers the global rows
// plus every private row the caller is allowed to see. With ?orgId it narrows
// to global rows plus that one client's, which is what the editor's audience
// filter and the client detail page ask for.
//
// Access scoping (CLAUDE.md rule 11) applies to the private rows only: a
// private row IS client data, so a team member scoped to two clients must not
// read a third client's retainer names off the catalogue. Global rows carry no
// client information and stay visible to any studio caller, which is why a
// deny-all scope still answers the global set rather than an empty list.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const requestedOrgId = new URL(req.url).searchParams.get('orgId')?.trim() || null

  const database = await db()

  if (requestedOrgId) {
    // Same order as the request create path: prove the caller may see this
    // client BEFORE looking it up, so a 403 is not an existence oracle.
    const denied = await requireAccessToOrg(database, userId, requestedOrgId)
    if (denied) return denied
    const [org] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, requestedOrgId))
      .limit(1)
    if (!org) {
      return NextResponse.json({ error: 'orgId does not match a client' }, { status: 400 })
    }
  }

  const conditions = []
  if (requestedOrgId) {
    conditions.push(or(isNull(schema.services.orgId), eq(schema.services.orgId, requestedOrgId)))
  } else {
    const scopedOrgIds = await resolveAccessScoping(database, userId)
    if (scopedOrgIds !== null) {
      // Deny-all still sees the global catalogue: it belongs to the studio,
      // not to a client. Only the private rows narrow.
      conditions.push(
        scopedOrgIds.length === 0
          ? isNull(schema.services.orgId)
          : or(isNull(schema.services.orgId), inArray(schema.services.orgId, scopedOrgIds)),
      )
    }
  }

  const items = await database
    .select()
    .from(schema.services)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.services.createdAt))

  return NextResponse.json({ items })
}

// ── POST /api/admin/services ────────────────────────────────────────────────
// Create a catalogue row. `orgId` is optional and nullable: omit it (or send
// null) for a global row, name a client to keep the row private to them.
export async function POST(req: NextRequest) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    description?: string
    price?: number
    currency?: string
    isRecurring?: boolean
    recurringInterval?: string
    showInCatalog?: boolean
    category?: string
    orgId?: string | null
    visibility?: string
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const visibility = readServiceVisibility(body.visibility, 'public')
  if (!visibility) {
    return NextResponse.json(
      { error: "visibility must be 'public' or 'hidden'" },
      { status: 400 },
    )
  }

  const targetOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null

  const database = await db()

  if (targetOrgId) {
    const denied = await requireAccessToOrg(database, userId, targetOrgId)
    if (denied) return denied
    const [org] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, targetOrgId))
      .limit(1)
    if (!org) {
      return NextResponse.json({ error: 'orgId does not match a client' }, { status: 400 })
    }
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await database.insert(schema.services).values({
    id,
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    price: body.price ?? 0,
    currency: body.currency ?? 'NZD',
    isRecurring: body.isRecurring ? 1 : 0,
    recurringInterval: body.recurringInterval ?? null,
    showInCatalog: body.showInCatalog === false ? 0 : 1,
    category: body.category ?? null,
    orgId: targetOrgId,
    visibility,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
