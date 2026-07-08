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
