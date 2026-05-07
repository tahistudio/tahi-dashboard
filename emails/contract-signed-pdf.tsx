/**
 * <ContractSignedPdf> — React-PDF document for a fully-signed contract.
 *
 * Sent as an attachment to every signer + the contract creator once the
 * last signature is recorded. Captures:
 *   - hero with contract name + "FULLY SIGNED" pill
 *   - rendered contract body (HTML reduced to RPDF flow elements: headings,
 *     paragraphs, lists, links — anything fancier degrades to text)
 *   - signers section with name / role / email / signed timestamp + the
 *     signature image embedded inline
 *   - audit footer with the SHA-256 final hash and the public viewer URL
 *
 * Brand styling is intentionally sober. This is a legal artifact, not a
 * marketing deck — Manrope, brand-50 panels, leaf radius on the hero only.
 */
import {
  Document, Page, Text, View, Image, StyleSheet, Link,
} from '@react-pdf/renderer'
import type { ReactElement } from 'react'

// ── Tokens (mirrors emails/_components.tsx so the PDF reads as the same
//    family). React-PDF doesn't honour CSS vars, so hex are inlined here.

const T = {
  bg: '#ffffff',
  surface: '#f7f9f6',
  brand: '#5A824E',
  brandDark: '#425F39',
  brandLight: '#7aab6b',
  brand50: '#f0f7ee',
  brand100: '#dcefd8',
  text: '#121A0F',
  textMuted: '#5a6657',
  textSubtle: '#8a9987',
  border: '#d4e0d0',
  borderSubtle: '#e8f0e6',
  successBg: '#f0fdf4',
  success: '#16a34a',
  successBorder: '#bbf7d0',
} as const

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontSize: 10.5,
    lineHeight: 1.55,
    color: T.text,
    fontFamily: 'Helvetica',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: T.borderSubtle,
    paddingBottom: 18,
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  wordmark: {
    fontSize: 11,
    fontWeight: 700,
    color: T.brandDark,
    letterSpacing: -0.2,
  },
  studioTagline: {
    fontSize: 8,
    fontWeight: 700,
    color: T.textSubtle,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  hero: {
    backgroundColor: T.brand50,
    borderColor: T.brand100,
    borderWidth: 1,
    // Asymmetric leaf radius — top-left + bottom-right square, the others
    // rounded. React-PDF doesn't support per-corner radius via shorthand,
    // so we emulate with a single radius.
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 22,
    marginBottom: 22,
  },
  eyebrow: {
    fontSize: 8.5,
    fontWeight: 700,
    color: T.brand,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heading: {
    fontSize: 22,
    fontWeight: 800,
    color: T.text,
    lineHeight: 1.2,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 11,
    color: T.textMuted,
    marginBottom: 14,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: T.successBg,
    borderColor: T.successBorder,
    borderWidth: 1,
    borderRadius: 999,
    color: T.success,
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionLabel: {
    fontSize: 8.5,
    fontWeight: 700,
    color: T.textSubtle,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 8,
  },
  contractBody: {
    marginBottom: 22,
  },
  bodyHeading1: {
    fontSize: 14,
    fontWeight: 700,
    color: T.text,
    marginBottom: 6,
    marginTop: 14,
  },
  bodyHeading2: {
    fontSize: 12,
    fontWeight: 700,
    color: T.text,
    marginBottom: 5,
    marginTop: 10,
  },
  bodyHeading3: {
    fontSize: 11,
    fontWeight: 700,
    color: T.text,
    marginBottom: 4,
    marginTop: 8,
  },
  bodyParagraph: {
    fontSize: 10.5,
    color: T.text,
    lineHeight: 1.55,
    marginBottom: 8,
  },
  bodyListItem: {
    fontSize: 10.5,
    color: T.text,
    lineHeight: 1.55,
    marginBottom: 3,
    marginLeft: 14,
  },
  bodyLink: {
    color: T.brand,
    textDecoration: 'underline',
  },
  bodyStrong: {
    fontWeight: 700,
  },
  bodyEm: {
    fontStyle: 'italic',
  },
  signerCard: {
    backgroundColor: T.surface,
    borderColor: T.borderSubtle,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  signerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  signerName: {
    fontSize: 12,
    fontWeight: 700,
    color: T.text,
  },
  signerMeta: {
    fontSize: 9,
    color: T.textMuted,
    marginTop: 2,
  },
  signerRolePill: {
    fontSize: 8,
    fontWeight: 700,
    color: T.brandDark,
    backgroundColor: T.brand100,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  signatureCanvas: {
    backgroundColor: T.bg,
    borderColor: T.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginTop: 6,
  },
  signatureImg: {
    height: 60,
    objectFit: 'contain',
  },
  signedAt: {
    fontSize: 9,
    color: T.textSubtle,
    marginTop: 8,
  },
  auditCard: {
    backgroundColor: T.brand50,
    borderColor: T.brand100,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 18,
  },
  auditLabel: {
    fontSize: 8,
    fontWeight: 700,
    color: T.brandDark,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  auditValue: {
    fontSize: 9,
    color: T.text,
    fontFamily: 'Courier',
    lineHeight: 1.4,
  },
  auditSpacer: {
    height: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: T.textSubtle,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: T.borderSubtle,
    paddingTop: 8,
  },
})

export interface ContractSignedPdfProps {
  contractName: string
  contractType: string
  signedAt: string
  finalHash: string | null
  publicViewerUrl: string
  bodyHtml: string
  signers: Array<{
    id: string
    name: string
    email: string
    role: string
    signedAt: string | null
    signatureDataUrl: string | null
  }>
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'Non-disclosure agreement',
  sla: 'Service-level agreement',
  msa: 'Master services agreement',
  sow: 'Statement of work',
  mou: 'Memorandum of understanding',
  other: 'Contract',
}

const ROLE_LABEL: Record<string, string> = {
  tahi: 'Tahi Studio',
  client: 'Client',
  other: 'Other',
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

export function ContractSignedPdf(props: ContractSignedPdfProps) {
  const typeLabel = TYPE_LABEL[props.contractType] ?? 'Contract'
  return (
    <Document
      title={`${props.contractName} — Signed`}
      subject={`Fully signed ${typeLabel.toLowerCase()}`}
      author="Tahi Studio"
      creator="Tahi Dashboard"
      producer="Tahi Dashboard"
    >
      <Page size="A4" style={styles.page}>
        {/* ── Header ─────────────────────────────────────── */}
        <View style={styles.header} fixed>
          <View style={styles.brandRow}>
            <Text style={styles.wordmark}>Tahi Studio</Text>
            <Text style={styles.studioTagline}>Signed contract</Text>
          </View>
        </View>

        {/* ── Hero ───────────────────────────────────────── */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{typeLabel}</Text>
          <Text style={styles.heading}>{props.contractName}</Text>
          <Text style={styles.subheading}>
            Fully signed on {formatTimestamp(props.signedAt)}.
          </Text>
          <Text style={styles.pill}>Fully signed</Text>
        </View>

        {/* ── Contract body ──────────────────────────────── */}
        <Text style={styles.sectionLabel}>Agreement</Text>
        <View style={styles.contractBody}>
          {renderHtmlBlocks(props.bodyHtml)}
        </View>

        {/* ── Signatures ─────────────────────────────────── */}
        <Text style={styles.sectionLabel} break>Signatures</Text>
        {props.signers.map(s => (
          <View key={s.id} style={styles.signerCard} wrap={false}>
            <View style={styles.signerRow}>
              <View>
                <Text style={styles.signerName}>{s.name}</Text>
                <Text style={styles.signerMeta}>{s.email}</Text>
              </View>
              <Text style={styles.signerRolePill}>
                {ROLE_LABEL[s.role] ?? s.role}
              </Text>
            </View>
            {s.signatureDataUrl ? (
              <View style={styles.signatureCanvas}>
                {/* React-PDF accepts data URLs directly. */}
                <Image src={s.signatureDataUrl} style={styles.signatureImg} />
              </View>
            ) : (
              <Text style={styles.signedAt}>Signature unavailable.</Text>
            )}
            <Text style={styles.signedAt}>
              Signed {formatTimestamp(s.signedAt)}
            </Text>
          </View>
        ))}

        {/* ── Audit anchor ───────────────────────────────── */}
        <View style={styles.auditCard} wrap={false}>
          <Text style={styles.auditLabel}>Tamper-evident chain anchor</Text>
          <Text style={styles.auditValue}>
            SHA-256: {props.finalHash ?? 'unavailable'}
          </Text>
          <View style={styles.auditSpacer} />
          <Text style={styles.auditLabel}>Public viewer</Text>
          <Link src={props.publicViewerUrl} style={styles.bodyLink}>
            <Text style={styles.auditValue}>{props.publicViewerUrl}</Text>
          </Link>
        </View>

        {/* ── Footer ─────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text>Tahi Studio · business@tahi.studio</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

export default ContractSignedPdf

// ─── HTML → React-PDF flow ─────────────────────────────────────────────
//
// Tiptap-authored contract bodies are HTML. The PDF flow here is small
// and deterministic: we walk a parsed-DOM tree and emit React-PDF Text /
// View elements for the supported tag set. Anything we don't recognise
// degrades to plain text, which is exactly what we want for a legal
// artifact — the signed words appear, just without ornamentation.
//
// Supported: h1-h3, p, br, ul/ol/li, strong/b, em/i, a (link), hr, span, div.
// Unsupported (images, tables, blockquotes, code) flatten to text content.

interface SimpleNode {
  type: 'text' | 'element'
  tag?: string
  text?: string
  href?: string
  children?: SimpleNode[]
}

function renderHtmlBlocks(html: string): ReactElement[] {
  const nodes = parseHtml(html)
  const out: ReactElement[] = []
  let key = 0
  for (const n of nodes) {
    out.push(...renderBlock(n, () => key++))
  }
  return out
}

function renderBlock(node: SimpleNode, nextKey: () => number): ReactElement[] {
  if (node.type === 'text') {
    const t = node.text?.trim()
    if (!t) return []
    return [<Text key={nextKey()} style={styles.bodyParagraph}>{t}</Text>]
  }
  if (node.type !== 'element') return []
  const tag = (node.tag ?? '').toLowerCase()
  switch (tag) {
    case 'h1':
      return [<Text key={nextKey()} style={styles.bodyHeading1}>{flattenInline(node)}</Text>]
    case 'h2':
      return [<Text key={nextKey()} style={styles.bodyHeading2}>{flattenInline(node)}</Text>]
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [<Text key={nextKey()} style={styles.bodyHeading3}>{flattenInline(node)}</Text>]
    case 'p':
      return [<Text key={nextKey()} style={styles.bodyParagraph}>{flattenInlineRich(node, nextKey)}</Text>]
    case 'br':
      return [<Text key={nextKey()} style={styles.bodyParagraph}>{'\n'}</Text>]
    case 'hr':
      return [<View key={nextKey()} style={{ height: 1, backgroundColor: T.borderSubtle, marginVertical: 8 }} />]
    case 'ul':
    case 'ol': {
      const items = (node.children ?? []).filter(c => c.type === 'element' && (c.tag ?? '').toLowerCase() === 'li')
      const isOrdered = tag === 'ol'
      return items.map((item, i) => (
        <Text key={nextKey()} style={styles.bodyListItem}>
          {isOrdered ? `${i + 1}. ` : '• '}
          {flattenInlineRich(item, nextKey)}
        </Text>
      ))
    }
    case 'div':
    case 'section':
    case 'article': {
      const out: ReactElement[] = []
      for (const c of node.children ?? []) out.push(...renderBlock(c, nextKey))
      return out
    }
    default:
      // Anything else (table, blockquote, etc): flatten inline content
      // so the words still render.
      return [<Text key={nextKey()} style={styles.bodyParagraph}>{flattenInline(node)}</Text>]
  }
}

// Plain-text flatten for headings (no link/strong styling needed there).
function flattenInline(node: SimpleNode): string {
  if (node.type === 'text') return node.text ?? ''
  let out = ''
  for (const c of node.children ?? []) out += flattenInline(c)
  return out
}

// Rich flatten for paragraphs and list items. Walks inline elements
// (strong/em/a/span) and emits styled <Text> spans inside a parent <Text>.
// React-PDF supports nested Text spans, so this works.
function flattenInlineRich(node: SimpleNode, nextKey: () => number): ReactElement[] {
  const out: ReactElement[] = []
  walkInline(node, out, nextKey, {})
  return out
}

interface InlineStyle {
  bold?: boolean
  italic?: boolean
  link?: string
}

function walkInline(node: SimpleNode, out: ReactElement[], nextKey: () => number, parentStyle: InlineStyle) {
  if (node.type === 'text') {
    if (!node.text) return
    const styleArr = []
    if (parentStyle.bold) styleArr.push(styles.bodyStrong)
    if (parentStyle.italic) styleArr.push(styles.bodyEm)
    if (parentStyle.link) styleArr.push(styles.bodyLink)
    if (parentStyle.link) {
      out.push(
        <Link key={nextKey()} src={parentStyle.link}>
          <Text style={styleArr}>{node.text}</Text>
        </Link>,
      )
    } else {
      out.push(<Text key={nextKey()} style={styleArr}>{node.text}</Text>)
    }
    return
  }
  if (node.type !== 'element') return
  const tag = (node.tag ?? '').toLowerCase()
  const childStyle: InlineStyle = { ...parentStyle }
  if (tag === 'strong' || tag === 'b') childStyle.bold = true
  if (tag === 'em' || tag === 'i') childStyle.italic = true
  if (tag === 'a' && node.href) childStyle.link = node.href
  if (tag === 'br') {
    out.push(<Text key={nextKey()}>{'\n'}</Text>)
    return
  }
  for (const c of node.children ?? []) walkInline(c, out, nextKey, childStyle)
}

// ─── Tiny HTML parser ──────────────────────────────────────────────────
//
// The Cloudflare Workers runtime doesn't have a DOM. We can't pull in a
// heavy dependency for one route, so this is a small recursive-descent
// tokeniser that handles the subset of HTML Tiptap emits. Good enough
// for contracts. No script/style support (we skip those tags). Decodes
// common entities (&amp; &lt; &gt; &quot; &#39; &nbsp;).

const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'meta', 'input', 'link'])

function parseHtml(html: string): SimpleNode[] {
  let i = 0
  const len = html.length

  function decodeEntities(s: string): string {
    return s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
  }

  function readUntil(stopChar: string): string {
    let out = ''
    while (i < len && html[i] !== stopChar) { out += html[i]; i++ }
    return out
  }

  function parseAttrs(s: string): { tag: string; attrs: Record<string, string>; selfClose: boolean } {
    let p = 0
    const skip = () => { while (p < s.length && /\s/.test(s[p])) p++ }
    skip()
    let tag = ''
    while (p < s.length && /[A-Za-z0-9-]/.test(s[p])) { tag += s[p]; p++ }
    const attrs: Record<string, string> = {}
    while (p < s.length) {
      skip()
      if (s[p] === '/' || p >= s.length) break
      let name = ''
      while (p < s.length && /[A-Za-z0-9-:_]/.test(s[p])) { name += s[p]; p++ }
      if (!name) break
      skip()
      let value = ''
      if (s[p] === '=') {
        p++
        skip()
        const q = s[p]
        if (q === '"' || q === "'") {
          p++
          while (p < s.length && s[p] !== q) { value += s[p]; p++ }
          if (s[p] === q) p++
        } else {
          while (p < s.length && !/\s|>/.test(s[p])) { value += s[p]; p++ }
        }
      }
      attrs[name.toLowerCase()] = decodeEntities(value)
    }
    const selfClose = s.trimEnd().endsWith('/')
    return { tag: tag.toLowerCase(), attrs, selfClose }
  }

  function parseNodes(stopTag?: string): SimpleNode[] {
    const out: SimpleNode[] = []
    while (i < len) {
      if (html[i] === '<') {
        // Comment
        if (html.startsWith('<!--', i)) {
          const end = html.indexOf('-->', i)
          i = end === -1 ? len : end + 3
          continue
        }
        // Doctype / processing instruction
        if (html[i + 1] === '!' || html[i + 1] === '?') {
          while (i < len && html[i] !== '>') i++
          if (html[i] === '>') i++
          continue
        }
        // Closing tag
        if (html[i + 1] === '/') {
          i += 2
          const close = readUntil('>')
          if (html[i] === '>') i++
          if (stopTag && close.trim().toLowerCase() === stopTag) return out
          continue
        }
        // Opening tag
        i++
        const inner = readUntil('>')
        if (html[i] === '>') i++
        const { tag, attrs, selfClose } = parseAttrs(inner)
        if (!tag) continue
        // Skip script / style entirely (drop their text content too).
        if (tag === 'script' || tag === 'style') {
          const closer = `</${tag}>`
          const idx = html.toLowerCase().indexOf(closer, i)
          i = idx === -1 ? len : idx + closer.length
          continue
        }
        const node: SimpleNode = {
          type: 'element',
          tag,
          href: attrs.href,
          children: [],
        }
        if (VOID_ELEMENTS.has(tag) || selfClose) {
          out.push(node)
          continue
        }
        node.children = parseNodes(tag)
        out.push(node)
      } else {
        let text = ''
        while (i < len && html[i] !== '<') { text += html[i]; i++ }
        if (text) out.push({ type: 'text', text: decodeEntities(text) })
      }
    }
    return out
  }

  return parseNodes()
}
