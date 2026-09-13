/**
 * <ContractSignatureEmail>: admin-facing notification when one signer of a
 * multi-party e-sign contract signs while others are still pending.
 *
 * Distinct from <ContractFullySignedEmail>, which goes to every party once
 * the LAST signature lands and carries the stamped PDF. This one is the
 * partial-signature progress ping, studio-audience only, built here in S2 for
 * S4's contract sign route to call once it wires the event.
 */
import {
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
} from './_components'

interface ContractSignatureEmailProps {
  contractId: string
  contractName: string
  clientName: string
  signerName: string
  signerRole?: string | null
  /** How many signers are still pending after this one. */
  remainingSigners: number
  dashboardUrl: string
}

export function ContractSignatureEmail({
  contractId,
  contractName,
  clientName,
  signerName,
  signerRole,
  remainingSigners,
  dashboardUrl,
}: ContractSignatureEmailProps) {
  const contractUrl = `${dashboardUrl}/contracts/${contractId}`
  const remainingCopy =
    remainingSigners <= 0
      ? 'That was the last signature.'
      : `${remainingSigners} signer${remainingSigners === 1 ? '' : 's'} still pending.`

  return (
    <EmailDocument preview={`${signerName} signed "${contractName}"`}>
      <EmailCard>
        <EmailNav label="Contract signed" />

        <EmailHero>
          <EmailKicker>Contract signed</EmailKicker>
          <EmailParagraph variant="muted">
            {signerName} signed &quot;{contractName}&quot; for {clientName}. {remainingCopy}
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Contract" value={contractName} />
            <LedgerRow label="Client" value={clientName} />
            <LedgerRow label="Signed by" value={signerRole ? `${signerName} (${signerRole})` : signerName} />
          </LedgerRows>

          <PrimaryButton href={contractUrl}>Open the contract</PrimaryButton>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default ContractSignatureEmail
