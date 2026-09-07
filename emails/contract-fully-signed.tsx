/**
 * <ContractFullySignedEmail>: covering email sent to every signer plus the
 * contract creator the moment a contract becomes fully signed.
 *
 * The signed PDF is attached to this email by the route that sends it.
 * This template just announces the signature is complete and points the
 * recipient at both the attachment and the live public viewer. Studio
 * Ledger, Work family: neutral kicker, ledger rows, one View button.
 */
import { STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  NoteBox,
  PrimaryButton,
} from './_components'

interface Props {
  recipientName: string
  // Was this recipient one of the signers? Drives the greeting copy.
  recipientWasSigner: boolean
  contractName: string
  contractType: string
  signedAt: string
  publicViewerUrl: string
  // Display-only: list of signer names so the recipient can see the
  // full party set on the agreement.
  signerNames: string[]
  // Whether the PDF render succeeded and is attached to this email.
  // When false, the body copy + CTA push the public viewer link instead
  // of mentioning the attachment. Defaults to true for backwards compat.
  pdfAttached?: boolean
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
 * "5 Sept 2026, 3:15 pm" in the studio's zone. The sender runs on a worker
 * whose clock is UTC, so without the zone the stamp would be hours out.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: STUDIO_TIME_ZONE,
  })
}

export function ContractFullySignedEmail({
  recipientName,
  recipientWasSigner,
  contractName,
  contractType,
  signedAt,
  publicViewerUrl,
  signerNames,
  pdfAttached = true,
}: Props) {
  const typeLabel = TYPE_LABEL[contractType] ?? 'contract'
  const firstName = recipientName.split(' ')[0] ?? recipientName
  const partyList = signerNames.length > 0 ? signerNames.join(', ') : 'all signing parties'
  const preview = pdfAttached
    ? `${contractName} is fully signed. PDF attached.`
    : `${contractName} is fully signed. View the signed copy.`

  return (
    <EmailDocument preview={preview}>
      <EmailCard>
        <EmailNav label="Contract" />
        <EmailHero>
          <EmailKicker tone="neutral">{typeLabel}</EmailKicker>
          <EmailHeading>
            {recipientWasSigner
              ? `Thanks for your signature, ${firstName}.`
              : `Kia ora ${firstName}, your contract is fully signed.`}
          </EmailHeading>
          <EmailParagraph>
            {pdfAttached
              ? `Every signer has now added their signature, so ${contractName} is fully executed. A PDF copy of the signed agreement is attached for your records.`
              : `Every signer has now added their signature, so ${contractName} is fully executed. View the signed agreement online via the link below, it carries every signature, the signed-on timestamps, and the audit-trail anchor.`}
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Contract" value={contractName} tone="brand" />
            <LedgerRow label="Type" value={typeLabel} />
            <LedgerRow label="Signed by" value={partyList} />
            <LedgerRow label="Fully signed at" value={formatTimestamp(signedAt)} />
          </LedgerRows>

          <Buttons>
            <PrimaryButton href={publicViewerUrl}>View signed contract</PrimaryButton>
          </Buttons>

          <EmailParagraph variant="small">
            {pdfAttached
              ? 'The attached PDF includes every signature, the signed-on timestamp, and the SHA-256 chain anchor that makes any future tampering with the original record detectable. Keep it somewhere safe.'
              : 'The signed contract page above shows every signature, the signed-on timestamp, and the SHA-256 chain anchor that makes any future tampering with the original record detectable. Use print to PDF in your browser if you need a local copy.'}
          </EmailParagraph>

          <NoteBox tone="brand">Confidential to the signing parties.</NoteBox>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default ContractFullySignedEmail

// Re-export for downstream callers that want a single explicit prop type.
export type { Props as ContractFullySignedEmailProps }
