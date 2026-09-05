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
 * THE THREE RULES THAT MAKE A PREVIEW WORTH READING:
 *
 *   1. The subject must be the REAL subject. Where the send path already builds
 *      one (the four wired notification events), the plan builder in
 *      lib/notification-email.ts is called rather than re-typed, so the preview
 *      cannot drift from production. Everywhere else the literal is copied from
 *      its route and the route is named in a comment above it, so the next
 *      person can check it in one grep.
 *
 *   2. A PREVIEW IS PER VARIANT, NOT PER FILE. Several templates render two
 *      different emails off one prop: `new-message` writes to the client or to
 *      the studio, `contract-sign` greets a client signer or an internal one,
 *      `contract-fully-signed` speaks to a signer or to an observer,
 *      `announcement` changes eyebrow colour and button variant with its tone.
 *      Previewing the file once checks one of those and leaves the other
 *      unread, including copy the studio itself receives every time a client
 *      replies from the portal. So a registry key is a VARIANT: it carries the
 *      template file name in `template`, and several keys may share one file.
 *
 *   3. Every optional prop is filled, unless production never fills it. A
 *      preview whose optional fields are undefined renders the same as a
 *      template whose optional fields are broken, which is the bug this is
 *      meant to catch, so the samples pass `customMessage`, `paymentUrl`,
 *      `expiresAt` and the rest even where the live call site does not. The
 *      exception is a field production always leaves empty (kickoff's
 *      `meetingUrl`): filling it would preview a layout no client has ever
 *      received, so both states get their own key instead.
 *
 * THE SAMPLE WORLD. One client, one request, one thread, so the set reads as a
 * single story rather than a pile of disconnected fixtures: Mahana Orchards (a
 * Nelson grower), their ops manager Ngaire Hutchins, request REQ-42 "Spring
 * campaign landing page refresh", invoice INV-1042 in NZD, dates a few days
 * either side of today. The recipient's own first name is used for every
 * greeting, so "Hi there" in a preview means the greeting fell through.
 *
 * TEMPLATES WITH NO SENDER. Two templates are written and wired to nothing:
 * `invoice-overdue` (waiting on the overdue chaser) and `review-request`
 * (waiting on the testimonial pipeline). They are previewed anyway, because a
 * design that is checked before it ships is the cheap version, but they carry
 * `liveSender: false` and the endpoint reports it, so a reviewer is never left
 * to assume every email in the run is one a client can receive today.
 *
 * ADDING A TEMPLATE. Add the file under `emails/`, then add one entry to
 * `EMAIL_PREVIEW_ENTRIES` and one sample keyed by it. lib/email-previews.test.ts
 * fails on any template file no entry names, so a new template cannot be
 * shipped unpreviewable, and the sample map is typed by the key union, so an
 * entry with no sample is a compile error rather than a runtime hole.
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

// ─── The registry index ──────────────────────────────────────────────────────

/**
 * Every preview this module can build: its key, the `emails/*.tsx` file it
 * renders, and whether anything in the tree sends that template today.
 *
 * Keys are variants, not files (rule 2 above), so `template` is what the disk
 * check in the test compares against and several keys may name the same file.
 * The order here is the order the reviewer's inbox fills, so it is alphabetical
 * by key: two runs can then be compared side by side.
 */
export const EMAIL_PREVIEW_ENTRIES = [
  { key: 'announcement', template: 'announcement', liveSender: true },
  { key: 'announcement-info', template: 'announcement', liveSender: true },
  { key: 'client-invite', template: 'client-invite', liveSender: true },
  { key: 'contract-fully-signed', template: 'contract-fully-signed', liveSender: true },
  { key: 'contract-fully-signed-observer', template: 'contract-fully-signed', liveSender: true },
  { key: 'contract-sign', template: 'contract-sign', liveSender: true },
  { key: 'contract-sign-tahi', template: 'contract-sign', liveSender: true },
  { key: 'invoice-overdue', template: 'invoice-overdue', liveSender: false },
  { key: 'invoice-sent', template: 'invoice-sent', liveSender: true },
  { key: 'kickoff-booked', template: 'kickoff-booked', liveSender: true },
  { key: 'kickoff-booked-no-link', template: 'kickoff-booked', liveSender: true },
  { key: 'new-message', template: 'new-message', liveSender: true },
  { key: 'new-message-studio', template: 'new-message', liveSender: true },
  { key: 'new-request', template: 'new-request', liveSender: true },
  { key: 'pre-call-digest', template: 'pre-call-digest', liveSender: true },
  { key: 'project-enquiry', template: 'project-enquiry', liveSender: true },
  { key: 'proposal-share', template: 'proposal-share', liveSender: true },
  { key: 'request-client-review', template: 'request-client-review', liveSender: true },
  { key: 'request-delivered', template: 'request-delivered', liveSender: true },
  { key: 'review-request', template: 'review-request', liveSender: false },
  { key: 'schedule-share', template: 'schedule-share', liveSender: true },
  { key: 'welcome', template: 'welcome', liveSender: true },
] as const

/** A registry key: one variant of one template. */
export type EmailPreviewKey = (typeof EMAIL_PREVIEW_ENTRIES)[number]['key']

/** A file name under `emails/`, without the extension. */
export type EmailTemplateName = (typeof EMAIL_PREVIEW_ENTRIES)[number]['template']

/** Every key, in send order. */
export const EMAIL_PREVIEW_KEYS: readonly EmailPreviewKey[] = EMAIL_PREVIEW_ENTRIES.map(
  (entry) => entry.key,
)

/** Every template file the registry names, deduped. */
export const EMAIL_PREVIEW_TEMPLATES: readonly EmailTemplateName[] = [
  ...new Set(EMAIL_PREVIEW_ENTRIES.map((entry) => entry.template)),
]

/** True when `value` names a variant this module can preview. */
export function isEmailPreviewKey(value: string): value is EmailPreviewKey {
  return (EMAIL_PREVIEW_KEYS as readonly string[]).includes(value)
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * One variant, rendered with sample data and ready to hand to `sendEmail`.
 *
 * `personalisation` is the point of the whole exercise: the fields a human is
 * being asked to check, named the way they read in the body, so the reviewer
 * can hold the email up against the list instead of guessing what should have
 * been filled in.
 */
export interface EmailPreview {
  /** The registry key: a variant, which may share a template with another key. */
  key: EmailPreviewKey
  /** The template file under `emails/`, without the extension. */
  template: EmailTemplateName
  /** False when nothing in the tree sends this template yet. */
  liveSender: boolean
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
  template: EmailTemplateName
  liveSender: boolean
  subject: string
}

export interface BuildSamplePreviewsInput {
  /** The address the preview will be mailed to, used where a template echoes it. */
  to: string
  /** The recipient's first name, used for every greeting. */
  firstName: string
}

/** A built sample, before the registry entry is merged onto it. */
interface PreviewSample {
  subject: string
  react: ReactElement
  personalisation: Readonly<Record<string, string>>
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
 * The long date the invoice routes format their due dates with, e.g.
 * "12 September 2026".
 *
 * Deliberately not `nzDate`: app/api/admin/invoices/[id]/send-email/route.ts
 * builds its due date with `month: 'long'`, and a design check run against the
 * shorter string is exactly where a wrapped DetailRow would hide.
 */
function nzLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
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

// ─── The samples ─────────────────────────────────────────────────────────────

/**
 * One sample per registry key, typed by the key union: an entry with no sample
 * and a sample with no entry are both compile errors, so the two lists cannot
 * drift.
 */
function buildSamples({ to, firstName }: BuildSamplePreviewsInput): Record<
  EmailPreviewKey,
  PreviewSample
> {
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

  // The other half of the same template, and a live send: every client reply
  // from the portal builds this one (app/api/portal/requests/[id]/messages).
  const studioThreadReply = threadReplyEmailPlan({
    audience: 'studio',
    requestId: REQUEST_ID,
    requestTitle: REQUEST_TITLE,
    requestNumber: REQUEST_NUMBER,
    fromName: CLIENT_CONTACT,
    message:
      'Thanks, that reads much better. Two notes from our side: the pick-up window should say ' +
      '"from 9am", not "9am to 5pm", because the late slots sell out. And can the region field ' +
      'default to Nelson? That is where most of our orders come from.',
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

  const contractName = `${CLIENT_ORG} Master Services Agreement`

  return {
    // lib/announcement-emails.ts: subject is the announcement title verbatim.
    // The amber half of the tone map: `maintenance` and `warning` share the
    // warning palette and the amber button, and differ only in the eyebrow
    // label, so one of the two covers both.
    announcement: {
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
        Type: 'maintenance (amber eyebrow, amber button)',
        'CTA label': 'Open your portal',
      },
    },

    // The other half of the tone map. `info` is the default type, and with
    // `success` it takes the brand button rather than the amber one, so the
    // maintenance sample above cannot show it.
    'announcement-info': {
      subject: 'Request templates are live in your portal',
      react: createElement(AnnouncementEmail, {
        title: 'Request templates are live in your portal',
        body:
          'The work you send us most often now has a starting point. Pick a template when you ' +
          'open a request and the brief arrives with the questions we would have asked you ' +
          'anyway, which usually saves a round trip.\n\n' +
          'Nothing changes for requests you have already sent, and the blank form is still there ' +
          'if you would rather write it yourself.',
        type: 'info',
        ctaLabel: 'See what changed',
        ctaUrl: publicUrl('/requests'),
      }),
      personalisation: {
        Title: 'Request templates are live in your portal',
        Type: 'info (blue eyebrow, brand button)',
        Body: 'two paragraphs, split on the blank line',
        'CTA label': 'See what changed',
      },
    },

    // app/api/admin/clients/route.ts + app/api/admin/onboarding-invites/route.ts.
    'client-invite': {
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
    // Sent with `pdfAttached: false`, which is both a state the live sender
    // produces (the PDF render failed) and the only honest state for a preview:
    // sendEmail has no attachments parameter, so a preview can never carry one.
    'contract-fully-signed': {
      subject: `Fully signed: ${contractName}`,
      react: createElement(ContractFullySignedEmail, {
        recipientName: firstName,
        recipientWasSigner: true,
        contractName,
        contractType: 'msa',
        signedAt: signedIso,
        publicViewerUrl: publicUrl('/p/contract/prv_c41d90ab7e26'),
        signerNames: [LIAM, CLIENT_CONTACT],
        pdfAttached: false,
      }),
      personalisation: {
        Greeting: firstName,
        Heading: 'signer wording ("Thanks for your signature")',
        Contract: contractName,
        Type: 'Master services agreement',
        Signed: signedIso,
        Signers: `${LIAM}, ${CLIENT_CONTACT}`,
        'PDF attached': 'no, so the copy should push the viewer link instead',
      },
    },

    // The same template written to someone who did not sign it (a cc'd contact
    // on the client side), which is a live branch: the sender greets every
    // recipient, signer or not. Carries the attached-PDF copy so both halves of
    // the `pdfAttached` fork get read across the two samples.
    'contract-fully-signed-observer': {
      subject: `Fully signed: ${contractName}`,
      react: createElement(ContractFullySignedEmail, {
        recipientName: firstName,
        recipientWasSigner: false,
        contractName,
        contractType: 'msa',
        signedAt: signedIso,
        publicViewerUrl: publicUrl('/p/contract/prv_c41d90ab7e26'),
        signerNames: [LIAM, CLIENT_CONTACT],
        pdfAttached: true,
      }),
      personalisation: {
        Greeting: firstName,
        Heading: 'observer wording ("Your contract is fully signed")',
        Contract: contractName,
        Signers: `${LIAM}, ${CLIENT_CONTACT}`,
        'PDF attached': 'copy only, the preview send carries no attachment by design',
      },
    },

    // app/api/admin/contracts/[id]/email/route.ts: `Please sign: ${contract.name}`.
    'contract-sign': {
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
        Role: 'client (heading reads "Ready for your signature")',
        Contract: `${CLIENT_ORG} Statement of Work`,
        Type: 'Statement of work',
        From: LIAM,
        'Custom message': 'present (two lines from Liam)',
      },
    },

    // The same route, same loop, different signer: it emails every pending
    // signer including the Tahi-side one, and `signerRole: 'tahi'` swaps the
    // heading and the opening paragraph.
    'contract-sign-tahi': {
      subject: `Please sign: ${contractName}`,
      react: createElement(ContractSignEmail, {
        signerName: firstName,
        signerRole: 'tahi',
        contractName,
        contractType: 'msa',
        signUrl: publicUrl('/p/contract/prv_c41d90ab7e26/sign/sgn_9d20f4'),
        fromName: LIAM,
        customMessage:
          'Counter-signature on the Mahana MSA. Ngaire signed hers this morning, so this is the ' +
          'last one before it is fully executed.',
      }),
      personalisation: {
        Signer: firstName,
        Role: 'tahi (heading reads "Your signature is needed")',
        Contract: contractName,
        Type: 'Master services agreement',
        From: LIAM,
        'Custom message': 'present (two lines from Liam)',
      },
    },

    // No live sender yet: the template is written and waiting on the overdue
    // chaser. Subject mirrors the invoice-sent route's shape, and the due date
    // is formatted the way that route formats one.
    'invoice-overdue': {
      subject: `Invoice ${invoiceRef} from Tahi Studio is overdue`,
      react: createElement(InvoiceOverdueEmail, {
        clientName: firstName,
        invoiceId: INVOICE_ID,
        amountFormatted: INVOICE_AMOUNT,
        currency: INVOICE_CURRENCY,
        dueDate: nzLongDate(overdueDueIso),
        daysOverdue: 12,
        dashboardUrl: origin,
        paymentUrl: publicUrl(`/invoices/${INVOICE_ID}/pay`),
      }),
      personalisation: {
        Greeting: firstName,
        Reference: invoiceRef,
        Amount: `${INVOICE_AMOUNT} ${INVOICE_CURRENCY}`,
        'Original due date': nzLongDate(overdueDueIso),
        'Days overdue': '12',
        'Pay button': 'present (warning variant)',
      },
    },

    // app/api/admin/invoices/[id]/send-email/route.ts.
    'invoice-sent': {
      subject: `Invoice ${invoiceRef} from Tahi Studio`,
      react: createElement(InvoiceSentEmail, {
        clientName: firstName,
        invoiceId: INVOICE_ID,
        amountFormatted: INVOICE_AMOUNT,
        currency: INVOICE_CURRENCY,
        dueDate: nzLongDate(invoiceDueIso),
        notes: 'Covers the spring campaign landing page and the two follow-up email templates.',
        invoiceUrl: publicUrl(`/invoices/${INVOICE_ID}`),
        paymentUrl: publicUrl(`/invoices/${INVOICE_ID}/pay`),
      }),
      personalisation: {
        Greeting: firstName,
        Reference: invoiceRef,
        Amount: `${INVOICE_AMOUNT} ${INVOICE_CURRENCY}`,
        'Due date': nzLongDate(invoiceDueIso),
        Notes: 'present',
        'Pay button': 'present (plus a portal link underneath)',
      },
    },

    // app/api/portal/calls/route.ts: 'Your kickoff call is booked'.
    // The link-carrying layout, which nothing sends today (see the sibling
    // below) but which is one calendar integration away from shipping.
    'kickoff-booked': {
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
        'Meeting link': 'present, so the CTA reads "Join the call"',
      },
    },

    // The shape production actually sends: app/api/portal/calls/route.ts passes
    // `meetingUrl: null`, so every real client sees the portal CTA and no join
    // link. That is the layout that has to be right today.
    'kickoff-booked-no-link': {
      subject: 'Your kickoff call is booked',
      react: createElement(KickoffBookedEmail, {
        contactFirstName: firstName,
        companyName: CLIENT_ORG,
        scheduledAt: kickoffIso,
        timeZone: 'Pacific/Auckland',
        durationMinutes: 45,
        hostName: LIAM,
        meetingUrl: null,
        portalUrl: publicUrl('/overview'),
      }),
      personalisation: {
        Greeting: firstName,
        Company: CLIENT_ORG,
        When: `${kickoffIso} rendered in Pacific/Auckland`,
        Host: LIAM,
        'Meeting link': 'absent, so the CTA falls back to "Open your studio"',
      },
    },

    // lib/notification-email.ts threadReplyEmailPlan (client audience).
    'new-message': {
      subject: threadReply.subject,
      react: threadReply.render(target),
      personalisation: {
        Greeting: firstName,
        Eyebrow: 'A reply on your request / Request thread',
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        From: STACI,
        Quote: 'three sentences of the reply, plain text',
        'Open button': `"Open the thread", ${requestUrl}`,
      },
    },

    // The studio-facing half of the same template, and the one the studio sees
    // every time a client replies from the portal. Different subject, eyebrow,
    // opening line, CTA label and footnote from the client half above.
    'new-message-studio': {
      subject: studioThreadReply.subject,
      react: studioThreadReply.render(target),
      personalisation: {
        Greeting: firstName,
        Eyebrow: 'A client replied / Inbox',
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        From: CLIENT_CONTACT,
        Quote: 'three sentences of the client reply, plain text',
        'Open button': '"Open the request", the admin route not the portal one',
      },
    },

    // lib/notification-email.ts studioNewRequestEmailPlan (studio audience).
    'new-request': {
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
    'pre-call-digest': {
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
    'project-enquiry': {
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
    'proposal-share': {
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
    'request-client-review': {
      subject: clientReview.subject,
      react: clientReview.render(target),
      personalisation: {
        Greeting: firstName,
        Request: `REQ-${REQUEST_NUMBER} ${REQUEST_TITLE}`,
        'Review button': requestUrl,
      },
    },

    // lib/notification-email.ts clientStatusEmailPlan('delivered').
    'request-delivered': {
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
    'review-request': {
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
    'schedule-share': {
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
    welcome: {
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
  }
}

/**
 * Build one sample of every registered variant, addressed to `to` and greeting
 * `firstName`.
 *
 * Returns them in `EMAIL_PREVIEW_ENTRIES` order, which is alphabetical by key,
 * so a reviewer's inbox arrives in a stable order every time and two runs can
 * be compared side by side.
 */
export function buildSamplePreviews(input: BuildSamplePreviewsInput): EmailPreview[] {
  const samples = buildSamples(input)
  return EMAIL_PREVIEW_ENTRIES.map((entry) => ({
    key: entry.key,
    template: entry.template,
    liveSender: entry.liveSender,
    ...samples[entry.key],
  }))
}

/** The shape a route reports back, without the element. */
export function summarisePreviews(previews: readonly EmailPreview[]): EmailPreviewSummary[] {
  return previews.map(({ key, template, liveSender, subject }) => ({
    key,
    template,
    liveSender,
    subject,
  }))
}
