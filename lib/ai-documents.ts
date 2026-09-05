/**
 * lib/ai-documents.ts
 *
 * Turning an uploaded brief into something Claude can read, inside a Worker.
 *
 * Scope is stated rather than discovered: text families are decoded here, a
 * PDF is handed to Claude as a document content block (it reads the file
 * itself), and .docx is refused with the way out in the message. There is no
 * zip reader in a Worker (DecompressionStream does gzip and deflate, not zip
 * containers) and no PDF text extractor in this repo, so anything else would
 * be a silent failure dressed as an answer.
 *
 * Nothing here persists. files.orgId is NOT NULL and a studio task has no
 * client, so an uploaded brief has no legal home in the files table; it is
 * read, used, and dropped, and the draft records which file it came from.
 */

/** 5 MB of actual file. Bigger than any brief the studio has ever been sent,
 *  small enough that a base64 body stays comfortable in a Worker. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024

/** Characters of extracted text handed to the model. Roughly ten thousand
 *  tokens, which is a long brief and a bounded bill. */
export const DOCUMENT_TEXT_CAP = 40_000

export type DocumentKind = 'text' | 'pdf' | 'unsupported'

export interface DocumentClassification {
  kind: DocumentKind
  /** Shown to the person verbatim when the kind is unsupported. */
  reason?: string
}

const TEXT_MIME = ['text/plain', 'text/markdown', 'text/csv', 'application/json']
const TEXT_EXT = ['.txt', '.md', '.markdown', '.csv', '.json', '.log']

function extensionOf(filename: string): string {
  const cut = filename.lastIndexOf('.')
  return cut === -1 ? '' : filename.slice(cut).toLowerCase()
}

/** Mime first, extension second. A browser drag often sends
 *  application/octet-stream for a .md, and refusing that would be silly. */
export function classifyDocument(filename: string, mimeType: string): DocumentClassification {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim()
  const ext = extensionOf(filename)

  if (mime === 'application/pdf' || ext === '.pdf') return { kind: 'pdf' }
  if (TEXT_MIME.includes(mime) || mime.startsWith('text/')) return { kind: 'text' }
  if (TEXT_EXT.includes(ext)) return { kind: 'text' }

  if (ext === '.docx' || ext === '.doc' || mime.includes('wordprocessingml') || mime === 'application/msword') {
    return {
      kind: 'unsupported',
      reason: 'Word files cannot be read here yet. Export it as a PDF, or paste the text straight into the chat.',
    }
  }

  return {
    kind: 'unsupported',
    reason: 'That file type cannot be read here. Text, Markdown, CSV and PDF work, or paste the text into the chat.',
  }
}

/** Decoded size in bytes, without decoding the whole thing. */
export function base64ByteLength(dataBase64: string): number {
  const clean = dataBase64.replace(/[\r\n]/g, '')
  if (clean.length === 0) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

/** Base64 to a UTF-8 string. `atob` and TextDecoder are both in the Workers
 *  runtime and in node, so this needs no polyfill and no Buffer. */
export function decodeBase64Text(dataBase64: string): string {
  const binary = atob(dataBase64.replace(/[\r\n]/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function truncateForPrompt(
  text: string,
  cap: number = DOCUMENT_TEXT_CAP,
): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: text.slice(0, cap), truncated: true }
}

/** The line above the extracted text, so the model knows what it is looking
 *  at and, when the file was long, that it is not looking at all of it. */
export function documentIntro(filename: string, truncated: boolean): string {
  const base = `The following is the content of an uploaded document called "${filename}".`
  return truncated
    ? `${base} Only the first part of it is included here, so say so if the work looks incomplete.`
    : base
}
