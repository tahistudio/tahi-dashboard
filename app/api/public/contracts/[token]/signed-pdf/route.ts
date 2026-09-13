/**
 * GET /api/public/contracts/[token]/signed-pdf
 *
 * Token-scoped signer download of the stamped signed PDF, only once the
 * contract has actually reached 'signed'. 404s (not 409) on anything short of
 * that, matching the sign route's own posture toward an unknown or inactive
 * token: this endpoint never confirms a token's existence to a caller who
 * cannot already use it to sign.
 *
 * Shares the resolve-or-regenerate logic with the admin download route
 * (lib/contract-signed-artifact.ts), so a contract signed before this file
 * existed is still downloadable here, not only from the admin side.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { resolveContractSignedPdfBytes } from '@/lib/contract-signed-artifact'
import { slugify } from '@/lib/contract-fully-signed-emails'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const database = await db() as unknown as D1
  const [doc] = await database
    .select({
      id: schema.contractDocuments.id,
      name: schema.contractDocuments.name,
      type: schema.contractDocuments.type,
      status: schema.contractDocuments.status,
      bodyHtml: schema.contractDocuments.bodyHtml,
      signedAt: schema.contractDocuments.signedAt,
      finalHash: schema.contractDocuments.finalHash,
      publicShareToken: schema.contractDocuments.publicShareToken,
      signedStorageKey: schema.contractDocuments.signedStorageKey,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.publicShareToken, token))
    .limit(1)

  if (!doc || doc.status !== 'signed') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cfCtx = await getCloudflareContext({ async: true })
  const env = cfCtx?.env as { STORAGE?: R2Bucket } | undefined
  const bytes = await resolveContractSignedPdfBytes(database, env, doc)

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slugify(doc.name)}-signed.pdf"`,
    },
  })
}
