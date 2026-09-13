# Design requirements: studio-calculator-analytics

Routes: `/calculator`, `/sales-analytics`, `/affiliates`
Group audience: studio (Tahi team only)
Prepared 2026-09-13 for the Claude Design pass. Source: CLAUDE.md, STATUS.md, `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md, and the live code under `app/(dashboard)/calculator`, `app/(dashboard)/sales-analytics`, `app/(dashboard)/affiliates`, `lib/calculator`, `app/api/admin/calculator`, `app/api/admin/integrations/rewardful`, `app/api/admin/cron/affiliate-reactivation`, `lib/feature-tree.ts`, `lib/permissions.ts`, `components/tahi/nav-model.tsx`. No design file exists for any of the three routes in the Claude Design project (confirmed against the checklist's "Not designed yet" list and the catalogue).

---

## 1. Purpose and audiences

Three unrelated studio-only utility pages, grouped here only because none has a design file yet and none is client-facing.

- **`/calculator`** - an internal pricing and scoping engine. Liam (or a hire later granted the permission) builds a quote: pick project shape, size scope by discipline, set a timeline, add a retainer, pick a client complexity multiplier, and get back a recommended quote target with a floor and stretch range, a cost/margin breakdown, a capacity check against the team's booked hours, a benchmark against comparable closed deals, and (for project+retainer shapes) 12-month LTV pacing. From a saved calculation it can draft a proposal, schedule or contract pre-filled with the numbers.
- **`/sales-analytics`** - a read-only reporting page over the deal pipeline: a funnel of open deals by stage, a donut of pipeline value by stage, and a stacked bar of closed-won value by month per owner, plus two KPI hero tiles and a three-cell KPI strip (won all-time, pipeline value, close rate).
- **`/affiliates`** - a thin mirror of a Rewardful affiliate-marketing integration: a list of affiliates with visitor/lead/conversion/commission counts, filterable by state, with connect/disconnect and a manual refresh.

Who opens each: Tahi team members with the matching permission grant (`calculator`, `sales_analytics`, `affiliates`). Today that is functionally only Liam; Staci and any future hire are gated by the same `feature_visibility` / `teamMemberAccess` machinery as every other studio page. All three are top-level, flat `FEATURE_TREE` nodes with `appliesTo: ['team']` only - there is no client variant, no sub-tab, and no child feature key under any of them.

What it must never show:
- **Never reachable by a client, ever, not even in preview.** All three `page.tsx` files check `isAdmin && !isPreviewingClient` and redirect (`/requests` for calculator and sales-analytics, `/overview` for affiliates) - a studio admin who has flipped into Client view via the `tahi-impersonate-org` cookie is bounced the same way a real client would be, so a preview session can never leak one client's pricing or pipeline data into a "what does the client see" check.
- **Deny by default per team member.** All three call `requirePageFeature(key)` and their permission keys resolve through `FEATURE_RESOURCE` (`lib/permissions.ts`) to seeded baseline resources, so a roleless Tahi-org identity is denied, not admitted. This is current and correct in the code today - note that both the catalogue (2026-09-13) and a TASKS.md line still describe `/affiliates` as having "no FEATURE_RESOURCE tree node at all" (T1.18); that is stale, the node and the resource mapping both exist now (`lib/feature-tree.ts` line ~84, `lib/permissions.ts` line ~71) and `filterNav` does honour `adminOnly` (`components/tahi/nav-model.tsx` line ~194). Treat the code as ground truth; do not re-open T1.18 for this group.
- **The Messages-hidden rule does not apply here.** None of the three pages touches conversations or the Messages feature key; there is nothing to check.
- **No super-admin-only area inside any of the three.** Whoever holds the feature grant sees the whole page; there is no further split by role inside `/calculator`, `/sales-analytics` or `/affiliates`.
- **Money and pipeline data must stay studio-private.** `/calculator`'s cost and margin math and `/sales-analytics`'s deal values are exactly the kind of number CLAUDE.md's audience split says clients never see; both pages already sit behind the admin-only, non-preview gate above, so this is enforced at the page level, not just by absence from client nav.

---

## 2. Pages, sub pages and entry points

### `/calculator`
- **Entry point:** sidebar "Sales > Calculator" (`adminOnly` nav item). No other UI links here today - see section 4 for the dead `dealId`/`orgId` wiring.
- **URL state:** `?dealId=<id>` or `?orgId=<id>` optionally anchor the calculation to a deal or an org (mutually exclusive; `dealId` wins if both are present) and switch the "Back to..." link and the prior-calcs history panel between "this deal" and "this org." With neither param the page opens a fresh, unanchored calculation.
- **Single page, no sub-routes.** The whole surface is one two-column layout: a left form (`Project shape`, `Scope`, `Timeline`, `Retainer` - hidden when project shape is `One-off`, `Client + complexity`, `Notes`) and a right sticky output rail (`Recommendation` hero tile, `Recommendation` detail card, `Draft from this calc` card once a save exists, `Cost breakdown` with a donut chart, `Capacity`, `Benchmark vs similar deals` when comparable data exists, `Project + retainer pacing` when the shape supports it).
- **Prior calculations panel** - appears in the right rail only when more than one saved calculation exists for the current deal/org; each row is a plain button that loads that calculation's inputs/outputs into the form (no dialog, no navigation).
- **Draft actions** - three buttons ("Draft proposal", "Draft schedule", "Draft contract") inside the `Draft from this calc` card, visible once the current calculation has a `savedId`. Each POSTs to `/api/admin/calculator/draft` and hard-navigates to the created artefact's editor (`/proposals/[id]`, `/schedules/[id]` or `/contracts/[id]`).
- **No dialogs, no slide-overs, no board or list view.** This is the one route in this group with genuinely no list markers to design against, matching the catalogue's "no list markers expected."

### `/sales-analytics`
- **Entry point:** sidebar "Sales > Sales analytics" (`adminOnly` nav item). No query-string state, no anchors, no sub-routes.
- **Single scrolling page**, in order: `PageHeader` (title + subtitle), a two-tile `FeatureCard` hero strip (`Pipeline snapshot`, `Next to close`), a three-cell grouped KPI card (`Won (all time)`, `Pipeline value`, `Close rate`), a two-up chart row (`Deal stage funnel`, `Pipeline value by stage` donut), a `Closed-won by month, by owner` stacked bar, and a closing "Coming in Phase 8" callout card with three link tiles to `/proposals`, `/schedules`, `/contracts`.
- **No dialogs, no drill-down.** Nothing on the page is clickable except the three roadmap link tiles; a bar, funnel segment or donut wedge does not open anything. That is a real gap against the "every list view" pattern the rest of the app follows - see section 4.

### `/affiliates`
- **Entry point:** sidebar "Sales > Affiliates" (`adminOnly` nav item). No query-string state, no sub-routes.
- **Single page:** header with title + "Rewardful affiliate tracking and commission management" subtitle (plus a "Last synced" timestamp when one exists) and a "Refresh" button; when not connected, a single `EmptyState` card ("Connect Rewardful") with a CTA linking to `/settings`; when connected, three `StatTile` cards (Affiliates, Referrals, Commissions), a search input, a `FilterBar` with a single "State" multiselect (active/pending/disabled), and a `DataTable` (Affiliate, State, Visitors, Leads, Conversions, Commissions).
- **The connect flow itself lives on `/settings`, not here.** The "Go to settings" CTA is the only entry point into actually connecting Rewardful (via `POST /api/admin/integrations/rewardful` with an API key); this page is read-only once connected.
- **No dialogs, no row click-through, no drill into a single affiliate.** A row in the table today does nothing on click - there is no per-affiliate detail view, referral list or commission ledger, which matches the catalogue's "the data underneath is a stub, N6 is the real phase."

---

## 3. States and variants

- `/calculator` loading: no skeleton at all. The form renders instantly with `DEFAULT_INPUTS`; the right rail shows a plain "Computing…" text line inside the `Recommendation` card until the first `POST /api/admin/calculator` resolves (debounced 400ms after any input change, not on blur despite the code comment - see section 4).
- `/calculator` empty: not applicable in the usual list sense - there is always a form with defaults. The nearest empty state is "no prior calculations," which is handled by simply not rendering the `Prior calcs` panel (no empty-state copy, it just disappears).
- `/calculator` error: `runCompute` catches a failed fetch or a non-OK response and shows a toast, "Calculation failed"; the rest of the page (last-good outputs) stays on screen unchanged. Drafting a proposal/schedule/contract fails silently - a non-OK response from `/api/admin/calculator/draft` just returns with no toast and no visible error.
- `/calculator` read-only client view: not applicable, clients never reach this route (section 1).
- `/calculator` member vs admin seat: identical once the `calculator` grant is held; no role-conditional UI inside the page.
- `/calculator` 375px: the grid falls back to a single column below 1024px (`calculator-grid` media query), so the form and the sticky rail stack; the scope row's `8rem 1fr` / `5rem auto 1fr` nested grids and the two- and three-column `Field` rows (timeline, retainer, client + complexity) have not been checked at 375px and are a real risk of clipping or wrapped labels - flag for the design pass.
- `/calculator` 768px: still inside the single `@media (max-width: 1024px)` breakpoint, so the layout is identical to 375px (one column, form above the sticky rail) - not a distinct tablet state, but not independently verified live either.
- `/calculator` dark mode: uses CSS var tokens throughout except the capacity-warning dot/text colour (`#dc2626` / `#9a3412` / `#15803d`, hardcoded hex, not `--color-danger` / `--color-warning` / `--color-success`) and two `#fff` literals on active pill buttons - the hardcoded set will not shift with `.dark` and needs tokenising.
- `/sales-analytics` loading: per-section `animate-pulse` skeleton blocks (funnel, donut, bar chart) while `dealsLoading || stagesLoading`; the two hero `FeatureCard` tiles and the KPI strip show the literal string "Loading..." / "-" rather than a skeleton.
- `/sales-analytics` empty (no deals at all): funnel shows `EmptyState` "No open deals yet" / "Once you add deals to the pipeline the funnel will populate here."; donut shows `EmptyState` "No pipeline value to chart" / "Deals need a value set for this breakdown to appear."; bar chart shows `EmptyState` "No closed-won deals in the last 6 months" / "Once deals close they will show up here, grouped by who owned them."; hero tiles fall back to "No open deals right now..." and "Nothing on the horizon."
- `/sales-analytics` error: none rendered - a failed `useSWR` fetch on either `deals` or `pipeline/stages` leaves the arrays empty and the page silently renders the "no data" empty states, indistinguishable from an honestly-empty pipeline.
- `/sales-analytics` read-only client view: not applicable, clients never reach this route.
- `/sales-analytics` member vs admin seat: identical once the `sales_analytics` grant is held. Note the underlying `/api/admin/deals` and `/api/admin/pipeline/stages` calls are gated on the `deals` feature key, not `sales_analytics` - a member who somehow holds `sales_analytics` without `deals` would load a page that 403s on both its data sources.
- `/sales-analytics` 375px: Tailwind responsive classes (`grid-cols-1 md:grid-cols-2`, `sm:grid-cols-3`) collapse the hero tiles and KPI strip to one column; the KPI strip's `borderLeft` divider (see section 6) disappears cleanly at that width since there is nothing to the left of it, but has not been checked live.
- `/sales-analytics` 768px: sits exactly on the `md:` breakpoint, so the two hero `FeatureCard` tiles are already two-up and the KPI strip (`sm:grid-cols-3`, breakpoint 640px) is already three-up at this width - the `borderLeft` divider (section 6) is visible here, unlike at 375px, and has not been checked live.
- `/sales-analytics` dark mode: fully token-based, no hardcoded hex found in the file.
- `/affiliates` loading: `DataTable`'s built-in loading skeleton (`loading={loading}` from SWR); the three `StatTile` cards show an em dash placeholder " - " for the value while loading (note: this literal character in the source is an em dash, which CLAUDE.md forbids everywhere including in JSX text - flag for a follow-up fix, out of scope for a design-only pass but worth naming).
- `/affiliates` empty (not connected): the `Connect Rewardful` `EmptyState` card replaces the entire body below the header - no stat tiles, no table, no filter row are rendered at all in this state.
- `/affiliates` empty (connected, zero affiliates): `DataTable` empty state, "No affiliates yet" / "Affiliate data will appear here once synced from Rewardful." - this is also the *only* state the page can ever show today, because the API always returns empty arrays (section 4).
- `/affiliates` empty (connected, filtered to nothing): `DataTable` empty state, "No matches" / "Try clearing a filter or adjusting your search."
- `/affiliates` error: none rendered - a failed `useSWR` fetch leaves `data` undefined, `loading` false, and the page renders as "not connected" regardless of actual connection state, which is a misleading fallback.
- `/affiliates` read-only client view: not applicable, clients never reach this route.
- `/affiliates` member vs admin seat: identical once the `affiliates` grant is held.
- `/affiliates` 375px: the header row wraps (`flexWrap: 'wrap'`), the stat-tile grid uses `repeat(auto-fit, minmax(13rem, 1fr))` which will stack to one column under ~416px, and `DataTable` is the same primitive used everywhere else in the app for horizontal-scroll-at-narrow-width - not independently verified live for this page.
- `/affiliates` 768px: the `repeat(auto-fit, minmax(13rem, 1fr))` stat-tile grid fits two to three tiles per row at this width rather than stacking, and the header row no longer needs to wrap - not independently verified live for this page.
- `/affiliates` dark mode: one hardcoded `color: '#ffffff'` on the "Go to settings" CTA (acceptable as literal white-on-brand-fill, but the CTA is a raw styled `<a>` rather than the `TahiButton` primitive already imported and used for "Refresh" two elements away - an inconsistency the design pass should resolve, not a dark-mode contrast bug on its own).
- Print or public: not applicable to any of the three; none has a public or print variant.

---

## 4. Features and actions

### `/calculator`

**Works today:**
- Full pricing model: scope by discipline (Webflow, Engineering, Design, Strategy) with per-line hours, delivery mode (ourselves/contractor) and contractor rate; timeline with two-way start-date/duration/launch-date sync; retainer plan and duration; client currency, complexity multiplier and returning-client discount.
- Server-side compute (`lib/calculator/compute.ts` via `POST /api/admin/calculator`) pulling live context: booked hours from active schedules for the capacity check, comparable closed deals for the benchmark.
- Debounced auto-save-and-recompute on every input change (POST persists inputs + outputs together, no separate save step).
- Rename on blur of the title field (`PATCH /api/admin/calculator`).
- History: prior calculations for the same deal or org, loadable back into the form.
- Draft-from-calc: creates a pre-filled proposal, schedule or contract from a saved calculation and links it back via `linkedArtefactRef`.
- Currency-aware formatting throughout (`Intl.NumberFormat`, keyed to the calculation's own currency, not the studio's display currency).

**Exists but wrong or half built:**
- `dealId`/`orgId` deep-link plumbing exists in the page and content component but nothing in the app links to `/calculator?dealId=...` from anywhere - not `/deals/[id]`, not the deal detail cockpit. The only live entry point is the bare sidebar link, so the anchor-to-a-deal feature is currently unreachable in practice.
- The code comment says "recomputes whenever the form blurs"; the actual trigger is a 400ms debounce on every keystroke/change to `inputs`, not blur. Cosmetic doc drift, but worth deciding which behaviour the design should imply (a "computing" affordance on every keystroke vs. only on blur).
- Draft failures are silent (no toast) unlike compute failures (toast shown) - an inconsistent error-handling pattern within the same file.
- Capacity-warning colours and two active-state whites are hardcoded hex, not tokens (section 3).
- The route's own `export const metadata` title is `'Project calculator — Tahi Dashboard'`, a literal em dash, and a second em dash sits in a code comment at `calculator-content.tsx` line ~541 ("Hero tile — the proposed quote target") - both are CLAUDE.md rule 6 violations the design pass should not carry forward into any copy it touches (distinct from the `/affiliates` em-dash placeholder already named in section 3, which is at least user-visible and flagged; these two are in code the design pass may not otherwise look at).
- T700-705 (`Revenue features`, per TASKS.md "Post-launch backlog"): deal-to-invoice generation, pipeline invoice indicators and a Xero payment webhook receiver are grouped with "project calculator port" under one heading, but the calculator itself is already substantially built (this is not a stub awaiting a port from elsewhere) - the catalogue's "T700-705 project calculator port" line most likely means finishing the *other* three items in that group, not rebuilding this page. Treat the calculator's own functionality as done; the design task here is genuinely design-and-polish-only, as the catalogue says.

**Planned or missing:**
- No named feature backlog item asks for anything beyond the polish/design pass noted above. (proposal) A "Draft from deal" entry point on `/deals/[id]` that opens `/calculator?dealId=<id>` would close the dead-link gap above, but nothing in TASKS.md or the catalogue requests it by name - mark any such addition "proposal" if it is designed.

### `/sales-analytics`

**Works today:**
- Live funnel of open deal counts by stage, ordered by stage position, excluding closed-won/closed-lost/stalled.
- Live donut of open pipeline value by stage.
- Live stacked bar of closed-won value by month (last 6 months) grouped by deal owner.
- Hero KPI tiles (pipeline snapshot, next deal to close) and a three-cell KPI strip (won all-time, pipeline value, close rate).
- All values respect the studio's display-currency setting via `useDisplayCurrency`.

**Exists but wrong or half built:**
- CT.19 (catalogue, TASKS.md line 173, 4d): `/reports` currently carries six sections that duplicate this page's subject matter and go considerably further - Sales Pipeline, Sales Funnel, Source Breakdown, Stage Velocity, Close-Rate-by-Source, and Sales Cycle Length (all backed by `/api/admin/reports/sales` and visible in `app/(dashboard)/reports/reports-content.tsx`). CT.19 is a triage-by-deletion: those six sections come out of `/reports` and their functionality (close rate by source, stage velocity, sales cycle length, source ROI) should land here instead, since `/sales-analytics` is the intended home for pipeline-shape reporting and `/reports` is not. This page's current three-chart version is a strict subset of what already exists elsewhere in the app; the design pass should plan for the richer version, not just polish the thin one.
- No access-scoping helper is called on the `deals`/`pipeline/stages` reads this page depends on (`lib/access-scoping.ts` is never imported by `app/api/admin/deals/route.ts`), so a team member scoped to specific clients via `teamMemberAccess` still sees studio-wide pipeline value and every deal once they hold the `deals` and `sales_analytics` feature grants - same class of leak the catalogue calls out for `/reports`.
- The roadmap callout's own list (close rate by source, proposal-to-sign time, top-performing proposals, variant heatmap, open questions across live proposals) is explicitly "Coming in Phase 8" - honest framing already in the code, not a design bug, but the design pass should decide whether to keep this callout as literal roadmap copy or replace it once CT.19 lands some of these.
- T707-715 (Intelligence & analytics, TASKS.md "Post-launch backlog"): pipeline quality scoring, revenue-per-head, client LTV, BankRunwayCard statement rows and outstanding-KPI dedup are grouped functionality items that touch both `/financial-reports` and this page; only the pipeline-quality piece is `/sales-analytics`'s own.

**Planned or missing:**
- Pipeline quality scoring (T707-715) has no UI anywhere yet.
- No drill-down from any chart to the underlying deal list (click a funnel stage or donut wedge to filter `/deals`) - not asked for by name in the backlog, so mark any such addition "proposal" if designed.

### `/affiliates`

**Works today:**
- Connect/disconnect flow via `/settings` writing to the `integrations` table (service `rewardful`), reflected here as a connected/not-connected empty state.
- Manual "Refresh" button (`mutate()` on the SWR key) and a `lastSyncedAt` display.
- Full list UI primitives: search, a state `FilterBar`, a sortable `DataTable` with six columns, three summary stat tiles - genuinely v3-composed and ready to receive real data.

**Exists but wrong or half built:**
- `GET /api/admin/integrations/rewardful` always returns `affiliates: [], referrals: [], commissions: []` regardless of connection state or of whether `REWARDFUL_API_KEY` is set - the table, filters and stat tiles have no real data path today no matter what a user does on the page. This is a stub, not a bug in the UI; the UI is honest about rendering "no data" correctly given what the API returns, but the *page* is not honest about being live (the header copy "Rewardful affiliate tracking and commission management" reads as a working integration).
- `POST /api/admin/integrations/rewardful/sync` is also a stub - it returns a canned success message ("would refresh affiliate data in production") without calling Rewardful at all, even when an API key is present. There is no UI on `/affiliates` that calls this sync route at all today; the page's own "Refresh" button just re-fetches the same always-empty GET.
- The affiliate-reactivation cron (`app/api/admin/cron/affiliate-reactivation`) already runs against real data, but a different real data source: `leads.affiliateCode`, not a Rewardful affiliates table. This cron's output (stale-affiliate notifications) has no visible surface on `/affiliates` at all - a studio member has no way to see which affiliate codes are flagged stale except through the notification bell.
- T1.18's "no FEATURE_TREE node" security claim is stale per section 1; do not re-flag it.
- A second, code-comment-only em dash sits at `affiliates-content.tsx` line ~319 ("leading icon — the FilterBar gives us search natively"), separate from the em-dash stat-tile placeholder already named in section 3.

**Planned or missing:**
- N6 (memory `project_phase_roadmap.md`, TASKS.md "North-star phases," explicitly parked "until Batch J lands" per the catalogue): the real affiliates build - presumably wiring the genuine Rewardful API (or the `leads.affiliateCode` data the cron already aggregates) into this page. No detailed spec exists yet for what "real" looks like here (per-affiliate detail view, payout history, a link between an affiliate code and the leads/deals it produced) - anything proposed at that level of detail should be marked "proposal."
- No settings-page cross-link back from `/affiliates` when disconnected other than the one CTA already present (that part is fine); no in-page way to set/rotate the Rewardful API key without leaving the page.

---

## 5. Data and integrations

- **`/calculator`**
 - `GET/POST/PATCH /api/admin/calculator` - list, compute-and-save, rename. Reads `schema.projectCalculations`; the POST also reads `schema.scheduleRows` (booked-hours capacity check) and `schema.deals`/closed-deal history (benchmark) via `lib/calculator/compute.ts`.
 - `POST /api/admin/calculator/draft` - reads a saved `projectCalculations` row plus `schema.deals` (for a title), then creates a row in `schema.proposals`, `schema.schedules` or `schema.contracts` (contract table TBD per whichever is live) and returns its editor URL.
 - No third-party integration. All numbers are internally computed; nothing here is faked - the whole surface is honest about being a calculator, not a live financial system.
- **`/sales-analytics`**
 - `GET /api/admin/deals?limit=100` and `GET /api/admin/pipeline/stages` - both gated on the `deals` feature key (not `sales_analytics`), both unscoped by `teamMemberAccess` (section 4).
 - No third-party integration; all values are real D1 data, no fake numbers found in this file.
- **`/affiliates`**
 - `GET/POST /api/admin/integrations/rewardful` - reads/writes `schema.integrations` (service `rewardful`); GET is the permanent-stub data source described in section 4.
 - `POST /api/admin/integrations/rewardful/sync` - stub, gated on `settings.integrations`, reads `REWARDFUL_API_KEY` from env but never calls out to Rewardful.
 - `POST /api/admin/cron/affiliate-reactivation` - real data (`schema.leads`, grouped by `affiliateCode`), real notification writes; not called from this page.
 - Third party named in CLAUDE.md's Integration Reference table: none - Rewardful is not one of the listed integrations (Stripe, Xero, Mailerlite, HubSpot, Slack, Loom, Zapier), so this integration exists in code without a corresponding CLAUDE.md environment-variable entry beyond the ad hoc `REWARDFUL_API_KEY` read in the sync stub.
 - **Must stay honest:** the page must not claim synced/live data it does not have. Today it is honest by omission (empty states) but the header subtitle and "Refresh" button imply a working sync that does not exist - a design pass that keeps the current copy without also fixing the stub would make the page *more* convincingly wrong, not less; flag this for whoever picks up N6, and consider whether the design should visibly mark the page as "not yet syncing real data" in the interim.

---

## 6. Design system contract

- **PageHeader**: only `/sales-analytics` uses it today. `/calculator` and `/affiliates` both hand-roll an `<h1>` + subtitle block with inline styles instead - the design pass should decide whether all three adopt `PageHeader` for consistency (it is the documented pattern the rest of the app uses for a page's title band) or whether `/calculator`'s custom header (title-as-editable-input, icon, save-status pill) is different enough in kind to justify staying bespoke. Recommend: `/affiliates` moves to `PageHeader` (it is a plain list page, no reason to diverge); `/calculator`'s editable-title header is a genuine exception, keep it bespoke but bring its typography and spacing into line with the token set `PageHeader` uses.
- **Left rail / toolbar**: not applicable to any of the three. None of these pages needs the Requests/Tasks-style saved-views rail - `/calculator` has no list at all, `/sales-analytics` has no filterable list, and `/affiliates`'s existing `Input` + `FilterBar` combination is the right lighter-weight pattern for a single-filter list and should not be upgraded to the full rail toolbar.
- **DataTable**: `/affiliates` already uses it correctly (sortable columns, `getRowId`, `defaultSort`, `loading`, `empty`) - this is the one piece of this group already built to the v3 standard structurally, it is only the data underneath that is fake.
- **SlideOver**: not used by any of the three, and none of the planned functionality (per section 4) obviously needs one - `/calculator`'s draft actions navigate away rather than opening a panel, which is consistent with how proposal/schedule/contract creation works elsewhere.
- **Leaf radius**: `/calculator` already uses `--radius-leaf-sm` (`0 10px 0 10px`) correctly on its icon badge and on the emphasised `Recommendation` card border; `/affiliates`'s stat-tile icon wrapper also uses `--radius-leaf-sm` correctly. Keep this usage, it matches CLAUDE.md's "icon backgrounds... feature callouts" guidance exactly.
- **Tokens**: `/sales-analytics` is fully token-based already. `/calculator` and `/affiliates` each carry a small number of hardcoded hex values (section 3) that must become token references (`--color-danger`, `--color-warning`, `--color-success` for the calculator's capacity states) before this can ship.
- **No side borders**: `/sales-analytics`'s `KPICell` uses `borderLeft` as a divider between the three grouped KPI cells (`bordered` prop) - this is a direct violation of CLAUDE.md's "No side borders... never border a single side; all-sides or absent, reads as tacky otherwise" rule. The design pass must replace this with either a full-card border per cell, a background-colour split, or a different divider treatment (a thin centred rule, generous gap, or a card-per-cell layout) - not a single left border.
- **What the existing design file gets right:** nothing to credit - there is no design file for any of these three routes, so there is no existing critic verdict (SHIP/FIX/REDO) to carry forward. This is a from-scratch design pass, same footing as `/clients/brands/[id]` and `/clients/contacts/[id]` elsewhere in the catalogue.
- **What the design must change from the current live code**, ranked by how disruptive fixing it would be to the eventual design:
 1. `/sales-analytics`'s KPI-cell side border (structural, affects the KPI strip's whole visual language).
 2. `/calculator`'s hardcoded capacity colours and inconsistent header pattern (token + component swap, low structural risk).
 3. `/affiliates`'s raw-`<a>`-as-button CTA instead of `TahiButton` (component swap only).
 4. Whether `/sales-analytics` should be designed against its current three-chart scope or the CT.19-enlarged scope (six additional sections migrating in from `/reports`) - this is a scoping decision for whoever runs the design pass, not a code fix, and belongs in section 7 below.

---

## 7. Open questions for Liam

1. Should the Claude Design pass for `/sales-analytics` design against the page as it exists today (three charts, one KPI strip), or against the CT.19-enlarged scope (funnel, donut, monthly bar, plus source breakdown, stage velocity, close-rate-by-source and sales-cycle-length migrating in from `/reports`)? Designing the small version now risks a second design pass once CT.19 lands; designing the large version now means committing to CT.19's page-deletion plan before it has shipped. (A: small scope now / B: large CT.19 scope now)
2. Should `/calculator` gain a "Calculate for this deal" entry point on `/deals/[id]` as part of this design pass (closing the dead `dealId` link), or is the calculator meant to stay a standalone sidebar tool with no deal cross-link for now? (yes, add the entry point / no, leave it standalone)
3. For `/affiliates`, should the design pass proceed on the current Rewardful-integration shape (connect/disconnect, per-affiliate rows, commission totals) even though N6 has not scoped what "real" data looks like, or should the design wait for N6 to define the actual data model first, on the risk that a Rewardful-shaped design gets thrown away if N6 decides to build off `leads.affiliateCode` instead of a real Rewardful sync? (A: design the Rewardful shape now / B: wait for N6 scoping)
4. Is Rewardful still the intended affiliate platform at all? It is not listed among the six named integrations in CLAUDE.md's Integration Reference table, and the only other affiliate data path already live in the codebase (the reactivation cron) uses `leads.affiliateCode`, not Rewardful. (A: yes, keep building on Rewardful / B: no, affiliate tracking should be built on the existing lead/deal data instead)

---

## 8. Acceptance for the design review

- At 1440px, `/calculator`'s two-column layout (form left, sticky output rail right) is legible with the rail's cards (`Recommendation`, `Draft from this calc`, `Cost breakdown`, `Capacity`, `Benchmark`, `Pacing`) each readable without truncation, and the hero "Quote target" figure never wraps mid-number.
- At 375px, `/calculator` stacks to one column with the scope-line nested grids (hours / delivery toggle / contractor rate) either reflowing to their own rows or staying legible without horizontal scroll or clipped labels, and every tap target (delivery toggle, project-shape pills, draft-action buttons) is at least 44px tall.
- `/calculator` in dark mode shows the capacity-warning dot and label in a colour that visibly shifts with the theme (not the current hardcoded hex), with no contrast regression against the dark card background.
- `/sales-analytics`'s three-cell KPI strip at 1440px uses no single-side border as a divider between cells (CLAUDE.md rule); confirm the reviewer can point to the actual divider treatment used instead.
- `/sales-analytics`'s funnel, donut and bar chart each render a clearly distinct, correctly-labelled empty state at 1440px and 375px when given zero data, matching the three empty-state copy strings named in section 3, not a generic blank card.
- `/sales-analytics` in dark mode: chart colours (funnel bars, donut segments, stacked bar series) remain distinguishable from each other and from the card background; the two `FeatureCard` hero tiles (`forest` and `lime` variants) keep sufficient text contrast.
- `/affiliates`'s "Connect Rewardful" empty state and its "no affiliates yet" empty state are visually distinct from each other at both 1440px and 375px (different icon/copy, not just different button), so a reviewer can tell from a screenshot alone which state is shown.
- `/affiliates`'s "Go to settings" CTA reads as the same button component family as "Refresh" (both use `TahiButton` styling, not one custom link and one primitive) at 1440px and in dark mode.
- `/affiliates`'s `DataTable` at 375px scrolls horizontally without breaking the page layout (no page-level horizontal scroll), and the state `Badge` dot in the State column stays legible in dark mode.
- Across all three pages, no `PageHeader` vs. custom-header inconsistency survives unexplained: the reviewer should be able to see either a shared header treatment across `/sales-analytics` and `/affiliates`, or a documented, deliberate reason `/calculator`'s header differs (editable title, save-status pill).
