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

/** A PDF is not extracted here, it is handed to Claude whole, and the API
 *  caps a base64 PDF at a hundred pages for a 200K context model. Haiku 4.5
 *  is one, so this is the real ceiling on the upload. It is named in the
 *  refusal copy because a limit nobody stated is a limit nobody can act on:
 *  a 150 page brand guideline under 5 MB used to sail past both guards and
 *  come back as "the AI assistant could not be reached". */
export const DOCUMENT_PDF_MAX_PAGES = 100

const DOCUMENT_MAX_MB = DOCUMENT_MAX_BYTES / (1024 * 1024)

/** Said at both ends, so the browser and the route refuse in the same words. */
export const DOCUMENT_TOO_LARGE_MESSAGE =
  `That file is larger than ${DOCUMENT_MAX_MB} MB. Send a smaller export, or paste the text. A PDF also has to be ${DOCUMENT_PDF_MAX_PAGES} pages or fewer.`

/** The model was reached and turned the file down. That is a different fact
 *  from an unreachable model, so it gets a different sentence. */
export const DOCUMENT_REFUSED_MESSAGE =
  `The AI assistant would not take that document. A PDF has to be ${DOCUMENT_PDF_MAX_PAGES} pages or fewer, so split it up, or paste the part that matters into the chat.`

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

/**
 * Base64 with the line wrapping some encoders add taken back out.
 *
 * One place, so the size gate, the decode and the bytes actually sent to the
 * model all measure and read the same string. A browser never wraps
 * (readAsDataURL does not), but a script or an agent posting the same body
 * can, and a wrapped payload that passed a stripped size check and then went
 * out unstripped was a 502 nobody could explain.
 */
export function normaliseBase64(dataBase64: string): string {
  return dataBase64.replace(/\s+/g, '')
}

/** Decoded size in bytes, without decoding the whole thing. */
export function base64ByteLength(dataBase64: string): number {
  const clean = normaliseBase64(dataBase64)
  if (clean.length === 0) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

/** Base64 to a UTF-8 string. `atob` and TextDecoder are both in the Workers
 *  runtime and in node, so this needs no polyfill and no Buffer. */
export function decodeBase64Text(dataBase64: string): string {
  const binary = atob(normaliseBase64(dataBase64))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Base64 characters that certainly carry `cap` characters of text.
 *
 * Four bytes is the worst case for one UTF-8 character, and four base64
 * characters carry three bytes, so this over-supplies on purpose. Landing on
 * a four character boundary matters: `atob` refuses a length that is one more
 * than a multiple of four.
 */
/** U+FFFD, what a decoder leaves where a byte sequence was cut in half. */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd)

export function base64PrefixLength(cap: number = DOCUMENT_TEXT_CAP): number {
  const worstCaseBytes = Math.max(0, Math.ceil(cap)) * 4
  return Math.ceil(worstCaseBytes / 3) * 4
}

/**
 * Decode only as much of an upload as the prompt can hold.
 *
 * `decodeBase64Text` on a 5 MB text file built a five million character
 * binary string, a five megabyte byte array and a decoded string, inside a
 * Worker, to keep forty thousand characters. This reads a bounded prefix
 * instead. Anything dropped counts as truncation, which is the honest
 * reading: the model did not see the rest.
 */
export function decodeBase64Prefix(
  dataBase64: string,
  cap: number = DOCUMENT_TEXT_CAP,
): { text: string; truncated: boolean } {
  const clean = normaliseBase64(dataBase64)
  const limit = base64PrefixLength(cap)
  const dropped = clean.length > limit
  const decoded = decodeBase64Text(dropped ? clean.slice(0, limit) : clean)
  // A prefix can end mid character. The replacement it decodes to is noise,
  // and it is only ever at the very end.
  let cleaned = decoded
  while (dropped && cleaned.endsWith(REPLACEMENT_CHAR)) cleaned = cleaned.slice(0, -1)
  const cut = truncateForPrompt(cleaned, cap)
  return { text: cut.text, truncated: cut.truncated || dropped }
}

/**
 * The delimiters that tell the model where the document stops and the
 * conversation starts. A brief carrying its own instructions ("ignore the
 * above, do this") is material to summarise, not a turn to obey, and the
 * system prompt says so by name. Any delimiter hiding inside the content is
 * defused so the fence cannot be closed early.
 */
export function fenceDocumentText(text: string): string {
  const inner = text.replace(/<\/?document>/gi, '[document tag]')
  return `<document>\n${inner}\n</document>`
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
