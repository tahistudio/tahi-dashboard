/**
 * <ContractSignEmail> — the "please sign this contract" email.
 *
 * Sent to a single signer with a unique sign URL bound to their token.
 * Studio Ledger, Work family: nav band, kicker, H1, ledger rows, one
 * primary button. No em or en dashes.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  EmailShell,
  LedgerRow,
  LedgerRows,
  Mono,
  NoteBox,
  PrimaryButton,
  SignOff,
  emailBodyStyle,
} from './_components'

interface ContractSignEmailProps {
  signerName: string
  signerRole: string // 'tahi' | 'client' | 'other'
  contractName: string
  contractType: string // 'sow' | 'msa' | etc
  signUrl: string
  fromName: string // who is sending, e.g. "Liam Miller"
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
    <Html lang="en">
      <Head />
      <Preview>{`${fromName} has shared a ${typeLabel.toLowerCase()} for your signature`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailCard>
            <EmailNav label="Sign" />
            <EmailHero>
              <EmailKicker>{typeLabel}</EmailKicker>
              <EmailHeading>
                {isInternal ? `Kia ora ${firstName}, your signature is needed.` : `Kia ora ${firstName}, ready for your signature.`}
              </EmailHeading>
              <EmailParagraph>
                {isInternal
                  ? `Please sign the ${typeLabel.toLowerCase()} below. The link is unique to you and the signing flow takes about a minute.`
                  : `${fromName} has shared a ${typeLabel.toLowerCase()} with you for review and signature. Click through to read it in full and add your signature on the page.`}
              </EmailParagraph>
            </EmailHero>
            <EmailBody>
              <LedgerRows>
                <LedgerRow label="Contract" value={contractName} tone="brand" />
                <LedgerRow label="Type" value={typeLabel} />
                <LedgerRow label="Signing as" value={signerName} />
              </LedgerRows>

              {customMessage ? (
                <NoteBox tone="neutral" title={`A note from ${fromName}`}>
                  {customMessage}
                </NoteBox>
              ) : null}

              <Buttons>
                <PrimaryButton href={signUrl}>Review and sign</PrimaryButton>
              </Buttons>

              <EmailParagraph variant="small">
                Confidential to the named recipient. Each signature is anchored to a tamper-evident{' '}
                <Mono>SHA-256</Mono> chain, and your IP is hashed, never stored in plain text. The link
                expires when the contract is fully signed or cancelled.
              </EmailParagraph>
            </EmailBody>
            <SignOff name={fromName} />
          </EmailCard>

          <EmailFooter audience={isInternal ? 'team' : 'client'} />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default ContractSignEmail
