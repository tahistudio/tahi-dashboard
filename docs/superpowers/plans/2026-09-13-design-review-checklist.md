# Claude Design review checklist (2026-09-13)

Project: Tahi dashboard, https://claude.ai/design/p/57bf60cf-5e6d-450f-9e2f-e25c8d12fd66
Open any file with `?file=<name>` on that URL (spaces as `+`). The app shell is `Tahi App Shell.html`: switch audience, device and destination with the Tweaks pill in the bottom-right corner of the preview.

Tick a row once you have looked at it. "Port status" is what the repo says today (TASKS.md, STATUS.md); "Review" is yours. Anything you mark FIX or REDO becomes a design task before its port; anything you mark SHIP is queued for porting in the catalogue.

## Studio (Tahi App Shell.html, audience: owner or teammate)

| | Surface | Design file(s) | Port status in the repo | Review |
|---|---|---|---|---|
| [ ] | Studio home (Overview, daily brief, books, pipeline ahead) | overview.jsx, overview-kit.jsx, overview.css | ported (owner + client homes live) | |
| [ ] | Requests: list, board, detail, dialog, focus, capacity, workload | requests.jsx, requests-listview.jsx, requests-board.jsx, requests-detail.jsx, requests-dialog.jsx, requests-toolbar.jsx, requests-kit.jsx | ported (v3, live for every audience) | |
| [ ] | Tasks: list, board, My week | tasks.jsx, tasks-data.jsx, tasks.css | ported 2026-09-05, live | |
| [ ] | Clients: list and cards | clients.jsx, clients-kit.jsx, clients.css | ported 2026-09-06, live | |
| [ ] | Client detail: hero, needs you, tabs | clients-detail.jsx, clients-data.jsx | ported 2026-09-06, live | |
| [ ] | Leads, Calls, Deals (Stalled as a flag) | sales-pipeline.jsx, sales-pipeline-kit.jsx, sales-pipeline-data.jsx, sales-pipeline.css | design approved as-is (AR.3); NOT ported; the live /deals is the older v3 lap | |
| [ ] | Proposals, Contracts, Schedules, Templates: lists and the three-pane editors | sales-artifacts.jsx, sales-artifacts-kit.jsx, sales-artifacts-data.jsx, sales-artifacts.css | proposals editor needs more work (AR.4); NOT ported | |
| [ ] | Public viewers: proposal, contract, schedule (client papers) | bottom of sales-artifacts-kit.jsx | NOT ported; live viewers are the older deliverable kit | |
| [ ] | Time, Team, Tracks, Capacity | ops.jsx, ops-kit.jsx, ops-data.jsx, ops.css | NOT ported; live pages are v3-partial | |
| [ ] | Studio invoices: list with totals strip, seven saved views, detail with chase drafter | invoices-studio.jsx, invoices-studio-kit.jsx, invoices-studio-data.jsx, invoices-studio.css | wired into the shell 2026-09-13 (DL.3); critic said FIX before port (MR.6); NOT ported | |
| [ ] | Permissions builder | permissions.jsx | ported (granular permissions live) | |
| [ ] | Settings (studio) | Tahi Settings.html, settings-app.jsx, settings.css | ported (settings rebuild live) | |

## Client portal (Tahi App Shell.html, audience: client)

| | Surface | Design file(s) | Port status in the repo | Review |
|---|---|---|---|---|
| [ ] | Client home (Waiting on you, plan and tracks, activity, library, billing) | portal-home.jsx, portal-home-kit.jsx, portal-home-data.jsx, portal-home.css | ported (PP.2), live; design file had a one-byte transcription error fixed 2026-09-13 | |
| [ ] | Client requests list and detail (shared with studio kit) | requests-* with the client audience | ported, live | |
| [ ] | Client invoices: list, detail, How to pay | portal-money.jsx (Invoices half), portal-money-kit.jsx | ported (PP.3), live | |
| [ ] | Services: plan card, plan ladder, catalogue, add-ons | portal-money.jsx (Services half), portal-money-data.jsx | catalogue live; the plan ladder was written to the design 2026-09-13 (DL.3) and is NOT ported | |
| [ ] | Files (small Drive with threads) | portal-files.jsx, portal-files-kit.jsx, portal-files-data.jsx, portal-files.css | NOT ported; live /files is the simple list | |
| [ ] | Account: You, Sign-in, What reaches you, Your team | portal-account.jsx, portal-account-kit.jsx, portal-account-data.jsx, portal-account.css, portal-account-sections.html | ported (PP.4, MR.2), live | |
| [ ] | Notifications (both audiences) | portal-account.jsx (Notifications room) | ported (AR.1), live | |

## Standalone pages

| | Surface | Design file(s) | Port status in the repo | Review |
|---|---|---|---|---|
| [ ] | Sign in, sign up, forgot password, invite accept | Tahi Auth.html, auth-app.jsx, auth.css | live on Clerk; branded error and verification states at 375 still open (T1.3, T1.8) | |
| [ ] | Client onboarding (welcome, plan, pay, kickoff) | Tahi Onboarding.html, onboarding-app.jsx, onboarding.css, onboarding-spec.md | live; existing clients now skip plan and pay (S2) | |
| [ ] | Team onboarding | Tahi Team Onboarding.html, team-onboarding-app.jsx | invite path exists; the welcome page still hardcodes role, gear and buddy (T1.20) | |
| [ ] | Transactional emails (19 templates, Studio Ledger kit) | Tahi Emails.html, emails-app.jsx, emails.css | ported and live (EM.1) | |

## Not designed yet (no file in the project)

Reports, Sales analytics, Affiliates, Announcements, Reviews, Content studio, Social, Calculator, Docs hub, Capacity (beyond the ops module), Billing (studio), Financial reports, the studio Calls detail (the page Liam flagged on 2026-09-13: cannot change what a call is linked to or what it is for), the Danger zone and maintenance surfaces (import, cleanup, residue), the client Offline page. The catalogue in docs/superpowers/plans/2026-09-13-page-catalogue.md ranks these.
