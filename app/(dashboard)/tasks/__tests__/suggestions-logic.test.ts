import { describe, it, expect } from 'vitest'
import {
  groupSuggestionsByCall,
  suggestionKindLabel,
  summariseProposal,
  confidenceLabel,
  suggestionKeyAction,
  buildApproveRequest,
  buildRejectRequest,
  buildSnoozeRequest,
  createProposalToTaskFields,
  taskFieldsToCreateProposal,
} from '../suggestions-logic'
import type { DecoratedSuggestion, CreateTaskProposal } from '../suggestions-types'
import type { TaskFields } from '@/lib/task-wizard-drafts'

function row(overrides: Partial<DecoratedSuggestion> = {}): DecoratedSuggestion {
  return {
    id: 's1',
    orgId: 'org1',
    sourceKind: 'call',
    transcriptId: 't1',
    callKind: 'scheduled',
    callId: 'c1',
    kind: 'create_task',
    targetTaskId: null,
    proposal: { title: 'Follow up', description: null, type: 'internal_client_task', orgId: 'org1' },
    quote: 'we should follow up on the invoice',
    rationale: null,
    confidence: 0.9,
    status: 'pending',
    snoozeUntil: null,
    createdAt: '2026-09-19T10:00:00.000Z',
    callTitle: 'Check-in with Acme',
    callScheduledAt: '2026-09-18T22:00:00.000Z',
    orgName: 'Acme',
    targetTaskTitle: null,
    targetTaskStatus: null,
    ...overrides,
  }
}

describe('groupSuggestionsByCall', () => {
  it('groups rows sharing a transcriptId into one call group', () => {
    const groups = groupSuggestionsByCall([
      row({ id: 's1', transcriptId: 't1' }),
      row({ id: 's2', transcriptId: 't1' }),
      row({ id: 's3', transcriptId: 't2', callTitle: 'Discovery with Beta', callScheduledAt: '2026-09-19T22:00:00.000Z' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].key).toBe('t2')
    expect(groups[0].items.map(i => i.id)).toEqual(['s3'])
    expect(groups[1].key).toBe('t1')
    expect(groups[1].items.map(i => i.id)).toEqual(['s1', 's2'])
  })

  it('sorts groups most recent call first', () => {
    const groups = groupSuggestionsByCall([
      row({ id: 'old', transcriptId: 'old-t', callScheduledAt: '2026-09-01T00:00:00.000Z' }),
      row({ id: 'new', transcriptId: 'new-t', callScheduledAt: '2026-09-19T00:00:00.000Z' }),
    ])
    expect(groups.map(g => g.key)).toEqual(['new-t', 'old-t'])
  })

  it('sorts items within a group oldest first by createdAt', () => {
    const groups = groupSuggestionsByCall([
      row({ id: 'b', transcriptId: 't1', createdAt: '2026-09-19T10:05:00.000Z' }),
      row({ id: 'a', transcriptId: 't1', createdAt: '2026-09-19T10:00:00.000Z' }),
    ])
    expect(groups[0].items.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('groups a row with no transcript or call under its own id', () => {
    const groups = groupSuggestionsByCall([
      row({ id: 'solo', transcriptId: null, callId: null, callTitle: null }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('solo')
    expect(groups[0].callTitle).toBe('Unlinked notes')
  })

  it('returns an empty array for no suggestions', () => {
    expect(groupSuggestionsByCall([])).toEqual([])
  })
})

describe('suggestionKindLabel', () => {
  it('labels every kind', () => {
    expect(suggestionKindLabel('create_task')).toBe('New task')
    expect(suggestionKindLabel('update_task')).toBe('Update')
    expect(suggestionKindLabel('complete_task')).toBe('Complete')
    expect(suggestionKindLabel('add_subtasks')).toBe('Subtasks')
    expect(suggestionKindLabel('note')).toBe('Note')
  })
})

describe('summariseProposal', () => {
  it('renders each kind', () => {
    expect(summariseProposal('create_task', { title: 'Fix the footer', description: 'It overlaps on mobile' }))
      .toBe('Fix the footer - It overlaps on mobile')
    expect(summariseProposal('create_task', { title: 'Fix the footer' })).toBe('Fix the footer')
    expect(summariseProposal('create_task', {})).toBe('Untitled task')

    expect(summariseProposal('update_task', { fields: { status: 'done', dueDate: '2026-09-20' } }))
      .toBe('Changes status, due date')
    expect(summariseProposal('update_task', { fields: {} })).toBe('No fields changed')

    expect(summariseProposal('complete_task', { note: 'Shipped Friday' })).toBe('Marks the task done. Shipped Friday')
    expect(summariseProposal('complete_task', {})).toBe('Marks the task done')

    expect(summariseProposal('add_subtasks', { subtasks: ['Write copy', 'Get sign-off'] }))
      .toBe('Write copy, Get sign-off')
    expect(summariseProposal('add_subtasks', { subtasks: [] })).toBe('No subtasks listed')

    expect(summariseProposal('note', { body: 'Liam wants a recap sent' })).toBe('Liam wants a recap sent')
  })

  it('never throws on a malformed proposal', () => {
    expect(summariseProposal('create_task', null)).toBe('Untitled task')
    expect(summariseProposal('update_task', 'not an object')).toBe('No fields changed')
    expect(summariseProposal('add_subtasks', { subtasks: 'not an array' })).toBe('No subtasks listed')
  })
})

describe('confidenceLabel', () => {
  it('is hidden at or above 0.7', () => {
    expect(confidenceLabel(0.7)).toBeNull()
    expect(confidenceLabel(0.95)).toBeNull()
    expect(confidenceLabel(null)).toBeNull()
  })

  it('shows a rounded percentage under 0.7', () => {
    expect(confidenceLabel(0.42)).toBe('42% confidence')
    expect(confidenceLabel(0)).toBe('0% confidence')
  })
})

describe('suggestionKeyAction', () => {
  it('maps y to approve and n to reject', () => {
    expect(suggestionKeyAction('y')).toBe('approve')
    expect(suggestionKeyAction('n')).toBe('reject')
  })

  it('maps j and k to focus movement', () => {
    expect(suggestionKeyAction('j')).toBe('focus_next')
    expect(suggestionKeyAction('k')).toBe('focus_prev')
  })

  it('ignores every other key', () => {
    expect(suggestionKeyAction('a')).toBeNull()
    expect(suggestionKeyAction('Enter')).toBeNull()
  })
})

describe('decide request builders', () => {
  it('approve with no override omits the proposal key', () => {
    expect(buildApproveRequest()).toEqual({ action: 'approve' })
  })

  it('approve with an override carries the edited proposal', () => {
    const proposal = { title: 'Edited title' }
    expect(buildApproveRequest(proposal)).toEqual({ action: 'approve', proposal })
  })

  it('reject and snooze', () => {
    expect(buildRejectRequest()).toEqual({ action: 'reject' })
    expect(buildSnoozeRequest('tonight')).toEqual({ action: 'snooze', snooze: 'tonight' })
    expect(buildSnoozeRequest('this_week')).toEqual({ action: 'snooze', snooze: 'this_week' })
  })
})

describe('create_task proposal <-> TaskFields', () => {
  const proposal: CreateTaskProposal = {
    title: 'Send the contract',
    description: 'Staci mentioned this on the call',
    type: 'internal_client_task',
    orgId: 'org1',
    requestId: null,
    assigneeId: 'member1',
    dueDate: '2026-09-22',
    estimatedHours: 1.5,
    priority: 'high',
    subtasks: ['Draft it', 'Send for signature'],
  }

  it('opens the dialog on todo whatever the proposal says', () => {
    const fields = createProposalToTaskFields(proposal)
    expect(fields.status).toBe('todo')
    expect(fields.title).toBe('Send the contract')
    expect(fields.priority).toBe('high')
    expect(fields.subtasks).toEqual(['Draft it', 'Send for signature'])
  })

  it('Tweak\'s save round-trips the edited fields back into a proposal', () => {
    const fields = createProposalToTaskFields(proposal)
    const edited: TaskFields = { ...fields, title: 'Send the signed contract', priority: 'urgent' }
    const rebuilt = taskFieldsToCreateProposal(edited)
    expect(rebuilt.title).toBe('Send the signed contract')
    expect(rebuilt.priority).toBe('urgent')
    expect(rebuilt.orgId).toBe('org1')
    expect(rebuilt.subtasks).toEqual(['Draft it', 'Send for signature'])
  })

  it('a decide call built from the edited proposal carries it as the override', () => {
    const fields = createProposalToTaskFields(proposal)
    const edited: TaskFields = { ...fields, dueDate: '2026-09-25' }
    const rebuilt = taskFieldsToCreateProposal(edited)
    expect(buildApproveRequest(rebuilt)).toEqual({ action: 'approve', proposal: rebuilt })
  })
})
