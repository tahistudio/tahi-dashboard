# Design requirements: client-tracks-schedule

Group: client-tracks-schedule (audience: client)
Routes covered: `/tracks`, the client-home track and project visualisation (`/overview`), and the client-facing "papers" schedule surface, which today means the public no-login `/p/schedule/[token]` viewer, since a logged-in `/schedules` client route does not exist yet.

This group has an unusual shape worth stating up front, because it drove every section below: there are three different code paths that all claim to be "the client's tracks/schedule view," and only one of them is actually reachable by a client today.

1. **`/tracks`** (`app/(dashboard)/tracks/page.tsx`) is nominally a client page (its own content component is titled "the client portal /tracks page" and reads live portal data), but the page itself redirects every non-studio session straight to `/requests` before any of that code runs. It is orphaned: nothing in the client nav or the mobile tab bar links to it.
2. **The client-home track and project visualisation** ("Your work in motion" / "Your project, phase by phase") is what a client actually sees, on `/overview`. It is a materially simpler board than the one built for `/tracks`.
3. **The client-facing schedule** exists only as the public, token-gated `/p/schedule/[token]` viewer (no login, shareable link) and, in miniature, as the phase roadmap on the client-home ProjectBoard. A logged-in, in-portal "Schedule" nav item was deliberately removed on 2026-09-05 (Decision, T2.3) because its page had no client branch; the design for what it would show (`ClientPapers`, kind=`schedules`) already exists and is unbuilt.

## 1. Purpose and audiences

**Who opens it.** Every screen in this group is client-portal-only: a contact at a client organisation, in either seat (workspace admin or a plain member). No Tahi team member is a real audience for these specific screens, though a team member previewing "View as client" or acting-as-client walks the identical code path a client does (read-only unless in explicit act mode). `/tracks` itself is the one exception: in practice only a studio session ever renders past its guard, because it force-redirects clients before rendering.

**The job.** Tell a retainer client where every one of their paid track slots stands right now (what is queued in their own order, what is being made, what needs their word, what shipped recently) and let them reorder their own queue. For a project client (no active subscription), tell them which phase of their fixed-scope engagement they are in, honestly, with no fabricated percentage when the schedule carries no effective date to anchor "now."

**What it must never show:**
- **Cross-tenancy data.** Every route in this group (`/api/portal/tracks`, `/api/portal/tracks/[trackId]/reorder`, `/api/portal/capacity`, `/api/portal/project`, `/api/public/schedules/[token]`) resolves strictly to the caller's own `orgId` (portal routes) or to the schedule matching the exact share token (public route), and explicitly rejects the Tahi admin org id. `e2e/tenancy-isolation.spec.ts` covers the portal routes in this group directly.
- **Internal-only requests.** `/api/portal/tracks` and `/api/portal/capacity` both filter `requests.isInternal = false`; a Tahi-only task must never appear in a client's queue or lane.
- **Other clients' plan or pricing language.** `TracksClient`'s design and the live `TrackBoard` both derive plan label and track count from the caller's own resolved entitlement (`resolveTracksConfig`), never a hardcoded example org.
- **Messages.** Out of scope for this group specifically, but as a standing rule for every client screen: Messages is hidden by default for every client (2026-09-13 decision) and must not be reintroduced as a link from a tracks/schedule card.
- **Studio-only controls.** Team access scoping, the Xero export drawer, and the studio `Tracks` page's cross-client "Studio wide" view (`ops.jsx` `Tracks`, not `TracksClient`) are Tahi-internal; nothing in this group's client-facing surfaces may expose another client's name, queue, or the "see it as they do" studio-side preview control.
- **Draft schedules.** `/api/portal/project` and the public schedule viewer only ever read a schedule whose `status === 'shared'`; an in-progress draft, even one newer than the last shared schedule, must never reach a client under any surface in this group (T2.4/CT.7, already shipped and tested).

## 2. Pages, sub pages and entry points

### 2a. `/tracks` (orphaned, studio-gated in practice)
- Entry point: the URL only. No nav item, no button, no notification links here for a client.
- Guard: `app/(dashboard)/tracks/page.tsx` computes `studio = isAdmin && !isPreviewingClient` and redirects to `/requests` whenever `!studio`. A client session, and a team member using "View as client" (`isPreviewingClient`), both bounce.
- What actually renders when the guard is *not* hit (i.e. a real studio session, `isAdmin && not previewing`): `TracksContent` shows an admin-facing empty state, "Manage tracks from a client," with a link to `/clients`. The richer client board inside the same component (loading skeleton, real `TrackQueueView` lanes, the "No tracks available" empty state, the ghost upgrade ticket) is written for `isAdmin === false` and is unreachable code today, because the only sessions that ever get this far are studio sessions.
- No sub-pages, no dialogs, no slide-over. It is a single view with an inline Refresh button when the (unreachable) client branch renders.

### 2b. Client home track and project visualisation (the real "Your tracks")
- Entry point: `/overview`, the client's landing page after sign-in. No separate URL; it is one card ("Your work in motion" or "Your project, phase by phase") inside `ClientHome` (`components/tahi/overview/homes/client-home.tsx`).
- Which card renders is decided by `lib/engagement-presentation.ts`'s `resolveEngagementPresentation`, not by a client toggle:
  - An active subscription row → **TrackBoard** ("Your work in motion"), regardless of any custom pricing.
  - No active subscription but a real `projects` row or a schedule shared to this org → **ProjectBoard** ("Your project, phase by phase").
  - No subscription, no project row, no shared schedule → **TrackBoard** in its own zero-state ("Your plan is being set up by the studio."), never project language.
- Interaction inside TrackBoard: per-track queue reordering via up/down icon buttons on each queued item (`moveQ`), which optimistically reorders locally and calls `PUT /api/portal/tracks/[trackId]/reorder`. There is no drag handle in the live implementation (the design's `LaneItem` also uses up/down, not drag).
- Interaction inside ProjectBoard: none. It is read-only phase names, a filled meter per active phase, and an optional "current work" note; there is no reorder, no drill-in, no sub-page.
- No slide-over or dialog belongs to either card. "New request" is reachable from the masthead's single CTA, not duplicated inside either card (a deliberate simplification the code comments call out twice).

### 2c. The client-facing "papers" schedule (today: public link only)
- Entry point: a `/p/schedule/[token]` URL, always arriving from outside the authenticated app (an emailed or pasted link). There is no in-portal nav item that opens it; `app/p/layout.tsx` renders it on a bare stage with no dashboard chrome, and strips `.dark` on mount so a visitor's dashboard dark-mode preference never bleeds into a document meant for an external reader.
- The equivalent in-app experience is the phase roadmap on the ProjectBoard above (2b); it reads the identical `publishedSnapshot`/live-fallback data as the public link (`/api/portal/project` and `/api/public/schedules/[token]` both resolve the same `projectSchedules.status = 'shared'` row and prefer `publishedSnapshot` over live tables the same way), so the client's own portal card and their shared link cannot disagree.
- A fully designed, unbuilt third door exists in the Claude Design file: `ClientPapers` (`sales-artifacts-kit.jsx`, `kind="schedules"`) is an in-portal list page ("Schedule … The plan, and how the work against it is actually going.") with an empty state, a "spine" of proposal → contract → schedule steps, and cards that open the schedule reader. It was wired into `CLIENT_NAV` once and removed on 2026-09-05 because the page behind it had no client branch (T2.3); the design still exists for whenever that decision is revisited.

## 3. States and variants

**`/tracks`**
- Studio session: renders instantly, no loading state observed (data is not fetched for `isAdmin`).
- Client session: instant redirect to `/requests`, no flash of tracks content (the guard runs server-side before render).
- Loading / empty / error for the unreachable client branch: `LoadingSkeleton rows={4}`; empty is "No tracks available. You do not have any active tracks. Contact your account manager to get started." with a "View billing" CTA to `/billing`; there is no distinct error state wired (a failed `useSWR` read simply keeps `capacityData` undefined, which renders as the empty state, not an error state - a real client would never see it, but this is a live "false empty on failure" bug in dead code).
- Read-only / act-as-client preview and member vs admin seat: not applicable in practice, since the page-level guard bounces both a plain client session and a team member previewing as client (`isPreviewingClient`) to `/requests` before either seat distinction or a preview banner could ever render.
- 375 / 768 / dark: not separately audited for this route, since the only session that ever renders past the guard is a real studio session, for which the page shows only the single-line "Manage tracks from a client" empty state (no board, no responsive layout question to test).

**TrackBoard (client home, retainer)**
- Loading: `SkelFigure` + `SkelRows rows={2}` inside the same card shell, holds its layout width (CT.3b fix).
- Empty (no subscription/project signal at all): "Your plan is being set up by the studio." / "No active tracks yet." No New-request CTA duplicated here.
- Empty (subscription exists, zero lanes): not a distinct copy path in the code; `lanes.length === 0` renders the same "No active tracks yet." regardless of why.
- Error (failed read, nothing to fall back on): `CardError what="Your tracks" onRetry={...}`, distinct from the empty copy (CT.3b's point: "No active tracks yet." must never be shown for a failed read).
- Read-only / act-as-client preview: `ro` disables `moveQ`'s reorder entirely (early return); the surrounding `RoStrip`-style banner is rendered by the page shell, not this card.
- Member seat vs admin seat: no difference. Track reorder is not `requiresOrgAdmin`-gated; any authenticated contact on the org can reorder the queue.
- 375px: cards stack full width (no lane grid at this width in the live component; the design's four-lane `TrackGroup`/`TrackRow` explicitly is not what's live here, see section 6).
- 768px and dark mode: not separately audited for this card as part of this pass; inherits the overview page's existing tokens.

**ProjectBoard (client home, project)**
- Loading: `SkelFigure` + `SkelRows rows={3}`.
- Empty (no phases, e.g. shared-but-never-published with nothing in `scheduleRows` either): "Your project plan is being set up. Your team will share the phases here shortly."
- Error: `CardError what="Your project plan" onRetry={...}`, phrased as "a claim about the studio's work, not about the request that did not come back" per the code's own comment.
- No progress known (schedule has no `effectiveDate`): phases render as a plain roadmap, no fabricated percentage, no "Now" chip.
- Read-only: the whole card has no writable control, so `ro` has no visible effect.
- 375/768/dark: not separately audited.

**`/p/schedule/[token]`**
- Loading: `DocLoading` (per the design; live viewer has its own loading state, not audited in this pass beyond confirming the route and layout exist).
- Not found / revoked token: 404 from the API; the design's `NotFound` copy is "This schedule is not available. The link may have been revoked while the plan was being reworked. Ask your project lead for the current one."
- Draft, never shared: 404 (route requires `status === 'shared'`).
- Shared but never explicitly published: live-table fallback (matches the ProjectBoard card's own fallback, so link and card never disagree, but both show whatever is live right now, not a frozen snapshot - a known open issue, see section 4).
- Dark / feature slide themes: each schedule section carries its own `themeMode` (`light` | `dark` | `feature`); STATUS records "dark slide themes render invisible text" as a live bug (T3.4) not yet fixed for this viewer.
- Print: no dedicated print stylesheet identified for this viewer in this pass.
- Public/no-login is the whole point of this page: no client-visible/admin-visible distinction, no seat distinction. It is bare-chrome by design (`app/p/layout.tsx`).

## 4. Features and actions

### `/tracks`
**Works today:** the studio-only empty state and its link to `/clients` (which is where tracks are actually managed, per client, on the client-detail Overview tab).

**Exists but wrong or half-built:**
- The entire client-facing branch of `TracksContent` (loading, populated `TrackQueueView`, ghost upgrade ticket, ManyRequests-style ", Nothing queued yet" copy) is real, wired to a real endpoint (`/api/portal/capacity`) and a real reorder route (`/api/portal/capacity/reorder`), but is dead code: no client session ever reaches it. The page's own header comment claims parity ("the client sees the same board on their portal as the studio sees here") that does not hold in practice.
- CT.18 (backlog, undecided): "Delete `/tracks` (linked from nowhere, HTML5-drag only; the client home's TrackBoard already tells the same story). If kept, a full redesign without the rail." This is an open decision, not yet made.

**Planned or missing:** nothing planned beyond the CT.18 decision itself; no other backlog item targets this route.

### Client home - TrackBoard ("Your work in motion")
**Works today:** real per-track current-item and queue rendering from `/api/portal/tracks`; up/down reorder via `PUT /api/portal/tracks/[trackId]/reorder`, scoped to the org and to client-visible (`isInternal=false`) requests only; synthetic entitlement-only lanes (an org entitled to a track it has no physical row for yet) render but correctly refuse to reorder (both client- and server-side); loading/empty/error states are honest per CT.3b and CT.3.

**Exists but wrong or half-built:**
- No "Waiting on you"/review lane and no "Delivered" lane on this board at all - the client cannot see a request that has moved to `client_review` or was recently delivered from this card (it only shows current + up-next). The richer four-lane model (`TrackQueueView`/`lib/track-lanes.ts`: Up next, In progress, Review, Delivered) already exists in the codebase, shared by the orphaned `/tracks` page and the admin client-detail Overview tab, but is not the component this card uses.
- No per-track "typical turnaround" or "delivered in the last 30 days" stat, even though `lib/track-stats.ts` (`trackDeliveredStats`) already computes exactly that, unit-tested, for the other implementation.
- No ghost-track upsell (ManyRequests-style ", the tracks a client would gain by upgrading") on this card; `getUpgradeGhostTracks` exists and is used by the orphaned `/tracks` page only.

**Planned or missing:** N7 "schedule -> tasks bridge" and the general N9 "dashboard-wide premium pass" (roadmap, not scoped) touch this area only tangentially. No specific backlog id currently proposes merging the two track implementations; flagging that gap is this document's own **proposal**, not an existing backlog item.

### Client home - ProjectBoard ("Your project, phase by phase")
**Works today:** real phase roadmap from the org's newest shared `projectSchedules` row, snapshot-first with live-table fallback for a shared-but-unpublished schedule (T2.4/CT.7, tested with 10 passing cases including snapshot-precedence and multi-schedule tie-break); progress is only asserted when an `effectiveDate` anchors "current week"; LW.11 (2026-09-13, merged) made this card and its "Your project, phase by phase" heading conditional on the engagement actually being a project (`lib/engagement-presentation.ts`), so a custom-priced retainer with no subscription row yet no longer gets shown fabricated project language.

**Exists but wrong or half-built:**
- A schedule that has been shared but never explicitly published (Publish button never pressed) still serves its **live**, editable rows to this card, matching what the client's own share link shows - which is itself the open T3.1/C1 issue ("the standard journey serves LIVE rows today" is now closed for the moment of *sharing*, per STATUS's `C1` note, but "heal the two Giant Group schedules that are shared without a snapshot" is still an open follow-up, and no UI signals to a client that phases they are reading might still move under them before a first publish).
- No "Waiting on you" style ask surfaced on this card, even though the *design* for the schedule reader (`ClientPapers`, section 4) explicitly calls out which phases are blocked on the client versus on the studio; the live ProjectBoard has no equivalent of that per-phase ownership language.

**Planned or missing:** none of the schedule-integrity backlog items (T3.1, T3.4, T3.5, T3.9) name this card directly; they target the public viewer and the studio editor. Whether they should also cover this card is an open question (section 7).

Note for whoever reconciles STATUS.md next: its schedules line ("drafts leak phase names onto the client home") is stale against this card specifically. CT.7/T2.4 closed that exact leak (`app/api/portal/project/route.ts` filters `status = 'shared'` and reads `publishedSnapshot`, 10 passing tests including "ignores a draft schedule newer than the published one"); the still-live gap is the narrower one already described above, a *shared-but-never-published* schedule serving live rows, not an unshared draft.

### `/p/schedule/[token]` (public, no-login, client papers)
**Works today:** token-gated read scoped to the exact schedule, 404 (not 401/403) on a missing/revoked token so token existence isn't leaked; snapshot-first with live fallback (share writes a first snapshot; `POST /api/admin/schedules/[id]/publish` re-snapshots); `app/p/layout.tsx` strips the visitor's dashboard dark-mode class on mount and mounts a real `ToastProvider`.

**Exists but wrong or half-built (from STATUS/TASKS, the schedules half of the shared T3/C1 bundle):**
- T3.4: slide sections with `themeMode: 'dark'` render invisible text (the viewer does not fully consume `--page-chrome-text`); STATUS separately still lists "dark slide themes render invisible text" as a live bug for this exact viewer.
- T3.5: the Gantt is "a 64rem pinch-scroll strip on phones" - no narrow-mode card stack for the schedule's own Gantt section at 375px (the schedule half of the same bug the proposal viewer's package tabs have).
- T3.1/C1 follow-up: "heal the two Giant Group schedules that are shared without a snapshot" (live data needing a one-off fix, not a code bug) plus the still-open live QA lap (share → edit → verify pinned → publish → revoke 404 → re-share) that has not been run end-to-end for a real schedule.
- T3.9's small-fix batch (alert()→toast, public tab titles + OG tags, em-dash metadata) applies to this viewer as part of the shared `app/p/*` bundle, not yet done.

**Planned or missing:**
- The in-portal `ClientPapers` "Schedule" list/reader (`sales-artifacts-kit.jsx`) is designed and unbuilt: an authenticated client currently has no page inside the dashboard that lists their schedules and opens a reader without a shared link; T2.3 explicitly deferred this to "Tier 3."
- T3.10 (C3.4) covers porting the **contract** public viewer onto the shared deliverable kit; there is no equivalent backlog line for the schedule viewer because it is already "the deliverable kit," but the re-critique STATUS calls for ("an actual critic re-check," last verdicted at Pass 1 only, never Pass 2 or 3) has not happened.

## 5. Data and integrations

- `app/api/portal/tracks/route.ts` - GET, client org's tracks + queue, gated on the `tracks` portal feature flag, reads `subscriptions`, `tracks`, `organisations` (for the `tracksMode`/custom-track-count override), `requests`; reconciles physical rows against the org's resolved entitlement via `lib/plan-utils.ts` (`resolveTracksConfig`, `buildEffectiveTracks`) so a synthetic (unfilled) lane always renders when the org is entitled to it.
- `app/api/portal/tracks/[trackId]/reorder/route.ts` - PUT, writes `requests.queueOrder`; refuses synthetic lane ids outright; verifies each request belongs to the org and is client-visible before writing; records an acting-as audit row (`recordActingWrite`) when a team member is impersonating; blocked entirely for a preview session that isn't in explicit act mode (`refusePreviewWrite`).
- `app/api/portal/capacity/route.ts` and `app/api/portal/capacity/reorder/route.ts` - the richer, four-lane data source (`tracks`, `queue`, `delivered`), shared with the admin client-detail Overview tab via `lib/track-lanes.ts`; this is what the orphaned `/tracks` page's client branch calls, not `/api/portal/tracks`. Two different portal endpoints answer "what are this client's tracks" today, with different shapes and different reorder semantics.
- `app/api/portal/project/route.ts` - GET, project-type clients' phase roadmap; reads `subscriptions` (retainer check), `projects`, `projectSchedules`, `scheduleRows`; honest about `progressKnown` (never fabricates a percentage without an anchoring `effectiveDate`); reads `invoices` (owed-status only) for "next invoice."
- `app/api/public/schedules/[token]/route.ts` - GET, no auth, token-gated; reads the same `projectSchedules`/`scheduleSections`/`scheduleRows` tables, strips internal ids and audit fields before returning.
- `app/api/admin/schedules/[id]/share/route.ts` and `.../publish/route.ts` - the studio-side writes this group's read surfaces depend on: share takes the *first* snapshot if none exists yet; publish re-snapshots on demand; revoke clears the snapshot and flips status back to `draft`.
- `lib/plan-utils.ts` - `resolveTracksConfig`, `buildEffectiveTracks`, `getUpgradeGhostTracks`, `trackCanHandle`: the one source of truth for how many tracks an org is entitled to (auto from plan type, custom override, or off) and which ghost/upsell tracks to show. Used by both portal endpoints and the studio `ops.jsx` Tracks page.
- `lib/track-lanes.ts` / `components/tahi/track-queue-view.tsx` / `lib/track-stats.ts` - the four-lane bucketing, presentation, and delivered/turnaround stats shared by `/tracks` (dead for clients) and the admin client-detail Overview tab (live for studio).
- `lib/engagement-presentation.ts` - pure decision function, no I/O; both `/overview`'s client-side branch and any test consuming it agree on retainer vs project from the same three booleans.
- `lib/onboarding-steps.ts` - not a data dependency of this group directly, but the reason a "kickoff" step exists at all in onboarding for both engagement types: a **new** retainer client reaches TrackBoard only after `welcome, plan, pay, details, invite`; a **new** project client reaches ProjectBoard only after `welcome, details, invite, kickoff`; an **existing** client (already on the books) skips straight to `welcome, kickoff` and is refused a second Stripe checkout server-side (`POST /api/portal/checkout` answers 409). `CLIENT_HOME_ONBOARDING_CHECKLIST_ENABLED = false` means no competing onboarding-checklist card currently shares the "Your work" zone with TrackBoard/ProjectBoard.
- No third-party integration is load-bearing for this group specifically. Xero/Stripe billing state feeds "next invoice" on ProjectBoard only (via `invoices`, already-imported rows); no live third-party call happens on any of these three surfaces at render time.
- **Must be honest:** no fabricated progress percentage (ProjectBoard, enforced), no "no tracks" copy shown on a read failure (TrackBoard, enforced by CT.3), no dead reorder buttons (both live reorder routes are real writes), but the public schedule viewer's "shared but unpublished" state **is** a live-rows-not-a-frozen-snapshot gap that a client could reasonably read as more final than it is.

## 6. Design system contract

- **PageHeader / headline band:** neither live client-home card uses the shared `Head`/band component from `ops-kit.jsx`/`requests-kit.jsx`; they use the overview page's own `ov-tb-head` block. The design file's `Tracks`/`TracksClient` both use `Head` with a subtitle and a right-aligned action slot ("See it as they do" on the studio side, "New request" on the client side) - a real gap against the shared band pattern this codebase otherwise standardises on (DL.2's whole point).
- **Left rail:** correctly absent from both live client-home cards and from the design's `TracksClient` (the design's own critic note for the *studio* `Tracks` page under `ops.jsx` was "the rail does not belong here" - DL.2 explicitly withholds the rail on wide-table/board pages including Tracks). Nothing in this group should grow a rail.
- **DataTable:** not applicable; this is entirely card/lane based, not tabular.
- **SlideOver:** none exists and none is proposed. Every state in this group is either a card on `/overview` or a full-bleed public document; no drawer/dialog belongs here per the design file either.
- **Leaf radius:** applies to any icon-in-circle or avatar wrapper this group might add (none currently rendered on the live TrackBoard/ProjectBoard cards; the design's `Av` avatar-with-leaf appears on the studio-side `TrackGroup` header only, not on the client-facing `TracksClient`, which is client-scoped and needs no per-client avatar).
- **Tokens:** both live cards already use CSS var references (`var(--color-...)` is the codebase-wide rule; this pass did not find a hardcoded hex in either component). The public schedule viewer explicitly departs from ambient dark mode by design (`app/p/layout.tsx`) and instead needs to honour each section's own `themeMode`, which today it does not do correctly in dark/feature slides (T3.4).
- **What the existing design file gets right:** `TracksClient` (client viewer) and `TrackGroup`/`TrackRow`/`Lane` (`ops-kit.jsx`) already model the exact four-lane story ("Up next, your order" / "In the studio" / "Waiting on you" / "Delivered, 30 days") the live product is missing, plus honest KPIs ("Being made now," "Waiting on you," "Delivered, 30 days," "Typical turnaround") computed from real per-track data, a ghost-track upsell card, and a "How the order works" explainer note. `ClientPapers` (`sales-artifacts-kit.jsx`) already models the client-facing schedule list with a spine (proposal → contract → schedule), an honest per-phase "waiting on you" vs "ours" split, and cross-links to the other two paper types with an honest one-line status each - none of which exists in the live ProjectBoard card.
- **What the design must change before it can be ported (critic verdicts):**
  - The studio `ops.jsx` Tracks/Team/Capacity/Time bundle carries no named critic verdict in the checklist at all (row unchecked, "NOT ported; live pages are v3-partial"); it needs an actual SHIP/FIX/REDO pass, not an assumed one. The catalogue's only recorded verdict for the *client* Tracks viewer specifically is **REDO** ("worst of that batch, titles break to single characters; critic says the rail does not belong here") - but that REDO was scored against the studio-side `Tracks` page carrying a rail it should not have; the client-side `TracksClient` in the same file was not separately re-verdicted and should be, since its rail problem does not obviously apply (it renders no rail at all in the code read for this pass).
  - `sales-artifacts-kit.jsx`'s public viewers (proposal/contract/schedule, including `ClientPapers`) are **FIX** only from Pass 1, "never re-verdicted at Pass 2 or 3; the builder claims fixes but that is a build report, not a critic pass." Nothing in this group's schedule surfaces should be ported on the strength of that stale FIX alone.
  - Before any port: T3.4 (theme integrity) and T3.5 (375px Gantt) must land in code or be explicitly re-designed to avoid them, since both are described against the *live* viewer, not the design file, and the design file has not been checked against those two specific failure modes.

## 7. Open questions for Liam

1. CT.18: delete `/tracks` outright (since the client home's TrackBoard already tells the same story), or keep it and give it a real redesign without a rail? This is already logged as an undecided backlog item (CT.18) blocking this group's own scope.
2. Should TrackBoard on the client home gain the "Waiting on you" and "Delivered, 30 days" lanes (and the turnaround stat) that already exist in `lib/track-lanes.ts`/`lib/track-stats.ts` for the other implementation, or is the simpler two-state board (current + queue) the intended permanent shape for that card, with the richer four-lane view reserved for wherever `/tracks` ends up (question 1)?
3. Is a logged-in, in-portal "Schedule" page (the designed `ClientPapers`, kind=`schedules`) coming back into `CLIENT_NAV`, or does the public `/p/schedule/[token]` link plus the ProjectBoard phase card on `/overview` remain the only two schedule surfaces a client ever sees? (T2.3 removed the nav item for exactly this reason: no client branch existed yet.)
4. Should the ProjectBoard phase card gain the per-phase "waiting on you" vs "ours" ownership language the `ClientPapers` design already has for schedules, or is that level of detail meant to stay exclusive to the shared schedule link?

## 8. Acceptance for the design review

1. At 1440 and 375, light and dark, the `/tracks` route is confirmed to redirect a client session to `/requests` with no flash of track content, and confirmed to show the studio-only "Manage tracks from a client" empty state for a real studio session, since that is the entire live behaviour of this route today.
2. At 1440 and 375, the client-home TrackBoard card shows its loading skeleton before any data, its honest error card on a failed read (never "No active tracks yet."), and its zero-track-entitlement copy ("Your plan is being set up by the studio.") only when there is genuinely no subscription, project, or schedule signal.
3. Reordering a queued item in TrackBoard updates the on-screen order immediately (optimistic) and a synthetic (unfilled) lane never offers a reorder control.
4. The ProjectBoard card never shows a percentage-filled meter on a phase unless the schedule carries an anchoring effective date; with no date, phases render as a plain, un-percented roadmap.
5. The ProjectBoard card's title and phase names never read as a one-off "project" for a client who is actually on a retainer with no subscription row provisioned yet (must fall back to the TrackBoard zero-state copy, not project language).
6. `/p/schedule/[token]` at 375px does not force horizontal pinch-scrolling to read the Gantt as a checklist item (flag as FIX if it still does; this is the one item still confirmed broken as of the last STATUS update).
7. `/p/schedule/[token]` renders every slide with legible text against its own `themeMode` in both light and dark (a dark-themed section must not render invisible or unreadably low-contrast text; flag as FIX if this recurs).
8. No screen in this group ever shows another organisation's name, plan, request, or queue position, checked by opening the same screenshot set for two different seeded client sessions and confirming the content differs appropriately.
9. No screen in this group shows a Messages link, a Team/Access control, or any other Tahi-internal-only affordance.
10. Every reorder or "New request" control visible on a screenshot is confirmed against this document's section 4/5 to be a real, wired action (not a dead button), or is explicitly labelled a "proposal" if it does not yet exist in code.
