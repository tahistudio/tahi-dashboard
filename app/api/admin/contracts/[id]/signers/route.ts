import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// POST /api/admin/contracts/documents/[id]/signers — add a signer
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: contractId } = await ctx.params
  const body = await req.json() as {
    role?: string
    name?: string
    email?: string
    position?: number
  }
  if (!body.role || !body.name?.trim() || !body.email?.trim()) {
    return NextResponse.json({ error: 'role, name, email all required' }, { status: 400 })
  }
  const database = await db() as unknown as D1

  let position = body.position
  if (position == null) {
    const [maxRow] = await database
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.contractSigners.position}), -1)` })
      .from(schema.contractSigners)
      .where(eq(schema.contractSigners.contractId, contractId))
    position = (maxRow?.maxPos ?? -1) + 1
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.contractSigners).values({
    id,
    contractId,
    role: body.role,
    name: body.name.trim(),
    email: body.email.trim(),
    position,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ id }, { status: 201 })
}
