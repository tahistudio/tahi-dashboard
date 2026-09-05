# Overnight run, 2026-09-05 22:50 NZST to 08:00 NZST

Liam's goal (verbatim intent): auto run till 8am, keep going and iterate. Go through every page and sub page, design it in Claude Design, implement it, run UI/UX agents and client agents. Wake up to a fully designed dashboard (every page) that works, including contracts, proposals, schedules, the works. He reviews tomorrow and next week, adds comments in Claude Design, then we iterate.

Liam's answers before starting: deploy to PRODUCTION as today (every merge checked and smoke-tested); scope is EVERYTHING but triaged, client-facing first, then the most visited admin pages, then the rest, including messages, services, payment, the full sales stack; keep ticking pages off, do not rush; spawn agents, diversify load; port behaviour changes too but keep the data safe (pipeline, clients, contacts, invoices, finance, docs are real; tasks, requests, messages, time, calls are demo).

## Loop per page (or page group)

1. Read: a reader maps the live page (routes, data, states, dead ends) with file:line anchors.
2. Design: a designer writes the page into the Claude Design project "Tahi dashboard" (57bf60cf) as its own module files (`<area>.jsx`, `<area>-kit.jsx`, `<area>-data.jsx`, `<area>.css`) using the DS bundle under `_ds/`, and returns the exact `app-shell.jsx` wiring for an integrator. Designers never edit `app-shell.jsx` or `Tahi App Shell.html` while another design is in flight; one integrator wires a batch.
3. Critique: a render-and-critique agent screenshots the prototype and lists what is wrong; the designer fixes.
4. Port: implementers in worktrees port the design to the repo behind the existing routes and APIs (keep every gate: requireAccessToOrg, requireFeature, getPortalAuth, requirePortalFeature), with reviewers (spec, quality, a11y and mobile) and a fix branch.
5. Lead: merge, type-check, worker tsc, lint 0, vitest, build, migrations to staging and prod BEFORE deploy, push, wait for deploy, live smoke on portal.tahi.studio (admin tab, and the Tahi Test Client via View as Client), tick the page in this file.
6. Client agents: after each portal batch, an agent walks the portal as the test client and files dead ends.

## Triage

Tier 1, client facing (portal): overview/home, requests list, request detail, new request, files (mini Drive with threads, CL.1), invoices list and detail (Pay now and How to pay), services showcase (CL.3), messages, notifications page (TP.4), account, onboarding, mobile bottom nav, offline page.
Tier 2, most visited admin: overview home, requests, tasks, clients (in flight), invoices and billing, deals and leads, proposals, contracts, schedules, calls, time, team and capacity, settings and permissions, notifications.
Tier 3, the rest: financial reports, reports, sales analytics, calculator, announcements, reviews, affiliates, content studio, sitemap, social, docs (locked, design only unless trivial), tracks, design-system page.

## Status board (tick as landed; evidence in TASKS.md)

- [x] Tier 1 designed
- [x] Tier 1 ported and client-walked (Files as Drive and client Messages need schema; follow-ups listed in TASKS PP.2 to PP.4)
- [x] Tier 2 designed (Clients ported; sales pipeline, sales artifacts and ops designed with previews, critics partly done, shell wiring pending)
- [~] Tier 2 ported (Clients only; sales and ops ports next)
- [ ] Tier 3 designed (not reached)
- [ ] Tier 3 ported (not reached)
- [x] Morning report written (docs/superpowers/plans/2026-09-06-morning-report.md)

## Rules that stay on

No em or en dashes. No any. Tokens not hex. Rem not px. No single-side borders. Hover, focus, 2.75rem targets. Every page keeps export const metadata. MCP parity for new API capability. Migrations additive and idempotent, mirrored in the migrate route, applied to both D1s before deploy. Never git add -A. Commit trailer: Co-Authored-By Claude Fable 5.1 plus Claude-Session.

Stop starting new work at 07:30 NZST (19:30Z). Morning report by 08:00 NZST (20:00Z).

## Standing rules from Liam mid-run

- Claude Design has less context than we do. If the design omits a field, dropdown or action that the reader map or the repo needs, the port ADDS it. The design sets look, density and vocabulary; the repo's data model and the reader maps are the spec.
- Mobile first, every page, 375px. The mobile top nav bar is too crowded: declutter it (brand mark, page title, search, bell, account; Track time, Daily brief, currency and theme move into a More sheet). Tier 1 item, being built now.

## Run log

- 22:50 NZST start. Landed before midnight: IC.1 to IC.5 invoices, IC.4a Xero pay rail (migration 0091 on both D1s), predictive autofill TP.5 (migration 0090 indexes on both D1s, legacy request dialog removed), Playwright coverage for blockers/week strip/AI create, My week note removed, email preview set sent.
- 23:30 NZST usage limit hit; six agent workflows died mid-run (portal designers, sales designers, top-nav build, pay-path studio build, Clients critique). 01:20 NZST reset; resumed portal design, top nav, pay-path studio, Clients critique. Sales design queued behind the portal design to pace the limit.
- 01:40 NZST predictive autofill smoke-tested live in the New Request dialog (Bug fix, High, due +3 days, chips, captions, one announcement). 02:00 Clients design complete in Claude Design (clients.jsx, clients-kit.jsx, clients-detail.jsx, clients-data.jsx, clients.css, wired into the shell); critic: keep Deals/Time/Revenue/Profitability via a Money tab, keep the status filter and an Archived view. Repo port of Clients list + detail launched with those gaps in the brief.
- 02:25 NZST IC.4b pay-path studio side live (10fbd6e9). Mobile top bar (More sheet) merged and in final checks. Clients port and portal design running.
- 02:35 NZST mobile top bar live (5dfb08cb): five slots plus a More sheet with account, tools and sign out.

- 03:25 NZST portal design: one of four designers hung for 70 minutes with no activity; stopped the run and resumed from cache (three designers' modules kept), so the fourth reruns, then the integrator and critic.

- 03:50 NZST Clients port merged on main (list 0b9cd35a, detail 05b44b0c; 2621 tests, build green). Render check on the QA server running before the push. Sales design resumed in Claude Design.

- 04:00 NZST Clients list and detail LIVE on production (2f270013). Touch polish fixer running.

- 04:20 NZST touch polish live (17a490b2): all TahiButtons 2.75rem below md app-wide, hero row and More sheet tidy.

- 04:50 NZST portal design complete in Claude Design (portal-home, portal-files, portal-money, portal-account modules wired into the shell by the integrator, zero errors; critic finishing). Portal port launched in three slices: home + client request views, invoices + services showcase, notifications + account + offline. Files-as-Drive and client Messages stay design-only tonight (schema needed). Client walk agent running on the QA server. Sales designers still writing.

- 05:00 NZST portal prototype critique in: wiring sound, zero errors, but two cross-cutting prototype defects (portal-home and portal-files both use the pf- CSS prefix so files overwrites home; four different signed-in client identities across modules) plus the client nav in the prototype shell still lists Schedule, Contracts and Proposals. invoice-detail SHIP, messages REDO, the rest FIX. A fixer plus re-critique launched on the prototype so Liam reviews a coherent portal. Repo port unaffected (it reads the designs for look and vocabulary and the reader maps for truth).

- 05:18 NZST sales design: two of three designers done (pipeline, artifacts or ops), the third never produced a transcript and the run sat idle 26 minutes; stopped and resumed from cache so only the missing designer and the three critics run.

- 05:40 NZST client walk report in (4 blockers, 8 important, 8 minor; saved). Fixer launched for the preview-fidelity blocker (admin pages inside Client view), client currency pinning, a branded not-found page, the TRIAGE leak, dark-mode rail contrast, banner copy. The rest sits inside the portal port slices or the morning list.

- 06:05 NZST portal port merged (home, money, account; 2680 tests, build green), render-checked as a client at desktop, 375 and dark on the QA server (all pages render, no overflow, no page errors; the QA snapshot's own 500 on one portal read remains local), pushed and deploying. Prototype fixer restarted after a hung render.

- 06:15 NZST portal port LIVE on production (e3b3a4a2). Smoke as Client view of Tahi Test Client: masthead with plan, Waiting on you tile (2 items), vitals, New request CTA, first-run welcome, bottom tabs; /api/notifications paginated (items, unreadCount, nextCursor, hasMore); invoice rows carry howToPay.

- 06:20 NZST usage limit hit again (reset 06:20); the prototype fixer and the sales artifacts designer plus critics died and were resumed.
- 06:25 NZST INCIDENT: the client-walk fix deploy (c14169bc) broke production: every signed-in page 500 (server-side exception), unauthenticated pages 404. All checks had passed. Reverted (4f905464, c96c8c2d) and redeployed within 12 minutes; production back on the portal-port tree. Diagnosis agent running; PP.5 stays open. Lesson recorded: a post-deploy health probe joins every deploy chain.

- 06:35 NZST rollback deploy (c96c8c2d) verified in the browser: production back (Clients renders, 28 clients, no application error). Diagnosis saved: the dashboard layout called resolvePinnedCurrency from a use-client module on the server; fix is to move three pure helpers into lib/currency.ts. PP.5 re-lands today after a QA render check plus a post-deploy health probe. Sales design (third designer + critics) and the portal prototype fixer resumed at 06:22 and still running.

- 07:26 NZST final tick: sales stack fully designed (pipeline, artifacts, ops) with one critic done (ops: all FIX) and two still running; portal prototype fixer still working after two restarts. Run closed; no new work after 07:30.

- 07:52 NZST portal prototype fixer done (namespace collision, one data spine, nav dead ends, per-page fixes); re-critique running. Sales design critics all done (all FIX, no REDO). Liam is up and reviewing.

- 08:20 NZST portal prototype re-critique done: structural fixes verified, per-page polish notes saved. All overnight background work complete.

- 09:20 NZST morning review fixes on the Clients list live (0e0a99dd) through the new gate: checks, QA render probe (no duplicate plan text, no errors), deploy, health probe 200.

- 09:55 NZST studio invoices and Services v2 designed in Claude Design (both FIX, strong); designer-fix pass running on both; shell wiring for sales, ops, account and notifications tweaks still running.

- 10:30 NZST sales, artifacts and ops wired into the Claude Design shell; Account and Notifications reworked per Liam; QA walk clean of errors with per-page FIX notes; fixers launched on all three modules; studio invoices and Services fix pass still running.

## Polish list (small things seen live, batch into one fixer before 07:30)

- [x] More sheet Track time row left-aligned (17a490b2).
