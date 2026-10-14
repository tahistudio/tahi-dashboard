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

/** Deterministic and free. A question never reaches the note suggester. */
export function detectSlackIntent(text: string): SlackIntent {
  const value = text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  if (/^(?:(?:hi|hello|hey)(?: tahi)?|help|what can you do)[!.?]*$/.test(value)) return { kind: 'help' }
  if (/\bwhat (?:should|can) i work on(?: today)?\b/.test(value)) return { kind: 'question', question: 'work_today' }
  if (/\bwhat(?: is|'s) waiting on me\b/.test(value)) return { kind: 'question', question: 'waiting_on_me' }
  if (/\b(?:what(?: is|'s)|what tasks are|what requests are) (?:due|overdue)\b/.test(value)) {
    if (/\boverdue\b/.test(value)) return { kind: 'question', question: 'overdue' }
    return { kind: 'question', question: /\bthis week\b/.test(value) ? 'due_week' : 'due_today' }
  }
  if (/^(?:show(?: me)? )?my tasks\b/.test(value)) return { kind: 'question', question: 'my_tasks' }
  if (/\bwhat (?:needs|is waiting for|requires) approv(?:ing|al)\b/.test(value)) return { kind: 'question', question: 'approvals' }
  if (/[?]/.test(value) || /^(?:what\b|what's\b|who\b|who's\b|when\b|where\b|why\b|how\b|can\b|could\b|would\b|should\b|do\b|does\b|did\b|is\b|are\b|will\b)/.test(value)) {
    return { kind: 'question', question: 'unknown_question' }
  }
  return { kind: 'note' }
}

/** Shared by greetings, assistant welcomes and the unrecognised-note reply. */
export function slackHelpLine(level: SlackLevel): string {
  if (level === 'unknown') return DENIAL_LINE
  if (level === 'client') {
    return 'Hi! Send notes or voice notes to draft a request for your approval, or check your own requests: "Request: update our homepage" or "What is waiting on me?".'
  }
  const audience = level === 'founder' ? 'your work and what is waiting on the studio' : 'your own work'
  return `Hi! I draft tasks and requests from notes and voice notes for your approval and answer questions about ${audience}: "Task for me: send the invoice by Friday" or "What is waiting on me?".`
}

export const SLACK_NOTE_HELP_LINE = 'Try "Task for me: send the invoice by Friday" or "What is waiting on me?". Send a note or voice note and I will draft it for your approval.'
