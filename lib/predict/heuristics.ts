/**
 * lib/predict/heuristics.ts
 *
 * The answer when the model cannot be reached: no key, a timeout, or the day's
 * spend ceiling. Pure keyword tables and the studio's own medians, nothing else.
 *
 * The escalation table is the one piece worth keeping out of the deleted
 * app/api/admin/ai/suggest route, which had no callers and emitted an `urgent`
 * priority that a request cannot store. Here the same words produce `high`,
 * which is the whole of the request vocabulary above standard, and the task
 * vocabulary agrees on that value too.
 *
 * Three rules, and each one abstains rather than guesses:
 *   - a due date only when a cohort of at least COHORT_FLOOR delivered rows
 *     backs the median it is built from
 *   - a high priority only when the text actually says so
 *   - an estimate only when this category has billed hours behind it
 *
 * Category and assignee are never guessed here. A keyword table picking who
 * does the work, or what kind of work it is, would be confident about exactly
 * the two things it has no evidence for.
 */

import { suggestRequestSize } from '@/lib/request-size-suggestion'
import { meetsCohortFloor, median, usableTurnarounds, isoDateAfter, roundUpDays } from './stats'
import type {
  PredictSubject,
  PredictSuggestions,
  PredictableField,
  StudioFacts,
} from './types'

/**
 * Words that mean the person is telling you this one is hot. Stems where a
 * stem is honest ("escalat" covers escalate, escalated, escalation), whole
 * words otherwise, and nothing so common that ordinary prose trips it.
 */
export const ESCALATION_KEYWORDS: readonly string[] = [
  'urgent',
  'urgently',
  'asap',
  'rush',
  'critical',
  'emergency',
  'hotfix',
  'blocker',
  'blocking',
  'blocked',
  'broken',
  'outage',
  'deadline',
  'escalated',
  'escalation',
  'going live',
  'launch day',
]

const ESCALATION_PATTERN = new RegExp(
  `(?:^|\\W)(?:${ESCALATION_KEYWORDS.map(w => w.replace(/\s+/g, '\\s+')).join('|')})(?:\\W|$)`,
  'i',
)

/** True when the title or brief signals urgency in the person's own words. */
export function matchesEscalation(text: string): boolean {
  return ESCALATION_PATTERN.test(text)
}

/**
 * The turnaround median to build a due date from, or null.
 *
 * The client's own cohort first, because "how long does OUR work take" is the
 * question being answered. Below the floor it falls through to the studio, and
 * below the floor there too it answers null: a median of two rows is an
 * anecdote, and a due date built on one would be a promise with nothing
 * underneath it.
 */
export function turnaroundFromCohorts(
  orgDeltas: readonly (number | null | undefined)[],
  studioDeltas: readonly (number | null | undefined)[],
): { days: number; cohortCount: number; scope: 'client' | 'studio' } | null {
  const org = usableTurnarounds(orgDeltas)
  if (meetsCohortFloor(org.length)) {
    const days = median(org)
    if (days !== null) return { days, cohortCount: org.length, scope: 'client' }
  }
  const studio = usableTurnarounds(studioDeltas)
  if (meetsCohortFloor(studio.length)) {
    const days = median(studio)
    if (days !== null) return { days, cohortCount: studio.length, scope: 'studio' }
  }
  return null
}

export interface HeuristicInput {
  subject: PredictSubject
  title: string
  description?: string
  category?: string | null
  /** The fields still worth filling. Anything outside this is not returned. */
  empty: readonly PredictableField[]
  /** The caller's own calendar date. */
  todayIso: string
  facts: StudioFacts
}

/** Confidences. Stated as constants so the fallback's honesty is one edit wide. */
const DUE_DATE_CONFIDENCE = 0.65
const PRIORITY_CONFIDENCE = 0.7
const SIZE_CONFIDENCE = 0.6
const HOURS_CONFIDENCE = 0.6

export function heuristicPredictions(input: HeuristicInput): PredictSuggestions {
  const { subject, title, description, category, empty, todayIso, facts } = input
  const wanted = new Set(empty)
  const out: PredictSuggestions = {}

  if (wanted.has('dueDate')) {
    const days = facts.orgTurnaroundDays ?? facts.studioTurnaroundDays
    if (days !== null) {
      const rounded = roundUpDays(days)
      const value = isoDateAfter(todayIso, rounded)
      if (value) {
        const scope = facts.orgTurnaroundDays !== null
          ? `${facts.orgName ?? 'this client'}'s`
          : 'the studio\'s'
        out.dueDate = {
          value,
          reason: `${scope} recent work of this kind has taken about ${rounded} ${rounded === 1 ? 'day' : 'days'}.`,
          confidence: DUE_DATE_CONFIDENCE,
        }
      }
    }
  }

  if (wanted.has('priority') && matchesEscalation(`${title} ${description ?? ''}`)) {
    out.priority = {
      value: 'high',
      reason: 'The wording reads as urgent, so this is flagged above the standard queue.',
      confidence: PRIORITY_CONFIDENCE,
    }
  }

  if (wanted.has('size') && subject === 'request') {
    const suggestion = suggestRequestSize({
      brief: description,
      category,
      canUseLargeTrack: facts.canUseLargeTrack,
    })
    out.size = {
      value: suggestion.size,
      reason: suggestion.hint,
      confidence: SIZE_CONFIDENCE,
    }
  }

  if (wanted.has('estimatedHours') && facts.categoryMedianHours !== null) {
    const hours = Math.round(facts.categoryMedianHours * 4) / 4
    if (hours > 0) {
      out.estimatedHours = {
        value: hours,
        reason: `Billed hours on comparable ${category ?? 'recent'} work sit around ${hours}.`,
        confidence: HOURS_CONFIDENCE,
      }
    }
  }

  return out
}
