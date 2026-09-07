/**
 * lib/__tests__/email-templates-studio-ledger.test.tsx
 *
 * Render checks for the five templates ported to the Studio Ledger kit in
 * this pass: welcome, client-invite, kickoff-booked, review-request and
 * announcement. Each renders to real HTML through @react-email/render (the
 * same path the send routes use), keeps the fact the reader needs on the
 * page, and never carries an em or en dash to the wire.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

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

  it('dates the expiry in New Zealand rather than UTC', async () => {
    // 21:30 UTC on 20 September is 09:30 on the 21st in Whanganui. UTC said
    // "20 September", a day short of what the link actually allows.
    const html = await render(
      WelcomeEmail({
        contactName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        dashboardUrl: 'https://portal.tahi.studio/accept-invite?token=abc123',
        boundEmail: 'ngaire@mahana.co.nz',
        expiresAt: '2026-09-20T21:30:00.000Z',
      }),
    )
    expect(html).toContain('21 September 2026')
    expect(html).not.toContain('20 September 2026')
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
    expect(html).not.toMatch(DASHES)
  })

  it('dates the expiry in New Zealand rather than UTC', async () => {
    const html = await render(
      ClientInviteEmail({
        contactName: 'Ngaire Hutchins',
        orgName: 'Mahana Orchards',
        inviteUrl: 'https://portal.tahi.studio/accept-invite?token=xyz789',
        boundEmail: 'ngaire@mahana.co.nz',
        expiresAt: '2026-09-20T21:30:00.000Z',
      }),
    )
    expect(html).toContain('21 September 2026')
    expect(html).not.toContain('20 September 2026')
  })
})

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
    expect(html).not.toMatch(DASHES)
  })
})

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
    expect(html).not.toMatch(DASHES)
  })

  it('tints the kicker by type and keeps the white button on the forest band', async () => {
    const base = {
      title: 'A note from the studio',
      body: 'One paragraph.',
      ctaLabel: 'Open your portal',
      ctaUrl: 'https://portal.tahi.studio/',
    }
    const info = await render(AnnouncementEmail({ ...base, type: 'info' }))
    const success = await render(AnnouncementEmail({ ...base, type: 'success' }))
    const warning = await render(AnnouncementEmail({ ...base, type: 'warning' }))
    const maintenance = await render(AnnouncementEmail({ ...base, type: 'maintenance' }))

    expect(info).toContain('color:#A9C4E0')
    expect(success).toContain('color:#93C98A')
    expect(warning).toContain('color:#E6C27A')
    expect(maintenance).toContain('color:#E6C27A')
    expect(info).not.toContain('#E6C27A')
    expect(maintenance).not.toContain('#A9C4E0')
    for (const html of [info, success, warning, maintenance]) {
      expect(html).toMatch(/<a href="https:\/\/portal\.tahi\.studio\/"[^>]*color:#1E2A1B[^>]*background-color:#ffffff/)
    }
  })
})
