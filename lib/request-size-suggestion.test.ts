import { describe, it, expect } from 'vitest'
import {
  BRIEF_WORD_THRESHOLD,
  MULTI_DAY_CATEGORIES,
  countBriefWords,
  suggestRequestSize,
  sizeToRequestType,
} from './request-size-suggestion'

/** A brief of exactly `n` words. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ')
}

describe('countBriefWords', () => {
  it('counts plain words', () => {
    expect(countBriefWords('refresh the homepage hero')).toBe(4)
  })

  it('treats an empty or blank brief as zero', () => {
    expect(countBriefWords('')).toBe(0)
    expect(countBriefWords('   \n  ')).toBe(0)
    expect(countBriefWords(null)).toBe(0)
    expect(countBriefWords(undefined)).toBe(0)
  })

  it('ignores html tags so a rich-text brief is not inflated', () => {
    expect(countBriefWords('<p>one <b>two</b></p><ul><li>three</li></ul>')).toBe(3)
  })

  it('collapses runs of whitespace', () => {
    expect(countBriefWords('one \n\n  two\tthree')).toBe(3)
  })
})

describe('suggestRequestSize', () => {
  const base = { category: 'design', canUseLargeTrack: true }

  it('suggests one day or less for a short brief in a small category', () => {
    const s = suggestRequestSize({ ...base, brief: words(10) })
    expect(s.size).toBe('small')
    expect(s.sizeLabel).toBe('1 day or less')
    expect(s.chipLabel).toBe('Suggested: 1 day or less')
    expect(s.helper).toBe("We'll confirm the size when we review it.")
    expect(s.hint).toBe('Suggested: 1 day or less, based on the brief.')
  })

  it('suggests multi-day once the brief passes the word threshold', () => {
    expect(suggestRequestSize({ ...base, brief: words(BRIEF_WORD_THRESHOLD) }).size).toBe('small')
    expect(suggestRequestSize({ ...base, brief: words(BRIEF_WORD_THRESHOLD + 1) }).size).toBe('large')
  })

  it('suggests multi-day for the bigger-scope categories whatever the brief length', () => {
    for (const category of MULTI_DAY_CATEGORIES) {
      const s = suggestRequestSize({ category, canUseLargeTrack: true, brief: 'fix it' })
      expect(s.size).toBe('large')
      expect(s.sizeLabel).toBe('multi-day')
      expect(s.chipLabel).toBe('Suggested: multi-day')
      expect(s.hint).toBe('Suggested: multi-day, based on the brief.')
    }
  })

  it('leaves the other categories on the word count alone', () => {
    for (const category of ['design', 'content', 'admin', 'bug']) {
      expect(suggestRequestSize({ category, canUseLargeTrack: true, brief: 'a short note' }).size).toBe('small')
    }
  })

  it('never suggests multi-day when the plan has no large track', () => {
    const s = suggestRequestSize({ category: 'development', canUseLargeTrack: false, brief: words(200) })
    expect(s.size).toBe('small')
    expect(s.sizeLabel).toBe('1 day or less')
    expect(s.chipLabel).toBe('1 day or less')
    expect(s.helper).toBe('Your plan runs a single-day track.')
    expect(s.hint).toBe('Your plan runs a single-day track.')
  })

  it('credits the AI assist on the chip when the brief came from it', () => {
    const s = suggestRequestSize({ ...base, brief: words(80), fromAi: true })
    expect(s.chipLabel).toBe('Suggested by AI assist: multi-day')
    // The hint line under the team control stays about the brief either way.
    expect(s.hint).toBe('Suggested: multi-day, based on the brief.')
  })

  it('does not credit the AI assist when the plan has no large track', () => {
    const s = suggestRequestSize({ category: 'design', canUseLargeTrack: false, brief: words(80), fromAi: true })
    expect(s.chipLabel).toBe('1 day or less')
  })

  it('handles a missing brief', () => {
    const s = suggestRequestSize({ category: 'design', canUseLargeTrack: true, brief: undefined })
    expect(s.size).toBe('small')
  })

  it('is unaffected by an unknown category', () => {
    expect(suggestRequestSize({ category: 'nonsense', canUseLargeTrack: true, brief: 'short' }).size).toBe('small')
  })
})

describe('sizeToRequestType', () => {
  it('maps the suggestion onto the request type the API takes', () => {
    expect(sizeToRequestType('small')).toBe('small_task')
    expect(sizeToRequestType('large')).toBe('large_task')
  })
})
