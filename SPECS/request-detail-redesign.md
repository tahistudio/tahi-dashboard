# Request Detail — Redesign Spec

**Status:** Idea stage. Approve before code.
**Current file:** `app/(dashboard)/requests/[id]/request-detail.tsx` (1,961 lines)
**Why redesign:** Tier 1 multi-persona page (admin + team + client). Most-opened page in the app per the pipeline. First place that "feels off" is felt most.

---

## 1. Persona + purpose

Four roles open this page with distinct mental models. The redesign has to serve **all four without forcing anyone to scroll past what they don't care about.**

### 🎯 Role A — Admin (Liam / founder)
**Opens the page to:** triage, unblock, make a decision, move the request forward.

- **3-minute task:** "Is this moving? Anything blocking? Who's on it? When's it due?" → scan status, assignee, last update, blockers.
- **30-minute task:** Review scope creep, change assignee, nudge client, log time, reconcile with invoice.

What matters: status stepper, assignee/owner, scope-flag state, unread internal notes, days-since-last-update, client mood (tone of last client message), time logged vs estimate, related deal/invoice.

### 🎯 Role B — Team member assigned to the request
**Opens the page to:** do the work, answer the client, upload deliverables.

- **3-minute task:** "What's the latest from the client? What am I expected to reply to?" → thread with unread markers.
- **30-minute task:** Upload files, update checklist, mark ready for client review, log time.

What matters: **the thread** (70% of their time is here), the checklist (their personal to-do inside the request), file uploads, status advance button, @mentions.

### 🎯 Role C — Team member not assigned (helping / reviewing)
**Opens the page to:** comment, add context, review deliverables.

- **3-minute task:** Read description + scan thread, leave an internal note.
- **30-minute task:** Review a deliverable, advise on direction, tag the assignee.

What matters: description (context), thread (read-only vibe), internal notes toggle, @mention suggestions.

### 🎯 Role D — Client contact
**Opens the page to:** follow progress, send feedback, approve deliverables, ask questions.

- **3-minute task:** "Where are they at? Any questions for me?" → status, latest reply.
- **30-minute task:** Approve deliverable, upload source files, request revisions.

What matters: clear status (plain English, not jargon), clear owner ("Liam is working on this"), the thread (only non-internal messages), approve/request-revision CTA, file uploads, **never see internal notes or scope flags or time entries**.

### The #1/#2/#3 actions per role

| Role | #1 | #2 | #3 |
|---|---|---|---|
| Admin | Scan status + blockers | Change status / assignee | Reply to client OR add internal note |
| Team assigned | Reply to client | Update checklist / upload file | Move to Client Review |
| Team unassigned | Read thread | Leave internal note | @mention assignee |
| Client | Read latest status | Reply in thread | Approve or upload file |

---

## 2. Information architecture audit

### What's on the page today (by card, top→bottom)

| Block | What it shows | Who needs it | Verdict |
|---|---|---|---|
| **Header**: title, request#, follow button, client name, status stepper (5 steps) | ID + status-at-a-glance | All | ✅ Keep. Stepper is excellent. |
| **Description** card | Rich-text brief | All (esp. assignee + unassigned team) | ✅ Keep. But collapse for assignee (they've read it). |
| **Thread** (messages + composer) | Conversation | All | ✅ Keep. This is the page's centre of gravity. |
| **Activity Log** | Audit trail: status changes, assignments, etc. | Admin + assignee | ⚠️ Currently full card. Should be collapsible. Client probably doesn't need it. |
| **Checklists** panel | Sub-tasks for the assignee | Assigned team | ⚠️ Keep, but move up — it's an action item, not an afterthought. |
| **Files** panel | Uploads | All | ✅ Keep. |
| **Sidebar: Status actions** (admin) | 4 "Move to X" buttons | Admin only | ⚠️ Redundant with the stepper for admins who can click a step. Consolidate. |
| **Sidebar: Details** | Type, category, priority, assignee, due date, estimated, created, delivered | All | ✅ Keep. |
| **Sidebar: Admin / scope flag** | Flag as scope creep | Admin only | ✅ Keep. |
| **Sidebar: Time entry** | Log hours (admin) | Admin only | ✅ Keep. |

### What's missing today

1. **Plain-English status for clients.** The stepper shows "Submitted → In Review → In Progress → Client Review → Delivered" but a client opening the page still has to interpret what "In Review" means. Add a one-line "Liam is working on this. Expected delivery 18 May." under the header for clients.
2. **"What am I expected to do next?" CTA.** Admin should see "Move to Client Review" as a big button when all checklist items are done. Client should see "Approve" or "Request revision" when status is Client Review. Team assignee should see "Mark ready for Client Review" when checklists are done. Today the action is buried in the sidebar or stepper.
3. **Related deal + related invoice.** If this request is billed against a deal or has invoice line items, surface them. Today you have to bounce between pages.
4. **Unread indicator on the thread.** A team member opens 20 requests a day — they need to know which ones have new client messages without scrolling.
5. **Client's last-reply age ("2 days ago, 3 days since you responded").** Stale client conversation = urgent. Invisible today.
6. **Mobile status stepper.** 5 steps don't fit at 375px. Currently horizontal-scrolls, which is OK, but there's no "you are here" marker visible without scroll.

### What's redundant today

1. **Sidebar Status action buttons ARE redundant with the stepper for admin.** Kill the buttons; make stepper steps clickable for admin.
2. **Thread title shows "Thread" + count badge.** "Thread" is obvious; replace with "Messages (12, 3 unread)" which is informative.
3. **Description card always expanded.** On repeat visits by assigned team, the description is noise. Collapse by default if user has opened the request before (persist to localStorage). First-time visitors see it expanded.

### What should move

1. **Checklist** → up, above Activity Log. It's an action area, not a log.
2. **Activity Log** → bottom of left column OR into the sidebar as a collapsible section. Not important enough for prime real estate.
3. **Time entry panel (admin)** → collapsed by default. Open only when logging time.
4. **Follow button** → keep in header but shrink; it's a minor action.

### What's persona-gated today that we should gate more aggressively

| Block | Admin | Team assigned | Team unassigned | Client |
|---|---|---|---|---|
| Status stepper | ✅ clickable | ✅ clickable to "Client Review" | 👁 read-only | 👁 read-only |
| Internal note toggle in composer | ✅ | ✅ | ✅ | ❌ hide entirely |
| Scope flag card | ✅ | ❌ | ❌ | ❌ |
| Time entry | ✅ | ⚠️ own entries only | ❌ | ❌ |
| Activity Log | ✅ full | ✅ full | ✅ full | ⚠️ client-visible events only |
| Checklist edit | ✅ | ✅ own items | ❌ read | ❌ hide |
| File delete | ✅ | ✅ own uploads | ❌ | ✅ own uploads |

Today, **scope flag + time entry + internal messages are visibly hidden from clients, but the internal-note toggle state is exposed** in the composer via `isInternal` which can leak between renders. Tighten this.

---

## 3. Layout sketch

### Desktop (≥1024px)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Requests > [ClientName] > #023 title                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Header Card                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ #023 • Website redesign hero refresh            [Follow] [Priority] │   │
│  │ 🏢 Acme Corp · Assigned to Liam · Due 18 May                        │   │
│  │ ────── Stepper: Submitted ─●─ In Review ─●─ In Progress ○ CR ○ Del ─│   │
│  │                                                                       │   │
│  │ 💡 Client view: "Liam is working on this. Expected 18 May."          │   │
│  │ 🎯 Admin view:  "All checklists done — ready to move to Client      │   │
│  │                  Review. [Move →]"                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Main (2/3)                              │ Sidebar (1/3)                    │
│                                           │                                  │
│  ┌─────────────────────────────────┐    │ ┌───────────────────────────┐   │
│  │ Description (collapsed if you've │    │ │ DETAILS                    │   │
│  │  opened it before — one click to │    │ │ • Type: Small Task         │   │
│  │  expand)                         │    │ │ • Category: Design         │   │
│  └─────────────────────────────────┘    │ │ • Priority: [High ▾]       │   │
│                                           │ │ • Owner: [Liam ▾]          │   │
│  ┌─────────────────────────────────┐    │ │ • Due: 18 May 2026         │   │
│  │ Messages (12 · 3 unread)         │    │ │ • Estimated: 4h            │   │
│  │ ┌───────────────────────────┐  │    │ │ • Logged: 2.5h             │   │
│  │ │ Thread (messages + unread  │  │    │ │                            │   │
│  │ │  divider, internal-note    │  │    │ │ RELATED                    │   │
│  │ │  toggle shown to team)     │  │    │ │ • Deal: Acme redesign ($5k)│   │
│  │ └───────────────────────────┘  │    │ │ • Invoice: INV-045 ($2,500)│   │
│  │                                 │    │ │                            │   │
│  │ [Composer + file picker]        │    │ │ CHECKLISTS                 │   │
│  └─────────────────────────────────┘    │ │ • 3 / 5 complete           │   │
│                                           │ │ (inline list, click to     │   │
│  ┌─────────────────────────────────┐    │ │  toggle)                   │   │
│  │ Files (5 attached)               │    │ │                            │   │
│  │ [thumbnail grid + upload CTA]    │    │ │ SCOPE (admin only)         │   │
│  └─────────────────────────────────┘    │ │ [Flag scope creep]         │   │
│                                           │ │                            │   │
│  ┌─────────────────────────────────┐    │ │ TIME (admin only)          │   │
│  │ Activity Log [▾ collapsed]       │    │ │ [+ Log time]              │   │
│  │ 23 events                        │    │ └───────────────────────────┘   │
│  └─────────────────────────────────┘    │                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

Key changes from today:
- **Single consolidated sidebar card** (`<SidebarCard>`) with labelled sections — matches the deal-detail pattern we already ship.
- **Checklist moved into the sidebar** (right column, under Related) — it's a metadata + actions thing, not a main-column block.
- **Files panel moves up** above Activity Log.
- **Activity Log is collapsed by default**, expands on click.
- **"Related" section** surfaces linked deal + invoice (data we already have, just never showed).
- **Primary action CTA** moved into the header card — "Move to Client Review" / "Approve" / whatever the next step is for this user's role.

### Mobile (375px)

```
┌──────────────────────────────────┐
│ Breadcrumb (condensed to ←)     │
├──────────────────────────────────┤
│ #023 title                       │
│ 🏢 Acme · Liam · Due 18 May      │
│ ←Stepper: horizontal scroll→     │
│ Primary action CTA (full width)  │
├──────────────────────────────────┤
│ Description (collapsed)          │
├──────────────────────────────────┤
│ Details accordion [▾]            │
│  — Metadata, Related, Checklist  │
├──────────────────────────────────┤
│ Messages (12, 3 unread)          │
│ [Thread]                         │
│ [Composer]                       │
├──────────────────────────────────┤
│ Files (5)                        │
├──────────────────────────────────┤
│ Activity Log [▾]                 │
├──────────────────────────────────┤
│ Admin actions accordion [▾]      │
│  (scope flag + time entry)       │
└──────────────────────────────────┘
```

Single column. Sidebar collapses into a single "Details" accordion above the thread (so metadata is one tap away, never buried below the scroll).

---

## 4. Navigation map

### In-links (how users arrive here)
- Requests list → click a row
- Overview → "Recent requests" panel
- Client detail → Requests tab
- Notifications → "New message on Request X"
- Search → type title or #request-number
- Tasks → "related request" link
- Invoice detail → "requests billed under this invoice"

### Out-links (where users go from here)
- Client name → `/clients/[orgId]`
- Assignee name → `/team/[memberId]` or impersonate
- Related deal → `/pipeline/[dealId]`
- Related invoice → `/invoices/[invoiceId]`
- File → inline preview or download
- @mention in a message → `/team/[id]` or `/clients/contacts/[id]`
- Checklist sub-task → if linked to a Task, `/tasks/[taskId]`
- "View in client portal" (admin impersonation shortcut)

**No dead ends.** Every entity is clickable. Every data field that represents something has a link to the source of truth for that thing.

---

## 5. Interaction details

### Primary action CTA (header, role-aware)
- **Admin, status = in_review:** "Start working → (moves to in_progress)"
- **Admin, status = in_progress, checklists done:** "Move to Client Review" (highlighted, brand colour)
- **Admin, status = in_progress, checklists NOT done:** grey-out the button, tooltip "Complete all checklists first"
- **Client, status = client_review:** "Approve & close" OR "Request revision" (2 buttons)
- **Team assigned, status = in_progress:** "Ready for client review" (same as admin's primary)
- **Otherwise:** hide the CTA

### Description collapse state
- Persisted per `(userId, requestId)` in localStorage under key `tahi:request-desc:{id}`
- First visit: expanded
- Subsequent visits: collapsed (1-line preview + "Show more")
- Collapse state overridden by a toggle button at the top-right of the description card

### Unread message detection
- Use `request.lastReadAt` per user (new field, needs schema addition)
- Messages with `createdAt > lastReadAt` → "3 unread" badge on Messages header + a divider above the first unread
- Visiting the request marks all client messages as read after 2 seconds (so a quick glance doesn't count)

### Checklist moved to sidebar
- Compact rendering: title + N of M + inline bulleted list (each checkbox-toggleable)
- Admin/assignee: direct click toggles + optimistic update
- Unassigned team/client: read-only, see progress but can't toggle

### Activity log collapsed by default
- Show count ("23 events")
- Click to expand in place — no navigation
- Newest first

### Scope flag UX
- Admin-only sidebar section
- When flagged: red border, icon, timestamp ("Flagged 3d ago by Liam")
- Click to unflag
- When someone flags, emit an automation event (already wired in the codebase)

### @mention in composer
- Already works via `MentionInput`
- Keep the current behaviour — no redesign needed
- Internal note toggle: keep, but render as a **segmented control** (Public / Internal) instead of a checkbox — clearer state

### Mobile stepper "you are here" fix
- Current step gets a sticky left-edge marker on mobile while the rest scrolls past
- OR on mobile, replace the 5-step stepper with a single chip: "● In Progress (step 3 of 5)" + a "Show all" toggle

### Keyboard shortcuts (new)
- `r` — focus the reply composer
- `j` / `k` — next / previous message
- `u` — upload a file
- `.` — open the sidebar details accordion (mobile)
- These only work when the composer is NOT focused

---

## 6. Primitive + composite usage

This redesign composes from the library we built, no new primitives needed:

- `<PageHeader>` — title + subtitle (client name) + actions slot for Follow button
- `<Card>` — every main-column block (Description, Messages, Files, Activity Log)
- `<Card.Header bordered>` + `<Card.Title>` for each of the above
- `<SidebarCard>` + `<SidebarSection label>` — Details, Related, Checklist, Scope, Time
- `<Badge tone/stage/source>` — priority, category, status, unread count
- `<SectionTabs>` — not needed; page is short enough
- `<ActivityTimeline>` + `<ActivityItem>` — the Activity Log section (currently custom, migrate)
- `<SlideOver>` — if we want a "Log time" panel that doesn't leave the page (nice-to-have, not core to redesign)

---

## 7. Questions for you

Before I build, I need 6 decisions:

1. **Primary CTA behaviour when checklists are incomplete.** Grey-out with tooltip, OR hide entirely, OR show a different text like "Complete checklists to advance"?
2. **Description collapse.** Keep it collapsed by default on repeat visits (my proposal)? Or always expanded? Or let each user toggle as they please with no persistence?
3. **Activity log placement.** Bottom of left column (my proposal — it's audit trail, low priority), or in the sidebar as a collapsible section?
4. **Related deal/invoice surfacing.** My proposal shows them in the sidebar as a "Related" section. Agree, or would you prefer inline breadcrumb-style at the top?
5. **Mobile stepper.** Horizontal scroll with sticky current-step marker, OR collapse to single chip with "Show all" reveal?
6. **Keyboard shortcuts.** Ship with the 4 I proposed (r / j / k / u / .), or skip for V1 and add later?

Once you answer these, I'll:
1. Wire up any schema additions needed (`lastReadAt` for unread detection)
2. Rebuild the page in order: Header → Sidebar → Thread → Description → Files → Activity Log
3. Write it composed from the primitive library (~500 lines vs current 1,961)
4. Test all 4 personas via impersonation
5. Deploy to main, live review

Expected diff: **−1,500 lines** (current 1,961 → ~500), most of the shrinkage from composing via primitives rather than re-rolling cards/sections/sidebars inline.
