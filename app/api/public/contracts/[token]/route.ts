import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET /api/public/contracts/[token]
 * Public read of contract document + signers + signatures (sans audit data).
 * Used by the public sign page.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
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
    .where(eq(schema.contractDocuments.publicShareToken, token))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status === 'cancelled' || doc.status === 'expired') {
    return NextResponse.json({ error: 'This contract is no longer active.' }, { status: 410 })
  }

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
    .where(eq(schema.contractSigners.contractId, doc.id))
    .orderBy(asc(schema.contractSigners.position))

  // Surface the signature data URL so the public page can render the
  // visual sigs of those who've already signed. Audit metadata stays internal.
  const signatures = await database
    .select({
      id: schema.contractSignatures.id,
      signerId: schema.contractSignatures.signerId,
      signatureDataUrl: schema.contractSignatures.signatureDataUrl,
      signedAt: schema.contractSignatures.signedAt,
    })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, doc.id))
    .orderBy(asc(schema.contractSignatures.signedAt))

  return NextResponse.json({ contract: doc, signers, signatures })
}
