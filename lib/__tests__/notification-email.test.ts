/**
 * The pure half of lib/notification-email.ts: who an email can reach, what the
 * subject says, and what a rich text reply looks like once it is text.
 *
 * These are the pieces that decide whether a real person hears from us, so
 * they are pinned here rather than left to a live send. The DB and Resend
 * halves are covered where they are wired (request-status-effects, the portal
 * POST suite, the request thread routes).
 */
import { describe, it, expect } from 'vitest'
import {
  clientStatusEmailPlan,
  dedupeEmailTargets,
  greetingName,
  isSendableEmail,
  messageSummary,
  requestEmailSubject,
  studioNewRequestEmailPlan,
  threadReplyEmailPlan,
  toEmailTargets,
  toPlainText,
  truncate,
  type EmailTarget,
} from '@/lib/notification-email'

describe('isSendableEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isSendableEmail('jo@acme.co.nz')).toBe(true)
    expect(isSendableEmail('  jo@acme.com  ')).toBe(true)
  })

  it('refuses the shapes a migrated contacts table actually contains', () => {
    expect(isSendableEmail('')).toBe(false)
    expect(isSendableEmail('   ')).toBe(false)
    expect(isSendableEmail(null)).toBe(false)
    expect(isSendableEmail(undefined)).toBe(false)
    // A name pasted into the email column.
    expect(isSendableEmail('Jo Yarnall')).toBe(false)
    // Two addresses in one field.
    expect(isSendableEmail('jo@acme.com, sam@acme.com')).toBe(false)
    expect(isSendableEmail('jo@acme.com sam@acme.com')).toBe(false)
    // No domain, or a broken one.
    expect(isSendableEmail('jo@localhost')).toBe(false)
    expect(isSendableEmail('@acme.com')).toBe(false)
    expect(isSendableEmail('jo@.com')).toBe(false)
    expect(isSendableEmail('jo@acme.')).toBe(false)
  })
})

describe('toEmailTargets', () => {
  it('keeps a contact who has never signed in', () => {
    // The whole point: the bell cannot see this person, email can.
    const targets = toEmailTargets(
      [{ name: 'Jo Yarnall', email: 'jo@acme.com', clerkUserId: null }],
      'contact',
    )
    expect(targets).toEqual([
      { email: 'jo@acme.com', name: 'Jo Yarnall', userType: 'contact', clerkUserId: null },
    ])
  })

  it('drops rows with no usable address and trims the rest', () => {
    const targets = toEmailTargets(
      [
        { name: 'Jo', email: '  jo@acme.com ', clerkUserId: 'user_1' },
        { name: 'Nobody', email: '', clerkUserId: null },
        { name: 'Pasted', email: 'Sam Smith', clerkUserId: null },
      ],
      'contact',
    )
    expect(targets.map((t) => t.email)).toEqual(['jo@acme.com'])
  })

  it('reaches one person once however many rows point at them', () => {
    const targets = toEmailTargets(
      [
        { name: 'Jo', email: 'jo@acme.com', clerkUserId: 'user_1' },
        { name: 'Jo (old row)', email: 'JO@ACME.COM', clerkUserId: null },
      ],
      'contact',
    )
    expect(targets).toHaveLength(1)
    expect(targets[0].name).toBe('Jo')
  })

  it('falls back to a null name rather than an empty one', () => {
    const targets = toEmailTargets([{ name: '   ', email: 'jo@acme.com' }], 'team_member')
    expect(targets[0].name).toBeNull()
  })
})

describe('dedupeEmailTargets', () => {
  it('keeps the first entry, so a specific person beats the studio fallback', () => {
    const specific: EmailTarget = {
      email: 'liam@tahi.studio', name: 'Liam', userType: 'team_member', clerkUserId: 'user_l',
    }
    const fallback: EmailTarget = {
      email: 'LIAM@tahi.studio', name: null, userType: 'team_member', clerkUserId: null,
    }
    expect(dedupeEmailTargets([specific, fallback])).toEqual([specific])
  })
})

describe('requestEmailSubject', () => {
  it('prefixes with the per-org request number', () => {
    expect(requestEmailSubject(7, 'Delivered: "Fix the footer"'))
      .toBe('[REQ-7] Delivered: "Fix the footer"')
  })

  it('leaves the subject bare when the row has no number', () => {
    expect(requestEmailSubject(null, 'Delivered')).toBe('Delivered')
    expect(requestEmailSubject(undefined, 'Delivered')).toBe('Delivered')
    expect(requestEmailSubject(0, 'Delivered')).toBe('Delivered')
    expect(requestEmailSubject(Number.NaN, 'Delivered')).toBe('Delivered')
  })
})

describe('toPlainText', () => {
  it('turns a composer reply into text a mail client can render', () => {
    expect(toPlainText('<p>Looks good.</p><p>Ship it.</p>')).toBe('Looks good.\nShip it.')
    expect(toPlainText('Line one<br>Line two')).toBe('Line one\nLine two')
    expect(toPlainText('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  it('decodes the entities the editor writes', () => {
    expect(toPlainText('<p>Tom &amp; Jerry&#39;s &quot;plan&quot;</p>'))
      .toBe('Tom & Jerry\'s "plan"')
    expect(toPlainText('<p>a&nbsp;b</p>')).toBe('a b')
  })

  it('never leaks markup', () => {
    expect(toPlainText('<p onclick="x()">hi</p>')).toBe('hi')
    expect(toPlainText('')).toBe('')
    expect(toPlainText(null)).toBe('')
  })
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 20)).toBe('short')
  })

  it('cuts on a word boundary when there is one nearby', () => {
    expect(truncate('the quick brown fox jumps', 16)).toBe('the quick brown...')
  })

  it('cuts hard when the first word is longer than the budget', () => {
    expect(truncate('supercalifragilistic', 8)).toBe('supercal...')
  })
})

describe('messageSummary', () => {
  it('collapses a reply to a single line for a bell row', () => {
    expect(messageSummary('<p>Looks good.</p><p>Ship it.</p>')).toBe('Looks good. Ship it.')
  })
})

describe('greetingName', () => {
  it('uses the first name', () => {
    expect(greetingName('Jo Yarnall', 'there')).toBe('Jo')
  })

  it('falls back rather than greeting nobody', () => {
    expect(greetingName(null, 'there')).toBe('there')
    expect(greetingName('   ', 'there')).toBe('there')
  })
})

describe('the wired event plans', () => {
  const target: EmailTarget = {
    email: 'jo@acme.com', name: 'Jo Yarnall', userType: 'contact', clerkUserId: null,
  }

  it('asks for a review rather than announcing a status', () => {
    const plan = clientStatusEmailPlan({
      status: 'client_review',
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 7,
    })
    expect(plan.subject).toBe('[REQ-7] Ready for your review: "Fix the footer"')
    expect(plan.render(target)).toBeTruthy()
  })

  it('says delivered when it is delivered', () => {
    const plan = clientStatusEmailPlan({
      status: 'delivered',
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 7,
      deliveredAt: '2026-09-05T01:02:03.000Z',
    })
    expect(plan.subject).toBe('[REQ-7] Delivered: "Fix the footer"')
  })

  it('names the replier for the client and the client for the studio', () => {
    const toClient = threadReplyEmailPlan({
      audience: 'client',
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 7,
      fromName: 'Staci Bonnie',
      message: 'On it.',
    })
    expect(toClient.subject).toBe('[REQ-7] Staci Bonnie replied on "Fix the footer"')

    const toStudio = threadReplyEmailPlan({
      audience: 'studio',
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 7,
      fromName: 'Jo Yarnall',
      message: 'Any progress?',
    })
    expect(toStudio.subject).toBe('[REQ-7] New client message on "Fix the footer"')
  })

  it('names the client on a new request, because the number is per org', () => {
    const plan = studioNewRequestEmailPlan({
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 3,
      clientName: 'Acme Ltd',
      submittedBy: 'Jo Yarnall',
    })
    expect(plan.subject).toBe('[REQ-3] New request from Acme Ltd: Fix the footer')
  })
})
