'use client'

/**
 * <TasksContent>. The shell of the Tasks surface: it fetches, holds the rail
 * state, routes the three views, and owns every write.
 *
 * Nothing below this file talks to the API. The list, the board, the week
 * planner, the detail slide-over, the create dialog and the quick-add are
 * leaves that take props and hand mutations back through callbacks, so the
 * optimistic update, the rollback and the failure toast live in one place
 * instead of six.
 *
 * Two things worth knowing before editing:
 *
 * 1. SWR keys are bare paths. The global fetcher (lib/swr-fetcher.ts) applies
 *    `apiPath` itself, so a key that had already been through `apiPath` would
 *    be prefixed twice the moment a basePath comes back. Only the imperative
 *    `fetch` calls in this file wrap their URL.
 * 2. The whole task list is fetched once and every lens is resolved in the
 *    browser, the same way the Requests list does it. That is what keeps the
 *    rail's counts and the rows on screen answering the same question.
 *
 * Tasks are the studio's own list and are never client-visible: the page
 * redirects a client org before this component mounts, so there is no
 * audience switch here.
 *
 * One legacy control is deliberately not carried over, stated here rather
 * than left as a silent gap: the Delivery phase selector, which linked a task
 * to a schedule gantt row through `tasks.scheduleRowId`. The column is alive
 * and still written, from the Linked work section of a schedule row on
 * /schedules/[id] and from the `update_task` MCP tool, and still read by the
 * schedule delivery-status and linked-work routes. What is gone is the
 * tasks-side control, which is why `scheduleRowId` is absent from
 * PATCHABLE_KEYS below. Putting it back is a Links card row on the detail
 * panel plus the field on `TaskRow` and the list select, not a one-line
 * change here.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'

import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import {
  SaveDefaultControl,
  type RailFilterChip,
  type RailOption,
} from '@/components/tahi/rail/rail-controls'
import { TASK_STATUS_LABELS } from '@/lib/status-config'
import { taskPriorityLabel } from '@/lib/task-priorities'
import type { QuickAddParse } from '@/lib/tasks-quick-add'
import {
  DEFAULT_TASK_FILTERS,
  TASK_LEVEL_LABELS,
  anyTaskFilterActive,
  applyTaskViews,
  countTasksSavedViews,
  levelOf,
  type TaskFilterKey,
  type TaskRow,
} from '@/lib/tasks-views'
import { TasksRail, buildTaskChips } from '@/components/tahi/tasks/tasks-rail'
import { TasksViewSwitcher, TASKS_VIEW_PANEL_ID } from '@/components/tahi/tasks/tasks-view-switcher'
import { TasksHeaderActions } from '@/components/tahi/tasks/tasks-header-actions'
import { useTasksRailState } from '@/components/tahi/tasks/use-tasks-rail-state'
import { TasksList } from '@/components/tahi/tasks/tasks-list'
import { TasksBoard } from '@/components/tahi/tasks/tasks-board'
import { TasksWeek } from '@/components/tahi/tasks/tasks-week'
import { TaskDetailPanel } from '@/components/tahi/tasks/task-detail-panel'
import { NewTaskDialog, type NewTaskDraft } from '@/components/tahi/tasks/new-task-dialog'
import type {
  BlockerRow,
  TaskClientOption,
  TaskPerson,
  TaskRequestOption,
  TaskSubtask,
  TaskTemplateOption,
} from '@/components/tahi/tasks/task-types'
import type { BlockerCandidate, BlockerSubjectType } from '@/lib/blockers'

// AI wizard modal: only opened on click, so defer it out of the first paint.
const AiTaskWizard = dynamic(
  () => import('@/components/tahi/ai-task-wizard').then(m => ({ default: m.AiTaskWizard })),
  { ssr: false },
)

// -- Keys ---------------------------------------------------------------------

const TASKS_KEY = '/api/admin/tasks?status=all'
const TEAM_KEY = '/api/admin/team-members'
const CLIENTS_KEY = '/api/admin/clients?status=active'
const REQUESTS_KEY = '/api/admin/requests?status=all&limit=500'
const TEMPLATES_KEY = '/api/admin/task-templates'
const PROFILE_KEY = '/api/admin/profile'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// -- Wire shapes --------------------------------------------------------------

interface TasksPayload { tasks?: TaskRow[] }
interface SingleTaskPayload { task?: TaskRow }
interface TeamPayload { items?: { id: string; name: string; avatarUrl: string | null }[] }
interface ClientsPayload { organisations?: { id: string; name: string }[] }
interface RequestsPayload {
  requests?: { id: string; orgId: string | null; requestNumber: number | null; title: string }[]
}
interface TemplatesPayload {
  templates?: {
    id: string
    name: string
    type: string
    description: string | null
    defaultPriority: string
    subtasks: string | null
    estimatedHours: number | null
    orgId: string | null
  }[]
}
interface ProfilePayload { member?: { id: string } | null }
interface SubtasksPayload {
  subtasks?: { id: string; title: string; completed: boolean | null }[]
}
interface BlockersPayload {
  blockedBy?: BlockerRow[]
  blocks?: BlockerRow[]
}
interface BlockerCandidatesPayload {
  candidates?: BlockerCandidate[]
}

/**
 * The fields PATCH /api/admin/tasks/[id] takes out of a `Partial<TaskRow>`.
 * `orgName` is a join and `completedAt` is derived from the status by the
 * route, so neither travels; `type` does, because the Links card patches the
 * level, the client and the request as one triple and the route validates it
 * with `isTaskLevel`. `assigneeType` is never sent: the route owns it.
 */
const PATCHABLE_KEYS = [
  'title', 'description', 'status', 'priority', 'assigneeId',
  'dueDate', 'estimatedHours', 'type', 'orgId', 'requestId',
] as const

function toPatchBody(patch: Partial<TaskRow>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const key of PATCHABLE_KEYS) {
    const value = patch[key]
    if (value !== undefined) body[key] = value
  }
  return body
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string }
    return data.error ?? 'Request failed'
  } catch {
    return 'Request failed'
  }
}

/** Quote every field and double any inner quote: a task title with a comma in
 *  it is the normal case, not the edge case. */
function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/** The byte order mark Excel wants before it will read a UTF-8 CSV without
 *  mangling a client name. Built from its code point rather than pasted in,
 *  because an invisible character in source survives exactly one careless
 *  edit. */
const CSV_BOM = String.fromCharCode(0xFEFF)

/** One frozen identity, so suppressing the chip strip does not hand RailLayout
 *  a fresh array on every render. */
const NO_CHIPS: readonly RailFilterChip[] = []

// -- Boot skeleton ------------------------------------------------------------

const SKELETON_PANE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '0.75rem',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-bg-secondary)',
}

const SKELETON_HEAD: CSSProperties = {
  height: '0.75rem',
  width: '45%',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-tertiary)',
}

const SKELETON_CARD: CSSProperties = {
  height: '3.25rem',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-bg)',
}

/**
 * Held in place of the board and the week planner while the first fetch and
 * the viewer's own team member id are still landing. The list leaf owns its
 * own row skeleton and keeps it; without this the board drew four empty
 * columns and My week drew "A clear week" before anything had been asked,
 * which is the normal first paint for anyone whose saved default is not List.
 */
function TasksViewSkeleton({ variant }: { variant: 'board' | 'week' }) {
  const panes = variant === 'board' ? 4 : 3
  return (
    <div
      role="status"
      aria-label={variant === 'board' ? 'Loading the board' : 'Loading your week'}
      className={variant === 'board'
        ? 'animate-pulse grid grid-cols-2 md:grid-cols-4'
        : 'animate-pulse flex flex-col'}
      style={{ gap: '0.75rem' }}
    >
      {Array.from({ length: panes }, (_, i) => (
        <div key={i} style={SKELETON_PANE}>
          <div style={SKELETON_HEAD} />
          <div style={SKELETON_CARD} />
          <div style={SKELETON_CARD} />
        </div>
      ))}
    </div>
  )
}

// -- The shell ----------------------------------------------------------------

export function TasksContent() {
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { mutate: mutateKey } = useSWRConfig()
  const rail = useTasksRailState()

  const {
    isImpersonatingTeamMember,
    impersonatedAccessRules,
    impersonatedTeamMemberId,
  } = useImpersonation()

  // A viewer-scoped impersonation is a read-only lens: the PATCH and POST
  // calls behind these controls land as the real super admin, so the lens has
  // to hold in the UI too.
  const readOnly = isImpersonatingTeamMember
    && impersonatedAccessRules.length > 0
    && impersonatedAccessRules.every(r => r.role === 'viewer')

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: tasksData, isLoading: loading, mutate: mutateTasks } = useSWR<TasksPayload>(TASKS_KEY)
  const { data: teamData } = useSWR<TeamPayload>(TEAM_KEY)
  const { data: clientsData } = useSWR<ClientsPayload>(CLIENTS_KEY)
  const { data: requestsData, mutate: mutateRequests } = useSWR<RequestsPayload>(REQUESTS_KEY)
  const { data: templatesData } = useSWR<TemplatesPayload>(TEMPLATES_KEY)
  // Impersonation is the only place the browser already knows which teammate
  // this is; otherwise the caller's own team member row is the answer, and
  // /api/admin/profile is the one route that resolves it from the Clerk id.
  const { data: profileData, isLoading: profileLoading } = useSWR<ProfilePayload>(PROFILE_KEY)

  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData])
  const meId = impersonatedTeamMemberId ?? profileData?.member?.id ?? null

  // The first paint waits on two fetches, not one. "Assigned to me", every
  // rail count and the whole My week plate are answers about `meId`, so
  // drawing them while /api/admin/profile is still in flight prints a
  // confident zero and an empty week. An impersonated teammate id is known
  // synchronously, so that lens skips the second wait.
  const booting = loading || (!impersonatedTeamMemberId && profileLoading)

  const peopleList = useMemo<TaskPerson[]>(
    () => (teamData?.items ?? []).map(m => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl })),
    [teamData],
  )
  const people = useMemo<Record<string, TaskPerson>>(() => {
    const map: Record<string, TaskPerson> = {}
    for (const p of peopleList) map[p.id] = p
    return map
  }, [peopleList])

  const clients = useMemo<TaskClientOption[]>(
    () => (clientsData?.organisations ?? []).map(o => ({ id: o.id, name: o.name })),
    [clientsData],
  )

  const requestOptions = useMemo<TaskRequestOption[]>(
    () => (requestsData?.requests ?? []).map(r => ({
      id: r.id,
      orgId: r.orgId,
      requestNumber: r.requestNumber,
      title: r.title,
    })),
    [requestsData],
  )

  const requestNumbers = useMemo<Record<string, number | null>>(() => {
    const map: Record<string, number | null> = {}
    for (const r of requestOptions) map[r.id] = r.requestNumber
    return map
  }, [requestOptions])

  // Templates store their checklist as a JSON string, which is the one shape
  // the leaves are not written against.
  const templates = useMemo<TaskTemplateOption[]>(
    () => (templatesData?.templates ?? []).map(t => {
      let subtasks: string[] = []
      try {
        const parsed: unknown = JSON.parse(t.subtasks ?? '[]')
        if (Array.isArray(parsed)) subtasks = parsed.filter((s): s is string => typeof s === 'string')
      } catch {
        // A malformed template checklist is a template with no checklist,
        // not a dialog that refuses to open.
      }
      return {
        id: t.id,
        name: t.name,
        type: t.type,
        description: t.description,
        defaultPriority: t.defaultPriority,
        subtasks,
        estimatedHours: t.estimatedHours,
        orgId: t.orgId,
      }
    }),
    [templatesData],
  )

  // ── Selection and the deep link ────────────────────────────────────────────

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => searchParams.get('task'))

  const selectTask = useCallback((id: string | null) => {
    setSelectedTaskId(id)
    if (typeof window === 'undefined') return
    // replaceState rather than router.replace: the URL has to stay shareable
    // without paying for a Next navigation on every row click.
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('task', id)
    else url.searchParams.delete('task')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [])

  const openRequest = useCallback((requestId: string) => {
    router.push(`/requests/${requestId}`)
  }, [router])

  // A task the current lens does not contain still has to open: a notification
  // link lands on /tasks?task=<id> whatever the reader's saved view is.
  const inLens = useMemo(
    () => (selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null),
    [tasks, selectedTaskId],
  )
  const fallbackKey = selectedTaskId && !inLens ? `/api/admin/tasks/${selectedTaskId}` : null
  const { data: fallbackData, isLoading: fallbackLoading } = useSWR<SingleTaskPayload>(fallbackKey)
  // keepPreviousData is on globally, so a settled payload for the PREVIOUS id
  // is still in `data` while a new key loads. The isLoading gate is what stops
  // the panel printing the last task's title under the new one's id.
  const fallbackTask = fallbackKey !== null && !fallbackLoading
    ? fallbackData?.task ?? null
    : null
  const selectedTask = inLens ?? fallbackTask
  // Only while the fetch is actually in flight. A deleted id settles with no
  // task and no error worth showing, and the panel says so itself; leaving
  // this true would spin on "Loading this task" for ever.
  const detailLoading = !!selectedTaskId && !selectedTask && fallbackLoading

  // ── Subtasks ───────────────────────────────────────────────────────────────

  // One map for both readers: the list's expanded panel and the detail card.
  // An id with no entry means "not fetched yet", which is exactly what both
  // leaves read as loading.
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, TaskSubtask[] | undefined>>({})

  const loadSubtasks = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks`))
      if (!res.ok) throw new Error(await readError(res))
      const data = await res.json() as SubtasksPayload
      const rows: TaskSubtask[] = (data.subtasks ?? []).map(s => ({
        id: s.id,
        title: s.title,
        completed: !!s.completed,
      }))
      setSubtasksByTask(current => ({ ...current, [taskId]: rows }))
    } catch {
      // Leaving the entry unset holds the skeleton rather than claiming the
      // task has no subtasks, so the failure has to be said out loud. The
      // list asks once per row per mount and will not ask again on its own;
      // opening the task is what refires this, because the panel's effect
      // keys off the selected id.
      showToast('Could not load that checklist. Open the task to try again.', 'error')
    }
  }, [showToast])

  // The open panel always needs its list; the list view asks per expanded row.
  // Refetched on every open rather than only when the entry is missing: the
  // cached list is still on screen meanwhile, so there is no skeleton flash,
  // and a task edited from the other view does not reopen stale.
  useEffect(() => {
    if (!selectedTaskId) return
    void loadSubtasks(selectedTaskId)
  }, [selectedTaskId, loadSubtasks])

  // ── Blockers ───────────────────────────────────────────────────────────────

  const depsKey = selectedTaskId ? `/api/admin/tasks/${selectedTaskId}/blockers` : null
  const { data: depsData, isLoading: depsLoading, mutate: mutateDeps } =
    useSWR<BlockersPayload>(depsKey)

  // No mapping any more. The server names an orphan honestly ("Deleted task",
  // "Deleted request") rather than the panel inventing "Untitled task" for a
  // row that is not untitled, it is gone.
  const blockedBy = useMemo<readonly BlockerRow[] | undefined>(() => {
    if (!depsKey || depsLoading || !depsData) return undefined
    return depsData.blockedBy ?? []
  }, [depsKey, depsLoading, depsData])

  /**
   * The picker searches the server rather than the rows this page happens to
   * hold, so it can offer a paginated request or a task outside the current
   * lens. Scoped the same way the two list routes are, which is why it is not
   * GET /api/admin/search.
   */
  const handleSearchBlockers = useCallback(async (query: string): Promise<BlockerCandidate[]> => {
    if (!selectedTaskId) return []
    const params = new URLSearchParams({ q: query, excludeType: 'task', excludeId: selectedTaskId })
    const res = await fetch(apiPath(`/api/admin/blockers/search?${params.toString()}`))
    if (!res.ok) return []
    const json = await res.json() as BlockerCandidatesPayload
    return json.candidates ?? []
  }, [selectedTaskId])

  // ── The pipeline ───────────────────────────────────────────────────────────

  const counts = useMemo(
    () => countTasksSavedViews(tasks, { assigneeId: meId }),
    [tasks, meId],
  )

  const visible = useMemo(
    () => applyTaskViews(tasks, {
      savedView: rail.savedView,
      filters: rail.filters,
      query: rail.query,
      sort: rail.sort,
      assigneeId: meId,
    }),
    [tasks, rail.savedView, rail.filters, rail.query, rail.sort, meId],
  )

  // My week ignores the rail on purpose, so its count has to say what the
  // planner is actually drawing rather than what the filters would leave.
  // Same predicate as TasksWeek's own `mine`, held as the set rather than
  // the number because Export CSV writes it while that view is on screen.
  const weekRows = useMemo(
    () => (meId ? tasks.filter(t => t.assigneeId === meId && t.status !== 'done') : []),
    [tasks, meId],
  )
  const weekCount = weekRows.length

  // The planner reads its own plate and never reads the rail, so while it is
  // the view on screen the search box, the saved views, the filter selects
  // and the chip strip all answer nothing. The rail says so in a note; the
  // chips are suppressed rather than left printing a filter that changes
  // nothing next to a count that ignores it.
  const railInert = rail.view === 'week'

  // Both option lists are built from the loaded rows, so a filter can only
  // ever pick a value that exists in the data in front of the user.
  const railClientOptions = useMemo<RailOption[]>(() => {
    const byId = new Map<string, string>()
    for (const t of tasks) if (t.orgId) byId.set(t.orgId, t.orgName ?? t.orgId)
    return [
      { value: 'all', label: 'All clients' },
      { value: 'none', label: 'No client' },
      ...Array.from(byId, ([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [tasks])

  const railAssigneeOptions = useMemo<RailOption[]>(() => {
    const byId = new Map<string, string>()
    for (const t of tasks) {
      if (t.assigneeId) byId.set(t.assigneeId, people[t.assigneeId]?.name ?? 'Someone else')
    }
    return [
      { value: 'all', label: 'All assignees' },
      { value: 'none', label: 'Unassigned' },
      ...Array.from(byId, ([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [tasks, people])

  const chips = useMemo(
    () => buildTaskChips(rail.filters, {
      clientOptions: railClientOptions,
      assigneeOptions: railAssigneeOptions,
    }),
    [rail.filters, railClientOptions, railAssigneeOptions],
  )

  const { setFilters, setSavedView, setQuery } = rail
  const clearAllFilters = useCallback(() => {
    setFilters({ ...DEFAULT_TASK_FILTERS })
    setSavedView(null)
    setQuery('')
  }, [setFilters, setSavedView, setQuery])

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * One shape for every single-task edit: patch the cache, fire the PATCH,
   * roll back and toast on failure. Resolves to whether the write landed, so
   * a caller that owes its own success message can tell.
   */
  const patchTask = useCallback(async (taskId: string, patch: Partial<TaskRow>): Promise<boolean> => {
    const body = toPatchBody(patch)
    if (Object.keys(body).length === 0) return true
    try {
      await mutateTasks(
        async () => {
          const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`), {
            method: 'PATCH',
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          })
          if (!res.ok) throw new Error(await readError(res))
          return undefined
        },
        {
          optimisticData: (current?: TasksPayload) => ({
            tasks: (current?.tasks ?? []).map(t => (t.id === taskId ? { ...t, ...patch } : t)),
          }),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      )
      // A deep-linked task sits outside the list cache, so the optimistic map
      // above never reached it.
      void mutateKey(`/api/admin/tasks/${taskId}`)
      return true
    } catch (err) {
      const message = err instanceof Error && err.message !== 'Request failed'
        ? err.message
        : 'That did not save. Try again.'
      showToast(message, 'error')
      return false
    }
  }, [mutateTasks, mutateKey, showToast])

  const handlePatch = useCallback(async (taskId: string, patch: Partial<TaskRow>) => {
    await patchTask(taskId, patch)
  }, [patchTask])

  const handleToggleDone = useCallback((taskId: string, done: boolean) => {
    void patchTask(taskId, {
      status: done ? 'done' : 'todo',
      completedAt: done ? new Date().toISOString() : null,
    })
  }, [patchTask])

  const handleStatusChange = useCallback(async (taskId: string, status: string) => {
    await patchTask(taskId, {
      status,
      completedAt: status === 'done' ? new Date().toISOString() : null,
    })
  }, [patchTask])

  const handleMove = useCallback(async (taskId: string, toStatus: string) => {
    const ok = await patchTask(taskId, {
      status: toStatus,
      completedAt: toStatus === 'done' ? new Date().toISOString() : null,
    })
    if (ok) showToast(`Moved to ${TASK_STATUS_LABELS[toStatus] ?? toStatus}`)
  }, [patchTask, showToast])

  const handlePlan = useCallback(async (taskId: string, dueDate: string | null, groupName: string) => {
    const ok = await patchTask(taskId, { dueDate })
    if (ok) showToast(dueDate ? `Planned for ${groupName}` : 'Date cleared')
  }, [patchTask, showToast])

  // The client the rail is narrowed to, when it is narrowed to one. Both the
  // board composer and the create dialog open against it, so a task typed
  // while looking at one client does not land unclientted.
  const filterOrgId = rail.filters.client !== 'all' && rail.filters.client !== 'none'
    ? rail.filters.client
    : null

  const createTask = useCallback(async (body: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(apiPath('/api/admin/tasks'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await readError(res))
    const data = await res.json() as { id?: string }
    await mutateTasks()
    return data.id ?? null
  }, [mutateTasks])

  // Rejecting is the contract here: the quick-add keeps the typed line in the
  // box and toasts for itself.
  const handleQuickAdd = useCallback(async (parsed: QuickAddParse) => {
    await createTask({
      title: parsed.title,
      type: parsed.level,
      orgId: parsed.orgId,
      dueDate: parsed.dueDate,
      ...(parsed.priority ? { priority: parsed.priority } : {}),
    })
  }, [createTask])

  // Same contract for the board composer: it stays open with the title intact
  // when this rejects.
  const handleColumnAdd = useCallback(async (status: string, title: string) => {
    await createTask({
      title,
      status,
      orgId: filterOrgId,
      type: filterOrgId ? 'internal_client_task' : 'tahi_internal',
    })
    showToast(`Added to ${TASK_STATUS_LABELS[status] ?? status}`)
  }, [createTask, filterOrgId, showToast])

  const handleCreate = useCallback(async (draft: NewTaskDraft) => {
    let id: string | null = null
    try {
      id = await createTask({
        title: draft.title,
        type: draft.type,
        orgId: draft.orgId,
        requestId: draft.requestId,
        description: draft.description,
        status: draft.status,
        priority: draft.priority,
        assigneeId: draft.assigneeId,
        dueDate: draft.dueDate,
        estimatedHours: draft.estimatedHours,
        subtasks: draft.subtasks,
      })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the task', 'error')
      throw err
    }
    showToast('Task created')
    if (id) selectTask(id)
  }, [createTask, showToast, selectTask])

  const handleDuplicate = useCallback(async (taskId: string) => {
    const source = tasks.find(t => t.id === taskId) ?? (selectedTask?.id === taskId ? selectedTask : null)
    if (!source) return
    // A copy carries the checklist, which the row summary does not hold.
    let subtaskTitles: string[] = []
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks`))
      if (res.ok) {
        const data = await res.json() as SubtasksPayload
        subtaskTitles = (data.subtasks ?? []).map(s => s.title)
      }
    } catch {
      // A copy without the checklist still beats no copy.
    }
    try {
      const id = await createTask({
        title: `${source.title} (copy)`,
        type: source.type,
        orgId: source.orgId,
        requestId: source.requestId,
        description: source.description,
        status: 'todo',
        priority: source.priority,
        assigneeId: source.assigneeId,
        dueDate: source.dueDate,
        estimatedHours: source.estimatedHours,
        subtasks: subtaskTitles,
      })
      showToast('Task duplicated')
      if (id) selectTask(id)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not duplicate the task', 'error')
    }
  }, [tasks, selectedTask, createTask, showToast, selectTask])

  // Rejecting keeps the confirm open, which is the panel's contract for both
  // of the next two.
  const handleDelete = useCallback(async (taskId: string) => {
    const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`), { method: 'DELETE' })
    if (!res.ok) {
      showToast(await readError(res), 'error')
      throw new Error('Delete failed')
    }
    selectTask(null)
    await mutateTasks()
    showToast('Task deleted')
  }, [mutateTasks, selectTask, showToast])

  const handlePromote = useCallback(async (
    taskId: string,
    input: { category: string; size: 'small_task' | 'large_task' },
  ) => {
    const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/promote`), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ category: input.category, size: input.size }),
    })
    if (!res.ok) {
      showToast(await readError(res), 'error')
      throw new Error('Promote failed')
    }
    // The request list feeds the panel's own reference chip, so it has to know
    // about the new row before the banner can print its number.
    await Promise.all([mutateTasks(), mutateRequests()])
    void mutateKey(`/api/admin/tasks/${taskId}`)
    showToast('Request created from this task')
  }, [mutateTasks, mutateRequests, mutateKey, showToast])

  // ── Subtask writes ─────────────────────────────────────────────────────────

  // Idempotent by construction: it refetches and replaces. The list calls it
  // on the first expand of a row AND again after every successful add.
  const handleExpandRow = useCallback((taskId: string) => {
    void loadSubtasks(taskId)
  }, [loadSubtasks])

  // Rejects on purpose: both callers keep the draft in the field and toast.
  const handleAddSubtask = useCallback(async (taskId: string, title: string) => {
    const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks`), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(await readError(res))
    await loadSubtasks(taskId)
    void mutateTasks()
  }, [loadSubtasks, mutateTasks])

  const handleToggleSubtask = useCallback(async (taskId: string, subtaskId: string, completed: boolean) => {
    setSubtasksByTask(current => {
      const list = current[taskId]
      if (!list) return current
      return { ...current, [taskId]: list.map(s => (s.id === subtaskId ? { ...s, completed } : s)) }
    })
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks/${subtaskId}`), {
        method: 'PATCH',
        headers: JSON_HEADERS,
        // The route validates `isCompleted`; sending `completed` silently 400s.
        body: JSON.stringify({ isCompleted: completed }),
      })
      if (!res.ok) throw new Error(await readError(res))
      void mutateTasks()
    } catch {
      showToast('That did not save. Try again.', 'error')
      void loadSubtasks(taskId)
    }
  }, [mutateTasks, loadSubtasks, showToast])

  const handleDeleteSubtask = useCallback(async (taskId: string, subtaskId: string) => {
    setSubtasksByTask(current => {
      const list = current[taskId]
      if (!list) return current
      return { ...current, [taskId]: list.filter(s => s.id !== subtaskId) }
    })
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks/${subtaskId}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readError(res))
      void mutateTasks()
    } catch {
      showToast('Could not remove that checklist item', 'error')
      void loadSubtasks(taskId)
    }
  }, [mutateTasks, loadSubtasks, showToast])

  const handleRemoveSubtask = useCallback((taskId: string, subtaskId: string) => {
    void handleDeleteSubtask(taskId, subtaskId)
  }, [handleDeleteSubtask])

  // ── Blocker writes ─────────────────────────────────────────────────────────

  // Rejects with the route's own sentence, which is how the panel tells a loop
  // from a duplicate from a plain failure without matching on substrings.
  const handleAddBlocker = useCallback(async (
    taskId: string,
    blocker: { type: BlockerSubjectType; id: string },
  ) => {
    const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/blockers`), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ blockerType: blocker.type, blockerId: blocker.id }),
    })
    if (!res.ok) throw new Error(await readError(res))
    // Both, always: the card's list and the row's count must not disagree.
    await mutateDeps()
    void mutateTasks()
  }, [mutateDeps, mutateTasks])

  const handleRemoveBlocker = useCallback(async (taskId: string, linkId: string) => {
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/blockers/${linkId}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readError(res))
      await mutateDeps()
      void mutateTasks()
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'Could not remove that blocker', 'error')
    }
  }, [mutateDeps, mutateTasks, showToast])

  // ── Bulk ───────────────────────────────────────────────────────────────────

  // Throwing gives BulkActionBar its error toast; the returned pair gives it
  // an honest count, because the route reports the rows it actually reached.
  const runBulk = useCallback(async (ids: string[], updates: Record<string, unknown>) => {
    const res = await fetch(apiPath('/api/admin/tasks/bulk'), {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ taskIds: ids, updates }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const data = await res.json() as { updatedCount?: number }
    const ok = data.updatedCount ?? 0
    await mutateTasks()
    return { ok, failed: Math.max(0, ids.length - ok) }
  }, [mutateTasks])

  const handleBulkStatus = useCallback(
    (ids: string[], status: string) => runBulk(ids, { status }),
    [runBulk],
  )
  const handleBulkPriority = useCallback(
    (ids: string[], priority: string) => runBulk(ids, { priority }),
    [runBulk],
  )
  const handleBulkAssignee = useCallback(
    (ids: string[], assigneeId: string | null) => runBulk(ids, { assigneeId }),
    [runBulk],
  )
  const handleBulkDueDate = useCallback(
    (ids: string[], dueDate: string | null) => runBulk(ids, { dueDate }),
    [runBulk],
  )

  // ── Header actions ─────────────────────────────────────────────────────────

  // One dialog, two entry points. There is deliberately no third piece of
  // state for a starting status: KanbanBoard's composer writes its own
  // column through onQuickAdd and never asks for the full form, so a
  // `dialogStatus` here would be state nothing could ever set.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTemplateId, setDialogTemplateId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const openNewTask = useCallback(() => {
    setDialogTemplateId(null)
    setDialogOpen(true)
  }, [])

  const openFromTemplate = useCallback((templateId: string) => {
    setDialogTemplateId(templateId)
    setDialogOpen(true)
  }, [])

  // Exports what is on screen, not everything loaded: the menu sits above a
  // filtered list, and exporting something else is the wrong answer. In My
  // week that is the planner's own plate, not the rail-filtered set, because
  // the planner ignores the rail and the toolbar count already says so.
  const exportRows = railInert ? weekRows : visible

  // The BOM is what makes Excel open a UTF-8 CSV without mangling a client
  // name.
  const exportCsv = useCallback(() => {
    const header = ['Title', 'Level', 'Client', 'Status', 'Priority', 'Assignee', 'Due', 'Estimate']
    const lines = exportRows.map(t => [
      t.title,
      TASK_LEVEL_LABELS[levelOf(t)] ?? '',
      t.orgName ?? '',
      TASK_STATUS_LABELS[t.status] ?? t.status,
      taskPriorityLabel(t.priority),
      (t.assigneeId && people[t.assigneeId]?.name) || '',
      t.dueDate ?? '',
      t.estimatedHours == null ? '' : String(t.estimatedHours),
    ])
    const csv = [header, ...lines].map(row => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`${CSV_BOM}${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `tahi-tasks-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    showToast(`Exported ${exportRows.length} ${exportRows.length === 1 ? 'task' : 'tasks'}`)
  }, [exportRows, people, showToast])

  // ── Views ──────────────────────────────────────────────────────────────────

  const hasFilter = anyTaskFilterActive(rail.filters) || !!rail.savedView || !!rail.query.trim()

  const railProps = {
    savedView: rail.savedView,
    onSavedViewChange: rail.setSavedView,
    counts,
    filters: rail.filters,
    onFiltersChange: rail.setFilters,
    sort: rail.sort,
    onSortChange: rail.setSort,
    clientOptions: railClientOptions,
    assigneeOptions: railAssigneeOptions,
    isDefault: rail.isDefault,
    onSaveDefault: rail.saveDefault,
    // My week deliberately ignores the rail; the note that used to explain this
    // was removed at Liam's request (2026-09-06), the inert controls say it.
    note: undefined,
  }

  // The board and the week planner have no loading prop of their own, so the
  // shell holds a skeleton for them. The list takes `booting` instead: its
  // own row skeleton is the better one and it already knew how to draw it.
  const boardBody = booting ? (
    <TasksViewSkeleton variant="board" />
  ) : (
    <TasksBoard
      rows={visible}
      people={people}
      requestNumbers={requestNumbers}
      readOnly={readOnly}
      onMove={handleMove}
      onQuickAdd={handleColumnAdd}
      onOpenTask={selectTask}
    />
  )

  const weekBody = booting ? (
    <TasksViewSkeleton variant="week" />
  ) : (
    <TasksWeek
      allRows={tasks}
      meId={meId}
      people={people}
      requests={requestOptions}
      showAssignee={false}
      readOnly={readOnly}
      onPlan={handlePlan}
      onToggleDone={handleToggleDone}
      onOpenTask={selectTask}
      onOpenRequest={openRequest}
    />
  )

  const listBody = (
    <TasksList
      rows={visible}
      loading={booting}
      people={people}
      peopleList={peopleList}
      clients={clients}
      readOnly={readOnly}
      subtasks={subtasksByTask}
      onExpandRow={handleExpandRow}
      onOpenTask={selectTask}
      onOpenRequest={openRequest}
      onToggleDone={handleToggleDone}
      onStatusChange={handleStatusChange}
      onToggleSubtask={handleToggleSubtask}
      onAddSubtask={handleAddSubtask}
      onRemoveSubtask={handleRemoveSubtask}
      onQuickAdd={handleQuickAdd}
      onBulkStatus={handleBulkStatus}
      onBulkPriority={handleBulkPriority}
      onBulkAssignee={handleBulkAssignee}
      onBulkDueDate={handleBulkDueDate}
      hasFilter={hasFilter}
      onClearFilters={clearAllFilters}
      onNewTask={openNewTask}
    />
  )

  const body = rail.view === 'board' ? boardBody : rail.view === 'week' ? weekBody : listBody

  return (
    <>
      <NewTaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initialOrgId={filterOrgId}
        initialTemplateId={dialogTemplateId}
        clients={clients}
        peopleList={peopleList}
        requests={requestOptions}
        templates={templates}
        onCreate={handleCreate}
      />

      <TaskDetailPanel
        open={!!selectedTaskId}
        onClose={() => selectTask(null)}
        task={selectedTask}
        loading={detailLoading}
        readOnly={readOnly}
        clients={clients}
        peopleList={peopleList}
        people={people}
        requests={requestOptions}
        subtasks={selectedTaskId ? subtasksByTask[selectedTaskId] : undefined}
        blockedBy={blockedBy}
        onSearchBlockers={handleSearchBlockers}
        onPatch={handlePatch}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onPromote={handlePromote}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onDeleteSubtask={handleDeleteSubtask}
        onAddBlocker={handleAddBlocker}
        onRemoveBlocker={handleRemoveBlocker}
        onOpenTask={selectTask}
        onOpenRequest={openRequest}
      />

      {wizardOpen && (
        <AiTaskWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          context={filterOrgId ? { orgId: filterOrgId } : undefined}
          mutateKeys={[TASKS_KEY]}
          onTasksCreated={() => showToast('Tasks created')}
        />
      )}

      <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <PageHeader
          title="Tasks"
          // The count lives in the toolbar row a few rem below, with its own
          // aria-live, so the subtitle is free to say what this page is for.
          subtitle="The studio's own to-do list: emails, chasers, prep, housekeeping. Sometimes for a client, sometimes not."
        >
          <TasksHeaderActions
            readOnly={readOnly}
            templates={templates}
            onNew={openNewTask}
            onAiWizard={() => setWizardOpen(true)}
            onNewFromTemplate={openFromTemplate}
            onExportCsv={exportCsv}
          />
        </PageHeader>

        <RailLayout
          rail={<TasksRail {...railProps} />}
          railTouch={<TasksRail {...railProps} touch />}
          switcher={<TasksViewSwitcher value={rail.view} onChange={rail.setView} />}
          chips={railInert ? NO_CHIPS : chips}
          onClearChip={chip => rail.setFilters({
            ...rail.filters,
            [chip.key]: DEFAULT_TASK_FILTERS[chip.key as TaskFilterKey],
          })}
          onClearAll={clearAllFilters}
          // Only offered once there is a saved default to go back to and the
          // view has actually wandered off it.
          onResetDefault={rail.hasDefault && !rail.isDefault ? rail.resetToDefault : undefined}
          query={rail.query}
          onQueryChange={rail.setQuery}
          searchPlaceholder="Search tasks or clients"
          total={railInert ? weekCount : visible.length}
          itemNoun="task"
          loading={booting}
          extraActiveCount={railInert || !rail.savedView ? 0 : 1}
          saveDefaultTouch={
            <SaveDefaultControl isDefault={rail.isDefault} onSave={rail.saveDefault} touch />
          }
        >
          {/* The region the view switcher swaps, named so its tabs can point
              at it. The Requests switcher documents this as open work because
              there the swapped region lives in a 3000 line page; here it is
              three lines away. */}
          <div role="tabpanel" id={TASKS_VIEW_PANEL_ID} tabIndex={0} className="tahi-focus-ring">
            {body}
          </div>
        </RailLayout>
      </div>
    </>
  )
}
