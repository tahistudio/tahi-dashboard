/**
 * lib/contract-signature-notify.ts
 *
 * Studio-facing notification for every contract signature event, not just the
 * last one. Before this module the sign route did nothing at all on a
 * mid-flight signature: the bell only fired implicitly (nothing called it),
 * and the only email anyone ever got was the fully-signed covering email sent
 * to signers and the creator once every party had signed. A studio member
 * could open a two-signer contract believing it untouched when one party had
 * already signed it days earlier.
 *
 * Every signature now gets a bell (notifyAllAdmins) and, when it leaves the
 * contract partially signed, a covering email so "someone signed" never
 * depends on somebody noticing the bell. The final signature keeps its own
 * richer email (lib/contract-fully-signed-emails.ts, the signed PDF, sent to
 * every signer and the creator), so this module does not duplicate that send;
 * it only adds the bell and the deal activity row for the final case.
 *
 * Both halves are best effort: a notification failure must never surface to
 * the signer whose POST triggered it.
 */
import { schema } from '@/db/d1'
import { render as renderEmail } from '@react-email/render'
import { notifyAllAdmins } from '@/lib/notifications'
import { ContractPartiallySignedEmail } from '@/emails/contract-partially-signed'
import { deliverEmail, resolveDeliveryPolicy } from '@/lib/email-delivery'
import { emailFromAddress } from '@/lib/email-from'
import { publicUrl } from '@/lib/app-url'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface ContractSignatureNotifyInput {
  contractId: string
  contractName: string
  contractType: string
  orgId: string | null
  dealId: string | null
  signerName: string
  totalSigners: number
  signedCount: number
  /** True once this signature left every signer at 'signed'. */
  final: boolean
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'contract',
}

/**
 * Tell the studio a signature landed: bell to every team member, a deal
 * activity row when this contract is linked to one, and (for a partial
 * signature only) a covering email so the mid-flight case is never silent.
 */
export async function notifyStudioOfContractSignature(
  database: D1,
  input: ContractSignatureNotifyInput,
): Promise<void> {
  const typeLabel = TYPE_LABEL[input.contractType] ?? 'contract'
  const eventType = input.final ? 'contract_signed' : 'contract_partially_signed'
  const title = input.final
    ? `${input.contractName} is fully signed`
    : `${input.signerName} signed ${input.contractName}`
  const body = input.final
    ? `Every signer has now signed this ${typeLabel}.`
    : `${input.signedCount} of ${input.totalSigners} signers have signed so far.`

  try {
    await notifyAllAdmins(database, {
      type: eventType,
      title,
      body,
      entityType: 'contract',
      entityId: input.contractId,
    })
  } catch (err) {
    console.error('[contract-signature-notify] bell failed:', err)
  }

  if (input.dealId) {
    try {
      const now = new Date().toISOString()
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: input.final ? 'contract_fully_signed' : 'contract_partially_signed',
        title,
        description: body,
        dealId: input.dealId,
        createdById: 'system',
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    } catch (err) {
      console.error('[contract-signature-notify] activity log failed:', err)
    }
  }

  // The final signature gets its own richer email (signed PDF, addressed to
  // every signer and the creator) from lib/contract-fully-signed-emails.ts.
  // A partial signature has nothing until this, so it is the only email this
  // module sends.
  if (input.final) return
  if (!process.env.RESEND_API_KEY) return

  try {
    const admins = await database
      .select({ name: schema.teamMembers.name, email: schema.teamMembers.email })
      .from(schema.teamMembers)
    const policy = await resolveDeliveryPolicy()
    const html = await renderEmail(ContractPartiallySignedEmail({
      contractName: input.contractName,
      contractType: input.contractType,
      signerName: input.signerName,
      signedCount: input.signedCount,
      totalSigners: input.totalSigners,
      viewerUrl: publicUrl(`/contracts/${input.contractId}`),
    }))
    for (const admin of admins) {
      if (!admin.email?.trim()) continue
      await deliverEmail({
        from: emailFromAddress(),
        to: admin.email,
        subject: `${input.signerName} signed ${input.contractName}`,
        html,
        template: 'contract-partially-signed',
        orgId: input.orgId,
        policy,
      })
    }
  } catch (err) {
    console.error('[contract-signature-notify] studio email failed:', err)
  }
}
