/**
 * GET/POST /api/admin/contracts/[id]/signed-pdf
 *
 * GET streams the stamped signed PDF, org-scoped like every other contract
 * sub-resource (requireContractAccess). Reads it straight from R2 when
 * contract_documents.signed_storage_key resolves there, otherwise rebuilds it
 * from the document's current signers and signatures and best-effort
 * backfills the key (lib/contract-signed-artifact.ts). That second path is
 * what covers every contract that was fully signed before this file existed.
 *
 * POST re-runs the fully-signed email fan-out (signers + creator, PDF
 * attached), for the "resend the signed copy" affordance on the detail page
 * (contract-detail.tsx), distinct from the pre-sign "resend signing link".
 *
 * Both refuse a contract the studio marked signed by hand
 * (lib/contract-signing-state.ts): there are no signatures to stamp and no
 * signing date, so the PDF would read "Fully signed at" today and list every
 * signer as awaiting, and the email would tell the client every party had
 * just signed.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { requireContractAccess } from '@/app/api/admin/_sales-access/artifact-scope'
import { resolveContractSignedPdfBytes } from '@/lib/contract-signed-artifact'
import { slugify, sendFullySignedContractEmails } from '@/lib/contract-fully-signed-emails'
import { isMarkedSigned } from '@/lib/contract-signing-state'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

const MARKED_SIGNED_ERROR =
  'This contract was marked signed by hand, so there is no signed copy on file to download or resend.'

async function loadSignedDoc(database: D1, id: string) {
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
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  return doc ?? null
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const denied = await requireContractAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const doc = await loadSignedDoc(database, id)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'signed') {
    return NextResponse.json({ error: 'This contract is not fully signed yet.' }, { status: 409 })
  }
  if (isMarkedSigned(doc)) {
    return NextResponse.json({ error: MARKED_SIGNED_ERROR }, { status: 409 })
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

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const denied = await requireContractAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const [doc] = await database
    .select({ status: schema.contractDocuments.status, finalHash: schema.contractDocuments.finalHash })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'signed') {
    return NextResponse.json({ error: 'This contract is not fully signed yet.' }, { status: 409 })
  }
  if (isMarkedSigned(doc)) {
    return NextResponse.json({ error: MARKED_SIGNED_ERROR }, { status: 409 })
  }

  await sendFullySignedContractEmails(id)
  return NextResponse.json({ success: true })
}
