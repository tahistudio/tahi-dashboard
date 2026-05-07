/**
 * <ContractFullySignedEmail> — covering email sent to every signer + the
 * contract creator the moment a contract becomes fully signed.
 *
 * The signed PDF is attached to this email by the route that sends it.
 * This template just announces the signature is complete and points the
 * recipient at both the attachment and the live public viewer.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailBanner,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailFootnote,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  emailBodyStyle,
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

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
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
  const partyList = signerNames.length > 0
    ? signerNames.join(', ')
    : 'all signing parties'

  return (
    <Html>
      <Head />
      <Preview>{pdfAttached
        ? `${contractName} is fully signed. PDF attached.`
        : `${contractName} is fully signed. View the signed copy.`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Contract fully signed" />

          <EmailCard>
            <EmailEyebrow>{typeLabel}</EmailEyebrow>
            <EmailHeading>
              {recipientWasSigner
                ? <>Thanks for your <span style={{ color: '#5A824E' }}>signature</span></>
                : <>Your contract is <span style={{ color: '#5A824E' }}>fully signed</span></>
              }
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              {pdfAttached
                ? `Every signer has now added their signature, so ${contractName} is fully executed. A PDF copy of the signed agreement is attached for your records.`
                : `Every signer has now added their signature, so ${contractName} is fully executed. View the signed agreement online via the link below — it carries every signature, the signed-on timestamps, and the audit-trail anchor.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Contract" value={contractName} hero />
              <DetailRow label="Type" value={typeLabel} />
              <DetailRow label="Signed by" value={partyList} />
              <DetailRow label="Fully signed at" value={formatTimestamp(signedAt)} />
            </DetailCard>

            <PrimaryButton href={publicViewerUrl}>View signed contract</PrimaryButton>

            <EmailFootnote>
              {pdfAttached
                ? 'The attached PDF includes every signature, the signed-on timestamp, and the SHA-256 chain anchor that makes any future tampering with the original record detectable. Keep it somewhere safe.'
                : 'The signed contract page above shows every signature, the signed-on timestamp, and the SHA-256 chain anchor that makes any future tampering with the original record detectable. Use your browser’s print-to-PDF if you need a local copy.'}
            </EmailFootnote>

            <EmailBanner kind="success">Confidential to the signing parties</EmailBanner>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ContractFullySignedEmail

// Re-export for downstream callers that want a single explicit prop type.
export type { Props as ContractFullySignedEmailProps }
