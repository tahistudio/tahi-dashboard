/**
 * lib/email-previews.test.ts
 *
 * The registry is only useful if it is COMPLETE and every sample actually
 * renders. Both are easy to break silently: a new template lands under
 * `emails/` and nobody adds a preview, or a template gains a required prop and
 * the sample keeps passing the old shape, so the preview run reports a clean
 * set while the real send throws.
 *
 * So four things are pinned here:
 *
 *   1. The registry covers the directory. Read from disk, not from a hardcoded
 *      list, so adding `emails/foo.tsx` fails this test until some entry names
 *      `foo` as its template. Coverage is checked on the TEMPLATE, not on the
 *      key, because a key is a variant and one file may have several.
 *      `_components.tsx` is excluded (shared primitives, not an email).
 *   2. Every sample renders to real HTML without throwing, through the same
 *      @react-email/render the contract / proposal / schedule send paths use.
 *   3. Every sample is personalised: subject non-empty, recipient's name
 *      present in the body where the template greets, and no blank entry in the
 *      `personalisation` map (a blank there is the bug this whole feature
 *      exists to surface).
 *   4. Every variant renders the branch it claims. A studio-facing reply is not
 *      the client-facing one, an internal signer is not a client signer, and a
 *      kickoff with no meeting link is not one with a link. Checking the file
 *      once would leave the other half of each fork unread, and in the
 *      new-message case that other half is the email the studio itself receives
 *      every time a client replies from the portal.
 *
 * THE GREETING NAME IS DELIBERATELY UNUSED ELSEWHERE. `FIRST_NAME` is a name
 * that appears nowhere else in the sample world, because the samples also
 * render 'Liam Miller' as a sender, a signer and a host. With 'Liam' as the
 * recipient, a greeting that fell through to "Hi there" would still leave the
 * name in the body and the one assertion that guards personalisation would pass
 * on five templates.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { render } from '@react-email/render'

import {
  buildSamplePreviews,
  summarisePreviews,
  isEmailPreviewKey,
  EMAIL_PREVIEW_ENTRIES,
  EMAIL_PREVIEW_KEYS,
  EMAIL_PREVIEW_TEMPLATES,
} from '@/lib/email-previews'

const TO = 'business@tahi.studio'
const FIRST_NAME = 'Marama'

const LONG_DATE = /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/

/** Every sendable template on disk: `emails/*.tsx` minus the shared primitives. */
function templateKeysOnDisk(): string[] {
  const dir = path.resolve(__dirname, '..', 'emails')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''))
    .filter((k) => !k.startsWith('_'))
    .sort()
}

describe('email preview registry', () => {
  it('names every template file under emails/ at least once', () => {
    const onDisk = templateKeysOnDisk()
    const named = [...EMAIL_PREVIEW_TEMPLATES].sort()

    const missing = onDisk.filter((k) => !named.includes(k as (typeof named)[number]))
    const orphaned = named.filter((k) => !onDisk.includes(k))

    expect(missing, 'templates with no preview sample').toEqual([])
    expect(orphaned, 'preview entries naming a template file that does not exist').toEqual([])
  })

  it('allows several keys to share one template file', () => {
    const byTemplate = new Map<string, string[]>()
    for (const entry of EMAIL_PREVIEW_ENTRIES) {
      byTemplate.set(entry.template, [...(byTemplate.get(entry.template) ?? []), entry.key])
    }
    // The point of variant keys: the studio half of new-message is a live send
    // and used to go unpreviewed entirely.
    expect(byTemplate.get('new-message')).toEqual(['new-message', 'new-message-studio'])
  })

  it('has a unique key per entry', () => {
    expect(new Set(EMAIL_PREVIEW_KEYS).size).toBe(EMAIL_PREVIEW_KEYS.length)
  })

  it('excludes the shared primitives file', () => {
    expect(isEmailPreviewKey('_components')).toBe(false)
    expect(templateKeysOnDisk()).not.toContain('_components')
  })

  it('builds exactly one sample per registered key, in registry order', () => {
    const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
    expect(previews.map((p) => p.key)).toEqual([...EMAIL_PREVIEW_KEYS])
  })

  it('flags the two templates nothing in the tree sends yet', () => {
    const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
    const dark = previews.filter((p) => !p.liveSender).map((p) => p.key)
    expect(dark).toEqual(['invoice-overdue', 'review-request'])
  })

  it('summarises to { key, template, liveSender, subject } without the element', () => {
    const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
    const summary = summarisePreviews(previews)
    expect(summary).toHaveLength(previews.length)
    for (const entry of summary) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'liveSender', 'subject', 'template'])
    }
  })
})

describe('email preview samples', () => {
  const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
  const byKey = new Map(previews.map((p) => [p.key, p]))

  it.each(previews.map((p) => [p.key, p] as const))('%s renders to HTML', async (_key, preview) => {
    const html = await render(preview.react)
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(200)
    expect(html).toContain('</html>')
    // react-dom swallows a render throw into a client-rendering fallback rather
    // than rejecting, so a template that blew up still returns a long string.
    // Refuse that explicitly or this assertion proves nothing.
    expect(html, 'template threw during render').not.toContain('server rendering errored')
    // A template that rendered an undefined prop straight into the body is the
    // exact failure this feature exists to catch, so refuse it here too.
    expect(html).not.toContain('undefined')
    expect(html).not.toContain('[object Object]')
  })

  it.each(previews.map((p) => [p.key, p] as const))('%s carries a subject', (_key, preview) => {
    expect(preview.subject.trim().length).toBeGreaterThan(0)
    expect(preview.subject).not.toContain('undefined')
    expect(preview.subject).not.toContain('null')
  })

  it.each(previews.map((p) => [p.key, p] as const))(
    '%s names every personalised field it claims',
    (_key, preview) => {
      const entries = Object.entries(preview.personalisation)
      expect(entries.length).toBeGreaterThan(0)
      for (const [label, value] of entries) {
        expect(label.trim().length, `${preview.key} has an unlabelled field`).toBeGreaterThan(0)
        expect(value.trim().length, `${preview.key}.${label} is blank`).toBeGreaterThan(0)
        expect(value, `${preview.key}.${label} is undefined`).not.toContain('undefined')
      }
    },
  )

  it('greets the recipient by name in every template that greets', async () => {
    // The templates that render an internal notification (studio-facing) or a
    // structured record have no greeting by design.
    const noGreeting = new Set([
      'announcement',
      'announcement-info',
      'new-request',
      'pre-call-digest',
      'project-enquiry',
    ])
    for (const preview of previews) {
      if (noGreeting.has(preview.key)) continue
      const html = await render(preview.react)
      expect(html, `${preview.key} does not greet the recipient`).toContain(FIRST_NAME)
    }
  })

  it('uses a greeting name that appears nowhere else in the sample world', async () => {
    // Otherwise the assertion above is vacuous: 'Liam' is a sender, a signer and
    // a host, so a fallen-through greeting would still leave it in the body.
    for (const preview of previews) {
      const html = await render(preview.react)
      const hits = html.split(FIRST_NAME).length - 1
      const greets = !['announcement', 'announcement-info', 'new-request', 'pre-call-digest', 'project-enquiry'].includes(
        preview.key,
      )
      expect(hits > 0, `${preview.key}`).toBe(greets)
    }
  })

  it('reads like the studio: the client, the request and NZD money appear', async () => {
    const invoice = await render(byKey.get('invoice-sent')!.react)
    expect(invoice).toContain('NZD')
    expect(invoice).toContain('INV-1042')

    const thread = await render(byKey.get('new-message')!.react)
    expect(thread).toContain('Spring campaign landing page refresh')
    expect(byKey.get('new-message')!.subject).toContain('[REQ-42]')

    const enquiry = await render(byKey.get('project-enquiry')!.react)
    expect(enquiry).toContain('Mahana Orchards')
  })

  it('formats invoice due dates the way the invoice route formats them', async () => {
    // app/api/admin/invoices/[id]/send-email/route.ts uses month: 'long'. A
    // design check run against "14 Sep" would not show a row that wraps at
    // "14 September".
    const sent = byKey.get('invoice-sent')!
    expect(sent.personalisation['Due date']).toMatch(LONG_DATE)
    expect(await render(sent.react)).toContain(sent.personalisation['Due date'])

    const overdue = byKey.get('invoice-overdue')!
    expect(overdue.personalisation['Original due date']).toMatch(LONG_DATE)
    expect(await render(overdue.react)).toContain(overdue.personalisation['Original due date'])
  })

  it('addresses every echoed address at the address the previews are sent to', async () => {
    // The templates that print the invite-bound address must print THIS one, or
    // a preview would teach the reviewer to trust a hardcoded fixture.
    for (const key of ['client-invite', 'welcome'] as const) {
      const html = await render(
        buildSamplePreviews({ to: 'staci@tahi.studio', firstName: 'Staci' }).find(
          (p) => p.key === key,
        )!.react,
      )
      expect(html, `${key} does not echo the destination address`).toContain('staci@tahi.studio')
    }
  })
})

describe('email preview variants', () => {
  const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
  const byKey = new Map(previews.map((p) => [p.key, p]))

  it('previews both halves of the new-message fork', async () => {
    const client = byKey.get('new-message')!
    const studio = byKey.get('new-message-studio')!

    expect(client.subject).toContain('replied on')
    expect(studio.subject).toContain('New client message on')
    expect(studio.subject).not.toBe(client.subject)

    const clientHtml = await render(client.react)
    const studioHtml = await render(studio.react)

    expect(clientHtml).toContain('A reply on your request')
    expect(clientHtml).toContain('Open the thread')

    // The studio half: different eyebrow, different CTA, different footnote.
    expect(studioHtml).toContain('A client replied')
    expect(studioHtml).toContain('Open the request')
    expect(studioHtml).toContain('marks the request as answered for the client')
    expect(studioHtml).toContain('Ngaire Hutchins')
  })

  it('previews both signer roles on contract-sign', async () => {
    const clientSigner = await render(byKey.get('contract-sign')!.react)
    const tahiSigner = await render(byKey.get('contract-sign-tahi')!.react)

    expect(clientSigner).toContain('has shared a statement of work with you')
    expect(tahiSigner).toContain('the signing flow takes about a minute')
    expect(tahiSigner).not.toContain('has shared a master services agreement with you')
  })

  it('previews both halves of the fully-signed fork without claiming a phantom PDF', async () => {
    const signer = byKey.get('contract-fully-signed')!
    const observer = byKey.get('contract-fully-signed-observer')!

    const signerHtml = await render(signer.react)
    const observerHtml = await render(observer.react)

    // The default sample never says a PDF is attached, because the preview
    // endpoint sends through sendEmail, which has no attachment support.
    expect(signerHtml).not.toContain('is attached for your records')
    expect(signerHtml).toContain('View the signed agreement online')
    expect(signer.personalisation['PDF attached']).toContain('no')

    // The attached-PDF copy is still checked, on a sample that says so.
    expect(observerHtml).toContain('A PDF copy of the signed agreement is attached')
    expect(observer.personalisation['PDF attached']).toContain('no attachment')
  })

  it('previews the kickoff layout production actually sends, and the one with a link', async () => {
    const withLink = await render(byKey.get('kickoff-booked')!.react)
    const asSent = await render(byKey.get('kickoff-booked-no-link')!.react)

    expect(withLink).toContain('Join the call')
    // app/api/portal/calls/route.ts passes meetingUrl: null, so this is the
    // layout every real client has received.
    expect(asSent).toContain('Open your studio')
    expect(asSent).not.toContain('Join the call')
  })

  it('previews an announcement tone on each side of the button fork', async () => {
    const maintenance = await render(byKey.get('announcement')!.react)
    const info = await render(byKey.get('announcement-info')!.react)

    expect(maintenance).toContain('Maintenance')
    expect(info).toContain('Info')
    expect(info).toContain('See what changed')
    // info takes the brand button, maintenance the amber one.
    expect(info).not.toBe(maintenance)
  })
})
