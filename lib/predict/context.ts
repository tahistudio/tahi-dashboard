/**
 * lib/predict/context.ts
 *
 * The one gate that decides whether there is enough to guess from.
 *
 * It lives here rather than in the route because both sides run it: the
 * browser hook checks it before it spends a fetch, and the route checks it
 * again before it spends a model call. Two copies of a rule this cheap would
 * drift on the first tweak, and the drift would show up as a request the
 * dialog fires and the route always answers empty.
 *
 * "Enough" is deliberately blunt. Four words and sixteen characters is about
 * where a title stops being a placeholder ("new page", "fix") and starts
 * carrying the nouns a guess can be justified from.
 */

import type { PredictSubject } from './types'

export const MIN_TITLE_WORDS = 4
export const MIN_TITLE_CHARS = 16

/** Words in a title, counted the way a person would. */
export function countWords(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

export interface ContextInput {
  subject: PredictSubject
  title: string
  /** The client this will be filed against, when one is chosen. */
  orgId?: string | null
  /** Tasks only. A studio task legitimately has no client. */
  level?: string | null
}

/**
 * Whether a prediction is worth asking for.
 *
 * A request always needs a client: the whole point of the grounding is what
 * this client's work usually looks like, and without one the answer is a
 * studio average dressed up as a judgement. A task may instead be
 * `tahi_internal`, which has no client by construction.
 */
export function hasEnoughContext({ subject, title, orgId, level }: ContextInput): boolean {
  const trimmed = title.trim()
  if (trimmed.length < MIN_TITLE_CHARS) return false
  if (countWords(trimmed) < MIN_TITLE_WORDS) return false
  if (orgId) return true
  return subject === 'task' && level === 'tahi_internal'
}
