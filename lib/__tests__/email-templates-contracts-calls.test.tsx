/**
 * lib/__tests__/email-templates-contracts-calls.test.tsx
 *
 * Render tests for the four templates ported to the Studio Ledger kit in
 * this pass: contract-sign, contract-fully-signed, pre-call-digest,
 * project-enquiry. Each renders to real HTML through @react-email/render
 * (the same path the send routes use) and is checked for the facts a
 * reader needs and for the hard no-dash rule.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

import { ContractSignEmail } from '@/emails/contract-sign'
import { ContractFullySignedEmail } from '@/emails/contract-fully-signed'
import { PreCallDigestEmail } from '@/emails/pre-call-digest'
import { ProjectEnquiryEmail } from '@/emails/project-enquiry'

// En dash (U+2013) and em dash (U+2014), built from code points so this
// file never carries one either.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

describe('ContractSignEmail', () => {
  it('renders the contract name, type and sign link for a client signer', async () => {
    const html = await render(
      ContractSignEmail({
        signerName: 'Ngaire Bloom',
        signerRole: 'client',
        contractName: 'Acme Statement of Work',
        contractType: 'sow',
        signUrl: 'https://tahi.studio/p/contract/prv_1/sign/sgn_1',
        fromName: 'Liam Miller',
        customMessage: 'Shout if the dates need moving.',
      }),
    )
    expect(html).toContain('Acme Statement of Work')
    expect(html).toContain('Statement of work')
    expect(html).toContain('https://tahi.studio/p/contract/prv_1/sign/sgn_1')
    expect(html).toContain('Shout if the dates need moving.')
    expect(html).not.toMatch(DASHES)
  })

  it('swaps the heading for the internal Tahi signer', async () => {
    const html = await render(
      ContractSignEmail({
        signerName: 'Liam Miller',
        signerRole: 'tahi',
        contractName: 'Mahana MSA',
        contractType: 'msa',
        signUrl: 'https://tahi.studio/p/contract/prv_2/sign/sgn_2',
        fromName: 'Liam Miller',
      }),
    )
    expect(html).toContain('your signature is needed')
    expect(html).not.toMatch(DASHES)
  })
})

describe('ContractFullySignedEmail', () => {
  it('renders the signer list and view link, PDF-attached copy', async () => {
    const html = await render(
      ContractFullySignedEmail({
        recipientName: 'Ngaire Bloom',
        recipientWasSigner: true,
        contractName: 'Acme MSA',
        contractType: 'msa',
        signedAt: '2026-09-01T10:00:00.000Z',
        publicViewerUrl: 'https://tahi.studio/p/contract/prv_3',
        signerNames: ['Liam Miller', 'Ngaire Bloom'],
        pdfAttached: true,
      }),
    )
    expect(html).toContain('Acme MSA')
    expect(html).toContain('Liam Miller, Ngaire Bloom')
    expect(html).toContain('https://tahi.studio/p/contract/prv_3')
    expect(html).toContain('attached for your records')
    expect(html).not.toMatch(DASHES)
  })

  it('pushes the viewer link instead of the attachment copy when there is no PDF', async () => {
    const html = await render(
      ContractFullySignedEmail({
        recipientName: 'Ngaire Bloom',
        recipientWasSigner: false,
        contractName: 'Acme MSA',
        contractType: 'msa',
        signedAt: '2026-09-01T10:00:00.000Z',
        publicViewerUrl: 'https://tahi.studio/p/contract/prv_3',
        signerNames: [],
        pdfAttached: false,
      }),
    )
    expect(html).toContain('View the signed agreement online')
    expect(html).toContain('all signing parties')
    expect(html).not.toMatch(DASHES)
  })
})

describe('PreCallDigestEmail', () => {
  it('renders the call time, firmographics, AI briefing and questions', async () => {
    const html = await render(
      PreCallDigestEmail({
        callTitle: 'Discovery call',
        scheduledAt: '2026-09-06T21:30:00.000Z',
        meetingUrl: 'https://meet.google.com/tah-discovery',
        durationMinutes: 30,
        withName: 'Tim Lyons',
        withSubtitle: 'Mahana Orchards, Operations Manager',
        parentHref: '/leads/lead_1',
        dashboardUrl: 'https://portal.tahi.studio',
        industry: 'Horticulture',
        employeeCount: 48,
        aiScore: 82,
        aiSnapshot: 'Nelson grower selling direct to consumers.',
        questions: ['What does a good spring look like in dollars?'],
        sources: ['https://mahanaorchards.co.nz/about'],
      }),
    )
    expect(html).toContain('Tim Lyons')
    expect(html).toContain('Mahana Orchards, Operations Manager')
    expect(html).toContain('https://meet.google.com/tah-discovery')
    expect(html).toContain('Horticulture')
    expect(html).toContain('score 82/100')
    expect(html).toContain('What does a good spring look like in dollars?')
    expect(html).toContain('https://mahanaorchards.co.nz/about')
    expect(html).toContain('https://portal.tahi.studio/leads/lead_1')
    expect(html).not.toMatch(DASHES)
  })

  it('omits the optional sections cleanly when there is no lead context', async () => {
    const html = await render(
      PreCallDigestEmail({
        callTitle: 'Discovery call',
        scheduledAt: '2026-09-06T21:30:00.000Z',
        meetingUrl: null,
        durationMinutes: 30,
        withName: 'Tim Lyons',
        withSubtitle: null,
        parentHref: '/leads/lead_1',
        dashboardUrl: 'https://portal.tahi.studio',
      }),
    )
    expect(html).toContain('Tim Lyons')
    expect(html).not.toContain('Company')
    expect(html).not.toContain('AI briefing')
    expect(html).not.toMatch(DASHES)
  })
})

describe('ProjectEnquiryEmail', () => {
  it('renders the contact, company and brief', async () => {
    const html = await render(
      ProjectEnquiryEmail({
        contactName: 'Ngaire Bloom',
        contactEmail: 'ngaire@acme.co.nz',
        company: 'Acme Orchards',
        website: 'https://acme.co.nz',
        brief: 'We need a campaign site for the spring season.',
        budget: 'NZD 15,000 to 25,000',
        disciplines: 'Web design, Webflow build',
      }),
    )
    expect(html).toContain('Ngaire Bloom')
    expect(html).toContain('ngaire@acme.co.nz')
    expect(html).toContain('Acme Orchards')
    expect(html).toContain('We need a campaign site for the spring season.')
    expect(html).toContain('NZD 15,000 to 25,000')
    expect(html).not.toMatch(DASHES)
  })
})
