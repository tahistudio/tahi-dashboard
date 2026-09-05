# Spec: Predictive autofill for empty request and task fields

Founder ask (2026-09-05). Scope: admin New Request dialog and New Task dialog. Fills only fields the operator left untouched, as clearly marked suggestions, and says nothing when context is thin.

## 0. Decisions taken up front

1. `DUE_DATE_DEFAULT_DAYS` and the `isoDatePlusDays(7)` prefill in `components/tahi/new-request-dialog.tsx` (:201, :382, :459, :600) are **removed**. Due date starts empty so a prediction has somewhere to land.
2. `app/api/admin/ai/suggest/route.ts` is **deleted** (zero consumers, emits an unstorable `urgent` priority). Its keyword tables move into the new heuristics module.
3. `parseForm` in `app/api/portal/request-forms/route.ts` (:97) is widened to return `sla` and `description`. `requestForms.sla` becomes the highest-precedence due-date rule.
4. Predicted fields: `dueDate`, `priority`, `estimatedHours`, `category` (request only), `size` (request only), `assigneeId`. Never `orgId`, `level`, `requestId`, `title`, `description`.

## 1. API

`POST /api/admin/ai/predict-fields` (new file `app/api/admin/ai/predict-fields/route.ts`). Admin gate via `getRequestAuth` + `isTahiAdmin`, then `requireAccessToOrg` when `orgId` is present.

Request body:

```ts
type PredictFieldsBody = {
  subject: 'request' | 'task'
  title: string
  description?: string          // plain text, caller strips HTML
  orgId?: string | null
  level?: TaskLevel             // tasks only
  category?: RequestCategory | null
  parentRequestId?: string | null
  filled: Record<string, unknown>   // fields the operator has touched or typed
  empty: PredictableField[]         // fields to predict, max 6
  todayIso: string                  // client local calendar date
}
```

Response (200 always, never 4xx for thin context):

```ts
type PredictFieldsResponse = {
  suggestions: Partial<Record<PredictableField, {
    value: string | number
    reason: string        // one short sentence, operator-facing
    confidence: number    // 0..1
  }>>
  degraded?: boolean
  reason?: 'thin_context' | 'ai_unavailable' | 'ai_rate_limited' | 'timeout'
}
```

**Threshold.** Any field scoring `< 0.6` is dropped server-side and never reaches the wire. An empty `suggestions` object is the normal answer, not an error.

**Minimum context rule.** Before any model call: `title.trim()` must have `>= 4` words and `>= 16` characters, and for `subject: 'request'` an `orgId` must be present (for `subject: 'task'`, an `orgId` or `level === 'tahi_internal'`). Otherwise return `{ suggestions: {}, reason: 'thin_context' }` immediately, no model call, no D1 read, no cost row.

**Grounding query.** Two statements inside one `Promise.all`, both bounded, run only after the minimum-context gate passes. Org cohort first, studio-wide as fallback when the org cohort has fewer than 5 rows:

```ts
const since = isoDaysAgo(180)
const rows = await database.all(sql`
  SELECT category,
         priority,
         assignee_id,
         estimated_hours,
         julianday(delivered_at) - julianday(created_at) AS turnaround_days
  FROM requests
  WHERE delivered_at IS NOT NULL
    AND created_at >= ${since}
    AND julianday(delivered_at) - julianday(created_at) >= 0
    ${orgId ? sql`AND org_id = ${orgId}` : sql``}
  ORDER BY delivered_at DESC
  LIMIT 200
`)
```

Tasks use the same shape against `tasks` with `completed_at` and `type = ${level}`. Median is computed in JS with the `median()` helper lifted out of `lib/calculator/compute.ts` into `lib/predict/stats.ts` (returns `null` on an empty cohort). **Cohort floor is 5**: below that for the org, fall through to the studio-wide cohort; below 5 there too, no statistical suggestion is emitted at all.

Add migration `0088_predict_indexes.sql`, `CREATE INDEX IF NOT EXISTS idx_requests_org_delivered ON requests(org_id, delivered_at)` and `idx_tasks_type_completed ON tasks(type, completed_at)`, mirrored into `app/api/admin/db/migrate/route.ts`, applied to staging then production before the code ships.

**Model.** `HAIKU_MODEL` from `lib/ai-models.ts`, `max_tokens: 500`, dynamic `@anthropic-ai/sdk` import, system prompt sent as a `cache_control: ephemeral` block.

**Prompt outline.** System block: role, the closed vocabularies (`REQUEST_CATEGORIES`, `REQUEST_PRIORITIES` for requests, `TASK_PRIORITIES` for tasks), the rule "only fill a field you can justify from the text or the studio facts; omit anything else; confidence is your own honesty, not a formality", and "OUTPUT: a single JSON object and nothing else". User block: title, description, client name and plan, category if chosen, the requested field list, `todayIso`, and a short **Studio facts** section rendered from the grounding: median turnaround days (org, then studio), median billed hours for this category from `timeEntries`, the client's category-to-assignee mode from `requestParticipants` where `role = 'assignee' AND removed_at IS NULL`, and the `requestForms.sla` string when one resolves.

**Parsing.** House pattern: strip fences, `indexOf('{')`..`lastIndexOf('}')`, `JSON.parse` in try/catch. Then validate hard, in `lib/predict/parse.ts`: priority against `isRequestPriority` or `TASK_PRIORITIES`, category against `REQUEST_CATEGORIES`, `assigneeId` against the real roster, `dueDate` against `/^\d{4}-\d{2}-\d{2}$/` and `>= todayIso`, `estimatedHours` finite and `0 < h <= 200`. **Anything that fails validation is dropped, never coerced to a default.** This is the deliberate opposite of triage's `parseSuggestion`.

**Cost and limits.** `recordCost({ scope: 'wizard', stage: 'predict_fields', scopeId: userId })` on every model call. `PREDICT_DAILY_CAP_CENTS = 200` checked against the same `ai_cost_log` ledger; over cap returns `{ suggestions: {}, reason: 'ai_rate_limited' }`. Per user: at most 60 `predict_fields` rows in the last hour for that `scopeId`, same soft answer past that. A `null` ledger read lets the call through, as in the task wizard.

**Timeout.** `AbortSignal.timeout(6000)` on the SDK call. On abort, or any thrown error, fall back to heuristics rather than erroring.

**Degraded path (no `ANTHROPIC_API_KEY`, timeout, or cap).** `lib/predict/heuristics.ts`, pure, no model: due date from `todayIso + roundUp(orgMedianTurnaround)` at confidence 0.65 (omitted when the cohort floor is not met), priority `high` at 0.7 when the text matches the escalation keyword table, size via the existing `suggestRequestSize`, estimated hours from the category median of `timeEntries` at 0.6. Everything else omitted. Response carries `degraded: true`.

## 2. Client trigger

A shared hook `lib/use-field-predictions.ts` (`'use client'` free of DOM assumptions is not required here; it is a hook file, not a lib rule violation, so place it at `components/tahi/forms/use-field-predictions.ts`).

- Debounce **700 ms** after any change to title, description, or client, plus an immediate re-run on category change.
- Fire only when the minimum-context rule passes locally (same 4-word / 16-char test, mirrored in `lib/predict/context.ts` and shared by both sides).
- Cancel the in-flight request with an `AbortController` on every new trigger and on dialog close.
- **Never fire while `view === 'ai'`** in either dialog, and never within 2 seconds after `handleDraftToForm` or `applyTemplate` runs.
- Track `touched: Set<PredictableField>`, added to on every operator `onChange` and on any programmatic write from a template or AI draft. Request the prediction only for fields not in `touched` and currently empty.
- Precedence, enforced in one place: **operator > template > AI draft > prediction**. The prediction writer refuses to write a field present in `touched`.

## 3. UI treatment

New component `components/tahi/forms/suggested-field.tsx`:

```tsx
type SuggestedFieldProps = {
  suggested: boolean
  reason?: string
  fieldId: string            // for aria-describedby
  onClear: () => void
  children: React.ReactNode  // the real control, value already set
}
```

A suggested value is written into the real control, so it is a real value on submit with no extra accept step. Visual: the control gets `bg-[var(--color-brand-50)]` and `border-[var(--color-border-subtle)]`; beside the label, in the request dialog's `FieldGroup` `after` slot, a `Sparkles` glyph at 14px plus the word "Suggested" in `var(--color-text-muted)`, and a `QuietLink` reading "Clear" with 44px of reach. The reason renders as a one-line caption under the field in `var(--color-text-subtle)`, id `${fieldId}-reason`, wired via `aria-describedby` on the control. Colour is never the only signal: the word "Suggested" and the caption carry it.

Editing the field clears the suggested styling and moves it to `touched`. A single "Clear suggestions" `QuietLink` sits above the footer and empties every still-suggested field at once.

The task dialog's local `FieldGroup` (:168) gains an `after?: ReactNode` slot to match the request dialog's. At 375px the label row wraps: label on line one, the Suggested chip and Clear on line two, caption below, no horizontal scroll. All tints come from tokens so dark mode needs no override. Every tappable affordance keeps a 44px hit box via padding, not ink.

## 4. Where it lands

In: `AlignedRequestDialog` when `isAdmin` is true, and `NewTaskDialog`. Sub-requests inherit parent `category` and `dueDate` locally with no model call.

Out: **board quick-add and the task column composer**, because they submit on Enter with no field surface on which to show or correct a guess. **The client portal form**, because a studio-derived due date shown to a client reads as an SLA promise the studio has not made.

## 5. MCP parity

Worker tool `predict_entry_fields` in `workers/mcp-server/src/index.ts`, declared beside `ai_triage_request` (:1491), dispatched through `apiWrite` to `{ path: '/api/admin/ai/predict-fields', method: 'POST', body }`. Input schema: `subject` (enum request|task, required), `title` (required), `description`, `orgId`, `level`, `category`, `empty` (array of field names), `todayIso`. Add the mapping assertion to `app/api/__tests__/mcp-request-tool-parity.test.ts`.

## 6. Tests

- `lib/predict/__tests__/heuristics.test.ts`: keyword priority table, size passthrough, "no cohort produces no due date", cohort floor of 5.
- `lib/predict/__tests__/stats.test.ts`: `median` on even, odd and empty cohorts; turnaround day rounding; the `>= 0` sanity filter.
- `lib/predict/__tests__/context.test.ts`: the 4-word / 16-char gate, shared by both sides.
- `app/api/__tests__/ai-predict-fields.test.ts` on the existing mocked-`@anthropic-ai/sdk` + mocked-`@/lib/db` harness used by `ai-request-wizard-routes.test.ts`: thin title returns empty with `reason: 'thin_context'` and `createMessage` is never called; a 0.4-confidence field is dropped; an out-of-vocabulary priority is dropped rather than coerced; a filled field in `filled` is never returned; no key returns `degraded: true` with heuristics only; over cap returns `ai_rate_limited`; `recordCost` is called exactly once per model call.
- `e2e/requests-dialog.spec.ts` addition: open the admin dialog, pick a client, type a 12-word title, wait for the Suggested caption on due date, assert the date input has a value and `aria-describedby` resolves to the reason, type into priority and assert its Suggested chip disappears, click "Clear suggestions" and assert due date is empty, submit and assert the created request carries the remaining suggested values.

## 7. Ownership

Create: `app/api/admin/ai/predict-fields/route.ts`, `lib/predict/{heuristics,stats,parse,context,types}.ts` plus their tests, `components/tahi/forms/suggested-field.tsx`, `components/tahi/forms/use-field-predictions.ts`, `drizzle/migrations/0088_predict_indexes.sql`, `app/api/__tests__/ai-predict-fields.test.ts`.

Edit: `components/tahi/new-request-dialog.tsx` (remove the +7 default, add touched tracking and the suggestion wiring, delete `LegacyRequestDialog` :1754-2460 in the same pass), `components/tahi/tasks/new-task-dialog.tsx` (add the `after` slot and the same wiring), `app/api/portal/request-forms/route.ts` (`parseForm` carries `sla`), `app/api/admin/db/migrate/route.ts`, `workers/mcp-server/src/index.ts`, `app/api/__tests__/mcp-request-tool-parity.test.ts`, `e2e/requests-dialog.spec.ts`.

Delete: `app/api/admin/ai/suggest/route.ts`.

Do not touch: `app/api/admin/requests/[id]/triage/route.ts`, `lib/anthropic-cost.ts`, `lib/task-consistency.ts`, `lib/tasks-quick-add.ts`, `components/tahi/tasks/task-quick-add.tsx`, `app/(dashboard)/requests/request-list.tsx` quick-add, `app/api/portal/requests/route.ts`, `mcp-server/` (dormant).

## 8. Non-goals

No AI first-start bar. No prediction on the client portal, on quick-add, or on any existing record. No writing to the database from the prediction route. No learning loop that trains on accepted suggestions. No new date-picker primitive. No per-stage request status history. No confidence number shown to the operator.