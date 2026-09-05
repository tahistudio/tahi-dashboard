# Morning report, Sunday 6 September 2026 (draft, finalised at 07:30 NZST)

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

## Client walk findings (headless, QA server, as Acme Corp and Stride; full report docs/superpowers/audits/2026-09-06-client-walk.json)

The core client loop (overview, requests list, board, timeline, request detail, New request with AI assist) rendered honestly at both widths with no overflow and no dashes. Problems cluster in money and preview fidelity. Fixes for the first, second, and the not-found, TRIAGE, contrast and banner items launched at 05:40; the participants lie, Pay now and How to pay on the list, and the notifications 404 are inside the portal port slices.

- [blocker] /billing, /settings, /calls, /tasks (Client view): Client view (the impersonation preview) renders the studio's admin surfaces inside the client shell, so a screen labelled "Read-only client view" shows every other client by name, plan and money.
- [blocker] /overview, /requests, /invoices (all client pages): Money is shown in a display currency that defaults to NZD regardless of the client's own currency, and the top-bar chip silently re-converts it.
- [blocker] /invoices/8d76f113-46c8-4340-bcf9-46077d52254a (Stride): Clicking an invoice row lands a client on "Failed to load invoice." with a 19px Retry button and no other way forward: no amount, no reference, no line items, no way to pay.
- [blocker] /invoices (Stride): The only payment action a client has is a dead link.
- [important] /requests/bed1cf18-52cc-46dd-848f-8096f94f005c: The request detail tells the client nobody is working on their request, while the list, board and track strip on the same site all name the person who is.
- [important] /overview vs /requests: The portal contradicts itself about what the client is paying for and what is being built.
- [important] /overview (Stride): An established client with five months of invoices and a 131-day-overdue bill is greeted as brand new, and the same page contradicts itself two cards later.
- [important] /invoices: Invoice rows are non-focusable <tr> elements with a click handler, so the only way into an invoice is a mouse click.
- [important] /notifications (and any mistyped URL): There is no app-level not-found page, so a client who lands on a bad URL gets the raw Next.js 404 with no navigation, no branding and no link back - a hard dead end inside a signed-in session.
- [important] /requests (Kanban tab): Internal studio vocabulary is printed on the client's board: the Submitted column carries a "TRIAGE" badge.
- [important] /invoices (Stride): React hydration mismatch on a client-facing money page, which throws away the server render and re-renders the whole tree on the client.
- [important] /requests: In dark mode the SELECTED saved view is the least readable item in the rail - darker than the unselected ones.
- [minor] /overview, /files, /invoices, /requests, /settings: Many client controls are under the 2.75rem (44px) minimum at 375px.
- [minor] /overview, /requests: Counts are labelled with the wrong verb, so the numbers read as claims the data does not support.
- [minor] Impersonation banner (every page): Stray space before the full stop in the banner copy: "Viewing Acme Corp .
- [minor] /overview (Stride): A disabled "Messaging soon" pill and "TBC" placeholders ship roadmap scaffolding to the client.
- [minor] /services: Services is a permanently empty nav item: the catalogue query can never return anything today, so every client sees a dead page in their sidebar and More sheet.
- [minor] /requests: The List / Kanban / Timeline switcher collapses to unlabelled icons at 375px and the icons are near-invisible in dark mode.
- [minor] /overview: The news-feed line truncates mid-sentence with an unclosed quotation mark.
- [minor] /overview (client): The client home logs a 500 to the console on every load and issues about 24 admin API calls the client half never uses.

## Decisions for you

- Re-checked on production as Client view of Tahi Test Client at 05:50: the portal invoice detail answers 200 with howToPay (the QA server's 500 was local snapshot drift, not a product bug), so that client-walk blocker does not apply to production.
- Operator step: Settings, Studio details, Getting paid is empty, so How to pay currently shows only the amount, due date and reference. Fill bank name, account name, account number and the Xero payment account code and every Xero-rail client gets the full block.

- Services upsell brief (CL.3): the showcase is designed without pricing pressure; tell me how hard to sell.
- Files as Drive (CL.1) and client Messages need schema (folders, versions, file threads, conversation participants): design is done, build is a day each.
- Notifications page: the API needed pagination and mark-all-read; see the port notes.

## How to review

- Production: portal.tahi.studio as yourself; View as client on Tahi Test Client (business+client@tahi.studio invite is in your inbox for a real client session).
- Claude Design: open the Tahi dashboard project, switch the audience to client, pin comments; hit Send to Claude on anything you want actioned.
