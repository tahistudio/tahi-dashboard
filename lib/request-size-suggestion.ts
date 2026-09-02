/**
 * lib/request-size-suggestion.ts
 *
 * Size stops being a forced choice in the new request dialog. The brief and
 * the category are enough to guess whether a piece of work runs a day or
 * spans several, so the dialog suggests one and lets the person move on:
 * clients see the suggestion as a chip with a quiet Change link, the team
 * keeps the control and gets the same suggestion as a hint line underneath.
 *
 * Two rules decide it, and one rule overrides both:
 *   - a long brief (more words than BRIEF_WORD_THRESHOLD) reads as multi-day
 *   - development and strategy read as multi-day whatever the brief length
 *   - a plan with no large track can never run multi-day work, so the
 *     suggestion collapses to a single-day track and says so
 *
 * Pure and framework-free so the dialog, the API, and the tests all agree.
 */

export type SuggestedSize = 'small' | 'large'

/** More words than this in the brief reads as multi-day work. */
export const BRIEF_WORD_THRESHOLD = 60

/** Categories that are multi-day by nature, however short the brief. */
export const MULTI_DAY_CATEGORIES: readonly string[] = ['development', 'strategy']

const SMALL_LABEL = '1 day or less'
const LARGE_LABEL = 'multi-day'
const SINGLE_TRACK_LINE = 'Your plan runs a single-day track.'
const CONFIRM_LINE = "We'll confirm the size when we review it."

export interface SizeSuggestionInput {
  /** The brief as typed. Plain text or rich-text HTML, both counted the same. */
  brief?: string | null
  /** The request category, e.g. 'design' | 'development'. */
  category?: string | null
  /** False when the org's plan has no large track. Forces a single-day suggestion. */
  canUseLargeTrack: boolean
  /** True when the brief was drafted by the AI assist, which the chip credits. */
  fromAi?: boolean
}

export interface SizeSuggestion {
  /** The suggested size. */
  size: SuggestedSize
  /** Human label for the size on its own, e.g. 'multi-day'. */
  sizeLabel: string
  /** What the client-facing chip reads. */
  chipLabel: string
  /** The line under the client chip. */
  helper: string
  /** The line under the team control. */
  hint: string
}

/**
 * Words in a brief, with any HTML stripped first so a rich-text brief is
 * counted on its text rather than its markup.
 */
export function countBriefWords(brief?: string | null): number {
  if (!brief) return 0
  const text = brief
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/** The suggested size plus every string the dialog renders around it. */
export function suggestRequestSize(input: SizeSuggestionInput): SizeSuggestion {
  const { brief, category, canUseLargeTrack, fromAi } = input

  if (!canUseLargeTrack) {
    return {
      size: 'small',
      sizeLabel: SMALL_LABEL,
      // Not a suggestion when there is nothing to choose between: the chip
      // states the size and the line underneath says why.
      chipLabel: SMALL_LABEL,
      helper: SINGLE_TRACK_LINE,
      hint: SINGLE_TRACK_LINE,
    }
  }

  const longBrief = countBriefWords(brief) > BRIEF_WORD_THRESHOLD
  const bigCategory = !!category && MULTI_DAY_CATEGORIES.includes(category)
  const size: SuggestedSize = longBrief || bigCategory ? 'large' : 'small'
  const sizeLabel = size === 'large' ? LARGE_LABEL : SMALL_LABEL

  return {
    size,
    sizeLabel,
    chipLabel: `${fromAi ? 'Suggested by AI assist' : 'Suggested'}: ${sizeLabel}`,
    helper: CONFIRM_LINE,
    hint: `Suggested: ${sizeLabel}, based on the brief.`,
  }
}

/** The suggestion in the vocabulary the requests API takes. */
export function sizeToRequestType(size: SuggestedSize): 'small_task' | 'large_task' {
  return size === 'large' ? 'large_task' : 'small_task'
}
