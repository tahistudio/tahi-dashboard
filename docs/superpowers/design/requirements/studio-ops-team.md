# Design requirements: studio-ops-team

Group: studio-ops-team (audience: studio only). Routes: `/capacity`, `/team`, `/permissions`, `/tracks`.

Source material read: `CLAUDE.md`, `STATUS.md` ("Since the last update" and the triage snapshot), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2b and 3), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, every `TASKS.md` line matching capacity, team, permissions, tracks, access scoping and org chart, the live route and component code for all four pages, `lib/permissions.ts`, `lib/access-scoping.ts`, `lib/page-guard.ts`, `lib/feature-tree.ts`, `components/tahi/settings/team-access/pane.tsx`, `components/tahi/org-chart.tsx`, the admin/portal API routes each page calls, and the Claude Design project files `ops.jsx` / `ops-kit.jsx` / `ops-data.jsx` / `ops.css` and `permissions.jsx` (read directly via the claude-design MCP, project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`).

---

## 1. Purpose and audiences

All four routes are studio-only. Every page.tsx in this group calls `getViewAudience()` and redirects a client (including a studio user in Client-view preview, the `tahi-impersonate-org` cookie) away before render: `/capacity` and `/permissions` bounce to `/overview`, `/team` bounces to `/requests`, `/tracks` bounces a non-studio caller to `/requests`. No client, in any preview mode, ever sees these pages. This is deliberate tenancy protection, not an oversight: a Client-view preview must never let one client see another client's team roster, capacity numbers, permission rules or cross-client track board.

Who opens each page and what job it does:

- **`/capacity`** - Liam or Staci (or a team member granted the `capacity` feature) checking whether the studio can take on more work: current utilisation, an 8-week timeline, pipeline-weighted forecast, and a quick "if this deal closes, what happens" calculator for a live sales call.
- **`/team`** - the studio owner managing the roster: who exists, their job title and weekly capacity, whether they have a working login, their access scope (which clients and which role), and the org chart. This is also where a hire is invited and where an admin can "View as" a team member to sanity-check their scoped view.
- **`/permissions`** - the granular feature-visibility builder: per-team-member and per-client Inherit / Allow / Deny overrides on top of role defaults, with a reason field and a change history. It renders the exact same `TeamAccessPane` component as Settings → Team & access; `/permissions` is a shortcut, not a second implementation.
- **`/tracks`** - currently a thin stub. A studio caller who reaches it sees only an explainer card ("Manage tracks from a client") with a link to `/clients`; there is no studio-wide track board in the live app. The design project (`ops.jsx` `Tracks`) has a full studio-wide, cross-client track-queue module that has never been ported - see section 6.

What must never show here:

- No client-scoped data. These are Tahi-org-only surfaces; a scoped or roleless team member must see nothing until granted a role (deny-by-default - see section 5).
- No feature this group's routes guard behind `super_admin`/`admin` should leak to a `team_member` who lacks the resource: `/capacity` has no seeded permission-catalogue row for its resource (confirmed in migrate route seed `0041`, `lib/permissions.ts` `FEATURE_RESOURCE` comment), so **every** team_member is denied by default unless a `feature_visibility` allow lifts them in. Correction: `/team` is NOT in that unseeded set - seed 0041 DOES include a `team` resource row and explicitly grants `team.view` to `project_manager`, so a team member holding that role sees `/team` by default; only `capacity` (plus `billing`/`content_studio`/`social`/`reviews`/`financial_reports`) is the unseeded, explicit-allow-only group. `/permissions` is `admin`+ only via `requirePageManage()` - no team_member role, however senior, opens the builder itself.
- No dead or cosmetic denial. TASKS T1.6 records that a client `feature_visibility` deny is nav-cosmetic only today; a route that should be 403 for a denied caller currently just renders. That gap is out of scope for this group's routes (they are gated at the page level already) but is a live invariant risk elsewhere - call it out only as background, not a change owed by this group.
- Messages-hidden rule: not applicable here (no client ever reaches these routes), but the same "visible = permitted" doctrine (`memory/project_permissions_vision`) applies to the Team/Clients tabs inside `/permissions`: a subject with no grant must show as having no grant, never as a silently-full seat.

---

## 2. Pages, sub pages and entry points

### `/capacity`
- Single page, no tabs or sub-routes. Entry: sidebar nav item "Capacity" (Operations group), or a direct link from `/team` → Team KPI context in the design (`ctx.go('capacity')`, not present in the live nav yet).
- No dialogs or slide-overs. All content is inline: KPI strip, a utilisation bar, a "Pipeline Capacity Impact" card (best/worst/weighted case + a monthly table), an 8-week `LineChart` timeline, a per-member capacity bar list, and a "Sales Call Helper" panel with an inline hours input and a "Check Availability" calculator that calls the same `start-date` endpoint with a caller-supplied number.
- Refresh button in the `PageHeader` re-fetches the SWR bundle (`/api/admin/capacity/start-date`, `/api/admin/capacity/forecast`, `/api/admin/team-members`) rather than a single `/api/admin/capacity` endpoint despite the SWR key name.

### `/team`
- Two view tabs inside one page, state in a client-side `view` variable (not URL-addressable - reload always returns to Members): **Members** (DataTable) and **Org chart** (`OrgChart` component).
- Entry points: sidebar nav item "Team"; the "Manage tracks from a client" stub links out from `/tracks`; nowhere else links in today.
- Slide-overs and dialogs, all triggered from a row's overflow menu or the header:
  - **Add member** slide-over (header "Add member" button): name, email, title, role select, comma-separated skills, weekly capacity, contractor checkbox, and a "Send a workspace login invite" checkbox that fires a second call to `/api/admin/team/[id]/invite` after creation.
  - **Edit member** slide-over (row action "Edit"): same form, pre-filled, PUT to `/api/admin/team/[id]`.
  - **Access rules** slide-over (row action "Manage access", icon Shield): access role (Project Manager / Task Handler / Viewer), client scope (All clients / By plan type / Specific clients with a checkbox list fetched from `/api/admin/clients`), track type (All / Small only / Large only). PUT to `/api/admin/team/[id]/access`. This is the legacy `teamMemberAccess` table editor - a second, older access model that coexists with the newer role-based system the `/permissions` page edits (see section 5, "two access systems").
  - **Remove member** confirm dialog (row action "Remove", danger tone): DELETE to `/api/admin/team/[id]`, copy warns that access rules are deleted too.
  - **"View as"** row action: fetches the member's access rules and stores them client-side (`setTeamMemberImpersonation`), then navigates the admin to `/overview` under that simulated scope. This is a client-side simulation, not the server-enforced Client-view/Act-as-client preview (`AR.6`/`AR.8`); it does not change what the server actually returns.
  - **"Send login invite"** row action (only shown when `clerkUserId` is null): posts to the invite route, toasts success/failure, does not open a dialog.
  - A dismiss-free "Add me" banner when the signed-in Clerk user has no linked `teamMembers` row (self-provision flow), and a warning banner listing how many roster rows have no login at all.
- Org chart tab controls not mentioned above: a department filter select and an inline "Add Planned Role" form (`AddPlannedRoleForm`, expands in place rather than a slide-over) that posts title/department/priority to `POST /api/admin/planned-roles`, for the not-yet-hired roles the tree also renders. Clicking a real member's node calls `router.push('/team?member=' + memberId)`, but the Members tab (`team-content.tsx`) never reads a `member` search param - the click is a dead control today (no scroll-to-row, no auto-opened Edit slide-over, just a reload back to plain `/team`); see section 4's "wrong or half built" for `/team`.
- No `/team/[id]` detail route exists; all editing happens through slide-overs on the list.

### `/permissions`
- Single page that mounts `TeamAccessPane` (the same component used at `/settings?section=team-access` / `/settings?section=permissions`). No separate `/permissions` routing state of its own.
- Three tabs inside the pane: **Team members**, **Clients**, **Roles** (`tab` state, not URL-addressable).
- Master-detail: selecting a subject (team member or client org) in the left list opens `SubjectDetail`/`ContactDetail` on the right (mobile: a "push" panel, `showDetail` state). A client subject can be drilled further into an individual `contact` (`selContact`).
- Per-subject actions: role/scope editor inline in the detail pane, a **Feature overrides** slide-over (`FeatureSlideOver`, opened per subject) with the Inherit/Allow/Deny tri-state control per FEATURE_TREE node plus a required-on-override reason field, a **Copy access** dialog (`CopyDialog`) to clone one subject's scope/overrides onto another, and a **preview-as** action that sets the Client-view or team-member-impersonation cookie.
- A **Change history** view (`view: 'history'` state) replaces the list/detail with `ChangeHistory`, an audit trail of who changed what, for whom, and why.
- **Roles** tab shows `RolesMatrix`, the effective Allow/Deny grid per role across every FEATURE_TREE node, with override dots where a specific role's default has been hand-tuned.
- Data source: `/api/admin/permissions/subjects` (team members + client orgs + role catalogue in one payload).

### `/tracks`
- Single page. A client caller never reaches it (redirected to `/requests` server-side). A studio caller with any permission grant (`requirePageAnyGrant`) reaches it and sees only an `EmptyState`: "Manage tracks from a client" / "Open a client to see and reorder their track queue. This page is the client-facing view." with a "Go to clients" CTA to `/clients`.
- The component (`TracksContent`) still contains a full client-facing branch (SWR fetch of `/api/portal/capacity`, `TrackQueueView` render, drag-reorder via `PUT /api/portal/capacity/reorder`, ghost-track upsell tiles, a billing-upgrade CTA) but that branch is **unreachable in the live app**: `isAdmin` is always `true` by the time `TracksContent` renders, because `page.tsx` already redirected any non-studio caller before the component mounts. This is dead code today, not a working client view accessible from `/tracks`.
- A client's real track view lives elsewhere: the client home page's `TrackBoard` widget and the client-scoped requests board, both fed by `/api/portal/tracks` and `/api/portal/capacity`.

---

## 3. States and variants

**`/capacity`**
- Loading: page title + subtitle render immediately, body is `LoadingSkeleton rows={8}`.
- Empty: no explicit empty state distinct from zero values - a studio with zero team members renders all KPIs as `0`/`0%` and the "no open deals" and "no capacity data" inline messages inside their cards; there is no leaf-icon `EmptyState` for a fresh workspace the way other v3 pages have.
- Error: `EmptyState` (Gauge icon) "Unable to load capacity data" with a Retry CTA that re-runs the SWR fetch.
- Read-only client view: N/A, route is studio-only.
- Member vs admin seat: identical rendering for anyone who passes the `capacity` feature gate; no role-conditional UI inside the page itself.
- 375px: KPI strip and the three-column Pipeline Capacity Impact grid collapse to `grid-cols-1`; the monthly table sits in a manual `h-scroll` wrapper (horizontal scroll, not a stacked-card mobile pattern) - worth checking against the 44px-touch-target rule during the design pass.
- 768px: KPI strip likely still single or two columns depending on the `KPIStrip` component's own breakpoints (not overridden here).
- Dark mode: entirely token-driven (`var(--color-*)`), should carry over automatically; not yet live-verified per STATUS.
- Print/public: not applicable.

**`/team`**
- Loading: `DataTable` internal loading state (`loading` prop), KPI strip and donut/insight cards are hidden while `loading` is true rather than skeletoned.
- Empty (no members at all): `EmptyState` "No team members yet" / "Add your first team member to get started." with an Add member CTA.
- Empty (filtered to no matches): `EmptyState` "No matches" / "Try clearing a filter or adjusting your search."
- Error: none surfaced explicitly - a failed `/api/admin/team` fetch just leaves `members` as `[]`, which renders as the "No team members yet" empty state rather than a distinct error state. This is a gap worth flagging in the design (see section 4, "wrong or half built").
- Read-only client view: N/A, route is studio-only.
- Member vs admin seat: a team_member who is denied the `team` feature never reaches this page (page-level redirect); a team_member who IS granted `team` sees the identical admin UI, including invite/remove/access controls - there is no reduced "viewer" rendering of this page today even though a `viewer` access role exists conceptually.
- Org chart tab at 375px/768px: not verified in this review; the component has its own department colour system and expand/collapse tree, worth an explicit mobile check during design.
- Dark mode: token-driven, department colours use CSS custom properties, should hold up; not yet live-verified.
- Print/public: not applicable.

**`/permissions`**
- Loading: `SubjectsResponse` SWR - no explicit skeleton spotted in the excerpt read; assume the pane's own list-loading state applies (worth confirming visually in the design pass, since this pane also renders inside Settings where a skeleton may already exist).
- Empty: a workspace with only Liam/Staci and no other team members or clients would show an empty Team members / Clients list; no bespoke empty-state copy identified in the code read for this review - flag as an open question in section 7 if the design doesn't already cover it.
- Error: not identified in the code read; needs confirming in the design pass.
- Read-only client view: N/A, route is studio-only (`admin`+ via `requirePageManage`).
- Member vs admin seat: only `admin`/`super_admin` (`canManagePermissions`) ever render this page - a `team_member`, however senior their role, is redirected to `/overview`. There is no reduced or read-only team_member rendering of the builder.
- 375px: master-detail becomes a "push" panel (`showDetail` state) rather than a fixed two-pane layout - confirm this is smooth on a real 375px device, not just logically toggled.
- 768px: not independently verified; likely still push-panel given the breakpoint sits between mobile and the desktop two-pane split.
- Dark mode: the pane imports `settings.css` and reuses design tokens; not yet live-verified per STATUS ("client-session QA of portal sections still pending" refers to Settings broadly, this pane specifically not called out).
- Print/public: not applicable.

**`/tracks`**
- Loading: none needed for the studio (only) branch - it renders the stub `EmptyState` synchronously, no fetch happens for an admin.
- Empty: the stub itself IS effectively a permanent "empty" state for every studio visit - "Manage tracks from a client" always shows, there is no populated variant reachable in the live app today.
- Error: N/A for the reachable (studio) branch - no fetch, no failure mode.
- Client view: technically coded (loading skeleton, `EmptyState` "No tracks available" with a billing CTA, populated `TrackQueueView`) but **dead code**, unreachable because clients are redirected before this component mounts. Do not design against this branch as if it is live; if Liam wants a client tracks page restored, that's a routing decision (see section 7), not a rendering gap.
- 375px/768px/dark mode: only the reachable studio stub matters today; it is a single `EmptyState` card, low risk.
- Print/public: not applicable.

---

## 4. Features and actions

### `/capacity`

**Works today:**
- Live-computed KPIs: total team capacity, committed hours (from subscriptions), utilisation %, available hours, all from `POST /api/admin/capacity/start-date` and `GET /api/admin/capacity/forecast`.
- Pipeline capacity impact: weighted / worst-case (>50% probability deals only) / best-case (all open deals) hour projections, sourced from real deal data, with a monthly breakdown table.
- 8-week capacity timeline chart (Recharts `LineChart`): total capacity, committed, committed+pipeline.
- Per-team-member capacity bar list, sourced from `/api/admin/team-members`.
- Sales Call Helper: type in hours/week, calls `start-date` with that value, returns an honest "earliest start" date or "not enough capacity in the next 12 weeks."
- Page-level feature gate (`capacity` FEATURE_TREE key) and studio/client redirect both enforced server-side.

**Exists but wrong or half built:**
- No feature-tree resource row seeded for `capacity` (T1.18): a `team_member` role by default cannot see this page even with a normal role, since the resource has no seeded permission-catalogue row - only an explicit `feature_visibility` allow grants it. This may be exactly the intended "studio-private" posture, but confirm with Liam it isn't an oversight (see section 7).
- No distinguishing empty state for a fresh workspace with zero team members - the page just renders all-zero KPIs, which can read as broken rather than as "add your team first."
- `next-surfaces-assessment` / STATUS flags nothing capacity-specific beyond the T1.18 nav-gating item; this page itself is not called out as buggy.

**Planned or missing:**
- **T1.18** - nav gating: `filterNav` never honours `item.adminOnly` and `/capacity`'s feature mapping is one of six that let a `task_handler` open a page it should never see the entry point for (page-level guard still applies; the leak is the nav visibility, not a data leak).
- Design port (**H4**, catalogue): `ops.jsx` `Capacity` module is verdict SHIP at Pass 3 ("correctly exempt from the rail") and not yet ported into the real shell. The design's version differs materially from live in framing (studio-level "who is booked, who is free" per-person load rows plus an 8-week bar/stack outlook with a leave-note annotation) versus the live page's KPI-strip + line-chart framing - the design is richer, not just a reskin. Treat this as a genuine redesign-and-port, not a cosmetic pass.
- No task references a `/capacity` bug beyond nav gating; effort in the catalogue is "Port only, 1d," which likely undercounts if the richer design (per-person load rows, drill-in drawer, "can we take this on" sales-call card) is what ships.

### `/team`

**Works today:**
- Full CRUD on the roster (`GET/POST /api/admin/team`, `PUT/DELETE /api/admin/team/[id]`), skills, weekly capacity, contractor flag, avatar.
- Clerk workspace invite send/resend (`POST /api/admin/team/[id]/invite`), with an honest roster/invite failure split (roster add can succeed even if the invite email fails).
- Legacy `teamMemberAccess` scope editor (role, client scope by all/plan/specific, track type) via the Access slide-over - this is a real, working write path, distinct from the newer role/`feature_visibility` system `/permissions` edits.
- Org chart tab (`OrgChart` component), department colour-coded, includes planned (not-yet-hired) roles alongside real members.
- Self-link banner for a signed-in admin with no roster row; "no login" banner surfacing every unlinked member so a silent-notification gap is visible rather than hidden in the table.
- KPI strip (headcount, weekly capacity, avg per person, contractor count) and a discipline-mix donut, all derived client-side from the same roster payload (no extra fetches).
- Page-level feature gate (`team` FEATURE_TREE key) plus studio/client redirect.

**Exists but wrong or half built:**
- **Design verdict FIX** (`ops.jsx` Team, Pass 3): "person row mangled, emails truncate, role chips stack, two fewer people visible" - this is a design-file defect to fix before port, not a live-code bug.
- **Two coexisting access systems**: the Access slide-over on this page writes the older `teamMemberAccess` table (role/scopeType/planType/trackType/orgIds); `/permissions` and the newer role system (`team_member_roles`, `feature_visibility`) are what `lib/permissions.ts`'s deny-by-default logic actually reads for page/route gating. A team member could have a `teamMemberAccess` row that says one thing and a `team_member_roles` assignment that says another. This dual-model reality should be named plainly in the ported design, not smoothed over - Liam should decide whether `/team`'s Access panel should be retired in favour of `/permissions` doing all scope editing (open question, section 7).
- **T1.20** - the invite link from `/team`'s Add-member flow goes through the Clerk workspace-invite path (works), but the OLDER token-based invite flow (`POST /api/admin/onboarding-invites` with `flow:'team'`, `/welcome`) is fully dead: `resolveToken` is a stub and `/welcome` hardcodes fake personalisation (role "New teammate", gear "MacBook Pro 16", buddy "Liam Miller") for every hire. Lower priority than T1.17 since the Clerk-invite path already works, but if any live surface still points a hire at `/welcome`, that surface is showing invented content.
- **Dead click-through, no tracked task:** the Org chart tab's member node click (`components/tahi/org-chart.tsx`, `handleMemberClick`) navigates to `/team?member=<id>` expecting the Members tab to land on or open that person; `team-content.tsx` never reads a `member` search param, so the click just reloads the page to the default Members view with no row highlighted or slide-over opened. Not referenced by any TASKS.md line found in this review - a real gap, not a documented one.

**Planned or missing:**
- **T1.17** - hire onboarding path is still open per TASKS.md: verified-email backfill on the dashboard layout, gating the team write routes properly, a Linked/Not-linked column (**this already exists live** - the "Login" DataTable column with Linked/Not-linked badges - treat T1.17's remaining scope as the backfill + gating half, the column half is done).
- **T1.18** - same nav-gating fix as Capacity; `/team` itself is one of the pages whose page guard is already correct (`requirePageFeature('team')`), the gap is nav visibility only.
- **T1.19** - not this route directly, but the teammate-home leak (studio-wide discovery calls, unscoped docs) is adjacent context: a teammate whose `/team` access scope looks correctly narrow can still see studio-wide data elsewhere, which undermines trust in what `/team`'s Access panel promises.
- Design port (**H1**, catalogue, "Team" part): re-critique the row-layout fix, then port.
- **Proposal**: a `/team/[id]` or expanded detail view is not in the backlog; if the design wants one (beyond the current slide-over model), mark it a proposal, not an existing plan.

### `/permissions`

**Works today:**
- Full `TeamAccessPane`: three tabs (Team members / Clients / Roles), search, master-detail, role assignment, data-scope editor (all/by-plan/specific-clients - this is the SAME conceptual data as `/team`'s Access slide-over but reads/writes the newer system), per-feature Inherit/Allow/Deny overrides with a reason field via `FeatureSlideOver`, `RolesMatrix` effective-permission grid, `ChangeHistory` audit trail, `CopyDialog` to copy one subject's access onto another, and preview-as (both Client-view and team-member-impersonation).
- Server-side deny-by-default already shipped in `lib/permissions.ts` and `lib/access-scoping.ts` (see section 5) - this is a meaningfully more current state than TASKS.md's open `T1.15` line suggests; the code comments in both files describe the deny-by-default behaviour as implemented and reasoned through (super_admin/admin bypass, MCP service token exception, unseeded-install bootstrap exception all present). Treat T1.15 as likely already resolved in code and confirm with Liam before re-doing the work (section 7).
- Page gate: `admin`+ only (`requirePageManage`), studio/client redirect.

**Exists but wrong or half built:**
- **T1.6** - a client `feature_visibility` deny is enforced in the nav (hidden) but TASKS.md records it is not yet enforced at the API-route level for portal routes, so a denied client who guesses/bookmarks a URL may not get a clean 403 everywhere. This is a route-enforcement gap outside `/permissions` itself but is exactly the kind of thing this builder promises ("visible = permitted, absent = denied") and should not silently under-deliver.
- **T1.18** - six nav items (including `capacity`, `billing`, `content_studio`, `social`, `reviews`, `announcements`) have no `FEATURE_RESOURCE` mapping, so `decideFeature` defaults them open for a `team_member` at the nav layer even though the page-level guard (where one exists) still gates correctly. `/permissions` is the tool that is supposed to let Liam close this gap per-subject, but the underlying mapping bug means an override on those six keys may not behave as a normal team member would expect from the nav.

**Planned or missing:**
- No design file is critic-covered for `permissions.jsx` (catalogue: "not critic-covered"). It reads as already close to the live component in structure (roles, FEATURE_TREE groups, tri-state control, scope control, change history, copy-access) from the direct MCP read - recommend a first critic pass rather than assuming parity, since the design and the live component were clearly built in step but have not been diffed against each other.
- **Proposal**: if Liam wants `/team`'s legacy Access slide-over retired in favour of `/permissions` owning ALL scope editing (both the coarse `teamMemberAccess` model and the granular `feature_visibility` model), that consolidation is not in any tracked backlog item today - flag as a design decision, not an existing task.

### `/tracks`

**Works today:**
- Correct tenancy behaviour: a client is redirected to `/requests` before any track data for another client could ever be requested; a studio caller with any grant sees the explainer stub. This matches the TASKS.md S1 decision ("/tracks bounces a client to /requests") and is functioning as designed.
- The "client-facing" code path inside `TracksContent` (ghost-track upsells via `getUpgradeGhostTracks`, reorder via `/api/portal/capacity/reorder`, unified vs multi-track bucketing via `lib/track-lanes.ts`) is real, tested logic - it is simply unreachable at this URL today, not broken logic. The same logic and lanes power the client home `TrackBoard` widget, which IS live and reachable.

**Exists but wrong or half built:**
- The page component still ships a large, dead client-facing branch that can never render given the current routing. This isn't visibly "wrong" to a user (nobody sees it) but is dead weight in the codebase and a trap for a future edit that assumes it's reachable.
- Catalogue's current description of `/tracks` ("Legacy and orphaned, linked from nowhere... drag to reorder") describes the OLD, pre-S1 behaviour where a client could reach this page directly. That has already changed (S1 shipped the redirect). The catalogue line is stale on this specific point; CT.18's premise ("delete it, since the client home TrackBoard already tells the story") is still valid, but for a route that no longer serves clients at all rather than one still competing with the home widget.

**Planned or missing:**
- **CT.18** (Liam decision, 0.25d to decide) - delete `/tracks` entirely (nothing links to it for a client since S1; the redirect makes the client-facing code genuinely dead), OR redesign it as the studio-wide cross-client track board. TASKS.md frames this as "delete," but the design project's `ops.jsx` `Tracks` module (see section 6) is a full, considered studio board that was clearly designed to fill exactly this URL - the decision is no longer "delete vs. leave broken," it is "delete vs. port the studio design." This is the central open question for this route (section 7).
- If ported, the studio `Tracks` module from `ops.jsx` brings real, non-trivial functionality that does not exist anywhere live today: a cross-client "every retainer slot in the studio" board grouped by client, KPIs (tracks running, slots open, queued behind, waiting on the client), per-track queue reordering with a confirm step when the move changes what's first (asymmetric confirm: promoting always confirms, demoting the client's current #1 always confirms), an "unplaced requests" section for work with no track slot on its plan, ghost-track upsell tiles, and a "See it as they do" jump to the client view. None of this is currently backed by a studio-scoped API route - a port would need a new cross-client capacity/queue endpoint, not just a UI change (**proposal**, not currently in TASKS.md as scoped work; only the catalogue's "H1 ops.jsx Time, Team and Tracks port (or CT.18 delete)" line references it, with no API design attached).
- Design verdict is REDO ("worst of that batch, titles break to single characters; critic says the rail does not belong here") - if the studio board is kept, it needs a real design fix pass before any port, not just a straight port.

---

## 5. Data and integrations

**`/capacity`**
- `POST /api/admin/capacity/start-date` - earliest date the studio could start N hours/week of new work; also used for the Sales Call Helper.
- `GET /api/admin/capacity/forecast` - pipeline-weighted hours/value forecast by month, sourced from `deals`.
- `GET /api/admin/team-members` - per-member weekly capacity.
- All admin-only, `isTahiAdmin` + `capacity` feature gate.
- Nothing here should ever show a fabricated number: every KPI traces to `subscriptions` (committed hours), `teamMembers` (capacity), and `deals` (forecast) - no placeholder or "coming soon" values found in this page.

**`/team`**
- `GET/POST /api/admin/team`, `PUT/DELETE /api/admin/team/[id]` - `teamMembers` table. GET has a two-tier response: full roster for anyone with the `team` feature, a "lite" projection (name/email/title/role/avatar only, no capacity/contractor/skills/clerkUserId) for anyone without it, since this endpoint doubles as the roster source for @mentions and message participant pickers.
- `POST /api/admin/team/[id]/invite` - Clerk workspace invitation.
- `GET/PUT /api/admin/team/[id]/access` - legacy `teamMemberAccess` table (see section 4's "two access systems" note).
- `GET /api/admin/team/org-chart` - org chart tree, including planned/not-yet-hired roles.
- `POST /api/admin/planned-roles`, `.../[id]` - creates/edits the not-yet-hired roles the org chart's inline "Add Planned Role" form writes.
- `GET /api/admin/clients` - org list for the Access slide-over's "specific clients" picker.
- Third party: Clerk (workspace invites, `clerkUserId` linkage).
- Honesty check: the "Linked / Not linked" login badge and the "no login" banner are both real, live-computed from `clerkUserId IS NULL`, not decorative.

**`/permissions`**
- `GET /api/admin/permissions/subjects` - team members + client orgs + roles in one payload.
- Underlying write paths (inferred from `TeamAccessPane`'s description; not individually traced in this review, confirm exact routes with a BE agent before port): role assignment, data-scope, `feature_visibility` override writes, copy-access, change-history reads.
- Third party: Clerk (for preview-as / impersonation cookies), same permission resolver (`lib/permissions.ts`) that every guarded page and portal route reads.
- Honesty check: the "not enforced yet" annotation pattern visible in the `ops.jsx` design mirror (`D.NOT_ENFORCED`, next to access roles) is exactly the right instinct - carry it into the live pane wherever a control edits a rule that a route doesn't yet check (e.g. T1.6's route-level enforcement gap).

**`/tracks`**
- Reachable (studio) branch: no data fetch at all.
- Dead client branch: `GET /api/portal/capacity`, `PUT /api/portal/capacity/reorder` - both real, tenancy-scoped routes, exercised today by the client home `TrackBoard`, not by this URL.
- `tracks` FEATURE_TREE key applies to the `client` audience only and has `route: '/tracks'` - this is what `/api/portal/tracks` gates on to power the client home widget; it is not what gates the studio `/tracks` page (which uses `requirePageAnyGrant`, "holds any grant at all," with no feature key of its own).
- A studio track board, if built, would need its own new cross-client aggregation endpoint (no live equivalent) - see section 4.

**Cross-cutting: deny-by-default (T1.15).** `lib/permissions.ts` and `lib/access-scoping.ts` both currently implement deny-by-default in code, with explicit, commented exceptions for the MCP service token and an unseeded install, and with the super_admin/admin role bypass preserved. TASKS.md still lists `T1.15` as `[ ]` "in progress" - this looks like a stale checkbox rather than an accurate reflection of the code as read on 2026-09-13. Confirm with Liam before assigning any design or build work against "flip deny-by-default," since it appears to already be flipped (open question, section 7).

---

## 6. Design system contract

**Primitives already in use, correctly, on all four live pages:** `PageHeader`, `KPIStrip`/`KPICell`, `DataTable` (Team), `FilterBar` (Team), `SlideOver` (Team's three editors), `ConfirmDialog` (Team's remove), `Card`, `Badge`, `Avatar`, `EmptyState`, `LoadingSkeleton`, the leaf radius on icon wrappers (`--radius-leaf-sm` on the Capacity KPI icon boxes), and CSS var tokens throughout (no hardcoded hex spotted in any of the four page components).

**Left rail / headline band:** none of these four pages currently use the left-rail + headline-band pattern that Requests and Tasks use (`RailLayout`/`Rail` in the design system). The `ops.jsx` design file DOES use a rail on Team (`Rail label="Team filters"`, a Seat filter list) and a chip-based scope switcher on the studio Tracks module - but Pass 3's critic verdict flags this exact choice as wrong for Capacity ("correctly exempt from the rail," meaning Capacity should NOT get one) and implicitly questions it for Tracks ("the critic says the rail does not belong here" on the Tracks REDO verdict). Read together: **Capacity should stay without a rail** (already true live, keep it that way in the port), **Team's existing FilterBar (not a rail) is the live pattern and should probably stay that way** rather than being replaced by the design's rail, and **Tracks' scope switcher, if the studio module is built, should use the chip-scope pattern already in the design (`Chip on={scope==='all'}`, per-client chips) rather than a rail** - the design file itself already avoids a rail here in favour of chips at the top, so the critic note is likely about something else in the Tracks layout (title truncation), not the chip scope switcher. Confirm this reading with a fresh critic pass before porting rather than assuming.

**What the existing design gets right:**
- `ops.jsx` Capacity: rich, humane copy throughout ("Ask before you promise a start date on a call," "The work did not grow, the studio shrank" on a ceiling-drop note) - a strong model for tone even where the port keeps live's simpler KPI-strip framing.
- `ops.jsx` Team: the "how a scope reads" legend section, the "not enforced yet" honesty marker on unenforced access roles, and the per-person "Can see" line with a `bad`-tone icon when a scope is empty are all exactly the "visible = permitted, absent = denied" doctrine made concrete in UI - worth carrying into the live port even beyond a visual reskin.
- `ops.jsx` Tracks (studio): the asymmetric confirm-on-reorder behaviour (confirm only when the move changes what's first) is a genuinely considered interaction, not decoration - carry it into any port rather than treating Tracks as "just a kanban."
- `permissions.jsx`: structurally close to the live `TeamAccessPane` (same tabs, same tri-state control, same reason-on-override pattern, same change history) - this design and the live build clearly evolved together, which is unusual good news for this group.

**What the design must change before port (from the checklist's SHIP/FIX/REDO verdicts):**
- **Capacity: SHIP** (Pass 3) - cleared to port once a BE agent confirms the per-person "load row" and drill-in-drawer framing is buildable against real data (it needs logged-time-vs-committed-vs-billable splits per person, which the live page does not currently compute).
- **Team: FIX** (Pass 3) - "person row mangled, emails truncate, role chips stack, two fewer people visible." Needs a layout fix in the design file before port; do not port as-is.
- **Tracks (studio): REDO** (Pass 3, "worst of that batch, titles break to single characters"). Needs a real redesign pass, not a fix-and-port. Given CT.18 is still an open Liam decision (delete vs. keep), the REDO work should not start until that decision lands - no point redesigning a page that might be deleted.
- **Permissions: not critic-covered.** Recommend a first critic pass before treating it as ready, despite the strong structural overlap with the live component - "close in structure" is not the same as "SHIP."

---

## 7. Open questions for Liam

1. **`/tracks`: delete (CT.18) or build the studio cross-client track board from `ops.jsx`?** The client-facing danger CT.18 originally worried about (a client reaching an orphaned drag board) is already resolved by the S1 redirect - the live decision is now purely "does the studio want a cross-client capacity/queue board," not "is this page a tenancy risk." A or B?
2. **Is T1.15 (deny-by-default) actually done?** `lib/permissions.ts` and `lib/access-scoping.ts` both read as already deny-by-default with the documented exceptions. TASKS.md still marks it open. Should this checkbox be flipped to done, or is there a known remaining gap not visible in the code read? Yes or no.
3. **Should `/team`'s "Access rules" slide-over (the legacy `teamMemberAccess` model: role/scope/plan/track type) be retired in favour of `/permissions` owning all access editing?** Today a team member's real, enforced permissions come from the newer role + `feature_visibility` system, but `/team` still exposes a working editor for the older model side by side. Keeping both risks a Liam edit in one place not matching what the other place shows. A (retire `/team`'s Access panel, link to `/permissions` instead) or B (keep both, and make it obvious in the UI which one is authoritative)?
4. **Is `capacity` being unseeded in the permission catalogue (so every `team_member` is denied by default) intentional as a permanent studio-private surface, or should a role eventually be able to see it (e.g. project_manager)?** Yes (stays admin+/explicit-allow only) or no (should get a seeded resource row for at least one role)?
5. **Does `/permissions`' Team-members tab need a bespoke empty state for a fresh workspace (only Liam/Staci, no hires yet), or is the current list-with-two-rows treated as sufficient?** Yes (needs one) or no (current rendering is fine)?

---

## 8. Acceptance for the design review

1. At 1440px light, `/capacity`'s KPI strip, utilisation bar, pipeline-impact grid and 8-week chart all render with no rail and no left sidebar competing with the content - matches the Pass 3 "correctly exempt from the rail" verdict.
2. At 375px, `/capacity`'s Pipeline Capacity Impact three-column grid collapses to one column and the monthly table's horizontal-scroll wrapper has no clipped text or sub-44px tap targets in its "Check Availability" input/button pair.
3. At 1440px light, `/team`'s Members table shows every column (Name, Title, Role, Login, Capacity, Type, Skills) without a mangled or overflowing row - the specific Pass 3 defect (emails truncating, role chips stacking, fewer people visible) must be visibly fixed, not just present in the design file.
4. At 1440px, `/team`'s "Login" badge (Linked/Not-linked) and the "no login" banner both read as genuinely different weight/urgency from a normal row - a reviewer should be able to spot at a glance which members can't sign in.
5. At 375px and 768px, `/team`'s Org chart tab renders without horizontal scroll and expand/collapse controls are at least 44px tall.
6. At 1440px and 375px, `/permissions`' master-detail behaves correctly: desktop shows list+detail side by side, mobile pushes to a full-panel detail view with a working back action, and the Feature-overrides slide-over's tri-state control (Inherit/Allow/Deny) is legible and tappable at 375px.
7. Dark mode (`.dark` class) on all four pages shows no contrast regression on status-tone elements specifically: the Capacity utilisation bar's three tones (brand/warning/danger), Team's Login badges (positive/warning), and Permissions' tri-state buttons (on/off states).
8. If Liam's CT.18 decision (question 1) is "build," the ported `/tracks` at 1440px shows the studio-wide, per-client-grouped track board with working KPIs and the asymmetric reorder-confirm behaviour; if the decision is "delete," the route no longer exists in the nav and `/tracks` 404s or redirects cleanly with no dead nav entry left behind.
9. No page in this group shows a fabricated number or a button with no wired action: every KPI on `/capacity`, every roster field on `/team`, and every override control on `/permissions` traces to a real API call verified in section 5, and any control that edits a rule not yet enforced server-side (the T1.6 gap) carries an honest "not enforced yet" marker rather than implying it already works.
10. A reviewer can distinguish, at a glance on `/team`, which access model (legacy `teamMemberAccess` vs. the newer role/`feature_visibility` system read by `/permissions`) a given control edits, per question 3's resolution - the design should not present two silently-competing "access" controls as if they were one system.
