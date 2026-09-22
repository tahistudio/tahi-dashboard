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
  buildAttachRequest,
  createProposalToTaskFields,
  taskFieldsToCreateProposal,
  targetRequestLine,
  handOffNeedsContact,
  createRequestProposalToInitialDraft,
  initialDraftToCreateRequestProposal,
  similarMatchLine,
  similarOverflowLabel,
  canAttachBestMatch,
  attachButtonLabel,
  needsApproveConfirm,
  bestMatchTarget,
  SIMILAR_BLOCK,
  proposalAssigneeSuggestion,
  assigneeSuggestionLine,
  withAssigneeOverride,
} from '../suggestions-logic'
import type { DecoratedSuggestion, CreateTaskProposal, CreateRequestProposal, UpdateRequestProposal, SimilarMatch } from '../suggestions-types'
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
    targetRequestId: null,
    appliedRequestId: null,
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
    targetRequestNumber: null,
    targetRequestTitle: null,
    targetRequestStatus: null,
    similar: [],
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
    expect(suggestionKindLabel('create_request')).toBe('New request')
    expect(suggestionKindLabel('update_request')).toBe('Update request')
    expect(suggestionKindLabel('request_note')).toBe('Request note')
    expect(suggestionKindLabel('hand_off_request')).toBe('Hand off')
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
    suggestedAssigneeId: 'member1',
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

describe('summariseProposal for the CN.1b request kinds', () => {
  it('renders each kind', () => {
    expect(summariseProposal('create_request', { title: 'Refresh the hero', category: 'design' }))
      .toBe('Refresh the hero - design')
    expect(summariseProposal('create_request', { title: 'Refresh the hero' })).toBe('Refresh the hero')
    expect(summariseProposal('create_request', {})).toBe('Untitled request')

    expect(summariseProposal('update_request', { fields: { status: 'in_progress', dueDate: '2026-09-25' } }))
      .toBe('Changes status, due date')
    expect(summariseProposal('update_request', { fields: {} })).toBe('No fields changed')

    expect(summariseProposal('request_note', { body: 'Client confirmed the copy is final' }))
      .toBe('Client confirmed the copy is final')
    expect(summariseProposal('request_note', {})).toBe('No note text')

    expect(summariseProposal('hand_off_request', { contactName: 'Priya', reason: 'approval' }))
      .toBe('Waiting on Priya: approval')
    expect(summariseProposal('hand_off_request', { contactName: 'Priya', reason: 'decision' }))
      .toBe('Waiting on Priya: a decision')
    expect(summariseProposal('hand_off_request', { reason: 'approval' }))
      .toBe('Waiting on someone: approval')
    expect(summariseProposal('hand_off_request', { contactName: 'Priya', reason: 'not_a_reason' }))
      .toBe('Waiting on Priya: something')
  })

  it('never throws on a malformed proposal', () => {
    expect(summariseProposal('create_request', null)).toBe('Untitled request')
    expect(summariseProposal('update_request', 'not an object')).toBe('No fields changed')
    expect(summariseProposal('hand_off_request', null)).toBe('Waiting on someone: something')
  })
})

describe('targetRequestLine', () => {
  it('reads "#<number> <title>" when a target request is present', () => {
    expect(targetRequestLine({ targetRequestNumber: 42, targetRequestTitle: 'Homepage refresh' }))
      .toBe('#42 Homepage refresh')
  })

  it('is null with no target request', () => {
    expect(targetRequestLine({ targetRequestNumber: null, targetRequestTitle: null })).toBeNull()
    expect(targetRequestLine({ targetRequestNumber: 42, targetRequestTitle: null })).toBeNull()
  })
})

describe('handOffNeedsContact', () => {
  it('needs a contact when none is resolved or picked', () => {
    expect(handOffNeedsContact({ contactId: null })).toBe(true)
    expect(handOffNeedsContact({ contactId: undefined })).toBe(true)
  })

  it('is satisfied once a contact id is set', () => {
    expect(handOffNeedsContact({ contactId: 'contact1' })).toBe(false)
  })
})

describe('create_request proposal <-> RequestInitialDraft', () => {
  const proposal: CreateRequestProposal = {
    title: 'Refresh the hero',
    description: 'Client wants a new hero image',
    category: 'design',
    type: 'small_task',
    priority: 'high',
    dueDate: '2026-09-25',
    requesterName: 'Priya',
    requesterContactId: 'contact1',
  }

  it('reads the org from the suggestion row, not the proposal', () => {
    const draft = createRequestProposalToInitialDraft(proposal, 'org1')
    expect(draft.orgId).toBe('org1')
    expect(draft.title).toBe('Refresh the hero')
    expect(draft.type).toBe('small_task')
    expect(draft.priority).toBe('high')
    expect(draft.dueDate).toBe('2026-09-25')
  })

  it("Tweak's save round-trips the edited fields back into a proposal, leaving the requester alone", () => {
    const draft = createRequestProposalToInitialDraft(proposal, 'org1')
    const edited = { ...draft, title: 'Refresh the homepage hero', priority: 'standard' }
    const rebuilt = initialDraftToCreateRequestProposal(edited, proposal)
    expect(rebuilt.title).toBe('Refresh the homepage hero')
    expect(rebuilt.priority).toBe('standard')
    expect(rebuilt.requesterName).toBe('Priya')
    expect(rebuilt.requesterContactId).toBe('contact1')
  })

  it('a decide call built from the edited proposal carries it as the override', () => {
    const draft = createRequestProposalToInitialDraft(proposal, 'org1')
    const edited = { ...draft, dueDate: '2026-09-30' }
    const rebuilt = initialDraftToCreateRequestProposal(edited, proposal)
    expect(buildApproveRequest(rebuilt)).toEqual({ action: 'approve', proposal: rebuilt })
  })
})

describe('summariseProposal with a stored JSON string', () => {
  it('reads the title out of the string the route hands over', () => {
    expect(summariseProposal('create_task', JSON.stringify({ title: 'Send header examples to Staci' }))).toContain('Send header examples to Staci')
  })
})

describe('the duplicate guard (CN.1d contract sections 2 and 5)', () => {
  const requestMatch: SimilarMatch = { kind: 'request', id: 'r1', number: 226, title: 'Design directions', status: 'open', score: 0.71 }
  const taskMatch: SimilarMatch = { kind: 'task', id: 't1', number: null, title: 'Rework the homepage hero', status: 'todo', score: 0.9 }
  const suggestionMatch: SimilarMatch = { kind: 'suggestion', id: 's2', number: null, title: 'Add LinkedIn insight tag', status: 'pending', score: 0.85 }

  describe('similarMatchLine', () => {
    it('reads "Looks like #<number> <title> (<status>, <pct>%)" for a request match', () => {
      expect(similarMatchLine([requestMatch])).toBe('Looks like #226 Design directions (open, 71%)')
    })

    it('drops the number when the best match has none', () => {
      expect(similarMatchLine([taskMatch])).toBe('Looks like Rework the homepage hero (todo, 90%)')
    })

    it('is null with no matches', () => {
      expect(similarMatchLine([])).toBeNull()
    })
  })

  describe('similarOverflowLabel', () => {
    it('is null with one match or none', () => {
      expect(similarOverflowLabel([])).toBeNull()
      expect(similarOverflowLabel([requestMatch])).toBeNull()
    })

    it('counts everything behind the best match', () => {
      expect(similarOverflowLabel([requestMatch, taskMatch])).toBe('and 1 more')
      expect(similarOverflowLabel([requestMatch, taskMatch, suggestionMatch])).toBe('and 2 more')
    })
  })

  describe('canAttachBestMatch and attachButtonLabel', () => {
    it('can attach to a request or task match', () => {
      expect(canAttachBestMatch([requestMatch])).toBe(true)
      expect(canAttachBestMatch([taskMatch])).toBe(true)
      expect(attachButtonLabel([requestMatch])).toBe('Use #226 instead')
      expect(attachButtonLabel([taskMatch])).toBe('Use "Rework the homepage hero" instead')
    })

    it('cannot attach to another pending suggestion', () => {
      expect(canAttachBestMatch([suggestionMatch])).toBe(false)
      expect(attachButtonLabel([suggestionMatch])).toBeNull()
    })

    it('is null and false with no matches', () => {
      expect(canAttachBestMatch([])).toBe(false)
      expect(attachButtonLabel([])).toBeNull()
    })
  })

  describe('bestMatchTarget', () => {
    it('reads the kind and id off the best match', () => {
      expect(bestMatchTarget([requestMatch])).toEqual({ kind: 'request', id: 'r1' })
      expect(bestMatchTarget([taskMatch])).toEqual({ kind: 'task', id: 't1' })
    })

    it('is null for a suggestion match or no matches', () => {
      expect(bestMatchTarget([suggestionMatch])).toBeNull()
      expect(bestMatchTarget([])).toBeNull()
    })
  })

  describe('needsApproveConfirm', () => {
    it('is false under SIMILAR_BLOCK', () => {
      expect(needsApproveConfirm([requestMatch])).toBe(false)
    })

    it('is true at or above SIMILAR_BLOCK', () => {
      expect(needsApproveConfirm([taskMatch])).toBe(true)
      expect(needsApproveConfirm([{ ...requestMatch, score: SIMILAR_BLOCK }])).toBe(true)
    })

    it('is false with no matches', () => {
      expect(needsApproveConfirm([])).toBe(false)
    })
  })

  describe('buildApproveRequest with force', () => {
    it('omits force when not asked for', () => {
      expect(buildApproveRequest()).toEqual({ action: 'approve' })
      expect(buildApproveRequest(undefined, false)).toEqual({ action: 'approve' })
    })

    it('sends force: true only once confirmed, alongside a proposal override or not', () => {
      expect(buildApproveRequest(undefined, true)).toEqual({ action: 'approve', force: true })
      const proposal = { title: 'Edited title' }
      expect(buildApproveRequest(proposal, true)).toEqual({ action: 'approve', proposal, force: true })
    })
  })

  describe('buildAttachRequest', () => {
    it('sends action attach with the picked target', () => {
      expect(buildAttachRequest({ kind: 'request', id: 'r1' })).toEqual({ action: 'attach', target: { kind: 'request', id: 'r1' } })
      expect(buildAttachRequest({ kind: 'task', id: 't1' })).toEqual({ action: 'attach', target: { kind: 'task', id: 't1' } })
    })
  })
})

// ── Assignee suggestions (CN.2 contract section 5) ──────────────────────────

describe('proposalAssigneeSuggestion', () => {
  it('reads the name, id and reason off a create_task proposal', () => {
    const suggestion = proposalAssigneeSuggestion('create_task', {
      title: 'Send the contract',
      suggestedAssigneeName: 'Staci',
      suggestedAssigneeId: 'member1',
      assigneeReason: 'said she would send the headers',
    })
    expect(suggestion).toEqual({ name: 'Staci', id: 'member1', reason: 'said she would send the headers' })
  })

  it('reads it off create_request and update_request too', () => {
    expect(proposalAssigneeSuggestion('create_request', {
      title: 'New landing page', suggestedAssigneeName: 'Liam', suggestedAssigneeId: 'member2', assigneeReason: null,
    })).toEqual({ name: 'Liam', id: 'member2', reason: null })

    expect(proposalAssigneeSuggestion('update_request', {
      fields: {}, suggestedAssigneeName: 'Liam', suggestedAssigneeId: null, assigneeReason: 'owns this client\'s work',
    })).toEqual({ name: 'Liam', id: null, reason: 'owns this client\'s work' })
  })

  it('is null when the kind does not carry an assignee suggestion at all', () => {
    expect(proposalAssigneeSuggestion('note', { body: 'A note' })).toBeNull()
    expect(proposalAssigneeSuggestion('hand_off_request', { contactName: 'Ella', reason: 'needs_content' })).toBeNull()
  })

  it('is null when the kind carries the fields but nobody was named', () => {
    expect(proposalAssigneeSuggestion('create_task', { title: 'Send the contract' })).toBeNull()
    expect(proposalAssigneeSuggestion('create_task', { title: 'Send the contract', suggestedAssigneeName: null })).toBeNull()
  })
})

describe('assigneeSuggestionLine', () => {
  it('reads "Suggested: name, reason" when both are present', () => {
    expect(assigneeSuggestionLine({ name: 'Staci', id: 'member1', reason: 'said she would send the headers' }))
      .toBe('Suggested: Staci, said she would send the headers')
  })

  it('drops the reason clause when there is none', () => {
    expect(assigneeSuggestionLine({ name: 'Staci', id: null, reason: null })).toBe('Suggested: Staci')
  })

  it('is null with no suggestion at all', () => {
    expect(assigneeSuggestionLine(null)).toBeNull()
    expect(assigneeSuggestionLine({ name: null, id: null, reason: null })).toBeNull()
  })
})

describe('withAssigneeOverride', () => {
  it('replaces the three assignee keys and drops the reason on a human pick', () => {
    const proposal: CreateTaskProposal = {
      title: 'Send the contract',
      description: null,
      type: 'internal_client_task',
      orgId: 'org1',
      requestId: null,
      suggestedAssigneeName: 'Staci',
      suggestedAssigneeId: 'member1',
      assigneeReason: 'said she would send the headers',
      dueDate: null,
      estimatedHours: null,
      priority: 'standard',
      subtasks: [],
    }
    const overridden = withAssigneeOverride(proposal, { id: 'member2', name: 'Liam' })
    expect(overridden.suggestedAssigneeId).toBe('member2')
    expect(overridden.suggestedAssigneeName).toBe('Liam')
    expect(overridden.assigneeReason).toBeNull()
    // Everything else on the proposal survives untouched.
    expect(overridden.title).toBe('Send the contract')
  })

  it('clears the assignee back to unassigned', () => {
    const proposal: UpdateRequestProposal = {
      fields: { priority: 'high' },
      suggestedAssigneeName: 'Liam',
      suggestedAssigneeId: 'member2',
      assigneeReason: 'owns this client\'s work',
    }
    const overridden = withAssigneeOverride(proposal, { id: null, name: null })
    expect(overridden.suggestedAssigneeId).toBeNull()
    expect(overridden.suggestedAssigneeName).toBeNull()
    expect(overridden.assigneeReason).toBeNull()
    expect(overridden.fields).toEqual({ priority: 'high' })
  })
})
