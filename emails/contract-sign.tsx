/**
 * <ContractSignEmail> — the "please sign this contract" email.
 *
 * Sent to a single signer with a unique sign URL bound to their token.
 * Visual language matches the proposal viewer + the rest of the email
 * suite via the shared `_components.tsx` primitives. One brand-green
 * accent word in the heading. No em or en dashes.
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
  MessageBlock,
  Mono,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

interface ContractSignEmailProps {
  signerName: string
  signerRole: string                // 'tahi' | 'client' | 'other'
  contractName: string
  contractType: string              // 'sow' | 'msa' | etc
  signUrl: string
  fromName: string                  // who is sending — e.g. "Liam Miller"
  customMessage?: string | null
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'contract',
}

export function ContractSignEmail({
  signerName,
  signerRole,
  contractName,
  contractType,
  signUrl,
  fromName,
  customMessage,
}: ContractSignEmailProps) {
  const isInternal = signerRole === 'tahi'
  const typeLabel = TYPE_LABEL[contractType] ?? 'contract'
  const firstName = signerName.split(' ')[0] ?? signerName

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} has shared a ${typeLabel.toLowerCase()} for your signature`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="A contract for your signature" />

          <EmailCard>
            <EmailEyebrow>{typeLabel}</EmailEyebrow>
            <EmailHeading>
              {isInternal
                ? <>Your <span style={{ color: '#5A824E' }}>signature</span> is needed</>
                : <>Ready for your <span style={{ color: '#5A824E' }}>signature</span></>
              }
            </EmailHeading>

            <EmailParagraph>Hi {firstName},</EmailParagraph>
            <EmailParagraph>
              {isInternal
                ? `Please sign the ${typeLabel.toLowerCase()} below. The link is unique to you and the signing flow takes about a minute.`
                : `${fromName} has shared a ${typeLabel.toLowerCase()} with you for review and signature. Click through to read it in full and add your signature on the page.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Contract" value={contractName} hero />
              <DetailRow label="Type" value={typeLabel} />
              <DetailRow label="Signing as" value={signerName} />
            </DetailCard>

            {customMessage && (
              <MessageBlock fromName={fromName} message={customMessage} />
            )}

            <PrimaryButton href={signUrl}>Review and sign</PrimaryButton>

            <EmailBanner kind="info">Confidential to the named recipient</EmailBanner>

            <EmailFootnote framed>
              Each signature is anchored to a tamper-evident <Mono>SHA-256</Mono> chain. Your
              IP is hashed, never stored in plain text. The link is unique to you and expires
              when the contract is fully signed or cancelled.
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ContractSignEmail
