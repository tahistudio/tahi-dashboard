/**
 * <ContractPartiallySignedEmail>: studio-facing notification the moment ONE
 * signer signs a multi-party contract that is not yet fully executed.
 *
 * Before this template the studio heard nothing at all until the final
 * signature landed: an in-flight signature on a two-or-more-signer contract
 * produced no bell and no email, so a team member could read a contract as
 * untouched when one party had already signed it. This is the covering email
 * for that gap. lib/contract-signature-notify.ts sends it alongside the bell
 * (notifyAllAdmins, event 'contract_partially_signed'); the fully-signed
 * event keeps its own template (emails/contract-fully-signed.tsx), sent to
 * every signer and the creator, not just the studio.
 */
import {
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
  PrimaryButton,
} from './_components'

interface Props {
  contractName: string
  contractType: string
  signerName: string
  signedCount: number
  totalSigners: number
  viewerUrl: string
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'Contract',
}

export function ContractPartiallySignedEmail({
  contractName,
  contractType,
  signerName,
  signedCount,
  totalSigners,
  viewerUrl,
}: Props) {
  const typeLabel = TYPE_LABEL[contractType] ?? 'Contract'
  const remaining = Math.max(totalSigners - signedCount, 0)

  return (
    <EmailDocument preview={`${signerName} signed ${contractName}. ${remaining} signer${remaining === 1 ? '' : 's'} left.`}>
      <EmailCard>
        <EmailNav label="Contract" />
        <EmailHero>
          <EmailKicker tone="neutral">{typeLabel}</EmailKicker>
          <EmailHeading>{signerName} just signed {contractName}</EmailHeading>
          <EmailParagraph>
            {remaining > 0
              ? `${signedCount} of ${totalSigners} signers have now signed. Waiting on ${remaining} more before this contract is fully executed.`
              : `${signedCount} of ${totalSigners} signers have now signed.`}
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Contract" value={contractName} tone="brand" />
            <LedgerRow label="Type" value={typeLabel} />
            <LedgerRow label="Signed so far" value={`${signedCount} of ${totalSigners}`} />
          </LedgerRows>

          <PrimaryButton href={viewerUrl}>Open contract</PrimaryButton>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default ContractPartiallySignedEmail

export type { Props as ContractPartiallySignedEmailProps }
