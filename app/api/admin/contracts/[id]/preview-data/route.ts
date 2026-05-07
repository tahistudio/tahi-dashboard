import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/contracts/[id]/preview-data
 *
 * Live state of a contract for admin preview (bypasses any signing flow).
 * Mirrors the public endpoint shape but doesn't require a public token.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [doc] = await database
    .select({
      id: schema.contractDocuments.id,
      orgId: schema.contractDocuments.orgId,
      type: schema.contractDocuments.type,
      name: schema.contractDocuments.name,
      status: schema.contractDocuments.status,
      bodyHtml: schema.contractDocuments.bodyHtml,
      sentAt: schema.contractDocuments.sentAt,
      signedAt: schema.contractDocuments.signedAt,
      expiresAt: schema.contractDocuments.expiresAt,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const signers = await database
    .select({
      id: schema.contractSigners.id,
      role: schema.contractSigners.role,
      name: schema.contractSigners.name,
      email: schema.contractSigners.email,
      position: schema.contractSigners.position,
      status: schema.contractSigners.status,
      signedAt: schema.contractSigners.signedAt,
    })
    .from(schema.contractSigners)
    .where(eq(schema.contractSigners.contractId, id))
    .orderBy(asc(schema.contractSigners.position))

  const signatures = await database
    .select({
      id: schema.contractSignatures.id,
      signerId: schema.contractSignatures.signerId,
      signatureDataUrl: schema.contractSignatures.signatureDataUrl,
      signedAt: schema.contractSignatures.signedAt,
    })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, id))
    .orderBy(asc(schema.contractSignatures.signedAt))

  return NextResponse.json({ contract: doc, signers, signatures, isPreview: true })
}
