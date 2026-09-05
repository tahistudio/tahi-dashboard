/**
 * lib/email-previews.test.ts
 *
 * The registry is only useful if it is COMPLETE and every sample actually
 * renders. Both are easy to break silently: a new template lands under
 * `emails/` and nobody adds a preview, or a template gains a required prop and
 * the sample keeps passing the old shape, so the preview run reports a clean
 * seventeen while the real send throws.
 *
 * So three things are pinned here:
 *
 *   1. The registry matches the directory. Read from disk, not from a hardcoded
 *      list, so adding `emails/foo.tsx` fails this test until `foo` has a
 *      sample. `_components.tsx` is excluded (shared primitives, not an email).
 *   2. Every sample renders to real HTML without throwing, through the same
 *      @react-email/render the contract / proposal / schedule send paths use.
 *   3. Every sample is personalised: subject non-empty, recipient's name and
 *      the client's name present in the body where the template greets, and no
 *      blank entry in the `personalisation` map (a blank there is the bug this
 *      whole feature exists to surface).
 */

import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { render } from '@react-email/render'

import {
  buildSamplePreviews,
  summarisePreviews,
  isEmailPreviewKey,
  EMAIL_PREVIEW_KEYS,
} from '@/lib/email-previews'

const TO = 'business@tahi.studio'
const FIRST_NAME = 'Liam'

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
  it('covers every template file under emails/', () => {
    const onDisk = templateKeysOnDisk()
    const registered: string[] = [...EMAIL_PREVIEW_KEYS].sort()

    const missing = onDisk.filter((k) => !registered.includes(k))
    const orphaned = registered.filter((k) => !onDisk.includes(k))

    expect(missing, 'templates with no preview sample').toEqual([])
    expect(orphaned, 'preview keys with no template file').toEqual([])
  })

  it('excludes the shared primitives file', () => {
    expect(isEmailPreviewKey('_components')).toBe(false)
    expect(templateKeysOnDisk()).not.toContain('_components')
  })

  it('builds exactly one sample per registered key, in registry order', () => {
    const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
    expect(previews.map((p) => p.key)).toEqual([...EMAIL_PREVIEW_KEYS])
  })

  it('summarises to { key, subject } without the element', () => {
    const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })
    const summary = summarisePreviews(previews)
    expect(summary).toHaveLength(previews.length)
    for (const entry of summary) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'subject'])
    }
  })
})

describe('email preview samples', () => {
  const previews = buildSamplePreviews({ to: TO, firstName: FIRST_NAME })

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
    const noGreeting = new Set(['announcement', 'new-request', 'pre-call-digest', 'project-enquiry'])
    for (const preview of previews) {
      if (noGreeting.has(preview.key)) continue
      const html = await render(preview.react)
      expect(html, `${preview.key} does not greet the recipient`).toContain(FIRST_NAME)
    }
  })

  it('reads like the studio: the client, the request and NZD money appear', async () => {
    const byKey = new Map(previews.map((p) => [p.key, p]))

    const invoice = await render(byKey.get('invoice-sent')!.react)
    expect(invoice).toContain('NZD')
    expect(invoice).toContain('INV-1042')

    const thread = await render(byKey.get('new-message')!.react)
    expect(thread).toContain('Spring campaign landing page refresh')
    expect(byKey.get('new-message')!.subject).toContain('[REQ-42]')

    const enquiry = await render(byKey.get('project-enquiry')!.react)
    expect(enquiry).toContain('Mahana Orchards')
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
