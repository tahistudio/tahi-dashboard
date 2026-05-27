# Tahi Dashboard — Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-05-28** by Claude (Phase H finance + calendar two-way sync shipped)

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

1. **P1 — Voice note playback is fake.** `app/(dashboard)/messages/messages-content.tsx:95` `VoiceNotePlayer` animates a progress bar instead of decoding and playing the actual audio blob. Recording + R2 upload work; only playback is broken. Fix: swap the fake player for an `<audio>` element pointing at the R2 file URL.
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
