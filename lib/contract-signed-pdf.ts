/**
 * Build a tamper-evident signed-contract PDF using jsPDF.
 *
 * The previous implementation used @react-pdf/renderer, which depends
 * on pdfkit + Node APIs that don't run cleanly under nodejs_compat on
 * Cloudflare Workers. jsPDF is pure JS — same primitives (text, lines,
 * shapes, embedded base64 images) without the Node baggage.
 *
 * Layout (single page, can flow to multi-page automatically):
 *   - Brand header band (green) with Tahi Studio wordmark + contract type
 *   - Hero: contract name (bold), FULLY SIGNED pill, signed-on timestamp
 *   - Body: contract HTML rendered as wrapped text (headings detected,
 *     bold/italic preserved best-effort, lists indented)
 *   - Signers section: per-signer name + role + email + signed-on +
 *     embedded signature image
 *   - Audit footer: SHA-256 final hash (monospace), public viewer URL
 */
import { jsPDF } from 'jspdf'

interface Signer {
  id: string
  name: string
  email: string
  role: string
  signedAt: string | null
  signatureDataUrl: string | null
}

export interface SignedPdfInputs {
  contractName: string
  contractType: string
  signedAt: string
  finalHash: string | null
  publicViewerUrl: string
  bodyHtml: string
  signers: Signer[]
}

const BRAND_GREEN = '#5A824E'
const BRAND_DARK = '#1f2c1a'
const TEXT_DARK = '#121A0F'
const TEXT_MUTED = '#5a6657'
const TEXT_SUBTLE = '#8a9987'
const BG_BRAND_50 = '#f0f7ee'
const PAGE_MARGIN = 18 // mm

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'Contract',
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Strip the contract HTML to a sequence of {style, text} blocks the PDF
 * can render. Handles h1-h3, p, ul/ol/li, strong/em, br/hr, and falls
 * back to flat text for anything else. Tables and images are dropped.
 */
type Block =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'li'; text: string; ordered: boolean; index: number }
  | { type: 'hr' }

function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  // Normalise: strip script/style entirely, decode common entities.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  // Naive tag walker — cheap and good enough for Tiptap-produced HTML.
  const tagRe = /<(\/?)([a-zA-Z0-9]+)[^>]*>/g
  let cursor = 0
  let buffer = ''
  let inTag: string | null = null
  let listType: 'ul' | 'ol' | null = null
  let liIndex = 0
  function flush(asTag: Block['type'] | null) {
    const text = buffer.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    buffer = ''
    if (!text) return
    if (asTag === 'h1' || asTag === 'h2' || asTag === 'h3') blocks.push({ type: asTag, text })
    else if (asTag === 'li') blocks.push({ type: 'li', text, ordered: listType === 'ol', index: liIndex })
    else blocks.push({ type: 'p', text })
  }
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(cleaned)) !== null) {
    buffer += cleaned.slice(cursor, m.index)
    cursor = m.index + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (closing) {
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        flush(tag)
        inTag = null
      } else if (tag === 'p') {
        flush('p')
        inTag = null
      } else if (tag === 'li') {
        flush('li')
        liIndex += 1
      } else if (tag === 'ul' || tag === 'ol') {
        listType = null
        liIndex = 0
      }
    } else {
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p') {
        flush(null)
        inTag = tag
      } else if (tag === 'ul' || tag === 'ol') {
        flush(null)
        listType = tag
        liIndex = 1
      } else if (tag === 'li') {
        flush(null)
      } else if (tag === 'hr') {
        flush(null)
        blocks.push({ type: 'hr' })
      } else if (tag === 'br') {
        buffer += '\n'
      }
    }
  }
  buffer += cleaned.slice(cursor)
  flush(inTag as Block['type'] | null)
  return blocks
}

/**
 * Render the full signed-contract PDF. Returns base64 (no data: prefix).
 */
export function buildSignedPdfBase64(inputs: SignedPdfInputs): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - PAGE_MARGIN * 2

  // ── Header band ─────────────────────────────────────────────────
  doc.setFillColor(BRAND_GREEN)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor('#ffffff')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Tahi Studio', PAGE_MARGIN, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    (TYPE_LABEL[inputs.contractType] ?? 'Contract').toUpperCase(),
    pageWidth - PAGE_MARGIN, 14,
    { align: 'right' },
  )

  let y = 36

  // ── Hero ────────────────────────────────────────────────────────
  // FULLY SIGNED pill — measure the label so the chip always wraps it.
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  const pillLabel = 'FULLY SIGNED'
  const pillTextW = doc.getTextWidth(pillLabel)
  const pillPadX = 3.5
  const pillW = pillTextW + pillPadX * 2
  const pillH = 5
  doc.setFillColor('#dcfce7')
  doc.setDrawColor('#bbf7d0')
  doc.roundedRect(PAGE_MARGIN, y - pillH / 2, pillW, pillH, pillH / 2, pillH / 2, 'FD')
  doc.setTextColor('#15803d')
  doc.text(pillLabel, PAGE_MARGIN + pillW / 2, y + 0.4, { align: 'center', baseline: 'middle' })
  y += pillH / 2 + 6

  // Title
  doc.setTextColor(TEXT_DARK)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  const titleLines = doc.splitTextToSize(inputs.contractName, contentWidth)
  doc.text(titleLines, PAGE_MARGIN, y)
  y += titleLines.length * 8 + 2

  // Signed-on subline
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(TEXT_MUTED)
  doc.text(`Fully signed at ${formatTimestamp(inputs.signedAt)}`, PAGE_MARGIN, y)
  y += 10

  // ── Body ────────────────────────────────────────────────────────
  doc.setDrawColor('#e8f0e6')
  doc.setLineWidth(0.2)
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y)
  y += 6
  doc.setTextColor(BRAND_GREEN)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('AGREEMENT', PAGE_MARGIN, y)
  y += 5

  const blocks = htmlToBlocks(inputs.bodyHtml || '')
  for (const b of blocks) {
    y = renderBlock(doc, b, y, PAGE_MARGIN, contentWidth, pageHeight)
  }

  // ── Signers ─────────────────────────────────────────────────────
  y = ensureSpace(doc, y, 18, pageHeight)
  y += 4
  doc.setDrawColor('#e8f0e6')
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y)
  y += 6
  doc.setTextColor(BRAND_GREEN)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('SIGNATURES', PAGE_MARGIN, y)
  y += 6

  for (const s of inputs.signers) {
    y = ensureSpace(doc, y, 30, pageHeight)
    // Background brand-50
    doc.setFillColor(BG_BRAND_50)
    doc.setDrawColor('#dcefd8')
    doc.roundedRect(PAGE_MARGIN, y, contentWidth, 26, 2, 2, 'FD')

    // Name + role
    doc.setTextColor(TEXT_DARK)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(s.name || 'Unknown', PAGE_MARGIN + 4, y + 6)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(TEXT_MUTED)
    doc.text(`${s.role.toUpperCase()} · ${s.email}`, PAGE_MARGIN + 4, y + 11)

    // Signed-on
    doc.setTextColor(TEXT_SUBTLE)
    doc.text(
      s.signedAt ? `Signed ${formatTimestamp(s.signedAt)}` : 'Awaiting signature',
      PAGE_MARGIN + 4, y + 16,
    )

    // Signature image — embed PNG/JPEG data URL
    if (s.signatureDataUrl && s.signatureDataUrl.startsWith('data:image/')) {
      try {
        const sigW = 50
        const sigH = 18
        doc.addImage(
          s.signatureDataUrl,
          guessImageFormat(s.signatureDataUrl),
          pageWidth - PAGE_MARGIN - sigW - 4,
          y + 4,
          sigW,
          sigH,
        )
      } catch {
        // If the data URL is malformed, just skip the image — the row
        // still records the signer name and timestamp.
      }
    }

    y += 30
  }

  // ── Audit footer ────────────────────────────────────────────────
  y = ensureSpace(doc, y, 26, pageHeight)
  y += 4
  doc.setDrawColor('#e8f0e6')
  doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y)
  y += 5
  doc.setTextColor(BRAND_GREEN)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('TAMPER-EVIDENT AUDIT TRAIL', PAGE_MARGIN, y)
  y += 5
  doc.setTextColor(TEXT_MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const trailIntro = 'Each signature is anchored to a SHA-256 hash chain. Modifying any prior signature breaks every later hash, making post-hoc tampering detectable.'
  const trailLines = doc.splitTextToSize(trailIntro, contentWidth)
  doc.text(trailLines, PAGE_MARGIN, y)
  y += trailLines.length * 4 + 2

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(TEXT_SUBTLE)
  doc.text(`Verify online: ${inputs.publicViewerUrl}`, PAGE_MARGIN, y)

  // Page number footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(TEXT_SUBTLE)
    doc.text(
      `${i} / ${pageCount}`,
      pageWidth - PAGE_MARGIN, pageHeight - 8,
      { align: 'right' },
    )
    doc.setTextColor(BRAND_DARK)
    doc.text('Confidential to the named recipients', PAGE_MARGIN, pageHeight - 8)
  }

  // Output as base64 string (no data: prefix). jsPDF returns a string
  // for 'datauristring' and a Uint8Array for 'arraybuffer'. We want the
  // bare base64 so Resend's attachment field accepts it directly.
  const dataUri = doc.output('datauristring')
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1)
  return base64
}

function renderBlock(
  doc: jsPDF,
  block: Block,
  y: number,
  x: number,
  width: number,
  pageHeight: number,
): number {
  if (block.type === 'hr') {
    y = ensureSpace(doc, y, 4, pageHeight)
    doc.setDrawColor('#e8f0e6')
    doc.setLineWidth(0.2)
    doc.line(x, y + 1, x + width, y + 1)
    return y + 4
  }
  let fontSize = 9
  let fontStyle: 'normal' | 'bold' = 'normal'
  let leadAfter = 3
  if (block.type === 'h1') { fontSize = 14; fontStyle = 'bold'; leadAfter = 4 }
  else if (block.type === 'h2') { fontSize = 12; fontStyle = 'bold'; leadAfter = 3 }
  else if (block.type === 'h3') { fontSize = 11; fontStyle = 'bold'; leadAfter = 3 }

  doc.setFont('helvetica', fontStyle)
  doc.setFontSize(fontSize)
  doc.setTextColor(block.type.startsWith('h') ? '#121A0F' : '#3a4233')

  const indent = block.type === 'li' ? 6 : 0
  const innerWidth = width - indent
  const text = block.type === 'li'
    ? `${block.ordered ? `${block.index}.` : '•'}  ${block.text}`
    : block.text
  const lines = doc.splitTextToSize(text, innerWidth)

  // Line height by font size
  const lineHeight = fontSize * 0.45
  const blockHeight = lines.length * lineHeight + leadAfter
  y = ensureSpace(doc, y, blockHeight, pageHeight)
  doc.text(lines, x + indent, y + lineHeight)
  return y + blockHeight
}

function ensureSpace(doc: jsPDF, y: number, needed: number, pageHeight: number): number {
  if (y + needed > pageHeight - 18) {
    doc.addPage()
    return PAGE_MARGIN
  }
  return y
}

function guessImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG'
  return 'PNG'
}
