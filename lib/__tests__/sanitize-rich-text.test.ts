import { describe, it, expect } from 'vitest'
import { sanitizeRichText } from '../sanitize-rich-text'

describe('sanitizeRichText - XSS vectors are neutralised', () => {
  it('drops <script> and its content', () => {
    const out = sanitizeRichText('hi<script>alert(1)</script>there')
    expect(out).toBe('hithere')
    expect(out).not.toContain('alert')
  })

  it('strips the onerror handler on a disallowed <img>', () => {
    const out = sanitizeRichText('<img src=x onerror="alert(document.cookie)">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out.toLowerCase()).not.toContain('<img')
    expect(out.toLowerCase()).not.toContain('alert')
  })

  it('strips event handlers from allowed tags (no attributes survive)', () => {
    const out = sanitizeRichText('<p onclick="evil()">hello</p>')
    expect(out).toBe('<p>hello</p>')
    expect(out.toLowerCase()).not.toContain('onclick')
  })

  it('drops <iframe>, <svg>, <style>, <object> with content', () => {
    expect(sanitizeRichText('a<iframe src="javascript:alert(1)"></iframe>b')).toBe('ab')
    expect(sanitizeRichText('a<svg><script>alert(1)</script></svg>b')).toBe('ab')
    expect(sanitizeRichText('a<style>body{background:url(x)}</style>b')).toBe('ab')
    expect(sanitizeRichText('a<object data="x"></object>b')).toBe('ab')
  })

  it('neutralises javascript: hrefs on <a>', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).toBe('<a>x</a>')
  })

  it('neutralises obfuscated javascript: (entities + embedded tab)', () => {
    const out1 = sanitizeRichText('<a href="&#106;avascript:alert(1)">x</a>')
    expect(out1.toLowerCase()).not.toContain('javascript')
    const out2 = sanitizeRichText('<a href="java\tscript:alert(1)">x</a>')
    expect(out2.toLowerCase()).not.toContain('script:')
  })

  it('rejects data: URIs on <a>', () => {
    const out = sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">x</a>')
    expect(out).toBe('<a>x</a>')
  })

  it('keeps safe http/https/mailto hrefs and adds rel', () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
  })

  it('escapes raw angle brackets and stray markup', () => {
    expect(sanitizeRichText('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2')
  })

  it('escapes a malformed/unclosed tag tail to inert text', () => {
    const out = sanitizeRichText('hello <img src=x onerror=alert(1)')
    // The payload survives only as escaped, inert text (no real <img element),
    // so it cannot execute even though the literal "onerror" substring remains.
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('<img')
  })

  it('drops mention spans to text but keeps the readable name', () => {
    const out = sanitizeRichText('<span data-mention-id="u1" class="tahi-mention">@Liam</span> hi')
    expect(out).toBe('@Liam hi')
    expect(out).not.toContain('data-mention')
  })

  it('handles case-insensitive and spaced dangerous tags', () => {
    expect(sanitizeRichText('a<ScRiPt >alert(1)</ScRiPt>b')).toBe('ab')
    expect(sanitizeRichText('a<  script>alert(1)</script>b')).toBe('ab')
    expect(sanitizeRichText('a<script>alert(1)</script >b')).toBe('ab')
  })
})

describe('sanitizeRichText - legitimate Tiptap formatting survives', () => {
  it('keeps basic formatting tags', () => {
    const html = '<p>Hello <strong>world</strong> and <em>friends</em></p>'
    expect(sanitizeRichText(html)).toBe(html)
  })

  it('keeps lists, headings, blockquote, code', () => {
    const html = '<h2>Title</h2><ul><li>one</li><li>two</li></ul><blockquote>quote</blockquote><pre><code>x()</code></pre>'
    expect(sanitizeRichText(html)).toBe(html)
  })

  it('keeps <br> and paragraph structure', () => {
    expect(sanitizeRichText('<p>line one<br>line two</p>')).toBe('<p>line one<br>line two</p>')
  })

  it('returns empty string for null/empty input', () => {
    expect(sanitizeRichText(null)).toBe('')
    expect(sanitizeRichText(undefined)).toBe('')
    expect(sanitizeRichText('')).toBe('')
  })

  it('preserves a normal sentence verbatim', () => {
    expect(sanitizeRichText('We need a new landing page by Friday.')).toBe('We need a new landing page by Friday.')
  })
})

describe('sanitizeRichText - running it twice changes nothing', () => {
  // The allowlist runs on the way IN (the portal writers) and again on the way
  // OUT (request-thread, RichBriefProse), so a stored body is sanitised at
  // least twice before a reader sees it. Escaping an already-escaped entity a
  // second time is what printed the literal "Q&amp;A" where the author typed
  // "Q&A", so every case below asserts the fixed point.
  const CORPUS = [
    '<p>Tom &amp; Jerry</p>',
    '<p>Q&amp;A on the &lt;head&gt; tag</p>',
    'plain & text < with > brackets',
    '1 < 2 && 3 > 2',
    '<p>Costs &lt; &pound;100 &amp;&amp; &gt; 50</p>',
    '<a href="https://example.com/?a=1&amp;b=2">link</a>',
    '<a href="/requests?tab=all&amp;sort=due">relative</a>',
    '<ul><li>one &amp; two</li><li>three</li></ul>',
    'hello <img src=x onerror=alert(1)',
    '<a href="javascript:alert(1)">x</a>',
    '<span data-mention-id="u1">@Liam</span> &amp; co',
    '&amp;amp;',
    '&#38; &#x26; &notanentity; &123;',
  ]

  it.each(CORPUS)('is a fixed point for %j', (input) => {
    const once = sanitizeRichText(input)
    expect(sanitizeRichText(once)).toBe(once)
  })

  it('leaves a stored &amp; alone instead of printing the entity', () => {
    expect(sanitizeRichText('<p>Tom &amp; Jerry</p>')).toBe('<p>Tom &amp; Jerry</p>')
    expect(sanitizeRichText('<p>Q&amp;A</p>')).toBe('<p>Q&amp;A</p>')
  })

  it('still escapes a bare ampersand that opens no entity', () => {
    expect(sanitizeRichText('a & b')).toBe('a &amp; b')
    expect(sanitizeRichText('AT&T &amp; co')).toBe('AT&amp;T &amp; co')
    expect(sanitizeRichText('&notanentity')).toBe('&amp;notanentity')
  })

  it('keeps a query-string ampersand as one entity in an href', () => {
    const out = sanitizeRichText('<a href="https://example.com/?a=1&amp;b=2">link</a>')
    expect(out).toContain('href="https://example.com/?a=1&amp;b=2"')
    expect(out).not.toContain('&amp;amp;')
  })

  it('rejects a scheme hidden behind a NAMED entity, not just a numeric one', () => {
    const out = sanitizeRichText('<a href="java&Tab;script:alert(1)">x</a>')
    expect(out).not.toContain('href=')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('still rejects a numeric reference written without its semicolon', () => {
    const out = sanitizeRichText('<a href="&#106avascript:alert(1)">x</a>')
    expect(out).not.toContain('href=')
  })
})
