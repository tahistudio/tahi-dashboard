import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecoratedSuggestion, TaskSuggestionsResponse } from '@/app/(dashboard)/tasks/suggestions-types'
import { TasksSuggestions } from '../tasks-suggestions'

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  mutate: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('swr', () => ({ default: mocks.useSWR }))
vi.mock('@/components/tahi/toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('@/components/tahi/tasks/new-task-dialog', () => ({ NewTaskDialog: () => null }))
vi.mock('@/components/tahi/new-request-dialog', () => ({ NewRequestDialog: () => null }))

const ELEVATE = { id: 'elevate', name: 'Elevate' }
const HEALTH = { id: 'health', name: 'Elevate Health' }
const CLIENT_REQUIRED_LINE = 'Choose the client in Slack (Tweak)'
const CREATE_KINDS = ['create_task', 'create_request'] as const

function suggestion(
  kind: typeof CREATE_KINDS[number],
  choices: readonly { id: string; name: string }[],
  orgId: string | null = null,
): DecoratedSuggestion {
  const proposal = kind === 'create_task'
    ? {
        title: 'Send the October invoice',
        description: null,
        type: orgId ? 'internal_client_task' as const : 'tahi_internal' as const,
        orgId,
        slackClientChoices: choices,
      }
    : {
        title: 'Send the October invoice',
        description: null,
        category: 'other',
        type: 'standard',
        priority: 'standard' as const,
        slackClientChoices: choices,
      }
  return {
    id: 'suggestion-1',
    orgId,
    sourceKind: 'note',
    transcriptId: null,
    callKind: null,
    callId: null,
    kind,
    targetTaskId: null,
    targetRequestId: null,
    appliedRequestId: null,
    proposal,
    quote: 'Send the October invoice',
    rationale: null,
    confidence: 0.9,
    status: 'pending',
    snoozeUntil: null,
    createdAt: '2026-10-14T00:00:00Z',
    callTitle: null,
    callScheduledAt: null,
    orgName: orgId ? ELEVATE.name : null,
    targetTaskTitle: null,
    targetTaskStatus: null,
    targetRequestNumber: null,
    targetRequestTitle: null,
    targetRequestStatus: null,
    similar: [],
  }
}

function renderInbox(row: DecoratedSuggestion): string {
  const data: TaskSuggestionsResponse = {
    items: [row],
    counts: { pending: 1, snoozed: 0, calls: 0 },
  }
  mocks.useSWR.mockReturnValue({ data, mutate: mocks.mutate, isLoading: false })
  return renderToStaticMarkup(
    <TasksSuggestions clients={[]} peopleList={[]} requests={[]} onTaskCreated={vi.fn()} />,
  )
}

function buttonAttributes(html: string, label: string): string {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(match => match[2].replace(/<[^>]*>/g, '').trim() === label)
  expect(buttons).toHaveLength(1)
  return buttons[0][1]
}

describe('client choice required in the dashboard suggestions inbox', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each(CREATE_KINDS)('explains how to resolve a singleton contact choice for %s', kind => {
    const html = renderInbox(suggestion(kind, [ELEVATE]))
    expect(html).toContain('role="status"')
    expect(html).toContain(`>${CLIENT_REQUIRED_LINE}</p>`)
    for (const label of ['Approve', 'Tweak']) {
      const attributes = buttonAttributes(html, label)
      expect(attributes).toMatch(/\bdisabled=""/)
      expect(attributes).toContain(`title="${CLIENT_REQUIRED_LINE}"`)
    }
  })

  it.each(CREATE_KINDS)('explains how to resolve multiple client choices for %s', kind => {
    const html = renderInbox(suggestion(kind, [ELEVATE, HEALTH]))
    expect(html).toContain(`>${CLIENT_REQUIRED_LINE}</p>`)
    expect(buttonAttributes(html, 'Approve')).toMatch(/\bdisabled=""/)
    expect(buttonAttributes(html, 'Tweak')).toMatch(/\bdisabled=""/)
  })

  it.each(CREATE_KINDS)('leaves a resolved %s enabled even when stored choices remain', kind => {
    const html = renderInbox(suggestion(kind, [ELEVATE, HEALTH], ELEVATE.id))
    expect(html).not.toContain(CLIENT_REQUIRED_LINE)
    expect(buttonAttributes(html, 'Approve')).not.toMatch(/\bdisabled=""/)
    expect(buttonAttributes(html, 'Tweak')).not.toMatch(/\bdisabled=""/)
  })

  it('leaves studio-internal tasks with no client choices enabled', () => {
    const html = renderInbox(suggestion('create_task', []))
    expect(html).not.toContain(CLIENT_REQUIRED_LINE)
    expect(buttonAttributes(html, 'Approve')).not.toMatch(/\bdisabled=""/)
    expect(buttonAttributes(html, 'Tweak')).not.toMatch(/\bdisabled=""/)
  })
})
