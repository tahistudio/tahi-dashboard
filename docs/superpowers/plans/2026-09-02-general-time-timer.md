# General-Time Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin start the top-nav timer with no request, task, or client selected ("None, general requests time"), and have that time log against one hidden internal "Tahi Studio" organisation.

**Architecture:** No schema change. One organisation row with a fixed id and `status = 'internal'` is created idempotently on first use. The timers API accepts a `general` kind, stores the timer against the internal org, and reports it as `targetType: 'general'`. The clients list API excludes internal orgs unless asked. The TimerChip gains a "None" row at the top of each picker list. The worker MCP `start_timer` tool mirrors the API.

**Tech Stack:** Next.js App Router API routes, Drizzle on D1, Vitest for pure helpers, existing `components/tahi/timer-chip.tsx`.

**Approved by Liam 2026-09-02:** internal org row over a `time_entries.org_id` schema rebuild.

---

### Task 1: Internal org helper and pure timer helpers

**Files:**
- Create: `lib/internal-org.ts`
- Modify: `lib/timer-helpers.ts`
- Test: `lib/timer-helpers.test.ts` (new)

- [x] **Step 1: Write the failing tests**

```ts
// lib/timer-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { isGeneralTimer, generalTimerNotes, GENERAL_KINDS } from './timer-helpers'
import { INTERNAL_ORG_ID } from './internal-org'

describe('generalTimerNotes', () => {
  it('labels each general kind in plain words', () => {
    expect(generalTimerNotes('request')).toBe('General requests time')
    expect(generalTimerNotes('task')).toBe('General tasks time')
    expect(generalTimerNotes('client')).toBe('General client time')
  })
  it('lists exactly the three kinds the picker offers', () => {
    expect(GENERAL_KINDS).toEqual(['request', 'task', 'client'])
  })
})

describe('isGeneralTimer', () => {
  it('is true only when the timer points at the internal org and nothing else', () => {
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: INTERNAL_ORG_ID })).toBe(true)
    expect(isGeneralTimer({ requestId: 'r1', taskId: null, orgId: INTERNAL_ORG_ID })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: 'some-client' })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: null })).toBe(false)
  })
})
```

- [x] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run lib/timer-helpers.test.ts`
Expected: FAIL, `isGeneralTimer` and `./internal-org` not found.

- [x] **Step 3: Create `lib/internal-org.ts`**

```ts
/**
 * lib/internal-org.ts
 *
 * The one hidden organisation that general (no client) time logs against.
 * time_entries.org_id is NOT NULL, so studio-internal time needs an org
 * row. This row has status 'internal': the clients list excludes it by
 * default, it never gets a Clerk org, and it never appears in the portal.
 * Created idempotently on first use; the fixed id keeps it stable across
 * environments.
 */
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { drizzle as drizzleFn } from 'drizzle-orm/d1'

type Drizzle = ReturnType<typeof drizzleFn>

export const INTERNAL_ORG_ID = 'org_tahi_internal'
export const INTERNAL_ORG_NAME = 'Tahi Studio (internal)'
export const INTERNAL_ORG_STATUS = 'internal'

export async function ensureInternalOrg(drizzle: Drizzle): Promise<string> {
  const [existing] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, INTERNAL_ORG_ID))
    .limit(1)
  if (existing) return INTERNAL_ORG_ID
  const now = new Date().toISOString()
  await drizzle.insert(schema.organisations).values({
    id: INTERNAL_ORG_ID,
    name: INTERNAL_ORG_NAME,
    status: INTERNAL_ORG_STATUS,
    planType: 'none',
    healthStatus: 'green',
    createdAt: now,
    updatedAt: now,
  })
  return INTERNAL_ORG_ID
}
```

Check `db/schema.ts` for the exact required columns on `organisations` (the `timestamps` spread names) and adjust the insert so `npm run type-check` passes. Do not add columns that are not required.

- [x] **Step 4: Add the pure helpers to `lib/timer-helpers.ts`**

```ts
import { INTERNAL_ORG_ID } from '@/lib/internal-org'

export const GENERAL_KINDS = ['request', 'task', 'client'] as const
export type GeneralKind = (typeof GENERAL_KINDS)[number]

const GENERAL_LABELS: Record<GeneralKind, string> = {
  request: 'General requests time',
  task: 'General tasks time',
  client: 'General client time',
}

export function generalTimerNotes(kind: GeneralKind): string {
  return GENERAL_LABELS[kind]
}

export function isGeneralTimer(t: { requestId: string | null; taskId: string | null; orgId: string | null }): boolean {
  return !t.requestId && !t.taskId && t.orgId === INTERNAL_ORG_ID
}
```

Keep these above `stopAndLogTimer`. `stopAndLogTimer` needs no change: a general timer carries `orgId = INTERNAL_ORG_ID`, so the time entry logs against the internal org.

- [x] **Step 5: Run the tests**

Run: `npx vitest run lib/timer-helpers.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 6: Commit**

```bash
git add lib/internal-org.ts lib/timer-helpers.ts lib/timer-helpers.test.ts
git commit -m "feat(time): internal org + general-timer helpers"
```

---

### Task 2: Timers API accepts a general kind

**Files:**
- Modify: `app/api/admin/timers/route.ts`

- [x] **Step 1: Extend the POST body type and validation**

Replace the body type and the "exactly one" check with:

```ts
  const body = await req.json().catch(() => null) as {
    requestId?: string | null
    taskId?: string | null
    orgId?: string | null
    general?: GeneralKind | null
    notes?: string | null
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Body required' }, { status: 400 })
  }
  if (body.general && !GENERAL_KINDS.includes(body.general)) {
    return NextResponse.json({ error: 'general must be request, task, or client' }, { status: 400 })
  }
  const targetCount = [body.requestId, body.taskId, body.orgId, body.general].filter(Boolean).length
  if (targetCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of requestId, taskId, orgId, or general required' }, { status: 400 })
  }
```

Import `GENERAL_KINDS`, `generalTimerNotes`, `isGeneralTimer` and `type GeneralKind` from `@/lib/timer-helpers`, and `ensureInternalOrg` from `@/lib/internal-org`.

- [x] **Step 2: Resolve the general target**

After the `else if (body.orgId) { ... }` block add:

```ts
  } else if (body.general) {
    targetOrgId = await ensureInternalOrg(drizzle)
  }
```

In the `insert(schema.activeTimers).values({...})` call, change `orgId: body.orgId ?? null` to `orgId: body.general ? targetOrgId : (body.orgId ?? null)` and `notes: body.notes ?? null` to `notes: body.general ? generalTimerNotes(body.general) : (body.notes ?? null)`.

- [x] **Step 3: Report general timers on GET**

In the GET handler, before the `if (timer.requestId)` chain, widen the type and add the general branch:

```ts
  let targetType: 'request' | 'task' | 'org' | 'general' = 'request'
  if (isGeneralTimer(timer)) {
    targetTitle = timer.notes ?? 'General time'
    targetType = 'general'
  } else if (timer.requestId) {
```

- [x] **Step 4: Type-check and lint**

Run: `npm run type-check` then `npm run lint`
Expected: zero errors for both.

- [x] **Step 5: Commit**

```bash
git add app/api/admin/timers/route.ts
git commit -m "feat(time): timers API accepts general (no client) timers"
```

---

### Task 3: Clients list hides the internal org

**Files:**
- Modify: `app/api/admin/clients/route.ts:55-67`

- [x] **Step 1: Add the exclusion**

After the prospects exclusion block add:

```ts
  // The internal studio org exists only so general time has somewhere to
  // log. Never a client; excluded unless explicitly requested.
  if (status !== INTERNAL_ORG_STATUS) {
    conditions.push(ne(schema.organisations.status, INTERNAL_ORG_STATUS))
  }
```

Import `INTERNAL_ORG_STATUS` from `@/lib/internal-org`.

- [x] **Step 2: Type-check, lint, commit**

Run: `npm run type-check && npm run lint`
Expected: zero errors.

```bash
git add app/api/admin/clients/route.ts
git commit -m "fix(clients): hide the internal studio org from client lists"
```

---

### Task 4: TimerChip "None" row

**Files:**
- Modify: `components/tahi/timer-chip.tsx`

- [x] **Step 1: Extend `startTimer` to accept a general start**

Change the signature to `async function startTimer(source: TimerSource, id: string | null, confirmed = false)` and the body construction to:

```ts
      const body =
        id === null ? { general: source === 'client' ? 'client' : source } :
        source === 'request' ? { requestId: id } :
        source === 'task' ? { taskId: id } :
        { orgId: id }
```

- [x] **Step 2: Render the None row first in the picker list**

In the picker's results block, before the `items.slice(0, 40).map(...)`, render one extra row that is always present, even while loading or with no matches, and only when the search query is empty:

```tsx
        {!query && (
          <button
            type="button"
            role="listitem"
            className={'tt-opt tt-opt-none' + (acting && startingId === '__general' ? ' on' : '')}
            onClick={() => { setStartingId('__general'); onPick(null) }}
            disabled={acting}
          >
            <span className="tt-opt-r" aria-hidden="true" />
            <span className="tt-opt-t">
              None, general {source === 'request' ? 'requests' : source === 'task' ? 'tasks' : 'client'} time
            </span>
          </button>
        )}
```

Update the `onPick` prop type to `(id: string | null) => void` and the parent call to `onPick={id => void startTimer(pickerSource, id)}`. Move the empty-state `tt-empty` so it renders below the None row when there are no items.

- [x] **Step 3: Active readout**

Where the active state renders `timer.targetTitle`, no change is needed: the API returns the general label as `targetTitle`. Where the readout links to the request page (`ExternalLink`), guard it so a general timer shows no jump link: `timer.targetType !== 'general' && timer.requestId && (...)`. Add `'general'` to the `targetType` union in `ActiveTimerResponse`.

- [x] **Step 4: Style**

The None row uses the existing `.tt-opt` styles. Add one rule to `app/(dashboard)/app-shell.css` next to the other `.tt-opt` rules: `.tt-opt-none .tt-opt-t { color: var(--text-muted); font-style: italic; }`. Nothing else.

- [x] **Step 5: Type-check, lint, commit**

Run: `npm run type-check && npm run lint`
Expected: zero errors.

```bash
git add components/tahi/timer-chip.tsx "app/(dashboard)/app-shell.css"
git commit -m "feat(time): None row in the timer picker for general time"
```

---

### Task 5: Worker MCP parity

**Files:**
- Modify: `workers/mcp-server/src/index.ts` (the `start_timer` tool definition near line 1361 and its handler near line 2341)

- [x] **Step 1: Extend the tool schema**

Add to the `start_timer` input schema a `general` property: `z.enum(['request', 'task', 'client']).optional().describe('Start a general timer with no request, task, or client. Time logs against the internal studio org.')` (match the schema style the file already uses, zod or JSON schema). Update the description to "Exactly one of requestId / taskId / orgId / general."

- [x] **Step 2: Handler**

The handler already forwards the whole body, so `general` passes through unchanged. Confirm by reading it. No code change unless the body is filtered.

- [x] **Step 3: Type-check the worker**

Run: `cd workers/mcp-server && npx tsc --noEmit` (or the worker's own check script if `package.json` defines one).
Expected: zero errors.

- [x] **Step 4: Commit**

```bash
git add workers/mcp-server/src/index.ts
git commit -m "feat(mcp): start_timer accepts general"
```

---

## Verification after all tasks

1. `npm run type-check`, `npm run lint`, `npx vitest run lib/timer-helpers.test.ts` all clean.
2. `npm run build` passes (route files changed).
3. Do not push. The lead reviews, pushes, and runs the live smoke on staging: open the timer chip, pick Requests, click "None, general requests time", confirm the chip shows "General requests time", stop and log, confirm a time entry exists against "Tahi Studio (internal)" and that org is absent from /clients.
