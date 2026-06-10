# Tahi Dashboard — Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-06-10** by Claude (granular permissions built + validated live; spine 0-5; requests v3 lift; portal fix; Private/Client view modes)

---

## Daily-trusted surfaces

Features the user actively runs their workday on. Regressions here are P0.

- **Sales pipeline** — deals, kanban, list, nudges, activity timeline, default owner. Closed_at now auto-set on stage moves so sales velocity is honest.
- **Financial reports (`/financial-reports`)** — Phase H finance overhaul shipped 2026-05-27/28. Cash hero (total cash + reserve donut + dual runway), Needs-attention card, MRR breakdown + concentration, Sales velocity + pipeline funnel + AR aging, Recurring outflows full CRUD with auto-detect cadence, Cost mix donut, Tax + reserve coverage, Take-home progress, Reserve target settings, Spend impact calculator. Currency switcher in nav respected page-wide.
- **Docs Hub** — shipped + locked 2026-05-23. Reference list-page pattern (FilterBar + DataTable + SlideOver). Notion-grade editor with bubble menu, slash commands, task lists, image, and a 56rem slide-over with clickable version history.
- **Proposals / contracts / schedules / calculator** — built and premium, but not yet in the user's daily routine (closest to crossing the line)
- **Settings → Cash reserves** — new CRUD section shipped 2026-05-27 for tax/buffer/deposits pots that feed the disposable-cash math.

## Built but not daily-trusted

Features that are coded and routed but haven't earned the user's trust as primary tools yet. Polish target.

- Tasks (three-level system, AI wizard — UX still rough)
- Requests (admin + portal — client privacy gaps, file upload / voice note bugs flagged in March QA)
- Messages / conversations
- Time tracking
- Settings (some toggles broken per March QA — needs re-verification)
- Reviews & case-study pipeline
- Announcements

## Stubs / not functional

- SSE notification stream (`/api/notifications/stream` is a stub — Phase 11 upgrades it)
- Web Push notifications (no service worker handler yet — Phase 11)
- Email-to-Request intake (not yet built — Phase 11)
- Xero payment webhook receiver (not yet built — Phase 11)

---

## Known live bugs (priority order)

Verified 2026-05-21 against current code. Pipeline polish backlog (5 items) all shipped — see `memory/project_pipeline_polish_2026_05.md`. March QA audit largely resolved — see `memory/project_qa_resolved_2026_05.md`.

1. ~~**P1 — Voice note playback is fake.**~~ **FIXED 2026-06-09 (commit 385e03f), pending live verification.** Root cause was deeper than a fake player: the conversations POST endpoint silently dropped the `voiceNote.storageKey`, so no `voice_notes` row was ever written and there was no audio URL to play. Fix persists the row on POST (admin + portal), joins it on GET to return `voiceNote.url` (=/api/uploads/serve), and renders the real `MessageBubble` `VoiceNoteInline` player. Legacy notes (no row) show "recording unavailable". Verify on the deployed URL, then flip this off the list.
2. **P2 — Needs live verification on production:**
   - R2 STORAGE binding (file upload end-to-end test on Webflow Cloud)
   - Settings page tabs (team / portal branding / modules — March audit said broken; code has no obvious stubs now)
   - Per-member docs access control (March feature request, status unknown)
3. **P3 — Stripe import**: duplicates `in_*` / `ch_*` rows for same payment (T665); pagination caps at 100 (T666)
4. **P3 — Bank balance card**: shows only cash balance; statement balance missing (T706)

---

## Current sprint (2026-05-21 → 2026-06-04)

1. ✅ Doc cleanup pass — STATUS.md, CLAUDE.md Definition of Done, roadmap memory rewrite, QA audit re-verification, pipeline polish memory archived
2. ✅ Pipeline polish backlog — all 5 items already shipped (verified 2026-05-21)
3. ✅ Design-system v3 primitives shipped — KanbanBoard, BoardView (Kanban/Table/Timeline tabs, infinite-scroll timeline), FilterBar multi-select, Avatar tooltip-by-default, Notion-grade TiptapDocEditor (bubble menu + slash commands + task lists + image)
4. ✅ Docs Hub shipped + locked 2026-05-23 — first list-page lapped through the new design system
5. ⏳ **NEXT: lead intake + discovery call workflow** — see "Next workflow" below
6. Live Chrome verification of pipeline polish items + voice note bug + R2 uploads (awaiting deployed URL)
7. Voice note player fix (P1 — swap fake player for `<audio>` element)
8. Phase 11 quick wins T660–T667 — 8 items
9. Schema migration S23–S25 (notificationPreferences + commentsLocked + xero_category_overrides + teamMembers.salaryAnnual). Note: `editedAt`/`deletedAt` on messages already exist.

## Next workflow

Lifecycle-order build is in progress. Docs Hub was the first list-page lap; the next surface to build is the **earliest stage of the sales lifecycle**: lead intake → discovery call → first deal. See "Discovery call" entry in `WORKFLOWS.md`. Pipeline (already daily-trusted) sits downstream of this and gets a design-system polish pass once the upstream lead/discovery flow lands.

Full plan: `C:\Users\Work\.claude\plans\i-d-like-you-to-gentle-neumann.md`

---

## Recent activity (2026-06-10, latest)

Granular permissions (the capstone) BUILT + validated live, plus the two settings-popup view modes.

- **Granular permissions** — built on #119 RBAC + new `feature_visibility` table (migration 0077, applied to prod) + `FEATURE_TREE` manifest. Resolver `lib/permissions.ts` (4 levels: super_admin un-lockable / admin all-but-deny-hides / team_member role-baseline / client audience-gated + per-org), 11 unit tests. Enforcement: layout -> PermissionsProvider, sidebar nav filter, `<Gate>` on cards, real page guards (financial-reports/team/billing redirect a denied team member). Builder UI at `/permissions` (Team/Clients/Roles tabs, per-feature allow/deny/inherit + reasons, role assignment) — admin+ only. API: /me, subjects, feature-visibility, assign-role. MCP parity (4 tools). **Validated live on prod**: override deny flips /me + inherit restores; role assignment persists; builder renders. Super-admin seed = migration `0078` (Liam + Staci), runs on the in-flight deploy; assign-role guard relaxed so managers can grant any role.
- **Private mode + Client view** (settings popup, super-admin only) — Private mode toggles `.tahi-private` (localStorage) and blurs `[data-private]` (hover reveals); validated live (blur 8px). Client view impersonates a real client via the existing impersonation banner. Operator identity tagged data-private as initial coverage; extend by tagging more PII/financial surfaces.
- Tracks-visualization scoping still open (#189).

## Recent activity (2026-06-10, later)

Portal-readiness arc pushed hard. Spine now complete (slices 0-5), requests lapped onto v3, portal leak closed; permissions design drafted for approval.

- **Portal split airtight** — `/api/portal/tracks` GET + reorder now filter `isInternal=false` (the one leak; internal requests no longer reach the client track view). Tasks stay 100% admin-gated. Requests=client / tasks=internal holds (Decisions #030/#046).
- **Spine Slice 4 (engagement health card)** — live + verified on prod. `/api/admin/engagements/delivery-status?dealId=|orgId=` rolls up across a deal/org's schedules; `EngagementHealthCard` on deal + client detail. Verified: Giant Group card showed "Delivery health · Delayed · 0/1 done · 1 off track · Discovery & sitemap".
- **Spine Slice 5 (overview off-track widget + notify)** — live + verified. `/api/admin/engagements/off-track` + `OffTrackEngagementsWidget` (verified showing Giant Group delayed). `delivery-watch` cron (absolute + 23h dedup, no new schema) -> `delivery_off_track` notifications; registered in CRONS. MCP parity on all of it.
- **Requests v3 lift (#129/#186)** — live + verified. PageHeader + FilterBar + DataTable (list, bulk preserved) + BoardView (kanban + timeline) + StatusChipSelect on detail. ~1270 lines of bespoke code removed; all business logic preserved (cross-client nest guard, un-nest-on-column-drop, optimistic status, custom kanban columns, AI wizard, impersonation gating). Verified live: list + board render, light + dark mode clean, mobile responsive (501px cards + bottom nav), no console errors.
- **Granular permissions** — DESIGN written (`SPECS/granular-permissions.md`), awaiting Liam's approval before build. Build on #119 + feature_visibility table + FEATURE_TREE manifest + lib/permissions.ts + sidebar/`<Gate>` + builder UI.
- **Tracks visualization for clients** — flagged to scope (task #189, biggest client-facing UI/UX call).

QA residuals (minor, for a polish pass): board view shows both the page FilterBar and BoardView's built-in search (double search); desktop-width kanban/table visual not captured (test window was ~501px); bulk-select interaction not click-tested (DataTable supports it); portal-leak full client-session test deferred (endpoint + deploy confirmed).

## Recent activity (2026-06-10, earlier)

Delivery spine #148 (the ManyRequests differentiator) is live end-to-end.

- **Slices 0-3 deployed + verified on prod** (dfa95f4 + migration 0076). `scheduleRowId` on requests/tasks, pure status engine (`lib/delivery-status.ts`, 13 tests), `/delivery-status` endpoint, GanttGrid status dots + schedule-editor delivery-health banner. Engine verified live: linked a request to a past-due Giant Group phase, engine computed `delayed` + correct rollup, clean unlink.
- **In-viewer linking picker shipped + VERIFIED LIVE (0c3cb53).** Schedule row editor gets a "Linked work" panel (chips + attach picker, new `/api/admin/schedules/[id]/linked-work` endpoint with org fallback via deal + `requireAccessToOrg`); request detail + task slide-over get a "Delivery phase" selector (`/api/admin/schedules?includeRows=1`, shared `lib/schedule-phases.ts`). MCP parity on the worker: `get_schedule_delivery_status`, `get_schedule_linked_work`, `link_request_to_schedule_row`, `update_task.scheduleRowId`, `list_schedules.includeRows`. Live prod smoke (2026-06-10): attached a request to the "Visual direction" phase via the picker -> chip + "Delivery: Delayed, 0/1 done, 1 off track" banner updated live -> request detail "Delivery phase" showed "Visual direction" -> detach returned engine to clean. NOT yet checked: mobile 375px + dark mode on the new picker (functional-only verification this pass).
- **Drive-by fixes:** delivery-status `inArray` now chunked (D1 100-bind cap would have 500'd schedules with >100 rows); requests list GET accepts `orgId` alias (the MCP `list_requests` org filter was silently a no-op); two stale Buffer unit tests updated to the intentional dueAt/client-side-filter behaviour.
- **Bug found, not yet fixed: `/tasks/[id]` full page is dead on prod.** `app/api/admin/tasks/[id]/route.ts` exports only PATCH, so the page's GET always 405s and it renders the error state. The tasks slide-over panel is the only working task detail surface. Fix = add a scoped GET (and DELETE) handler.

## Recent activity (2026-06-09)

Portal-readiness sweep (direction: Liam owns portal, team owns the website redesign). Goal arc: ManyRequests parity via granular permissions + working requests/tasks + the proposal/contract/schedule/delivery spine (task #148). This session = quick wins + bug sweep first.

- **T735 (P1) voice notes — fixed end-to-end** (385e03f). Was a data-loss bug, not just a fake UI: the conversations POST dropped the storageKey. Now persisted + joined + real player, admin + portal.
- **T660 — request activity comments-only filter** (6674c1d). Segmented control, localStorage-persisted.
- **T666 — Stripe import pagination** (07c5658). Both import-invoices + import-payments now page past the 100-record cap via `starting_after`.
- **T661 — client tags + filter requests by client tag** (f3b1e59). orgs had no tags column and the managed tags table was never wired, so built free-form: org tags column (migration 0075), TagsCard editor on client detail, requests list tag filter. **Migration 0075 must run on prod after this deploy.**
- **Bug-sweep finding: the quick-win backlog is ~half stale.** T665 (Stripe in_*/ch_* dedupe) already handled in code; T664 (accent sweep) effectively done, remaining hex are intentional (semantic callouts, success states, cluster palette, client PDF). Still open: T662 (email requestNumber var — needs the email layer inspected), T663 (portal noindex/robots — note the app mounts at /dashboard so /robots.txt serves under base path, may be wrong layer), T667 (Xero category overrides — needs its own migration).

## Recent activity (2026-05-27 → 2026-05-28)

- **Phase H finance shipped** — `/financial-reports` premium UI/UX overhaul. Hero band (cash + revenue side-by-side then stacked per user feedback), reserve donut, dual runway (worst-case + net-burn, tax-adjusted), bank-sync staleness stamp + Refresh button, currency switcher integration page-wide, Needs-attention card replacing the previous chip-style watchlist. Section tabs removed.
- **Recurring outflows CRUD + auto-detect cadence** — add/edit/delete commitments via SlideOver. Auto/Manual burn toggle on Reserve target card. Cadence auto-detect reads 180d of Airwallex transactions and infers billing day + cadence with confidence scoring.
- **Cash reserves CRUD** — new `/api/admin/reserves` routes + Settings section. Tax/buffer/deposits/other pots with target + accrued + accrual rate. Auto-cron accrues from daily revenue when rate is set.
- **Calendar two-way sync** — `POST /api/admin/calls` now pushes to Google Calendar with auto-Meet link + attendee invites, writes the event id back, also lands in `discovery_calls` so home widget sees it instantly. "Next call" widget got Live-now badge + Join button.
- **Auth shell premium rebuild** — split-pane sign-in / sign-up with `TahiStudioWordmark` SVG, brand-themed Clerk widget, client-focused copy, centred wordmark on mobile, no horizontal scroll.
- **Data correctness fixes** — deal closed_at backfill (migration 0057) + auto-set on stage move so sales velocity reads real numbers. Inverted FX formula in summary route fixed. Retainer breakdown table on /financial-reports. Tax-adjusted runway. Monthly history chart year-aware labels.

## Recent activity (2026-05-23 → 2026-05-24)

- **Lead intake foundation** — `leads` table + `people` canonical identity (one human, many roles via `person_id` on leads/contacts/team_members) + `/leads` page using DataTable + FilterBar + SlideOver + LeadForm. Lead MCP tools live on the worker.
- **Granular permissions model shipped (#119)** — RBAC + ABAC schema (roles, permissions, role_permissions with scope filters, team_member_roles, field_restrictions) via migration 0039. Seed migration 0041 populated 5 system roles (super_admin / admin / project_manager / task_handler / viewer) + ~126 permissions (27 resources × 4 base actions + 18 resource-specific verbs) + role_permission defaults. Enforcement is a per-feature runtime layer that rolls out gradually.
- **Pipeline triage (#123)** — migration 0040 moved every Lead-stage deal and every Stalled-no-engagement deal into the new `leads` table, preserving the deal's primary contact via `person_id`, stamping `lead_demoted` activities, and deleting the deal. 23 deals remain across Closed Lost / Closed Won / Discovery / Negotiation / Proposal.
- **Design-system enrichment pass** — ~22 surfaces lapped through the v3 primitives (FeatureCard, charts, kanban, BoardView, Avatar tooltips). FilterBar now supports `daterange` kind with 5 presets + custom from/to.

## Last shipped (last 10 commits, user-visible)

- `35973d5` — /financial-reports mobile: equal-width cards + win-rate row wrap
- `5d4fd8a` — Auth shell mobile: kill horizontal scroll, centre wordmark
- `488d534` — Watchlist redesign + Section tabs removed + Calendar push-back
- `a0c7278` — Cash reserves CRUD + sync staleness + watchlist on /financial-reports
- `d5342d0` — Recent activity rows: stop overflowing on mobile
- `86ceb7f` — Hero cash card: stack donut + metrics vertically
- `d1b73d6` — Next call widget: live-now badge + Join button
- `15fc002` — Mobile audit fixes: auth shell, financial reports, next-call widget, deals closed_at
- `1673b74` — Auth pages: split-panel premium layout with proper brand mark
- `61df271` — /financial-reports premium UI/UX overhaul aligned to design system

---

## Blocked on

- **KV namespace in Webflow Cloud** — proper rate limiter (T628 / T719) blocked; interim WAF rule available
- **Webflow Cloud deploys are slow** — tightens the live-QA loop; mitigated by the Definition of Done check (`CLAUDE.md`)
- **R2 STORAGE binding** in Webflow Cloud may need re-verification (March QA flagged file upload failures)

---

## Definition of Done (enforced)

Per `CLAUDE.md` Code Quality Rules. A task only flips to `[x]` once all seven steps pass — code quality + live browser verification + mobile + dark mode + commit note.

---

## Production-readiness exit criterion

Original plan said: all Phase 11 blocks closed + DoD enforced 4 weeks.

**Revised criterion (per user statement 2026-05-21):** the user trusts enough features to run their full workday inside the dashboard — not just pipeline + finance. Trust-crossover order in `memory/project_trust_state_2026_05.md`.
