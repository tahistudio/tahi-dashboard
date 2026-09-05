/**
 * lib/predict/types.ts
 *
 * The shared vocabulary for predictive autofill: which fields may be guessed,
 * what one guess looks like on the wire, and the two numbers that decide
 * whether a guess is worth showing at all.
 *
 * Pure and framework-free. The route, the heuristics, the parser and the
 * browser hook all import from here so a field name can never mean two
 * different things on the two sides of the wire.
 */

export type PredictSubject = 'request' | 'task'

/**
 * The fields a prediction may fill. Deliberately short.
 *
 * `orgId`, `level`, `requestId`, `title` and `description` are absent on
 * purpose: the first three decide which record this becomes and are the
 * operator's to choose, and the last two are the thing being predicted FROM.
 * A guess at the title would be the wizard's job, not this one's.
 */
export const PREDICTABLE_FIELDS = [
  'dueDate',
  'priority',
  'estimatedHours',
  'category',
  'size',
  'assigneeId',
] as const

export type PredictableField = (typeof PREDICTABLE_FIELDS)[number]

/** Fields that exist on a request and have no counterpart on a task. */
export const REQUEST_ONLY_FIELDS: readonly PredictableField[] = ['category', 'size']

export function isPredictableField(value: unknown): value is PredictableField {
  return typeof value === 'string' && (PREDICTABLE_FIELDS as readonly string[]).includes(value)
}

/** True when the field can be filled on this subject at all. */
export function fieldAppliesTo(field: PredictableField, subject: PredictSubject): boolean {
  return subject === 'request' || !REQUEST_ONLY_FIELDS.includes(field)
}

/**
 * One guess.
 *
 * `confidence` is the model's own honesty and never reaches an operator: it
 * decides server-side whether the suggestion is emitted, and the response
 * carries it only so a test can assert the threshold. The UI shows `reason`.
 */
export interface FieldSuggestion {
  value: string | number
  /** One short operator-facing sentence. Rendered as the field's caption. */
  reason: string
  confidence: number
}

export type PredictSuggestions = Partial<Record<PredictableField, FieldSuggestion>>

/**
 * Why an answer came back empty or from the keyword tables rather than the
 * model. Never an error status: a thin brief is the normal case.
 */
export type PredictDegradedReason =
  | 'thin_context'
  | 'ai_unavailable'
  | 'ai_rate_limited'
  | 'timeout'

export interface PredictFieldsBody {
  subject: PredictSubject
  title: string
  /** Plain text. The caller strips its own HTML; the route does not parse markup. */
  description?: string
  orgId?: string | null
  /** Tasks only: client_task | internal_client_task | tahi_internal. */
  level?: string | null
  category?: string | null
  parentRequestId?: string | null
  /** Fields the operator has touched or typed. Never predicted over. */
  filled?: Record<string, unknown>
  /** Fields to predict. Capped at MAX_EMPTY_FIELDS. */
  empty?: string[]
  /** The caller's local calendar date, so "today" is their today. */
  todayIso?: string
}

export interface PredictFieldsResponse {
  suggestions: PredictSuggestions
  /** True when the answer came from the keyword tables, not the model. */
  degraded?: boolean
  reason?: PredictDegradedReason
}

/**
 * Anything the model scores below this is dropped server-side and never
 * reaches the wire. An empty `suggestions` object is the normal answer.
 */
export const CONFIDENCE_THRESHOLD = 0.6

/** More than this in one call and the prompt stops being cheap. */
export const MAX_EMPTY_FIELDS = 6

/**
 * The smallest cohort a median means anything over. Below it for the org, the
 * studio-wide cohort is tried; below it there too, no statistical suggestion
 * is emitted at all.
 */
export const COHORT_FLOOR = 5

/** One person the model may name as an assignee. Ids are validated against it. */
export interface RosterEntry {
  id: string
  name: string
  role: string | null
}

/**
 * What the studio actually knows, rendered into the prompt and used by the
 * keyword fallback. Every field is nullable: a studio with no delivered work
 * has no median, and saying nothing is the correct answer there.
 */
export interface StudioFacts {
  orgName: string | null
  planType: string | null
  /** Median created-to-delivered days for this client, null below the floor. */
  orgTurnaroundDays: number | null
  /** The same across every client, used when the org cohort is too thin. */
  studioTurnaroundDays: number | null
  /** Rows behind whichever turnaround above is non-null. */
  cohortCount: number
  /** Median billed hours for this category, from time entries on delivered work. */
  categoryMedianHours: number | null
  /** Who usually takes this category for this client. */
  usualAssigneeId: string | null
  usualAssigneeName: string | null
  /** The human-authored turnaround label off the resolved intake form. */
  slaLabel: string | null
  roster: RosterEntry[]
  /** False when the client's plan has no multi-day track. */
  canUseLargeTrack: boolean
}

export function emptyStudioFacts(): StudioFacts {
  return {
    orgName: null,
    planType: null,
    orgTurnaroundDays: null,
    studioTurnaroundDays: null,
    cohortCount: 0,
    categoryMedianHours: null,
    usualAssigneeId: null,
    usualAssigneeName: null,
    slaLabel: null,
    roster: [],
    canUseLargeTrack: true,
  }
}
