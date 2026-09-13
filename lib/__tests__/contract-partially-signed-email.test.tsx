/**
 * Render test for emails/contract-partially-signed.tsx, the studio-facing
 * covering email lib/contract-signature-notify.ts sends on a mid-flight
 * contract signature. Mirrors the pattern in
 * lib/__tests__/email-templates-contracts-calls.test.tsx: real HTML through
 * @react-email/render, checked for the facts a reader needs and the hard
 * no-dash rule.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'
import { ContractPartiallySignedEmail } from '@/emails/contract-partially-signed'

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

describe('ContractPartiallySignedEmail', () => {
  it('names the signer, the contract, and how many signers remain', async () => {
    const html = await render(
      ContractPartiallySignedEmail({
        contractName: 'Acme Statement of Work',
        contractType: 'sow',
        signerName: 'Jo Yarnall',
        signedCount: 1,
        totalSigners: 2,
        viewerUrl: 'https://tahi.studio/contracts/doc-1',
      }),
    )
    expect(html).toContain('Acme Statement of Work')
    expect(html).toContain('Jo Yarnall')
    expect(html).toContain('Statement of work')
    expect(html).toContain('1 of 2')
    expect(html).toContain('https://tahi.studio/contracts/doc-1')
    expect(html).not.toMatch(DASHES)
  })

  it('does not claim anyone is left waiting once the count already matches (defensive against a race)', async () => {
    const html = await render(
      ContractPartiallySignedEmail({
        contractName: 'Beta MSA',
        contractType: 'msa',
        signerName: 'Liam Miller',
        signedCount: 2,
        totalSigners: 2,
        viewerUrl: 'https://tahi.studio/contracts/doc-2',
      }),
    )
    expect(html).not.toContain('Waiting on')
    expect(html).not.toMatch(DASHES)
  })
})
