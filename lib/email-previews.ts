/**
 * lib/email-previews.ts
 *
 * One sample of every email this platform sends, so the whole set can be put
 * in front of a human in one send and judged as a set.
 *
 * WHY THIS EXISTS. A template is only ever seen in the wild by the person it
 * was written for: the client who got the invoice, the signer who got the
 * contract. Nobody at the studio ever sees the rendered result, so a broken
 * greeting, a missing due date or a CTA pointing at the wrong origin ships and
 * stays shipped. This module is the fix: `POST /api/admin/emails/preview` walks
 * the registry below and mails every one to the caller with a `[PREVIEW]`
 * subject prefix.
 *
 * THE TWO RULES THAT MAKE A PREVIEW WORTH READING:
 *
 *   1. The subject must be the REAL subject. Where the send path already builds
 *      one (the four wired notification events), the plan builder in
 *      lib/notification-email.ts is called rather than re-typed, so the preview
 *      cannot drift from production. Everywhere else the literal is copied from
 *      its route and the route is named in a comment above it, so the next
 *      person can check it in one grep.
 *
 *   2. EVERY optional prop is filled. A preview whose optional fields are
 *      undefined renders the same as a template whose optional fields are
 *      broken, which is exactly the bug this is meant to catch. So the samples
 *      pass `customMessage`, `paymentUrl`, `expiresAt`, `meetingUrl` and the
 *      rest even where the live call site does not. An empty slot in a preview
 *      is a bug in the template, never a gap in the sample.
 *
 * THE SAMPLE WORLD. One client, one request, one thread, so the set reads as a
 * single story rather than seventeen disconnected fixtures: Mahana Orchards (a
 * Nelson grower), their ops manager Ngaire Hutchins, request REQ-42 "Spring
 * campaign landing page refresh", invoice INV-1042 in NZD, dates a few days
 * either side of today. The recipient's own first name is used for every
 * greeting, so "Hi there" in a preview means the greeting fell through.
 *
 * ADDING A TEMPLATE. Add the file under `emails/`, then add one entry here.
 * lib/email-previews.test.ts fails on any template file that has no entry, so
 * a new template cannot be shipped unpreviewable.
 */

import { createElement, type ReactElement } from 'react'

import AnnouncementEmail from '@/emails/announcement'
import { ClientInviteEmail } from '@/emails/client-invite'
import { ContractFullySignedEmail } from '@/emails/contract-fully-signed'
import { ContractSignEmail } from '@/emails/contract-sign'
import { InvoiceOverdueEmail } from '@/emails/invoice-overdue'
import { InvoiceSentEmail } from '@/emails/invoice-sent'
import KickoffBookedEmail from '@/emails/kickoff-booked'
import { PreCallDigestEmail } from '@/emails/pre-call-digest'
import ProjectEnquiryEmail from '@/emails/project-enquiry'
import { ProposalShareEmail } from '@/emails/proposal-share'
import { ReviewRequestEmail } from '@/emails/review-request'
import { ScheduleShareEmail } from '@/emails/schedule-share'
import WelcomeEmail from '@/emails/welcome'

import { appOrigin, publicUrl } from '@/lib/app-url'
import { invoiceReference } from '@/lib/invoice-billing'
import {
  clientStatusEmailPlan,
  studioNewRequestEmailPlan,
  threadReplyEmailPlan,
  type EmailTarget,
} from '@/lib/notification-email'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * One template, rendered with sample data and ready to hand to `sendEmail`.
 *
 * `personalisation` is the point of the whole exercise: the fields a human is
 * being asked to check, named the way they read in the body, so the reviewer
 * can hold the email up against the list instead of guessing what should have
 * been filled in.
 */
export interface EmailPreview {
  /** The template's file name under `emails/`, without the extension. */
  key: EmailPreviewKey
  /** The subject the live send path uses, unprefixed. */
  subject: string
  /** The rendered element, ready for `sendEmail`. */
  react: ReactElement
  /** Field label -> the sample value that must appear in the body. */
  personalisation: Readonly<Record<string, string>>
}

/** What a caller gets back about a preview once it has been sent. */
export interface EmailPreviewSummary {
  key: EmailPreviewKey
  subject: string
}

export interface BuildSamplePreviewsInput {
  /** The address the preview will be mailed to, used where a template echoes it. */
  to: string
  /** The recipient's first name, used for every greeting. */
  firstName: string
}

// ─── The sample world ────────────────────────────────────────────────────────

const CLIENT_ORG = 'Mahana Orchards'
const CLIENT_CONTACT = 'Ngaire Hutchins'
const CLIENT_CONTACT_EMAIL = 'ngaire@mahanaorchards.co.nz'
const CLIENT_WEBSITE = 'https://mahanaorchards.co.nz'

const REQUEST_ID = '0a4f1b6c-7d21-4e58-9f30-2b8c5ad11e42'
const REQUEST_NUMBER = 42
const REQUEST_TITLE = 'Spring campaign landing page refresh'

const INVOICE_ID = 'inv-1042-9c31-4b77-8e05-6f1d2a94c7b3'
const INVOICE_AMOUNT = '$4,312.50'
const INVOICE_CURRENCY = 'NZD'

const LIAM = 'Liam Miller'
const STACI = 'Staci Bonnie'

const DAY_MS = 86_400_000

/** A timestamp `days` from now (negative for the past), at a readable NZ hour. */
function isoFromNow(days: number, hourUtc = 21, minute = 30): string {
  const d = new Date(Date.now() + days * DAY_MS)
  d.setUTCHours(hourUtc, minute, 0, 0)
  return d.toISOString()
}

/** The short date a template renders inline, e.g. "12 Sep 2026". */
function nzDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The recipient, in the shape the notification plan builders greet. The plans
 * take an `EmailTarget` because in production they render per person; here
 * there is exactly one person, and it is whoever asked for the previews.
 */
function previewTarget(to: string, firstName: string): EmailTarget {
  return { email: to, name: firstName, userType: 'team_member', clerkUserId: null }
}

// ─── The registry ────────────────────────────────────────────────────────────

/**
 * Every template under `emails/` except `_components.tsx` (shared primitives,
 * not a sendable email). Keys are the file names, so the test can compare this
 * list against the directory listing and fail on anything unpreviewable.
 */
export const EMAIL_PREVIEW_KEYS = [
  'announcement',
  'client-invite',
  'contract-fully-signed',
  'contract-sign',
  'invoice-overdue',
  'invoice-sent',
  'kickoff-booked',
  'new-message',
  'new-request',
  'pre-call-digest',
  'project-enquiry',
  'proposal-share',
  'request-client-review',
  'request-delivered',
  'review-request',
  'schedule-share',
  'welcome',
] as const

export type EmailPreviewKey = (typeof EMAIL_PREVIEW_KEYS)[number]

/** True when `value` names a template this module can preview. */
export function isEmailPreviewKey(value: string): value is EmailPreviewKey {
  return (EMAIL_PREVIEW_KEYS as readonly string[]).includes(value)
}

/**
 * Build one sample of every template, addressed to `to` and greeting
 * `firstName`.
 *
 * Returns them in `EMAIL_PREVIEW_KEYS` order, which is alphabetical, so a
 * reviewer's inbox arrives in a stable order every time and two runs can be
 * compared side by side.
 */
export function buildSamplePreviews({ to, firstName }: BuildSamplePreviewsInput): EmailPreview[] {
  const target = previewTarget(to, firstName)
  const origin = appOrigin()

  const requestUrl = `${origin}/requests/${REQUEST_ID}`
  const invoiceRef = invoiceReference(INVOICE_ID)
  const invoiceDueIso = isoFromNow(9)
  const overdueDueIso = isoFromNow(-12)
  const kickoffIso = isoFromNow(3, 21, 0)
  const callIso = isoFromNow(0, 22, 0)
  const signedIso = isoFromNow(-1, 3, 15)

  // (1) The four events the dispatcher already wires. The plan builders own the
  //     subject and the props in production, so they own them here too: a
  //     preview that re-typed either could pass while the real send was broken.
  const threadReply = threadReplyEmailPlan({
    audience: 'client',
    requestId: REQUEST_ID,
    requestTitle: REQUEST_TITLE,
    requestNumber: REQUEST_NUMBER,
    fromName: STACI,
    message:
      'Morning. The new hero is in with the orchard photography you sent through, and I have ' +
      'shortened the sign-up form to name, email and region. Two things to look at: the seasonal ' +
      'banner now sits above the fold on mobile, and I have swapped the CTA to "Book a pick-up".',
  })

  const clientReview = clientStatusEmailPlan({
    status: 'client_review',
    requestId: REQUEST_ID,
    requestTitle: REQUEST_TITLE,
    requestNumber: REQUEST_NUMBER,
    clientName: CLIENT_ORG,
  })

  const delivered = clientStatusEmailPlan({
    status: 'delivered',
    requestId: REQUEST_ID,
    requestTitle: REQUEST_TITLE,
    requestNumber: REQUEST_NUMBER,
    clientName: CLIENT_ORG,
    deliveredAt: isoFromNow(-1, 4, 10),
  })

  const newRequest = studioNewRequestEmailPlan({
    requestId: REQUEST_ID,
    requestTitle: REQUEST_TITLE,
    requestNumber: REQUEST_NUMBER,
    clientName: CLIENT_ORG,
    category: 'Design',
    priority: 'High',
    submittedBy: CLIENT_CONTACT,
  })

  const previews: EmailPreview[] = [
    // lib/announcement-emails.ts: subject is the announcement title verbatim.
    {
      key: 'announcement',
      subject: 'Portal maintenance this Sunday, 9pm to 11pm NZST',
      react: createElement(AnnouncementEmail, {
        title: 'Portal maintenance this Sunday, 9pm to 11pm NZST',
        body:
          'We are moving the portal onto faster infrastructure on Sunday evening. Requests, files ' +
          'and invoices will be read-only for about two hours from 9pm NZST. Nothing you have ' +
          'already sent us is affected, and anything you submit before 9pm will be waiting for us ' +
          'on Monday morning.',
        type: 'maintenance',
        ctaLabel: 'Open your portal',
        ctaUrl: publicUrl('/'),
      }),
      personalisation: {
        Title: 'Portal maintenance this Sunday, 9pm to 11pm NZST',
        Type: 'maintenance (amber banner)',
        'CTA label': 'Open your portal',
      },
    },

    // app/api/admin/clients/route.ts + app/api/admin/onboarding-invites/route.ts.
    {
      key: 'client-invite',
      subject: `Your ${CLIENT_ORG} portal is ready`,
      react: createElement(ClientInviteEmail, {
        contactName: firstName,
        orgName: CLIENT_ORG,
        inviteUrl: publicUrl('/accept-invite?token=prv_9f2c41a7d8e3'),
        boundEmail: to,
        expiresAt: isoFromNow(14),
        fromName: LIAM,
      }),
      personalisation: {
        Greeting: firstName,
        Client: CLIENT_ORG,
        'Bound address': to,
        Expires: nzDate(isoFromNow(14)),
        From: LIAM,
      },
    },

    // lib/contract-fully-signed-emails.ts: `Fully signed: ${contract.name}`.
    {
      key: 'contract-fully-signed',
      subject: `Fully signed: ${CLIENT_ORG} Master Services Agreement`,
      react: createElement(ContractFullySignedEmail, {
        recipientName: firstName,
        recipientWasSigner: true,
        contractName: `${CLIENT_ORG} Master Services Agreement`,
        contractType: 'msa',
        signedAt: signedIso,
        publicViewerUrl: publicUrl('/p/contract/prv_c41d90ab7e26'),
        signerNames: [LIAM, CLIENT_CONTACT],
        pdfAttached: true,
      }),
      personalisation: {
        Greeting: firstName,
        Contract: `${CLIENT_ORG} Master Services Agreement`,
        Type: 'Master services agreement',
        Signed: signedIso,
        Signers: `${LIAM}, ${CLIENT_CONTACT}`,
        'PDF attached': 'yes (copy should say the PDF is attached)',
      },
    },

    // app/api/admin/contracts/[id]/email/route.ts: `Please sign: ${contract.name}`.
    {
      key: 'contract-sign',
      subject: `Please sign: ${CLIENT_ORG} Statement of Work`,
      react: createElement(ContractSignEmail, {
        signerName: firstName,
        signerRole: 'client',
        contractName: `${CLIENT_ORG} Statement of Work`,
        contractType: 'sow',
        signUrl: publicUrl('/p/contract/prv_c41d90ab7e26/sign/sgn_3b7e12'),
        fromName: LIAM,
        customMessage:
          'This covers the spring campaign work we scoped on Tuesday: landing page, two email ' +
          'templates and the pick-up booking flow. Shout if the dates need moving.',
      }),
      personalisation: {
        Signer: firstName,
        Role: 'client',
        Contract: `${CLIENT_ORG} Statement of Work`,
        Type: 'Statement of work',
        From: LIAM,
        'Custom message': 'present (three lines from Liam)',
      },
    },

    // No live sender yet: the template is written and waiting on the overdue
    // chaser. Subject mirrors the invoice-sent route's shape.
    {
      key: 'invoice-overdue',
      subject: `Invoice ${invoiceRef} from Tahi Studio is overdue`,
      react: createElement(InvoiceOverdueEmail, {
        clientName: firstName,
        invoiceId: INVOICE_ID,
        amountFormatted: INVOICE_AMOUNT,
        currency: INVOICE_CURRENCY,
        dueDate: nzDate(overdueDueIso),
        daysOverdue: 12,
        dashboardUrl: origin,
        paymentUrl: publicUrl(`/invoices/${INVOICE_ID}/pay`),
      }),
      personalisation: {
        Greeting: firstName,
        Reference: invoiceRef,
        Amount: `${INVOICE_AMOUNT} ${INVOICE_CURRENCY}`,
        'Original due date': nzDate(overdueDueIso),
        'Days overdue': '12',
        'Pay button': 'present (warning variant)',
      },
    },

    // app/api/admin/invoices/[id]/send-email/route.ts.
    {
      key: 'invoice-sent',
      subject: `Invoice ${invoiceRef} from Tahi Studio`,
      react: createElement(InvoiceSentEmail, {
        clientName: firstName,
        invoiceId: INVOICE_ID,
        amountFormatted: INVOICE_AMOUNT,
        currency: INVOICE_CURRENCY,
        dueDate: nzDate(invoiceDueIso),
        notes: 'Covers the spring campaign landing page and the two follow-up email templates.',
        invoiceUrl: publicUrl(`/invoices/${INVOICE_ID}`),
        paymentUrl: publicUrl(`/invoices/${INVOICE_ID}/pay`),
      }),
      personalisation: {
        Greeting: firstName,
        Reference: invoiceRef,
        Amount: `${INVOICE_AMOUNT} ${INVOICE_CURRENCY}`,
        'Due date': nzDate(invoiceDueIso),
        Notes: 'present',
        'Pay button': 'present (plus a portal link underneath)',
      },
    },

    // app/api/portal/calls/route.ts: 'Your kickoff call is booked'.
    {
      key: 'kickoff-booked',
      subject: 'Your kickoff call is booked',
      react: createElement(KickoffBookedEmail, {
        contactFirstName: firstName,
        companyName: CLIENT_ORG,
        scheduledAt: kickoffIso,
        timeZone: 'Pacific/Auckland',
        durationMinutes: 45,
        hostName: LIAM,
        meetingUrl: 'https://meet.google.com/tah-kick-off',
        portalUrl: publicUrl('/overview'),
      }),
      personalisation: {
        Greeting: firstName,
        Company: CLIENT_ORG,
        When: `${kickoffIso} rendered in Pacific/Auckland`,
        Duration: '45 minutes',
        Host: LIAM,
        'Meeting link': 'present',
      },
    },

    // lib/notification-email.ts threadReplyEmailPlan (client audience).
    {
      key: 'new-message',
      subject: threadReply.subject,
      react: threadReply.render(target),
      personalisation: {
        Greeting: firstName,
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        From: STACI,
        Quote: 'three sentences of the reply, plain text',
        'Open button': requestUrl,
      },
    },

    // lib/notification-email.ts studioNewRequestEmailPlan (studio audience).
    {
      key: 'new-request',
      subject: newRequest.subject,
      react: newRequest.render(target),
      personalisation: {
        Request: REQUEST_TITLE,
        Client: CLIENT_ORG,
        Category: 'Design',
        Priority: 'High',
        'Submitted by': CLIENT_CONTACT,
      },
    },

    // app/api/admin/cron/pre-call-digest/route.ts: `Pre-call: ${withName} in ~30 min`.
    {
      key: 'pre-call-digest',
      subject: `Pre-call: ${CLIENT_CONTACT} in ~30 min`,
      react: createElement(PreCallDigestEmail, {
        callTitle: 'Discovery call',
        scheduledAt: callIso,
        meetingUrl: 'https://meet.google.com/tah-discovery',
        durationMinutes: 30,
        withName: CLIENT_CONTACT,
        withSubtitle: `${CLIENT_ORG}, Operations Manager`,
        parentHref: '/leads/lead_7f21c9',
        dashboardUrl: origin,
        leadEmail: CLIENT_CONTACT_EMAIL,
        leadCompany: CLIENT_ORG,
        industry: 'Horticulture and food production',
        employeeCount: 48,
        revenueBand: 'NZD 5M to 10M',
        cms: 'Shopify',
        techStack: ['Shopify', 'Klaviyo', 'Xero', 'Cloudflare'],
        country: 'New Zealand',
        aiScore: 82,
        aiScoreReason:
          'Seasonal ecommerce with a real peak, an in-house marketer to work with, and an ' +
          'existing Shopify build that is two platform versions behind.',
        aiSnapshot:
          'Nelson grower selling direct to consumers and to two supermarket chains. Spring is ' +
          'their whole year, and the current site cannot carry a campaign.',
        aiFit:
          'Retainer shaped. They need a campaign surface twice a year and steady maintenance in ' +
          'between, which is exactly what the maintain plan is for.',
        aiWatchOuts:
          'Their board signs off anything over NZD 20k, so a single large proposal will stall. ' +
          'Split the spring work from the platform work.',
        questions: [
          'What does a good spring look like in dollars, and what did last spring do?',
          'Who owns the Shopify theme today, and can they hand it over?',
          'Is the supermarket channel in scope, or is this direct to consumer only?',
        ],
        sources: [
          'https://mahanaorchards.co.nz/about',
          'https://www.linkedin.com/company/mahana-orchards',
          'https://www.nzherald.co.nz/business/nelson-growers-direct-to-door',
        ],
      }),
      personalisation: {
        With: `${CLIENT_CONTACT}, ${CLIENT_ORG}, Operations Manager`,
        When: `${callIso}, 30 minutes`,
        Firmographics: 'industry, headcount, revenue band, CMS, country',
        'AI briefing': 'score 82, reason, snapshot, fit, watch-outs',
        Questions: '3',
        Sources: '3',
      },
    },

    // app/api/portal/enquiry/route.ts.
    {
      key: 'project-enquiry',
      subject: `New project enquiry from ${CLIENT_CONTACT} at ${CLIENT_ORG}`,
      react: createElement(ProjectEnquiryEmail, {
        contactName: CLIENT_CONTACT,
        contactEmail: CLIENT_CONTACT_EMAIL,
        company: CLIENT_ORG,
        website: CLIENT_WEBSITE,
        brief:
          'We need a campaign site for the spring pick-your-own season, live by the first week of ' +
          'October. Our Shopify store stays as it is; this is a landing page, a booking flow for ' +
          'orchard visits, and the emails that go with them.',
        budget: 'NZD 15,000 to 25,000',
        disciplines: 'Web design, Webflow build, email templates',
      }),
      personalisation: {
        From: `${CLIENT_CONTACT} (${CLIENT_CONTACT_EMAIL})`,
        Company: CLIENT_ORG,
        Website: CLIENT_WEBSITE,
        Brief: 'three sentences',
        Budget: 'NZD 15,000 to 25,000',
        Disciplines: 'Web design, Webflow build, email templates',
      },
    },

    // app/api/admin/proposals/[id]/email/route.ts.
    {
      key: 'proposal-share',
      subject: `Proposal from Tahi Studio: ${CLIENT_ORG} spring campaign`,
      react: createElement(ProposalShareEmail, {
        recipientName: firstName,
        proposalTitle: `${CLIENT_ORG} spring campaign`,
        proposalSubtitle: 'Landing page, booking flow and campaign emails',
        viewUrl: publicUrl('/p/proposal/prv_8ad4e21f60b9'),
        fromName: LIAM,
        customMessage:
          'Two options inside: the campaign on its own, and the campaign with the Shopify theme ' +
          'tidy-up bundled. Happy to walk you through either on Thursday.',
        expiresAt: isoFromNow(21),
      }),
      personalisation: {
        Greeting: firstName,
        Proposal: `${CLIENT_ORG} spring campaign`,
        Subtitle: 'Landing page, booking flow and campaign emails',
        From: LIAM,
        'Custom message': 'present',
        Expires: nzDate(isoFromNow(21)),
      },
    },

    // lib/notification-email.ts clientStatusEmailPlan('client_review').
    {
      key: 'request-client-review',
      subject: clientReview.subject,
      react: clientReview.render(target),
      personalisation: {
        Greeting: firstName,
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        'Review button': requestUrl,
      },
    },

    // lib/notification-email.ts clientStatusEmailPlan('delivered').
    {
      key: 'request-delivered',
      subject: delivered.subject,
      react: delivered.render(target),
      personalisation: {
        Greeting: firstName,
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        Client: CLIENT_ORG,
        Delivered: isoFromNow(-1, 4, 10).slice(0, 10),
      },
    },

    // No live sender yet: the review outreach pipeline is queued. Subject is
    // the template's own Preview line, which is what it was written to.
    {
      key: 'review-request',
      subject: `We would love your feedback, ${firstName}`,
      react: createElement(ReviewRequestEmail, {
        clientName: firstName,
        orgName: CLIENT_ORG,
        respondUrl: publicUrl('/p/review'),
        token: 'prv_r3v13w7k2n',
      }),
      personalisation: {
        Greeting: firstName,
        Client: CLIENT_ORG,
        Answers: 'yes / not right now / no thanks, each carrying the token',
      },
    },

    // app/api/admin/schedules/[id]/email/route.ts.
    {
      key: 'schedule-share',
      subject: `Project schedule from Tahi Studio: ${CLIENT_ORG} spring campaign`,
      react: createElement(ScheduleShareEmail, {
        recipientName: firstName,
        scheduleTitle: `${CLIENT_ORG} spring campaign`,
        scheduleSubtitle: 'Six weeks, design through to launch',
        viewUrl: publicUrl('/p/schedule/prv_51ce90d3f8a2'),
        fromName: STACI,
        customMessage:
          'Dates assume we have the orchard photography by the end of next week. If it slips, ' +
          'launch slips with it and I will send a new version.',
        targetLaunchDate: isoFromNow(42),
      }),
      personalisation: {
        Greeting: firstName,
        Schedule: `${CLIENT_ORG} spring campaign`,
        Subtitle: 'Six weeks, design through to launch',
        From: STACI,
        'Custom message': 'present',
        'Target launch': nzDate(isoFromNow(42)),
      },
    },

    // app/api/admin/clients/[id]/welcome-email/route.ts.
    {
      key: 'welcome',
      subject: `Welcome to Tahi Studio, ${firstName}`,
      react: createElement(WelcomeEmail, {
        contactName: firstName,
        orgName: CLIENT_ORG,
        dashboardUrl: publicUrl('/accept-invite?token=prv_9f2c41a7d8e3'),
        boundEmail: to,
        expiresAt: isoFromNow(14),
      }),
      personalisation: {
        Greeting: firstName,
        Client: CLIENT_ORG,
        'Bound address': to,
        Expires: nzDate(isoFromNow(14)),
      },
    },
  ]

  return previews
}

/** The `{ key, subject }` shape a route reports back, without the element. */
export function summarisePreviews(previews: readonly EmailPreview[]): EmailPreviewSummary[] {
  return previews.map(({ key, subject }) => ({ key, subject }))
}
