import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TEXT_CAP,
  base64ByteLength,
  classifyDocument,
  decodeBase64Text,
  documentIntro,
  truncateForPrompt,
} from './ai-documents'

describe('classifyDocument', () => {
  it('reads plain text families as text', () => {
    expect(classifyDocument('brief.txt', 'text/plain').kind).toBe('text')
    expect(classifyDocument('brief.md', 'text/markdown').kind).toBe('text')
    expect(classifyDocument('rows.csv', 'text/csv').kind).toBe('text')
    expect(classifyDocument('export.json', 'application/json').kind).toBe('text')
  })

  it('trusts the extension when the browser sends nothing useful', () => {
    expect(classifyDocument('brief.md', '').kind).toBe('text')
    expect(classifyDocument('brief.md', 'application/octet-stream').kind).toBe('text')
  })

  it('ignores a charset parameter on the mime type', () => {
    expect(classifyDocument('brief.txt', 'text/plain; charset=utf-8').kind).toBe('text')
  })

  it('routes a pdf to the document block path', () => {
    expect(classifyDocument('scope.pdf', 'application/pdf').kind).toBe('pdf')
    expect(classifyDocument('scope.pdf', '').kind).toBe('pdf')
  })

  it('refuses docx by name, with the way out in the message', () => {
    const result = classifyDocument(
      'scope.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(result.kind).toBe('unsupported')
    expect(result.reason).toContain('PDF')
  })

  it('refuses a doc named only by its mime type', () => {
    const result = classifyDocument(
      'scope',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(result.kind).toBe('unsupported')
    expect(result.reason).toContain('PDF')
  })

  it('refuses anything else without pretending to know what it is', () => {
    const result = classifyDocument('shot.png', 'image/png')
    expect(result.kind).toBe('unsupported')
    expect(result.reason).toBeTruthy()
  })
})

describe('base64ByteLength', () => {
  it('measures the decoded size, not the encoded one', () => {
    expect(base64ByteLength(btoa('hello'))).toBe(5)
    expect(base64ByteLength(btoa('hi'))).toBe(2)
    expect(base64ByteLength('')).toBe(0)
  })

  it('ignores the line breaks a wrapped encoder inserts', () => {
    const encoded = btoa('hello world, this is a brief')
    const wrapped = `${encoded.slice(0, 8)}\r\n${encoded.slice(8)}`
    expect(base64ByteLength(wrapped)).toBe(base64ByteLength(encoded))
  })

  it('has a cap a 5 MB file passes and a 6 MB file does not', () => {
    expect(DOCUMENT_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('decodeBase64Text', () => {
  it('round-trips utf-8, including the characters a brief actually contains', () => {
    const source = 'Kia ora. Colour, organise, centre. 50% off.'
    expect(decodeBase64Text(btoa(unescape(encodeURIComponent(source))))).toBe(source)
  })

  it('round-trips a multi-byte character', () => {
    const source = 'Māori macron and an emoji: \u{1F331}'
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(source)))
    expect(decodeBase64Text(encoded)).toBe(source)
  })
})

describe('truncateForPrompt', () => {
  it('leaves a short document alone', () => {
    expect(truncateForPrompt('short')).toEqual({ text: 'short', truncated: false })
  })

  it('cuts at the cap and says so', () => {
    const long = 'x'.repeat(DOCUMENT_TEXT_CAP + 100)
    const result = truncateForPrompt(long)
    expect(result.text).toHaveLength(DOCUMENT_TEXT_CAP)
    expect(result.truncated).toBe(true)
  })

  it('takes a smaller cap when one is passed', () => {
    expect(truncateForPrompt('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
  })
})

describe('documentIntro', () => {
  it('names the file so the model can cite it', () => {
    expect(documentIntro('scope.pdf', false)).toContain('scope.pdf')
  })

  it('says out loud when the model is only seeing part of it', () => {
    expect(documentIntro('scope.txt', true)).toContain('first part')
  })
})
