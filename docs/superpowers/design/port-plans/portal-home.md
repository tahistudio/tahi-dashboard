# Port plan: portal-home (the client home on /overview)

Written 2026-09-26. The design passed the critic (SHIP after one revision) but Liam has not reviewed it, so everything below ships as "ported, unchecked". Nothing in this plan is committed.

- Route: `/overview`, client half only (a signed in client contact, plus a Tahi admin using View as client or Act as client). The owner and teammate halves belong to the overview module (`docs/superpowers/design/port-plans/overview.md`).
- Audience: client.
- Design fetched: yes. Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66, files read in full: `portal-home-page.jsx` (the composition), `portal-home-boards.jsx` (every zone and panel), `portal-home-boards.css` (the 2026-09-13 pass rules, including the tablet regime), `portal-home-variants.jsx` (the page map and sample shapes), `previews/portal-home-preview.html`; `portal-home.css` read for the lane, queue, call, plan and tile base rules. `portal-home.jsx`, `portal-home-kit.jsx` and `portal-home-data.jsx` were not reread: they are the shared requests half and the sample data, and the page file above overrides the home they used to carry.
- Other sources: the portal-home section of `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, `docs/superpowers/design/requirements/client-home.md`, `docs/superpowers/design/requirements/client-tracks-schedule.md` (sections on the client home TrackBoard and ProjectBoard), `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`, and the live code: `app/(dashboard)/overview/page.tsx`, `components/tahi/overview/overview-home.tsx`, `components/tahi/overview/ctx.ts`, `components/tahi/overview/ov-kit.tsx`, `components/tahi/overview/homes/client-home.tsx`, `components/tahi/portal/home/waiting-on-you.tsx`, `components/tahi/portal/home/portal-home.css`, `app/(dashboard)/overview/overview.css`, `app/globals.css` (sidebar and main padding), `components/tahi/app-sidebar.tsx`, `components/tahi/empty-state.tsx`, and the routes `app/api/portal/tracks/route.ts`, `app/api/portal/tracks/[trackId]/reorder/route.ts`, `app/api/portal/project/route.ts`, `app/api/portal/subscription/route.ts`, `app/api/portal/requests/route.ts`, `app/api/portal/invoices/route.ts`, `app/api/portal/calls/route.ts`, `app/api/portal/files/route.ts`.
- Page keys (21): home, home-one-track, home-three-tracks, plan-setup, project, project-undated, billing-xero, quiet, empty, loading, card-errors, member-seat, view-as-client, act-as-client, first-run-fresh, first-run-mid, first-run-finish, first-run-hidden, plan-sheet, project-sheet, welcome-video.
- Critic: SHIP (first pass FIX). There are no still-open FIX items for this module. The one first-pass FIX, repeated on all 21 pages, was the 768px layout falling into the stacked phone layout; the designer resolved it with a "tablet regime" in `portal-home-boards.css`. The port carries that fix, re-measured against the real shell (section 4).
- Backend: one small additive change to `GET /api/portal/project` (slice C). No migration anywhere.

## 1. What the live code already matches (no work)

The live client home is already a port of an earlier cut of this design (CT.3, CT.3b, CT.7, CA3.1, V1-FIX.1, PP.2, LW.2 to LW.5, LW.11, the 2026-09-14 member seat and dark empty tile fixes). These stay as they are:

- Page order and grid: masthead, Wire, Waiting on you hero, vitals strip, then the zones Your work (12), Activity (7 + 5), Library (6 + 6), Billing (7 + 5), on the ov-kit `Zone` / `Card` / `CardH` / `Row` primitives.
- Masthead: "Kia ora, {first}." with the date resolved after mount, org name and plan label, and exactly one primary New request on the leaf radius that opens `requests?new=1` and is disabled under read-only.
- The Waiting on you tile: fixed forest in both themes (including the empty state, per Liam's LW round two fix), ranked rows (hand-offs, reviews, the nearest owed invoice, a call with a real link), capped at three with an in-place expander, each row a real door, the read-only lens note, the pulsing loading bars.
- Honest engagement resolution (`lib/engagement-presentation.ts`), N track lanes from the entitlement including synthetic lanes, synthetic lanes refusing reorder on both sides, up and down reorder through `PUT /api/portal/tracks/[trackId]/reorder`.
- Per-card loading skeletons and per-card errors on requests, calls, files, team, tracks and project.
- Xero next invoice projected from the cadence, the rail named when nothing can be projected (CA3.1).
- Member seat: no invoices card, no invoices vital, and the whole Billing zone collapsed to "Billing is handled by your account admin." because `/api/portal/subscription` withholds every plan and money field from a member (fc5eb47c).
- No Messages door, no `/billing` link, no "Soon" button, the team card note "Questions live on the request they are about".
- Next call only offers Join with a real meeting link; the reschedule note.
- Pay at 1.75rem on a fine pointer and 2.75rem on a coarse pointer or under the 46rem container; reorder controls the same.
- The 46rem container collapse at 375 (rail label hidden, vitals 2 up, every card full width), dark mode through tokens.
- The first-run checklist (`ClientFirstRun`) exists and is switched off by `CLIENT_HOME_ONBOARDING_CHECKLIST_ENABLED = false` (LW.9). It stays untouched.

Deliberate live choices that win over the prototype (existing patterns and Liam-approved fixes):

- The quiet (empty) Waiting on you state stays on the forest tile. The design draws it as a light card; Liam asked for the dark header to stay (LW round two).
- The masthead sits above the first-run panel (the page opens on its h1). The design puts the checklist first.
- The vitals strip stays the ov-kit `Vitals` shared with the studio homes, not the requests headline `Band`. The "To approve" label stays: the design's "Waiting on you" vital repeats the tile heading, which the live code removed on purpose.
- The Wire stays the ov-kit `TheWire` ticker ("News feed"), not the design's static "Lately" line.
- A review row keeps "Review" (opens the request's approve view). The design's inline "Approve" and "Request changes" are not ported (the requirement calls it a copy difference, not a gap).
- Hand-off rows and the "Also waiting on your team" card (H2) are live features the design predates. Keep them.
- Client copy stays pronoun free and never names Liam (LW.2 to LW.5). The design's "Liam sets the next one", "Liam is provisioning", "once Liam sets the meeting up" become "your lead" or "the studio".

## 2. What differs, page key by page key

**home (two tracks)**
- TrackBoard lanes: design lanes are a clickable tile (opens the request) with a live dot, title, due chip, stage meter and status caption; live lanes are not clickable. Port the clickable tile. The design's crew avatars, "Staci is on it" and "Blocked by" line have no data in `/api/portal/tracks`: not ported.
- Queue: the design has ONE queue under the lanes ("Up next, in your order", "N waiting", position, title, size, a "Next up" pill, up and down). Live draws a queue inside every lane, and because `/api/portal/tracks` fills each lane's queue with every queued request of that lane's size, two lanes of the same size print the same queue twice. The single queue fixes a live duplication bug with no backend change (the reorder route writes `queueOrder` for any request of the org through any real track id).
- Lane names: design "Track one", "Track two"; live "Track 1". Port the words.
- Footer: one "Queue another" (design) instead of one per lane, plus the live "Need more done at once?" with "Ask about another track" opening a new request (the design links it to the plan sheet, which is skipped).
- Waiting on you error state: design keeps it on the forest tile; live drops to a light card. Port the forest error.
- Partial signal: design warns inside the tile when one read behind it failed. Live says nothing, so an invoices read that 500s lets the tile claim "All quiet". Port the warning for a failed invoices (not denied) or calls read.
- Recent requests: design sub reads "#142 · updated 2h ago" with the status only on the chip; live repeats the status word in the sub. Port it (`requestNumber` is already on the payload).
- Next call: design is a small composition (day and time large, date and length, title, attendee, full width "Join the call"). Live is one row. Port it with the fields the route returns (no agenda note: none is returned to clients).
- Invoices rows: design sub carries the invoice number. Port it (`number` is on the payload).
- Plan card: design shows the price on the top line and a "projected from your monthly cadence in Xero" note under Next invoice. Port both. The design's plan description line, "Revisions" row and "With us since" row have no data source: not ported.
- Empty and error copy for cards: port the design's per-card empty sentences where honest (below), without second New request buttons.

**home-one-track**: live's lane grid is a fixed two columns, so one lane renders at half width. The design drives the grid from the lane count. Port it.

**home-three-tracks**: three across above 60rem, two per row from 46 to 60rem, one below; a synthetic lane is a dashed "On your plan, not live yet." ghost with no controls. Live renders a synthetic lane as "Ready for your next request", which reads as an open slot the client can use. Port the ghost.

**plan-setup**: design has a dashed setup panel with a leaf tile ("Your plan is being set up by the studio.") and a matching "Being set up." Plan card. Live prints one grey line on the board and a placeholder Plan card ("Retainer", "Retainer plan", Next invoice "TBC", Tracks "0 active"), which is placeholder copy dressed as data. Port both setup panels.

**project**: design ProjectBoard is a vertical timeline (rail, dots, "Now" pill, date range per phase, active task note, a meter only on the active phase, a footer saying where the dates come from). Live is a grid of phase cards with a meter on every card. Port the timeline. Per phase dates and the "pinned" footer need two additive fields from slice C; the board renders without them until then. The design's "Signed off" pill becomes "Done" (the state is computed from dates, nobody signed anything). Project progress vital: design "2 of 5, phases done" instead of live's blended percentage. Port it. Project card: live falls back to "TBC" for the milestone and to "On launch" for the next invoice, which is a guess; port honest fallbacks.

**project-undated**: live already returns no progress; the timeline renders plain dots, no Now, no meter, and the design's footer explains why.

**billing-xero**: live already renders the native GBP rate with the display equivalent. Add the "projected" note.

**quiet**, **empty**: match live (forest tile, first request link only with zero requests). Card empties move to `EmptyState` inline style with the design's sentences.

**loading**: matches live per card. Add the missing Plan card and Project card skeletons.

**card-errors**: live is missing two card errors and one strip rule. A non-403 invoices failure renders "No invoices yet." and the vital "Invoices due 0, all settled"; a subscription failure renders the placeholder Plan card and silently treats a project client as a retainer. Port the design's error for both cards, "Unknown, we could not check just now" for failed vitals, and a "Your work did not load" error when the engagement type is unknown.

**member-seat**: design draws a full width Plan card with figures. The server withholds those figures from a member by design, so live wins: the collapsed "Billing is handled by your account admin." card stays.

**view-as-client**: matches live. Keep reorder hidden, every write disabled, lane tiles and queue titles still open the request (reading is allowed).

**act-as-client**: design adds a tile note ("You are acting as {org}. Everything works except paying, which stays read-only.") and a reason on the disabled Pay buttons. Live disables Pay silently. Port both.

**first-run-fresh, first-run-mid, first-run-finish, first-run-hidden**: the checklist is flagged off (LW.9) and whether it returns is Liam's question 1. Not ported; `ClientFirstRun` stays as it is and first-run-hidden is exactly today's behaviour.

**plan-sheet, project-sheet, welcome-video**: proposals pending Liam's questions 4 and 5. Not ported, and none of the doors that open them are built.

## 3. Honesty defects the port closes (live today)

1. Invoices read fails with a 500: the card says "No invoices yet." and the strip says "Invoices due 0, all settled". (slice B)
2. Subscription read fails: the Plan card shows "Retainer", "Retainer plan", "TBC"; a project client silently gets the TrackBoard. (slice B)
3. Invoices or calls read fails: the hero can still say "All quiet in the studio." (slice B)
4. Two lanes of the same size print the same queue twice. (slice A)
5. A one track plan renders its lane at half width. (slice A)
6. A synthetic lane looks like an open slot. (slice A)
7. Project card "Next invoice: On launch" and "Next milestone: TBC" are invented fallbacks. (slice B)
8. Pay is disabled with no reason in Act as client. (slice B)
9. A shared but never pinned schedule gives the client no hint its dates can still move (client-tracks-schedule requirement, section 4). (slices A and C)

## 4. The tablet regime, measured against the real shell

The critic's FIX: at 768 the client rail stays 240px, the page container never reaches the width the 12 column spans need, and the page falls into the stacked phone layout. Acceptance item 5 asks for two columns at 768.

Real numbers: `.tahi-sidebar` is 240px from 768px up (64px when the user collapses it), and `.dashboard-main` pads 2.5rem each side from 48rem. At a 768 viewport the `.ov` container is 768 minus 240 minus 80 = 448px, 28rem (39rem with the rail collapsed). The designer measured 33rem in the prototype shell, so the design's 30rem pairing floor would not fire in the product. A phone at 480px wide is also a 28rem container, so the container alone cannot tell a tablet from a phone.

The port keys pairing to both: viewport at least 48rem (a media query) AND `.ov` container at most 66rem (a container query nested inside it). Every zone pairs its cards two per row; a card spanning 12 (the work board, the member seat billing card, the full-width plan card) keeps the whole row. Below 48rem viewport it is one column exactly as today. Above 66rem the designed spans stand.

A paired card at 768 with the rail expanded is about 13.6rem wide, so the design's "narrow card" rules are mandatory: at a container of 34rem or less inside the pairing regime, rows put the title on its own line and the right value, Pay and chevron on the line below.

Gotcha: the design gets narrow cards with `container-type` on each card. Do NOT do that here. Live `.ov` is an unnamed container and every `@container` rule in `overview.css` and `portal-home.css` is unnamed; putting `container-type` on `.ov-card` would silently retarget every one of them for elements inside cards (Pay and reorder would jump to 44px on desktop, row margins would change). Key the narrow rules off the page container instead.

If Liam answers his tablet question by collapsing the client rail to 64px below 1024px (a `globals.css` change outside this module), the paired cards become about 19rem and the narrow rules stop firing at 768. Nothing in this plan needs to change for that.

## 5. Slices

Order: overview slice A first (it owns `ov-kit.tsx` and `overview.css`, restyles shared pieces of the client home, and adds `Skel`, `CardState`, `CardBody` to the kit). Then slice A here and slice C in parallel. Slice B last, because it imports slice A's components. Owned files are disjoint.

### Slice A: home-boards (the Your work zone)

Owned files: `components/tahi/portal/home/track-board.tsx` (new), `components/tahi/portal/home/project-board.tsx` (new), `components/tahi/portal/home/home-boards.css` (new), `lib/track-queue.ts` (new), `lib/__tests__/track-queue.test.ts` (new), `components/tahi/portal/home/__tests__/home-boards.test.tsx` (new). About 1.5 days. No backend, no migration.

Brief: section 8.

### Slice B: home-page (composition, hero, cards, billing, vitals, tablet regime)

Owned files: `components/tahi/overview/homes/client-home.tsx`, `components/tahi/portal/home/waiting-on-you.tsx`, `components/tahi/portal/home/portal-home.css`, `components/tahi/portal/home/__tests__/waiting-on-you-empty.test.tsx`, `components/tahi/portal/home/__tests__/waiting-on-you-states.test.tsx` (new). About 2 days. No backend, no migration. Starts after slice A is on main. Brief: section 8.

### Slice C: project-dates-api (additive fields on GET /api/portal/project)

Owned files: `app/api/portal/project/route.ts`, `app/api/__tests__/portal-project-published-schedule.test.ts`. About 0.5 day. Backend yes (additive response fields), no migration. Brief: section 8.

## 6. Not ported (skipped proposals and Liam-dependent pieces)

- The studio notice banner (`Notice`, pf-notice): a proposal belonging to the unbuilt Announcements feature (requirement question 3).
- The plan detail sheet (`PlanSheet`) and its doors: "What is a track?", "See the detail", the "Need more done at once?" link (requirement question 4). The live "Ask about another track" and "Ask about your plan" doors (New request dialog) stay.
- The project detail sheet (`ProjectSheet`) and its "See the plan" and "See the detail" doors (question 4).
- The welcome video sheet (`VideoSheet`, inline Loom): question 5. The checklist keeps opening Loom in a new tab.
- The first-run checklist redesign (`FirstRun`, pages first-run-fresh, mid, finish): flagged off (LW.9) and question 1. `ClientFirstRun` is untouched.
- The masthead quick request input ("What do you need?" seeding the dialog): needs a title seed in the requests module's `request-list.tsx` and dialog, which another module owns. The single New request button stays.
- Inline "Approve" and "Request changes" on a review row, and "Move it" on a call row (no reschedule backend; it would be a dead button).
- Crew avatars, "X is on it" and "Blocked by" on lane tiles: `/api/portal/tracks` returns none of it.
- The four lane TrackBoard (Waiting on you and Delivered 30 days lanes, turnaround stat, ghost upsell tracks): client-tracks-schedule question 2 and CT.18.
- Plan card description line, "Revisions" row and "With us since" row: no data source (subscription `createdAt` is the import date for migrated clients, so it would misstate tenure).
- The member seat full width Plan card with figures: the server withholds them from members on purpose.
- The design's light quiet tile, its darker forest palette and green pill buttons: live forest tile and white leaf buttons stay (Liam-approved).
- The requests headline `Band` for the vitals: the ov-kit `Vitals` stays.
- File size column and request-linked file rows: no size on `/api/portal/files`; live opens the file itself, which is the better door.
- Collapsing the client rail at tablet width: a shell decision for Liam, not this module.

## 7. Questions for Liam

1. Tablet: should the client rail collapse to the 64px icon strip below 1024px? The port pairs cards at 768 either way, but with the 240px rail each paired card is about 13.6rem wide.
2. LW.9: does the first-run checklist come back, and before or after this port? Its four drawn states are ready to port once it does.
3. Plan and project detail sheets: build them as real slide-overs, or is the inline Plan card the whole answer and the sheets get dropped?
4. The dismissible studio notice: on the home as part of Announcements, or broadcasts stay list only?
5. Welcome video: inline in a sheet (third party player in our chrome) or keep the new tab?
6. TrackBoard: is current plus one queue the permanent shape, or should it gain the Waiting on you and Delivered 30 days lanes and the turnaround stat that `lib/track-lanes.ts` and `lib/track-stats.ts` already compute (tied to CT.18)?
7. The design's masthead quick input ("What do you need?") that starts a request with the title typed: wanted? It needs a small change on the requests side.
8. Should the tile approve a delivery in place ("Approve" on the home) or keep sending the client to the request to review it first?

## 8. Slice briefs

### Slice A brief: home-boards

Design to follow: Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66, `portal-home-boards.jsx` (TrackBoard, ProjectBoard), `portal-home-boards.css` (lanes, phases, the 60rem and 48rem breakpoints), and the lane, queue and row rules in `portal-home.css` (`.pf-lane*`, `.pf-lane-tile`, `.pf-lane-empty`, `.pf-queue*`, `.pf-qrow`, `.pf-qpos`, `.pf-qtitle`). Page keys: home, home-one-track, home-three-tracks, plan-setup, project, project-undated, loading, card-errors, view-as-client (`previews/portal-home-preview.html?page=<key>`, add `&theme=dark` and `&device=phone`).

Before writing anything: grep `components/tahi/overview/ov-kit.tsx` (Icon, OfficialLeaf, and the Skel, CardState, CardBody that overview slice A adds), `components/tahi/empty-state.tsx`, `lib/portal-status.ts` (`portalStatusMeta`, `portalStageFraction`), `lib/client-home-signals.ts`, and the live boards at the TrackBoard and ProjectBoard functions in `components/tahi/overview/homes/client-home.tsx` (read only; slice B deletes them). If `CardState` and `CardBody` are not exported from ov-kit when you start, stop and report: overview slice A has not landed.

Scope: two standalone client components plus a pure helper. Do not wire them into the page and do not edit `client-home.tsx`, `overview.css`, `ov-kit.tsx` or `portal-home.css`. Slice B wires them.

1. `lib/track-queue.ts` (pure, no React), with Vitest tests in `lib/__tests__/track-queue.test.ts`:
   - `unifiedQueue(tracks)`: the union of every lane's `queue`, deduplicated by request id, sorted by `queueOrder` ascending (null last) then `createdAt` ascending. Tracks shape: `{ id, type, synthetic?, currentRequest, queue: Array<{ id, title, type, status, queueOrder, dueDate, createdAt }> }` (what `/api/portal/tracks` returns).
   - `nextUpIds(queue)`: the id of the first queued item of each request type (`small_task`, `large_task`).
   - `reorderTrackId(tracks)`: the first track id that is not synthetic, or null.
   - `laneName(index)`: "Track one" to "Track five", then "Track 6" onwards.
   - Tests: two same-size lanes carrying the same queue produce it once; order; next up per type; a synthetic-only org gives null.
2. `components/tahi/portal/home/track-board.tsx`, `'use client'`, exports `TrackBoard` and its prop types. Props: `tracks`, `planLabel: string | null`, `ro`, `loading`, `failed`, `onRetry`, `onStart` (opens the New request dialog), `onOpen(requestId)`, `onReorder(trackId, requestIds)`.
   - Shell: keep the live `.ov-trackboard` card and `.ov-tb-head` header classes (they stay in `overview.css`), h3 "Your work in motion", sub "{planLabel} plan. {n} track(s) running side by side." (drop the plan part with no label). No "What is a track?" link.
   - Lanes: a grid with inline `style={{ '--lanes': n } as CSSProperties}`; CSS `grid-template-columns: repeat(var(--lanes, 2), minmax(0, 1fr))`, two per row under `@container (max-width: 60rem)` with a lone lane spanning `1 / -1`, one per row under `@container (max-width: 46rem)`. Do not put `min()` inside `repeat()`. These unnamed container queries resolve to `.ov`, which is right because the board is always a full row.
   - Lane header: `laneName`, then on the right the status chip (`.ov-chip` plus `portalStatusMeta(status).chip`, gloss as title) for a busy lane, a quiet "Open" pill for an open real lane, a quiet "Being set up" pill for a synthetic lane.
   - Busy lane: a `button type="button"` tile, full width, left aligned, hover border `var(--brand)`, visible focus ring, calling `onOpen(id)`: a small brand live dot (pulse off under prefers-reduced-motion), the title, a meta line with the delivery label ("Delivery Friday", same rule as the live `deliveryLabel`) or the type label ("Small task", "Large task") when there is no due date, a `.ov-meter` at `portalStageFraction(status)` and the status label as caption. No crew, no "is on it", no "Blocked by".
   - Open real lane: dashed box, "Ready for your next request." / "This track is open." (the design's "pulls in on its own" is not true: nothing auto-assigns a track).
   - Synthetic lane: dashed, transparent background, "On your plan, not live yet." / "The studio is setting this track up. Nothing queues on it until it is." No controls.
   - One queue under the lanes (`unifiedQueue`): header "Up next, in your order" and "{n} waiting"; rows with a position chip (`var(--radius-leaf-sm)`), a title button calling `onOpen`, the type label under it, a brand "Next up" pill on each `nextUpIds` row, and up and down icon buttons (aria-label "Move {title} up" / "down", 2rem on a fine pointer, 2.75rem under `@media (pointer: coarse)` and under `@container (max-width: 46rem)`, hover and focus-visible states). Hide the controls when `ro` or when `reorderTrackId` is null. Swap optimistically, then call `onReorder(reorderTrackId, fullOrderedIds)`; resync local order when the incoming queue signature changes (the live `laneKey` pattern).
   - Queue empty: with a busy lane "Your queue is empty. Every busy track is working on what you last sent."; otherwise "Your queue is empty. Anything you send lands here, in the order you choose."
   - Footer: "Queue another" (secondary, small, plus icon, `onStart`) and, on the right, "Need more done at once?" with the ghost "Ask about another track" (`onStart`). Both disabled under `ro`.
   - No lanes: a setup panel (dashed border all round, `var(--bg-secondary)`, a 2.75rem tile on `var(--radius-leaf-sm)` with `OfficialLeaf` in `var(--brand)` on `var(--brand-100)`), "Your plan is being set up by the studio." / "No active tracks yet. This card fills in once your tracks are live." No button.
   - Loading: header plus the kit `Skel` (2 rows). Failed: header plus `CardState` error "Your tracks did not load." / "That is on us, not you. Nothing you have sent is affected." with Try again (`onRetry`). A failed read never shows the empty copy.
3. `components/tahi/portal/home/project-board.tsx`, exports `ProjectBoard` and its prop types. Props: `project` (the `/api/portal/project` shape, with OPTIONAL `startISO`, `endISO` per phase and optional `pinned`, `pinnedAt` at the top level, added by slice C), `loading`, `failed`, `onRetry`.
   - Same `.ov-trackboard` shell; h3 "Your project, phase by phase", sub "{title}. {n} phases." plus " Phase {k} of {n}." when an active phase exists. No "See the plan" link.
   - An `ol` (aria-label "Project phases") timeline: a left rail column with a dot and a 2px connecting bar in `var(--border-subtle)` drawn as a pseudo element (not a one-sided border); done dot filled `var(--brand)` with a check in `var(--bg)`; active dot a 3px `var(--brand)` ring on `var(--bg)`; upcoming and unknown a ring in `var(--border)`. Text: "{i}. {name}", a brand "Now" pill on the active phase, a quiet "Done" pill on done phases (never "Signed off"), the date range "{start} to {end}" (en-NZ, day and short month) only when both ISO fields are present, the note (active task label), and a `.ov-meter` capped at 26rem only on the active phase with the caption "{pct} percent through". Active row tinted `var(--brand-100)` with rounded corners.
   - `progressKnown` false: every phase renders neutral (no Now, no Done, no meter) even though the API reports them as upcoming.
   - Footer (`.ov-mini`): progress unknown: "This plan has no dates on it yet, so we will not guess how far through you are. The order and the phases are right."; known and `pinned === false`: "This plan has not been pinned yet, so dates can still move."; known and pinned: "Dates come from the plan your team shared with you, pinned on {date}." (drop the date when `pinnedAt` is null); known and `pinned` absent: "Dates come from the plan your team shared with you."
   - No phases: `CardState` empty "Your project plan is being set up." / "Your team will share the phases here shortly. Nothing is missing on your side." No CTA.
   - Loading: `Skel` (3 rows). Failed: `CardState` error "Your project plan did not load." with Try again.
4. `components/tahi/portal/home/home-boards.css`, imported by both components: wrapped in `@layer components`, rem only (1px and 2px hairlines allowed), tokens only (`--bg`, `--bg-secondary`, `--border`, `--border-subtle`, `--text`, `--text-muted`, `--text-faint`, `--brand`, `--brand-100`, `--brand-strong`), no hex, no one-sided borders (row separators as 1px pseudo element lines, as the design does), prefix `phb-`.
5. `components/tahi/portal/home/__tests__/home-boards.test.tsx`: three lanes render three lanes; a synthetic lane shows "On your plan, not live yet." and no reorder buttons; a queue shared by two lanes renders once; `ro` hides reorder; a failed read never renders "No active tracks yet"; `progressKnown` false renders no "Now" and no meter.

States to cover: loading, failed, setup (no lanes, no phases), populated with 1, 2 and 3 lanes, synthetic lane, empty queue, read-only, progress known and unknown, pinned and not pinned. 375: one lane per row, reorder 44px, no horizontal scroll. Dark: token driven, check the done dot and the "Now" row tint. Live QA happens in slice B once wired; here, `npm run type-check`, `npm run lint`, `npm run test`, `npm run build`.

Do not build: the plan or project sheets or their doors, drag handles, crew, blocked-by, Waiting on you or Delivered lanes, ghost upsell tracks, any fetch inside these components.

### Slice B brief: home-page

Design to follow: Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66, `portal-home-page.jsx` (composition, vitals, cards), `portal-home-boards.jsx` (WaitingOnYou, InvoicesCard, PlanCard, ProjectCard, `nextInvoiceLine`), `portal-home-boards.css` (per card states, the tablet regime and the narrow card block), and the call and plan rules in `portal-home.css`. Page keys: home, home-one-track, home-three-tracks, plan-setup, project, project-undated, billing-xero, quiet, empty, loading, card-errors, member-seat, view-as-client, act-as-client.

Prerequisites: overview slice A merged (ov-kit `Skel`, `CardState`, `CardBody`; its `.ov-cta` and focus changes also restyle this page) and slice A of this plan merged (`track-board.tsx`, `project-board.tsx`, `lib/track-queue.ts`). Check both before starting.

Do not edit `overview.css`, `ov-kit.tsx`, `overview-home.tsx`, `request-list.tsx` or any route. Do not touch `ClientFirstRun` or the LW.9 flag. `portal-home.css` is also imported by `components/tahi/portal/portal-studio-team-card.tsx` (request detail): leave the `.pfh-team-*` rules alone and scope every new rule under `.ov-client` or `.pfh-tile`.

1. Wiring (`client-home.tsx`): add `ov-client` to the root (`className="ov ov-client"`). Replace the local `TrackBoard` and `ProjectBoard` with the slice A components (`onOpen={id => go(requestRouteId(id))}`) and delete the local copies. Replace the local `CardError` and `SkelRows` with the kit's `CardState` and `Skel` (keep `SkelFigure` for the vitals figures). Error copy everywhere: "{What} did not load." / "That is on us, not you. Nothing you have sent is affected." with Try again revalidating only that read.
2. Subscription read: also take `error` and `mutate`. `subFailed = !subData && !!subError`. If `subFailed` and `ctx.clientType` is unset, the Your work zone renders a full row `CardState` error "Your work did not load." whose Try again revalidates the subscription (then tracks or project). Never guess retainer from a failed read.
3. Plan card: loading shows `Skel`; failed shows `CardState` error "Your plan"; an admin seat with `subscription: null` shows the setup panel "Being set up." / "Your plan shows here once the studio has set it up." (no button). Populated: the plan label as a bold figure and the rate beside it through `Money` (native, `withDisplay`, `sensitive`) plus " a month" (or `cadenceWord(billingInterval)`), then subrows Tracks "{n} running" and Next invoice. Next invoice: the date, with a small muted line "projected from your {cadence} cadence in Xero" when `invoiceChannel === 'xero'` and `currentPeriodEnd` is null and `nextInvoiceDate` is set (add `currentPeriodEnd` to `SubscriptionResp`; it is already on the payload); no date and Xero: "Invoiced {cadence} through Xero"; no date otherwise: "Not scheduled yet" (never "TBC"). Keep the ghost "Ask about your plan" (New request dialog). Move every inline font, px and gap style in the Billing zone into `portal-home.css` classes in rem.
4. Invoices card: add `number` to `InvoiceRow`. `invoicesFailed = !invoicesData && !!invoicesError && !invoicesDenied`: the card renders a `CardState` error "Your invoices did not load." with Try again, never "No invoices yet.". Rows: sub "{number} · {due label}" or "{number} · Paid {date}". Empty: `CardState` empty "No invoices yet." / "Your first one lands here the day it is raised.". Pay: keep `invoicePayDestination`, `disabled={moneyRo}`, a `title` "Money stays read-only while you are viewing as {previewName}" when disabled, remove the inline `payDisabled` style and add `.ov-client .ov-pay:disabled { opacity: .5; cursor: not-allowed }`. Keep the in-flight shimmer and the 7 span. Member seat branch unchanged.
5. Project card: loading `Skel`, failed `CardState` "Your project", Next milestone fallback "Not set yet" (not "TBC"), Next invoice fallback "None due" (not "On launch"), inline styles to classes.
6. Vitals (still ov-kit `Vitals`): a vital whose own read failed renders `num` "Unknown", `sub` "we could not check just now", `muted` (requests failed: Open requests and Next delivery; both review reads failed: To approve; project failed: Project progress; `invoicesFailed`: Invoices due). A denied invoices read keeps the vital absent. Project progress known: "{done} of {n}" with sub "phases done"; unknown: "Not set" with sub "no dates on the plan yet". For a project client drop Next delivery so the strip stays at four cells. Keep "To approve" as the label.
7. Waiting on you (`waiting-on-you.tsx`, keep every current prop and behaviour):
   - Error: render on the forest `.pfh-tile` (heading "Waiting on you", "Your overview did not load. That is on us, not you. Nothing you have sent is affected.", Try again as `.pfh-btn primary`) instead of the light `.pfh-err` card.
   - New optional `moneyRo?: boolean`: when `moneyRo && !ro`, the lens note reads "You are acting as {previewName}. Everything works except paying, which stays read-only.".
   - New optional `reason?: string` on `WaitingAction`, used as the `title` when the action is disabled. Client-home sets it on the invoice Pay under `moneyRo`: "Money is read-only while you are acting as {previewName}" (Act as) or "Read-only in client view" (View as).
   - New optional `partial?: string | null`, drawn as a warning line under the header in the populated and the quiet states (never instead of them). Client-home passes "One source did not answer, so this list may be short. Everything else here is current." when `invoicesFailed` or `callsFailed` (the same sentence overview slice A uses for the studio Needs you). Warning colours are part of the tile's documented fixed forest exemption in `portal-home.css`; keep 4.5:1 on the forest.
   - Keep: hand-off rows, "Review", "See all invoices", no "Move it", no inline Approve, the forest quiet state.
   - Update `waiting-on-you-empty.test.tsx` only if a class name moves; add `waiting-on-you-states.test.tsx` for the forest error, the act-as note, the reason title and the partial line.
8. Recent requests: add `requestNumber: number | null` to `ReqRow`; sub "{requestRef(n)} · updated {when}" (`requestRef` from `lib/blockers.ts`; drop the ref when null), status only on the chip. Empty: `CardState` empty "Nothing here yet." / "The first thing you send shows up here, with the same words we use." with no button (the masthead holds the page's one New request).
9. Next call card: day and time as the figure ("Thursday 10:00"), date and length muted, the title, the attendee (avatar or initials plus `withName`), then a full width "Join the call" link button only when `meetingUrl` exists (new tab, `rel="noopener noreferrer"`, at least 2.75rem on a coarse pointer and under 46rem; under `ro` render it without an href and `aria-disabled`), otherwise "The meeting link shows here once your lead sets it up."; keep "Need a different time? Reply to your confirmation email and we will move it.". Empty: `CardState` empty "No calls booked." / "Your lead sets the next one, or email us any time and we will find a slot.". Remove the inline `height: 30` style.
10. Files and team: unchanged apart from the files empty moving to `CardState` "No files yet." / "Anything we share with you lands here.".
11. Tablet regime (`portal-home.css`, inside `@layer components`):
    - `@media (min-width: 48rem) { @container (max-width: 66rem) { ... } }`: `.ov-client .ov-grid` becomes `repeat(2, minmax(0, 1fr))`; `.ov-client .ov-grid > [class*="ov-col-"]` gets `grid-column: auto`; `.ov-client .ov-grid > .ov-col-12` and `> :only-child` get `grid-column: 1 / -1` (the live 46rem rule sets `span 12`, which would create implicit columns on a two column grid). Gap 0.75rem and card padding 0.875rem 0.9375rem 1rem under 46rem.
    - Inside the same media query, `@container (max-width: 34rem)`: narrow rows for `.ov-client .ov-card .ov-row` (title line on its own, the right value and chevron on the line under it, a grid rather than a wrap so every row breaks at the same place), `.ov-subrow` wraps with its value left aligned, invoice amount and Pay on the second line.
    - Never add `container-type` to `.ov-card` (see section 4).
    - Measure at 768 with the rail expanded (container about 28rem) and collapsed (about 39rem): two columns, nothing clipped, no horizontal scroll.
12. QA (Definition of Done in CLAUDE.md, commit body says "ported, unchecked"): on the dummy client only (never a real client, no emails), at 1440, 1024, 768 (rail expanded and collapsed) and 375, light and dark: a retainer with 1, 2 and 3 tracks (a custom tracks setting on the dummy org), a queue shared by two lanes shows once, reorder persists after reload, a project client dated and undated, a Xero rail plan, a brand new org with no subscription (setup panels), View as client (every write dimmed, lens note), Act as client (work live, Pay disabled with its reason, act-as note), and each card error by blocking its `/api/portal/*` route in DevTools (tile partial line for invoices or calls, "Unknown" vitals, no "All quiet" or "No invoices yet." on a failed read). 44px on every button at 375 and on a coarse pointer. No hex added outside the forest tile exemption.

Do not build: the notice, the sheets or their doors, the first-run redesign, the quick input, inline Approve, "Move it", the requests `Band`, the design's light quiet tile or its palette, any change to member seat billing.

### Slice C brief: project-dates-api

Route: `app/api/portal/project/route.ts` (GET). Additive fields only, nothing renamed or removed, no migration.

1. Per phase `startISO: string | null` and `endISO: string | null`: when the schedule has an effective date and the phase has a week span, `startISO` = effective date plus (spanStart minus 1) weeks, `endISO` = effective date plus spanEnd weeks minus one day, as ISO strings. Otherwise both null. Compute from the same rows the phases come from (snapshot first, live fallback), so the card and the share link never disagree.
2. Top level `pinned: boolean` (true when a parsable published snapshot with rows was used) and `pinnedAt: string | null` (`projectSchedules.publishedAt` when pinned; add it to the existing select). A shared but never published schedule answers `pinned: false`.
3. Tests in `app/api/__tests__/portal-project-published-schedule.test.ts`: dates only with an effective date; spans map to the right ISO dates; pinned true with a snapshot and false without; the existing tenancy, draft exclusion and snapshot precedence cases stay green.
4. Check `workers/mcp-server/src/index.ts` for a tool that proxies this route; if one exists, pass the new fields through (MCP parity, rule 14). No new capability, so no new tool.
5. `npm run type-check`, `npm run lint`, `npm run test`, `npm run build`. Verify on the deployed URL with the dummy project client that the JSON carries the fields and the slice A ProjectBoard shows date ranges and the pinned line.

Do not build: any change to how phases are derived, the published snapshot format, the public schedule viewer, or the share and publish routes.

## 9. Risks

- 768 with the 240px rail leaves each paired card about 13.6rem wide. The narrow row rules are mandatory; if they cannot hold a card, stop and report rather than dropping back to one column silently.
- Putting `container-type` on `.ov-card` would retarget every unnamed container query inside cards. Key the narrow rules off the page container.
- Build order: overview slice A, then slice A here, then slice B. Slice B does not compile without slice A.
- The unified queue reorders through one real track id and writes `queueOrder` across both sizes. The route allows it; confirm on the dummy client that order survives a reload and that a synthetic-only org shows no reorder.
- Overview slice A changes `.ov-cta`, `.ov-row`, chips and focus rings that this page uses. Take before and after screenshots of the client home in slice B.
- `overview.css` keeps the client-only board rules (`.ov-lane*`, `.ln-*`, `.ov-phase*`) after slice B. They become dead CSS; remove them in a later pass by whoever next owns `overview.css`, not here.
- `portal-home.css` is shared with the request detail's studio team card (requests module). Scope all new rules.
- Card error and multi-lane states cannot be produced with live data on demand; use the dummy client and DevTools request blocking. Never test on a real client, never flip client emails.
- Copy must stay pronoun free and never name Liam, although the design does.
- `/api/portal/project` returns the next owed invoice date to every seat, including a member; unchanged here (the member seat never renders the Project card), but worth a look in a later security pass.

## 10. Shared files other modules also touch

- `app/(dashboard)/overview/overview.css` (owned by the overview port; not edited here)
- `components/tahi/overview/ov-kit.tsx` (owned by the overview port; imported here)
- `components/tahi/overview/overview-home.tsx` (overview port; the audience switcher that renders this page)
- `components/tahi/portal/home/portal-home.css` (edited here; also imported by `components/tahi/portal/portal-studio-team-card.tsx`, requests module)
- `app/(dashboard)/requests/request-list.tsx` (the `?new=1` door; not edited)
- `app/globals.css` and `components/tahi/app-sidebar.tsx` (the tablet rail width; Liam's question 1; not edited)
- `components/tahi/empty-state.tsx`, `lib/client-home-signals.ts`, `lib/portal-status.ts`, `lib/blockers.ts` (read and imported only)
- `app/api/portal/project/route.ts` (edited in slice C; also feeds the client-tracks-schedule group)
