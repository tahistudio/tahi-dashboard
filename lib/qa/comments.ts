/**
 * Pure helpers for Site QA element comments (SQA.2). No database, no Next.js
 * imports: the routes do the I/O and call these for shape and validation.
 */
import {
  QA_COMMENT_BODY_MAX,
  QA_DEFAULT_BROWSER,
  QA_CONTEXT_CLASS_MAX,
  QA_CONTEXT_HTML_MAX,
  QA_CONTEXT_MAX_ANCESTORS,
  QA_CONTEXT_MAX_BYTES,
  QA_CONTEXT_MAX_CLASSES,
  QA_VIEWPORTS,
  QA_VIEWPORT_KEYS,
  browserLabel,
  isQaBrowserKey,
  type QaBrowserKey,
  type QaComment,
  type QaCommentDetail,
  type QaCommentStatus,
  type QaContextAncestor,
  type QaElementContext,
  type QaTarget,
  type QaViewportInfo,
  type QaViewportKey,
} from '@/lib/qa/types'

export const COMMENT_SELECTOR_MAX = 1000
export const COMMENT_TAG_MAX = 40
export const COMMENT_TEXT_MAX = 200
export const COMMENT_REQUEST_ID_MAX = 64

/** One qa_comments row as Drizzle returns it. */
export interface CommentRow {
  id: string
  roundPageId: string
  viewport: string
  /** QaBrowserKey; an unknown value reads as Chrome */
  browser: string
  selector: string
  ox: number
  oy: number
  elementTag: string | null
  elementText: string | null
  body: string
  status: string
  requestId: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  /** JSON text of a QaElementContext, null when the comment has none */
  elementContext: string | null
}

export interface CommentInput {
  viewport: QaViewportKey
  /** null when the request names none: the route then uses the round's first browser */
  browser: QaBrowserKey | null
  selector: string
  ox: number
  oy: number
  elementTag: string | null
  elementText: string | null
  body: string
  elementContext: QaElementContext | null
}

export interface CommentPatch {
  body?: string
  status?: QaCommentStatus
  requestId?: string | null
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Clamps a finite number into 0..1. Non-finite numbers are rejected by the parsers, not here. */
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Trims text and cuts it to max characters. Empty text becomes null. */
function optionalText(v: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  const trimmed = v.trim().slice(0, max)
  return { ok: true, value: trimmed || null }
}

export function rowToComment(row: CommentRow): QaComment {
  const browser: QaBrowserKey = isQaBrowserKey(row.browser) ? row.browser : QA_DEFAULT_BROWSER
  return {
    id: row.id,
    roundPageId: row.roundPageId,
    viewport: row.viewport as QaViewportKey,
    browser,
    browserLabel: browserLabel(browser),
    selector: row.selector,
    ox: row.ox,
    oy: row.oy,
    elementTag: row.elementTag,
    elementText: row.elementText,
    body: row.body,
    status: row.status as QaCommentStatus,
    requestId: row.requestId,
    authorId: row.authorId,
    authorName: row.authorName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    elementContext: parseStoredContext(row.elementContext),
  }
}

// Element context (where a picked element sits)

const CONTEXT_ID_MAX = 200
const CONTEXT_TAG_MAX = 40
const CONTEXT_NUMBER_MAX = 10_000_000

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim().slice(0, max)
  return trimmed || null
}

function cleanClasses(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    const cls = cleanString(item, QA_CONTEXT_CLASS_MAX)
    if (cls) out.push(cls)
    if (out.length >= QA_CONTEXT_MAX_CLASSES) break
  }
  return out
}

function cleanNumber(v: unknown): number {
  if (!isFiniteNumber(v)) return 0
  return Math.round(Math.min(CONTEXT_NUMBER_MAX, Math.max(-CONTEXT_NUMBER_MAX, v)))
}

function cleanAncestors(v: unknown): QaContextAncestor[] {
  if (!Array.isArray(v)) return []
  const out: QaContextAncestor[] = []
  for (const item of v) {
    if (!isRecord(item)) continue
    const tag = cleanString(item.tag, CONTEXT_TAG_MAX)
    if (!tag) continue
    out.push({ tag: tag.toLowerCase(), id: cleanString(item.id, CONTEXT_ID_MAX), classes: cleanClasses(item.classes) })
    if (out.length >= QA_CONTEXT_MAX_ANCESTORS) break
  }
  return out
}

function contextBytes(ctx: QaElementContext): number {
  return new TextEncoder().encode(JSON.stringify(ctx)).length
}

/**
 * Validates and clamps element context from a client. Invalid parts are
 * dropped (empty list, empty text, zero) rather than rejecting the comment.
 * Returns null when the input is not an object or still exceeds the 8 KB cap
 * after the html, then the ancestors, are shed.
 */
export function parseElementContext(raw: unknown): QaElementContext | null {
  if (!isRecord(raw)) return null
  const box = isRecord(raw.box) ? raw.box : {}
  const ctx: QaElementContext = {
    id: cleanString(raw.id, CONTEXT_ID_MAX),
    classes: cleanClasses(raw.classes),
    ancestors: cleanAncestors(raw.ancestors),
    html: typeof raw.html === 'string' ? raw.html.slice(0, QA_CONTEXT_HTML_MAX) : '',
    box: { x: cleanNumber(box.x), y: cleanNumber(box.y), width: cleanNumber(box.width), height: cleanNumber(box.height) },
    scrollY: cleanNumber(raw.scrollY),
    pageHeight: cleanNumber(raw.pageHeight),
    viewportWidth: cleanNumber(raw.viewportWidth),
    viewportHeight: cleanNumber(raw.viewportHeight),
  }
  if (contextBytes(ctx) <= QA_CONTEXT_MAX_BYTES) return ctx
  ctx.html = ''
  if (contextBytes(ctx) <= QA_CONTEXT_MAX_BYTES) return ctx
  ctx.ancestors = []
  if (contextBytes(ctx) <= QA_CONTEXT_MAX_BYTES) return ctx
  return null
}

/** Reads a stored context column. Bad or missing JSON gives null. */
export function parseStoredContext(text: string | null): QaElementContext | null {
  if (!text) return null
  try {
    return parseElementContext(JSON.parse(text))
  } catch {
    return null
  }
}

// Detail shape for MCP and the round comments endpoint

const WEBFLOW_BREAKPOINTS: Record<QaViewportKey, string> = {
  xl: '1920px breakpoint if enabled, else 1440px, else 1280px, else Desktop (base)',
  desktop: '1440px breakpoint if enabled, else 1280px, else Desktop (base)',
  tablet: 'Tablet (991px and below)',
  mobile_l: 'Mobile portrait (479px and below); this frame is 425px wide',
  mobile_p: 'Mobile portrait (479px and below); this frame is 375px wide',
}

export function viewportInfoFor(key: QaViewportKey): QaViewportInfo {
  const vp = QA_VIEWPORTS.find(v => v.key === key) ?? QA_VIEWPORTS[1]
  return { key: vp.key, label: vp.label, width: vp.width, height: vp.height, webflowBreakpoint: WEBFLOW_BREAKPOINTS[vp.key] }
}

/** The site origin plus the path, or null when the site has no usable URL for the target. */
export function pageUrlFor(siteUrl: string | null, path: string): string | null {
  if (!siteUrl) return null
  try {
    const origin = new URL(siteUrl.trim()).origin
    return origin + (path.startsWith('/') ? path : `/${path}`)
  } catch {
    return null
  }
}

export interface CommentDetailContext {
  roundId: string
  roundName: string
  siteName: string
  target: QaTarget
  /** the site's URL for the round target (staging or live) */
  siteUrl: string | null
}

export function toCommentDetail(row: CommentRow, n: number, path: string, ctx: CommentDetailContext): QaCommentDetail {
  const comment = rowToComment(row)
  return {
    ...comment,
    n,
    path,
    pageUrl: pageUrlFor(ctx.siteUrl, path),
    target: ctx.target,
    viewportInfo: viewportInfoFor(comment.viewport),
    roundId: ctx.roundId,
    roundName: ctx.roundName,
    siteName: ctx.siteName,
  }
}

/** Validates the body of a POST. Text is trimmed, element text is truncated rather than rejected. */
export function parseCommentInput(body: unknown): ParseResult<CommentInput> {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' }

  if (typeof body.viewport !== 'string' || !QA_VIEWPORT_KEYS.includes(body.viewport as QaViewportKey)) {
    return { ok: false, error: 'viewport is not a known QA viewport' }
  }

  let browser: QaBrowserKey | null = null
  if (body.browser !== undefined && body.browser !== null) {
    if (!isQaBrowserKey(body.browser)) return { ok: false, error: 'browser must be chromium, firefox or webkit' }
    browser = body.browser
  }

  if (typeof body.selector !== 'string') return { ok: false, error: 'selector must be text' }
  const selector = body.selector.trim()
  if (selector.length < 1 || selector.length > COMMENT_SELECTOR_MAX) {
    return { ok: false, error: `selector must be 1 to ${COMMENT_SELECTOR_MAX} characters` }
  }

  if (!isFiniteNumber(body.ox) || !isFiniteNumber(body.oy)) {
    return { ok: false, error: 'ox and oy must be finite numbers' }
  }

  const tag = optionalText(body.elementTag, COMMENT_TAG_MAX)
  if (!tag.ok) return { ok: false, error: 'elementTag must be text' }
  const text = optionalText(body.elementText, COMMENT_TEXT_MAX)
  if (!text.ok) return { ok: false, error: 'elementText must be text' }

  if (typeof body.body !== 'string') return { ok: false, error: 'body must be text' }
  const commentBody = body.body.trim()
  if (commentBody.length < 1 || commentBody.length > QA_COMMENT_BODY_MAX) {
    return { ok: false, error: `body must be 1 to ${QA_COMMENT_BODY_MAX} characters` }
  }

  return {
    ok: true,
    value: {
      viewport: body.viewport as QaViewportKey,
      browser,
      selector,
      ox: clampUnit(body.ox),
      oy: clampUnit(body.oy),
      elementTag: tag.value,
      elementText: text.value,
      body: commentBody,
      elementContext: parseElementContext(body.elementContext),
    },
  }
}

/**
 * Validates the body of a PATCH. Only keys that are present are returned, and
 * at least one must be present. Unknown keys are ignored.
 */
export function parseCommentPatch(body: unknown): ParseResult<CommentPatch> {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' }

  const patch: CommentPatch = {}

  if ('body' in body) {
    if (typeof body.body !== 'string') return { ok: false, error: 'body must be text' }
    const commentBody = body.body.trim()
    if (commentBody.length < 1 || commentBody.length > QA_COMMENT_BODY_MAX) {
      return { ok: false, error: `body must be 1 to ${QA_COMMENT_BODY_MAX} characters` }
    }
    patch.body = commentBody
  }

  if ('status' in body) {
    if (body.status !== 'open' && body.status !== 'resolved') {
      return { ok: false, error: "status must be 'open' or 'resolved'" }
    }
    patch.status = body.status
  }

  if ('requestId' in body) {
    if (body.requestId === null) {
      patch.requestId = null
    } else {
      if (typeof body.requestId !== 'string') return { ok: false, error: 'requestId must be text or null' }
      const requestId = body.requestId.trim()
      if (requestId.length < 1 || requestId.length > COMMENT_REQUEST_ID_MAX) {
        return { ok: false, error: `requestId must be 1 to ${COMMENT_REQUEST_ID_MAX} characters or null` }
      }
      patch.requestId = requestId
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update: send body, status or requestId' }
  }
  return { ok: true, value: patch }
}

/**
 * The column values to write for a PATCH. updatedAt is always bumped. Resolving
 * sets resolvedAt to now, reopening clears it, and a patch without a status
 * leaves resolvedAt alone.
 */
export function commentUpdateFields(patch: CommentPatch, nowIso: string): {
  body?: string
  status?: QaCommentStatus
  requestId?: string | null
  resolvedAt?: string | null
  updatedAt: string
} {
  const fields: {
    body?: string
    status?: QaCommentStatus
    requestId?: string | null
    resolvedAt?: string | null
    updatedAt: string
  } = { updatedAt: nowIso }
  if (patch.body !== undefined) fields.body = patch.body
  if (patch.requestId !== undefined) fields.requestId = patch.requestId
  if (patch.status !== undefined) {
    fields.status = patch.status
    fields.resolvedAt = patch.status === 'resolved' ? nowIso : null
  }
  return fields
}

/**
 * Pin numbers: 1-based per round page, in created_at order with id as the
 * tie-break. Returns a map from comment id to its number. The input is not mutated.
 */
export function numberComments<T extends { id: string; roundPageId: string; createdAt: string }>(
  rows: readonly T[],
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
  })
  const counters = new Map<string, number>()
  const numbers = new Map<string, number>()
  for (const row of sorted) {
    const next = (counters.get(row.roundPageId) ?? 0) + 1
    counters.set(row.roundPageId, next)
    numbers.set(row.id, next)
  }
  return numbers
}
