/**
 * The composer writes plain text; the thread renders HTML.
 *
 * A message body is rendered with dangerouslySetInnerHTML (both audiences),
 * so the textarea's value has to be turned into the same small HTML
 * vocabulary the request detail already stores, or every line break the writer
 * put in is lost the moment it is read back.
 *
 * The pairing that matters is `toParagraphs` then `sanitizeRichText`: the
 * composer escapes, the route sanitises, and the round trip has to leave the
 * writer's literal text alone. `<b>` typed by a client must READ as `<b>`, and
 * an ampersand must survive both passes as one ampersand rather than becoming
 * "&amp;amp;" on screen.
 */

import { describe, it, expect } from 'vitest'
import { toParagraphs } from '@/components/tahi/messages/message-box'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

describe('toParagraphs', () => {
  it('keeps a single line as one paragraph', () => {
    expect(toParagraphs('Morning, all good here.')).toBe('<p>Morning, all good here.</p>')
  })

  it('turns a blank line into a new paragraph and a single break into a <br>', () => {
    expect(toParagraphs('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>')
  })

  it('is empty for whitespace, so the send button has nothing to send', () => {
    expect(toParagraphs('   \n  ')).toBe('')
  })

  it('escapes markup the writer typed, rather than letting it become markup', () => {
    expect(toParagraphs('use <b> for bold')).toBe('<p>use &lt;b&gt; for bold</p>')
  })
})

describe('toParagraphs then sanitizeRichText', () => {
  it('survives the server pass without double-escaping an ampersand', () => {
    const stored = sanitizeRichText(toParagraphs('Q&A on Thursday'))
    expect(stored).toBe('<p>Q&amp;A on Thursday</p>')
  })

  it('leaves the writer literal tag text intact through both passes', () => {
    const stored = sanitizeRichText(toParagraphs('use <script> carefully'))
    expect(stored).toContain('&lt;script&gt;')
    expect(stored).not.toContain('<script')
  })

  it('keeps the paragraph and break structure the sanitiser allows', () => {
    expect(sanitizeRichText(toParagraphs('one\ntwo\n\nthree')))
      .toBe('<p>one<br>two</p><p>three</p>')
  })
})
