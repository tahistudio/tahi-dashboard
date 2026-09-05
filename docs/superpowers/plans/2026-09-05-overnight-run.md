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

- [ ] Tier 1 designed
- [ ] Tier 1 ported and client-walked
- [ ] Tier 2 designed
- [ ] Tier 2 ported
- [ ] Tier 3 designed
- [ ] Tier 3 ported
- [ ] Morning report written (docs/superpowers/plans/2026-09-06-morning-report.md)

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
