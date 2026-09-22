/**
<<<<<<< HEAD
 * lib/__tests__/email-templates-studio-ledger.test.tsx
 *
 * Render checks for the five templates ported to the Studio Ledger kit in
 * this pass: welcome, client-invite, kickoff-booked, review-request and
 * announcement. Each renders to real HTML through @react-email/render (the
 * same path the send routes use), keeps the fact the reader needs on the
 * page, and never carries an em or en dash to the wire.
=======
 * Render tests for the four templates ported to the Studio Ledger kit in
 * this pass: contract-sign, contract-fully-signed, pre-call-digest,
 * project-enquiry. Each renders to real HTML through @react-email/render
 * (the same path the send routes use) and is checked for the facts a
 * reader needs and for the hard no-dash rule.
>>>>>>> worktree-wf_1dcd28f8-03b-5
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

<<<<<<< HEAD
import WelcomeEmail from '@/emails/welcome'
import ClientInviteEmail from '@/emails/client-invite'
import KickoffBookedEmail from '@/emails/kickoff-booked'
import ReviewRequestEmail from '@/emails/review-request'
import AnnouncementEmail from '@/emails/announcement'

// En dash (U+2013) and em dash (U+2014), built from code points so this file
// never carries one either.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

describe('welcome email', () => {
  it('greets the contact, names the workspace and carries the invite link', async () => {
    const html = await render(
      WelcomeEmail({
        contactName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        dashboardUrl: 'https://portal.tahi.studio/accept-invite?token=abc123',
        boundEmail: 'ngaire@mahana.co.nz',
        expiresAt: '2026-09-21T00:00:00.000Z',
      }),
    )
    expect(html).toContain('Ngaire')
    expect(html).toContain('Mahana Orchards')
    expect(html).toContain('https://portal.tahi.studio/accept-invite?token=abc123')
    expect(html).toContain('ngaire@mahana.co.nz')
    expect(html).toContain('Open your portal')
    expect(html).not.toMatch(DASHES)
  })

  it('drops the bound-email line when there is nothing bound', async () => {
    const html = await render(
      WelcomeEmail({
        contactName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        dashboardUrl: 'https://portal.tahi.studio/overview',
      }),
    )
    expect(html).not.toContain('This link only works for')
    expect(html).not.toMatch(DASHES)
  })
})

describe('client invite email', () => {
  it('carries the invite, the sender and the expiry', async () => {
    const html = await render(
      ClientInviteEmail({
        contactName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        inviteUrl: 'https://portal.tahi.studio/accept-invite?token=xyz789',
        boundEmail: 'ngaire@mahana.co.nz',
        expiresAt: '2026-09-21T00:00:00.000Z',
        fromName: 'Liam Miller',
      }),
    )
    expect(html).toContain('Ngaire')
    expect(html).toContain('Mahana Orchards')
    expect(html).toContain('Liam Miller')
    expect(html).toContain('ngaire@mahana.co.nz')
    expect(html).toContain('https://portal.tahi.studio/accept-invite?token=xyz789')
    expect(html).toContain('Accept invitation')
=======
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
>>>>>>> worktree-wf_1dcd28f8-03b-5
    expect(html).not.toMatch(DASHES)
  })
})

<<<<<<< HEAD
describe('kickoff booked email', () => {
  it('shows the join link when the studio calendar produced one', async () => {
    const html = await render(
      KickoffBookedEmail({
        contactFirstName: 'Ngaire',
        companyName: 'Mahana Orchards',
        scheduledAt: '2026-09-21T21:00:00.000Z',
        timeZone: 'Pacific/Auckland',
        durationMinutes: 45,
        hostName: 'Liam Miller',
        meetingUrl: 'https://meet.google.com/tah-kick-off',
        portalUrl: 'https://portal.tahi.studio/overview',
      }),
    )
    expect(html).toContain('Ngaire')
    expect(html).toContain('45 minutes')
    expect(html).toContain('Liam Miller')
    expect(html).toContain('Join the call')
    expect(html).toContain('https://meet.google.com/tah-kick-off')
    expect(html).not.toMatch(DASHES)
  })

  it('falls back to the portal link when there is no meeting link', async () => {
    const html = await render(
      KickoffBookedEmail({
        contactFirstName: 'Ngaire',
        companyName: 'Mahana Orchards',
        scheduledAt: '2026-09-21T21:00:00.000Z',
        timeZone: 'Pacific/Auckland',
        durationMinutes: 45,
        hostName: 'Liam Miller',
        meetingUrl: null,
        portalUrl: 'https://portal.tahi.studio/overview',
      }),
    )
    expect(html).toContain('Open your studio')
    expect(html).not.toContain('Join the call')
=======
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
>>>>>>> worktree-wf_1dcd28f8-03b-5
    expect(html).not.toMatch(DASHES)
  })
})

<<<<<<< HEAD
describe('review request email', () => {
  it('carries all three tracked answer links', async () => {
    const html = await render(
      ReviewRequestEmail({
        clientName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        respondUrl: 'https://portal.tahi.studio/p/review',
        token: 'tok_abc',
      }),
    )
    expect(html).toContain('Ngaire')
    expect(html).toContain('Mahana Orchards')
    expect(html).toContain('answer=yes')
    expect(html).toContain('answer=defer')
    expect(html).toContain('answer=no')
    expect(html).toContain('Yes, happy to')
    expect(html).not.toMatch(DASHES)
  })
})

describe('announcement email', () => {
  it('renders the CTA and every paragraph on the info tone', async () => {
    const html = await render(
      AnnouncementEmail({
        title: 'Request templates are live in your portal',
        body: 'First paragraph.\n\nSecond paragraph.',
        type: 'info',
        ctaLabel: 'See what changed',
        ctaUrl: 'https://portal.tahi.studio/requests',
      }),
    )
    expect(html).toContain('Request templates are live in your portal')
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
    expect(html).toContain('See what changed')
    expect(html).toContain('https://portal.tahi.studio/requests')
    expect(html).toContain('Info')
    expect(html).not.toMatch(DASHES)
  })

  it('drops the button when no CTA is given, on the maintenance tone', async () => {
    const html = await render(
      AnnouncementEmail({
        title: 'Portal maintenance this Sunday',
        body: 'The portal will be read only for two hours.',
        type: 'maintenance',
      }),
    )
    expect(html).toContain('Maintenance')
    expect(html).toContain('Portal maintenance this Sunday')
=======
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
>>>>>>> worktree-wf_1dcd28f8-03b-5
    expect(html).not.toMatch(DASHES)
  })
})
