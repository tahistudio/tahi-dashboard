import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/**
 * The dev-only Ship Studio auth bypass, as a storageState. Six specs had
 * this block copy-pasted verbatim; it resolves to the Tahi admin org, which
 * is what every admin-surface spec needs.
 */
export const shipStudioStorageState = {
  cookies: [
    {
      name: 'tahi-ship-studio',
      value: '1',
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    },
  ],
  origins: [],
}

/**
 * Definition-of-Done check: nothing may scroll the page sideways. Run it at
 * 375px on every surface that ships.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(1)
}

/** True on the mobile-safari project, where tables become card lists. */
export async function isNarrow(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) < 768
}

/**
 * True when the desktop rail is really on screen.
 *
 * RailLayout's aside is `hidden lg:block` and the Filters button that stands
 * in for it is `lg:hidden`, so the two swap at 1024px, not at the 768px
 * `isNarrow` answers for. A rail case gated on `isNarrow` runs against a
 * display:none aside anywhere between the two, which is out of the
 * accessibility tree and matches nothing. Gate those on the rail's own
 * breakpoint and leave `isNarrow` to the table-versus-cards question its
 * docstring describes.
 */
export async function railIsOnScreen(page: Page): Promise<boolean> {
  return (await page.evaluate(() => window.innerWidth)) >= 1024
}

/**
 * An active filter chip in the toolbar's chip strip.
 *
 * Two controls carry the accessible name "Clear the <dimension> filter" once
 * a filter is set at desktop width: the rail select's own clear button
 * (components/tahi/rail/rail-controls.tsx) and the chip's
 * (components/tahi/rail/rail-layout.tsx). The rail comes first in DOM order,
 * so a bare `getByRole(...).first()` resolves to the select and the chip
 * strip goes unasserted. Only the chip wraps its clear button in a span,
 * which is what this scopes on, so an assertion that says chip means chip.
 */
export function filterChip(page: Page, dimension: string): Locator {
  return page.locator('span').filter({
    has: page.getByRole('button', { name: `Clear the ${dimension} filter` }),
  })
}

/**
 * HTML5 drag and drop, the recipe from the Playwright docs.
 *
 * The Tasks board and the My week planner both move work with native
 * dragstart / dragover / drop, which mouse movement alone does not raise in a
 * headless browser. One DataTransfer travels through every event, so the
 * payload the source writes is the payload the target reads, and the drop
 * lands even if the React state the source set has not flushed yet.
 *
 * Dispatch on the container, never on a card inside it: a card's own drop
 * handler stops the event before the column's ever sees it.
 */
export async function html5DragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  try {
    await source.dispatchEvent('dragstart', { dataTransfer })
    await target.dispatchEvent('dragover', { dataTransfer })
    await target.dispatchEvent('drop', { dataTransfer })
  } finally {
    await dataTransfer.dispose()
  }
}

/**
 * Shared e2e page priming.
 *
 * A fresh browser context looks like a first visit, so the product tour
 * (components/tahi/product-tour.tsx) opens its spotlight over the page and
 * intercepts every click and Tab press. Marking the tour complete before
 * navigation keeps specs honest about the surface they test rather than
 * the onboarding overlay. Origin-agnostic, so it works against any port.
 */
export async function primePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tahi-tour-complete', '1')
      localStorage.setItem('tahi-tour-seen', '1')
    } catch {
      // Storage can be unavailable in some contexts; the tour then shows.
    }
  })
}

// ── Rail cards ───────────────────────────────────────────────────────────────
//
// SidebarCard draws a head (icon, title, count) and a body as its next
// sibling. Neither carries a role of its own, so both are reached through the
// one thing that does: the card's h3. Shared, because the Waiting on card on a
// task and the Blocked by card on a request are the same component.

/** The head row of a rail card: the icon, the title, and the count beside it. */
export function railCardHead(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('heading', { name: title, exact: true }).locator('..')
}

/** The card's body, which SidebarCard renders as the head's next sibling. */
export function railCardBody(scope: Page | Locator, title: string): Locator {
  return railCardHead(scope, title).locator('xpath=following-sibling::div[1]')
}

/** The number in a card's head, asserted as the whole string rather than as a
 *  substring: `toContainText('1')` is also satisfied by 12. */
export async function expectCardCount(head: Locator, title: string, count: number): Promise<void> {
  await expect(head, `the ${title} card should count ${count}`)
    .toHaveText(new RegExp(`${title}\\s*${count}$`), { timeout: 20_000 })
}

// ── API fixtures ─────────────────────────────────────────────────────────────
//
// Every spec that needs a row builds it through the API and deletes it again,
// so a fresh database does not turn into a red suite and a run leaves nothing
// behind. The task pair lived in e2e/tasks.spec.ts until the blocker cases
// needed the same fixtures from the two Requests specs; one definition rather
// than three copies that drift on the day a route changes shape.

/** The fields these specs read back off the server. */
export interface TaskRecord {
  id: string
  type: string
  orgId: string | null
  title: string
  status: string
  priority: string
  dueDate: string | null
  assigneeId: string | null
}

export interface NewTask {
  title: string
  type?: string
  orgId?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  estimatedHours?: number
  assigneeId?: string | null
  assigneeType?: string | null
}

/** Create a task. Tahi-internal and undated unless the case says otherwise,
 *  so the write needs no client. */
export async function createTask(request: APIRequestContext, task: NewTask): Promise<string> {
  const res = await request.post('/api/admin/tasks', {
    data: { type: 'tahi_internal', priority: 'standard', status: 'todo', ...task },
  })
  expect(res.status(), 'the task fixture could not be created').toBe(201)
  const { id } = await res.json() as { id: string }
  return id
}

/** Soft, because every call site is inside a `finally` and the failure that
 *  sent it there is the one worth reporting. It is still said out loud: a
 *  leaked fixture is exactly what pushes the lens past its first page. */
export async function deleteTask(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/admin/tasks/${id}`)
  expect.soft(res.ok(), `the task fixture ${id} was not cleaned up`).toBeTruthy()
}

export async function getTask(request: APIRequestContext, id: string): Promise<TaskRecord> {
  const res = await request.get(`/api/admin/tasks/${id}`)
  expect(res.ok(), `the task ${id} could not be read back`).toBeTruthy()
  const { task } = await res.json() as { task: TaskRecord }
  return task
}

/** The fields the request specs read back off the server. */
export interface RequestRecord {
  id: string
  title: string
  type: string
  category: string
  orgId: string | null
  status: string
  priority: string
  dueDate: string | null
  estimatedHours: number | null
}

/** Soft for the same reason deleteTask is: every call site is in a `finally`
 *  and the failure that sent it there is the one worth reporting. */
export async function deleteRequest(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/admin/requests/${id}`)
  expect.soft(res.ok(), `the request fixture ${id} was not cleaned up`).toBeTruthy()
}

export async function getRequest(request: APIRequestContext, id: string): Promise<RequestRecord> {
  const res = await request.get(`/api/admin/requests/${id}`)
  expect(res.ok(), `the request ${id} could not be read back`).toBeTruthy()
  const { request: row } = await res.json() as { request: RequestRecord }
  return row
}

// ── Blockers ─────────────────────────────────────────────────────────────────

export type BlockerSubjectType = 'task' | 'request'

export interface BlockerSubject {
  type: BlockerSubjectType
  id: string
}

/** One row of GET /api/admin/<subject>/blockers, in either direction. */
export interface BlockerRow {
  linkId: string
  otherType: BlockerSubjectType
  otherId: string
  otherTitle: string
  otherStatus: string
  otherRef: string | null
  otherOrgName: string | null
}

/** The two blocker routes are siblings under their own subject, which is the
 *  whole point of the polymorphic table: one shape, two doors. */
function blockersPath(subject: BlockerSubject): string {
  return subject.type === 'task'
    ? `/api/admin/tasks/${subject.id}/blockers`
    : `/api/admin/requests/${subject.id}/blockers`
}

/** "subject is blocked by blocker". Returns the link id, which is what a
 *  removal needs and what a `finally` has to hold on to. */
export async function addBlocker(
  request: APIRequestContext,
  subject: BlockerSubject,
  blocker: BlockerSubject,
): Promise<string> {
  const res = await request.post(blockersPath(subject), {
    data: { blockerType: blocker.type, blockerId: blocker.id },
  })
  expect(res.status(), 'the blocker fixture could not be created').toBe(201)
  const { id } = await res.json() as { id: string }
  return id
}

/** Soft for the reason deleteTask is. Deleting a task fixture sweeps its links
 *  away with it, so this only carries weight when the near end is a seeded
 *  request that has to survive the run unchanged. */
export async function removeBlocker(
  request: APIRequestContext,
  subject: BlockerSubject,
  linkId: string,
): Promise<void> {
  const res = await request.delete(`${blockersPath(subject)}/${linkId}`)
  expect.soft(res.ok(), `the blocker link ${linkId} was not cleaned up`).toBeTruthy()
}

export async function listBlockers(
  request: APIRequestContext,
  subject: BlockerSubject,
): Promise<{ blockedBy: BlockerRow[]; blocks: BlockerRow[] }> {
  const res = await request.get(blockersPath(subject))
  expect(res.ok(), 'the blocker list could not be read').toBeTruthy()
  return await res.json() as { blockedBy: BlockerRow[]; blocks: BlockerRow[] }
}

/** The fields a blocker case reads off a request. */
export interface RequestSummary {
  id: string
  orgId: string
  title: string
  status: string
  requestNumber: number | null
  blockedByCount?: number
}

export async function listRequests(request: APIRequestContext): Promise<RequestSummary[]> {
  const res = await request.get('/api/admin/requests')
  expect(res.ok(), 'the request list could not be read').toBeTruthy()
  const { requests } = await res.json() as { requests: RequestSummary[] }
  return requests
}

/** lib/blockers.ts `requestRef`, restated rather than imported: a spec should
 *  assert the string a human reads, not re-run the function that produced it. */
export function requestRef(requestNumber: number | null): string | null {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : null
}

/**
 * A request a blocker case can name on screen.
 *
 * Four requirements, and each one is a case that failed without it: open (so
 * it counts as a blocker and so the picker offers it at all), numbered (so the
 * row shows a `#042` ref rather than nothing), on the delivery pipeline (so
 * the spine and therefore its amber chip render instead of the off-pipeline
 * note), and uniquely titled (the seeded dataset holds three requests called
 * "retret", and an assertion on that title proves nothing).
 *
 * Null when the dataset offers none, which is a skip rather than a failure.
 *
 * `skip` is how two spec FILES avoid each other. The suite runs fully in
 * parallel, so a case that blocks the first candidate and asserts "Blocked by
 * 1" reads 2 the moment another file blocks the same row: that is exactly how
 * this helper's first version failed.
 *
 * The invariant is per DIRECTION, not per file. Two files may share an index
 * only while one writes `blockedBy` on the row and the other writes `blocks`:
 * a request that is a task's blocker gains no `blockedByCount` of its own, so
 * the count the other file asserts is untouched. Any case that blocks a
 * seeded request needs an index nobody else blocks, and every call site says
 * its index out loud. There is no default on purpose: a default one file
 * leans on is a default the next case inherits by accident, and the collision
 * that follows is silent.
 *
 * The candidates are sorted by id before they are indexed. The list route
 * orders by `updatedAt desc`, so without this the partition is a snapshot of
 * a sort order that any concurrent write reshuffles, and file A's index 0
 * resolves to file B's index 1: the shared-subject flake this helper exists
 * to kill, wearing a different hat.
 */
export function pickPipelineRequest(
  rows: readonly RequestSummary[],
  skip: number,
): RequestSummary | null {
  const pipeline = ['submitted', 'in_review', 'in_progress', 'client_review']
  const titles = rows.map(r => r.title)
  const candidates = rows
    .filter(r =>
      r.requestNumber != null &&
      pipeline.includes(r.status) &&
      titles.filter(t => t === r.title).length === 1)
    .sort((a, b) => a.id.localeCompare(b.id))
  return candidates[skip] ?? null
}
