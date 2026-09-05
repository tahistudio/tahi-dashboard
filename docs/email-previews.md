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

That mails all 17 templates to your own address. Each subject is prefixed
`[PREVIEW]`, so the run is one search away from being filtered or deleted.

Re-check a single template after a fix:

```js
body: JSON.stringify({ only: ['invoice-sent', 'welcome'] })
```

Send to a colleague at the studio:

```js
body: JSON.stringify({ to: 'staci@tahi.studio' })
```

The response is `{ sent: [{ key, subject }], failed: [{ key, error }], from }`.
`subject` is the real subject, without the prefix, so it can be compared
against the send path.

## Guards

- **Super admin only.** Resolved through `lib/permissions`, the same gate
  `/api/admin/danger/export` uses. The MCP service token resolves to `admin`,
  not `super_admin`, so it cannot fire this.
- **`@tahi.studio` addresses only.** The samples name a plausible New Zealand
  client and read like real work, so a typo in `to` would otherwise put a fake
  overdue invoice in a real client's inbox. Anything else is a 400 and nothing
  is sent.

## What the samples look like

One story across all seventeen emails, so the set reads as a whole: Mahana
Orchards (a Nelson grower), their ops manager Ngaire Hutchins, request REQ-42
"Spring campaign landing page refresh", invoice INV-1042 in NZD, sender Liam
Miller or Staci Bonnie, dates a few days either side of today.

Every greeting uses the recipient's own first name, and **every optional prop
is filled**, including ones the live call sites leave undefined. That is
deliberate: an empty slot in a preview is a bug in the template, never a gap in
the sample. "Hi there" means the greeting fell through.

## Adding a template

Add the file under `emails/`, then add one entry to `EMAIL_PREVIEW_KEYS` and
the array in `buildSamplePreviews`. `lib/email-previews.test.ts` reads the
directory from disk and fails on any template with no sample, so a new template
cannot ship unpreviewable.

Where the send path already builds the subject (the four wired notification
events in `lib/notification-email.ts`), call the plan builder rather than
re-typing the subject, so the preview cannot drift from production. Everywhere
else, copy the literal from its route and name that route in a comment.
