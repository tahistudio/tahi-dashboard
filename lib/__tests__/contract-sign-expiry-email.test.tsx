import { describe, expect, it } from 'vitest'
import { render } from '@react-email/render'
import { ContractSignEmail } from '@/emails/contract-sign'

const props = {
  signerName: 'QA Signer', signerRole: 'client', contractName: 'QA Statement of Work',
  contractType: 'sow', signUrl: 'https://portal.example.test/p/contract/qa/sign/signer',
  fromName: 'Liam Miller',
}

describe('ContractSignEmail signing deadline', () => {
  it.each([null, '2026-09-30T10:59:59.999Z'])('separates the link and expiry wording in readable email text (%s)', async (expiresAt) => {
    const text = await render(ContractSignEmail({ ...props, expiresAt }), { plainText: true })
    expect(text).toContain('The link expires')
    expect(text).not.toContain('The linkexpires')
  })

  it('renders the Auckland deadline in the ledger and in the expiry explanation', async () => {
    const html = await render(ContractSignEmail({ ...props, expiresAt: '2026-09-30T10:59:59.999Z' }))
    expect(html).toContain('Sign by')
    expect(html.match(/30 September 2026/g)).toHaveLength(2)
    expect(html.match(/11:59\s*pm/g)).toHaveLength(2)
    expect(html.match(/\(New Zealand time\)/g)).toHaveLength(2)
    expect(html).toContain('or earlier when the contract is fully signed or cancelled.')
    expect(html).toContain(props.signUrl)
    expect(html).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`))
  })

  it('names the actual legacy instant even though the admin date field preserves the original selected day', async () => {
    const html = await render(ContractSignEmail({ ...props, expiresAt: '2026-09-30T23:59:59.000Z' }))
    expect(html.match(/1 October 2026/g)).toHaveLength(2)
    expect(html.match(/12:59\s*pm/g)).toHaveLength(2)
    expect(html).not.toContain('30 September 2026')
  })

  it.each([null, undefined])('omits Sign by when no deadline exists (%s)', async (expiresAt) => {
    const html = await render(ContractSignEmail({ ...props, expiresAt }))
    expect(html).not.toContain('Sign by')
    expect(html).not.toContain('New Zealand time')
    expect(html).toContain('expires when the contract is fully signed or cancelled.')
  })
})
