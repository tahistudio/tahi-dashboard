# Ship readiness audit: can Tahi run on the dashboard instead of ManyRequests

Date: 2026-09-04. Method: seven code lenses (auth, onboarding, roles, requests_tasks, billing, comms, migration), every claim checked against files rather than docs, then a verification pass that refuted or rescoped 78 draft findings. Requests internals were not re-audited (see 2026-09-03-requests-technical-audit.md); only its seams were.

Counts: 136 unique steps. 33 work, 83 partial, 20 missing. 26 steps are cutover blockers, consolidating into 19 Tier 1 items.

## 1. Summary for the founder

Not yet, but the distance is short and it is mostly plumbing, not product.

The hard parts are built. Requests, the board, tracks, sub-requests, checklists, files, time, reports, roles, the portal shell, Stripe checkout, Xero sync and the notification spine all work in code. On raw capability the dashboard already beats ManyRequests in about fourteen of twenty-two areas. What is missing is the connective tissue at the two ends of the client lifecycle: getting a client into the product, and getting them to pay from inside it.

Four things block a cutover today.

First, there is no way to give a client a login. The invite system is correct and complete on the server, and nothing in the product calls it: no button on the client page, no MCP tool, no email. The welcome email that does exist links to the bare portal root with no token, so a migrated ManyRequests client who clicks it signs up, gets no workspace, and provisions a brand new empty one. Their data sits in an org they can never reach. This is the most likely cutover failure and it is a few days of work.

Second, a client cannot open or pay an invoice. The portal list works, but every row click and every emailed "View Invoice" button lands on the admin page, which returns 403 for them. The Stripe payment link is fetched and then discarded instead of stored. Clients pay from the portal in ManyRequests today, so this is a straight regression at the moment of cutover.

Third, several client-facing surfaces are dead ends. Files is a hardcoded empty state even though its API is written. Schedule, Contracts and Proposals sit in the client menu and bounce back to Requests. Choosing "invoice me" at onboarding puts the client in a permanent redirect loop. Each is small alone, and together they are what a new client sees in their first ten minutes.

Fourth, the scheduled jobs never run. Both cron workflows post to a /dashboard/api/... path left over from Webflow Cloud while the app now serves at the domain root, so every digest, sweep and sync 404s in production. One line each.

Two more must move before real client data does: the MCP server's OAuth authorize endpoint auto-approves anyone who knows the client id, which mints a full admin token over every client's data, and the live ManyRequests bearer token is in git history. Both are known and approved, neither is shipped.

Shortest path: about two weeks on the seventeen small and medium Tier 1 items (invite, invoice pay, dead ends, crons, timer data loss, notification links, portal role), plus the two security items, plus a first batch of route-level permission enforcement on the money and client-data endpoints. Then cut one real client over end to end, then do the rest. Nothing here needs a rebuild or a schema redesign, and the existing backlog already names most of it.

One warning about the docs: STATUS.md and TASKS.md are behind the code in both directions. T1.15 (deny by default), T1.17 (hire onboarding) and T1.18 (nav guards) have shipped but read as open, while STATUS.md's claim that /billing "has a working client branch, it's just unlisted" is wrong, because middleware redirects clients away from it. Trust the code.

## 2. Readiness matrix

Status key: works = route and UI both present end to end; partial = some of it exists; missing = absent. B = cutover blocker.

### Flow: auth

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Team sign-in and roster claim | works | app/(dashboard)/layout.tsx:80, lib/team-link-server.ts:77 | Compare-and-set on clerk_user_id, unit tested | | |
| Team member invite (Clerk org invitation) | works | app/api/admin/team/[id]/invite/route.ts:69 | Manager gated, feature gated, conflict tolerant | | |
| Client accept-invite given a token | works | app/api/portal/accept-invite/route.ts:58, middleware.ts:120 | Email bound, atomic single use, token survives the Clerk round trip | | |
| Password reset and email verification | works | components/tahi/auth-shell.tsx:437, e2e/onboarding-personas.spec.ts:31 | Only residue is static hero copy on sub-paths | S | |
| Second client seat gets a linked identity | missing | app/api/portal/people/route.ts:157, app/api/portal/invites/route.ts:38 | No Clerk webhook and no client twin of linkTeamMemberOnSignIn, so contacts.clerkUserId stays null: no org admin, no notifications, messages stamped with a raw Clerk id | M | B |
| Second client seat passes the onboarding gate | partial | app/(dashboard)/layout.tsx:71, app/api/onboarding/complete/route.ts:96 | A colleague at a retainer client passes on the active subscription; at a project client the 402 loops them between /overview and /onboarding | M | B |
| Worker MCP /authorize auto-approves | missing | workers/mcp-server/src/index.ts:2765 and :3017, middleware.ts:105 | Anyone with the client id mints a full-admin token over every client's data, bypassing Clerk. Approved 2026-08-18, unshipped | M | B |
| Multi-org contact (person at two clients) | missing | no OrganizationSwitcher outside onboarding; components/tahi/sidebar-user-card.tsx | Pinned to whichever org Clerk marks active, with no UI to change it | M | |
| Contractor or non-employee identity | partial | db/schema.ts:187 | isContractor is cosmetic; a contractor is modelled as a team member plus a Tahi Clerk seat. The scoping itself is enforced | M | |
| Entry-path test coverage | partial | e2e/portal-flow.spec.ts:10 (hard skipped) | No client-session smoke and no route tests for provision, accept-invite, complete or invites | M | |
| Dead public matcher '/demo(.*)' | works | middleware.ts:10 | Scaffolding cruft, no such route has ever existed, layout and routes self-authenticate | S | |

### Flow: onboarding

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Studio's own setup surfaces | works | components/tahi/settings/sections/studio-details.tsx:63, branding.tsx:10 | Details, branding, kanban, request forms and booking all read and write real APIs | | |
| Invite token resolution and org join | works | lib/onboarding-invites.ts:29, app/api/portal/accept-invite/route.ts:97 | 192-bit token, expiry, Clerk org join or lazy create, contact link | | |
| Self-serve org provisioning | works | app/api/portal/provision/route.ts:46 and :95 | Idempotent Clerk resolve, D1 org with clerkOrgId, primary contact linked | | |
| Self-serve project enquiry | works | app/api/portal/enquiry/route.ts:64 | Lead, activity and studio email all fire | | |
| Mint and deliver a client invite link | partial | app/api/admin/onboarding-invites/route.ts:38; only caller e2e/helpers/invites.ts:55 | The mint route is correct and has zero product callers: no button, no MCP tool, and it returns a link without emailing it. Onboarding a client means hand-crafting a POST | M | B |
| Welcome email is an invite | partial | app/api/admin/clients/[id]/welcome-email/route.ts:65 and :87 | CTA points at the portal root with no token, uses inline HTML instead of emails/welcome.tsx, goes to one contact, and the caller swallows all outcomes | S | B |
| Admin create-client sends the invite it promises | partial | app/api/admin/clients/route.ts:119, app/(dashboard)/clients/client-list.tsx:562 | The dialog says "Creates their portal and sends an invite email"; no email, Clerk call or invite happens and the operator gets no signal | S | B |
| Admin create-client captures the commercial model | partial | app/api/admin/clients/route.ts:124 | Six fields only: no customMrr (the MRR source of truth), no preferredCurrency, no clerkOrgId, no Stripe customer | M | B |
| In-portal first-run checklist | missing | components/tahi/overview/overview-home.tsx:79 and :93, homes/client-home.tsx:313 | ClientFirstRun is dead code because ctx.home is hardcoded 'steady', orphaning onboardingState, onboardingLoomUrl and a working portal API | S | B |
| Kickoff booking writes a call | partial | components/tahi/onboarding-content.tsx:551 and :573 | The client picks from invented times, presses "Book and enter your studio", and nothing is written: no scheduledCalls row, no hold, no email | M | B |
| Fresh client owner is a workspace admin | partial | app/api/portal/provision/route.ts:114 vs portal/organisation:21, brands:41, people:44 | portalRole is never set at creation so it defaults to member, and the owner is refused on their own workspace until someone edits the column | S | B |
| Details step persists what it collects | partial | components/tahi/onboarding-content.tsx:518 | Company name, role and timezone are uncontrolled inputs never read; the org keeps its auto-generated name | S | |
| Welcome video (Loom) | partial | components/tahi/onboarding-content.tsx:104, app/api/portal/onboarding/route.ts:23 | The 60 second hello is a simulated progress bar; onboardingLoomUrl has no editor and no renderer | M | |
| New teammate day one | partial | app/api/admin/team/route.ts:95, lib/permissions.ts:318, lib/access-scoping.ts:52 | Deny by default is correct, but create-and-invite writes no permission role and no scope, so day one is an empty dashboard until two further admin visits | M | |
| Invited teammate sees the welcome scene | partial | app/api/admin/team/[id]/invite/route.ts:131 | redirectUrl is /overview and admins skip the onboarding gate, so /welcome is unreachable dead copy | S | |
| MailerLite auto-add on onboard | missing | app/api/admin/integrations/mailerlite/route.ts:99 | Stub returns success without calling MailerLite, and no onboarding path calls it | S | |
| First-visit product tour | partial | components/tahi/product-tour.tsx:17 and :44 | Targets [data-tour="overview-kpis"], which nothing emits, so step one clamps to the corner under a dim backdrop on whatever page the user landed on | S | |
| Kanban defaults come from settings | partial | app/api/portal/provision/route.ts:130, app/api/admin/clients/route.ts:196 | Both hardcode six columns instead of reading the configured global set, and neither matches the seven in CLAUDE.md | S | |
| Onboarding lead is the assigned PM | partial | app/(onboarding)/onboarding/page.tsx:93 | Face, name and welcome note fixed to Liam even when a PM rule assigns someone else | S | |
| Studio credentials configurable in-product | partial | lib/email.ts:29, app/api/portal/checkout/route.ts:84 | Stripe keys, Resend key and sender are env only, seven routes hardcode the From, and plan prices exist only after a manual setup-plans call | S | |
| Deal conversion sets plan, currency and org | partial | app/api/admin/deals/[id]/convert-to-client/route.ts:134 and :88 | Defaults every retainer to maintain, ignores deal.currency, and a linked contact with no orgId is orphaned when the org is created | S | |
| Brand assets capture | partial | app/api/portal/brands/route.ts:24, components/tahi/settings/sections/org.tsx:126 | Logo, colour and brand rows work in settings; there is no onboarding step and the checklist CTA points at the dead /files page | M | |
| Billing-mode branching (pay now, invoiced, external) | partial | components/tahi/onboarding-content.tsx:92, lib/onboarding-entry.ts:76 | Handled by invite personas rather than a billingMode column; the missing case is an invited retainer, shown hardcoded plan cards instead of their customMrr | M | |
| Tracks provisioned on the paid path | partial | app/api/portal/checkout/route.ts, lib/plan-utils.ts:146 | Checkout inserts no track rows; entitlement-derived lanes cover every surface except two legacy readers, so the portal home says "No active tracks yet" | S | |
| MCP parity for onboarding invites | missing | workers/mcp-server/src/index.ts (no invite tool) | CLAUDE.md rule 14 requires it, and it matters more here because the UI does not exist either | S | |

### Flow: roles

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Deny-by-default resolution and org scoping | works | lib/permissions.ts:122, lib/access-scoping.ts:39 | Roleless resolves to an empty viewable set; scoping fails closed. 31 unit tests pass | | |
| Team invite to role and scope inheritance | works | app/api/admin/team/[id]/invite/route.ts:124, lib/team-link.ts | Clerk invite plus verified-email roster claim | | |
| Middleware admin-route list vs FEATURE_TREE | works | app/(dashboard)/deals/page.tsx:12 and 22 similar guards | 23 of 24 team-only routes redirect clients at the server component; /tasks renders an empty shell instead | S | |
| Admin API routes enforce role, not just Clerk org | partial | app/api/admin/billing/financial-health/route.ts:22, lib/api-route.ts:104 (zero callers) | 246 of 364 admin route files gate only on Tahi-org membership, so any seat can read financial health, exports, reports, leads and deals directly. The nav hides them, the API does not | L | B |
| Admin pages honour the permission level | partial | app/(dashboard)/invoices/page.tsx:11, reports/page.tsx:10 | Only 10 of 51 dashboard pages call requirePageFeature, so a task_handler still renders the full financial surface | M | B |
| Roleless team member is coherent | partial | lib/permissions.ts:323, components/tahi/settings/team-access/subject-detail.tsx:68 | Resolver denies every feature while the builder labels it "No role (full admin)" and the seed says the same, so the owner is told the opposite of what happens | S | B |
| Client feature_visibility denies are enforced | missing | lib/permissions.ts:245; zero requireFeature under app/api/portal | Denying a client org a feature removes it from their nav only; a deep link or direct fetch still serves the data | M | B |
| Client nav items that bounce | missing | components/tahi/nav-model.tsx:113,127,128 vs schedules/contracts/proposals page.tsx redirects | Three of eight client nav entries silently throw the client back to Requests | M | B |
| Client member vs client admin split | partial | components/tahi/nav-model.tsx:126, app/api/portal/invoices/route.ts:38 | Invoices is shown to member seats that the API 403s; a per-contact feature_visibility override already covers it with no code change | S | |
| Client viewer (read-only) seat | partial | components/tahi/settings/sections/people.tsx:13 | Intentionally not offered, and ManyRequests has no read-only client seat either | S | |
| Portal invites skip the admin check | partial | app/api/portal/invites/route.ts:14 vs people/route.ts:44 | Any member seat can invite colleagues from the onboarding step while the People surface refuses them | S | |
| Two competing team role systems | partial | db/schema.ts:1530, lib/access-scoping.ts:96 | /team writes an access role that only the PM lookup reads; /permissions writes the real one. Two surfaces claim to be the role control | M | |
| Track-type scoping | missing | app/api/admin/team/[id]/access/route.ts:125 | Written by two UIs, read by nothing | M | |
| Field restrictions | missing | db/schema.ts:290 | A per-field denial table with zero readers | M | |
| Action-level permissions (create, edit, delete) | partial | lib/permissions.ts:341 (filters action='view') | v2 by decision (SPECS/redesign/05-permissions.md:441). Escalation paths and data writes are still admin-gated and org-scoped | L | |
| Preview-as-team-member | partial | components/tahi/impersonation-banner.tsx:128 | Client view sets a real server-read cookie; team-member view is client-side only, so a role cannot be verified before granting it | M | |
| Workspace settings writes | partial | app/api/admin/settings/route.ts:32 | Any Tahi identity can upsert module toggles, branding, plan pricing and finance keys; the settings permission rows are never consulted | S | |
| Plan to feature entitlement template | partial | lib/plan-catalog-shared.ts:43, app/api/admin/permissions/copy-access/route.ts:22 | Track entitlements are enforced per plan; the portal feature set is identical across plans and per-org divergence is hand-authored or cloned | M | |
| Contractor scoped access | partial | app/api/admin/permissions/assign-role/route.ts:19, lib/access-scoping.ts:96 | task_handler plus specific_clients works end to end in 68 routes; the residue is the unenforced 'own' scope and the inert isContractor flag | M | |

### Flow: requests_tasks

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Submit, triage, status, deliver, client review, approve | works | app/api/portal/requests/[id]/review/route.ts:36, request-detail.tsx:1784 | Audited 2026-09-03; both audiences complete the loop | | |
| Plan-gated request size | works | app/api/portal/requests/route.ts:190 and :265 | Server re-checks the plan on POST, not just in the browser | | |
| Request size drives the track | works | lib/track-lanes.ts:64, app/api/portal/capacity/reorder/route.ts:112 | type is the size vocabulary; large work is refused by small lanes | | |
| Sub-requests, checklists and step rollups | works | components/tahi/kanban-board.tsx:1285, capacity-strip.tsx:571 | Server-side rollups for both audiences with a documented precedence rule | | |
| Blocked-task warning | works | app/(dashboard)/tasks/tasks-content.tsx:1842 | Advisory by design in every path, including the human one | | |
| Scope flag and re-quote | works | app/api/admin/requests/[id]/scope-flag/route.ts:39, invoice-list.tsx:419 | Flag, banner, badges and manual re-quote all present; invoice items carry no requestId | S | |
| Clients do not see tasks | works | DECISIONS.md:520 and :955, app/api/portal/requests/[id]/steps/route.ts:14 | Deliberate; the client channel is request steps. /tasks needs a non-admin redirect and a subtitle fix | S | |
| Timer on a task logs time | partial | app/api/admin/timers/route.ts:182, lib/timer-helpers.ts:126 | orgId is persisted null for task timers, stop hits no_org_id, the time entry is skipped and the timer row is deleted anyway while the UI toasts success. Hours tracked from the Tasks page are destroyed | S | B |
| Timer switch attributes to the right client | partial | app/api/admin/timers/route.ts:171 | Auto-stopping the previous timer passes the new target's org, so switching clients files A's hours against B | S | |
| Task completion moves the request | missing | app/api/admin/tasks/[id]/route.ts:148, app/api/admin/requests/[id]/route.ts:272 | Completing the last task does not advance the request, and delivering a request leaves its tasks open. The two halves only meet in a read-only list | M | |
| Request assignment notifies | partial | app/api/admin/requests/[id]/route.ts:239, bulk-assign/route.ts | Neither PATCH, bulk assign nor participants notifies anyone; PM and follower roles are decorative | S | |
| Subtasks typed at task creation are saved | partial | app/api/admin/tasks/route.ts:190, tasks-content.tsx:2563 | The dialog posts subtasks that the handler ignores, so UI and MCP produce different tasks from the same template | S | |
| Track occupies and frees | partial | db/schema.ts:401, app/api/portal/tracks/route.ts:74 | tracks.currentRequestId is write-dead, so the portal home, the track meter and the client detail list all say "open" while work is in flight; the status-derived surfaces are correct | M | |
| Capacity reflects work in flight | partial | app/api/admin/capacity/start-date/route.ts:63 | Committed hours are a constant per plan; no request, estimate, task or logged hour moves the forecast | M | |
| Delivered work in profitability and retainer health | partial | app/api/admin/reports/client-profitability/route.ts:96 | Both roll-ups inner join requests, dropping every hour logged against a task or a client directly | S | |
| Revision counter | partial | db/schema.ts, app/api/portal/requests/[id]/review/route.ts:96 | revisionCount has no writer, so the chip never renders; scope creep is flagged by hand instead | S | |
| Non-AI writer of tasks.requestId | partial | request-detail.tsx:3247, tasks-content.tsx:2477 | Only the AI wizard links a task to a request; both server sides already accept requestId | S | |
| Task-level automation triggers and webhooks | partial | lib/events.ts:23 | No task_* event type, so rules and webhooks see only request-level delivery | M | |
| End-to-end loop regression test | partial | e2e/ (no tasks spec), lib/timer-helpers.test.ts | Seams have unit and route coverage; nothing walks submit to approve, and the timer org derivation that loses data is untested | M | |

### Flow: billing

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Self-serve retainer checkout | works | app/api/portal/checkout/route.ts:143, onboarding-payment.tsx:146 | Inline PaymentElement, six presentment currencies, prior incomplete subs cancelled | | |
| Xero import, payment sync and webhook | works | app/api/webhooks/xero/route.ts:241, lib/xero-sync.ts:695 | Signature verified, payments reconciled | | |
| Admin invoice operations | works | app/(dashboard)/invoices/[id]/invoice-detail.tsx:277, app/api/admin/invoices/[id]/route.ts:145 | Create with line items, Stripe link, Xero draft with NZ GST, mark paid | | |
| Stripe customer creation | works | app/api/portal/checkout/route.ts:96, app/api/admin/integrations/stripe/provision/route.ts:82 | Minted wherever money is first taken, plus an admin mint and import-time linking | | |
| Currency switcher and stored amounts | works | lib/currency.ts, lib/__tests__/currency.test.ts | 17 tests pass; one admin KPI sums mixed currencies and labels it NZD | S | |
| Client billing self-service (Stripe portal) | works | components/tahi/settings/sections/plan.tsx:226, app/api/portal/billing/session/route.ts:59 | Reachable from the sidebar for org admins with a Stripe customer | | |
| Client opens a specific invoice | missing | app/api/portal/invoices/ (list only), invoice-detail.tsx:100 | No portal detail route and the page always fetches the admin API, so every client row click 403s | M | B |
| Client pays a specific invoice | partial | invoice-list.tsx:225, db/schema.ts:730 | The Stripe hosted URL is copied to the operator's clipboard and discarded, and no column stores it, so no per-invoice pay CTA can exist for the client | M | B |
| Invoice email is fit to send | partial | app/api/admin/invoices/[id]/send-email/route.ts:45 and :75 | One contact, inline HTML instead of emails/invoice-sent.tsx, no pay link, no PDF, and the CTA lands on the 403 page. No UI button calls it | S | B |
| "Invoice me" net terms | missing | onboarding-payment.tsx:174, app/api/onboarding/complete/route.ts:96 | Advances to the end, fires complete, gets 402, and the layout bounces the client back into onboarding forever. No preference recorded, no invoice raised, nobody told | M | B |
| Draft invoice notifies the client | partial | app/api/admin/invoices/route.ts:174, app/api/portal/invoices/route.ts:61 | Creating a draft pings every client contact about an invoice the portal filters out and whose link 403s | S | B |
| Overdue detection and dunning | partial | app/api/webhooks/stripe/route.ts:166 | Nothing flips 'sent' past its due date; the UI derives overdue at read time, so only the AI briefing and reports under-report | S | |
| Receivables aging | partial | app/api/admin/reports/invoice-aging/route.ts:66 | Filters status='sent', so anything already marked overdue drops out of every bucket and the outstanding total | S | |
| auto_generate_invoices scope and currency | partial | app/api/admin/billing/xero-export/route.ts:75 and :118 | Groups every billable hour with no plan filter, so retainer clients get spurious hourly drafts, and currency is hardcoded NZD | S | |
| Custom retainer (customMrr) billing | partial | app/api/portal/checkout/route.ts:35, lib/stripe-plans.ts | No Stripe price, subscription or schedule is keyed to customMrr; billable in-product but manually each cycle | M | |
| Admin retainer changes reach Stripe | partial | app/api/admin/subscriptions/[id]/route.ts:132 | Plan, cycle and add-on edits write D1 only, so the charge silently diverges from what the portal shows | M | |
| GST on the Stripe paths | partial | app/api/portal/checkout/route.ts:180 | No Stripe path sets tax, and billingCountry is inferred from presentment currency. The Xero path issues compliant tax invoices | S | |
| Invoice numbering | partial | db/schema.ts:730, invoice-detail.tsx:179 | No number column; labels are uuid fragments of two different lengths, the settings prefix is dead, and the portal shows a hex string matching nothing the client received | S | |
| Receipt or payment confirmation | partial | app/api/webhooks/stripe/route.ts:105 | No receipt email and no bell row; the client sees the status flip and can pull PDFs from the Stripe portal | S | |
| Refunds and credit notes | missing | lib/stripe-sync.ts:104 | No refund, credit note or partial-credit path anywhere; a refunded invoice stays paid | M | |
| One-off project invoicing links to the engagement | partial | app/api/admin/invoices/[id]/route.ts:38 | invoices.projectId is read and never written, and there is no deal-to-invoice generation | M | |
| Orderable catalogue, add-ons, top-ups, coupons | partial | services-content.tsx:606, app/api/admin/services/coupons/route.ts:51 | The portal catalogue has no buy CTA, services are global with no per-org attachment, and coupons are write-only | M | |
| Money-path test coverage | missing | lib/__tests__/, e2e/ | Nothing covers the Stripe webhook, checkout, stripe-create, GST or the invoice routes | M | |

### Flow: comms

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| Notification identity, SSE stream and bell | works | lib/notifications.ts:80, app/api/notifications/stream/route.ts:35 | Typed recipients resolve to Clerk ids for both audiences | | |
| Payment received | works | app/api/webhooks/stripe/route.ts:115, app/api/portal/invoices/route.ts:59 | Webhook marks paid, the client sees Paid, invoice_paid is an automation trigger | | |
| Internal-note boundary | works | components/tahi/message-composer.tsx:199, app/api/admin/requests/[id]/messages/route.ts:215 | Mentions can only resolve to team members; client fan-out is gated on isInternal | S | |
| Mention affordance gating | works | components/tahi/message-composer.tsx:663 | Internal toggle is admin-only at both call sites | | |
| Request-thread deep link | works | lib/notification-links.ts:75 | Resolves to an existing request page for both audiences | | |
| Scheduled jobs reach the app | missing | .github/workflows/dashboard-crons.yml:173, ai-briefing-cron.yml:47 | Both workflows build $base/dashboard/api/... while the app serves at the root, so every cron (digests, sweeps, syncs) POSTs to a 404 | S | B |
| Client message or review verdict reaches the team | partial | app/api/portal/requests/[id]/messages/route.ts:93, review/route.ts:128 | Notifies only the assignee, so an unassigned request (the state right after submission) means the client's message lands in silence | S | B |
| Notification deep links per audience | partial | lib/notification-links.ts:417, invoice-detail.tsx:115 | One route map for both audiences, so client notifications point at admin surfaces that 403 or redirect | M | B |
| Lifecycle email dispatcher | partial | emails/new-request.tsx, emails/request-delivered.tsx (no importers) | Request submitted, delivered and review-requested send no email; the templates exist and the automation engine withholds send_email by design | M | |
| New request reaches the team (push) | partial | app/api/portal/requests/route.ts:376 | Only a domain event; the team sees it as a Triage badge on the board rather than a notification | S | |
| Request watchers and participants | partial | app/api/admin/requests/[id]/participants/route.ts:19 | Adding a PM or follower notifies nobody; only the mirrored assignee gets later messages | S | |
| Invoice overdue notification | partial | app/api/webhooks/stripe/route.ts:166, notifications.tsx:54 | No cron fires it, and the settings toggle describes an event no code path honours | S | |
| Announcement unsubscribe and bell row | partial | lib/announcement-emails.ts:104 | Bulk email with no unsubscribe link, no bell row, and no way for a client to mute it | S | |
| Email and Slack preference channels | partial | lib/notification-preferences.ts, lib/automation-executor.ts:40 | Every email and Slack toggle is inert because no send path consults them, and the automation builder offers actions the executor always refuses while logging success | M | |
| Slack team notifications | missing | lib/slack-notify.ts:19 (zero call sites) | Fully written, reads channel config, never invoked, promised in CLAUDE.md and the settings UI | M | |
| Quiet hours | partial | app/api/portal/notifications/route.ts:26 | Stored for both audiences, read by nothing | S | |
| Review and testimonial outreach send | partial | app/api/admin/reviews/outreach/route.ts:59 | Mints tokens as not_sent and never sends them, so the public review page waits for a link nobody delivers | S | |
| Daily briefing and digests | partial | app/api/admin/cron/daily-summary/route.ts:230 | Sales-only, in-app only, to one resolved person; no per-member or client digest despite the toggles | M | |
| Sender identity | partial | app/api/admin/deals/[id]/nudges/route.ts:106, ai-reply-drafts/[id]/send/route.ts:142 | Four From identities, two hardcoding the founder's name, so anyone else sends as Liam | S | |
| Proposal accept and contract signature notifications | missing | app/api/public/proposals/[token]/accept/route.ts | Acceptance and partial signatures notify nobody; four declared notification types never fire | M | |
| Notifications page | partial | components/tahi/notification-bell.tsx, no /notifications route | Bell only, and unreadCount is computed from the 20 fetched rows so it undercounts | S | |
| Notification test coverage | partial | lib/notification-preferences.ts, lib/announcement-emails.ts | Preference filtering, automation fan-out, announcement email and the SSE route are untested | M | |

### Flow: migration

| Step | Status | Evidence | Gap | Effort | B |
|---|---|---|---|---|---|
| White-label portal settings | works | components/tahi/settings/sections/branding.tsx:11, app/(dashboard)/layout.tsx:128 | Portal name, colour and logo applied for client sessions | | |
| Reports, modules, brands, uploads, notification identity | works | reports-content.tsx:1000, lib/upload-access.ts:1 | At or above ManyRequests on each | | |
| ManyRequests read access | partial | workers/mcp-server/src/index.ts:112 and :1559 | Orgs, clients, members, brands, services and invoices are readable; requests, comments and files need endpoints added to the same generic client | S | |
| ManyRequests to D1 importer | partial | no script or route reads MR and writes D1 | None exists, but the real volume is 20 orgs, 4 subscribed, about 44 contacts and 15 open requests, and read plus write tools already exist | S | |
| Migrated client gets a working login | missing | app/api/admin/onboarding-invites/route.ts:38 (no product caller) | No operator motion issues a migrated client their link. See the onboarding invite rows | M | B |
| Link an existing D1 org to a Clerk org from the admin side | partial | app/api/portal/accept-invite/route.ts:116, provision/route.ts:96 | Both writers are client-initiated; accept-invite creates a second Clerk org rather than adopting an existing one | M | |
| Client file browser | missing | app/(dashboard)/files/page.tsx:22, app/api/portal/files/route.ts:52 | The client-only Files page renders a literal empty state and never calls its own correct, org-scoped API | S | B |
| Committed ManyRequests API token | partial | workers/mcp-server/src/index.ts:99 | A live bearer token for the platform holding all real client data is in git history. Safe only if the token dies at cutover, not if the platforms run in parallel | S | B |
| Client messaging (org channels and DMs) | partial | app/(dashboard)/messages/page.tsx:10, TASKS.md:65 | Built then deliberately hidden for V1; request threads carry client comms. Residue: "Start DM" creates orphan conversation rows before redirecting away | S | |
| Cutover QA gate | partial | app/api/__tests__/admin-scoping-routes.test.ts:195 | Route-level cross-org tests pass over a fake D1; no seeded two-org Playwright run, so a migration-induced org mapping error would not be caught | S | |
| Adoption signal (last login) | partial | db/schema.ts:115, contact-detail.tsx:265 | lastLoginAt is read and never written; clerkUserId gives a coarse "has portal access" proxy | S | |
| Per-request tags | partial | db/schema.ts:459 | requests.tags has no writer; the MR portal returns zero tags, and category covers classification | S | |
| Priority granularity | works | lib/request-vocabulary.ts:54, DECISIONS.md:1025 | Two levels by decision; MR has 11 of about 257 requests with any priority, all closed | | |
| Flat client and contact directory | partial | app/api/admin/search/route.ts:145, no collection route | Cross-org lookup exists in the palette and the permissions pane; there is no browsable list, and deal-detail.tsx:2235 fetches a route that does not exist | S | |
| Client onboarding page builder | partial | app/api/portal/onboarding/route.ts:20 | Per-org checklist state and a Loom field exist with no authoring surface, so the first screen is fixed in code | M | |
| Domain, sender and parallel run | partial | lib/app-url.ts, wrangler.json | Sender is implemented; the old host redirect is a DNS action outside this repo; no mirror or sync exists, which suits replacement rather than dual running | S | |
| Notifications page | partial | see comms | MR ends its bell in an All Notifications page; this has the bell only | S | |

## 3. User type by plan type

Legend: E = enforced server-side, D = data-only (stored, no effect), M = missing. Most enforcement here is plan-independent; the plan columns differ only where noted.

| User type | Project (one-off) | Maintain | Scale | Custom retainer | Hourly / none |
|---|---|---|---|---|---|
| Tahi super_admin (Liam, Staci) | E | E | E | E | E |
| Tahi admin | E | E | E | E | E |
| Team member with a role | E on nav and 10 pages, D on 246 admin routes | same | same | same | same |
| Roleless team member | M (nav denies all, API allows all) | same | same | same | same |
| Contractor | E via task_handler plus specific_clients; isContractor D | same | same | same | same |
| Client org admin (primary contact) | E on money routes, D on portalRole at creation | E | E | E | E |
| Client member seat | E on money routes only; nav shows Invoices it cannot open | E | E | E | E |
| Client second seat (Clerk-invited) | M (no linked identity, no notifications, no role) | M | M | M | M |
| Public token viewer (proposal, contract, schedule, review) | E | E | E | E | E |

Plan-driven entitlements, separately: track counts and the large-task gate are E for maintain and scale (server re-checked on POST), D for custom, hourly and none (planType stored, zero tracks derived). The portal feature set is identical across all plans (M: no plan-to-feature template; per-org divergence is hand-authored or cloned via copy-access). Billing automation is E for maintain and scale (Stripe), D for custom (customMrr never reaches Stripe), and manual for project and hourly.

## 4. ManyRequests parity and cutover

| Capability | ManyRequests | Dashboard | Verdict |
|---|---|---|---|
| Client requests, board, statuses | yes | yes, deeper (tracks, sub-requests, steps, checklists) | ahead |
| Request comments and attachments | yes | yes, per request | at parity |
| Client file browser | yes, per org with folders | page renders a hardcoded empty state | behind, blocker |
| Client invoice list | yes | yes, org-scoped, drafts filtered | at parity |
| Client invoice detail and pay | yes | detail 403s, no stored pay link | behind, blocker |
| Client messaging (org channel, DMs) | yes | built then hidden for V1; request threads carry comms | behind by decision |
| Client login and invites | yes | server complete, no product caller, no email | behind, blocker |
| Orgs, brands, members | yes | yes, plus per-contact roles | ahead |
| Services catalogue and ordering | yes, orderable with top-ups and coupons | display-only, coupons write-only | behind |
| Credits | yes | none | behind |
| Team and roles | basic | granular roles, scopes and a builder | ahead |
| Time tracking | yes | yes, plus timers (with the org bug) | at parity |
| Reports | yes | yes, plus response time and utilisation with CSV | ahead |
| Kanban customisation | no | per-client columns | ahead |
| Intake forms | yes | yes, resolution priority per org and category | ahead |
| Announcements | no | yes, with email delivery | ahead |
| White-label portal | yes | yes | at parity |
| Module toggles | yes | yes | at parity |
| Notifications bell | yes, with an All Notifications page | bell only | slightly behind |
| Last login on contacts | yes | column read, never written | behind |
| Per-request tags | field exists, unused in the live portal | column exists, never written | at parity in practice |
| Priority levels | 4, used on 11 of about 257 requests | 2 by decision | at parity in practice |

Cutover steps, in order:
1. Ship Tier 1 (below), especially invite delivery, portal invoice detail and pay, the dead client surfaces and the cron URL.
2. Close the MCP /authorize door and rotate the ManyRequests token, before any real client data moves.
3. Freeze ManyRequests writes and take a read snapshot of the 20 orgs, about 44 contacts, 4 subscriptions and 15 open requests using the existing MR read tools.
4. Create or reconcile each org in D1 with customMrr, preferredCurrency and a Stripe customer, then re-create the 15 open requests. Invoice history comes from Xero and Stripe, not ManyRequests.
5. Mint and email an invite per primary contact, then per additional seat, and confirm each org shows "has portal access".
6. Run one real client end to end: log in, submit a request, receive a delivery, approve it, open an invoice, pay it.
7. Point dashboard.tahi.studio at the new portal, keep ManyRequests readable as an archive for 30 days with its token rotated, then delete the token.
8. Watch the first week on the notification bell and the crons, since neither has automated coverage yet.

## 5. Ship plan

### Tier 1: before cutover (26 blocker steps, 19 items)

1. Client invite: mint from the client detail page, email the link, expose an MCP tool. app/api/admin/onboarding-invites, clients/[id]/client-detail.tsx, emails/. M
2. Welcome email becomes the invite and fires on client creation, using emails/welcome.tsx. app/api/admin/clients, welcome-email route. S
3. Portal invoice detail route plus a persisted hosted pay URL and a client pay CTA. app/api/portal/invoices/[id], invoice-detail.tsx, db/schema.ts invoices. M
4. Invoice email: all billing contacts, the real template, a pay link, no 403 CTA, and a UI button that sends it. app/api/admin/invoices/[id]/send-email. S
5. Stop notifying clients on draft invoice creation; notify on send. app/api/admin/invoices/route.ts. S
6. "Invoice me" records the preference, raises a draft, notifies the studio and lets onboarding complete. onboarding-payment.tsx, api/onboarding/complete. M
7. Link the second client seat: a linkContactOnSignIn twin of the team-link module, and make portal/invites write the contact row. lib/team-link*, app/(dashboard)/layout.tsx, app/api/portal/invites. M
8. Set portalRole admin on the first contact at provision, accept-invite and admin create. app/api/portal/provision, accept-invite, app/api/admin/clients. S
9. Wire the client Files page to its existing API. app/(dashboard)/files. S
10. Remove or build the three dead client nav items and settle the /billing matcher. components/tahi/nav-model.tsx, middleware.ts. S
11. Fix the cron base URL in both workflows. .github/workflows/*.yml. S
12. Fix the task timer org derivation and surface logged:false instead of a success toast. app/api/admin/timers, lib/timer-helpers.ts, tasks-content.tsx. S
13. Audience-correct notification deep links, and fan client messages and review verdicts beyond the assignee. lib/notification-links.ts, app/api/portal/requests/[id]/messages and review. M
14. Close the worker MCP /authorize auto-approval. workers/mcp-server/src/index.ts. M
15. Rotate the committed ManyRequests token and move it to a secret. workers/mcp-server/src/index.ts. S
16. Enforce role on the money and client-data admin routes (financial health, exports, reports, invoices, clients, deals, leads) and guard the 41 unguarded pages. lib/require-feature.ts, lib/page-guard.ts, app/api/admin/**. L
17. Make roleless mean deny everywhere and say so in the builder and the seed text. lib/permissions.ts, team-access/subject-detail.tsx. S
18. Enforce client feature_visibility on portal routes, not just nav. app/api/portal/**, lib/permissions.ts. M
19. Render the first-run checklist (set ctx.home) or delete it and its API, and make the kickoff step write a scheduledCalls row with an email. overview-home.tsx, client-home.tsx, onboarding-content.tsx. M

### Tier 2: first month after cutover

Admin client creation captures customMrr, currency and a Stripe customer (app/api/admin/clients). New hire day one grants a role and a scope at invite time (app/api/admin/team). Overdue cron plus dunning, and the aging report stops excluding overdue (app/api/admin/cron, reports/invoice-aging). Receipt email and an in-app payment confirmation (emails/, webhooks/stripe). Invoice numbering column and consistent labels (db/schema.ts, invoice surfaces). GST on the Stripe paths (app/api/portal/checkout, invoices/stripe-create). auto_generate_invoices filtered by billing model with per-org currency (billing/xero-export). Custom retainer billing automation (lib/stripe-plans, admin/subscriptions). Admin retainer edits propagate to Stripe (admin/subscriptions/[id]). Task and request status coupling both ways (admin/tasks/[id], admin/requests/[id]). Capacity from real work instead of plan constants (admin/capacity). tracks.currentRequestId derived or written (portal/tracks, track-meter.tsx). Revision counter writer (portal review route). Save subtasks posted at task creation (admin/tasks). Assignment and participant notifications (admin/requests, participants). Lifecycle email dispatcher for submitted, delivered and review (lib/notifications, emails/). Slack team notifications wired (lib/slack-notify). Honour email, Slack and quiet-hours preferences (lib/notification-preferences). Notifications page and an accurate unread count (app/(dashboard)/notifications). Onboarding details step persists company, role and timezone (onboarding-content.tsx, portal/organisation). Kanban defaults read from settings (provision, admin/clients). Deal conversion currency, plan and orphan contact fix (deals/[id]/convert-to-client). Sender identity from settings (lib/email, the seven hardcoded routes). Review outreach actually sends (admin/reviews/outreach, emails/review-request). MailerLite on onboard (integrations/mailerlite). Money-path Vitest and a two-org tenancy Playwright run (lib/__tests__, e2e/). Product tour targets (product-tour.tsx). Last login writer (the same sign-in hook as the contact link). Remaining admin-route enforcement tail (app/api/admin/**).

### Tier 3: later, and the founder's named nice-to-haves

Contracts and proposals as client-facing surfaces, plus their accept and signature notifications (app/(dashboard)/contracts, proposals, app/api/public/*). Orderable service catalogue with add-ons, top-ups, credits and coupon redemption (app/(dashboard)/services, app/api/portal/checkout). Refunds and credit notes (lib/stripe-sync, invoices). Un-hide messaging with org channels and DMs, or delete the surface (app/(dashboard)/messages). Client onboarding page builder (app/api/portal/onboarding, settings). Multi-org switcher for a contact at two clients (sidebar-user-card). Action-level permissions v2 and field restrictions (lib/permissions, db/schema.ts:290). Track-type scoping readers (lib/access-scoping). Server-side preview-as-role (impersonation). Per-request tags or delete the column (db/schema.ts:459). Merge the two team role systems (team-content, permissions builder). Flat contact directory page and the missing /api/admin/contacts collection (deal-detail.tsx:2235 depends on it). ManyRequests importer if the legacy archive turns out to matter. Delete dead code: /welcome team scene, onboarding-checklist.tsx, monthly billing email, HubSpot integration card, '/demo' matcher.

## 6. Refuted claims (do not re-report)

- Contractor access model is missing: false, task_handler plus specific_clients is enforced in 68 routes; only isContractor is inert.
- Team welcome flow strands hires: false, hires arrive by Clerk invite to /overview; /welcome is unreachable dead code.
- Portal renders an empty shell when the Clerk org has no D1 link: false, unreachable from any in-app flow and the null-org case self-heals.
- Password reset and verification are unbranded and untested: false, both are styled and the verification half runs in the persona e2e.
- Dead '/demo' matcher is an auth hole: false, no such route exists and layout plus routes self-authenticate.
- HubSpot contact sync is missing: false, HubSpot was explicitly replaced by the internal CRM (DECISIONS #026, #027); only a stale settings card remains.
- client_onboarded cannot send email: false, the welcome email sends from a button and an MCP tool; send_email is withheld from automations by design.
- Onboarding checklist completion is manual and mis-labelled: false, completion is entitlement-derived and the panel never renders.
- create_task_from_template hardcodes requestId: false, no UI calls that route; request-linked creation works through the wizard.
- Request size does not drive the track: false, type drives routing end to end and is unit tested.
- Clients cannot see their tasks: false by decision, clients see request steps; tasks are internal (DECISIONS #030, #046).
- Scope change cannot be re-quoted: false, hours per request plus manual invoice line items cover it, and MR has no scope flag at all.
- Blocked tasks can be completed anyway: false, dependencies are advisory in every path including the human one.
- Work breakdown does not roll up: false, sub-requests and steps both roll up server-side with a documented precedence.
- Track model does not exist: false, lanes are derived from request status; only tracks.currentRequestId is write-dead.
- Team invite link (flow team) is broken: false, the Clerk invite path supersedes the token flow for hires.
- Middleware admin-route list leaks team pages: false, 23 of 24 have server-component guards.
- Tracks are broken for custom plans: false, the Tracks page uses capacity and renders configured lanes with an explanatory empty state.
- Stripe customer creation on onboarding is partial: false, customers are minted wherever money is first taken.
- Currency handling is two disconnected systems: false, display and charge share one constant; one mixed-currency admin KPI needs a label fix.
- Client billing self-service is undiscoverable: false, Settings, Plan and billing carries the Stripe portal button.
- Stripe pay link is discarded entirely: partly false, the admin can re-derive and copy it; what is missing is persistence and a client-facing CTA.
- Payment received produces no confirmation: false, the invoice flips to Paid in the client's own list and invoice_paid is an automation trigger.
- Message thread deep link dead-ends: false for request threads, which are the live channel.
- Internal notes can leak through mentions: false, mentions can only resolve to team members from every real producer.
- Mention affordance is shown to clients: false, it is gated on canBeInternal at both call sites.
- Monthly billing email is an orphaned client feature: false, it is an internal digest to one address and the real path is auto_generate_invoices.
- Notifications and unread badges are missing: partly false, per-thread unread state is rendered from lastReadAt; only the full page is absent.
- Priority granularity is a parity gap: false, MR uses priority on 11 of about 257 requests, all closed.
- Teammate welcome link is missing: false, the hire path never touches /welcome.
- ManyRequests data cannot be read programmatically: false, requests, comments and hours were read live this session through the MR connector.
- Clerk backfill does not exist: partly false, the team-member half is built and tested; only the contact half is missing.
- Cutover has no tenancy gate: partly false, route-level cross-org tests exist and pass; the seeded two-org e2e does not.

## 7. Coverage per lens

- auth: middleware, server-auth, team-link, portal-access, permissions, both auth pages, onboarding and welcome scenes, dashboard layout, and 20 entry-path routes. Mechanical counts: 110 of 364 admin route files carry a guard; 10 of 51 pages call requirePageFeature; 2 code paths write contacts.clerkUserId.
- onboarding: both onboarding scenes and every step component, the checklist and tour, 18 onboarding-related routes, five settings sections, plus the team and client-detail entry points.
- roles: schema role tables, resolver, feature tree, scoping, page and route guards, the whole team-access builder, migration seeds 0041 and 0078, and 25 route handlers. lib/permissions.test.ts run: 31 pass.
- requests_tasks: schema for requests, tracks, tasks, steps, participants, timers and time entries; every admin and portal task and request route; timer helpers; capacity and three reports; the tasks page and the request-detail seams. Requests internals excluded per instruction.
- billing: every invoice, billing, subscription, service, checkout, webhook and cron route in the money path, the Stripe and Xero libs, both invoice surfaces, the onboarding payment step and the MCP billing tools.
- comms: the notification and event libs, every createNotification and Resend call site, all 13 email templates checked for importers, both cron workflows, the bell and SSE, and the seams at requests, invoices, proposals, contracts and onboarding. 12 of 28 declared notification types are never fired. notifications-resolve tests run: 10 pass.
- migration: MANYREQUESTS_REFERENCE.md in full, the worker MR client and tool set, all 40 portal routes, the client-facing pages, uploads, webhooks and e2e. Live MR reads confirmed the migration volume at 20 orgs, 4 subscribed, 15 open requests.

Not verified from here: anything requiring a browser, a deployed session, live D1 rows, production env values or DNS. No files were changed, so type-check was not run.
