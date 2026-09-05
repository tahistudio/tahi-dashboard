/**
 * lib/predict/parse.ts
 *
 * The model's answer, validated hard.
 *
 * This is the deliberate opposite of the triage route's `parseSuggestion`,
 * which coerces anything it does not recognise to a default and substitutes a
 * canned sentence for a missing reason, so a thin-context answer comes back
 * looking exactly as confident as a good one. Here every field that fails its
 * check is DROPPED. Nothing is coerced, nothing is defaulted, and an empty
 * object is a legitimate answer.
 *
 * Four filters, in order, and a field has to survive all four:
 *   1. it was asked for, and applies to this subject
 *   2. the operator has not already filled it
 *   3. the value is in the vocabulary (or the roster, or the date shape)
 *   4. the confidence clears CONFIDENCE_THRESHOLD
 */

import { isRequestCategory, isRequestPriority } from '@/lib/request-vocabulary'
import { isTaskPriority } from '@/lib/task-priorities'
import {
  CONFIDENCE_THRESHOLD,
  fieldAppliesTo,
  isPredictableField,
  type FieldSuggestion,
  type PredictSubject,
  type PredictSuggestions,
  type PredictableField,
} from './types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REASON_CHARS = 200
const MAX_ESTIMATED_HOURS = 200

/**
 * The first JSON object in the model text, tolerating fences.
 *
 * The house pattern: strip a fence if there is one, then take everything
 * between the first `{` and the last `}` so a stray sentence either side does
 * not fail the parse.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export interface ParseContext {
  subject: PredictSubject
  /** The caller's own calendar date. A due date before it is dropped. */
  todayIso: string
  /** Only these fields may come back. */
  requested: readonly PredictableField[]
  /** Ids the model may name as an assignee. Anything else is a hallucination. */
  rosterIds: readonly string[]
  /** Fields the operator has already touched. Never returned, whatever the model says. */
  filledKeys: readonly string[]
  /**
   * False when this client's plan has no multi-day track, which makes 'large'
   * a value the control cannot hold. The prompt says so too, but a sentence in
   * a prompt is a request and this is the rule: everything else in this file
   * abstains rather than letting a value through for someone else to correct,
   * and a suggested size the dialog immediately rewrites back to Small, with
   * the reason still arguing for multi-day above it, is exactly that.
   */
  canUseLargeTrack: boolean
}

function asReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_REASON_CHARS)
}

function asConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > 1) return null
  return value
}

/** The value for one field, or null when it is not one this field can hold. */
function validateValue(
  field: PredictableField,
  value: unknown,
  ctx: ParseContext,
): string | number | null {
  switch (field) {
    case 'priority': {
      if (typeof value !== 'string') return null
      const ok = ctx.subject === 'request' ? isRequestPriority(value) : isTaskPriority(value)
      return ok ? value : null
    }
    case 'category':
      return typeof value === 'string' && isRequestCategory(value) ? value : null
    case 'size':
      if (value === 'small') return value
      return value === 'large' && ctx.canUseLargeTrack ? value : null
    case 'assigneeId':
      return typeof value === 'string' && ctx.rosterIds.includes(value) ? value : null
    case 'dueDate': {
      if (typeof value !== 'string' || !ISO_DATE.test(value)) return null
      // A string compare is a date compare in this format, which is the whole
      // reason the caller sends its own calendar date rather than a timestamp.
      return value >= ctx.todayIso ? value : null
    }
    case 'estimatedHours': {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n) || n <= 0 || n > MAX_ESTIMATED_HOURS) return null
      return Math.round(n * 4) / 4
    }
  }
}

/** One raw entry off the model, as a suggestion or nothing. */
function readEntry(
  field: PredictableField,
  raw: unknown,
  ctx: ParseContext,
): FieldSuggestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>

  const confidence = asConfidence(entry.confidence)
  if (confidence === null || confidence < CONFIDENCE_THRESHOLD) return null

  const reason = asReason(entry.reason)
  if (!reason) return null

  const value = validateValue(field, entry.value, ctx)
  if (value === null) return null

  return { value, reason, confidence }
}

/**
 * The suggestions worth showing, out of whatever the model returned.
 *
 * Returns an empty object rather than null when nothing survives: an empty
 * answer is the normal case and the caller should not have to tell it apart
 * from a failure.
 */
export function parsePredictions(text: string, ctx: ParseContext): PredictSuggestions {
  const parsed = extractJsonObject(text)
  if (!parsed) return {}

  // The prompt asks for a flat object, but a model that wraps its answer in
  // `suggestions` has still answered, and unwrapping is cheaper than a retry.
  const source = (parsed.suggestions && typeof parsed.suggestions === 'object' && !Array.isArray(parsed.suggestions))
    ? parsed.suggestions as Record<string, unknown>
    : parsed

  const requested = new Set<PredictableField>(ctx.requested)
  const filled = new Set(ctx.filledKeys)
  const out: PredictSuggestions = {}

  for (const [key, raw] of Object.entries(source)) {
    if (!isPredictableField(key)) continue
    if (!requested.has(key)) continue
    if (filled.has(key)) continue
    if (!fieldAppliesTo(key, ctx.subject)) continue
    const suggestion = readEntry(key, raw, ctx)
    if (suggestion) out[key] = suggestion
  }

  return out
}
