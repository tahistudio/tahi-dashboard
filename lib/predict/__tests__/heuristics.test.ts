/**
 * The answer when the model cannot be reached.
 *
 * The point of every case here is a field that is NOT returned. A fallback
 * that fills a due date from an empty cohort, or a priority from prose that
 * never claimed urgency, is worse than no fallback: it is the confident
 * nonsense the whole feature exists to avoid.
 */
import { describe, it, expect } from 'vitest'
import {
  ESCALATION_KEYWORDS,
  heuristicPredictions,
  matchesEscalation,
  turnaroundFromCohorts,
} from '@/lib/predict/heuristics'
import { emptyStudioFacts, type PredictableField, type StudioFacts } from '@/lib/predict/types'

const ALL: readonly PredictableField[] = ['dueDate', 'priority', 'estimatedHours', 'category', 'size']

function facts(over: Partial<StudioFacts> = {}): StudioFacts {
  return { ...emptyStudioFacts(), orgName: 'Kowhai Co', ...over }
}

function run(over: {
  title?: string
  description?: string
  category?: string | null
  empty?: readonly PredictableField[]
  facts?: StudioFacts
} = {}) {
  return heuristicPredictions({
    subject: 'request',
    title: over.title ?? 'Rebuild the pricing page hero',
    description: over.description,
    category: over.category ?? 'design',
    empty: over.empty ?? ALL,
    todayIso: '2026-09-05',
    facts: over.facts ?? facts(),
  })
}

describe('matchesEscalation', () => {
  it('catches the words the table names', () => {
    for (const word of ESCALATION_KEYWORDS) {
      expect(matchesEscalation(`please fix, this is ${word} today`), word).toBe(true)
    }
  })

  it('is case insensitive', () => {
    expect(matchesEscalation('This is URGENT')).toBe(true)
  })

  it('does not fire on a word that merely contains one', () => {
    // "rush" inside "brushed", "asap" inside a URL slug.
    expect(matchesEscalation('the brushed metal treatment on the hero')).toBe(false)
    expect(matchesEscalation('see /docs/asapi-notes for the shape')).toBe(false)
  })

  it('does not fire on ordinary prose', () => {
    expect(matchesEscalation('Refresh the homepage hero with the new photography')).toBe(false)
  })
})

describe('priority', () => {
  it('flags high when the words say so', () => {
    const out = run({ title: 'Homepage checkout is broken for everyone' })
    expect(out.priority?.value).toBe('high')
    expect(out.priority?.reason.length).toBeGreaterThan(0)
  })

  it('says nothing when the words do not, rather than writing standard on purpose', () => {
    // 'standard' is already the control's value. Suggesting it would be a
    // suggestion badge on a field nobody changed.
    expect(run().priority).toBeUndefined()
  })

  it('reads the brief as well as the title', () => {
    expect(run({ description: 'The client has escalated this to their board.' }).priority?.value)
      .toBe('high')
  })

  it('stays quiet when priority was not asked for', () => {
    expect(run({ title: 'This is urgent and broken today', empty: ['dueDate'] }).priority)
      .toBeUndefined()
  })
})

describe('due date', () => {
  it('adds the client median to the caller\'s own today', () => {
    const out = run({ facts: facts({ orgTurnaroundDays: 4, cohortCount: 9 }) })
    expect(out.dueDate?.value).toBe('2026-09-09')
    expect(out.dueDate?.reason).toContain('Kowhai Co')
  })

  it('rounds a partial day up rather than down', () => {
    const out = run({ facts: facts({ orgTurnaroundDays: 3.1, cohortCount: 7 }) })
    expect(out.dueDate?.value).toBe('2026-09-09')
  })

  it('falls back to the studio median and says whose it is', () => {
    const out = run({ facts: facts({ studioTurnaroundDays: 6, cohortCount: 40 }) })
    expect(out.dueDate?.value).toBe('2026-09-11')
    expect(out.dueDate?.reason).toContain('studio')
  })

  it('produces no due date at all when there is no cohort', () => {
    expect(run({ facts: facts() }).dueDate).toBeUndefined()
  })
})

describe('turnaroundFromCohorts', () => {
  it('uses the client cohort once it reaches the floor of five', () => {
    const answer = turnaroundFromCohorts([1, 2, 3, 4, 5], [10, 10, 10, 10, 10, 10])
    expect(answer).toEqual({ days: 3, cohortCount: 5, scope: 'client' })
  })

  it('falls through to the studio at four client rows', () => {
    const answer = turnaroundFromCohorts([1, 2, 3, 4], [8, 8, 8, 10, 12])
    expect(answer?.scope).toBe('studio')
    expect(answer?.days).toBe(8)
  })

  it('answers null when neither cohort reaches the floor', () => {
    expect(turnaroundFromCohorts([1, 2], [3, 4, 5, 6])).toBeNull()
  })

  it('answers null on two empty cohorts', () => {
    expect(turnaroundFromCohorts([], [])).toBeNull()
  })

  it('counts only usable rows toward the floor', () => {
    // Five rows, but two are backdated faults, so the client cohort is three.
    const answer = turnaroundFromCohorts([-1, -2, 3, 4, 5], [9, 9, 9, 9, 9])
    expect(answer?.scope).toBe('studio')
  })
})

describe('size', () => {
  it('passes the existing deterministic suggester through', () => {
    // development is a multi-day category in lib/request-size-suggestion.
    expect(run({ category: 'development' }).size?.value).toBe('large')
    expect(run({ category: 'admin' }).size?.value).toBe('small')
  })

  it('collapses to small on a plan with no multi-day track', () => {
    const out = run({ category: 'development', facts: facts({ canUseLargeTrack: false }) })
    expect(out.size?.value).toBe('small')
  })

  it('is never offered on a task, which has no size column', () => {
    const out = heuristicPredictions({
      subject: 'task',
      title: 'Write the quarterly capacity review',
      empty: ALL,
      todayIso: '2026-09-05',
      facts: facts(),
    })
    expect(out.size).toBeUndefined()
  })
})

describe('estimated hours', () => {
  it('rounds the billed median to a quarter hour', () => {
    expect(run({ facts: facts({ categoryMedianHours: 6.31 }) }).estimatedHours?.value).toBe(6.25)
  })

  it('says nothing when no comparable work has been billed', () => {
    expect(run().estimatedHours).toBeUndefined()
  })
})

describe('what it never guesses', () => {
  it('leaves category and assignee to the model, or to nobody', () => {
    // A keyword table picking what kind of work this is, or who does it, would
    // be confident about the two things it has no evidence for.
    const out = run({ facts: facts({ orgTurnaroundDays: 4, cohortCount: 9, usualAssigneeId: 'tm_1' }) })
    expect(out.category).toBeUndefined()
    expect(out.assigneeId).toBeUndefined()
  })

  it('every suggestion it does make clears the threshold', () => {
    const out = run({
      title: 'The checkout is broken and urgent',
      category: 'development',
      facts: facts({ orgTurnaroundDays: 4, cohortCount: 9, categoryMedianHours: 8 }),
    })
    const values = Object.values(out)
    expect(values.length).toBe(4)
    for (const s of values) expect(s.confidence).toBeGreaterThanOrEqual(0.6)
  })
})
