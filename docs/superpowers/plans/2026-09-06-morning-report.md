# Morning report, Saturday 6 September 2026 (draft, finalised at 07:30 NZST)

Kia ora Liam. This is what happened between 22:50 last night and 07:30 this morning. Everything below marked LIVE is on portal.tahi.studio, passed type-check, lint, the full test suite and a build, and was smoke-tested in a browser after the deploy. Everything marked DESIGNED is in the Claude Design project "Tahi dashboard" for you to comment on.

## Live on production (in order)

- Invoicing channel per client (IC.2), New Invoice defaults from the client (IC.3), Xero status truth and paginated payment sync (IC.5), Xero pay rail: online pay link capture, mark-paid pushback to Xero or Stripe (IC.4a), the studio side of the pay path: Getting paid settings, pay link and pushback outcome on the invoice detail, How to pay in emails and the portal projection, Xero email mode (IC.4b). Migrations 0089, 0090, 0091 applied to both D1s ahead of each deploy.
- Money-path bug fixes (IC.1): the invoice detail reads its real Source, a hand mark-paid keeps its date (financial reports were under-reporting).
- Predictive autofill on New Request and New Task (TP.5): grounded Haiku suggestions for due date, priority, size, estimate and category, marked Suggested with reasons, clearable, never over a field you touched.
- Mobile top bar (TP.6): five slots plus a More sheet with Track time, Daily brief, currency, theme, private mode, Client view, Settings and Sign out (sign out was unreachable on phones before).
- Clients list and client detail redesign (CR.1 to CR.4): saved views rail, filters, cards view, bulk actions, server paging, Archived view and Restore; detail hero, Needs you, tracks, nine tabs including Money, every previous capability kept; 2.75rem touch targets on every button below md app-wide.
- Playwright coverage for blockers, the week strip and the AI create view; the email preview set (22 emails) sent to business@tahi.studio; the My week note removed.

## Designed in Claude Design (comment there)

- Clients list and detail (ported).
- Client portal: home, requests list and detail, new request, files as a mini Drive with threads, messages, invoices list and detail, services showcase, notifications, account, welcome, offline. A fixer ran on the prototype after the critic (CSS namespace collision, one client identity, no studio pages in the client nav).
- Sales stack: leads, calls, deals; proposals, contracts, schedules and their public viewers; time, team, capacity, tracks. (Status filled in below.)

## In flight or left for the next pass

(filled in at 07:30)

## Client walk findings

(filled in when the client agent reports)

## Decisions for you

- Services upsell brief (CL.3): the showcase is designed without pricing pressure; tell me how hard to sell.
- Files as Drive (CL.1) and client Messages need schema (folders, versions, file threads, conversation participants): design is done, build is a day each.
- Notifications page: the API needed pagination and mark-all-read; see the port notes.

## How to review

- Production: portal.tahi.studio as yourself; View as client on Tahi Test Client (business+client@tahi.studio invite is in your inbox for a real client session).
- Claude Design: open the Tahi dashboard project, switch the audience to client, pin comments; hit Send to Claude on anything you want actioned.
