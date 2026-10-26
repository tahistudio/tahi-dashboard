/**
 * Pure helpers for Site QA element comments (SQA.2). No database, no Next.js
 * imports: the routes do the I/O and call these for shape and validation.
 */
import {
  QA_COMMENT_BODY_MAX,
  QA_VIEWPORT_KEYS,
  type QaComment,
  type QaCommentStatus,
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
}

export interface CommentInput {
  viewport: QaViewportKey
  selector: string
  ox: number
  oy: number
  elementTag: string | null
  elementText: string | null
  body: string
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
  return {
    id: row.id,
    roundPageId: row.roundPageId,
    viewport: row.viewport as QaViewportKey,
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
  }
}

/** Validates the body of a POST. Text is trimmed, element text is truncated rather than rejected. */
export function parseCommentInput(body: unknown): ParseResult<CommentInput> {
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' }

  if (typeof body.viewport !== 'string' || !QA_VIEWPORT_KEYS.includes(body.viewport as QaViewportKey)) {
    return { ok: false, error: 'viewport is not a known QA viewport' }
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
      selector,
      ox: clampUnit(body.ox),
      oy: clampUnit(body.oy),
      elementTag: tag.value,
      elementText: text.value,
      body: commentBody,
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
