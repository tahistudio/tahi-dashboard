import { describe, expect, it } from 'vitest'
import { detectSlackIntent, SLACK_NOTE_HELP_LINE, slackHelpLine } from '../intents'
import { DENIAL_LINE } from '../identity'

describe('deterministic Slack intents', () => {
  it.each(['hi', 'Hello!', 'hey Tahi', 'help', 'What can you do?'])('greets %s without a model', text => {
    expect(detectSlackIntent(text)).toEqual({ kind: 'help' })
  })

  it.each([
    ['What should I work on today?', 'work_today'],
    ['what should I work on', 'work_today'],
    ["What's waiting on me?", 'waiting_on_me'],
    ['What is waiting on me', 'waiting_on_me'],
    ["What's due today?", 'due_today'],
    ['What is due this week', 'due_week'],
    ["What's overdue?", 'overdue'],
    ['my tasks', 'my_tasks'],
    ['show me my tasks for Staci', 'my_tasks'],
    ['what needs approving', 'approvals'],
    ['Can you tell me about Giant Group?', 'unknown_question'],
    ['Who owns that invoice', 'unknown_question'],
    ['Send this invoice?', 'unknown_question'],
  ])('keeps %s out of the note path', (text, question) => {
    expect(detectSlackIntent(text)).toEqual({ kind: 'question', question })
  })

  it('keeps an instruction available for approval', () => {
    expect(detectSlackIntent('Task for me: send Elevate their October invoice by Friday')).toEqual({ kind: 'note' })
  })

  it('helps each audience with two examples and no studio promises to clients', () => {
    expect(slackHelpLine('founder')).toContain('waiting on the studio')
    expect(slackHelpLine('member')).toContain('your own work')
    expect(slackHelpLine('member')).not.toContain('waiting on the studio')
    expect(slackHelpLine('client')).toContain('your own requests')
    expect(slackHelpLine('client')).not.toContain('tasks')
    expect(slackHelpLine('unknown')).toBe(DENIAL_LINE)
    expect(SLACK_NOTE_HELP_LINE).toContain('What is waiting on me?')
  })
})
