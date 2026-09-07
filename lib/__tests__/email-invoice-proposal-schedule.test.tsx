/**
 * Render tests for the four templates ported to the Studio Ledger kit:
 * invoice-sent, invoice-overdue, proposal-share, schedule-share.
 *
 * Each renders through @react-email/render, the same path the send routes
 * use, and asserts the subject-carrying facts survive the port (amount,
 * invoice reference, due date, proposal/schedule title, view links) and that
 * no em or en dash reaches the wire.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

import { InvoiceSentEmail } from '@/emails/invoice-sent'
import { InvoiceOverdueEmail } from '@/emails/invoice-overdue'
import { ProposalShareEmail } from '@/emails/proposal-share'
import { ScheduleShareEmail } from '@/emails/schedule-share'

// En dash (U+2013) and em dash (U+2014), built from code points so this file
// never carries one either.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

describe('InvoiceSentEmail', () => {
  it('carries the amount, invoice reference and both links', async () => {
    const html = await render(
      InvoiceSentEmail({
        clientName: 'Ngaire',
        invoiceId: 'inv_1234567890',
        invoiceNumber: 'INV-2026-0042',
        amountFormatted: '4,312.50',
        currency: 'NZD',
        dueDate: '12 Oct 2026',
        notes: 'Spring campaign work.',
        invoiceUrl: 'https://portal.tahi.studio/invoices/inv_1234567890',
        paymentUrl: 'https://portal.tahi.studio/invoices/inv_1234567890/pay',
      }),
    )

    expect(html).toContain('4,312.50')
    expect(html).toContain('NZD')
    expect(html).toContain('INV-2026-0042')
    expect(html).toContain('https://portal.tahi.studio/invoices/inv_1234567890/pay')
    expect(html).toContain('https://portal.tahi.studio/invoices/inv_1234567890')
    expect(html).toContain('Pay invoice')
    expect(html).not.toMatch(DASHES)
  })

  it('falls back to View invoice when there is no pay page', async () => {
    const html = await render(
      InvoiceSentEmail({
        clientName: 'Ngaire',
        invoiceId: 'inv_1234567890',
        amountFormatted: '4,312.50',
        currency: 'NZD',
        invoiceUrl: 'https://portal.tahi.studio/invoices/inv_1234567890',
      }),
    )

    expect(html).toContain('View invoice')
    expect(html).not.toContain('Pay invoice')
    expect(html).not.toMatch(DASHES)
  })
})

describe('InvoiceOverdueEmail', () => {
  it('carries the days overdue and the amount due', async () => {
    const html = await render(
      InvoiceOverdueEmail({
        clientName: 'Ngaire',
        invoiceId: 'inv_1234567890',
        invoiceNumber: 'INV-2026-0042',
        amountFormatted: '4,312.50',
        currency: 'NZD',
        dueDate: '12 Oct 2026',
        daysOverdue: 12,
        dashboardUrl: 'https://portal.tahi.studio',
        paymentUrl: 'https://portal.tahi.studio/invoices/inv_1234567890/pay',
      }),
    )

    expect(html).toContain('12')
    expect(html).toContain('4,312.50')
    expect(html).toContain('INV-2026-0042')
    expect(html).toContain('Pay now')
    expect(html).not.toMatch(DASHES)
  })
})

describe('ProposalShareEmail', () => {
  it('carries the proposal title, sender and the view link', async () => {
    const html = await render(
      ProposalShareEmail({
        recipientName: 'Ngaire',
        proposalTitle: 'Mahana Orchards spring campaign',
        proposalSubtitle: 'Landing page and booking flow',
        viewUrl: 'https://portal.tahi.studio/p/proposal/prv_8ad4e21f60b9',
        fromName: 'Liam Miller',
        customMessage: 'Two options inside.',
        expiresAt: new Date('2026-10-01').toISOString(),
      }),
    )

    expect(html).toContain('Mahana Orchards spring campaign')
    expect(html).toContain('Landing page and booking flow')
    expect(html).toContain('https://portal.tahi.studio/p/proposal/prv_8ad4e21f60b9')
    expect(html).toContain('Liam Miller')
    expect(html).toContain('Two options inside.')
    expect(html).toContain('View proposal')
    expect(html).toContain('1 Oct 2026')
    expect(html).not.toContain('Oct 1, 2026')
    expect(html).not.toMatch(DASHES)
  })

  it('dates the expiry in New Zealand, where the reader is', async () => {
    // 21:30 UTC on 27 September is already 28 September in New Zealand.
    const html = await render(
      ProposalShareEmail({
        recipientName: 'Ngaire',
        proposalTitle: 'Mahana Orchards spring campaign',
        viewUrl: 'https://portal.tahi.studio/p/proposal/prv_8ad4e21f60b9',
        fromName: 'Liam Miller',
        expiresAt: '2026-09-27T21:30:00.000Z',
      }),
    )
    expect(html).toContain('28 Sept 2026')
  })
})

describe('ScheduleShareEmail', () => {
  it('carries the schedule title, sender and the view link', async () => {
    const html = await render(
      ScheduleShareEmail({
        recipientName: 'Ngaire',
        scheduleTitle: 'Mahana Orchards spring campaign',
        scheduleSubtitle: 'Six weeks, design through to launch',
        viewUrl: 'https://portal.tahi.studio/p/schedule/prv_51ce90d3f8a2',
        fromName: 'Staci Bonnie',
        customMessage: 'Dates assume we have the photography by next week.',
        targetLaunchDate: new Date('2026-11-01').toISOString(),
      }),
    )

    expect(html).toContain('Mahana Orchards spring campaign')
    expect(html).toContain('Six weeks, design through to launch')
    expect(html).toContain('https://portal.tahi.studio/p/schedule/prv_51ce90d3f8a2')
    expect(html).toContain('Staci Bonnie')
    expect(html).toContain('View schedule')
    expect(html).toContain('1 Nov 2026')
    expect(html).not.toContain('Nov 1, 2026')
    expect(html).not.toMatch(DASHES)
  })

  it('dates the target launch in New Zealand, where the reader is', async () => {
    const html = await render(
      ScheduleShareEmail({
        recipientName: 'Ngaire',
        scheduleTitle: 'Mahana Orchards spring campaign',
        viewUrl: 'https://portal.tahi.studio/p/schedule/prv_51ce90d3f8a2',
        fromName: 'Staci Bonnie',
        targetLaunchDate: '2026-10-18T21:30:00.000Z',
      }),
    )
    expect(html).toContain('19 Oct 2026')
  })
})
