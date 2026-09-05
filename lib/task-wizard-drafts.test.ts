import { describe, it, expect } from 'vitest'
import {
  buildCreateTaskBody,
  draftToTaskFields,
  normaliseWizardPriority,
  resolveDraftAssignee,
  resolveDraftClient,
  resolveRequestRef,
  type DraftContext,
  type TaskWizardDraft,
} from './task-wizard-drafts'

const CLIENTS = [
  { id: 'org-safe', name: 'Safe Recruitment' },
  { id: 'org-sandy', name: 'Sandy Bay Wines' },
  { id: 'org-sandcastle', name: 'Sandcastle Studios' },
]

const PEOPLE = [
  { id: 'tm-liam', name: 'Liam Miller' },
  { id: 'tm-staci', name: 'Staci Bonnie' },
]

const REQUESTS = [
  { id: 'req-42', requestNumber: 42 },
  { id: 'req-7', requestNumber: 7 },
  { id: 'req-none', requestNumber: null },
]

function draft(overrides: Partial<TaskWizardDraft> = {}): TaskWizardDraft {
  return {
    id: 'draft_abc',
    title: 'Rebuild the pricing page',
    description: 'Two columns, keep the current copy.',
    category: null,
    priority: 'medium',
    estimatedHours: 6,
    dueDate: null,
    clientName: null,
    assigneeName: null,
    requestRef: null,
    checklist: [],
    ...overrides,
  }
}

const EMPTY_CONTEXT: DraftContext = { clients: [], people: [], requests: [] }

describe('normaliseWizardPriority', () => {
  it('folds the wizard four value scale onto the task three value one', () => {
    expect(normaliseWizardPriority('low')).toBe('standard')
    expect(normaliseWizardPriority('medium')).toBe('standard')
    expect(normaliseWizardPriority('none')).toBe('standard')
    expect(normaliseWizardPriority('normal')).toBe('standard')
  })

  it('passes the two that already mean the same thing through', () => {
    expect(normaliseWizardPriority('high')).toBe('high')
    expect(normaliseWizardPriority('urgent')).toBe('urgent')
    expect(normaliseWizardPriority('critical')).toBe('urgent')
  })

  it('is case and whitespace insensitive, because a model is neither', () => {
    expect(normaliseWizardPriority('  Urgent ')).toBe('urgent')
    expect(normaliseWizardPriority('HIGH')).toBe('high')
  })

  it('falls back to standard for anything it does not recognise', () => {
    expect(normaliseWizardPriority('blocker')).toBe('standard')
    expect(normaliseWizardPriority(undefined)).toBe('standard')
    expect(normaliseWizardPriority(3)).toBe('standard')
    expect(normaliseWizardPriority(null)).toBe('standard')
  })
})

describe('resolveDraftClient', () => {
  it('matches a full name whatever the case', () => {
    expect(resolveDraftClient('safe recruitment', CLIENTS)).toBe('org-safe')
    expect(resolveDraftClient('  Safe Recruitment  ', CLIENTS)).toBe('org-safe')
  })

  it('matches a unique prefix', () => {
    expect(resolveDraftClient('Safe', CLIENTS)).toBe('org-safe')
  })

  it('returns null on an ambiguous prefix rather than guessing', () => {
    expect(resolveDraftClient('Sand', CLIENTS)).toBeNull()
  })

  it('returns null when nothing matches, so a human picks', () => {
    expect(resolveDraftClient('Acme Holdings', CLIENTS)).toBeNull()
    expect(resolveDraftClient(null, CLIENTS)).toBeNull()
    expect(resolveDraftClient('   ', CLIENTS)).toBeNull()
  })
})

describe('resolveDraftAssignee', () => {
  it('behaves the same over people', () => {
    expect(resolveDraftAssignee('liam miller', PEOPLE)).toBe('tm-liam')
    expect(resolveDraftAssignee('Staci', PEOPLE)).toBe('tm-staci')
    expect(resolveDraftAssignee('Someone Else', PEOPLE)).toBeNull()
  })
})

describe('resolveRequestRef', () => {
  it('reads the padded reference and the bare number alike', () => {
    expect(resolveRequestRef('#042', REQUESTS)).toBe('req-42')
    expect(resolveRequestRef('42', REQUESTS)).toBe('req-42')
    expect(resolveRequestRef('#7', REQUESTS)).toBe('req-7')
  })

  it('returns null for a number nothing carries, and for nonsense', () => {
    expect(resolveRequestRef('#999', REQUESTS)).toBeNull()
    expect(resolveRequestRef('the pricing one', REQUESTS)).toBeNull()
    expect(resolveRequestRef(null, REQUESTS)).toBeNull()
  })
})

describe('draftToTaskFields', () => {
  it('files studio work with no client as a Tahi task', () => {
    const fields = draftToTaskFields(draft(), EMPTY_CONTEXT)
    expect(fields).not.toBeNull()
    expect(fields?.type).toBe('tahi_internal')
    expect(fields?.orgId).toBeNull()
  })

  it('becomes Internal, not Client, once a client is resolved', () => {
    const fields = draftToTaskFields(
      draft({ clientName: 'Safe Recruitment' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS },
    )
    expect(fields?.orgId).toBe('org-safe')
    expect(fields?.type).toBe('internal_client_task')
  })

  it('never reaches client_task unless the caller asked for it', () => {
    const derived = draftToTaskFields(
      draft({ clientName: 'Safe Recruitment' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS },
    )
    expect(derived?.type).not.toBe('client_task')

    const chosen = draftToTaskFields(
      draft({ clientName: 'Safe Recruitment' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS, level: 'client_task' },
    )
    expect(chosen?.type).toBe('client_task')
  })

  it('prefers what the page already knows over what the model guessed', () => {
    const fields = draftToTaskFields(
      draft({ clientName: 'Sandy Bay Wines', requestRef: '#007' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS, orgId: 'org-safe', requestId: 'req-42' },
    )
    expect(fields?.orgId).toBe('org-safe')
    expect(fields?.requestId).toBe('req-42')
  })

  it('resolves the assignee by name and drops one it cannot place', () => {
    const placed = draftToTaskFields(
      draft({ assigneeName: 'Staci Bonnie' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS },
    )
    expect(placed?.assigneeId).toBe('tm-staci')

    const unplaced = draftToTaskFields(
      draft({ assigneeName: 'A Contractor' }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS },
    )
    expect(unplaced?.assigneeId).toBeNull()
  })

  it('keeps the note free of a category line when the model set none', () => {
    const fields = draftToTaskFields(draft({ category: null }), EMPTY_CONTEXT)
    expect(fields?.description).toBe('Two columns, keep the current copy.')
    expect(fields?.description).not.toContain('Category:')
  })

  it('records the category as one readable line when the model set one', () => {
    const fields = draftToTaskFields(draft({ category: 'design' }), EMPTY_CONTEXT)
    expect(fields?.description).toBe('Two columns, keep the current copy.\n\nCategory: design')
  })

  it('leaves the note null when there is nothing to say', () => {
    const fields = draftToTaskFields(draft({ description: '  ', category: null }), EMPTY_CONTEXT)
    expect(fields?.description).toBeNull()
  })

  it('drops blank checklist entries', () => {
    const fields = draftToTaskFields(
      draft({ checklist: ['Draft the copy', '   ', 'Ship it'] }),
      EMPTY_CONTEXT,
    )
    expect(fields?.subtasks).toEqual(['Draft the copy', 'Ship it'])
  })

  it('refuses an empty title, so a blank task cannot be filed', () => {
    expect(draftToTaskFields(draft({ title: '   ' }), EMPTY_CONTEXT)).toBeNull()
  })
})

describe('buildCreateTaskBody', () => {
  it('sends the four fields the old wizard dropped as real fields', () => {
    const body = buildCreateTaskBody(
      draft({
        estimatedHours: 12,
        dueDate: '2026-09-30',
        assigneeName: 'Liam Miller',
        requestRef: '#042',
        checklist: ['Wireframe', 'Build'],
      }),
      { clients: CLIENTS, people: PEOPLE, requests: REQUESTS },
    )
    expect(body).toMatchObject({
      estimatedHours: 12,
      dueDate: '2026-09-30',
      assigneeId: 'tm-liam',
      requestId: 'req-42',
      status: 'todo',
      subtasks: ['Wireframe', 'Build'],
    })
  })

  it('normalises the priority on the way out', () => {
    const body = buildCreateTaskBody(draft({ priority: 'medium' }), EMPTY_CONTEXT)
    expect(body?.priority).toBe('standard')
  })

  it('carries no category key, because a task has no category column', () => {
    const body = buildCreateTaskBody(draft({ category: 'seo' }), EMPTY_CONTEXT)
    expect(body).not.toHaveProperty('category')
    expect(body?.description).toContain('Category: seo')
  })

  it('returns null for an empty title, so pressing the button twice files nothing', () => {
    expect(buildCreateTaskBody(draft({ title: '' }), EMPTY_CONTEXT)).toBeNull()
  })
})
