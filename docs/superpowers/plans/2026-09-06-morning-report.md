# Morning report, Sunday 6 September 2026 (written 06:45 to 07:30 NZST)

Kia ora Liam. This is what happened between 22:50 last night and 07:30 this morning. LIVE means on portal.tahi.studio, past type-check, lint, the full test suite and a build, deployed, and smoke-tested in a browser afterwards. DESIGNED means in the Claude Design project "Tahi dashboard" for you to comment on.

## One incident, resolved

At 06:25 the client-walk fix deploy broke every signed-in page (server-side exception). I rolled back within twelve minutes and production is back on the portal-port tree, verified in the browser at 06:50. Cause, found by a read-only diagnosis (docs/superpowers/audits/2026-09-06-prod-500-diagnosis.json): the dashboard layout called a helper exported from a use-client module on the server; Next replaces such exports with a stub that throws at runtime, and nothing in type-check, tests or the build catches it. The fix is a three-function move into a server-safe file. I did not re-land it in the last hour of the run; it is the first thing to do today, with a render check on the QA server and a post-deploy health probe (both now written into the deploy recipe).

## Live on production, in order

1. Invoicing: channel per client (Stripe or Xero, studio default in Settings), New Invoice defaults its rail, currency and due date from the client with a warning on override, one Xero status mapper with forward-only reconcile and paginated payment sync, the Xero pay link captured once you approve an invoice in Xero, a dashboard mark-paid pushes back to Xero or Stripe, Getting paid settings (bank details, Xero payment account code, Xero email mode), How to pay in the invoice emails and the portal projection, Xero email mode honoured on send. Migrations 0089, 0090 and 0091 applied to both D1s before each deploy. Two money bugs fixed on the way: the invoice detail read Source Manual for every invoice, and a hand mark-paid lost its date so financial reports under-reported.
2. Predictive autofill on New Request and New Task: grounded Haiku suggestions for due date, priority, size, estimate and category, marked Suggested with a reason, clearable, never over a field you touched. Smoke-tested live with a real title.
3. Mobile top bar: brand mark, page name, search, bell and a More sheet with Track time, Daily brief, currency, theme, private mode, Client view, Settings and Sign out. Sign out was unreachable on phones before.
4. Clients list and client detail redesign, ported from the Claude Design: saved views rail with true counts, filters that go to the endpoint, cards view, bulk actions, server paging, Archived view and Restore; detail hero, Needs you, tracks, nine tabs including Money, every previous capability kept. Then a touch-target pass: every button clears 2.75rem below md, app-wide.
5. Client portal port from the Claude Design: one client status vocabulary, the Waiting on you tile as an actionable hero, masthead with greeting and plan, skeletons on every card (no more empty-state lies while loading), every New request affordance opens the dialog, the request detail stops claiming nobody is assigned; client invoices with Pay now for real links and a How to pay block with copy buttons, per-currency figures, no rail or Source label; the Services showcase with an Ask about this path and no create-a-service; the Notifications page for both audiences with a paginated API, kind filters and honest deep links; a standalone Offline page.
6. Playwright coverage for blockers, the week strip and the AI create view; the email preview set sent to your inbox; the My week note removed.

## Designed in Claude Design (comment there; switch the audience to client for the portal)

- Clients list and detail (ported).
- Client portal: home, requests list and detail, new request, Files as a mini Drive with threads, Messages, invoices, services, notifications, account, welcome, offline. The critic found a CSS prefix collision between the home and files modules and inconsistent sample identities in the prototype; a fixer was still working on it at 07:30 after two restarts (usage limit, then a hung render); if the portal pages look off in the prototype when you open them, that is why. The repo port used the reader maps, not the prototype, so production is unaffected.
- Sales stack, all three areas designed with standalone previews (open the module files sales-pipeline.jsx, sales-artifacts.jsx and ops.jsx, or their *-preview.html): leads list and detail, calls list and call detail, deals board and deal detail; proposals, contracts and schedules (list, editor, templates, the public proposal viewer; the designer flagged concerns to read in its notes); time week grid with the Xero export drawer, team with access scope in plain words, capacity, tracks mini kanbans plus a client-facing tracks view. The ops critic said FIX on all five (good thinking, details to tighten); the pipeline and artifacts critics were still running at 07:30 and their notes land in docs/superpowers/audits/2026-09-06-sales-design-results.json when done. These are not wired into the shell yet; a one-agent integrator does that before the port.

## Not done tonight, and why

- Client-walk fixes (PP.5 in TASKS.md): reverted after the incident; re-land today after a QA render check. Contents: Client view resolves the audience server-side on every studio page (today a preview still shows the studio's own billing, settings, calls and tasks pages inside the client shell), client money pinned to the client's currency with no switcher, a branded not-found page, the TRIAGE badge hidden from clients, dark-mode rail contrast, banner copy.
- Files as a mini Drive with threads and client Messages: designed, not built. Both need schema (folders, versions, file threads, conversation participants). About a day each.
- The portal-only requests component tree: the client list and detail still share the studio components with isAdmin branches; only the status badge adopted the client vocabulary. This is the follow-up that removes a whole class of client-visible leaks the reader map lists.
- Sales stack and ops ports: designs only. Tier 3 (reports, calculator, announcements, reviews, affiliates, content studio, sitemap, social, docs) was not reached.
- Two usage-limit pauses (23:30 to 01:20, and 06:10 to 06:20) cost about two hours of agent time; three designers hung and were restarted from cache.

## Client walk findings (as Acme Corp and Stride on the QA server; full list in docs/superpowers/audits/2026-09-06-client-walk.json)

The core client loop rendered honestly at both widths, no overflow, no dashes. Fixed tonight: the participants lie on the request detail, Pay now and How to pay on the invoice list and detail, the notifications 404. Open: Client view preview fidelity and client currency pinning (in the reverted branch), the not-found page, the TRIAGE badge on the client board, dark-mode contrast of the selected saved view, the banner's stray space, invoice rows not keyboard-focusable, three endpoints disagreeing on track count, an established client greeted as brand new, the news-feed line truncating mid-sentence.

## Decisions and operator steps for you

- Settings, Studio details, Getting paid is empty: fill bank name, account name, account number and the Xero payment account code, and every Xero-rail client gets the full How to pay block (today it shows only amount, due date and reference).
- Services upsell brief (CL.3): the showcase is live without pricing pressure; tell me how hard to sell.
- Two new email variants (invoice sent and overdue with How to pay) exist in the preview set; say the word and I send them to your inbox.
- The invoice number: Tahi owns the sequence (your call from last night) but the column does not exist yet (CT.14); clients see the short id as their reference until it does.

## How to review

- Production: portal.tahi.studio as yourself; Clients, Tahi Test Client, View as client. For a real client session use the invite in your inbox for business+client@tahi.studio in an incognito window.
- Claude Design: open Tahi dashboard, switch the audience to client for the portal pages, pin comments, and hit Send to Claude on anything you want actioned.
