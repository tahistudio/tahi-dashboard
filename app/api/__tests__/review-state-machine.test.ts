import { describe, it, expect } from 'vitest'

/**
 * T160 - Review outreach state machine transition tests.
 *
 * Valid states: not_sent -> asked -> (yes | no | deferred)
 *   - "no"      -> neverAsk = true, outreachStatus = 'declined'
 *   - "deferred" -> outreachStatus = 'deferred', nextAskAt = now + 7 days
 *   - "yes"     -> outreachStatus = 'in_progress'
 *   - completed  -> outreachStatus = 'completed' (after full funnel)
 */

type OutreachStatus = 'not_sent' | 'asked' | 'declined' | 'deferred' | 'in_progress' | 'completed'

interface ReviewState {
  outreachStatus: OutreachStatus
  neverAsk: boolean
  nextAskAt: string | null
}

function transitionReviewState(
  current: ReviewState,
  action: 'send' | 'yes' | 'no' | 'defer' | 'complete',
  now: Date = new Date(),
): ReviewState {
  switch (action) {
    case 'send': {
      if (current.neverAsk) return current
      if (current.outreachStatus !== 'not_sent' && current.outreachStatus !== 'deferred') return current
      return { ...current, outreachStatus: 'asked', nextAskAt: null }
    }
    case 'yes': {
      if (current.outreachStatus !== 'asked') return current
      return { ...current, outreachStatus: 'in_progress', nextAskAt: null }
    }
    case 'no': {
      if (current.outreachStatus !== 'asked') return current
      return { outreachStatus: 'declined', neverAsk: true, nextAskAt: null }
    }
    case 'defer': {
      if (current.outreachStatus !== 'asked') return current
      const nextDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      return { outreachStatus: 'deferred', neverAsk: false, nextAskAt: nextDate.toISOString() }
    }
    case 'complete': {
      if (current.outreachStatus !== 'in_progress') return current
      return { ...current, outreachStatus: 'completed', nextAskAt: null }
    }
    default:
      return current
  }
}

describe('transitionReviewState', () => {
  const initial: ReviewState = { outreachStatus: 'not_sent', neverAsk: false, nextAskAt: null }

  it('transitions from not_sent to asked on send', () => {
    const result = transitionReviewState(initial, 'send')
    expect(result.outreachStatus).toBe('asked')
  })

  it('does not send if neverAsk is true', () => {
    const blocked: ReviewState = { outreachStatus: 'not_sent', neverAsk: true, nextAskAt: null }
    const result = transitionReviewState(blocked, 'send')
    expect(result.outreachStatus).toBe('not_sent')
  })

  it('transitions from asked to in_progress on yes', () => {
    const asked: ReviewState = { outreachStatus: 'asked', neverAsk: false, nextAskAt: null }
    const result = transitionReviewState(asked, 'yes')
    expect(result.outreachStatus).toBe('in_progress')
  })

  it('transitions from asked to declined on no, sets neverAsk', () => {
    const asked: ReviewState = { outreachStatus: 'asked', neverAsk: false, nextAskAt: null }
    const result = transitionReviewState(asked, 'no')
    expect(result.outreachStatus).toBe('declined')
    expect(result.neverAsk).toBe(true)
  })

  it('transitions from asked to deferred on defer, sets nextAskAt +7d', () => {
    const asked: ReviewState = { outreachStatus: 'asked', neverAsk: false, nextAskAt: null }
    const now = new Date('2026-03-28T00:00:00Z')
    const result = transitionReviewState(asked, 'defer', now)
    expect(result.outreachStatus).toBe('deferred')
    expect(result.neverAsk).toBe(false)
    expect(result.nextAskAt).toBe('2026-04-04T00:00:00.000Z')
  })

  it('can re-send from deferred state', () => {
    const deferred: ReviewState = { outreachStatus: 'deferred', neverAsk: false, nextAskAt: '2026-04-04T00:00:00Z' }
    const result = transitionReviewState(deferred, 'send')
    expect(result.outreachStatus).toBe('asked')
    expect(result.nextAskAt).toBeNull()
  })

  it('transitions from in_progress to completed', () => {
    const inProgress: ReviewState = { outreachStatus: 'in_progress', neverAsk: false, nextAskAt: null }
    const result = transitionReviewState(inProgress, 'complete')
    expect(result.outreachStatus).toBe('completed')
  })

  it('does not allow yes from not_sent', () => {
    const result = transitionReviewState(initial, 'yes')
    expect(result.outreachStatus).toBe('not_sent')
  })

  it('does not allow complete from asked', () => {
    const asked: ReviewState = { outreachStatus: 'asked', neverAsk: false, nextAskAt: null }
    const result = transitionReviewState(asked, 'complete')
    expect(result.outreachStatus).toBe('asked')
  })

  it('does not allow send from in_progress', () => {
    const inProgress: ReviewState = { outreachStatus: 'in_progress', neverAsk: false, nextAskAt: null }
    const result = transitionReviewState(inProgress, 'send')
    expect(result.outreachStatus).toBe('in_progress')
  })
})
