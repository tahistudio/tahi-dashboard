# Client Requests - design requirements

Group: client-requests (audience: client). Routes: `/requests`, `/requests/[id]`.
Source: CLAUDE.md, STATUS.md, `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md, live code (`app/(dashboard)/requests/**`, `components/tahi/requests*`, `app/api/portal/requests/**`), and the Claude Design project (`requests.jsx`, `requests-audience.jsx`, `requests-workload.jsx`, `requests-capacity.jsx`).

## 1. Purpose and audiences

Requests is the client's one channel for asking Tahi for work and watching it move. For a client contact it replaces the ManyRequests ticket queue: submit a request, see it queue behind whatever the studio is already building, watch it cross five pipeline stages, reply in a thread, approve or send back a delivery, and see progress against their own plan capacity (tracks). This is the surface STATUS.md calls "the portal's strongest feature" and the only Requests audience these two routes serve; the admin and impersonated-teammate views of the same components are out of scope for this document except where they explain a gate.

Who opens it: any authenticated Clerk contact whose organisation id is not `NEXT_PUBLIC_TAHI_ORG_ID` (a client org), reached through `getPortalAuth`. There is no separate "member" vs "admin" portal role distinction inside Requests itself - `portalRole` (admin vs member, T1.14) only gates Organisation/People/brand settings, not requests. Any contact at the org, or any brand the contact is linked to, can view, reply to and approve requests for that scope.

What it must never show a client:
- Another organisation's requests, files, messages or people, in any state (proven by `e2e/tenancy-isolation.spec.ts`, re-run required after any change to `lib/portal-access.ts`, `lib/permissions.ts` or a portal route).
- Internal-only requests (`requests.isInternal = 1`) or the "internal" badge/flag itself - the portal GET filters `isInternal = false` outright and the internal pill only renders `isAdmin &&`.
- The AI scope-flag pill (`request.scopeFlagged`), which is studio-only triage metadata.
- Who on the studio side did what: assignee identity beyond a PM/assignee the API actually returns (see the People card rule in section 6), the "seen by" read receipt strip (admin only), triage AI suggestions, blockers, time entries, discovery-call cards, and the tasks-spawned-from-this-request panel - all gated `isAdmin &&` in `request-detail.tsx`.
- A client tag/label (studio-internal client tagging) - the Kanban/board client filter and the tag filter are both forced back to `'all'` for a client audience in the reference design (`requests-audience.jsx`, `requests.jsx`).
- Workload view (per-teammate load, track occupancy across every client) - admin only; `viewKeysFor()` in `requests-view-switcher.tsx` drops it unless `audience === 'admin'`.
- Export CSV and Bulk create - both gated `isAdmin` in `RequestsHeaderActions`.
- Nest/Make top-level/Duplicate/Archive/Delete on a request (`RequestActionsMenu`) - the whole menu is studio-only and is not rendered for a client at all.
- Messages nav - the standalone `/messages` surface is hidden for every client by default (feature-gated, 27ae697f); a client's only messaging channel is the request thread itself.
- Super-admin-only areas: Act as client / View as client mode, the acting-as audit trail, and any control that lets someone impersonate a different organisation, are never reachable from a client session; they exist only on the admin side and are recorded in `auditLog` when used.

## 2. Pages, sub pages and entry points

- **`/requests`** - the list/board/timeline surface. Entry points: the sidebar/bottom-tab "Requests" item, the client home "New request" CTA (opens the dialog on top of this page or a fresh navigation with `?new=1`), any notification whose link resolves here (`request_created`, `request_assigned`, status-change and reply notifications), and direct links shared by the studio.
  - **View switch** (in-page state, not a route): List (default), Kanban/Board, Timeline. Held in the rail's `view` state and mirrored to the URL/localStorage default the same way the Requests rail always has (client rail is `audience: 'client'`). Workload is not offered.
  - **New request dialog** - a modal (`NewRequestDialog`), opened from the header's primary "New request" button or the empty state's "Submit a request" CTA. Contains: AI draft entry point, category tiles, title, rich-text brief, size (whichever sizes the client's plan/track entitlement allows), an intake-form block that appears only when `GET /api/portal/request-forms?category=<cat>` resolves one, and a queue-placement choice (queue / top / replace) that maps to priority and queue position server-side.
  - **AI draft / AI request wizard** - a sub-state of the New request dialog (`initialView: 'ai'`), reachable from the header overflow menu's "AI draft" item. Posts to `/api/portal/ai/request-wizard`, then hands its draft into the same submit path (`/api/portal/requests`).
  - **Sub-request creation dialog** - opened from a request's `<SubRequestsPanel>` "new" affordance; for a client this only opens if `canCreate` is true, which in the shipped component resolves to the studio-write flag (`canWrite`) - i.e. a client can see sub-requests under a parent but the create affordance is effectively studio-only today (see section 4).
  - **Filters sheet** (below 1024px) - the rail collapses into a bottom sheet/drawer holding the same filter set a desktop client gets: status, and (per the reference design) no client or tag filter, since both are forced to "all" for this audience.
  - **Bulk request creation across clients** - explicitly out of scope for this audience; it is an admin-only header action (see section 1).

- **`/requests/[id]`** - the request detail page (`RequestDetailPage` -> `RequestDetail`). Entry points: any row/card click from the list, board or timeline; any request-scoped notification link; the sub-requests panel on a parent request; "Back to requests" from the not-found state.
  - **Thread** - the message composer and history (`RequestThread`), client placeholder "Add a comment or question…", no internal-note toggle (admin only).
  - **Client review banner** - appears only when `status === 'client_review'`: "Approve & close" and "Request a change" actions, routed through the portal review PATCH.
  - **Sub-requests panel** - lists non-internal children with their own status; visible whenever the parent is not itself a sub-request.
  - **Files panel** - upload and list, scoped to the request; a client may upload to their own request (gated on not being a read-only preview viewer, not on `isAdmin`).
  - **Checklists** - read-only progress for a client (see section 4); the panel renders nothing at all if there are zero checklist items, so a request with no checklist shows no card.
  - **People card** - renders the real PM/assignee/follower panel only if the portal API actually returned participants for this request (brand/PM/assignee visibility, `CLIENT_VISIBLE_TEAM_ROLES`); otherwise it renders a `PortalStudioTeamCard` (the org's assigned studio team from `/api/portal/team`) rather than printing a false "No PM assigned" state.
  - **Activity log** - collapsed-by-default section at the foot of the thread column, built from request/messages/files client-side (see section 4 for its honesty limits).
  - **Schedule-phase link, Time card, Blockers card, Discovery-calls card, Tasks-from-this-request panel, AI triage banner, Actions card (status dropdown, scope-flag toggle, make-top-level)** - all `isAdmin &&`, never rendered for a client.
  - There is no separate client "sub page" (no tabs) inside the detail: it is one scrolling page with a sticky right-hand rail from `lg` upward.

## 3. States and variants

- **`/requests` loading** - `<LoadingSkeleton rows={5} />` while the server component resolves; the client component itself renders `animate-pulse` skeleton rows while the first SWR fetch is in flight.
- **`/requests` empty (no rows at all)** - icon (`Inbox`), title "No requests found", description "Submit your first request and the Tahi team will get started.", CTA button "Submit a request" (opens the New request dialog). Admin gets different copy; a client always gets the CTA.
- **`/requests` filtered-empty (rows exist, filters hide them all)** - title "No requests match", description "Try clearing a filter or the search.", "Clear filters" button. Distinct from the true-empty state on purpose.
- **`/requests` load error** - an inline `role="alert"` banner above the (possibly stale) table: "Could not load requests." + "Try again", not a full-page replacement, so cached rows stay visible underneath.
- **`/requests/[id]` loading** - skeleton state while `request-detail:portal:<id>` SWR key resolves.
- **`/requests/[id]` error** - "Failed to load request" / "Please check your connection and refresh the page." (network/parse failure, request object still null).
- **`/requests/[id]` not found** - "Request not found" + "Back to requests" link (row deleted, wrong id, or a request outside this org/brand scope - the not-found and the "belongs to someone else" cases are deliberately indistinguishable to a client).
- **Read-only Client view (admin impersonation, preview mode)** - every write surface disabled: header's "New request" and AI draft hidden (`RequestsHeaderActions readOnly`), the client-review Approve/Request-change buttons disabled (`previewIsReadOnly`), file upload gated off. This is how the studio previews a client's Requests page without the ability to act as them.
- **Act as client (write-enabled preview with audit)** - the same read-only view but with writes re-opened; every mutation records an `acting_as_client` audit row and an honest byline on anything the client would otherwise think they wrote themselves (e.g. the studio-notification body says "acting as" rather than implying the client typed it).
- **Member seat vs admin seat** - no distinct Requests behaviour today; `portalRole` does not gate anything on this surface, only Organisation/People/brand settings elsewhere in the portal.
- **375px** - the rail/filter row collapses into the Filters sheet, the view switcher drops its text labels to icon-only below `lg` (aria-label/title still carry the accessible name), header actions collapse to "New" + an overflow "..." button at a 44px touch target, detail page rail below `lg` un-stickies and flows with the page (no captured wheel scroll).
- **768px** - the mid-width step is where the request detail's two side cards used to collapse to an unusable sliver and trap wheel scroll (LW.12, merged 3175bf36): the two-column split now moves at `1024px` with `minmax(0,1fr)` rather than at `lg`'s old boundary, so 768px reads as a single stacked column, not a cramped two-column one.
- **Dark mode** - every token referenced above (`--color-*`, `--badge-*`, `--radius-leaf`) has a `.dark` counterpart in `globals.css`; nothing in the two routes hardcodes a light-only hex per the grep against `request-list.tsx`/`request-detail.tsx`. Not yet independently live-verified for this exact pair per STATUS's trusted-block note (Requests is "live-verified June" as a whole, not itemised per dark-mode state since).
- **Print or public** - not applicable; there is no public/unauthenticated view of a request, and no print stylesheet is called out for this surface.

## 4. Features and actions

### `/requests` (client)

**Works today**
- List, Kanban/Board and Timeline views (Workload withheld for clients).
- Status filter, search (title/request number), sort, saved-view rail state (client-scoped, no client/tag filter).
- New request dialog: category tiles, per-category intake form (`GET /api/portal/request-forms?category=`, four-level resolution: org+category > org-global > category-global > global default), rich brief, size gated by plan/track entitlement (`largeTaskAllowed`), queue placement (queue/top/replace) mapped server-side to priority and position, predictive autofill suggestions (TP.5, shared with admin) shown as dismissible "suggested" hints rather than silent prefill.
- AI draft / AI request wizard, posting to `/api/portal/ai/request-wizard`, honest timelines pulled from one canonical hours table (LW.16), client org context (name, industry, website, brands, last five requests) reaching the prompt (LW.17), every draft created independently rather than one draft standing in for three (LW.15).
- Capacity strip (client only) at the top of List view when no filter/search/saved view is active: one lane per active track showing the in-flight request, a numbered queue below it.
- Studio notified on every client-submitted request (`notifyAllAdmins`, per-org `REQ-n` number in the subject and bell) - CT.2/CT.4, live.
- Brand scoping: a contact linked to specific brands only ever sees requests for those brands; an unlinked contact sees the org-wide (brand-less) queue.
- Tenancy isolation proven end to end for this route (S6/T1.5, `e2e/tenancy-isolation.spec.ts`, 3/3 green on the local harness, not yet wired into CI).

**Exists but wrong or half built**
- The design's headline band (four KPI tiles - "In the studio / Waiting on you / In your queue / Delivered" for the client audience, `requests.jsx` + `head-band.css`) is written into the Claude Design file (DL.2, 2026-09-12) but is not present anywhere in the ported `request-list.tsx` - no `hband`/headline-band markup exists in the live component. The catalogue still marks the whole family "Ported, live" with only P3 and an em-dash fixture as remaining polish, so this is either an intentional drop (the rail's saved-view counts replace it) or an unported piece nobody flagged; flag for the design review rather than assume.
- Kanban board columns: Batch 6 (`kanbanColumns`, per-org overrides) is built and used by the **admin** board (`kanbanColumnsKey` only fetches for `isAdmin`), but a client's own board always falls back to the hardcoded default column set - a client-specific column override configured in Settings never reaches the client's own view of their board.
- P3 (STATUS, catalogue row 18): the Kanban/board drag-and-drop lights the dragged card's *own* column as the drop target rather than the one under the cursor. Shared `KanbanBoard`, affects both `/requests` and `/tasks`.
- Fixture em dashes appear in Claude Design sample data only, not in shipped copy (CLAUDE.md rule 6 is honoured in the port; the design-data violation is cosmetic to the design file, not the product).

**Planned or missing**
- Cross-client/bulk request creation is admin-only by design; nothing is missing here for the client audience specifically.
- Per-org digest for bulk status-change emails (today a bulk status move only rings the bell, no email) - CT.F follow-up, not client-Requests-specific but touches what a client is told about their own requests moving.
- WhatsApp/Slack-to-request intake (GI.1, design-first) - a proposed new entry point into this same list, not yet designed or built.

### `/requests/[id]` (client)

**Works today**
- Full pipeline status display (`DeliverySpine`) and an honest "off the delivery pipeline" note for statuses outside the five-stage flow.
- Client review banner on `client_review`: "Approve & close" (routes through the whitelisted portal PATCH, `client_review -> delivered`) and "Request a change" (arms a change tag, focuses the composer). Live-verified in code, last unverified-live piece per V1-QA.1 (own-name rendering, scope-pill absence, approve banner, in a real client session).
- Thread: client per-message file attachments, soft-deleted messages filtered on both sides, read state (`POST /api/portal/requests/[id]/reads`) clearing the bell when the request is opened.
- Sub-requests panel (read: children and their status); files panel (client upload/download to their own request, gated on not being a read-only preview); checklists (read-only progress, hidden entirely when there are none - "Clients get checklists as read-only progress" is the explicit design intent in code, not an oversight).
- People card honesty fix: a client only sees the real PM/assignee/follower card when the API actually returned participants; otherwise sees the studio-team card from `/api/portal/team` rather than a false "No PM assigned yet" (documented directly in the component's own comment as closing a prior lying-empty-state bug).
- Client-submitted rich text sanitised server-side before any studio admin renders it (`sanitizeRichText`), independent of any client-side validation.
- Notifications: studio replies and status changes (`client_review`, `delivered`) email the client (CT.4); the notification-email dispatcher is the one chokepoint for this.

**Exists but wrong or half built**
- A dedicated `requestSteps` table with its own GET/POST API (`app/api/portal/requests/[id]/steps/route.ts`) exists in the schema and route layer but is wired into **no** UI anywhere in `request-detail.tsx` - it is entirely orphaned there. This is distinct from the `ChecklistsPanel` (which is the JSON `requests.checklists` column, and *is* wired, read-only for clients). TASKS.md/the catalogue's line "request steps and client-visible checklist writes do not exist... fix the misleading comments now" is the record of this; treat the two as separate defects: the orphaned `requestSteps` route, and the (deliberately) read-only checklist for clients. Correction to "entirely orphaned": on `/requests` (not the detail page), `components/tahi/requests/capacity-strip.tsx` does call `GET /api/portal/requests/[id]/steps` and uses the result to compute a lane's progress percentage (falling back to a status-based estimate when there are no steps) - so the table is not dead weight end to end, it is just never surfaced to a client as a visible step list. Any decision to delete `requestSteps` (see the open question below) needs to account for this silent consumer, not just the detail page.
- The revision counter ("Rev n/3") never persists past zero - `revisionCount`/`maxRevisions` exist on the row and render, but nothing increments `revisionCount` anywhere in the write paths found.
- The activity feed is synthesised client-side from the request/messages/files already in memory, with no persisted record of who changed what and when - a page refresh or a second viewer sees a re-derived approximation, not a ledger.
- Sub-request creation from the client side of `<SubRequestsPanel>` is gated on `canWrite` (studio-only) in the shipped detail page, even though the panel itself renders for a client - a client can see but not create a sub-request today.

**Planned or missing**
- Decision needed (TASKS.md "Batch I. Honesty and deletion", I5): build real writes for `requestSteps`/the revision counter, or delete both and the UI language that implies they work.
- Persisted per-request activity log (new table plus a write on every mutation) - listed in the next-surfaces assessment as not yet started.
- File-level proofing/annotation on a delivered file - explicitly not built anywhere (ManyRequests does not have it either, so there is no parity gap, only a possible differentiator).

## 5. Data and integrations

- **Tables**: `requests` (including `formResponses`, `checklists`, `revisionCount`/`maxRevisions`, `queueOrder`, `scopeFlagged`, `isInternal`), `requestSteps` (orphaned on the detail page but consumed by the capacity strip's progress bar on `/requests`, see section 4), `requestForms` (Batch 5, live), `kanbanColumns` (Batch 6, admin-scoped only), `contacts`, `brandContacts`/`brands` (brand scoping), `subscriptions`/`organisations` (track/plan entitlement for size gating), `files`, `messages`/`conversations` (request thread), `notifications`, `auditLog` (acting-as writes), `tags` is studio-only and never reaches this surface.
- **Admin/portal API routes**: `GET/POST /api/portal/requests`, `GET/PATCH /api/portal/requests/[id]`, `.../messages`, `.../files`, `.../reads`, `.../review`, `.../sub-requests`, `.../steps` (orphaned), `GET /api/portal/request-forms`, `GET /api/portal/team`, `POST /api/portal/ai/request-wizard`. Every route resolves org via `getPortalAuth`, refuses the Tahi admin org id outright, and gates on the `requests` feature flag (`requirePortalFeature`).
- **Third parties**: none direct on this surface. Resend carries the transactional email side (client-review/delivered/reply notifications) through `lib/notification-email.ts`; there is no Stripe/Xero/Slack/HubSpot call from Requests itself.
- **Honesty constraints already enforced in code and worth preserving in any redesign**: no fake PM/assignee names (People card falls back to the studio-team card rather than a lying empty state), no internal-only request or scope-flag leak to a client, no priority control for a client (priority is derived server-side from their plain-language "placement" choice), no client-visible checklist write action, no dead "Approve" button (it really flips `client_review -> delivered`), no silent AI-suggestion overwrite (every suggestion needs a client action to apply and can be dismissed).

## 6. Design system contract

- **Primitives that apply**: `PageHeader`/`req-head` masthead pattern, the rail/toolbar family (`RequestsRail`, `RequestsViewSwitcher`, `RequestsHeaderActions`), `DataTable` for List view, `SlideOver`/`Popover`/`Menu` for any secondary surface, `ConfirmDialog` for destructive admin-only actions (not client-facing here), `SharedEmptyState`, leaf radius (`0 16px 0 16px`) on the client-review banner's icon chip and the New-request primary CTA, CSS var tokens throughout (no hardcoded hex found in either route file).
- **What the existing Claude Design file gets right**: the audience-aware headline band concept (four tiles, client copy distinct from studio copy: "In the studio / Waiting on you / In your queue / Delivered"), the capacity strip (ported faithfully as `components/tahi/requests/capacity-strip.tsx`), workload correctly scoped owner-only, and the client/tag filter correctly suppressed for a client audience (`requests-audience.jsx`, `requests.jsx` effects). `requests.jsx` plus its kit/board/detail/dialog/toolbar family carries a critic verdict of SHIP (Pass 3) and is named in the checklist as "the reference for the band and rail standard" for the rest of the app.
- **What the design (or the port) must change**: the headline band verdict SHIP is on record, but as noted in section 4 it is not present in the live client Requests page - the design review needs to confirm whether it should be (a client-facing KPI strip) or whether the rail's own counts were judged sufficient and the design file should be told so. Nothing else in this pair carries a FIX or REDO verdict on record (the checklist's Requests row is unticked/unreviewed as of this writing); `requests-detail.jsx` in the design project is the largest file in the family (~85 KB) and has not yet had its own line-by-line critique pass recorded, unlike the proposals/schedule editors which did (Pass 3, PASS-B).

## 7. Open questions for Liam

1. Should the client-facing headline band (KPI tiles: In the studio / Waiting on you / In your queue / Delivered) from the design be ported onto `/requests` for clients, or is the current rail/capacity-strip treatment the intended final state? (A: port the band / B: keep as is)
2. Should a client be able to create their own sub-requests under a parent request, or should sub-request creation stay a studio-only decomposition tool? (Yes/No)
3. For the `requestSteps` table and API (orphaned on the detail page, but silently consumed by the capacity strip's progress calculation on `/requests` - see section 4): build it out as a client-visible step tracker distinct from the checklist, or delete the table/routes (and give the capacity strip a status-only estimate) and keep only the checklist? (A: build / B: delete)
4. Should a per-client Kanban column override (Batch 6, already configurable by the studio in Settings) actually change what a client sees on their own board, or is that customization meant to stay admin-facing only? (Yes/No)
5. Is the revision counter ("Rev n/3") worth wiring up to persist, or should the UI stop implying a revision limit exists until it does? (A: wire it up / B: remove the display)

## 8. Acceptance for the design review

- At 1440 and 375, light and dark: the client Requests list shows no admin-only affordances (Workload tab, Export CSV, Bulk create, client/tag filter, the "..." request-actions menu, scope-flag pill, internal badge).
- Empty state (no requests at all) reads "No requests found" / "Submit your first request and the Tahi team will get started." with a working "Submit a request" CTA; the filtered-empty state reads "No requests match" with "Clear filters", and the two are visually distinct from each other.
- The capacity strip renders one lane per active track plus a numbered queue, and disappears the moment any filter, search or saved view is active.
- On `/requests/[id]` with a `client_review` request, the Approve/Request-a-change banner sits directly under the pipeline bar, both actions honour a disabled/busy state, and neither renders for any other status.
- The People card never prints a false "No PM assigned"/"No assignees yet" for a client - it shows either the real participants or the studio-team fallback card, never both, never neither.
- Time, Blockers, Discovery calls, Tasks-from-this-request, the AI triage banner, and the Actions card (status dropdown/scope toggle) are absent from every client screenshot.
- At 375px the request detail's two-column layout has already collapsed to one column with no clipped card and no captured wheel scroll; at 768px it reads as the same single stacked column, not a squeezed two-column layout.
- Dark mode: the client-review banner, capacity-strip lane tiles, and checklist read-only rows all pass contrast with no light-mode leakage (no unthemed hex).
- The New request dialog shows an intake-form block only when a form actually resolves for the chosen category, and shows plan-gated sizes (no "Multi-day" option a maintain-plan client cannot actually use).
- Touch targets on the mobile filter sheet, view switcher (icon-only below `lg`) and header's New/overflow buttons are all at least 44px tall.
