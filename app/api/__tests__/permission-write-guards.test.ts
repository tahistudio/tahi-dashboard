/** Real route and feature guard wiring, with data operations forbidden on denial. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/task-writes', () => ({ createTaskRecord: vi.fn(), updateTaskRecord: vi.fn() }))
vi.mock('@/lib/task-comments', () => ({ listTaskComments: vi.fn(), postTaskComment: vi.fn() }))
vi.mock('@/lib/calls', () => ({ listCallsForParent: vi.fn(), createCallForParent: vi.fn() }))
vi.mock('@/lib/request-status-effects', () => ({ emitRequestCreated: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { createTaskRecord, updateTaskRecord } from '@/lib/task-writes'
import { postTaskComment, listTaskComments } from '@/lib/task-comments'
import { createCallForParent, listCallsForParent } from '@/lib/calls'
import { emitRequestCreated } from '@/lib/request-status-effects'
import * as docs from '@/app/api/admin/docs/route'
import * as doc from '@/app/api/admin/docs/[id]/route'
import * as docImport from '@/app/api/admin/docs/import/route'
import * as tasks from '@/app/api/admin/tasks/route'
import * as task from '@/app/api/admin/tasks/[id]/route'
import * as bulk from '@/app/api/admin/tasks/bulk/route'
import * as template from '@/app/api/admin/tasks/from-template/route'
import * as comments from '@/app/api/admin/tasks/[id]/comments/route'
import * as calls from '@/app/api/admin/tasks/[id]/calls/route'
import * as promote from '@/app/api/admin/tasks/[id]/promote/route'
import * as subtasks from '@/app/api/admin/tasks/[id]/subtasks/route'
import * as subtask from '@/app/api/admin/tasks/[id]/subtasks/[subId]/route'
import * as blockers from '@/app/api/admin/tasks/[id]/blockers/route'
import * as blocker from '@/app/api/admin/tasks/[id]/blockers/[linkId]/route'
import * as dependencies from '@/app/api/admin/tasks/[id]/dependencies/route'
import * as dependency from '@/app/api/admin/tasks/[id]/dependencies/[depId]/route'
import * as sections from '@/app/api/admin/proposals/[id]/sections/route'
import * as section from '@/app/api/admin/proposals/[id]/sections/[sectionId]/route'

const context = () => ({ params: Promise.resolve({
  id: 'entity-1', subId: 'checklist-1', linkId: 'blocker-1',
  depId: 'dependency-1', sectionId: 'section-1',
}) })

interface GuardedRoute {
  path: string
  method: string
  feature: 'docs' | 'tasks' | 'proposals'
  body?: unknown
  call: (request: NextRequest) => Promise<Response>
}

const routes: GuardedRoute[] = [
  { path: 'docs', method: 'GET', feature: 'docs', call: docs.GET },
  { path: 'docs', method: 'POST', feature: 'docs', body: { title: 'Private playbook', contentMd: 'Private' }, call: docs.POST },
  { path: 'docs/entity-1', method: 'GET', feature: 'docs', call: request => doc.GET(request, context()) },
  { path: 'docs/entity-1', method: 'PATCH', feature: 'docs', body: { contentMd: 'Overwrite' }, call: request => doc.PATCH(request, context()) },
  { path: 'docs/entity-1', method: 'DELETE', feature: 'docs', call: request => doc.DELETE(request, context()) },
  { path: 'docs/import', method: 'POST', feature: 'docs', body: { pages: [{ title: 'Private', category: 'operations', content: 'Private' }] }, call: docImport.POST },
  { path: 'tasks', method: 'GET', feature: 'tasks', call: tasks.GET },
  { path: 'tasks', method: 'POST', feature: 'tasks', body: { title: 'Private task' }, call: tasks.POST },
  { path: 'tasks/entity-1', method: 'GET', feature: 'tasks', call: request => task.GET(request, context()) },
  { path: 'tasks/entity-1', method: 'PATCH', feature: 'tasks', body: { status: 'done' }, call: request => task.PATCH(request, context()) },
  { path: 'tasks/entity-1', method: 'DELETE', feature: 'tasks', call: request => task.DELETE(request, context()) },
  { path: 'tasks/bulk', method: 'PATCH', feature: 'tasks', body: { taskIds: ['entity-1'], updates: { status: 'done' } }, call: bulk.PATCH },
  { path: 'tasks/from-template', method: 'POST', feature: 'tasks', body: { templateId: 'template-1', orgId: 'org-a' }, call: template.POST },
  { path: 'tasks/entity-1/comments', method: 'GET', feature: 'tasks', call: request => comments.GET(request, context()) },
  { path: 'tasks/entity-1/comments', method: 'POST', feature: 'tasks', body: { content: 'Private note' }, call: request => comments.POST(request, context()) },
  { path: 'tasks/entity-1/calls', method: 'GET', feature: 'tasks', call: request => calls.GET(request, context()) },
  { path: 'tasks/entity-1/calls', method: 'POST', feature: 'tasks', body: { title: 'Private call', scheduledAt: '2026-10-20T00:00:00Z' }, call: request => calls.POST(request, context()) },
  { path: 'tasks/entity-1/promote', method: 'POST', feature: 'tasks', body: { category: 'design', size: 'small' }, call: request => promote.POST(request, context()) },
  { path: 'tasks/entity-1/subtasks', method: 'GET', feature: 'tasks', call: request => subtasks.GET(request, context()) },
  { path: 'tasks/entity-1/subtasks', method: 'POST', feature: 'tasks', body: { title: 'Private checklist item' }, call: request => subtasks.POST(request, context()) },
  { path: 'tasks/entity-1/subtasks/checklist-1', method: 'PATCH', feature: 'tasks', body: { completed: true }, call: request => subtask.PATCH(request, context()) },
  { path: 'tasks/entity-1/subtasks/checklist-1', method: 'DELETE', feature: 'tasks', call: request => subtask.DELETE(request, context()) },
  { path: 'tasks/entity-1/blockers', method: 'GET', feature: 'tasks', call: request => blockers.GET(request, context()) },
  { path: 'tasks/entity-1/blockers', method: 'POST', feature: 'tasks', body: { blockerType: 'task', blockerId: 'other-task' }, call: request => blockers.POST(request, context()) },
  { path: 'tasks/entity-1/blockers/blocker-1', method: 'DELETE', feature: 'tasks', call: request => blocker.DELETE(request, context()) },
  { path: 'tasks/entity-1/dependencies', method: 'GET', feature: 'tasks', call: request => dependencies.GET(request, context()) },
  { path: 'tasks/entity-1/dependencies', method: 'POST', feature: 'tasks', body: { dependsOnTaskId: 'other-task' }, call: request => dependencies.POST(request, context()) },
  { path: 'tasks/entity-1/dependencies/dependency-1', method: 'DELETE', feature: 'tasks', call: request => dependency.DELETE(request, context()) },
  { path: 'proposals/entity-1/sections', method: 'POST', feature: 'proposals', body: { type: 'text', title: 'Private offer' }, call: request => sections.POST(request, context()) },
  { path: 'proposals/entity-1/sections/section-1', method: 'PATCH', feature: 'proposals', body: { title: 'Overwrite' }, call: request => section.PATCH(request, context()) },
  { path: 'proposals/entity-1/sections/section-1', method: 'DELETE', feature: 'proposals', call: request => section.DELETE(request, context()) },
]

function memberAccess(): ResolvedAccess {
  return {
    userId: 'user_member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(), overrides: new Map(),
  }
}

const database = {
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  all: vi.fn(), run: vi.fn(), batch: vi.fn(),
}
const sideEffects = [
  createTaskRecord, updateTaskRecord, postTaskComment, listTaskComments,
  createCallForParent, listCallsForParent, emitRequestCreated,
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db).mockResolvedValue(database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'session-1' })
  vi.mocked(resolvePermissions).mockResolvedValue(memberAccess())
})

function requestFor(route: GuardedRoute, malformed = false) {
  const request = new NextRequest(`http://localhost/api/admin/${route.path}`, {
    method: route.method,
    ...(route.body === undefined ? {} : { body: malformed ? '{invalid' : JSON.stringify(route.body) }),
  })
  return { request, readBody: vi.spyOn(request, 'json') }
}

function expectNoDataOrSideEffects() {
  for (const operation of [...Object.values(database), ...sideEffects]) {
    expect(operation).not.toHaveBeenCalled()
  }
}

describe.each(['roleless', 'explicit feature deny'] as const)('%s team member', denial => {
  it.each(routes)('$method /api/admin/$path returns 403 before data access or writes', async route => {
    if (denial === 'explicit feature deny') {
      const access = memberAccess()
      access.viewableResources = new Set(['docs', 'tasks', 'proposals'])
      access.overrides.set(route.feature, 'deny')
      vi.mocked(resolvePermissions).mockResolvedValue(access)
    }
    const { request, readBody } = requestFor(route)
    const response = await route.call(request)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(resolvePermissions).toHaveBeenCalledWith(database, { userId: 'user_member', orgId: 'org_tahi' })
    expect(readBody).not.toHaveBeenCalled()
    expectNoDataOrSideEffects()
  })
})

describe('denial precedes body validation', () => {
  it.each(routes.filter(route => route.body !== undefined))('$method /api/admin/$path refuses malformed writes with 403', async route => {
    const { request, readBody } = requestFor(route, true)
    const response = await route.call(request)
    expect(response.status).toBe(403)
    expect(readBody).not.toHaveBeenCalled()
    expectNoDataOrSideEffects()
  })
})

describe.each([
  { label: 'client', userId: 'user_client', orgId: 'org_client' },
  { label: 'signed out', userId: null, orgId: null },
])('$label session', session => {
  it.each(routes)('$method /api/admin/$path stops before feature or data lookup', async route => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: session.userId, orgId: session.orgId, sessionId: null })
    const response = await route.call(requestFor(route).request)
    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(resolvePermissions).not.toHaveBeenCalled()
    expectNoDataOrSideEffects()
  })
})
