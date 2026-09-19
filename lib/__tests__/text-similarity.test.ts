/**
 * lib/text-similarity.ts, the measure behind "we already have that".
 *
 * What is pinned here is the judgement the duplicate guard makes on the
 * studio's behalf. Two people describing one piece of work never type the
 * same sentence: "Add LinkedIn insight tag to global footer" on a call in
 * March and "LinkedIn Insight Tag in the footer" on a call in April are one
 * request, and a guard that cannot see that is decoration.
 *
 * The other half is the false positive, which is the expensive one: a guard
 * that blocks "Fix the calculator" because the client also has "Fix the
 * contact form" trains the founder to press Approve anyway, and then it
 * guards nothing. So the unrelated pairs are pinned as hard as the paraphrases.
 */
import { describe, it, expect } from 'vitest'
import {
  SIMILAR_BLOCK,
  SIMILAR_WARN,
  findSimilar,
  normaliseTitle,
  similarityScore,
} from '../text-similarity'

describe('normaliseTitle', () => {
  it('lower cases, strips punctuation and collapses whitespace', () => {
    expect(normaliseTitle('  Cut   the HERO video!! ')).toBe('cut hero video')
  })

  it('strips the markdown a pasted proposal arrives wrapped in', () => {
    expect(normaliseTitle('**Rebuild the pricing page** (see `notes`)')).toBe('rebuild pricing see notes')
  })

  it('drops the words that carry no meaning in a work title', () => {
    // "update", "new", "add", "fix", "page", "site" and the articles are the
    // words every second title has: left in, they make any two requests look
    // half alike.
    expect(normaliseTitle('Add a new section to the pricing page')).toBe('section pricing')
  })

  it('keeps numbers, which are often the whole difference', () => {
    expect(normaliseTitle('Cut a 30s hero video')).toBe('cut 30s hero video')
  })
})

describe('similarityScore', () => {
  it('scores a title against itself as 1', () => {
    expect(similarityScore('Cut a 30s hero video', 'Cut a 30s hero video')).toBe(1)
  })

  it('sees through the wording of a paraphrase', () => {
    const score = similarityScore(
      'Add LinkedIn insight tag to global footer',
      'LinkedIn Insight Tag in the footer',
    )
    expect(score).toBeGreaterThanOrEqual(SIMILAR_WARN)
  })

  it('is blind to case and spacing', () => {
    expect(similarityScore('Rebuild the pricing page', '  REBUILD  the   Pricing Page ')).toBe(1)
  })

  it('leaves two unrelated titles well below the warning line', () => {
    expect(similarityScore('Cut a 30s hero video', 'Reconcile the August invoices')).toBeLessThan(SIMILAR_WARN)
    expect(similarityScore('Fix the calculator', 'Write the launch email')).toBeLessThan(SIMILAR_WARN)
  })

  it('does not let two titles made mostly of stopwords look alike', () => {
    // Both sides normalise to nothing once the stopwords go. The honest answer
    // is "these are different", not "these are identical empty strings".
    expect(similarityScore('Update the website page', 'Fix the site')).toBeLessThan(SIMILAR_WARN)
  })

  it('answers 0 for an empty side rather than throwing', () => {
    expect(similarityScore('', 'Cut a 30s hero video')).toBe(0)
    expect(similarityScore('Cut a 30s hero video', '   ')).toBe(0)
  })

  it('keeps the two thresholds in the order the guard assumes', () => {
    expect(SIMILAR_WARN).toBeLessThan(SIMILAR_BLOCK)
    expect(SIMILAR_BLOCK).toBeLessThanOrEqual(1)
  })

  it('puts the same work said twice over the blocking line', () => {
    expect(similarityScore('Cut the hero video to 30 seconds', 'Cut the hero video down to 30 seconds'))
      .toBeGreaterThanOrEqual(SIMILAR_BLOCK)
  })

  it('treats a title that adds real scope as a warning, not a block', () => {
    // "for the homepage" is new information. The human should see the match
    // and still be allowed to create it with one click.
    const score = similarityScore('Cut a 30s hero video', 'Cut a 30s hero video for the homepage and the pitch deck')
    expect(score).toBeGreaterThanOrEqual(SIMILAR_WARN)
    expect(score).toBeLessThan(SIMILAR_BLOCK)
  })
})

describe('findSimilar', () => {
  const candidates = [
    { id: 'r1', title: 'Cut a 30s hero video', status: 'in_progress' },
    { id: 'r2', title: 'Reconcile the August invoices', status: 'submitted' },
    { id: 'r3', title: 'Cut the hero video down to thirty seconds', status: 'in_review' },
  ]

  it('returns the matches best first, carrying the candidate through', () => {
    const matches = findSimilar('Cut a 30s hero video', candidates)
    expect(matches[0].id).toBe('r1')
    expect(matches[0].status).toBe('in_progress')
    expect(matches[0].score).toBe(1)
    expect(matches.map(m => m.id)).not.toContain('r2')
  })

  it('honours a threshold above the default', () => {
    expect(findSimilar('Cut a 30s hero video', candidates, SIMILAR_BLOCK).map(m => m.id)).toEqual(['r1'])
  })

  it('answers nothing for a title nobody is close to', () => {
    expect(findSimilar('Renew the domain', candidates)).toEqual([])
  })

  it('answers nothing for an empty title rather than matching everything', () => {
    expect(findSimilar('   ', candidates)).toEqual([])
  })

  it('never hands back more than five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, title: 'Cut a 30s hero video' }))
    expect(findSimilar('Cut a 30s hero video', many)).toHaveLength(5)
  })
})
