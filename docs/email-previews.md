# Email previews

Send one sample of every email the platform sends to yourself, filled with
sample data, so the designs can be checked as a set and personalisation can be
proved rather than assumed.

- Registry and sample data: `lib/email-previews.ts`
- Endpoint: `app/api/admin/emails/preview/route.ts`

## Run it

Sign in to the deployed portal as a super admin (Liam or Staci), open the
browser console on any dashboard page, and run:

```js
await fetch('/api/admin/emails/preview', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
}).then(r => r.json())
```

That mails all 22 variants to your own address. Each subject is prefixed
`[PREVIEW]`, so the run is one search away from being filtered or deleted.

Re-check a single variant after a fix:

```js
body: JSON.stringify({ only: ['invoice-sent', 'new-message-studio'] })
```

Send to a colleague at the studio:

```js
body: JSON.stringify({ to: 'staci@tahi.studio' })
```

The response is:

```json
{
  "sent": [{ "key": "...", "template": "...", "liveSender": true, "subject": "..." }],
  "failed": [{ "key": "...", "error": "..." }],
  "from": "Tahi Studio <business@tahi.studio>"
}
```

`subject` is the real subject, without the prefix, so it can be compared
against the send path. `from` is asked of `lib/email.ts`, so it is the identity
the message actually left as.

Each preview goes out as multipart: the rendered HTML plus the plain text
alternative rendered from the same element, which is what the wired
notification sends do.

## Guards

- **Super admin only.** Resolved through `lib/permissions`, the same gate
  `/api/admin/danger/export` uses. The MCP service token resolves to `admin`,
  not `super_admin`, so it cannot fire this.
- **`@tahi.studio` addresses only.** The samples name a plausible New Zealand
  client and read like real work, so a typo in `to` would otherwise put a fake
  overdue invoice in a real client's inbox. Anything else is a 400 and nothing
  is sent.

## What the samples look like

One story across the whole set, so it reads as a whole: Mahana Orchards (a
Nelson grower), their ops manager Ngaire Hutchins, request REQ-42 "Spring
campaign landing page refresh", invoice INV-1042 in NZD, sender Liam Miller or
Staci Bonnie, dates a few days either side of today.

Every greeting uses the recipient's own first name, and **every optional prop
is filled**, including ones the live call sites leave undefined. That is
deliberate: an empty slot in a preview is a bug in the template, never a gap in
the sample. "Hi there" means the greeting fell through.

## A key is a variant, not a file

Several templates render two different emails off one prop, so previewing the
file once would leave the other half unread. The registry key carries the file
name in `template`, and several keys may share one file:

| Key | What it checks that its sibling does not |
| --- | --- |
| `new-message` / `new-message-studio` | The client half and the studio half. The studio half is a live send: every client reply from the portal builds it, with its own subject, eyebrow, opening line, CTA and footnote. |
| `contract-sign` / `contract-sign-tahi` | A client signer and an internal one. The contract email route loops over every pending signer, including the Tahi-side one, and `signerRole: 'tahi'` swaps the heading and the opening paragraph. |
| `contract-fully-signed` / `contract-fully-signed-observer` | A signer and a cc'd non-signer, and either side of the attached-PDF copy fork. |
| `kickoff-booked` / `kickoff-booked-no-link` | With a meeting link and without. `app/api/portal/calls/route.ts` passes `meetingUrl: null`, so the no-link layout is the one every real client has received; the link layout is one calendar integration away. |
| `announcement` / `announcement-info` | The amber tone (`maintenance`, which shares its palette and button with `warning` and differs only in the eyebrow label) and the brand-button tone (`info`, the default, whose palette differs from `success` only in the eyebrow colour). |

## Two things a reviewer should know before filing a bug

- **`liveSender: false` means nothing sends it yet.** `invoice-overdue` (waiting
  on the overdue chaser) and `review-request` (waiting on the testimonial
  pipeline) are written and wired to nothing. They are previewed anyway, because
  checking a design before it ships is the cheap version, but do not read them
  as shipping.
- **No preview carries an attachment.** The endpoint sends through
  `sendEmail`, which has no attachments parameter; the live fully-signed sender
  builds its own Resend options to attach the PDF. So
  `contract-fully-signed` is sent with `pdfAttached: false` (a state the live
  sender also produces, when the PDF render fails), and
  `contract-fully-signed-observer` carries the attached-PDF copy with a
  personalisation line saying the attachment is absent by design.

## Adding a template

Add the file under `emails/`, then add one entry to `EMAIL_PREVIEW_ENTRIES` and
one sample keyed by it. `lib/email-previews.test.ts` reads the directory from
disk and fails on any template file no entry names, so a new template cannot
ship unpreviewable, and the sample map is typed by the key union, so an entry
with no sample is a compile error rather than a runtime hole.

Where the send path already builds the subject (the four wired notification
events in `lib/notification-email.ts`), call the plan builder rather than
re-typing the subject, so the preview cannot drift from production. Everywhere
else, copy the literal from its route and name that route in a comment.

Add a second key rather than a second prop value when a template forks on
audience, role or tone. The fork is what a design check is for.

## Follow-ups this work surfaced

- **No MCP tool (CLAUDE.md rule 14).** This capability is not exposed on
  `workers/mcp-server/src/index.ts`. It cannot simply be added: guard (1) refuses
  the MCP service token, which resolves to `admin` rather than `super_admin`, so
  a tool written against the endpoint as it stands would always 403. Widening
  that gate is its own decision (the endpoint mails a set of plausible-looking
  invoices and contracts on one call), so the tool is blocked on making it
  first, not on the wiring.
- **Two templates have no sender.** `emails/invoice-overdue.tsx` and
  `emails/review-request.tsx` are rendered nowhere outside this registry. Either
  wire them (the overdue chaser and the testimonial outreach pipeline) or delete
  them; a template with no caller rots quietly.
- **`plainTextAlternative` exists twice.** `lib/email-plain-text.ts` is the
  shared home; `lib/notification-email.ts` still carries a private copy, written
  before that module existed, and should call the shared one the next time it is
  opened.
