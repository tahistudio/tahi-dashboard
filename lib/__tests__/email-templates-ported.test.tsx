/**
 * Render tests for the five templates ported to the Studio Ledger kit in
 * this pass: new-request, request-client-review, request-delivered,
 * new-message, new-channel-message.
 *
 * Each renders to real HTML through @react-email/render and is checked for
 * the key facts the reader needs and the hard no-dash rule.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

import NewRequestEmail from '@/emails/new-request'
import RequestClientReviewEmail from '@/emails/request-client-review'
import RequestDeliveredEmail from '@/emails/request-delivered'
import NewMessageEmail from '@/emails/new-message'
import NewChannelMessageEmail from '@/emails/new-channel-message'

// En dash (U+2013) and em dash (U+2014), built from code points so this file
// never carries one either.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

describe('NewRequestEmail', () => {
  it('renders the title, client, category, priority and a working link, with no dash', async () => {
    const html = await render(
      NewRequestEmail({
        requestTitle: 'Refresh the pricing page',
        clientName: 'Acme Co',
        category: 'Design',
        priority: 'High',
        submittedBy: 'Jo Chen',
        dashboardUrl: 'https://portal.tahi.studio',
        requestId: 'abcd1234-5678-90ef-ghij-klmnopqrstuv',
      }),
    )
    expect(html).toContain('Refresh the pricing page')
    expect(html).toContain('Acme Co')
    expect(html).toContain('Design')
    expect(html).toContain('High')
    expect(html).toContain('Jo Chen')
    expect(html).toContain('https://portal.tahi.studio/requests/abcd1234-5678-90ef-ghij-klmnopqrstuv')
    expect(html).not.toMatch(DASHES)
  })

  it('shows the request number as the reference and never a UUID fragment', async () => {
    const numbered = await render(
      NewRequestEmail({
        requestTitle: 'Refresh the pricing page',
        clientName: 'Acme Co',
        dashboardUrl: 'https://portal.tahi.studio',
        requestId: '0a4f1b6c-5678-90ef-ghij-klmnopqrstuv',
        requestNumber: 42,
      }),
    )
    expect(numbered).toContain('REQ-42')
    expect(numbered).not.toContain('REQ-0A4F1B6C')

    const unnumbered = await render(
      NewRequestEmail({
        requestTitle: 'Refresh the pricing page',
        clientName: 'Acme Co',
        dashboardUrl: 'https://portal.tahi.studio',
        requestId: '0a4f1b6c-5678-90ef-ghij-klmnopqrstuv',
        requestNumber: null,
      }),
    )
    expect(unnumbered).not.toContain('REQ-')
    expect(unnumbered).not.toContain('Reference')
  })
})

describe('RequestClientReviewEmail', () => {
  it('renders the request title, reference and review link, with no dash', async () => {
    const html = await render(
      RequestClientReviewEmail({
        recipientName: 'Ngaire',
        requestTitle: 'Homepage hero refresh',
        requestNumber: 42,
        reviewUrl: 'https://portal.tahi.studio/requests/42',
      }),
    )
    expect(html).toContain('Homepage hero refresh')
    expect(html).toContain('REQ-42')
    expect(html).toContain('https://portal.tahi.studio/requests/42')
    expect(html).toContain('Ngaire')
    expect(html).not.toMatch(DASHES)
  })
})

describe('RequestDeliveredEmail', () => {
  it('renders the request, client, delivered date and view link, with no dash', async () => {
    const html = await render(
      RequestDeliveredEmail({
        requestTitle: 'Landing page redesign',
        recipientName: 'Ngaire',
        clientName: 'Acme Co',
        deliveredAt: '2026-09-01',
        requestUrl: 'https://portal.tahi.studio/requests/99',
      }),
    )
    expect(html).toContain('Landing page redesign')
    expect(html).toContain('Acme Co')
    expect(html).toContain('2026-09-01')
    expect(html).toContain('https://portal.tahi.studio/requests/99')
    expect(html).not.toMatch(DASHES)
  })
})

describe('NewMessageEmail', () => {
  it('renders the sender, message and reference for the client audience, with no dash', async () => {
    const html = await render(
      NewMessageEmail({
        audience: 'client',
        recipientName: 'Ngaire',
        requestTitle: 'Homepage hero refresh',
        requestNumber: 14,
        fromName: 'Staci Bonnie',
        message: 'Two things to look at before Friday.',
        requestUrl: 'https://portal.tahi.studio/requests/14',
      }),
    )
    expect(html).toContain('Staci Bonnie')
    expect(html).toContain('Two things to look at before Friday.')
    expect(html).toContain('REQ-14')
    expect(html).toContain('https://portal.tahi.studio/requests/14')
    expect(html).not.toMatch(DASHES)
  })

  it('renders the studio-facing wording when a client replied', async () => {
    const html = await render(
      NewMessageEmail({
        audience: 'studio',
        recipientName: 'Liam',
        requestTitle: 'Homepage hero refresh',
        requestNumber: 14,
        fromName: 'Jo Chen',
        message: 'Can we push the launch a day?',
        requestUrl: 'https://portal.tahi.studio/admin/requests/14',
      }),
    )
    expect(html).toContain('Jo Chen')
    expect(html).toContain('waiting on the studio')
    expect(html).not.toMatch(DASHES)
  })
})

describe('NewChannelMessageEmail', () => {
  it('renders the sender, org and message, with no dash', async () => {
    const html = await render(
      NewChannelMessageEmail({
        audience: 'client',
        recipientName: 'Ngaire',
        orgName: 'Acme Co',
        fromName: 'Liam Miller',
        message: 'Sent through the updated brief.',
        messagesUrl: 'https://portal.tahi.studio/messages',
      }),
    )
    expect(html).toContain('Liam Miller')
    expect(html).toContain('Sent through the updated brief.')
    expect(html).toContain('https://portal.tahi.studio/messages')
    expect(html).not.toMatch(DASHES)
  })

  it('renders the client name for the studio audience', async () => {
    const html = await render(
      NewChannelMessageEmail({
        audience: 'studio',
        recipientName: 'Liam',
        orgName: 'Acme Co',
        fromName: 'Jo Chen',
        message: 'Quick one about next month.',
        messagesUrl: 'https://portal.tahi.studio/admin/messages',
      }),
    )
    expect(html).toContain('Acme Co')
    expect(html).toContain('Jo Chen')
    expect(html).not.toMatch(DASHES)
  })
})
