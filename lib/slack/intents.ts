import { DENIAL_LINE, type SlackLevel } from './identity'

export type SlackQuestionIntent =
  | 'work_today'
  | 'waiting_on_me'
  | 'due_today'
  | 'due_week'
  | 'overdue'
  | 'my_tasks'
  | 'approvals'
  | 'unknown_question'

export type SlackIntent =
  | { kind: 'help' }
  | { kind: 'question'; question: SlackQuestionIntent }
  | { kind: 'note' }

/** Only short, known queries bypass the note suggester. */
export function detectSlackIntent(text: string, options: { voice?: boolean } = {}): SlackIntent {
  const value = text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  if (!options.voice && /^(?:(?:hi|hello|hey)(?: there)?(?: tahi)?|thanks|thank you|cheers|help|what can you do)[!.,?]*$/.test(value)) return { kind: 'help' }
  if (value.split(' ').length > 10 || /\b(?:task|create|add|remind|chase|send|make|request|update|fix|build|review|finish|do)\b/.test(value)) {
    return { kind: 'note' }
  }
  if (/^what (?:should|can) i work on(?: today)?\b/.test(value)) return { kind: 'question', question: 'work_today' }
  if (/^what(?: is|'s) waiting on me\b/.test(value)) return { kind: 'question', question: 'waiting_on_me' }
  if (/^(?:what(?: is|'s)|what tasks are|what requests are) (?:due|overdue)\b/.test(value)) {
    if (/\boverdue\b/.test(value)) return { kind: 'question', question: 'overdue' }
    return { kind: 'question', question: /\bthis week\b/.test(value) ? 'due_week' : 'due_today' }
  }
  if (/^(?:show(?: me)? )?my tasks\b/.test(value)) return { kind: 'question', question: 'my_tasks' }
  if (/^what (?:needs|is waiting for|requires) approv(?:ing|al)\b/.test(value)) return { kind: 'question', question: 'approvals' }
  return { kind: 'note' }
}

/** Shared by greetings, assistant welcomes and the unrecognised-note reply. */
export function slackHelpLine(level: SlackLevel): string {
  if (level === 'unknown') return DENIAL_LINE
  if (level === 'client') {
    return 'Hi! Ask about your own requests: "What is waiting on me?" or "What is due this week?".'
  }
  const audience = level === 'founder' ? 'your work and what is waiting on the studio' : 'your own work'
  return `Hi! I draft tasks and requests from notes and voice notes for your approval and answer questions about ${audience}: "Task for me: send the invoice by Friday" or "What is waiting on me?".`
}

export const SLACK_NOTE_HELP_LINE = 'Try "Task for me: send the invoice by Friday" or "What is waiting on me?". Send a note or voice note and I will draft it for your approval.'
