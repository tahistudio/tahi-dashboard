/**
 * Trigger handler for "this contract was just fully signed".
 *
 * Builds a signed-state PDF via jsPDF (pure JS, runs cleanly on
 * Workers — see lib/contract-signed-pdf.ts) and emails it as an
 * attachment to every signer + the contract creator. Audit-logs the
 * send so we can prove (and debug) what went out.
 *
 * Designed to run inside `ctx.waitUntil()` from the public sign route —
 * the signer's HTTP response should not block on PDF generation. Any
 * failure inside this function is caught and logged so a partially-failed
 * send never crashes the request. If the PDF build itself throws we
 * still send the covering email without the attachment so signers at
 * least get notified.
 */
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, inArray } from 'drizzle-orm'
import { render as renderEmail } from '@react-email/render'
import { ContractFullySignedEmail } from '@/emails/contract-fully-signed'
import { buildSignedPdfBase64 } from '@/lib/contract-signed-pdf'
import { publicUrl } from '@/lib/app-url'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RecipientPlan {
  email: string
  name: string
  wasSigner: boolean
}

const FROM_NAME = 'Liam Miller'
const FROM_ADDRESS = 'Tahi Studio <business@tahi.studio>'

/**
 * Send the fully-signed PDF + covering email to every signer and the
 * contract creator. Idempotency: if `contracts.signed_storage_key` ever
 * gets reused as a "PDF was sent" marker we should re-check here, but
 * for now the caller (sign route) only invokes this once when the final
 * signature flips status to 'signed'.
 */
export async function sendFullySignedContractEmails(contractId: string): Promise<void> {
  try {
    const database = await db() as unknown as D1

    // ── Load contract + signers + signatures + creator ───────────────
    const [doc] = await database
      .select({
        id: schema.contractDocuments.id,
        type: schema.contractDocuments.type,
        name: schema.contractDocuments.name,
        bodyHtml: schema.contractDocuments.bodyHtml,
        status: schema.contractDocuments.status,
        signedAt: schema.contractDocuments.signedAt,
        finalHash: schema.contractDocuments.finalHash,
        token: schema.contractDocuments.publicShareToken,
        createdById: schema.contractDocuments.createdById,
      })
      .from(schema.contractDocuments)
      .where(eq(schema.contractDocuments.id, contractId))
      .limit(1)
    if (!doc) {
      console.error(`[contract-fully-signed-emails] contract ${contractId} not found`)
      return
    }
    if (doc.status !== 'signed') {
      console.error(`[contract-fully-signed-emails] contract ${contractId} status is ${doc.status}, expected 'signed'`)
      return
    }

    const signers = await database
      .select({
        id: schema.contractSigners.id,
        role: schema.contractSigners.role,
        name: schema.contractSigners.name,
        email: schema.contractSigners.email,
        signedAt: schema.contractSigners.signedAt,
      })
      .from(schema.contractSigners)
      .where(eq(schema.contractSigners.contractId, contractId))
      .orderBy(asc(schema.contractSigners.position))

    const signatures = await database
      .select({
        signerId: schema.contractSignatures.signerId,
        signatureDataUrl: schema.contractSignatures.signatureDataUrl,
        signedAt: schema.contractSignatures.signedAt,
      })
      .from(schema.contractSignatures)
      .where(eq(schema.contractSignatures.contractId, contractId))

    const sigBySigner = new Map<string, typeof signatures[number]>()
    for (const s of signatures) sigBySigner.set(s.signerId, s)

    // Resolve creator email via team_members. createdById is a Clerk user
    // ID (matches teamMembers.clerk_user_id) for normal flows, but older
    // contracts may have it set to a teamMembers.id directly. Try both.
    let creator: { id: string; email: string; name: string } | null = null
    if (doc.createdById) {
      const candidates = await database
        .select({
          id: schema.teamMembers.id,
          name: schema.teamMembers.name,
          email: schema.teamMembers.email,
          clerkUserId: schema.teamMembers.clerkUserId,
        })
        .from(schema.teamMembers)
        .where(inArray(schema.teamMembers.clerkUserId, [doc.createdById]))
        .limit(1)
      if (candidates.length > 0) {
        const c = candidates[0]
        creator = { id: c.id, name: c.name, email: c.email }
      } else {
        const [byId] = await database
          .select({
            id: schema.teamMembers.id,
            name: schema.teamMembers.name,
            email: schema.teamMembers.email,
          })
          .from(schema.teamMembers)
          .where(eq(schema.teamMembers.id, doc.createdById))
          .limit(1)
        if (byId) creator = byId
      }
    }

    // ── Build recipient plan: every signer email + the creator email,
    //    deduped (creator may also be a signer). The "wasSigner" flag
    //    drives the greeting copy in the covering email.
    const planByEmail = new Map<string, RecipientPlan>()
    for (const s of signers) {
      if (!s.email?.trim()) continue
      const key = s.email.trim().toLowerCase()
      if (!planByEmail.has(key)) {
        planByEmail.set(key, { email: s.email, name: s.name, wasSigner: true })
      }
    }
    if (creator?.email) {
      const key = creator.email.trim().toLowerCase()
      if (!planByEmail.has(key)) {
        planByEmail.set(key, { email: creator.email, name: creator.name, wasSigner: false })
      }
    }
    const recipients = Array.from(planByEmail.values())
    if (recipients.length === 0) {
      console.error(`[contract-fully-signed-emails] no recipients for contract ${contractId}`)
      return
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('[contract-fully-signed-emails] RESEND_API_KEY missing — skipping send')
      await writeAudit(database, contractId, recipients.map(r => r.email), 'skipped_no_resend_key')
      return
    }

    const publicViewerUrl = doc.token
      ? publicUrl(`/p/contract/${doc.token}`)
      : publicUrl(`/contracts/${contractId}`)

    // ── Build the PDF via jsPDF (pure JS, runs cleanly on Workers).
    //    The previous implementation used @react-pdf/renderer which
    //    depends on pdfkit + Node APIs that nodejs_compat doesn't
    //    fully cover. If anything still goes wrong we fall back to a
    //    no-attachment covering email so signers always get notified.
    const pdfFilename = `${slugify(doc.name)}-signed.pdf`
    const signerNames = signers.map(s => s.name).filter(Boolean)

    let pdfBase64: string | null = null
    let pdfError: string | null = null
    try {
      pdfBase64 = buildSignedPdfBase64({
        contractName: doc.name,
        contractType: doc.type,
        signedAt: doc.signedAt ?? new Date().toISOString(),
        finalHash: doc.finalHash,
        publicViewerUrl,
        bodyHtml: doc.bodyHtml,
        signers: signers.map(s => {
          const sig = sigBySigner.get(s.id)
          return {
            id: s.id,
            name: s.name,
            email: s.email,
            role: s.role,
            signedAt: sig?.signedAt ?? s.signedAt ?? null,
            signatureDataUrl: sig?.signatureDataUrl ?? null,
          }
        }),
      })
    } catch (err) {
      pdfError = err instanceof Error ? err.message : 'Unknown PDF render error'
      console.error('[contract-fully-signed-emails] PDF render failed, falling back to no-attachment email:', pdfError)
    }

    // ── Send to each recipient. Failures are tracked but never thrown ─
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const sent: string[] = []
    const failed: Array<{ email: string; error: string }> = []

    for (const r of recipients) {
      try {
        const html = await renderEmail(ContractFullySignedEmail({
          recipientName: r.name,
          recipientWasSigner: r.wasSigner,
          contractName: doc.name,
          contractType: doc.type,
          signedAt: doc.signedAt ?? new Date().toISOString(),
          publicViewerUrl,
          signerNames,
          pdfAttached: pdfBase64 !== null,
        }))

        const sendOpts: Parameters<typeof resend.emails.send>[0] = {
          from: FROM_ADDRESS,
          to: r.email,
          subject: `Fully signed: ${doc.name}`,
          html,
        }
        if (pdfBase64) {
          sendOpts.attachments = [{
            filename: pdfFilename,
            content: pdfBase64,
            contentType: 'application/pdf',
          }]
        }
        await resend.emails.send(sendOpts)
        sent.push(r.email)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[contract-fully-signed-emails] send to ${r.email} failed:`, msg)
        failed.push({ email: r.email, error: msg })
      }
    }

    // ── Audit log ────────────────────────────────────────────────────
    await writeAudit(database, contractId, sent, sent.length > 0 ? 'sent' : 'failed', {
      sent,
      failed,
      pdfAttached: pdfBase64 !== null,
      pdfError,
      pdfBytesBase64: pdfBase64?.length ?? 0,
      from: FROM_NAME,
    })
  } catch (err) {
    // Top-level catch so any unforeseen failure (PDF render crash, D1
    // hiccup, etc) doesn't crash the parent waitUntil promise.
    console.error('[contract-fully-signed-emails] fatal error:', err)
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'contract'
}

async function writeAudit(
  database: D1,
  contractId: string,
  recipients: string[],
  outcome: 'sent' | 'skipped_no_resend_key' | 'failed',
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await database.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: null,
      actorType: 'system',
      action: 'contract_fully_signed_emails_sent',
      entityType: 'contract',
      entityId: contractId,
      metadata: JSON.stringify({
        outcome,
        recipients,
        ...metadata,
      }),
      ipAddress: null,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[contract-fully-signed-emails] audit log write failed:', err)
  }
}
