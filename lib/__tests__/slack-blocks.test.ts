/**
 * lib/slack/blocks.ts, one suggestion as a message in a founder's DM.
 *
 * What is pinned here:
 *
 *   THE WORDS ARE THE INBOX'S WORDS. Both surfaces read one summariser
 *   (lib/suggestion-summary.ts), so a founder who approves in Slack and then
 *   opens /tasks reads one sentence rather than two that drifted apart.
 *
 *   THE ACTION IDS. `sugg:<action>:<id>` is the contract between this file
 *   and the interactive route. Parsing has to be strict: a button from
 *   another feature must not resolve to a suggestion, and a malformed id must
 *   not resolve to a decision.
 *
 *   THE DECIDED MESSAGE HAS NO BUTTONS. That is the whole guard against a
 *   founder approving a suggestion that is already a task.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  callHeaderMessage,
  decidedLine,
  decidedMessage,
  escapeSlackText,
  formatCallDay,
  parseSuggestionActionId,
  quoteBlock,
  suggestionActionId,
  suggestionMessage,
  suggestionTweakUrl,
  type SlackBlock,
  type SlackMessagePayload,
  type SuggestionMessageInput,
} from '@/lib/slack/blocks'

function row(overrides: Partial<SuggestionMessageInput> = {}): SuggestionMessageInput {
  return {
    id: 's1',
    kind: 'create_task',
    proposal: { title: 'Cut the hero video', description: 'Thirty seconds for the homepage' },
    quote: 'We still need the hero video cut down to thirty seconds.',
    confidence: 0.82,
    orgName: 'Nga Motu',
    callTitle: 'Kickoff call',
    callScheduledAt: '2026-09-18T20:00:00Z',
    similar: [],
    ...overrides,
  }
}

function textOf(payload: SlackMessagePayload): string {
  return payload.blocks.map(block => JSON.stringify(block)).join('\n')
}

function buttons(payload: SlackMessagePayload): Array<{ label: string; actionId: string; url?: string; value?: string }> {
  const actions = payload.blocks.find((block): block is Extract<SlackBlock, { type: 'actions' }> => block.type === 'actions')
  return (actions?.elements ?? []).map(element => ({
    label: element.text.text,
    actionId: element.action_id,
    url: element.url,
    value: element.value,
  }))
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('action ids', () => {
  it('round trips every action', () => {
    for (const action of ['approve', 'approve_anyway', 'tweak', 'snooze_tonight', 'snooze_week', 'reject', 'attach'] as const) {
      const id = suggestionActionId(action, 'e2c1ca1c-0b6e-4b2f-8a1e-1f0f0f0f0f0f')
      expect(parseSuggestionActionId(id)).toEqual({ action, suggestionId: 'e2c1ca1c-0b6e-4b2f-8a1e-1f0f0f0f0f0f' })
    }
  })

  it('refuses another feature is buttons, a missing id and a verb it does not know', () => {
    expect(parseSuggestionActionId('nudge:send:n1')).toBeNull()
    expect(parseSuggestionActionId('sugg:approve')).toBeNull()
    expect(parseSuggestionActionId('sugg:approve:')).toBeNull()
    expect(parseSuggestionActionId('sugg:delete:s1')).toBeNull()
    expect(parseSuggestionActionId('sugg:approve:s1:extra')).toBeNull()
    expect(parseSuggestionActionId('')).toBeNull()
  })
})

describe('one suggestion, per kind', () => {
  it('reads a create_task as the inbox reads it', () => {
    const payload = suggestionMessage(row())
    expect(payload.text).toBe('New task: Cut the hero video - Thirty seconds for the homepage')
    expect(textOf(payload)).toContain('*Nga Motu*')
    expect(textOf(payload)).toContain('Kickoff call')
    expect(textOf(payload)).toContain('18 Sep')
    expect(textOf(payload)).toContain('New task')
  })

  it('reads a create_request with its category', () => {
    const payload = suggestionMessage(row({ kind: 'create_request', proposal: { title: 'Cut a 30s hero video', category: 'video' } }))
    expect(payload.text).toBe('New request: Cut a 30s hero video - video')
    expect(textOf(payload)).toContain('New request')
  })

  it('reads an update_request as the fields it changes, and names the target', () => {
    const payload = suggestionMessage(row({
      kind: 'update_request',
      proposal: { fields: { status: 'in_progress', dueDate: '2026-10-02' } },
      targetRequestNumber: 226,
      targetRequestTitle: 'Design directions',
    }))
    expect(payload.text).toContain('Changes status, due date')
    expect(textOf(payload)).toContain('#226 Design directions')
  })

  it('reads a hand off as who it waits on', () => {
    const payload = suggestionMessage(row({ kind: 'hand_off_request', proposal: { contactName: 'Ngaire', reason: 'approval' } }))
    expect(payload.text).toContain('Hand off: Waiting on Ngaire')
  })

  it('reads a note as the note', () => {
    const payload = suggestionMessage(row({ kind: 'note', proposal: { body: 'They liked the second direction.' } }))
    expect(payload.text).toBe('Note: They liked the second direction.')
  })

  it('reads an unrecognised kind as itself rather than as a blank', () => {
    const payload = suggestionMessage(row({ kind: 'invent_a_kind', proposal: {} }))
    expect(payload.text).toBe('invent_a_kind: Unrecognised suggestion')
  })

  it('reads a proposal that arrived as stored JSON', () => {
    const payload = suggestionMessage(row({ proposal: JSON.stringify({ title: 'Cut the hero video' }) }))
    expect(payload.text).toBe('New task: Cut the hero video')
  })

  it('says Studio when there is no client, because a studio row has no client', () => {
    expect(textOf(suggestionMessage(row({ orgName: null })))).toContain('*Studio*')
  })
})

describe('the quote, the assignee and the confidence', () => {
  it('quotes the exact words from the call', () => {
    expect(textOf(suggestionMessage(row()))).toContain('> We still need the hero video cut down to thirty seconds.')
  })

  it('leaves the quote block out when there is nothing quoted', () => {
    expect(textOf(suggestionMessage(row({ quote: '   ' })))).not.toContain('>  ')
    expect(suggestionMessage(row({ quote: '   ' })).blocks).toHaveLength(4)
    expect(suggestionMessage(row()).blocks).toHaveLength(5)
  })

  it('shows the suggested assignee with the reason the call gave', () => {
    const payload = suggestionMessage(row({
      proposal: { title: 'Send the headers', suggestedAssigneeName: 'Staci', assigneeReason: 'said she would send the headers' },
    }))
    expect(textOf(payload)).toContain('Suggested: Staci, said she would send the headers')
  })

  it('shows the assignee CN.1 already writes, before slice A1 renames it', () => {
    expect(textOf(suggestionMessage(row({ proposal: { title: 'Send the headers', assigneeName: 'Staci' } }))))
      .toContain('Suggested: Staci')
  })

  it('says nothing about an assignee nobody named', () => {
    expect(textOf(suggestionMessage(row()))).not.toContain('Suggested:')
  })

  it('shows a low confidence and hides a high one', () => {
    expect(textOf(suggestionMessage(row({ confidence: 0.41 })))).toContain('41% confidence')
    expect(textOf(suggestionMessage(row({ confidence: 0.82 })))).not.toContain('confidence')
  })
})

describe('the buttons', () => {
  it('offers the five things a founder can do, in reading order', () => {
    expect(buttons(suggestionMessage(row())).map(b => b.label))
      .toEqual(['Approve', 'Tweak', 'Tonight', 'This week', 'Reject'])
  })

  it('links Tweak into the inbox with the row focused', () => {
    const tweak = buttons(suggestionMessage(row())).find(b => b.label === 'Tweak')
    expect(tweak?.url).toBe('https://portal.tahi.studio/tasks?view=suggestions&focus=s1')
    expect(suggestionTweakUrl('a b')).toContain('focus=a%20b')
  })

  it('namespaces every action id to this feature', () => {
    for (const button of buttons(suggestionMessage(row()))) {
      expect(button.actionId.startsWith('sugg:')).toBe(true)
    }
  })

  it('becomes the duplicate answer when the row already exists', () => {
    const payload = suggestionMessage(
      row({ similar: [{ kind: 'request', id: 'r1', number: 226, title: 'Design directions', status: 'open', score: 0.91 }] }),
      { duplicate: true },
    )
    expect(textOf(payload)).toContain('Looks like #226 Design directions (open, 91%)')
    expect(buttons(payload).map(b => b.label)).toEqual(['Use #226 instead', 'Approve anyway', 'Tweak', 'Tonight', 'This week', 'Reject'])
    const attach = buttons(payload).find(b => b.label === 'Use #226 instead')
    expect(attach?.value).toBe(JSON.stringify({ kind: 'request', id: 'r1' }))
    expect(attach?.actionId).toBe('sugg:attach:s1')
  })

  it('offers no attach for a match against another pending suggestion, which has nothing to attach to', () => {
    const payload = suggestionMessage(
      row({ similar: [{ kind: 'suggestion', id: 's9', number: null, title: 'Cut the hero video', status: 'pending', score: 0.95 }] }),
      { duplicate: true },
    )
    expect(buttons(payload).map(b => b.label)).toEqual(['Approve anyway', 'Tweak', 'Tonight', 'This week', 'Reject'])
  })

  it('reads as a plain Approve when the duplicate flag is set but nothing matched', () => {
    expect(buttons(suggestionMessage(row(), { duplicate: true })).map(b => b.label))
      .toEqual(['Approve', 'Tweak', 'Tonight', 'This week', 'Reject'])
  })
})

describe('the call header', () => {
  it('counts the suggestions and names the call', () => {
    const payload = callHeaderMessage({ callTitle: 'Kickoff call', orgName: 'Nga Motu', callScheduledAt: '2026-09-18T20:00:00Z', count: 3 })
    expect(payload.text).toBe('3 suggestions from Kickoff call')
    expect(textOf(payload)).toContain('*Nga Motu*')
    expect(textOf(payload)).toContain('(18 Sep)')
  })

  it('reads one as one', () => {
    expect(callHeaderMessage({ callTitle: null, orgName: null, callScheduledAt: null, count: 1 }).text)
      .toBe('1 suggestion from a call')
  })
})

describe('the decided message', () => {
  it('says who and when, and offers nothing to press', () => {
    const payload = decidedMessage({ outcome: 'approved', actorName: 'Liam Miller', at: '09:41' })
    expect(payload.text).toBe('Approved by Liam Miller, 09:41')
    expect(payload.blocks.some(block => block.type === 'actions')).toBe(false)
  })

  it('has a line for every outcome', () => {
    expect(decidedLine({ outcome: 'rejected', actorName: 'Staci', at: '09:42' })).toBe('Rejected by Staci, 09:42')
    expect(decidedLine({ outcome: 'snoozed', actorName: 'Liam', at: '09:43', until: 'Fri 09:00' })).toBe('Snoozed by Liam until Fri 09:00')
    expect(decidedLine({ outcome: 'snoozed', actorName: 'Liam', at: '09:43' })).toBe('Snoozed by Liam, 09:43')
    expect(decidedLine({ outcome: 'expired', actorName: null, at: null })).toBe('Expired, rebuilt from the call')
    expect(decidedLine({ outcome: 'failed', actorName: 'Liam', at: '09:44', error: 'Task not found' })).toBe('Could not apply: Task not found')
    expect(decidedLine({ outcome: 'failed', actorName: 'Liam', at: '09:44' })).toBe('Could not apply')
  })

  it('says someone rather than nobody when the actor cannot be named', () => {
    expect(decidedLine({ outcome: 'approved', actorName: '  ', at: '09:41' })).toBe('Approved by someone, 09:41')
  })
})

describe('Slack text, which is not markdown', () => {
  it('escapes the three characters Slack reads as its own', () => {
    expect(escapeSlackText('Fish & Chips <b> 3 > 2')).toBe('Fish &amp; Chips &lt;b&gt; 3 &gt; 2')
  })

  it('prefixes every line of a quote and keeps the blank ones', () => {
    expect(quoteBlock('one\n\ntwo')).toBe('> one\n>\n> two')
  })

  it('clips a quote too long for a DM', () => {
    const clipped = quoteBlock('a'.repeat(900))
    expect(clipped.endsWith('...')).toBe(true)
    expect(clipped.length).toBeLessThan(700)
  })

  it('escapes the client name in the header rather than leaving a stray entity', () => {
    expect(textOf(suggestionMessage(row({ orgName: 'Fish & Chips' })))).toContain('Fish &amp; Chips')
  })

  it('reads a call day, or nothing at all', () => {
    expect(formatCallDay('2026-01-02T00:00:00Z')).toBe('2 Jan')
    expect(formatCallDay(null)).toBeNull()
    expect(formatCallDay('not a date')).toBeNull()
  })
})
