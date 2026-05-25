import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { render } from '@react-email/render'
import { ContractSignEmail } from '@/emails/contract-sign'
import { publicUrl } from '@/lib/app-url'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

function mintToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * POST /api/admin/contracts/[id]/email
 *
 * Sends per-signer "please sign" emails via Resend. Auto-mints a share
 * token if the contract doesn't have one yet (so this endpoint also
 * covers the "I just want to send this" case in one click).
 *
 * Body: {
 *   signerIds?: string[]   // default: all pending signers
 *   message?: string       // optional note from the sender, included in email
 * }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    signerIds?: string[]
    cc?: Array<{ name?: string; email: string }>
    bcc?: Array<{ name?: string; email: string }>
    subject?: string
    message?: string
  }
  const ccList = (Array.isArray(body.cc) ? body.cc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const bccList = (Array.isArray(body.bcc) ? body.bcc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const customSubject = body.subject?.trim() || null

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Load contract
  const [doc] = await database
    .select({
      id: schema.contractDocuments.id,
      type: schema.contractDocuments.type,
      name: schema.contractDocuments.name,
      status: schema.contractDocuments.status,
      token: schema.contractDocuments.publicShareToken,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status === 'cancelled' || doc.status === 'expired' || doc.status === 'signed') {
    return NextResponse.json({ error: 'This contract is not open for signing.' }, { status: 409 })
  }

  // Auto-mint token if missing — saves an extra round-trip from the UI.
  let token = doc.token
  if (!token) {
    token = mintToken()
    await database.update(schema.contractDocuments).set({
      publicShareToken: token,
      publicSharedAt: now,
      status: doc.status === 'draft' ? 'sent' : doc.status,
      sentAt: doc.status === 'draft' ? now : undefined,
      updatedAt: now,
    }).where(eq(schema.contractDocuments.id, id))
  }

  // Resolve signers — pending only, optionally filtered by signerIds.
  const signers = await database
    .select({
      id: schema.contractSigners.id,
      role: schema.contractSigners.role,
      name: schema.contractSigners.name,
      email: schema.contractSigners.email,
      status: schema.contractSigners.status,
    })
    .from(schema.contractSigners)
    .where(and(
      eq(schema.contractSigners.contractId, id),
      eq(schema.contractSigners.status, 'pending'),
    ))

  const targetSigners = body.signerIds && body.signerIds.length > 0
    ? signers.filter(s => body.signerIds!.includes(s.id))
    : signers

  if (targetSigners.length === 0) {
    return NextResponse.json({ error: 'No pending signers to email.' }, { status: 400 })
  }

  // Sender — for now hard-coded to Liam since he leads sales. Phase 9+ will
  // pull from the team-member who shared the contract.
  const fromName = 'Liam Miller'
  const customMessage = body.message?.trim() || null

  const sent: Array<{ signerId: string; email: string }> = []
  const failed: Array<{ signerId: string; email: string; error: string }> = []

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  for (const signer of targetSigners) {
    const signUrl = publicUrl(`/p/contract/${token}/sign/${signer.id}`)
    try {
      const html = await render(ContractSignEmail({
        signerName: signer.name,
        signerRole: signer.role,
        contractName: doc.name,
        contractType: doc.type,
        signUrl,
        fromName,
        customMessage,
      }))
      await resend.emails.send({
        from: 'Tahi Studio <business@tahi.studio>',
        to: signer.email,
        cc: ccList.length ? ccList : undefined,
        bcc: bccList.length ? bccList : undefined,
        subject: customSubject ?? `Please sign: ${doc.name}`,
        html,
      })
      sent.push({ signerId: signer.id, email: signer.email })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      failed.push({ signerId: signer.id, email: signer.email, error: msg })
    }
  }

  return NextResponse.json({ token, sent, failed })
}
