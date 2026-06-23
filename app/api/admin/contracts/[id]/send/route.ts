import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

function mintToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// POST /api/admin/contracts/documents/[id]/send — mint share token + flip status.
//
// Note: this does NOT trigger Resend emails. Email send is a separate
// concern (operator can paste signer URLs from the response into their
// own email, or we'll add automated send in a follow-up). The route
// returns each signer's per-signer URL.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const [doc] = await database
    .select({ id: schema.contractDocuments.id, token: schema.contractDocuments.publicShareToken, status: schema.contractDocuments.status })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let token = doc.token
  const now = new Date().toISOString()
  if (!token || rotate) {
    token = mintToken()
  }

  await database.update(schema.contractDocuments).set({
    publicShareToken: token,
    publicSharedAt: now,
    status: doc.status === 'draft' ? 'sent' : doc.status,
    sentAt: doc.status === 'draft' ? now : undefined,
    updatedAt: now,
  }).where(eq(schema.contractDocuments.id, id))

  // Return signer URLs so the operator can paste them into emails.
  const signers = await database
    .select({ id: schema.contractSigners.id, name: schema.contractSigners.name, email: schema.contractSigners.email, status: schema.contractSigners.status })
    .from(schema.contractSigners)
    .where(eq(schema.contractSigners.contractId, id))

  // We don't know the public-facing host server-side, so the client
  // composes the URL using window.location.origin. Return token + signerIds.
  return NextResponse.json({
    token,
    signers: signers.map(s => ({ ...s, signPath: `/p/contract/${token}/sign/${s.id}` })),
  })
}

// DELETE — revoke (back to draft, clear token, cancel pending signers).
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.update(schema.contractDocuments).set({
    publicShareToken: null,
    publicSharedAt: null,
    status: 'draft',
    sentAt: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contractDocuments.id, id))
  return NextResponse.json({ success: true })
}
