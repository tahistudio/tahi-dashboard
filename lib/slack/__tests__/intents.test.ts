import { describe, expect, it } from 'vitest'
import { detectSlackIntent, SLACK_NOTE_HELP_LINE, slackHelpLine } from '../intents'
import { DENIAL_LINE } from '../identity'

describe('deterministic Slack intents', () => {
  it.each(['hi', 'Hello!', 'hey Tahi', 'hi there', 'thanks', 'thank you', 'cheers', 'hey,', 'help', 'What can you do?'])('greets %s without a model', text => {
    expect(detectSlackIntent(text)).toEqual({ kind: 'help' })
  })

  it.each([
    ['What should I work on today?', 'work_today'],
    ['what should I work on', 'work_today'],
    ["What's waiting on me?", 'waiting_on_me'],
    ['What is waiting on me', 'waiting_on_me'],
    ["What's due today?", 'due_today'],
    ['What is due this week', 'due_week'],
    ["what's due this week", 'due_week'],
    ["What's overdue?", 'overdue'],
    ['my tasks', 'my_tasks'],
    ['show me my tasks for Staci', 'my_tasks'],
    ['what needs approving', 'approvals'],
  ])('keeps %s out of the note path', (text, question) => {
    expect(detectSlackIntent(text)).toEqual({ kind: 'question', question })
    expect(detectSlackIntent(text, { voice: true })).toEqual({ kind: 'question', question })
  })

  it.each([
    'Task for me: send Elevate their October invoice by Friday',
    'Send this invoice?',
    'Can you tell me about Giant Group?',
    'Who owns that invoice',
    'what should I do about the Elevate invoice, create a task to chase them',
    'Can you create a task to chase Elevate for the October invoice',
    'Could you please update our homepage hero?',
    'Do the Elevate invoice by Friday',
    'Will needs to review the homepage by Friday',
    'Is the homepage done? If not, task for Staci to finish by Friday',
    'Task: ask Elevate whether they want the blog redesign?',
    'So I spoke to Elevate today. They want the invoice by Friday. Can you remind me?',
    'what is waiting on me, also make a task to chase Elevate',
    'my tasks for Elevate need a review by Friday, add one to chase the logo',
    'I asked what is waiting on me',
    'I asked what should I work on today',
    'I asked what is due this week',
    'I asked what needs approving',
    'what is waiting on me from all the different clients this week',
    'thanks, please update our homepage',
    'thank you for the logo, send it to Elevate',
    'hi there, task for Staci',
  ])('keeps %s available for approval', text => {
    expect(detectSlackIntent(text)).toEqual({ kind: 'note' })
    expect(detectSlackIntent(text, { voice: true })).toEqual({ kind: 'note' })
  })

  it.each(['hi there', 'thanks', 'help', 'What can you do?'])('keeps voice %s on the note path', text => {
    expect(detectSlackIntent(text, { voice: true })).toEqual({ kind: 'note' })
  })

  it('helps each audience with two examples and no studio promises to clients', () => {
    expect(slackHelpLine('founder')).toContain('waiting on the studio')
    expect(slackHelpLine('member')).toContain('your own work')
    expect(slackHelpLine('member')).not.toContain('waiting on the studio')
    expect(slackHelpLine('client')).toContain('your own requests')
    expect(slackHelpLine('client')).not.toContain('tasks')
    expect(slackHelpLine('client')).not.toMatch(/draft|send notes|voice notes|Request:/i)
    expect(slackHelpLine('unknown')).toBe(DENIAL_LINE)
    expect(SLACK_NOTE_HELP_LINE).toContain('What is waiting on me?')
  })
})
