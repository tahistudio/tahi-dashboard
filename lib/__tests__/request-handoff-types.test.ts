import { describe, it, expect } from 'vitest'
import {
  waitingReasonSentence,
  waitingReasonShortLabel,
  waitingActionVerb,
  daysWaiting,
  waitingChipText,
  waitingBlockedByLine,
  waitingBannerText,
  firstName,
  isWaitingReason,
  WAITING_REASONS,
  WAITING_REASON_OPTIONS,
  type WaitingOnSummary,
} from '@/lib/request-handoff-types'

describe('waitingReasonSentence', () => {
  it('matches the agreed copy for every reason', () => {
    expect(waitingReasonSentence('approval')).toBe('Needs your approval')
    expect(waitingReasonSentence('content')).toBe('Needs content from you')
    expect(waitingReasonSentence('access')).toBe('Needs access from you')
    expect(waitingReasonSentence('decision')).toBe('Needs a decision from you')
    expect(waitingReasonSentence('file')).toBe('Needs a file from you')
    expect(waitingReasonSentence('other')).toBe('Needs something from you')
  })

  it('has exactly six reasons, in contract order', () => {
    expect(WAITING_REASONS).toEqual(['approval', 'content', 'access', 'decision', 'file', 'other'])
  })
})

describe('waitingActionVerb', () => {
  it('maps approval to Approve', () => {
    expect(waitingActionVerb('approval')).toBe('Approve')
  })

  it('maps content and file to Upload or reply', () => {
    expect(waitingActionVerb('content')).toBe('Upload or reply')
    expect(waitingActionVerb('file')).toBe('Upload or reply')
  })

  it('maps access, decision and other to Reply', () => {
    expect(waitingActionVerb('access')).toBe('Reply')
    expect(waitingActionVerb('decision')).toBe('Reply')
    expect(waitingActionVerb('other')).toBe('Reply')
  })
})

describe('waitingReasonShortLabel', () => {
  it('returns the lowercase reason word', () => {
    expect(waitingReasonShortLabel('approval')).toBe('approval')
    expect(waitingReasonShortLabel('other')).toBe('other')
  })
})

describe('daysWaiting', () => {
  const now = new Date('2026-09-18T12:00:00.000Z')

  it('is zero for a pointer set moments ago', () => {
    expect(daysWaiting('2026-09-18T11:00:00.000Z', now)).toBe(0)
  })

  it('is zero for a pointer set in the future (clock skew, never negative)', () => {
    expect(daysWaiting('2026-09-19T00:00:00.000Z', now)).toBe(0)
  })

  it('floors rather than rounds a partial day', () => {
    // 1 day 23 hours ago -> 1 full day, not 2.
    expect(daysWaiting('2026-09-16T13:00:00.000Z', now)).toBe(1)
  })

  it('counts exactly three whole days', () => {
    expect(daysWaiting('2026-09-15T12:00:00.000Z', now)).toBe(3)
  })

  it('treats an unparseable timestamp as zero', () => {
    expect(daysWaiting('not-a-date', now)).toBe(0)
  })
})

describe('waitingChipText', () => {
  const now = new Date('2026-09-18T12:00:00.000Z')

  const base: WaitingOnSummary = {
    contactId: 'c1',
    contactName: 'Jordan Reyes',
    reason: 'approval',
    since: '2026-09-15T12:00:00.000Z',
    dueAt: null,
    note: null,
  }

  it('formats as "Waiting on <first name> · <reason> · <n>d"', () => {
    expect(waitingChipText(base, now)).toBe('Waiting on Jordan · approval · 3d')
  })

  it('prefers a precomputed daysWaiting over recomputing from since', () => {
    expect(waitingChipText({ ...base, daysWaiting: 9 }, now)).toBe('Waiting on Jordan · approval · 9d')
  })

  it('uses the first name only for a multi-word contact name', () => {
    expect(waitingChipText({ ...base, contactName: 'Staci Bonnie Miller' }, now))
      .toBe('Waiting on Staci · approval · 3d')
  })
})

describe('firstName', () => {
  it('splits on whitespace and takes the first token', () => {
    expect(firstName('Jordan Reyes')).toBe('Jordan')
  })

  it('returns the whole string when there is no space', () => {
    expect(firstName('Jordan')).toBe('Jordan')
  })

  it('trims surrounding whitespace first', () => {
    expect(firstName('  Jordan Reyes  ')).toBe('Jordan')
  })
})

describe('waitingBlockedByLine', () => {
  it('reads "Waiting on <name> for <reason>"', () => {
    const summary: WaitingOnSummary = {
      contactId: 'c1',
      contactName: 'Jordan Reyes',
      reason: 'decision',
      since: '2026-09-15T12:00:00.000Z',
      dueAt: null,
      note: null,
    }
    expect(waitingBlockedByLine(summary)).toBe('Waiting on Jordan Reyes for decision')
  })
})

describe('waitingBannerText', () => {
  it('prefixes the reason sentence with "This is with you: "', () => {
    expect(waitingBannerText('content')).toBe('This is with you: Needs content from you')
  })
})

describe('isWaitingReason', () => {
  it('accepts every known reason', () => {
    for (const reason of WAITING_REASONS) expect(isWaitingReason(reason)).toBe(true)
  })

  it('rejects an unknown string', () => {
    expect(isWaitingReason('urgent')).toBe(false)
  })
})

describe('WAITING_REASON_OPTIONS', () => {
  it('has one option per reason with a capitalised label and the full sentence', () => {
    expect(WAITING_REASON_OPTIONS).toHaveLength(6)
    const approval = WAITING_REASON_OPTIONS.find(o => o.value === 'approval')
    expect(approval?.label).toBe('Approval')
    expect(approval?.sentence).toBe('Needs your approval')
  })
})
