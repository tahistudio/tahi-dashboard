# Request Detail + Request System — Redesign Spec (V3 — APPROVED)

**Status:** All decisions locked after feedback round 2. Ready for Phase 1.
**Scope:** "Rearchitect requests as nestable + multi-participant, rebuild composer, redesign detail page, update AI wizard, live time tracker"

This spec covers **both the data model and the UI**. The data model changes are needed before the UI can be built, so we ship them in that order.

---

## Decisions locked

### Round 1
| Question | Decision |
|---|---|
| Description collapse | Persist collapsed state per `(userId, requestId)` in localStorage, user-controlled toggle |
| Activity log placement | Bottom of left column, collapsed by default, migrated to `<ActivityTimeline>` |
| Related deal / invoice surfacing | **Skip** — lives on client / company detail, not per-request |
| Mobile stepper | Collapse to a single chip, tap opens popover with full stepper |
| Keyboard shortcuts | **Skip V1** |
| CTA when checklists incomplete | Pattern B — progress-aware label, clickable to jump focus |
| Primary CTA placement | Header card, full-width on mobile |
| Task type system | **Only `small` or `large`.** Drop all other values. |

### Round 2
| Question | Decision |
|---|---|
| Sub-request nesting depth | **One level only** (parent + children). No grandchildren. |
| Project manager role | **Optional, zero or one.** Never required, never implicit. Default is "unset". |
| Follower notifications | Notify on : status moves to submitted / in_review / client_review, and on public messages + client feedback. **Do NOT notify the person who performed the action.** |
| Time tracking UX | **Live ticking timer** (stopwatch-style) + manual "log past time" entry. One active timer per user globally. Top-nav indicator when active. |
| Scope flag | **Move to a small icon button in the request header area**, not a full sidebar card. Click to flag / unflag. |
| Status change UX | **Replace the 4 "Move to X" buttons with a single `<Select>` dropdown** ("Set status: In Progress ▾") |

---

## 1. Architecture changes

### A) Sub-requests (parent ↔ child)

**Schema change** — add to `requests` table:

```ts
parentRequestId: text('parent_request_id').references(() => requests.id, { onDelete: 'cascade' }),
// Null = top-level request.
// Set = this request is a sub-request of the parent.
```

**Rules:**
- A parent can have many sub-requests.
- Sub-requests belong to the **same `orgId`** as the parent. Enforced on insert.
- Sub-requests inherit the parent's `orgId`, `category` (unless overridden), and follower list (unless explicitly narrowed).
- **Parent status is auto-derived** from children:
  - Any child `in_progress` → parent `in_progress`
  - All children `delivered` → parent auto-moves to `client_review` (admin can then mark parent delivered)
  - Any child `blocked` → parent visually shows a blocked indicator but keeps its own status
  - If a parent has no children, it behaves like a standalone request (today's behaviour)

**UI where sub-requests surface:**

1. **Parent Request Detail** — sub-requests render as a checklist-style list inside the detail page, right under the description. Each line: status dot + title + assignee avatars + size badge (S/L) + click-through link. A "+ New sub-request" button at the end.
2. **Child Request Detail** — breadcrumb shows `Requests > [Parent title] > [Child title]`. A "Back to parent" link.
3. **Requests list** — parent rows render a nested count ("5 sub-requests, 3 done"). Children don't appear in the top-level list unless a "Include sub-requests" filter is toggled.
4. **Requests board (kanban)** — only top-level requests show as cards by default. A parent card shows "3/5 done" in its footer. Optional "Expand" toggle shows children as indented cards under their parent (experimental — may cut if it's visually busy).
5. **Drag-to-nest** — on the requests list or board, dragging request A onto request B (same `orgId`) opens a confirm: "Make '[A title]' a sub-request of '[B title]'?" Click to confirm.
6. **Create sub-request from inside parent** — the "+ New sub-request" button in the parent detail opens the new-request dialog pre-filled with `parentRequestId` and the client locked.

**AI wizard update:**
- Wizard can output a single top-level request (today's behaviour) **or** a parent + sub-requests batch.
- User prompt: "New website for Acme" → wizard proposes:
  - Parent: "Acme website" (size: large)
  - Sub-requests: "Gather brief + assets", "Wireframes", "Visual direction", "Webflow build", "QA + launch" (each sized S or L)
- User confirms → all created in one call.
- The request wizard `RequestDraft` type gains `subRequests: RequestDraft[]` (recursive one level only — no sub-sub-requests in V1).

**Simplified type system:**
- Today: `small_task` / `large_task` / other variants.
- New: `size: 'small' | 'large'`. The `type` column is renamed/simplified. Internal vs external visibility handled by `isInternal` as today (stays).
- Migration: everything that was `small_task` → `small`; everything else → `large`. One-time backfill.

### B) Multi-assignee + PM + followers

**Problem today:** `requests.assigneeId` is a single team member. No project manager slot. Followers exist but are single-person tied to one user via `/follow` API.

**New model** — one junction table replaces both:

```ts
requestParticipants: {
  id: text pk,
  requestId: text FK → requests,
  participantId: text,                       // teamMember.id or contact.id
  participantType: 'team_member' | 'contact',
  role: 'assignee' | 'pm' | 'follower',
  addedAt: text,
  addedById: text,
  addedByType: 'team_member' | 'contact',
}
```

**Rules:**
- `role = 'pm'` — zero or one per request. Project manager, shown prominently.
- `role = 'assignee'` — zero or many. The people doing the work. All get notified on client replies.
- `role = 'follower'` — zero or many. Get notified on status changes and (optionally) all replies. Can be team members OR client contacts.
- A single person can have only one role per request (no "PM and assignee" at the same time). If PM should also "do the work", they can be just an assignee and someone else is PM.
- Client contacts can only be followers (not PM or assignee).
- Removing a participant is soft — we keep the row for audit but mark `removedAt` so mention history resolves correctly.

**Migration path:**
1. Add the table.
2. Backfill: each existing `assigneeId` → `requestParticipants` row with `role='assignee'`, `participantType='team_member'`.
3. Backfill followers from the existing follow mechanism (wherever it lives today — need to audit that).
4. Drop the `requests.assigneeId` column only after UI is fully swapped (phase 2).

**UI — the "People" sidebar section:**

```
PEOPLE
────────────────────────
Project manager
  [● Liam  ⓧ ]          ← single slot, click to change
  
Assignees  (2)
  [● Sarah  ⓧ ]
  [● Mark   ⓧ ]
  [+ Add assignee]        ← opens SearchableSelect for team members only
  
Followers  (3)
  [● Jenna (Acme)  ⓧ ]   ← client contact
  [● James         ⓧ ]   ← team member
  [● Priya (Acme)  ⓧ ]
  [+ Add follower]        ← opens SearchableSelect with team members AND contacts from this request's org
```

Everything is a compact chip-with-avatar-and-remove-X. Click "Add" → a searchable dropdown (use the existing `<SearchableSelect>` component).

**Bulk assign UI** (user called this out explicitly): from the requests list, select multiple requests with checkboxes, then "Assign to..." bulk action lets you pick one or more people and assign them as assignees to all selected requests in one call.

### C) Messaging composer overhaul

Current state (TiptapEditor): rich-text editor with @mentions, file attach, and an "Internal" toggle button rendered as a small pill with a 🔒 emoji + amber highlight. User reports it's buggy and confusing.

**Problems to fix:**
1. Internal state isn't obvious at a glance — is amber = on or off?
2. No clear "who will see this" feedback — a team member can forget they're about to post internally.
3. Emoji 🔒 is not our design language.
4. The 🔒 pill uses hardcoded Tailwind amber classes (not our semantic tokens).
5. Failure states use hardcoded Tailwind red classes too.
6. File attach flow has edge cases: upload kicks off before the draft is ready, if you close the tab mid-upload the file is orphaned, no way to re-order attached files.
7. Cmd/Ctrl+Enter to send isn't documented or tested (user reports "buggy").

**New composer — spec:**

```
┌────────────────────────────────────────────────────────────────┐
│ ┌─────────────┐ ┌──────────────┐                               │
│ │ 👁 Public   │ │ 🔒 Internal  │    (segmented control, left)   │
│ └─────────────┘ └──────────────┘                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Reply to Acme Corp, or add an internal note…             │  │
│  │ (Tiptap content area, ~3 rows default, grows to 12)      │  │
│  │                                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  [B] [I] [•] [1.] [<>] [🔗]          [📎 Attach]  [Cmd+↵ Send] │
│  Attached:                                                     │
│  [📄 hero-v2.fig 234kb ⓧ]  [🖼 brief.jpg 54kb ⓧ]              │
└────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- **Segmented control** for Public / Internal — clear binary state, always visible, uses `--color-brand` for Public (client-visible) and `--status-in-review-*` (amber) for Internal.
- Internal state gets a **persistent banner** above the content area when active: "💡 Only the Tahi team will see this message. Your client (Acme Corp) won't be notified."
- Client role: segmented control is hidden entirely — clients can only post public messages.
- Toolbar tokens: all buttons use our design-system classes (no more raw `amber-400` / `red-200`).
- Attached files list uses `<Badge>` component.
- Send = primary `<TahiButton>` with keyboard shortcut "Cmd+↵" shown inline on the button at ≥md breakpoint.
- Upload is **deferred until send** — files stay in local state until the message is submitted. This fixes the orphaned-file bug.
- Cmd+Enter / Ctrl+Enter to send, Enter for new line (inverse of today — today Enter sends, Shift+Enter for new line, which trips people up on long replies).
- File attach: drag-and-drop onto the composer works (today it doesn't).
- When `isInternal` is active, the visual theme of the editor box shifts: amber left-border bar + amber banner. Impossible to miss you're posting internally.

**Bugs we fix by rewriting this component:**
- Send-on-Enter trapping in the middle of a paragraph
- "🔒 Internal" pill that doesn't persist across re-renders in some cases
- Orphaned uploads on tab close
- Red/amber hardcoded classes don't follow dark-mode tokens

**File to write:** replace `components/tahi/tiptap-editor.tsx` with `components/tahi/message-composer.tsx` (cleaner name). Old file deleted.

### D) Simplified task type system

Drop `type` granularity. One binary: **small** or **large**. This flows through:
- `requests.size` column (rename from `type`)
- AI wizard emits `size: 'small' | 'large'`
- Badges: one `<Badge>` with size value
- Capacity math: track slots can still multiply small vs large appropriately
- Task estimation: small ≈ 1–4h, large ≈ 4h+ (no exact bounds, design decision per request)

### E) Live time tracker

**Problem today:** time entries are logged retroactively via a "Log time" button that opens a form. Easy to forget, easy to fudge numbers. The user wants a live stopwatch — click "Track now" and a timer ticks up on-screen while you work.

**Schema addition** — `activeTimers` table:

```ts
activeTimers: {
  id: text pk,
  userId: text,                       // teamMember.id — one active timer per user globally
  requestId: text,                    // request being tracked
  startedAt: text,                    // ISO timestamp
  lastPingAt: text,                   // heartbeat for recovery (see below)
  notes: text nullable,               // optional running notes
}
```

**Unique constraint:** `(userId)` — one active timer per person. Starting a second timer auto-stops and logs the first.

**UX:**

1. **Global top-nav indicator** — when a timer is active, a compact chip appears in the top nav:
   ```
   [⏱ 01:23:45 · Acme website ▾]
   ```
   Click the chip → dropdown with:
   - "Go to request" → navigates to the tracked request
   - "Pause" → pauses timer (keeps it active but frozen — useful for breaks)
   - "Stop + log" → stops timer, opens a confirm modal prefilling hours, adds optional billable toggle + note, creates a `timeEntry` row, clears the `activeTimers` row
   - "Discard" → stops timer without logging (confirm first)
   - On mobile the chip compresses to just the icon + time

2. **Per-request Time section** (sidebar) — three states:
   - **Idle** (no timer on any request): button "▶ Track time on this request"
   - **Active on THIS request**: shows the live ticking timer inline + "⏸ Pause" / "■ Stop + log" buttons
   - **Active on ANOTHER request**: shows "⏱ Currently tracking: [Other request title]" as a warning banner, with "Stop that and start on this one" action button

3. **Manual entry**: below the live tracker, always a "Log past time" button for historical entries ("I worked on this yesterday for 2h, forgot to track"). Opens a small form: hours + date + optional note + billable toggle.

4. **Auto-recovery**: the active timer writes a `lastPingAt` heartbeat every 30 seconds via a lightweight `/api/admin/timers/ping` endpoint. If a user's browser dies while a timer is active, the next time they load the app we show: "Your timer on [X] was still running when you last closed. Log 2h 14m? [Yes, log it] [Discard]". This prevents "forgot I left it running overnight" issues.

5. **Accumulation**: timer + any time entry already logged for this request show as one number in the sidebar: **"Logged: 2h 15m (+ 34m running)"** while active. Once stopped, just "Logged: 2h 49m".

**Notification:** no notifications for timer state changes — this is purely personal.

**Billable default:** the client's default billable rate (from `organisations.hourlyRate`) pre-fills; can be toggled off before save.

---

## 2. UI / UX changes

### The full page layout (role-aware)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Requests › [Parent title if child] › [This title]      │
├──────────────────────────────────────────────────────────────────────┤
│  HEADER CARD                                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ #023 • Acme website hero refresh     [🚩] [Follow] [size: L] │ │  ← scope flag is here now (small)
│  │ 🏢 Acme Corp · PM: Liam · 2 assignees · Due 18 May           │ │
│  │                                                               │ │
│  │ ────── Stepper (mobile: single chip) ──────                  │ │
│  │                                                               │ │
│  │ ★ PRIMARY CTA (progress-aware per Pattern B)                 │ │
│  │                                                               │ │
│  │ ─ admin-only toolbar row ─                                   │ │
│  │ [Set status: In Progress ▾] [⏱ Track time] [··· more]       │ │  ← status is now a dropdown
│  └───────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│  MAIN (2/3)                          │  SIDEBAR (1/3)               │
│                                       │                              │
│  ┌────────────────────────────────┐ │  ┌──────────────────────────┐│
│  │ Description (collapsed ↓)       │ │  │ DETAILS                  ││
│  └────────────────────────────────┘ │  │ Size · Category · Due    ││
│                                       │  │ Created · Estimated      ││
│  ┌────────────────────────────────┐ │  │                          ││
│  │ SUB-REQUESTS (if parent)        │ │  │ PEOPLE                   ││
│  │ ● Wireframes           3/5 done │ │  │ Project manager          ││
│  │ ○ Visual direction     Sarah    │ │  │ Assignees (multi)        ││
│  │ ○ Webflow build        Liam     │ │  │ Followers (multi)        ││
│  │ ○ QA + launch          unassgnd │ │  │                          ││
│  │ [+ New sub-request]             │ │  │ CHECKLISTS               ││
│  └────────────────────────────────┘ │  │ (for THIS request)       ││
│                                       │  │                          ││
│  ┌────────────────────────────────┐ │  │ TIME                     ││
│  │ MESSAGES (12 · 3 unread)        │ │  │ Logged: 2h 15m           ││
│  │                                 │ │  │ [▶ Track time]           ││
│  │ [Thread w/ unread divider]      │ │  │ [+ Log past time]        ││
│  │                                 │ │  └──────────────────────────┘│
│  │ [Public / Internal seg ctrl]    │ │                                │
│  │ [Composer]                      │ │                                │
│  └────────────────────────────────┘ │                                │
│                                       │                                │
│  ┌────────────────────────────────┐ │                                │
│  │ FILES (5)                       │ │                                │
│  └────────────────────────────────┘ │                                │
│                                       │                                │
│  ┌────────────────────────────────┐ │                                │
│  │ ACTIVITY LOG ↓ (collapsed)      │ │                                │
│  └────────────────────────────────┘ │                                │
└──────────────────────────────────────────────────────────────────────┘
```

Key structural decisions (updated):
- **Sub-requests render inside the page** as a dedicated section under Description when the current request IS a parent.
- **People lives in the sidebar** with three distinct slots (PM / assignees / followers).
- **Checklists stay in the sidebar** (for the request itself).
- **Scope flag** moved from a sidebar card to a small icon button in the header action row (see spec below).
- **Status changes** now a single `<Select>` dropdown in an admin-only toolbar row in the header (replaces 4 "Move to X" buttons).
- **Time** lives in the sidebar — live ticking when active, "▶ Track time" idle button otherwise, "+ Log past time" always.
- **Related deal/invoice REMOVED** per your feedback.
- **Messaging composer lives in the Messages card** but is a rewrite (see composer spec above).

### Scope flag — compact header button

Replaces the full sidebar "Admin" card. Rendered in the header action row next to Follow and size badge:

- **Unflagged:** small neutral icon button `🚩` with tooltip "Flag as scope creep"
- **Flagged:** red-tinted button with the flag filled, tooltip shows flag reason + "Flagged 3d ago by Liam"
- Click: opens a tiny popover with "Flag scope creep" or "Remove scope flag" + optional reason text field
- Admin-only — hidden entirely for team members without admin rights and for clients

### Status dropdown — replaces the 4 buttons

Admin-only toolbar row in the header card:

```
[Set status: ● In Progress ▾]   [⏱ Track time]   [··· more]
```

- Compact `<Select>` with status dot + current label
- Open: all 6 status options (submitted, in_review, in_progress, client_review, delivered, archived) with dots
- Selecting a new status triggers confirmation toast + logs to activity
- Disabled for non-admins (they use the primary CTA to advance)
- `[··· more]` opens a small overflow menu with the secondary actions (archive, duplicate, delete, export as markdown, etc.) that otherwise clutter the header

### Primary CTA — Pattern B (progress-aware button)

The header card shows a **single big CTA** appropriate to your role + the request state:

| Role | State | CTA |
|---|---|---|
| Admin | status = submitted | "Start reviewing →" (moves to in_review) |
| Admin | status = in_review, no assignees | "Assign someone first →" (scrolls to sidebar) |
| Admin | status = in_review, has assignees | "Start work →" (moves to in_progress) |
| Admin | status = in_progress, all checklists done | **"Move to Client Review"** (brand colour, bold) |
| Admin | status = in_progress, partial checklists | **"2 of 5 checklists done · Complete to advance"** (neutral colour, not disabled — still clickable to jump focus to the checklist) |
| Admin | status = in_progress, parent request with incomplete sub-requests | "3 of 5 sub-requests done · Complete to advance" (same neutral treatment) |
| Admin | status = client_review | "Waiting on client · Nudge" (secondary button) |
| Admin | status = delivered | none (done) |
| Team assignee | status = in_progress | Same "Move to Client Review" or progress-aware label |
| Client | status = client_review | **"Approve & close"** (brand) + **"Request revision"** (secondary, side by side) |
| Client | any other state | none |

**Pattern B rationale:** progress-aware button text tells the user *what's blocking* rather than just greying out a disabled button. If a user clicks a "partial" label, we scroll-jump to the checklist (friendly nudge, not punishment).

### Sub-request section UI (when current request is a parent)

Inline checklist style, not a nested mini-kanban (keeps the page scannable):

```
SUB-REQUESTS   3 of 5 done
──────────────────────────────────────────────────
● Wireframes                    Sarah   [S] [In Progress]
● Gather brief + assets         Liam    [S] [Delivered ✓]
● Visual direction              —       [S] [Submitted]
● Webflow build                 Liam    [L] [Submitted]
● QA + launch                   —       [S] [Submitted]
[+ New sub-request]
```

Each row: status dot (coloured via `stageColour`) + title (link) + assignee avatar + size badge + status badge. Click anywhere on a row → opens the child request.

A parent row can be dragged to re-order sub-requests. Sub-requests use a `position` integer to preserve order.

### Kanban / list drag-to-nest

On the requests list or kanban board:
- Dragging request A onto request B (same `orgId`) shows a drop zone highlight on B.
- On drop: open confirm dialog "Make '[A title]' a sub-request of '[B title]'?" with cancel + confirm buttons.
- Confirm → set `A.parentRequestId = B.id`. A disappears from top-level list, appears in B's sub-request section.
- If A already has sub-requests of its own (a grandparent attempt) → block and show an error: "V1 only supports one level of nesting. Move A's sub-requests out first, then try again."

### Mobile stepper — single-chip mode

At widths `< 640px`, the 5-step stepper collapses to:

```
[ ● In Progress · 3 of 5  ⓘ ]
```

Tap the chip → small popover with the full stepper (dots + labels) + keyboard-style arrow navigation. Saves ~180px of vertical header space on small phones.

### Description collapse — persisted + user-controlled

- Key: `localStorage['tahi:request-desc:{requestId}']` = `'expanded' | 'collapsed' | undefined`
- **First visit** (key undefined): expanded.
- **Subsequent visits**: use stored value. Default to collapsed (1-line preview + "Show more") if key is undefined AND the user has opened this request at least once in the last 30 days.
- A toggle button at the top-right of the description card lets the user flip + persist state.
- Collapsed render: one-line preview (description truncated to ~200 chars, no HTML).

### Unread markers

New optional column on the upcoming participants / reads table:

```ts
requestReads: {
  id, requestId, userId, lastReadAt
}
```

When the user views a request detail page, after 2 seconds on the page, we upsert `lastReadAt = now()` for that user. Messages with `createdAt > lastReadAt` are "unread." Rendered as:
- A red-dot count badge on the Messages card header: "Messages (12 · 3 unread)"
- A horizontal divider inside the thread above the first unread message: "─── 3 unread messages ───"

---

## 3. Migration plan

### Phase 1 — schema only (no UI changes) — 1 session
1. Add `parentRequestId` to `requests` (migration).
2. Create `requestParticipants` table (migration).
3. Create `requestReads` table (migration).
4. Create `activeTimers` table (migration).
5. Add `requests.size` column (migration + backfill from existing `type`).
6. Backfill `requestParticipants` from existing `assigneeId`.
7. Keep `assigneeId` + `type` columns for now; new UI reads from participants + size, old UI still works.
8. Type-check, test.

### Phase 2 — API routes + MCP parity — 1 session
1. `/api/admin/requests/[id]/participants` GET + POST + DELETE
2. `/api/admin/requests/[id]/sub-requests` GET + POST + reorder
3. `/api/admin/requests/[id]/reads` POST (mark read)
4. `/api/admin/requests/bulk-assign` POST
5. `/api/admin/requests/[id]/nest` POST (drag-to-nest)
6. `/api/admin/requests/[id]/scope-flag` POST + DELETE (reason field in payload)
7. `/api/admin/timers` GET (own active timer) + POST (start) + PATCH (pause / unpause) + DELETE (stop + log or discard)
8. `/api/admin/timers/ping` POST (heartbeat)
9. Update existing `/api/admin/requests/[id]` GET to include `participants[]` + `subRequests[]` + `parent` + `unreadCount` + `activeTimer`.
10. MCP tools for all of the above (per DESIGN.md MCP parity rule).

### Phase 3 — new composer — 1 session
1. Build `components/tahi/message-composer.tsx` with the segmented Public/Internal control, file-attach-on-send, Cmd+Enter, drag-drop, tokenised colours.
2. Wire it into request-detail, replace TiptapEditor.
3. Keep TiptapEditor file until one session later (for rollback safety), then delete.

### Phase 4 — sub-request UI — 1 session
1. Sub-request section in request-detail (inline list).
2. New sub-request button → opens pre-filled `NewRequestDialog`.
3. Parent breadcrumb on child detail.
4. Drag-to-nest on list + board views.
5. AI wizard `subRequests` output.

### Phase 5 — people sidebar + bulk assign — 1 session
1. People sidebar section (PM / assignees / followers slots).
2. Add / remove participant inline.
3. Bulk assign from requests list.
4. Update notification logic per locked rules :
   - Followers get notified on : status moves to submitted / in_review / client_review, public messages, client feedback.
   - Actors never get notified of their own actions.
5. Unread markers + read tracking integration.

### Phase 6 — header redesign (CTA + status dropdown + scope flag + stepper + activity log) — 1 session
1. Rebuild the header card with new `<PageHeader>` + Pattern B primary CTA.
2. Admin toolbar row : status `<Select>` dropdown + "Track time" quick-start button + overflow `[···]` menu.
3. Scope flag as compact icon button in the header action row (popover for reason).
4. Mobile stepper single-chip + popover.
5. Migrate Activity Log to `<ActivityTimeline>` + collapsed-by-default.
6. Delete all local `SidebarCard` wrappers, use the shared primitive.

### Phase 7 — live time tracker — 1 session
1. Build `components/tahi/time-tracker.tsx` — the live ticking display + start / pause / stop controls, used inside the sidebar Time section.
2. Build `components/tahi/global-timer-indicator.tsx` — the top-nav chip with ticking display + dropdown menu.
3. Wire ping-every-30s heartbeat.
4. Auto-recovery flow on app load (lastPingAt older than 2 minutes → "was your timer on X still running?" prompt).
5. Manual "Log past time" quick-form modal.
6. Conflict handling : starting a timer on Request B while A is active → confirm-and-switch prompt.

### Phase 8 — polish + QA pass — 1 session
1. Walk all 4 personas via impersonation.
2. Mobile 375px + 768px checks.
3. Unread markers live test.
4. Description collapse state.
5. Drag-to-nest edge cases (nest with incompatible orgs, nest into a child, etc.).
6. Accessibility : screen reader through a full request flow, live-region announcements for the timer.
7. Timer heartbeat + recovery happy path + failure path.

**Total estimated: 8 sessions.**

---

## 4. All questions answered. Ready for Phase 1.

Round-2 decisions (all locked):
- Nesting : one level deep only.
- PM role : optional zero-or-one, never implicit, never nagged.
- Follower notifications : on status moves to submitted / in_review / client_review + on public messages + on client feedback; actors don't get notified of their own actions.
- Time tracking : live stopwatch + global top-nav indicator + manual "log past time" fallback + auto-recovery on app reload.
- Scope flag : small icon button in the header, not a sidebar card.
- Status : single `<Select>` dropdown in an admin toolbar row, replaces the 4 buttons.

---

## 5. What this spec does NOT cover (future tickets)

- **Sub-sub-requests** (nesting beyond 1 level) — defer to V2 once we know if anyone wants it.
- **Cross-org request linking** (blocking request at client A depends on request at client B) — defer; rare edge case.
- **Assignee workload visualization inside a request** — belongs on the Capacity page, not here.
- **Client-side sub-request rendering polish** — clients see sub-requests too, but V1 just renders the same list; custom client-friendly UI is future work.
- **Automated PM assignment** based on access-scoping rules — future work.
