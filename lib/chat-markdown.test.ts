import { describe, it, expect } from 'vitest'
import { parseChatMarkdown, parseInline } from '@/lib/chat-markdown'

describe('parseInline', () => {
  it('renders a plain run with no markup as a single text node', () => {
    expect(parseInline('just a sentence')).toEqual([{ type: 'text', value: 'just a sentence' }])
  })

  it('extracts bold spans and keeps the surrounding text', () => {
    expect(parseInline('is **bold** here')).toEqual([
      { type: 'text', value: 'is ' },
      { type: 'bold', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' here' },
    ])
  })

  it('leaves a stray single asterisk untouched', () => {
    expect(parseInline('a * b * c')).toEqual([{ type: 'text', value: 'a * b * c' }])
  })

  it('never turns markup-looking text into an element: it stays a text node verbatim', () => {
    const nodes = parseInline('<script>alert(1)</script>')
    expect(nodes).toEqual([{ type: 'text', value: '<script>alert(1)</script>' }])
  })
})

describe('parseChatMarkdown', () => {
  it('parses a plain paragraph', () => {
    expect(parseChatMarkdown('Just a sentence.')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'Just a sentence.' }]] },
    ])
  })

  it('keeps bold inside a numbered list item', () => {
    const blocks = parseChatMarkdown('1. **What does your current site do badly?** Is it slow?')
    expect(blocks).toEqual([
      {
        type: 'ordered-list',
        items: [[
          { type: 'bold', children: [{ type: 'text', value: 'What does your current site do badly?' }] },
          { type: 'text', value: ' Is it slow?' },
        ]],
      },
    ])
  })

  it('keeps bold inside a bullet list item', () => {
    const blocks = parseChatMarkdown('- **Deadline:** next Friday')
    expect(blocks).toEqual([
      {
        type: 'bullet-list',
        items: [[
          { type: 'bold', children: [{ type: 'text', value: 'Deadline:' }] },
          { type: 'text', value: ' next Friday' },
        ]],
      },
    ])
  })

  it('groups consecutive numbered lines into one ordered list', () => {
    const blocks = parseChatMarkdown('A couple of questions:\n\n1. What is it?\n2. Where does it live?')
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'A couple of questions:' }]] },
      {
        type: 'ordered-list',
        items: [
          [{ type: 'text', value: 'What is it?' }],
          [{ type: 'text', value: 'Where does it live?' }],
        ],
      },
    ])
  })

  it('never injects HTML: markup-looking text stays a text node', () => {
    const blocks = parseChatMarkdown('<img src=x onerror=alert(1)>')
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: '<img src=x onerror=alert(1)>' }]] },
    ])
  })

  it('does not treat a single asterisk as italic anywhere in a paragraph', () => {
    const blocks = parseChatMarkdown('Price is *TBD* for now.')
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'Price is *TBD* for now.' }]] },
    ])
  })

  it('keeps a single newline within a paragraph as a second line, not a merged run-on', () => {
    const blocks = parseChatMarkdown('Line one\nLine two')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        lines: [
          [{ type: 'text', value: 'Line one' }],
          [{ type: 'text', value: 'Line two' }],
        ],
      },
    ])
  })

  it('returns no blocks for an empty reply', () => {
    expect(parseChatMarkdown('')).toEqual([])
  })
})
