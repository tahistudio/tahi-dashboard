/**
 * The pure half of lib/notification-email.ts: who an email can reach, what the
 * subject says, and what a rich text reply looks like once it is text.
 *
 * These are the pieces that decide whether a real person hears from us, so
 * they are pinned here rather than left to a live send. The DB and Resend
 * halves are covered where they are wired (request-status-effects, the portal
 * POST suite, the request thread routes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createElement } from 'react'

const sendEmail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/email', () => ({ sendEmail }))

import {
  clientStatusEmailPlan,
  dedupeEmailTargets,
  dispatchNotificationEmails,
  filterTargetsByEmailPref,
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
  type NotificationEmailPlan,
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

  it('greets the reader and labels the company separately on a delivery', () => {
    // One value fed to both rendered "Client: Jo" under a company label, and
    // "Client: there" for a contact row with no usable name.
    const plan = clientStatusEmailPlan({
      status: 'delivered',
      requestId: 'req_1',
      requestTitle: 'Fix the footer',
      requestNumber: 7,
      clientName: 'Acme Ltd',
    })
    const props = plan.render(target).props as Record<string, unknown>
    expect(props.recipientName).toBe('Jo')
    expect(props.clientName).toBe('Acme Ltd')
  })

  it('sends both client statuses to the same resolved request URL', () => {
    const shared = { requestId: 'req_1', requestTitle: 'Fix the footer', requestNumber: 7 }
    const review = clientStatusEmailPlan({ ...shared, status: 'client_review' })
    const delivered = clientStatusEmailPlan({ ...shared, status: 'delivered' })
    const reviewUrl = (review.render(target).props as Record<string, unknown>).reviewUrl
    const deliveredUrl = (delivered.render(target).props as Record<string, unknown>).requestUrl
    expect(reviewUrl).toBe(deliveredUrl)
    expect(deliveredUrl).toContain('/requests/req_1')
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

describe('filterTargetsByEmailPref', () => {
  type Row = Record<string, unknown>
  type Chain = Promise<Row[]> & { where: () => Chain }

  /** A database that answers the one batched preference read. */
  function prefDb(rows: Row[], onSelect?: () => void) {
    const chain = Promise.resolve(rows) as Chain
    chain.where = () => chain
    return {
      select: () => {
        onSelect?.()
        return { from: () => chain }
      },
    } as never
  }

  const jo: EmailTarget = {
    email: 'jo@acme.com', name: 'Jo', userType: 'contact', clerkUserId: 'user_jo',
  }
  const sam: EmailTarget = {
    email: 'sam@acme.com', name: 'Sam', userType: 'contact', clerkUserId: 'user_sam',
  }
  const invited: EmailTarget = {
    email: 'new@acme.com', name: 'New', userType: 'contact', clerkUserId: null,
  }

  function prefRow(userId: string, eventType: string, enabled: boolean): Row {
    return { userId, userType: 'contact', eventType, channel: 'email', enabled }
  }

  it('asks the database once for the whole audience', async () => {
    let selects = 0
    const db = prefDb([], () => { selects += 1 })
    const { allowed, muted } = await filterTargetsByEmailPref(db, [jo, sam], 'new_message')
    expect(selects).toBe(1)
    expect(allowed).toHaveLength(2)
    expect(muted).toBe(0)
  })

  it('never queries for people who cannot have a preference row', async () => {
    let selects = 0
    const db = prefDb([], () => { selects += 1 })
    const { allowed } = await filterTargetsByEmailPref(db, [invited], 'new_message')
    expect(selects).toBe(0)
    expect(allowed).toEqual([invited])
  })

  it('drops the person who muted this event and counts them', async () => {
    const db = prefDb([prefRow('user_jo', 'new_message', false)])
    const { allowed, muted } = await filterTargetsByEmailPref(db, [jo, sam], 'new_message')
    expect(allowed.map((t) => t.email)).toEqual(['sam@acme.com'])
    expect(muted).toBe(1)
  })

  it('honours a per-user default, and lets an exact row beat it', async () => {
    const db = prefDb([
      prefRow('user_jo', '*', false),
      prefRow('user_sam', '*', false),
      prefRow('user_sam', 'new_message', true),
    ])
    const { allowed } = await filterTargetsByEmailPref(db, [jo, sam], 'new_message')
    expect(allowed.map((t) => t.email)).toEqual(['sam@acme.com'])
  })

  it('fails open, because a silenced delivery notice is worse than a stray one', async () => {
    const broken = { select: () => { throw new Error('D1 unavailable') } } as never
    const { allowed, muted } = await filterTargetsByEmailPref(broken, [jo, sam], 'new_message')
    expect(allowed).toHaveLength(2)
    expect(muted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Dispatch: the parts that actually reach Resend
// ---------------------------------------------------------------------------

describe('dispatchNotificationEmails, the plain text alternative', () => {
  // Nobody here has a Clerk login, so the preference read short-circuits and
  // the database is never touched.
  const invited: EmailTarget = {
    email: 'new@acme.com', name: 'Jo Yarnall', userType: 'contact', clerkUserId: null,
  }
  const noDb = {} as never

  /**
   * A plan whose element is built by hand rather than taken from emails/: what
   * is under test is the dispatcher (does it derive a text part, does it reuse
   * it) and not any one template's markup.
   */
  function spyPlan(): NotificationEmailPlan & { render: ReturnType<typeof vi.fn> } {
    const render = vi.fn((target: EmailTarget) =>
      createElement(
        'html',
        null,
        createElement(
          'body',
          null,
          createElement('p', null, `Hi ${greetingName(target.name, 'there')},`),
          createElement('p', null, 'The second draft is up for you to look at.'),
        ),
      ),
    )
    return { subject: '[REQ-4] Liam replied on "New homepage"', render }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sendEmail.mockResolvedValue({ success: true })
    vi.stubEnv('RESEND_API_KEY', 'test_key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('hands Resend a text part built from the same element as the HTML', async () => {
    const plan = spyPlan()
    const res = await dispatchNotificationEmails(noDb, [invited], 'new_message', plan)
    expect(res.sent).toBe(1)

    const [to, subject, element, text] = sendEmail.mock.calls[0]
    expect(to).toBe('new@acme.com')
    expect(subject).toBe(plan.subject)
    expect(element).toBe(plan.render.mock.results[0].value)
    expect(typeof text).toBe('string')
    expect(text).toContain('The second draft is up for you to look at.')
    expect(text).toContain('Hi Jo,')
    // Text, not markup: an HTML-only message is what this part exists to fix.
    expect(text).not.toContain('<')
  })

  it('renders the template once, and reuses both parts on a rate limited retry', async () => {
    vi.useFakeTimers()
    sendEmail.mockResolvedValueOnce({ success: false, error: 'Too many requests' })
    sendEmail.mockResolvedValue({ success: true })

    const plan = spyPlan()
    const promise = dispatchNotificationEmails(noDb, [invited], 'new_message', plan)
    await vi.runAllTimersAsync()
    const res = await promise

    expect(res.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(plan.render).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][3]).toBe(sendEmail.mock.calls[1][3])
  })

  it('sends nothing at all when Resend is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const res = await dispatchNotificationEmails(noDb, [invited], 'new_message', spyPlan())
    expect(res).toEqual({ sent: 0, muted: 0, failed: 0, deferred: false })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
