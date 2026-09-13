# Design requirements: studio-schedules

Group: studio-schedules (audience: studio only). Routes: `/schedules`, `/schedules/[id]` (gantt builder), `/schedules/templates`. A fourth route, `/preview/schedule/[id]`, is the admin-only live preview reached from the builder's Preview button; it reuses the public viewer component and is documented here as an entry point, not as its own design surface (its design is the public schedule viewer, out of scope for this group).

Sources read: CLAUDE.md, STATUS.md ("Since the last update" and the triage snapshot), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (rows for `/schedules`, `/schedules/[id]`, `/schedules/templates`, and the functionality table), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, every `schedule`-mentioning line in TASKS.md, the live code under `app/(dashboard)/schedules`, `components/tahi/gantt-grid.tsx`, `components/tahi/schedule-section-renderers.tsx`, `components/tahi/builder/index.tsx`, `app/api/admin/schedules/**`, `app/api/admin/_sales-access/artifact-scope.ts`, `app/p/schedule/[token]/schedule-viewer.tsx`, `app/preview/schedule/[id]/page.tsx`, and the Claude Design file `sales-artifacts.jsx` (`SchedulesList`, `ScheduleEditor`, `GanttEditor`, `RowEditor`, `RiskEditor`, `RaciEditor`, `ArtifactTemplates`) in project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`.

## 1. Purpose and audiences

Schedules are the studio's internal tool for building and maintaining a project's week-by-week plan (a Gantt of phases, tasks and sign-off gates) and for turning that plan into a client-facing document. The whole surface is studio-only: nobody outside Tahi opens `/schedules`, `/schedules/[id]` or `/schedules/templates`. A client only ever sees the *result* of this work through the separate public viewer (`/p/schedule/[token]`) or the read-only "Your tracks" schedule card on their portal home, neither of which is part of this group.

Who opens it: any Tahi team member with the `schedules` feature granted (see Permissions below). In practice today that is Liam and Staci (super_admin bypasses all scoping) plus any hire a super_admin grants schedule access to.

What it must never show:
- **Tenancy.** A team member scoped to specific clients must only see schedules belonging to those clients (or to deals/leads belonging to those clients). `app/api/admin/schedules/route.ts` and every `[id]` sub-route call `scopedOrgIds` / `requireScheduleAccess`; an unassigned schedule (no `orgId` and no `dealId`) is visible only to unrestricted callers. This is live (STATUS: "Per-org scoping batch A is done for contracts, proposals and schedules including share, publish and email").
- **Client access.** The page-level guard redirects a client org straight back to `/requests`: `if (!isAdmin || isPreviewingClient) redirect('/requests')` in both `page.tsx` files. A team member previewing a client's view (the `tahi-impersonate-org` cookie) is treated exactly like a real client and bounced, so an impersonation session can never let one client see another client's schedule.
- **Permission gate.** `requirePageFeature('schedules')` runs server-side on both pages; a roleless or denied team member is redirected before any schedule data loads. Visible in the sidebar must equal permitted on the page must equal 403'd on the API: the three-way parity rule from `lib/page-guard.ts`.
- **Super admin only:** nothing on this surface is super-admin-exclusive beyond the ordinary admin gate; scoped team members with the `schedules` grant can reach the same pages, filtered to their orgs.
- **The Messages-hidden rule** does not apply here (Messages is a separate nav item, not surfaced inside schedules), but note the same honesty principle applies: every button on this surface must do what it says (see section 4's "wrong or half-built" list for the one open exception).

## 2. Pages, sub pages and entry points

**`/schedules`**: the list. Reached from the sidebar (Sales area) or from any "Schedules" breadcrumb link (e.g. the back arrow on the detail page, or `Link` from the templates page). No query-string state; filtering/search/sort live in component state only (not shareable via URL). The `PageHeader` also carries a "Refresh" button (`mutateSchedules()`, no confirmation, no loading spinner of its own) alongside "Templates" and "New schedule": a manual re-fetch, not documented elsewhere in this section.
- **New schedule dialog** (`<NewScheduleDialog>`): opens as a centred modal on "New schedule" click. Lets the user set a title, optionally attach a Client, a Deal, or a Lead (mutually related pickers, lazy-loaded from `/api/admin/clients`, `/api/admin/deals`, `/api/admin/leads`), and optionally pick a template. Submitting creates the schedule and routes to `/schedules/{id}`.
- **Delete confirm dialog** (`<ConfirmDialog>`): opens from a row's "Delete" row-action.
- **Row actions menu** (per row, via `DataTable` `rowActions`): Preview (routes to `/schedules/{id}`), Open public viewer (new tab, only when a share token exists), Delete.

**`/schedules/[id]`**: the builder. Reached by clicking any schedule row, by "Create and edit" from the New schedule dialog, or by a direct link (e.g. from a client detail page's Linked-to panel, or a deal's sales kit). State lives in one `activeView` string that drives the centre pane; nothing is reflected in the URL (`?section=` is not implemented: reloading the builder always lands back on Cover).
- **Cover** (`activeView === 'cover'`): the default view: title, eyebrow/subtitle, prepared for/by, effective date, target launch date, number of weeks.
- **Section views** (`activeView === 'section:{id}'`), one per section the schedule owns, navigated via the right-rail navigator (`BuilderNavGroup "Schedule"`). Section types: `gantt`, `overview`, `risk_register`, `raci_matrix`, `text`.
  - Inside a `gantt` section: an inline sticky **row editor** opens on clicking any row (`editingRowId` set): row type, label, owner, start/end week, risk-overlay checkbox, and a **Linked work** sub-panel (search + attach/detach requests and tasks from the schedule's org).
  - `risk_register` and `raci_matrix` sections are **read-only previews** in the current build (`PreviewOnlySection`: "structured editor lands in a follow-up"); there is no add/edit/delete UI for risk rows or RACI cells today, only the read-only render.
  - `overview` and `text` sections open the Tiptap rich-text editor (`ProseSectionEditor`).
- **Add section menu**: a dropdown off "Add section" in the rail; picks one of the five section types and appends it.
- **Analytics view** (`activeView === 'analytics'`): only reachable once a public share token exists; renders `<ShareAnalyticsCard>` (views, time on page).
- **Public link panel** (right rail, "Public link" section): Generate link / Copy / Open / Revoke, plus the Email-link flow.
- **Email share modal** (`<EmailShareModal>`): opens from "Email link" (rail button or header toolbar button); recipient picker seeded from the schedule's org contacts.
- **Save-as-template dialog** (`<PromptDialog>`): opens from the header's "More" menu.
- **Delete-schedule confirm** (`<ConfirmDialog>`): opens from the same More menu.
- **Preview** (header toolbar "Preview" button): opens `/preview/schedule/{id}` in a new tab: the real public-viewer component rendered against live (unpublished) data, admin-only, `noindex`. Not a separate design surface for this group; its design is the public schedule viewer's.
- **Meta panel** (right rail, "Meta" section): prepared for/by, effective date, target launch, number of weeks (duplicates the Cover-view fields; both write the same PATCH).
- **Linked-to panel** (right rail): the schedule's own client/deal/lead/proposal association, editable via `<LinkedToPanel>`.

**`/schedules/templates`**: the template library, schedules-only in the current build (contrast with the design file's unified three-kind shelf, see section 6). Reached from the "Templates" button on `/schedules`, or from the builder's More menu after "Save as template".
- **Edit template dialog**: opens per-card "Edit" link; name + description only, no content editor (content is fixed at the moment of "Save as template").
- **Delete confirm dialog**: opens per-card delete icon.
- No "New template" entry point exists on this page: templates are only created via the builder's "Save as template" action, never blank.

## 3. States and variants

One line per state per page; "n/a" where the variant does not apply to a studio-only surface.

**`/schedules`**
- Loading: `DataTable` `loading` prop renders its built-in skeleton rows.
- Empty (zero schedules): leaf-icon `EmptyState`, title "No schedules yet", body "Create one to map a project timeline you can share with clients.", CTA "New schedule".
- Empty (filtered to zero): inline `EmptyState`, title "No schedules match your filters", body "Try clearing the search or changing the status filter."
- Error: no explicit error state wired: a failed `useSWR` fetch leaves `items` as `[]` and renders the same "No schedules yet" empty state, which is dishonest for a real fetch failure (see section 4).
- Read-only client view: n/a, the route redirects clients before render.
- Member seat vs admin seat: identical UI; the difference is which rows the API returns (`scopedOrgIds`), not a UI mode.
- 375px: `PageHeader` actions wrap; `FilterBar` search + chip stack vertically; `DataTable` scrolls horizontally inside `Card`: untested against the 44px touch-target rule (row-action icon buttons are sized for desktop).
- 768px: same layout as 375 with more table columns visible before horizontal scroll kicks in.
- Dark mode: all styling routes through CSS vars (`var(--color-*)`) except the status badge tones, which come from the shared `Badge` component's tone system: should be dark-safe but has not been visually re-verified since the last badge-token change.
- Print/public: n/a.

**`/schedules/[id]`**
- Loading: two pulse-skeleton blocks (header-height bar, body-height bar) while `schedule` is null.
- Empty (a section with zero rows): `GanttGrid`'s own empty row, italic "No rows yet. Add a section header or task to get started." Not a full-page `EmptyState`: deliberately inline since the builder chrome (header, rail) is always present.
- Error: no distinct error state; a failed `PATCH`/`POST` shows a toast ("Failed to save", "Failed to add row", etc.) and rolls back optimistic state where the code tracks a `previous` snapshot (sections, rows): row-draft saves do **not** roll back the draft itself on failure, only re-fetch.
- Read-only client view: n/a, redirected before render.
- Member seat vs admin seat: identical UI; API-level 403/`requireScheduleAccess` is the only difference. There is no UI treatment for "you can see this schedule but the org isn't fully yours": access is binary.
- 375px: `BuilderShell`'s `@media (max-width: 768px)` rule stacks the rail below the main pane and hides the inline `SaveIndicator` in favour of a "Saved" toast; the `GanttGrid` itself keeps its `minWidth: 64rem` and becomes a pinch-scroll strip inside the (now full-width) main column: this is the one place in the group where the public-viewer's mobile fix (`GanttCardStack` under `useIsNarrow`) has **not** been ported into the studio editor.
- 768px: rail collapses to a single column per the `@media (max-width: 1024px)` rule; gantt strip issue persists.
- Dark mode: CSS-var driven except the hardcoded owner-bar colours in `gantt-grid.tsx` (`OWNER_BG`) and the section-header band (`#1f2c1a`/`#ffffff`), which are intentionally brand-locked per CLAUDE.md's "hardcode hex for brand-locked visuals" allowance, not a dark-mode bug, but has not been screenshotted with `.dark` applied.
- Print/public: n/a for the builder; the separate public viewer (out of scope) has its own dark/print handling.

**`/schedules/templates`**
- Loading: `LoadingSkeleton rows={4}`.
- Empty: leaf-icon `EmptyState`, title "No templates yet", body "Open any schedule, then use the More menu to save it as a template." No CTA button (correct, since there is no blank-template creation path).
- Error: no explicit error state; a failed fetch renders the same empty state as zero templates.
- Read-only client view: n/a.
- Member seat vs admin seat: identical UI; templates are unscoped/global (per `artifact-scope.ts`'s "Global templates ... carry no client data and stay unscoped"), so every team member with `schedules` access sees every template regardless of client scope.
- 375px: card grid drops from `sm:grid-cols-2` to a single column (Tailwind breakpoint), each card's action row wraps if needed.
- 768px: two-column card grid.
- Dark mode: CSS-var driven (`var(--color-bg)`, `var(--color-text)` etc.) via Tailwind arbitrary values: should be dark-safe, not re-verified.
- Print/public: n/a.

## 4. Features and actions

### `/schedules` (list)

**Works today:**
- List with search (title, org, deal, prepared-for), a permanent multiselect Status filter chip (`FilterBar`), and sortable columns (Name, Status, Org, Deal, Target launch).
- New schedule dialog with Client/Deal/Lead attachment and template picker.
- Row click and "Preview" row-action both route to the builder.
- "Open public viewer" row-action (only when shared).
- Delete with a typed confirmation dialog.
- Per-org scoping on the underlying API (Batch A, STATUS-confirmed live).

**Exists but wrong or half-built:**
- A failed list fetch is indistinguishable from a genuinely empty list: no `ErrorState` (contrast with the design file's `SchedulesList`, which has a dedicated `state === 'error'` branch: "Could not load schedules... Nothing is lost").
- No saved views, no off-track nudge banner, no delivery/health summary: the whole "what needs my attention" layer the design specifies (see section 6) does not exist in the port yet.
- No `?share=` or public-link column that surfaces "shared / not shared" at a glance beyond the Status badge.

**Planned or missing:**
- Left-rail saved views (All / Shared / Off track / Gate coming up / Drafts / Launching soon / Archived) and a headline metric band: catalogue "AR.5 Two rules everywhere: filters in a left rail on every list page... Apply in Claude Design to schedules... then port", and Batch G/H (studio v3 ports, design-led) in the catalogue's proposed order.
- Delivery-health column (progress bar + "N linked to real work" + off-track flag) driven by the same delivery-status engine already live on the detail page. Not in TASKS by id, inferred from the design file's `SCH_VIEWS`/`cols` definitions; mark this a **proposal** until Liam confirms he wants list-level delivery rollups, not just per-schedule.
- Publish-before-share for the share/email routes: catalogue functionality table lists "T3.1, T3.2, S1" as owed, but the live `share/route.ts` already snapshots on first share and STATUS's "Catalogue Batch C" entry says this shipped 2026-09-13 evening ("share links tell the truth (snapshot on first share, 404 after revoke, publish re-arms)"). **Treat T3.1/T3.2 as done for schedules**; the catalogue line is stale relative to STATUS and the code.

### `/schedules/[id]` (builder)

**Works today:**
- Cover + Meta editing (title, prepared for/by, dates, weeks), autosaving on blur with a visible save indicator.
- Section CRUD (add, reorder up/down, delete, rename, per-section eyebrow, three-way slide theme: light/dark/feature) for all five section types.
- Gantt row CRUD (section header, task, gate, critical gate), with owner, start/end week, and a risk-flag overlay that hatches the bar.
- Linked-work attach/detach (requests and tasks) per gantt row, feeding the live delivery-status engine.
- Delivery rollup banner (status dot, done/total phases, off-track count) sourced from `/api/admin/schedules/{id}/delivery-status`.
- Publish / Share / Email link / Revoke, with the publish-before-share snapshot semantics described above.
- Save-as-template, Delete schedule (with a real confirm describing consequences).
- Admin Preview (opens the real public-viewer component against live data, `noindex`, watermark pill "Admin preview, live, unpublished state").
- Share analytics (view count, per-section dwell) once shared.
- Mobile stacking of the builder chrome (rail below main, save toast instead of inline indicator) below 768px.

**Exists but wrong or half-built:**
- **Gantt strip on phones** (catalogue, both the `/schedules/[id]` row and the design-review checklist's studio schedule-editor line): `GanttSectionEditor` renders `<GanttGrid>` unconditionally; the `useIsNarrow`/`<GanttCardStack>` swap that already ships on the *public* viewer has not been applied to the *studio* editor, so building or reviewing a plan on a phone means pinch-scrolling a 64rem-wide table.
- `risk_register` and `raci_matrix` sections are permanently read-only in the studio editor (`PreviewOnlySection`, "structured editor lands in a follow-up"): a team member cannot add, edit, or delete a risk row or a RACI cell from the UI at all; the only way to populate one is the API or MCP directly, which the empty-state copy admits.
- Row-draft save failures do not restore the in-progress draft (`showToast('Failed to save row'); await mutate()` discards local edits), which can silently lose typed changes on a flaky connection.
- No URL state for `activeView`: a reload, a shared link, or a back-button always returns to Cover, so a teammate cannot deep-link a colleague to "the gantt section" or "the row I flagged."

**Planned or missing:**
- **Design, pane rebalance.** Catalogue and checklist both flag the *previous* three-pane layout (gantt getting the narrowest pane, only 6 of 14 weeks visible). The current Claude Design file (`ScheduleEditor` in `sales-artifacts.jsx`) has already fixed this at PASS-B: on the gantt view the live-preview pane stands down (`isGantt` disables `showPrev`) so the grid gets the full middle column, with "See what the client sees" as a one-click toggle instead of a permanent squeeze. This is a **port** item, not an open design problem: catalogue "Design: pane rebalance. Port: after."
- A three-pane studio layout (outline rail / editor / live preview pane) matching the design file, versus today's two-pane layout (nav+meta rail / editor, no live preview at all in the studio editor: the only "see what the client sees" is the separate Preview tab).
- Structured Risk register and RACI editors (add/edit/delete rows and cells) to replace `PreviewOnlySection`: no TASKS id found; treat as implied by "H3 sales-artifacts list ports (proposals, contracts, schedules, all three template pages)" in the catalogue's proposed order, not a named ticket.
- Section-level "Move up/down" via drag, not just buttons: design file shows the same chevron-button pattern as the port, so this is **not** a gap; noting only to confirm parity.
- AR.5's left-rail and headline-card consistency rule applies to the builder's status/delivery summary band too, once the list page's headline band is ported (keep the two visually consistent).

### `/schedules/templates`

**Works today:**
- List, rename, edit description, delete. Creation only via "Save as template" from a live schedule (by design, not a gap).

**Exists but wrong or half-built:**
- Nothing schedule-specific is broken; the page itself is intentionally minimal (`Mixed (ConfirmDialog, EmptyState, no PageHeader or DataTable)` per the catalogue) rather than incorrect.

**Planned or missing:**
- Catalogue: "`/schedules/templates`: Reusable schedule structures, rename, delete, instantiate: Port only" (0.5d, priority 4): meaning the design intends this page to fold into the **unified three-kind template shelf** (`ArtifactTemplates` in the design file) that also serves Proposals and Contracts, with a headline tile band (On the shelf / Started from a template / Reached for most / Oldest wording), a left-rail view filter (Everything / Proposals / Contracts / Schedules / Used most / Not touched in a month), preview dialogs per kind, and a dedicated "New template" entry point. This is a substantial redesign of the current page, not a like-for-like port: flag to Liam (see Open Questions) whether the unified shelf replaces today's per-kind `/schedules/templates`, `/proposals/templates`, `/contracts/templates` routes or whether schedules keeps its own page.
- "Instantiate" (start a new schedule directly from a template card, with a live preview of weeks/sections/rows before committing) does not exist today; template selection only happens inside the New Schedule dialog's compact picker grid.

## 5. Data and integrations

- **Tables:** `projectSchedules` (cover metadata, status, `publicShareToken`, `publicSharedAt`, `publishedAt`, `publishedSnapshot`), `scheduleSections` (type, title/subtitle, `startWeek`/`endWeek` zoom range, `data` JSON, `themeMode`, position), `scheduleRows` (rowType, label, owner, startWeek/endWeek, riskFlag, position, `sectionId`), `scheduleTemplates`. Delivery status is computed live from `requests.scheduleRowId` and `tasks.scheduleRowId` (no stored delivery table) via `lib/delivery-status.ts`.
- **API routes (all under `app/api/admin/schedules`):** list/create (`route.ts`), detail get/patch/delete (`[id]/route.ts`), sections CRUD + reorder, rows CRUD + reorder, `publish`, `share` (POST mint/rotate, DELETE revoke), `email` (send via the shared `EmailShareModal`/Resend pipeline), `delivery-status`, `linked-work` (the request/task attach pool), `preview-data` (feeds the admin Preview route), `templates` list/create and `templates/[id]` patch/delete.
- **Public read path (out of this group but consumed by it):** `app/api/public/schedules/[token]` backs both `/p/schedule/[token]` and the admin preview, reading `publishedSnapshot` when present and falling back to live rows only when nothing has ever been published.
- **Third parties:** Resend (email-link send, via the shared email pipeline all sales artifacts use), no Stripe/Xero/HubSpot involvement on this surface. Analytics (view count, section dwell) is first-party (`useShareViewTracking`, `useSectionDwellTracking`), no external analytics vendor.
- **Cross-surface dependents that must stay honest:** the client-portal home project card reads `projectSchedules` filtered to `status = 'shared'` and the `publishedSnapshot` phases only (fixed per T2.4/CT.7, re-verified 2026-09-13): a draft schedule must never leak onto a client's home regardless of what this group's UI does; any future change to publish/share semantics in this group has to preserve that filter. Deal detail pages and client detail pages link into `/schedules/{id}` via `LinkedToPanel`/sales-kit one-click creation (STATUS: "every traced button hits a real API" for deals' sales kit): those entry points are real, not decorative.
- **Nothing on this surface should render a fake or placeholder number.** The delivery rollup, view counts, and "N linked to real work" style copy must always reflect live query results, never a hardcoded placeholder: this is the same standard the design file already writes for (e.g. `SCH_VIEWS`/tiles compute from `D.SCHEDULES`, never a fixture constant), and the port must match.

## 6. Design system contract

**Primitives that apply:** `PageHeader` (list page), `Card` + `DataTable` + `FilterBar` (list page), `EmptyState` (all three pages, leaf-icon variant for true-empty, inline variant for filtered-empty), `ConfirmDialog`/`PromptDialog` (destructive and naming actions), `BuilderShell`/`BuilderNavGroup`/`BuilderNavItem`/`RailSection`/`FieldGroup`/`SaveIndicator`/`BuilderEditorShell` (the shared studio-artifact builder chrome, same primitives Proposals and Contracts editors use), leaf radius on the New-schedule template picker's icon swatches and the section-type picker icons, CSS-var tokens throughout (confirmed: no hardcoded hex outside the brand-locked owner-bar/gate colours in `gantt-grid.tsx`, which CLAUDE.md explicitly permits for brand-locked visuals).

**What the existing design file (`sales-artifacts.jsx`) already gets right, that the port should match:**
- The pane-rebalance fix on `ScheduleEditor`: the live-preview pane stands down while editing the gantt so the grid gets full width, re-appearing as a one-click "See what the client sees" toggle everywhere else. Confirmed done at PASS-B per the design-review checklist.
- A left-rail, `HeadBand`-tile pattern on both `SchedulesList` and `ArtifactTemplates` that gives an at-a-glance delivery/off-track/shared/next-gate summary before the table: this is the AR.5 "left rail on every list page" rule already realised for schedules in the design file, just not yet ported.
- An honest error state on the list (`state === 'error'` renders `ErrorState` with retry, "Nothing is lost") that the current port lacks.
- The off-track nudge banner pattern (`<Nudge>`) surfacing the single most urgent off-track engagement with a direct "Open the schedule" CTA, consistent with the same nudge component other list pages use.
- The row editor's "click a row 1450px down a 14-row gantt used to do nothing you could see" fix (`scrollIntoView` on row select): a real usability fix worth preserving in the port.
- Delivery status painted directly onto the client-facing preview via a `Switch` ("Show live progress to the client") rather than being an all-or-nothing setting: gives the studio user control per schedule.

**What the design must change before it is ready to port (from the checklist's FIX/REDO verdicts and the catalogue):**
- `schedule-editor` carries a FIX note in the checklist history for the original pane imbalance; that FIX has already been actioned in the current file per the "re-checked at PASS-B" annotation: this row can move to SHIP once the reviewer re-confirms it live in the shell, not on a disk mirror (this is exactly what DL.4, re-render and re-critique in the real shell, exists to catch).
- Confirm the Risk register and RACI editors in the design file (`RiskEditor`, `RaciEditor`) are genuinely editable (they show `Input`/`Select`/`Area` controls wired to `notify()` stubs, i.e. this is a working-editor *design*, not a read-only preview): if so, this closes the "read-only preview" gap named in section 4 once ported; the reviewer should explicitly verify these two editors are in scope for the schedules port and not accidentally dropped because they're unglamorous.
- Decide and record whether `/schedules/templates` is being replaced outright by the unified `ArtifactTemplates` shelf (shared with Proposals and Contracts) or whether schedules keeps a dedicated templates page: the design file only builds the unified version; the catalogue's per-page row for `/schedules/templates` still describes a like-for-like "port only," which conflicts with what the design actually contains. This needs a reviewer note, not a silent pick.
- No mobile-specific treatment of the studio gantt editor exists in the design file beyond `isMobile`/`narrow` collapsing the outline rail: the `GanttCardStack` mobile fallback that already ships on the public viewer does not appear to have an equivalent in the design's `GanttEditor`. Flag this explicitly to the reviewer: either the design needs a card-stack mode for the studio editor too, or Liam accepts that editing a gantt on a phone means a wider, scrollable grid (viewing on a phone, via the public link or Preview, already degrades gracefully).

## 7. Open questions for Liam

1. Does the unified `ArtifactTemplates` shelf (one page, one rail, covering Proposals + Contracts + Schedules together) replace `/schedules/templates` as a standalone route, or do you want schedules to keep its own dedicated templates page separate from proposals and contracts? (A or B)
2. Should the Risk register and RACI matrix sections become fully editable in this port (matching what the design file draws), or do you want them to stay read-only-in-app and edited only via API/MCP for now? (Yes, make them editable / No, keep read-only for now)
3. Should the studio gantt editor get a mobile card-stack fallback (like the public viewer already has), or is editing a gantt from a phone out of scope and only viewing needs to work well there? (Yes, build the mobile fallback / No, desktop-only editing is fine)
4. Do you want a list-level delivery/health rollup column on `/schedules` (progress bar, off-track flag, "N linked to real work") as shown in the design, or is that summary only useful inside each schedule's own builder? (Yes, add it to the list / No, keep it per-schedule only)
5. Should `activeView` in the builder become part of the URL (so a link can deep-link straight to a section or the analytics view), or is "always reload to Cover" acceptable for a studio-internal tool? (Yes, add URL state / No, current behaviour is fine)

## 8. Acceptance for the design review

1. At 1440px light, `/schedules` shows a left-rail with named saved views and a headline tile band above the table, not just a status-chip filter bar.
2. At 1440px light, the builder's gantt section view gives the grid the full middle-pane width with no live-preview panel squeezing it below 6-of-N visible weeks.
3. At 375px light, the builder's gantt is either a legible card-stack (no pinch-scroll) or the reviewer has an explicit Liam answer accepting the scrollable-grid tradeoff for editing.
4. At 375px light, `/schedules` list has no horizontal page scroll and every row action and dialog button is at least 44px tall.
5. In `.dark` at 1440px, the owner-colour gantt bars, the section-header band, and every status badge remain legible with no washed-out or invisible text (the known "dark slide themes render invisible text" bug class from the public viewer must not reappear in the studio builder's own theme picker).
6. A screenshot of the New Schedule dialog shows the Client/Deal/Lead pickers and the template picker in one coherent flow, not a bare form.
7. A screenshot of `/schedules/templates` (or its replacement) matches whatever Liam decided in Open Question 1: either a schedules-only page consistent with the list page's new rail pattern, or the unified three-kind shelf.
8. The off-track nudge banner and the headline tile band read real counts in the screenshot's demo data (a "None"/"Nothing planned" quiet state is shown at least once across the review, proving the empty variant was actually checked, not just the populated one).
9. The Risk register and RACI sections in the screenshot show either working add/edit controls (if Open Question 2 was answered "yes") or an honest, clearly-labelled read-only state (if answered "no"): never a half-state that looks editable but silently does nothing.
10. Every button visible in the review screenshots corresponds to a real, wired action per section 4 of this document: no CTA whose backing feature is still listed under "planned or missing."
