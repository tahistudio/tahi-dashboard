import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { isServiceVisibility, SERVICE_VISIBILITIES } from '@/lib/service-catalogue'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// ── PATCH /api/admin/services/[id] ──────────────────────────────────────────
// Edit a catalogue row, including its audience (migration 0097).
//
//   orgId       null or omitted-as-null makes the row global again; a client id
//               makes it private to that client.
//   visibility  'public' | 'hidden'. Hidden takes the row out of the portal
//               even while it is global.
//
// Access scoping (CLAUDE.md rule 11) runs on BOTH ends of a move: the caller
// must be allowed to see the client the row belongs to now, and the client it
// is being handed to. Checking only the destination would let a scoped member
// pull another client's private row across to their own.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string
    description: string | null
    price: number
    currency: string
    isRecurring: boolean
    recurringInterval: string | null
    showInCatalog: boolean
    category: string | null
    orgId: string | null
    visibility: string
  }>

  if ('name' in body && !body.name?.trim()) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
  }
  if ('visibility' in body && !isServiceVisibility(body.visibility)) {
    return NextResponse.json({
      error: `visibility must be ${SERVICE_VISIBILITIES.join(' or ')}`,
    }, { status: 400 })
  }

  const database = await db()

  const [existing] = await database
    .select({ id: schema.services.id, orgId: schema.services.orgId })
    .from(schema.services)
    .where(eq(schema.services.id, id))
    .limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // The row's current owner. A global row (orgId null) belongs to the studio,
  // so there is nothing to be scoped out of.
  if (existing.orgId) {
    const denied = await requireAccessToOrg(database, userId, existing.orgId)
    if (denied) return denied
  }

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if ('description' in body) patch.description = body.description?.trim() || null
  if (typeof body.price === 'number') patch.price = body.price
  if (typeof body.currency === 'string') patch.currency = body.currency
  if (typeof body.isRecurring === 'boolean') patch.isRecurring = body.isRecurring ? 1 : 0
  if ('recurringInterval' in body) patch.recurringInterval = body.recurringInterval || null
  if (typeof body.showInCatalog === 'boolean') patch.showInCatalog = body.showInCatalog ? 1 : 0
  if ('category' in body) patch.category = body.category || null
  if ('visibility' in body) patch.visibility = body.visibility

  if ('orgId' in body) {
    const nextOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
    if (nextOrgId && nextOrgId !== existing.orgId) {
      const denied = await requireAccessToOrg(database, userId, nextOrgId)
      if (denied) return denied
      const [org] = await database
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, nextOrgId))
        .limit(1)
      if (!org) {
        return NextResponse.json({ error: 'orgId does not match a client' }, { status: 400 })
      }
    }
    patch.orgId = nextOrgId
  }

  await database.update(schema.services).set(patch).where(eq(schema.services.id, id))

  return NextResponse.json({ success: true })
}
