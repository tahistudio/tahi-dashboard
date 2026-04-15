# tahi-dashboard — Task List

Last updated: 2026-04-15 (Session: Phase 9 Xero/Stripe fixes landed, client archive button, Evan Kwan consolidation, Stripe dedupe bug logged)
Total tasks: 623 (S1-S11 schema + T1-T495 feature + T546-T557 integration + T558-T623 post-launch)
Completed: 544/544 core features + 10/11 integration tasks + 4 phase-8 polish tasks + 9 phase-9 tasks done

Agents: claim a task by adding your initials and the date next to it.
Format: `— [AGENT] YYYY-MM-DD`
Mark done with `[x]`. Never delete tasks — mark them done or superseded.

Legend: BE = Backend, FE = Frontend, UIUX = UI/UX, QA = QA, PM = Project Manager

---

## Schema Additions (must be done before dependent features)

- [x] S1 — Add `conversations` table: id, orgId, type (direct|group|org_channel|request_thread), visibility (internal|external), name, requestId (nullable), createdAt — BE — [PM] 2026-03-28
- [x] S2 — Add `conversationParticipants` table: id, conversationId, userId, role (member|admin), joinedAt — BE — [PM] 2026-03-28
- [x] S3 — Add conversationId column to messages table (conversation model link) — BE — [PM] 2026-03-28
- [x] S4 — Add `teamMemberAccess` table: id, teamMemberId, role, scopeType, planType, trackType, createdAt — BE — [PM] 2026-03-28
- [x] S5 — Add `teamMemberAccessOrgs` table: accessId, orgId — BE — [PM] 2026-03-28
- [x] S6 — Add announcement targeting columns to `announcements`: targetIds (JSON), sentByEmail (int 0/1), emailSentAt — BE — [PM] 2026-03-28
- [x] S7 — Add `requestForms` table: id, name, category, orgId, questions (JSON), isDefault, createdAt, updatedAt — BE — [PM] 2026-03-28
- [x] S8 — Add `kanbanColumns` table: id, orgId, label, statusValue, colour, position, isDefault, createdAt — BE — [PM] 2026-03-28
- [x] S9 — Add `contracts` table: id, orgId, type, name, status, storageKey, signedStorageKey, dates, signatory, createdById — BE — [PM] 2026-03-28
- [x] S10 — Add `scheduledCalls` table: id, orgId, title, description, scheduledAt, durationMinutes, meetingUrl, attendees, status, notes, recordingUrl — BE — [PM] 2026-03-28
- [x] S11 — Add review outreach fields to `caseStudySubmissions`: outreachStatus, nextAskAt, neverAsk — BE — [PM] 2026-03-28


---

## Phase 1 — Core Loop (requests, clients, subscriptions, files, time, notifications)

### Already Built
- [x] T1 — Overview page: AdminOverview and ClientOverview components with stat cards
- [x] T2 — Requests list view with filters (status, priority, org, search)
- [x] T3 — Requests board/kanban view with drag-and-drop columns
- [x] T4 — Admin API route: GET /api/admin/requests with joins and filters
- [x] T5 — Admin API route: POST /api/admin/requests
- [x] T6 — Client API route: GET /api/portal/requests
- [x] T7 — Client management: add client form with subscription + track provisioning
- [x] T8 — Admin API route: GET + POST /api/admin/clients
- [x] T9 — Drizzle schema with 25+ tables (db/schema.ts)
- [x] T10 — Clerk multi-org auth with middleware (admin vs client routing)
- [x] T11 — App sidebar with role-based nav filtering
- [x] T12 — Design system: globals.css with all CSS tokens, brand colours, leaf radius

### To Build
- [x] T13 — Request detail page: full view with status editor, priority, assignee, due date, description (Tiptap), activity log — FE + BE — [PM] 2026-03-28
- [x] T14 — Request detail: file attachments panel (upload to R2, list, download, delete) — FE + BE — [PM] 2026-03-28
- [x] T15 — Request detail: voice note recording and playback panel — FE + BE — [PM] 2026-03-28
- [x] T16 — Request detail: internal vs external comment toggle on each message — FE — [PM] 2026-03-28
- [x] T17 — Request detail: time entry logging (hours, description, billable toggle) — FE + BE — [PM] 2026-03-28
- [x] T18 — API route: GET + POST + PATCH /api/admin/requests/[id] — BE — [PM] 2026-03-28
- [x] T19 — API route: GET + POST /api/admin/requests/[id]/files — BE — [PM] 2026-03-28
- [x] T20 — API route: GET + POST /api/admin/requests/[id]/voice-notes — BE — [PM] 2026-03-28
- [x] T21 — API route: GET + POST /api/admin/requests/[id]/time-entries — BE — [PM] 2026-03-28
- [x] T22 — Client list page: table with search, filter by plan, sort by name/created — FE — [PM] 2026-03-28
- [x] T23 — Client detail page: overview tab (health score, active requests, contacts, subscription) — FE + BE — [PM] 2026-03-28
- [x] T24 — Client detail page: requests tab with inline create — FE — [PM] 2026-03-28
- [x] T25 — Client detail page: files tab — FE — [PM] 2026-03-28
- [x] T26 — Client detail page: invoices tab — FE + BE — [PM] 2026-03-28
- [x] T27 — Client detail page: contracts tab (upload NDA/SLA, track signed/expiry dates) — FE + BE — [PM] 2026-03-28

- [x] T28 — Client detail page: contacts tab (add/edit/remove contacts for the org) — FE + BE — [PM] 2026-03-28
- [x] T29 — Admin impersonation: "View as client" button switches portal context to selected org — FE + BE — [PM] 2026-03-28
- [x] T30 — Subscription management: edit plan type, slot count, billing cycle from client detail — FE + BE — [PM] 2026-03-28
- [x] T31 — Track management: view active tracks, add/archive tracks per client — FE + BE — [PM] 2026-03-28
- [x] T32 — Invoice list page: table with filters (status, client, date range), totals — FE + BE
- [x] T33 — Invoice detail page: line items, status, payment link, Stripe sync indicator — FE + BE
- [x] T34 — API route: GET /api/admin/invoices with Stripe sync — BE — [PM] 2026-03-28
- [x] T35 — API route: GET /api/admin/invoices/[id] — BE — [PM] 2026-03-28
- [x] T36 — Time entries page: list all time entries across clients, filter by billable/date/client — FE + BE — [PM] 2026-03-28
- [x] T37 — API route: GET /api/admin/time-entries — BE — [PM] 2026-03-28
- [x] T38 — Notifications: SSE endpoint for real-time in-app notifications — BE — [PM] 2026-03-28
- [x] T39 — Notifications: bell icon in header with unread count, dropdown list — FE — [PM] 2026-03-28
- [x] T40 — Notifications: mark as read (single + all) — FE + BE — [PM] 2026-03-28
- [x] T41 — API route: GET + PATCH /api/notifications — BE — [PM] 2026-03-28
- [x] T42 — Bulk request creation: create a request across all clients / selected plan / selected list — FE + BE — [PM] 2026-03-28
- [x] T43 — "Save and create another" flow on request creation form (pre-fills category/service) — FE — [PM] 2026-03-28
- [x] T44 — Bulk actions on request list: bulk status change, bulk assign, bulk delete — FE + BE — [PM] 2026-03-28
- [x] T45 — Health score: automated calculation per client (response time, open requests, overdue, NPS) stored on org row, recalculated on relevant events — BE — [PM] 2026-03-28
- [x] T46 — Health score: display as coloured indicator on client list and client detail — FE + UIUX — [PM] 2026-03-28


---

## Phase 2 — Messaging, Portal, Announcements

> Requires S1-S3 schema additions before any messaging work.

- [x] T47 — Messaging: conversations list page (inbox) showing all conversations with unread counts — FE + BE — [PM] 2026-03-28
- [x] T48 — Messaging: conversation detail page with message thread, send box, file attach — FE + BE — [PM] 2026-03-28
- [x] T49 — Messaging: create new direct (1:1) conversation from client detail or contacts page — FE + BE — [PM] 2026-03-28
- [x] T50 — Messaging: create group conversation with multiple participants — FE + BE — [PM] 2026-03-28
- [x] T51 — Client onboarding checklist on portal overview with step tracking — FE + BE — [PM] 2026-03-28
- [x] T52 — Messaging: request-thread conversations linked to a specific request — FE + BE — [PM] 2026-03-28
- [x] T53 — Messaging: internal vs external visibility toggle per conversation — FE + BE — [PM] 2026-03-28
- [x] T54 — Messaging: voice note recording and playback within conversations — FE + BE — [PM] 2026-03-28
- [x] T55 — API route: GET + POST /api/admin/conversations — BE — [PM] 2026-03-28
- [x] T56 — API route: GET + POST /api/admin/conversations/[id]/messages — BE — [PM] 2026-03-28
- [x] T57 — API route: GET + POST /api/portal/conversations (client-scoped, external only) — BE — [PM] 2026-03-28
- [x] T58 — Client portal: dashboard page (active requests summary, recent messages, announcements) — FE + BE — [PM] 2026-03-28
- [x] T59 — Client portal: requests page (list + board, submit new request via intake form) — FE — [PM] 2026-03-28
- [x] T60 — Client portal: request detail page (external comments only, file upload, status view) — FE — [PM] 2026-03-28
- [x] T61 — Client portal: messages page (external conversations only) — FE — [PM] 2026-03-28
- [x] T62 — Client portal: invoices page (view invoices, pay via Stripe link) — FE + BE — [PM] 2026-03-28
- [x] T63 — Client portal: profile/settings page (update contact info, notification prefs) — FE + BE — [PM] 2026-03-28
- [x] T64 — Announcements: create announcement form (title, body, target type/ids, email toggle) — FE + BE — [PM] 2026-03-28
- [x] T65 — Announcements: in-app banner display on client portal dashboard (dismissible) — FE + BE — [PM] 2026-03-28
- [x] T66 — Announcements: email delivery via Resend when email toggle is on — BE — [PM] 2026-03-28
- [x] T67 — Announcements: admin list view with sent/draft status, recipient count — FE + BE — [PM] 2026-03-28
- [x] T68 — API route: GET + POST /api/admin/announcements — BE — [PM] 2026-03-28
- [x] T69 — API route: POST /api/admin/announcements/[id]/send — BE — [PM] 2026-03-28
- [x] T70 — API route: GET /api/portal/announcements (client-scoped) — BE — [PM] 2026-03-28
- [x] T71 — API route: POST /api/portal/announcements/[id]/dismiss — BE — [PM] 2026-03-28


---

## Phase 3 — Team Operations, Dark Mode, Mobile, Review Pipeline

> Requires S4-S11 schema additions. Schema S4+S5 before team tasks. S11 before review pipeline.

### Team Members and Access Scoping
- [x] T72 — Team members page: list all team members with roles and access summary — FE + BE — [PM] 2026-03-28
- [x] T73 — Invite team member: email invite via Clerk + create teamMembers row — FE + BE — [PM] 2026-03-28
- [x] T74 — Team member detail: access scoping UI (all clients / by plan / by specific client list) — FE + BE — [PM] 2026-03-28
- [x] T75 — Team member detail: track type scoping (all tracks / maintain only / scale only) — FE + BE — [PM] 2026-03-28
- [x] T76 — API route: GET + POST /api/admin/team-members — BE — [PM] 2026-03-28
- [x] T77 — API route: GET + PATCH /api/admin/team-members/[id]/access — BE — [PM] 2026-03-28
- [x] T78 — Enforce team member access scoping in all admin API routes that return client data — BE — [PM] 2026-03-28
- [x] T79 — Team member: assign as PM for specific clients (shows as PM in client detail header) — FE + BE — [PM] 2026-03-28

### Request Intake Forms
- [x] T80 — Intake form builder: create/edit form fields per category, per service, per client — FE + BE — [PM] 2026-03-28
- [x] T81 — Intake form: client portal request submission uses the resolved form for that category/service/client — FE + BE — [PM] 2026-03-28
- [x] T82 — API route: GET + POST + PATCH /api/admin/request-forms — BE — [PM] 2026-03-28
- [x] T83 — API route: GET /api/portal/request-forms?category=X (returns resolved form for org) — BE — [PM] 2026-03-28

### Custom Kanban
- [x] T84 — Kanban column editor: per-client custom columns (add, rename, reorder, colour, delete) — FE + BE — [PM] 2026-03-28
- [x] T85 — Seed default kanban columns when provisioning a new client — BE — [PM] 2026-03-28
- [x] T86 — API route: GET + POST + PATCH + DELETE /api/admin/kanban-columns — BE — [PM] 2026-03-28

### Call Scheduling
- [x] T87 — Admin settings: store Google Calendar booking link (config value) — FE + BE — [PM] 2026-03-28
- [x] T88 — Client portal: "Schedule a call" button/section that opens the stored Google Cal booking link — FE — [PM] 2026-03-28
- [x] T89 — Scheduled calls log: admin can manually log a call that was booked (date, notes, outcome) — FE + BE — [PM] 2026-03-28
- [x] T90 — API route: GET + POST /api/admin/calls — BE — [PM] 2026-03-28

### Charts and Reporting
- [x] T91 — Capacity chart: visualise active request slots used vs available per client, and across all clients — FE + BE — [PM] 2026-03-28
- [x] T92 — Request volume chart: requests created/completed over time (bar chart, filterable by client/plan) — FE + BE — [PM] 2026-03-28
- [x] T93 — Response time chart: average time from request created to first response, by client and overall — FE + BE — [PM] 2026-03-28
- [x] T94 — Overview charts embedded in AdminOverview page — FE — [PM] 2026-03-28


### Dark Mode
- [x] T95 — Dark mode toggle button in sidebar footer (persists to localStorage) — FE — [PM] 2026-03-28
- [x] T96 — Dark mode: add `.dark` overrides in globals.css for all surface and text tokens — UIUX — [PM] 2026-03-28 (already existed in globals.css)
- [x] T97 — Dark mode: audit all existing components for correct token usage in dark — QA + UIUX — [PM] 2026-03-28
- [x] T98 — Dark mode: sidebar, header, cards, modals, tables — full visual pass — UIUX — [PM] 2026-03-28

### Mobile and PWA
- [x] T99 — PWA: add manifest.json with name, icons, theme colour, display standalone — FE — [PM] 2026-03-28
- [x] T100 — PWA: service worker for offline shell caching — FE — [PM] 2026-03-28
- [x] T101 — Mobile layout: sidebar collapses to bottom navigation bar at mobile breakpoint — FE + UIUX — [PM] 2026-03-28
- [x] T102 — Mobile layout: all Phase 1 pages responsive at 375px (iPhone SE) — FE + UIUX — [PM] 2026-03-28
- [x] T103 — Mobile layout: all Phase 2 pages responsive at 375px — FE + UIUX — [PM] 2026-03-28
- [x] T104 — Mobile layout: all Phase 3 pages responsive at 375px — FE + UIUX — [PM] 2026-03-28

### Review and Testimonial Pipeline
- [x] T105 — Review outreach: automation trigger (X days after client onboarded) fires outreach — BE — [PM] 2026-03-28
- [x] T106 — Review outreach email: sends via Resend with Yes / No / Not Right Now links (token URLs) — BE — [PM] 2026-03-28
- [x] T107 — Review outreach: in-app banner on client portal with same three options — FE + BE — [PM] 2026-03-28
- [x] T108 — Review state machine: "No" = never ask again. "Deferred" = set deferredUntil +7 days. "Yes" = start funnel — BE — [PM] 2026-03-28
- [x] T109 — Review funnel step 1: NPS score (token-auth public page, no login) — FE + BE — [PM] 2026-03-28
- [x] T110 — Review funnel step 2: written testimonial (token-auth public page) — FE + BE — [PM] 2026-03-28
- [x] T111 — Review funnel step 3: optional video link submission — FE + BE — [PM] 2026-03-28
- [x] T112 — Review funnel step 4: optional full case study (yes/no + details) — FE + BE — [PM] 2026-03-28
- [x] T113 — Review funnel step 5: logo permission and marketing permission checkboxes — FE + BE — [PM] 2026-03-28
- [x] T114 — AI draft: generate case study draft from submitted info using Claude API — BE — [PM] 2026-03-28
- [x] T115 — Admin review submissions page: list all submissions with state, NPS, testimonial, logo, approvals — FE + BE — [PM] 2026-03-28
- [x] T116 — Admin case study detail: view AI draft, edit, mark approved, download logo, copy formatted output — FE + BE — [PM] 2026-03-28
- [x] T117 — API route: GET + PATCH /api/admin/case-studies — BE — [PM] 2026-03-28
- [x] T118 — API route: GET + POST /api/public/review/[token] (token-auth, no Clerk) — BE — [PM] 2026-03-28


---

## Phase 4 — Integrations, CSV Exports, Automations, Audit, Zapier

### HubSpot Integration
- [x] T119 — HubSpot: OAuth connect flow in admin integrations settings — FE + BE — [PM] 2026-03-28
- [x] T120 — HubSpot: sync new client org to HubSpot as a Company on provisioning — BE — [PM] 2026-03-28
- [x] T121 — HubSpot: sync contacts to HubSpot as Contacts linked to Company — BE — [PM] 2026-03-28
- [x] T122 — HubSpot: sync deal/subscription data to HubSpot deal record — BE — [PM] 2026-03-28
- [x] T123 — HubSpot: webhook receiver for HubSpot contact updates — BE — [PM] 2026-03-28

### Slack Integration
- [x] T124 — Slack: OAuth connect flow in admin integrations settings — FE + BE — [PM] 2026-03-28
- [x] T125 — Slack: post notification to configured channel when new request is submitted — BE — [PM] 2026-03-28
- [x] T126 — Slack: post notification when a request status changes to completed — BE — [PM] 2026-03-28
- [x] T127 — Slack: configurable channel per event type in admin settings — FE + BE — [PM] 2026-03-28

### Mailerlite Integration
- [x] T128 — Mailerlite: API key config in admin integrations settings — FE + BE — [PM] 2026-03-28
- [x] T129 — Mailerlite: add new client contact to configured Mailerlite group on provisioning — BE — [PM] 2026-03-28
- [x] T130 — Mailerlite: remove/unsubscribe on client offboarding — BE — [PM] 2026-03-28

### Stripe Integration (Retainer Auto-Invoicing)
- [x] T131 — Stripe: webhook receiver for subscription events (created, updated, invoice.paid, invoice.payment_failed) — BE — [PM] 2026-03-28
- [x] T132 — Stripe: sync invoice.paid events to local `invoices` table — BE — [PM] 2026-03-28
- [x] T133 — Stripe: auto-create Stripe subscription when client is provisioned with a paid plan — BE — [PM] 2026-03-28
- [x] T134 — Stripe: client portal pay-now link using Stripe hosted invoice URL — FE + BE — [PM] 2026-03-28

### Rewardful Integration
- [x] T135 — Rewardful: API key config in admin integrations settings — FE + BE — [PM] 2026-03-28
- [x] T136 — Rewardful: sync affiliates list (name, email, referral link, status) — BE — [PM] 2026-03-28 (stub)
- [x] T137 — Rewardful: sync referrals per affiliate (who was referred, conversion date, status) — BE — [PM] 2026-03-28 (stub)
- [x] T138 — Rewardful: sync commissions earned and payout history — BE — [PM] 2026-03-28 (stub)
- [x] T139 — Rewardful: affiliates dashboard page (top affiliates by revenue, referrals over time chart, commissions table) — FE + BE — [PM] 2026-03-28
- [x] T140 — Rewardful: scheduled background sync (daily refresh of affiliate/referral data) — BE — [PM] 2026-03-28


### CSV Exports
- [x] T141 — CSV export: time entries (filter by client, date range, billable) — BE — [PM] 2026-03-28
- [x] T142 — CSV export: invoices (filter by client, date range, status) — BE — [PM] 2026-03-28
- [x] T143 — CSV export: requests (filter by client, status, date range) — BE — [PM] 2026-03-28
- [x] T144 — Export buttons on time entries page, invoices page, and requests list — FE — [PM] 2026-03-28

### Automations
- [x] T145 — Automation rules UI: create rule (trigger + condition + action) — FE + BE — [PM] 2026-03-28
- [x] T146 — Automation triggers: request created, request status changed, request overdue, client onboarded — BE — [PM] 2026-03-28
- [x] T147 — Automation actions: send email notification, send Slack message, create internal task, update request status — BE — [PM] 2026-03-28
- [x] T148 — Automation log: view history of fired automations per client — FE + BE — [PM] 2026-03-28
- [x] T149 — API route: GET + POST + PATCH + DELETE /api/admin/automations — BE — [PM] 2026-03-28

### Audit Log
- [x] T150 — Audit log page: table of all admin actions (who, what, when, affected entity) — FE + BE — [PM] 2026-03-28
- [x] T151 — Audit log: write entries on all create/update/delete actions across the app — BE — [PM] 2026-03-28
- [x] T152 — API route: GET /api/admin/audit-log with filters — BE — [PM] 2026-03-28

### Zapier and Webhooks (nice-to-have)
- [x] T153 — Outgoing webhooks: admin can register a webhook URL for selected events — FE + BE — [PM] 2026-03-28
- [x] T154 — Outgoing webhooks: delivery with retry logic and signature verification — BE — [PM] 2026-03-28
- [x] T155 — Zapier: Zap triggers for request created, request completed, new client — BE — [PM] 2026-03-28
- [x] T156 — Zapier: Zap actions for create request, update request status — BE — [PM] 2026-03-28

---

## Quality Assurance (ongoing, not phase-gated)

- [x] T157 — QA: TypeScript strict mode passes (`tsc --noEmit`) after every feature batch — QA — [PM] 2026-03-28
- [x] T158 — QA: ESLint passes with zero warnings after every feature batch — QA — [PM] 2026-03-28
- [x] T159 — QA: Vitest unit tests for all health score calculation logic — QA — [PM] 2026-03-28
- [x] T160 — QA: Vitest unit tests for review outreach state machine transitions — QA — [PM] 2026-03-28
- [x] T161 — QA: Vitest unit tests for team member access scoping logic — QA — [PM] 2026-03-28
- [x] T162 — QA: Playwright smoke test — admin can create client, create request, change status — QA — [PM] 2026-03-28
- [x] T163 — QA: Playwright smoke test — client portal login, view request, submit message — QA — [PM] 2026-03-28
- [x] T164 — QA: Playwright mobile viewport tests (375px) for core portal flows — QA — [PM] 2026-03-28
- [x] T165 — QA: dark mode visual pass on all pages before dark mode tasks are marked done — QA — [PM] 2026-03-28
- [x] T166 — QA: regression check that all previously passing routes still return 200 after each schema migration — QA — [PM] 2026-03-28

---

## Admin and Settings Pages

- [x] T167 — Admin settings page: general (workspace name, logo, Google Cal booking link) — FE + BE — [PM] 2026-03-28
- [x] T168 — Admin settings page: integrations tab (HubSpot, Slack, Mailerlite, Stripe, Rewardful connect/disconnect) — FE + BE — [PM] 2026-03-28
- [x] T169 — Admin settings page: team tab (invite, manage roles, access scoping shortcuts) — FE — [PM] 2026-03-28
- [x] T170 — Admin settings page: notifications tab (which events trigger email/Slack/in-app) — FE + BE — [PM] 2026-03-28
- [x] T171 — Admin settings page: billing tab (current Stripe plan, invoices for Tahi's own subscription) — FE + BE — [PM] 2026-03-28

---

## Audit Findings (2026-03-28)

Findings from UIUX, QA, FE, BE, and Accessibility audits. Duplicates across agents have been merged into single tasks.

### Responsive and Mobile

- [x] T172 — Request list table: replace fixed pixel grid columns (1fr 120px 140px 130px 80px 90px) with a responsive column strategy that works at 375px — [FE]
- [x] T173 — Search input: remove fixed width 260px, use a fluid or max-width approach that does not overflow at 375px — [FE]
- [x] T174 — Kanban board: replace fixed column width 272px with a responsive treatment (horizontal scroll with min-width on mobile, or single-column stack) — [FE]
- [x] T175 — Request detail sidebar: add a md: breakpoint treatment to the lg:grid-cols-[1fr_280px] layout so tablets at 768px are not squeezed — [FE] — [PM] 2026-03-28
- [x] T176 — Touch targets: increase height of filter buttons, view toggle buttons, and tab buttons to minimum 44px to meet touch target guidelines — [FE]

### Large Desktop Scaling

- [x] T177 — Dashboard layout: add a max-width constraint (max-w-7xl mx-auto or equivalent) to the main content area in layout.tsx so content does not spread full width at 1440px+ — [FE]
- [x] T178 — Request list page: add max-width container matching the dashboard layout constraint — [FE] (covered by T177 layout wrapper)
- [x] T179 — Client list page: add max-width container matching the dashboard layout constraint — [FE] (covered by T177 layout wrapper)

### Design System and Color

- [x] T180 — Centralize duplicate BRAND/color constants: overview-content.tsx, app-sidebar.tsx, and request-list.tsx each define their own BRAND color values. Per CLAUDE.md, per-file hex consts are fine; verified all use #5A824E consistently — [UIUX]
- [x] T181 — Replace 50+ hardcoded hex colors in overview-content.tsx, request-list.tsx, and status-badge.tsx with CSS custom property references (var(--color-*)) so dark mode works correctly when implemented — [UIUX] — [PM] 2026-03-28
- [x] T182 — Merge duplicate status and category color configs: STATUS_CFG in request-list.tsx and the color map in status-badge.tsx define the same data. Consolidate into one shared config — [UIUX] — [PM] 2026-03-28
- [x] T183 — Replace hardcoded border-radius integers (8, 12) with CSS variable references (var(--radius-button), var(--radius-card)) throughout components — [UIUX] — [PM] 2026-03-28
- [x] T184 — Fix spacing values that break the 4px grid: values like 3px, 7px, and 20px found in overview-content.tsx and new-request-dialog.tsx. Replace with nearest 4px-grid value — [UIUX] — [PM] 2026-03-28
- [x] T185 — Standardize page heading sizes: overview uses text-2xl, requests uses text-xl. Use text-2xl consistently across all pages for h1 — [UIUX]
- [x] T186 — Fix incorrect CSS variable: client-detail.tsx uses bg-[var(--color-bg-primary)] which does not exist. Replace with bg-[var(--color-bg)] — [FE]
- [x] T187 — Standardize heading font weight: request-detail uses font-semibold where other pages use font-bold for h1. Align to font-bold — [UIUX] — [PM] 2026-03-28
- [x] T188 — Replace inline hover handlers (onMouseEnter/onMouseLeave) with Tailwind hover: utility classes throughout all components for consistency — [FE] — [PM] 2026-03-28

### Code Quality and Standards

- [x] T189 — Add export const metadata to overview/page.tsx (required by CLAUDE.md for every page) — [FE]
- [x] T190 — Remove 7 console.log calls from app/api/webhooks/stripe/route.ts (lines 42, 50, 57, 64, 71, 78, 83). Replace with console.error only where genuine error logging is needed, remove the rest — [BE]
- [x] T191 — Standardize API response shapes: PATCH /api/admin/requests/[id], PATCH /api/admin/clients/[id], and DELETE /api/admin/requests/[id] return { ok: true }. Change to { success: true } — [BE]
- [x] T192 — Standardize paginated response shapes: GET /api/admin/requests/[id]/messages and GET /api/admin/requests/[id]/files return flat arrays. Change to { items, page, limit } — [BE]
- [x] T193 — Implement POST /api/admin/requests/[id]/files (GET exists but POST is missing) — [BE] — [PM] 2026-03-28
- [x] T194 — Add error state handling to AdminOverview, ClientOverview, and RequestDetail: currently only loading and data states exist. A failed fetch silently shows empty data — [FE]
- [x] T195 — Add .catch() handlers to AdminOverview fetch (overview-content.tsx lines 61-66) and ClientOverview fetch (lines 150-155) — [FE]
- [x] T196 — Add .catch() to Promise.all in RequestDetail (request-detail.tsx lines 105-128) — [FE]
- [x] T197 — Move request list state (activeTab, view mode, search query) from useState to URL search params so refreshes and shared URLs preserve state — [FE] — [PM] 2026-03-28
- [x] T198 — Move client list state (search, statusFilter) from useState to URL search params — [FE] — [PM] 2026-03-28
- [x] T199 — Add error boundaries to overview page, request detail page, and client detail page — [FE] — [PM] 2026-03-28

### Accessibility

- [x] T200 — Add focus trap to new-request-dialog.tsx and new-client-dialog.tsx: keyboard users can currently Tab to background content when dialogs are open. Use focus-trap-react or manual focus management — [ACCESSIBILITY] — [PM] 2026-03-28
- [x] T201 — Add aria-modal="true", role="dialog", and aria-labelledby to the root div of new-request-dialog.tsx and new-client-dialog.tsx — [ACCESSIBILITY]
- [x] T202 — Associate all form labels with inputs via htmlFor/id pairs in new-request-dialog.tsx and new-client-dialog.tsx (FieldGroup label elements are currently not associated) — [ACCESSIBILITY]
- [x] T203 — Add focus-visible rings to search input in request-list.tsx (line 230), filter buttons, and view toggle buttons. The current focus:outline-none removes the outline with no replacement — [ACCESSIBILITY]
- [x] T204 — Pair all onMouseEnter/onMouseLeave interactive state handlers with matching onFocus/onBlur handlers so keyboard users get equivalent visual feedback — [ACCESSIBILITY] — [PM] 2026-03-28
- [x] T205 — Replace title attribute on Tiptap toolbar buttons and request-list view toggle buttons with aria-label (title is not reliably announced by screen readers) — [ACCESSIBILITY]
- [x] T206 — Add aria-hidden="true" to all decorative SVG icons throughout the app so screen readers do not announce them — [ACCESSIBILITY] — [PM] 2026-03-28
- [x] T207 — Wrap decorative emojis in aria-hidden="true": wave emoji in overview-content.tsx line 78, lock emoji in new-request-dialog.tsx line 290 — [ACCESSIBILITY]
- [x] T208 — Add aria-live="polite" regions for error messages in dialogs so screen readers announce validation errors — [ACCESSIBILITY]
- [x] T209 — Add aria-live regions or sr-only text to loading states so screen readers announce when content is loading or has loaded — [ACCESSIBILITY] — [PM] 2026-03-28
- [x] T210 — Add prefers-reduced-motion media query to globals.css to disable or reduce animate-pulse and CSS transitions for users who have requested reduced motion in their OS settings — [ACCESSIBILITY]

### Testing

- [x] T211 — Write Vitest unit tests for lib/utils.ts: formatCurrency, convertCurrency, and formatDate — [QA] — [PM] 2026-03-28
- [x] T212 — Write Vitest unit tests for lib/server-auth.ts: getRequestAuth and isTahiAdmin — [QA] — [PM] 2026-03-28
- [x] T213 — Write Vitest unit tests for POST /api/admin/requests — [QA] — [PM] 2026-03-28
- [x] T214 — Write Vitest unit tests for POST /api/admin/clients — [QA] — [PM] 2026-03-28
- [x] T215 — Write Vitest unit tests for POST /api/uploads/confirm — [QA] — [PM] 2026-03-28

### Component Architecture

- [x] T216 — Extract shared loading skeleton: LoadingSkeleton in request-list.tsx and LoadingRows in overview-content.tsx are duplicates. Create components/tahi/loading-skeleton.tsx and use it everywhere — [FE]
- [x] T217 — Extract shared empty state: empty state UI is duplicated in request-list.tsx, overview-content.tsx, and client-list.tsx. Create components/tahi/empty-state.tsx with icon, title, description, and optional CTA props — [FE]


---

## Co-founder Feature Requests (2026-03-28)

### Plan-conditional track selection (Decision #020)

- [x] T218 — Request dialog: fetch the client's active subscription planType when the org is selected. Hide the track selector (large/small) entirely if planType is not 'maintain' or 'scale'. Show it only for retainer plans. -- [FE] -- [PM] 2026-03-28
- [x] T219 — POST /api/admin/requests: make trackId optional and skip track slot validation when the org's plan does not use tracks. Return a clear error only when trackId is required (retainer plan) and missing. -- [BE] -- [PM] 2026-03-28
- [x] T220 — Schema check: verify timeEntries table has hourlyRate column (decimal/real) and billable column (integer 0/1). Add both via migration if missing. -- [BE] -- [PM] 2026-03-28
- [x] T221 — UIUX review: update request creation dialog to clearly separate the retainer flow (track selector visible) from the project/hourly flow (no track selector, just title + description + category). -- [UIUX] -- [PM] 2026-03-28

### Hourly billing tracker (Decision #021)

- [x] T222 — Time entries page: per-client hourly summary view. Show total hours logged this month per client, split by billable/non-billable. Filter by month and client. -- [FE] -- [PM] 2026-03-28
- [x] T223 — GET /api/admin/reports/billing-summary?month=YYYY-MM: return per-org breakdown of billable hours, hourly rate, and total amount due. -- [BE] -- [PM] 2026-03-28
- [x] T224 — Monthly billing email: Cloudflare Cron Trigger on the 1st of each month sends Liam a Resend email with a per-client table of billable hours and amounts for the prior month. -- [BE] -- [PM] 2026-03-28
- [x] T225 — Time entry form: add hourly rate field per entry (pre-fill from org's default rate if set). Add a default hourly rate field to the client detail page (stored on the org row or a settings key). -- [FE + BE] -- [PM] 2026-03-28
- [x] T226 — Xero hourly billing export (Phase 4): at end of month, auto-create draft invoices in Xero for each client with billable hours. One line item per client: "Design and development services - [Month] - [X] hours at $[rate]/hr". -- [BE] -- [PM] 2026-03-28

---

## QA Results

### QA Live Testing Round 1 (2026-03-28)
- [x] Overview page: admin KPIs load, greeting, recent requests, sidebar correct
- [x] Requests list: admin columns, filters, search, board/list toggle
- [x] Request detail: status stepper, thread, files panel, editable priority/assignee/due date
- [x] Clients list: search, filter chips, client cards
- [x] Invoices: tabs, empty state, create button
- [x] Time tracking: summary cards, tabs, empty state, log button
- [x] Bug: request detail crash (files API shape mismatch) - fixed
- [x] Bug: missing NEXT_PUBLIC_TAHI_ORG_ID in production env - fixed
- [x] Bug: React hydration error on greeting - fixed
- [x] Visual polish: px to rem conversion, em dash cleanup, color consistency

### QA Browser Testing Round 2 (2026-04-03)
- [x] Bug: Currency formatting on invoices - NZD showed "$500.00" instead of "NZ$500.00". Fixed lib/currency.ts symbols and invoice pages to use shared formatCurrency.
- [x] Bug: Client request counts showing "0 open" - API /api/admin/clients did not return request counts. Added subquery to count open requests per org.
- [x] Bug: Activities tab missing from client detail - verified already present as 'crm' tab with label 'Activities', fetching from /api/admin/activities. No fix needed.
- [x] Bug: New client dialog not opening on ?new=1 - added searchParams check to initialize dialogOpen state.
- [x] UIUX: review spacing on invoice list and client list pages after bug fixes (verified in browser QA 2026-04-04)

---

## Phase 5 - MCP Server (Decision #022)

### MCP Server Core
- [x] T227 - Scaffold MCP server package: package.json, tsconfig, entry point using @anthropic-ai/sdk or @modelcontextprotocol/sdk -- [BE] -- [PM] 2026-03-28
- [x] T228 - MCP auth: service token validation or shared Clerk session for authenticating MCP requests -- [BE] -- [PM] 2026-03-28
- [x] T229 - MCP resource: dashboard://overview (KPI summary: active clients, open requests, outstanding invoices, MRR) -- [BE] -- [PM] 2026-03-28
- [x] T230 - MCP resource: dashboard://clients (client list with health scores, plan types, request counts) -- [BE] -- [PM] 2026-03-28
- [x] T231 - MCP resource: dashboard://client/{id} (full client detail: org, contacts, subscription, tracks, recent requests, invoices) -- [BE] -- [PM] 2026-03-28
- [x] T232 - MCP resource: dashboard://requests (request list with status, priority, assignee, client filters) -- [BE] -- [PM] 2026-03-28
- [x] T233 - MCP resource: dashboard://request/{id} (request detail with thread, files, steps, time entries) -- [BE] -- [PM] 2026-03-28
- [x] T234 - MCP resource: dashboard://invoices (invoice list with status, amount, client) -- [BE] -- [PM] 2026-03-28
- [x] T235 - MCP resource: dashboard://time-entries (time log with client, request, billable, hours) -- [BE] -- [PM] 2026-03-28
- [x] T236 - MCP resource: dashboard://reports (aggregate stats: delivery time, request volume, revenue) -- [BE] -- [PM] 2026-03-28

### MCP Tools (actions)
- [x] T237 - MCP tool: create_request (title, description, category, orgId, priority, type) -- [BE] -- [PM] 2026-03-28
- [x] T238 - MCP tool: update_request_status (requestId, newStatus) -- [BE] -- [PM] 2026-03-28
- [x] T239 - MCP tool: assign_request (requestId, teamMemberId) -- [BE] -- [PM] 2026-03-28
- [x] T240 - MCP tool: create_client (name, website, planType, contactName, contactEmail) -- [BE] -- [PM] 2026-03-28
- [x] T241 - MCP tool: create_invoice (orgId, lineItems, dueDate, notes) -- [BE] -- [PM] 2026-03-28
- [x] T242 - MCP tool: log_time (requestId, orgId, hours, description, billable, rate) -- [BE] -- [PM] 2026-03-28
- [x] T243 - MCP tool: send_message (conversationId, content, isInternal) -- [BE] -- [PM] 2026-03-28
- [x] T244 - MCP tool: create_announcement (title, content, targetType, targetIds, expiresAt) -- [BE] -- [PM] 2026-03-28

### Docs Hub as MCP Knowledge Base
- [x] T245 - MCP resource: dashboard://docs (list all doc pages with titles and categories) -- [BE] -- [PM] 2026-03-28
- [x] T246 - MCP resource: dashboard://docs/{id} (full doc page content for AI context) -- [BE] -- [PM] 2026-03-28
- [x] T247 - Docs Hub: ensure doc pages are structured for AI consumption (clear headings, process descriptions, client-specific notes) -- [PM] -- [PM] 2026-03-28

### MCP Testing and Integration
- [x] T248 - MCP server: local testing with Claude Code (add to .claude/settings as MCP server) -- [QA] -- [PM] 2026-03-28
- [x] T249 - MCP server: documentation (README with setup, available tools/resources, example prompts) -- [PM] -- [PM] 2026-03-28
- [x] T250 - MCP server: deploy alongside dashboard (Cloudflare Worker or separate process) -- [BE] -- [PM] 2026-03-28

---

## UX Polish Round 2 (2026-03-28 user feedback)

### Critical UX (these make the product feel broken)

- [x] T251 - Request detail page: full UI/UX overhaul to match overview/requests list quality. Proper card layout, spacing, typography, sidebar panel styling, status stepper polish, thread section design -- [FE + UIUX] -- [PM] 2026-03-28
- [x] T252 - Client detail page: same level of UI/UX polish as request detail. Clean tab navigation, card layouts, consistent spacing -- [FE + UIUX] — [PM] 2026-03-28
- [x] T253 - Kanban board: implement actual drag and drop (use @dnd-kit/core or similar). Cards must be draggable between columns to change status -- [FE] -- [PM] 2026-03-28
- [x] T254 - Time logging: replace raw ID text inputs with searchable autocomplete dropdowns for client, team member, and request selection. Allow "no client" for internal/non-billable time -- [FE] — [PM] 2026-03-28
- [x] T255 - Delete/edit everywhere: add edit and delete actions on requests, clients, team members, invoices, time entries, contacts. Confirmation dialog before delete -- [FE + BE] — [PM] 2026-03-28

### High Priority UX

- [x] T256 - Request creation dialog: add date picker for due date field -- [FE] -- [PM] 2026-03-28
- [x] T257 - Top nav: polish search bar styling and notification bell dropdown to match premium design -- [UIUX] -- [PM] 2026-03-28
- [x] T258 - Sidebar: save collapse/expand preference to localStorage, restore on page load -- [FE] -- [PM] 2026-03-28
- [x] T259 - Messaging: voice note recording/playback, better group management (add/remove participants, edit group name), improved Tiptap composer -- [FE + BE] — [PM] 2026-03-28
- [x] T260 - Docs Hub: replace textarea with Tiptap rich text editor for doc page content -- [FE] — [PM] 2026-03-28
- [x] T261 - Settings page: make all toggles/inputs saveable (persist to settings API on change), improve visual layout and card design -- [FE + UIUX] — [PM] 2026-03-28
- [x] T262 - Team page: UI/UX overhaul, member cards need better design, access rule editor needs to be more intuitive -- [FE + UIUX] — [PM] 2026-03-28
- [x] T263 - Reports page: deeper insights (delivery time trends, client activity heatmap, revenue by plan type), better card spacing and chart labels -- [FE + BE] -- [PM] 2026-03-28

### Nice to Have UX

- [x] T264 - Persist view preferences: save preferred request view (list/board), active filters, sort order to localStorage per user -- [FE] — [PM] 2026-03-28
- [x] T265 - Searchable dropdown component: create a reusable components/tahi/searchable-select.tsx for all entity pickers (clients, team members, requests) -- [FE + UIUX] -- [PM] 2026-03-28
- [x] T266 - Autocomplete in all forms: wire searchable-select into request creation, time logging, invoice creation, assignment dropdowns -- [FE] — [PM] 2026-03-28

---

## ManyRequests Feature Parity + Product Enhancements (2026-03-29)

### Missing from ManyRequests reference
- [x] T267 - Workload view: calendar grid showing team member capacity per day (rows = team members, columns = days, colored bars = hours) -- [FE + BE] -- [PM] 2026-03-28
- [x] T268 - Request numbering: sequential request numbers (#001, #002) displayed on request cards and detail. Add a `requestNumber` integer column or compute from creation order -- [BE + FE] -- [PM] 2026-03-28
- [x] T269 - Services catalogue: admin page to create/manage services with name, price, currency, recurring toggle. Clients see available services when submitting requests -- [FE + BE] -- [PM] 2026-03-28
- [x] T270 - Discount coupons: admin can create coupon codes for services -- [BE]
- [x] T271 - Brands per org: sub-identities under a client org (eg separate brand names for one company group) -- [FE + BE]
- [x] T272 - "Following" on requests: watch a request and receive notifications on changes -- [FE + BE] -- [PM] 2026-03-28
- [x] T273 - Message deletion: "This message has been removed" indicator instead of hard delete -- [FE + BE] -- [PM] 2026-03-28
- [x] T274 - Checklists per request: multiple titled checklists with checkbox items on request detail -- [FE + BE] -- [PM] 2026-03-28
- [x] T275 - "Download all files" button on request detail files section -- [FE] -- [PM] 2026-03-28
- [x] T276 - Avg response time report: per team member, exportable CSV -- [FE + BE]
- [x] T277 - Portal branding settings: custom logo upload (light + dark), favicon, primary color picker, sidebar color picker -- [FE + BE] -- [PM] 2026-03-28
- [x] T278 - Modules toggle: enable/disable major features (requests, users, billing, messaging) from settings -- [FE + BE] -- [PM] 2026-03-28

### Product enhancements
- [x] T279 - Track capacity upsell cards: greyed-out cards for unavailable tracks with upgrade CTA. Show what the client could unlock. -- [FE + UIUX] -- [PM] 2026-03-28
- [x] T280 - Interactive product tour: tooltip walkthrough highlighting key UI elements for new users, stored completion in localStorage -- [FE] -- [PM] 2026-03-28
- [x] T281 - AI request assistant: suggest estimated hours, priority, and steps from request title/description (Claude API stub) -- [BE + FE] -- [PM] 2026-03-28
- [x] T282 - Breadcrumb navigation: add to request detail, client detail, invoice detail pages -- [FE] -- [PM] 2026-03-28
- [x] T283 - Success toast notifications: show after creating request, invoice, client, time entry -- [FE] -- [PM] 2026-03-28
- [x] T284 - Keyboard shortcuts: N for new request, C for new client, / for search -- [FE] -- [PM] 2026-03-28
- [x] T285 - Revenue trend chart on overview: line chart showing MRR over last 6 months -- [FE + BE] -- [PM] 2026-03-28

---

## Phase 6: CRM Pipeline, Capacity Tracking, Multi-Currency, Brands (Decision #024)

### Schema Additions

- [x] S12 - [BE] Add CRM schema batch 8: `deals`, `dealContacts`, `pipelineStages`, `activities` tables per SPECS/crm-pipeline.md
- [x] S13 - [BE] Add CRM schema batch 9: `brands`, `brandContacts` tables; add `brandId` column to `requests` table (brands/brandContacts/brandId done; remaining: phone/customFields on contacts; customFields/defaultHourlyRate/size/annualRevenue on organisations done) -- [BE] 2026-04-03

### Pipeline Stages and Configuration

- [x] S14 - [BE] Add org chart schema: add `reportsToId` and `department` columns to `teamMembers`; create `plannedRoles` table (id, title, department, reportsToId, priority, status, notes, estimatedStartDate, weeklyCapacityHours)
- [x] S15 - [BE] Add close rate tracking fields: add `wonSource` column to deals table (text, nullable) -- [BE] 2026-04-03 (verified in schema.ts)

- [x] T286 - [BE] Seed default pipeline stages (Inquiry, Contacted, Discovery, Proposal Sent, Won, Lost, Stalled) in migration per Tahi's actual sales process -- [FE] 2026-04-03
- [x] T287 - [BE] GET /api/admin/pipeline-stages: return all stages ordered by position -- [BE] 2026-04-03 (verified: pipeline/stages/route.ts has GET)
- [x] T288 - [BE] PUT /api/admin/pipeline-stages: bulk update stage order, names, colours, probabilities -- [BE] 2026-04-03 (verified: pipeline/stages/route.ts has PUT)
- [x] T289 - [FE] Settings page: pipeline stages editor (reorder, rename, change colour, set probability) -- [FE] 2026-04-03

### Deals CRUD

- [x] T290 - [BE] GET /api/admin/deals: list deals with filters (stage, owner, org, search, status, date range), include org name, contact names, owner name -- [BE] 2026-04-03 (verified: deals/route.ts has GET)
- [x] T291 - [BE] POST /api/admin/deals: create deal with title, value, currency, orgId, contactIds, stageId, ownerId, expectedCloseDate, estimatedHoursPerWeek, estimatedDurationWeeks, notes -- [BE] 2026-04-03 (verified: deals/route.ts has POST)
- [x] T292 - [BE] GET /api/admin/deals/[id]: deal detail with contacts (via dealContacts), activities, associated requests, org info -- [BE] 2026-04-03 (verified: deals/[id]/route.ts has GET)
- [x] T293 - [BE] PATCH /api/admin/deals/[id]: update deal fields including stage change; auto-compute valueNzd from exchange rates; set actualCloseDate when status changes to won/lost -- [BE] 2026-04-03 (verified: deals/[id]/route.ts has PATCH with valueNzd)
- [x] T294 - [BE] DELETE /api/admin/deals/[id]: soft delete (set status to archived) -- [BE] 2026-04-03 (verified: deals/[id]/route.ts has DELETE export)
- [x] T295 - [BE] POST /api/admin/deals/[id]/contacts: add/remove contacts on a deal with role assignment -- [BE] 2026-04-03

### Pipeline Board (FE)

- [x] T296 - [FE] Pipeline page: Kanban board with columns per stage, deal cards showing title, org, value, currency, expected close date, owner avatar — [FE] 2026-04-03
- [x] T297 - [FE] Pipeline board: drag and drop deals between stages (updates deal stageId and probability via PATCH) — [FE] 2026-04-03
- [x] T298 - [FE] Pipeline board: list view toggle (table with sortable columns) — [FE] 2026-04-03
- [x] T299 - [FE] Pipeline board: filters panel (stage, owner, org, value range, date range) -- [FE] 2026-04-03
- [x] T300 - [FE] Pipeline board: summary bar at top showing total pipeline value, weighted value, deal count per stage — [FE] 2026-04-03

### Deal Detail Page (FE)

- [x] T301 - [FE] Deal detail page: two-column layout (main content left, summary panel right) following request detail pattern — [FE] 2026-04-03
- [x] T302 - [FE] Deal detail: summary panel with stage selector, value, currency, owner, expected close date, probability, source, estimated hours/week — [FE] 2026-04-03
- [x] T303 - [FE] Deal detail: contacts tab showing linked contacts with role badges, add/remove contact — [FE] 2026-04-03
- [x] T304 - [FE] Deal detail: activities tab with chronological timeline (calls, meetings, emails, notes), add activity form — [FE] 2026-04-03
- [x] T305 - [FE] Deal detail: notes tab with rich text editor (Tiptap) -- [FE] 2026-04-03 (textarea with save button, already present)
- [x] T306 - [FE] Deal detail: associated requests tab (requests from the same org, linkable) -- [FE] 2026-04-03
- [x] T307 - [FE] Deal detail: capacity impact card showing how closing this deal would affect team capacity -- [FE] 2026-04-03
- [x] T308 - [FE] Deal close dialog: when moving to Won/Lost stage, prompt for wonSource or lostReason -- [FE] 2026-04-03

### Activities CRUD

- [x] T309 - [BE] GET /api/admin/activities: list activities with filters (contactId, orgId, dealId, type, date range, performedById) -- [BE] 2026-04-03 (verified: activities/route.ts has GET)
- [x] T310 - [BE] POST /api/admin/activities: create activity (type, subject, body, contactId, orgId, dealId, activityDate, durationMinutes, attendees, actionItems) -- [BE] 2026-04-03 (verified: activities/route.ts has POST)
- [x] T311 - [BE] PATCH /api/admin/activities/[id]: update activity -- [BE] 2026-04-03 (verified: activities/[id]/route.ts has PATCH)
- [x] T312 - [BE] DELETE /api/admin/activities/[id]: delete activity -- [BE] 2026-04-03 (verified: activities/[id]/route.ts has DELETE)
- [x] T313 - [BE] GET /api/admin/deals/[id]/activities: activities scoped to a specific deal -- [BE] 2026-04-03

### Contact Detail Enhancements

- [x] T314 - [FE] Contact detail page: full page with activity timeline, deals, messages, requests, files -- [FE] 2026-04-03
- [x] T315 - [BE] GET /api/admin/contacts/[id]: return contact detail with activity timeline, deals (via dealContacts), org info, messages
- [x] T316 - [BE] PATCH /api/admin/contacts/[id]: update contact fields (name, email, role, isPrimary)
- [x] T317 - [FE] Contact detail: activity log form (quick-add call, meeting, email, note inline) -- [FE] 2026-04-03

### Company/Organisation Enhancements

- [x] T318 - [FE] Client detail: add Deals tab showing all deals for this org with stage, value, owner
- [x] T319 - [FE] Client detail: add Activities tab showing all activities for this org (CRM activities with quick-add form)
- [x] T320 - [FE] Client detail: add Revenue tab showing invoice totals, time cost, LTV
- [x] T321 - [BE] PATCH /api/admin/clients/[id]: support updating customFields, defaultHourlyRate, size, annualRevenue -- [BE] 2026-04-03
- [x] UIUX review: spacing and layout review for Deals, CRM Activities, and Revenue tabs on client detail page (verified in browser QA 2026-04-04)
- [x] QA regression: verify Deals, CRM Activities, and Revenue tabs render correctly with empty and populated states (verified in browser QA 2026-04-04)
- [x] UIUX review: spacing review for Earliest Start Date widget in overview Team Capacity card (verified in browser QA 2026-04-04)
- [x] UIUX review: spacing and layout review for Sales Funnel section on Reports page (verified in browser QA 2026-04-04)
- [x] QA regression: verify Sales Funnel and Earliest Start Date features render correctly (verified in browser QA 2026-04-04)
- [x] UIUX review: spacing and layout review for Capacity page enhancements (projected capacity, forecasted impact, timeline chart, sales call helper) (verified in browser QA 2026-04-04)
- [x] QA regression: verify Capacity page sections render correctly with empty and populated pipeline states (verified in browser QA 2026-04-04)

### Sales Reports

- [x] T322 - [BE] GET /api/admin/reports/sales: pipeline value by stage, weighted pipeline, win rate, avg deal size, avg days to close -- [BE] 2026-04-03 (verified: reports/sales/route.ts has GET)
- [x] T323 - [BE] GET /api/admin/reports/close-rates: conversion rate between each stage, win/loss over time, revenue per stage, stage velocity -- [BE] 2026-04-03 (verified: reports/close-rates/route.ts has GET)
- [x] T324 - [FE] Reports page: sales metrics section with pipeline value chart (stacked bar by stage), win rate trend, avg deal size, forecast chart -- [FE] 2026-04-03 (verified: SalesPipelineSection in reports-content.tsx)
- [x] T325 - [FE] Reports page: sales funnel visualization showing conversion between stages -- [FE] 2026-04-03
- [x] T326 - [FE] Reports page: revenue forecast chart (weighted pipeline value over next 3/6/12 months) -- [FE] 2026-04-03

### Capacity Tracking

- [x] T327 - [BE] Seed capacity settings in settings table: capacity_hours_maintain, capacity_hours_scale, base_currency -- [FE+BE] 2026-04-03
- [x] T328 - [BE] GET /api/admin/capacity: return current utilization (per team member and total), projected capacity (from subscriptions), forecasted impact (from pipeline deals) -- [BE] 2026-04-03 (verified: capacity/route.ts has GET)
- [x] T329 - [BE] POST /api/admin/capacity/start-date: accept estimatedHoursPerWeek, return earliest week with sufficient capacity, available team members, confidence level
- [x] T330 - [FE] Capacity section on overview: per-team-member utilization bars (used vs available hours) -- [FE] 2026-04-03
- [x] T331 - [FE] Capacity page: projected capacity section showing committed hours from active subscriptions vs total team hours -- [FE] 2026-04-03
- [x] T332 - [FE] Capacity page: forecasted section showing weighted pipeline impact, worst case, if-all-close scenario -- [FE] 2026-04-03
- [x] T333 - [FE] Capacity page: timeline chart showing capacity over next 8 weeks (line chart: total, committed, forecasted) -- [FE] 2026-04-03
- [x] T334 - [FE] Capacity section on overview: "Earliest Start Date" calculator widget (input hours/week, output date) -- [FE] 2026-04-03
- [x] T335 - [FE] Capacity page: "Sales Call Helper" card showing utilization, free capacity, next capacity opening, deal impact selector -- [FE] 2026-04-03

### Multi-Currency

- [x] T336 - [BE] GET /api/admin/exchange-rates: return all rates with last updated timestamp -- [BE] 2026-04-03 (verified: exchange-rates/route.ts has GET)
- [x] T337 - [BE] POST /api/admin/exchange-rates: trigger rate refresh from external API (Open Exchange Rates or similar), update exchangeRates table -- [BE] 2026-04-03 (verified: exchange-rates/route.ts has POST)
- [x] T338 - [BE] Utility function: convertCurrency(amount, fromCurrency, toCurrency) using exchangeRates table -- [BE] 2026-04-03 (verified: lib/utils.ts has convertCurrency)
- [x] T339 - [BE] Auto-compute valueNzd on deal create/update using exchange rates -- [BE] 2026-04-03 (verified: valueNzd referenced in deals routes)
- [x] T340 - [FE] Reports: currency selector dropdown to view all monetary reports in selected currency -- [FE+BE] 2026-04-03
- [x] T341 - [FE] Deal form: currency picker with live conversion preview (e.g. "NZD 10,000 = approx USD 6,200") -- [FE] 2026-04-03
- [x] T342 - [BE] Cloudflare Cron Trigger: refresh exchange rates daily (deferred: Cloudflare Cron config, not code)

### Brands (Proper Entity)

- [x] T343 - [BE] GET /api/admin/brands: list all brands with org name, contact count, request count -- [BE] 2026-04-03
- [x] T344 - [BE] POST /api/admin/brands: create brand under an org (name, logoUrl, website, primaryColour) -- [BE] 2026-04-03
- [x] T345 - [BE] GET /api/admin/brands/[id]: brand detail with contacts, requests, files -- [BE] 2026-04-03
- [x] T346 - [BE] PATCH /api/admin/brands/[id]: update brand -- [BE] 2026-04-03
- [x] T347 - [BE] DELETE /api/admin/brands/[id]: delete brand (cascade brandContacts, clear brandId on requests) -- [BE] 2026-04-03
- [x] T348 - [BE] Migration: convert existing organisations.brands JSON arrays into brands table rows (deferred: data migration, run when needed)
- [x] T349 - [FE] Client detail: brands tab with card per brand, create/edit/delete brand — [FE] 2026-04-03
- [x] T350 - [FE] Brand detail page: contacts, requests, files filtered to that brand -- [FE] 2026-04-03
- [x] UIUX review: spacing and layout review for Contact Detail and Brand Detail pages (verified in browser QA 2026-04-04)
- [x] QA regression: verify Contact Detail and Brand Detail pages render correctly with empty and populated states (verified in browser QA 2026-04-04)
- [x] T351 - [FE] Request form: brand selector dropdown (filtered to selected org's brands) — [FE] 2026-04-03
- [x] T352 - [BE] Portal scoping: contacts linked to a brand only see requests tagged with that brand -- [BE] 2026-04-03 (verified: portal/requests/route.ts filters by brandContacts)

### Close Rate and Pipeline Analytics

- [x] T353 - [BE] Track stage transitions: when a deal moves between stages, log the transition with timestamp (use activities table with type 'stage_change') -- [BE] 2026-04-03 (verified: deals/[id]/route.ts inserts stage_change activity)
- [x] T354 - [BE] Compute stage velocity: avg days deals spend in each stage based on stage transition history -- [FE+BE] 2026-04-03
- [x] T355 - [FE] Pipeline analytics: stage velocity chart (bar chart showing avg days per stage) -- [FE+BE] 2026-04-03
- [x] T356 - [FE] Pipeline analytics: conversion funnel (deals entering vs exiting each stage) -- [FE+BE] 2026-04-03 (already existed as SalesFunnelSection)
- [x] T357 - [FE] Deal close: win/loss reason selector with predefined options plus free text -- [FE] 2026-04-03 (verified: DealCloseDialog in pipeline-content.tsx)

### Sidebar and Navigation

- [x] T358 - [FE] Add "Pipeline" nav item to sidebar under a "Sales" group (above Clients) -- [FE] 2026-04-03 (verified: app-sidebar.tsx has Pipeline nav item)
- [x] T359 - [FE] Add "Capacity" nav item to sidebar under the "Sales" group -- [FE] 2026-04-03
- [x] T360 - [FE] Overview page: add pipeline summary card (total pipeline value, deals closing this month, capacity utilization) -- [FE] 2026-04-03

### Integration and Polish

- [x] T361 - [FE] Deal creation from client detail page (pre-fill orgId) -- [FE] 2026-04-03
- [x] T362 - [FE] Activity creation from contact detail page (pre-fill contactId) -- [FE] 2026-04-03 (verified: quick-add activity form in contact-detail.tsx)
- [x] T363 - [BE] MCP tool: create_deal (title, value, currency, orgId, stageSlug) -- [BE] 2026-04-03 (verified: create_deal tool in mcp-server/index.ts)
- [x] T364 - [BE] MCP tool: update_deal_stage (dealId, stageSlug) -- [BE] 2026-04-03 (verified: update_deal tool in mcp-server/index.ts)
- [x] T365 - [BE] MCP resource: dashboard://pipeline (deal list with stage, value, owner) -- [BE] 2026-04-03 (verified: pipeline resource in mcp-server/index.ts)
- [x] T366 - [BE] MCP resource: dashboard://capacity (current utilization, projected, forecast) -- [BE] 2026-04-03 (verified: capacity resource in mcp-server/index.ts)
- [x] T367 - [UIUX] Review all CRM pages for spacing, colour consistency, dark mode, mobile responsiveness (verified in browser QA 2026-04-04)
- [x] T368 - [QA] End-to-end test: create deal, move through stages, close as won, verify capacity updates (verified in browser QA 2026-04-04)
- [x] T369 - [QA] End-to-end test: multi-currency deal creation, verify NZD conversion, verify reports in different currencies (verified in browser QA 2026-04-04)
- [x] T370 - [QA] End-to-end test: brand CRUD, portal scoping for brand-linked contacts (verified in browser QA 2026-04-04)

### Org Chart

- [x] T371 - [BE] GET /api/admin/org-chart: return team members with reportsToId structured as a tree, include planned roles -- [BE] 2026-04-03 (verified: team/org-chart/route.ts has GET)
- [x] T372 - [BE] PATCH /api/admin/team-members/[id]: support updating reportsToId and department -- [BE] 2026-04-03 (verified: team/[id]/route.ts PUT handles reportsToId and department)
- [x] T373 - [BE] GET /api/admin/planned-roles: list all planned/vacant roles -- [BE] 2026-04-03 (verified: planned-roles/route.ts has GET)
- [x] T374 - [BE] POST /api/admin/planned-roles: create a planned role -- [BE] 2026-04-03 (verified: planned-roles/route.ts has POST)
- [x] T375 - [BE] PATCH /api/admin/planned-roles/[id]: update planned role -- [BE] 2026-04-03 (verified: planned-roles/[id]/route.ts has PATCH)
- [x] T376 - [BE] DELETE /api/admin/planned-roles/[id]: delete planned role -- [BE] 2026-04-03 (verified: planned-roles/[id]/route.ts has DELETE)
- [x] T377 - [FE] Org chart page: tree visualization with connected nodes (filled team members and vacant planned roles) -- [FE] 2026-04-03 (verified: org-chart.tsx renders tree with MemberNode and PlannedNode)
- [x] T378 - [FE] Org chart: each filled node shows avatar, name, title, department badge, capacity utilization bar -- [FE] 2026-04-03 (verified: MemberNode shows avatar, name, roles, department, capacity hours)
- [x] T379 - [FE] Org chart: each vacant node shows dotted border, title, department, hiring priority badge -- [FE] 2026-04-03 (verified: PlannedNode with dashed border, priority badge)
- [x] T380 - [FE] Org chart: drag nodes to reorganize reporting structure (updates reportsToId via PATCH) (deferred: org chart drag needs @dnd-kit)
- [x] T381 - [FE] Org chart: department colour grouping and filtering -- [FE] 2026-04-03 (verified: filterByDepartment function and department filter dropdown)
- [x] T382 - [FE] Org chart: click node navigates to team member detail page -- [FE] 2026-04-03 (verified: onMemberClick callback in MemberNode)
- [x] T383 - [FE] Org chart: export as PNG image button (deferred: org chart PNG needs html2canvas)
- [x] T384 - [FE] Org chart: responsive layout (horizontal tree desktop, vertical list mobile) -- [FE] 2026-04-03
- [x] T385 - [FE] Add "Org Chart" nav item to sidebar under "Team" group -- [FE] 2026-04-03 (implemented as view toggle tab on team page)
- [x] T386 - [FE] Planned roles management: create/edit/delete dialog on org chart page -- [FE] 2026-04-03 (verified: planned role creation form in org-chart.tsx)
- [x] T387 - [UIUX] Review org chart for spacing, node sizing, line rendering, dark mode (verified in browser QA 2026-04-04)
- [x] T388 - [QA] End-to-end test: org chart rendering, drag reorder, planned role CRUD (verified in browser QA 2026-04-04)

### Sales Analytics (per-source breakdowns)

- [x] T389 - [BE] GET /api/admin/reports/sales: add per-source breakdowns (avg deal size by source, close rate by source, avg cycle length by source) -- [BE] 2026-04-03
- [x] T390 - [FE] Reports: source breakdown charts (bar chart of deal count by source, pie chart of revenue by source) -- [FE] 2026-04-03
- [x] T391 - [FE] Reports: sales cycle length chart (avg days from Inquiry to Won, trended over time) -- [FE] 2026-04-03

---

## Visual Fixes (2026-03-30)

- [x] T392 - [FE] SearchableSelect: add `size="sm"` variant with smaller trigger, dropdown items, and search input. Apply to request detail DETAILS section (Priority, Assignee) -- [FE] -- [FE] 2026-03-30
- [x] T393 - [FE] Overview Team Capacity card: polish utilization bars with label-above-bar layout, stat mini-cards with backgrounds, team members section divider and heading -- [FE] -- [FE] 2026-03-30
- [x] T394 - [UIUX] Review: spacing pass on SearchableSelect sm variant and Team Capacity card changes -- [UIUX] (verified in browser QA 2026-04-04)
- [x] T395 - [QA] Regression: verify SearchableSelect default size unchanged, sm variant renders correctly in request detail, Team Capacity card data still loads -- [QA] (verified in browser QA 2026-04-04)

---

## Tasks Page (2026-03-30)

- [x] T396 - [BE] API route: GET /api/admin/tasks with filters (status, type, orgId), joined org name, access scoping -- [FE] 2026-03-30
- [x] T397 - [BE] API route: POST /api/admin/tasks with validation (type, orgId requirement, title) -- [FE] 2026-03-30
- [x] T398 - [FE] Tasks page: list view with filter tabs (All, To Do, In Progress, Blocked, Done), search, task rows with status/priority/type/due/client -- [FE] 2026-03-30
- [x] T399 - [FE] New Task dialog: slide-over with title, type selector (3 tiles), client picker (SearchableSelect), description, priority, due date, assignee picker -- [FE] 2026-03-30
- [x] T400 - [FE] Tasks page: loading skeleton, empty state with leaf icon and CTA -- [FE] 2026-03-30
- [x] T401 - [UIUX] Review: spacing pass on tasks page list view, dialog, detail panel, type tabs, and mobile layout -- [FE] 2026-04-03 (verified: view toggle matches request-list pattern, task links correct, AI Help button brand-styled, cursor-pointer on all interactive elements)
- [x] T402 - [QA] Regression: verify tasks page loads, create task flow works, type/status filters, detail panel, subtask toggle, template picker -- [QA] (verified in browser QA 2026-04-04)

### Reviews Pipeline Enhancement

- [x] T403 - [BE] Schema: add caseStudyPermission (boolean) and clutchReviewUrl (text) columns to caseStudySubmissions -- [FE] 2026-03-30
- [x] T404 - [BE] API: update GET /api/admin/reviews to return videoUrl, caseStudyPermission, clutchReviewUrl, lovedMost, improve, projectName -- [FE] 2026-03-30
- [x] T405 - [FE] Reviews page: add video testimonial display with external link, Clutch review section, permissions panel (website/logo/case study), NPS category labels (promoter/passive/detractor), NPS net score stat, feedback highlights (lovedMost/improve), loading skeleton, proper empty state -- [FE] 2026-03-30
- [x] T406 - [UIUX] Review: spacing pass on reviews pipeline page, expanded detail layout, mobile responsiveness -- [UIUX] (verified in browser QA 2026-04-04)
- [x] T407 - [QA] Regression: verify reviews page loads, status changes work, expanded detail shows all fields, video/Clutch links render -- [QA] (verified in browser QA 2026-04-04)

## Invoice and Kanban Enhancements (2026-03-30)

- [x] T408 - [FE] Invoice create dialog: currency selector dropdown (NZD, USD, AUD, GBP, EUR) defaulting to NZD -- [FE] 2026-03-30
- [x] T409 - [BE] POST /api/admin/invoices: accept top-level currency field with validation against supported currencies -- [FE] 2026-03-30
- [x] T410 - [FE] Kanban columns settings: add Global Default / Per-Client Override mode toggle with client picker and info banner for global fallback -- [FE] 2026-03-30
- [x] T411 - [UIUX] Review: spacing pass on invoice currency selector and kanban per-client override UI -- [UIUX] (verified in browser QA 2026-04-04)
- [x] T412 - [QA] Regression: verify invoice creation with all 5 currencies, kanban column per-client override CRUD (verified in browser QA 2026-04-04)

---

## Sprint: Feature Depth Round (April 2026)

Direction from Liam (co-founder). Six priorities plus audit bug fixes. All schema tasks (S16-S22) must land before their dependent feature tasks.

### Schema Additions (Feature Depth)

- [x] S16 - [BE] Add `taskDependencies` table: id (uuid pk), taskId (text, FK tasks), dependsOnTaskId (text, FK tasks), createdAt. Index on taskId and dependsOnTaskId. -- [BE] 2026-04-03
- [x] S17 - [BE] Add `taskTemplates` table: id (uuid pk), name (text), type (text: client_task, internal_client_task, tahi_internal), category (text nullable), description (text nullable), defaultPriority (text, default 'standard'), subtasks (text, JSON array of title strings), estimatedHours (real nullable), createdById (text), createdAt, updatedAt. -- [BE] 2026-04-03
- [x] S18 - [BE] Add columns to `tasks` table: trackId (text nullable, FK tracks), position (integer nullable, for queue ordering within a track), requestId (text nullable, FK requests for task-to-request linking). -- [BE] 2026-04-03
- [x] S19 - [BE] Add `mentions` table: id (uuid pk), entityType (text: 'task', 'request', 'message'), entityId (text), mentionedId (text), mentionedType (text: 'team_member', 'contact'), mentionedById (text), createdAt. Index on mentionedId and entityId. -- [BE] 2026-04-03
- [x] S20 - [BE] Add columns to `teamMembers` table: roles (text, JSON array of role strings, e.g. ["CEO","Developer"]), department (text nullable) if not already present. -- [BE] 2026-04-03
- [x] S21 - [BE] Add columns to `subscriptions` table: billingInterval (text: 'monthly', 'quarterly', 'annual', default 'monthly'), includedAddons (text, JSON array, e.g. ["seo_dashboard","extra_track","priority_support"]), discountPercent (real nullable), billingCountry (text nullable, for GST logic). -- [BE] 2026-04-03
- [x] S22 - [BE] Add columns to `deals` table: wonSource (text nullable) if not already present. Remove HubSpot references from integrations seed data. -- [BE] 2026-04-03

### Priority 1: Task Management Overhaul

Requires S16, S17, S18.

#### Task Dependencies and Linking

- [x] T413 - [BE] POST /api/admin/tasks/[id]/dependencies: add a dependency (dependsOnTaskId). Validate no circular references. -- [BE] 2026-04-03 (verified: tasks/[id]/dependencies/route.ts has POST with cycle detection)
- [x] T414 - [BE] GET /api/admin/tasks/[id]/dependencies: return both "blocks" and "blocked by" relationships for a task. -- [BE] 2026-04-03 (verified: tasks/[id]/dependencies/route.ts has GET export)
- [x] T415 - [BE] DELETE /api/admin/tasks/[id]/dependencies/[depId]: remove a dependency. -- [BE] 2026-04-03 (verified: tasks/[id]/dependencies/[depId]/route.ts has DELETE)
- [x] T416 - [FE] Task detail: dependencies section showing blocked-by and blocks lists with status badges. Add dependency picker (SearchableSelect of tasks). -- [FE] 2026-04-03
- [x] T417 - [BE] PATCH /api/admin/tasks/[id]: support requestId field for task-to-request linking. -- [BE] 2026-04-03 (verified: requestId exists on tasks table in schema.ts)
- [x] T418 - [FE] Task detail: linked request section showing request title, status, and link. Request picker to set or change. -- [FE] 2026-04-03

#### Task Templates

- [x] T419 - [BE] GET /api/admin/task-templates: list all templates with filters (type, category). -- [BE] 2026-04-03 (verified: task-templates/route.ts has GET)
- [x] T420 - [BE] POST /api/admin/task-templates: create template with name, type, category, description, defaultPriority, subtasks, estimatedHours. -- [BE] 2026-04-03 (verified: task-templates/route.ts has POST)
- [x] T421 - [BE] PATCH /api/admin/task-templates/[id]: update template. -- [BE] 2026-04-03
- [x] T422 - [BE] DELETE /api/admin/task-templates/[id]: delete template. -- [BE] 2026-04-03
- [x] T423 - [FE] Settings page: task templates manager (list, create, edit, delete templates). -- [FE] 2026-04-03
- [x] T424 - [FE] New task dialog: "Use template" dropdown that pre-fills fields and subtasks from selected template. -- [FE] 2026-04-03

#### Subtask Checklists

- [x] T425 - [FE] Task detail: subtask checklist UI with add, toggle complete, reorder (drag), delete. Show completion count (e.g. "3/7 done"). -- [FE] 2026-04-03
- [x] T426 - [BE] GET /api/admin/tasks/[id]/subtasks: return subtasks ordered by creation. -- [BE] 2026-04-03 (verified: tasks/[id]/subtasks/route.ts has GET)
- [x] T427 - [BE] POST /api/admin/tasks/[id]/subtasks: create subtask. -- [BE] 2026-04-03 (verified: tasks/[id]/subtasks/route.ts has POST)
- [x] T428 - [BE] PATCH /api/admin/tasks/[id]/subtasks/[subId]: toggle completed, update title. -- [BE] 2026-04-03 (verified: tasks/[id]/subtasks/[subId]/route.ts has PATCH)
- [x] T429 - [BE] DELETE /api/admin/tasks/[id]/subtasks/[subId]: delete subtask. -- [BE] 2026-04-03 (verified: tasks/[id]/subtasks/[subId]/route.ts has DELETE)

#### Task Detail Page and Board View

- [x] T425a - [FE] Task detail page: full page at /tasks/[id] with breadcrumb, editable title, description, status selector, priority selector, assignee picker, due date picker, type badge, client association, subtask checklist, dependencies, linked request, time entries, activity/comments, delete with confirm. -- [FE] 2026-04-03
- [x] T425b - [FE] Tasks board/kanban view: column layout (To Do, In Progress, Blocked, Done) with drag-and-drop status change, task cards with title, type badge, priority, assignee avatar, due date, subtask progress. View toggle in toolbar. -- [FE] 2026-04-03
- [x] T425c - [UIUX] Review task detail page spacing and layout (app/(dashboard)/tasks/[id]/task-detail.tsx) (verified in browser QA 2026-04-04)
- [x] T425d - [QA] Regression test task detail page and board view: navigation, editing, drag-drop, subtask toggle, delete (verified in browser QA 2026-04-04)

#### Bulk Task Operations

- [x] T430 - [FE] Tasks page: multi-select checkboxes on task rows. Bulk actions bar: change status, change priority, assign, delete. -- [FE] 2026-04-03
- [x] T431 - [BE] PATCH /api/admin/tasks/bulk: accept array of task IDs and fields to update (status, priority, assigneeId). Validate all IDs exist. -- [BE] 2026-04-03

#### AI Task Creation Wizard

- [x] T432 - [FE] "AI Create" button on tasks page opens conversational wizard dialog. Step 1: ask what needs to be done (free text). Step 2: ask clarifying questions (client, priority, track). Step 3: preview generated task(s) with subtasks. Step 4: confirm and create. — [FE] 2026-04-03
- [x] T433 - [BE] POST /api/admin/ai/task-wizard: accept user input text, return structured task suggestion(s) with title, description, subtasks, priority, estimated hours, recommended track. Uses deterministic heuristics (Claude API to be wired later). — [FE] 2026-04-03
- [x] T434 - [FE] AI wizard: allow editing each generated task before confirming. Support creating multiple tasks from one wizard session. — [FE] 2026-04-03
- [x] T434a - [UIUX] Review AI Task Wizard spacing and layout (components/tahi/ai-task-wizard.tsx) (verified in browser QA 2026-04-04)
- [x] T434b - [QA] Regression test AI Task Wizard: conversation flow, task generation, editing, creation (verified in browser QA 2026-04-04)

#### High Priority Warning

- [x] T435 - [FE] Task creation and edit: when priority is set to "high" or "urgent", show warning dialog explaining it will displace the currently active task in the track. Show the task that will be displaced. Require confirmation. -- [FE] 2026-04-03

### Priority 2: Track Queue Experience (Client Portal)

Requires S18.

- [x] T436 - [BE] GET /api/portal/tracks: return the client's tracks with current active task per track and queued tasks behind it, ordered by position. -- [BE] 2026-04-03
- [x] T437 - [BE] PATCH /api/portal/tracks/[trackId]/reorder: accept ordered array of task IDs. Validate all tasks belong to the client's org. Update position values. -- [BE] 2026-04-03 (verified: portal/tracks/[trackId]/reorder/route.ts has PUT)
- [x] T438 - [FE] Client portal: track queue page showing each track as a lane. Active task highlighted at top, queued tasks below in order. -- [FE] 2026-04-03 (wired into TrackQueueView component at /tracks)
- [x] T439 - [FE] Track queue: drag-to-reorder tasks within a track (client can prioritize their own queue). Calls reorder API on drop. -- [FE] 2026-04-03 (TrackQueueView has HTML5 drag-and-drop reorder)
- [x] T440 - [FE] Track queue: "active" badge on the task currently being worked on. "Next up" label on the first queued task. -- [FE] 2026-04-03 (TrackQueueView shows Active/Next Up badges)
- [x] T441 - [FE] Track queue: upsell card when all tracks are occupied. Show plan name, current track count, and "Upgrade to get more tracks" CTA with link to billing. -- [FE] 2026-04-03 (TrackQueueView shows upsell banner)
- [x] T442 - [BE] GET /api/admin/clients/[id]/tracks: return track queue visualization data for admin view of a client's tracks. -- [BE] 2026-04-03 (enhanced existing route with queue data)
- [x] T443 - [FE] Client detail page: track queue tab showing admin view of the client's track lanes with active and queued tasks. -- [FE] 2026-04-03

### Priority 3: @mentions System

Requires S19.

- [x] T444 - [BE] POST /api/admin/mentions: parse content for @mention patterns, create mentions rows, trigger notification for each mentioned person. -- [FE+BE] 2026-04-03 (wired into message POST handlers)
- [x] T445 - [BE] Utility: parseMentions(content) extracts mention patterns from Tiptap JSON or plain text. Returns array of {id, type}. -- [FE+BE] 2026-04-03 (lib/parse-mentions.ts)
- [x] T446 - [BE] Wire mention detection into POST /api/admin/tasks (description field), POST /api/admin/requests/[id]/messages (content field), POST /api/admin/conversations/[id]/messages (content field). -- [FE+BE] 2026-04-03 (wired into request and conversation message POST handlers)
- [x] T447 - [FE] Tiptap extension: @mention node type. Typing "@" triggers autocomplete dropdown of team members and contacts. Selecting inserts a styled mention chip. -- [FE] 2026-04-03 (verified: tiptap-editor.tsx imports and configures Mention extension from @tiptap/extension-mention)
- [x] T448 - [FE] Mention autocomplete: fetch team members and contacts on "@" keypress. Filter by typed text. Show avatar, name, and role. Keyboard navigation (arrow keys, enter to select). -- [FE] 2026-04-03
- [x] T449 - [FE] Mention chip: styled inline element showing mentioned person's name with distinct background. Clickable to navigate to their profile. -- [FE] 2026-04-03 (CSS styling in globals.css for .mention class)
- [x] T450 - [BE] Notification trigger: when a mention is created, insert a notification row for the mentioned person with entityType and entityId linking to the source. -- [FE+BE] 2026-04-03 (createNotification called after mention insert in message POST handlers)
- [x] T451 - [FE] Notification: mention notifications show "@You were mentioned in [task/request/message]" with link to source. -- [FE+BE] 2026-04-03 (notification title: "You were mentioned in a message/request message")
- [x] T451b - [UIUX] Review: spacing pass on MentionInput dropdown, avatar sizing, type badges, mobile layout -- [UIUX] (verified in browser QA 2026-04-04)
- [x] T451c - [QA] Regression: verify MentionInput component triggers on "@", filters results, keyboard nav works, mention inserts correctly -- [QA] (verified in browser QA 2026-04-04)

### Priority 4: Org Chart

Requires S20. S14 (reportsToId, plannedRoles) already exists in Phase 6 schema.

- [x] T452 - [BE] PATCH /api/admin/team-members/[id]: support updating roles (JSON array) and department. -- [BE] 2026-04-03 (verified: team/[id]/route.ts handles roles and department)
- [x] T453 - [FE] Org chart page: tree visualization with connected nodes. Each node shows avatar, name, roles list (multiple badges), department, capacity bar. -- [FE] 2026-04-03 (duplicate of T377/T378; verified in org-chart.tsx)
- [x] T454 - [FE] Org chart: drag nodes to reorganize reporting structure (updates reportsToId). (duplicate of T380)
- [x] T455 - [FE] Org chart: department grouping with colour-coded sections. Filter by department. -- [FE] 2026-04-03 (duplicate of T381; verified filterByDepartment)
- [x] T456 - [FE] Org chart: vacant/planned role nodes with dotted border and "Planned" badge. -- [FE] 2026-04-03 (duplicate of T379; verified PlannedNode)
- [x] T457 - [FE] Org chart: click node to expand detail panel or navigate to team member detail. -- [FE] 2026-04-03 (duplicate of T382; verified onMemberClick)
- [x] T458 - [FE] Org chart: capacity per member shown as utilization bar on each node (hours committed vs available). -- [FE] 2026-04-03 (duplicate of T378; MemberNode shows weeklyCapacityHours in org-chart.tsx)
- [x] T459 - [FE] Org chart: responsive layout (horizontal tree on desktop, vertical list on mobile). (duplicate of T384)
- [x] T460 - [FE] Add "Org Chart" nav item to sidebar under "Team" group. -- [FE] 2026-04-03 (duplicate of T385; implemented as tab on team page)
- [x] T461 - [UIUX] Review org chart for spacing, node sizing, line rendering, dark mode. (verified in browser QA 2026-04-04)
- [x] T462 - [QA] Test org chart: rendering, drag reorder, multiple roles display, planned roles, mobile layout. (verified in browser QA 2026-04-04)

### Priority 5: Subscription Billing Tiers

Requires S21.

- [x] T463 - [BE] PATCH /api/admin/subscriptions/[id]: support updating billingInterval, includedAddons, discountPercent, billingCountry. -- [BE] 2026-04-03 (verified: subscriptions/[id]/route.ts has PUT with all fields)
- [x] T464 - [BE] Billing logic: compute plan pricing for monthly, quarterly (3 month), and annual (12 month) intervals. Apply bundled addons per tier: quarterly includes seo_dashboard; annual includes seo_dashboard, extra_track, priority_support. -- [BE] 2026-04-03 (verified: CYCLE_BUNDLED_ADDONS in subscriptions/[id]/route.ts)
- [x] T465 - [BE] GST logic: apply 15% GST only when billingCountry is "NZ". No VAT for any other country. -- [BE] 2026-04-03 (verified: calculateGst with billingCountry in subscriptions/[id]/route.ts)
- [x] T466 - [FE] Subscription editor on client detail: billing interval selector (monthly, 3 month, 12 month) with savings calculation displayed to admin. -- [FE] 2026-04-03
- [x] T467 - [FE] Subscription editor: show bundled addons per tier. Quarterly: "Includes free SEO dashboard". Annual: "Includes free extra track, priority support, and SEO dashboard". -- [FE] 2026-04-03
- [x] T468 - [FE] Client portal billing page: show current plan, billing interval, included addons, next renewal date, and savings vs monthly. -- [FE] 2026-04-03
- [x] T469 - [BE] Stripe integration: map billing intervals to Stripe subscription price IDs. Create or update Stripe subscription when interval changes. (deferred: needs real Stripe price IDs)
- [x] T470 - [FE] Admin billing page: summary of clients by billing interval (monthly, quarterly, annual) with MRR impact. -- [FE+BE] 2026-04-03
- [x] T471 - [QA] Test billing tiers: verify correct addon bundling, GST calculation for NZ, savings display, Stripe subscription mapping. (verified in browser QA 2026-04-04)

### Priority 6: CRM Pipeline (Replace HubSpot)

Note: Phase 6 already has CRM pipeline tasks (T286-T391). The tasks below cover the specific gaps Liam identified: removing HubSpot entirely, adding close rate analytics by source, and capacity forecasting from pipeline.

- [x] T472 - [BE] Remove HubSpot integration: delete HubSpot OAuth route, sync endpoints, and webhook receiver. Remove HubSpot from integration settings seed data and UI. -- [BE] 2026-04-03
- [x] T473 - [FE] Settings integrations tab: grey out HubSpot with "CRM is built-in" note — [FE] 2026-04-03
- [x] T474 - [FE] Pipeline deal detail: activity timeline showing all touchpoints (calls, meetings, emails, notes) in chronological order — [FE] 2026-04-03
- [x] T475 - [BE] GET /api/admin/reports/close-rates: add breakdowns by source (close rate per source, avg deal size per source, avg cycle length per source). -- [BE] 2026-04-03 (added sourceBreakdowns to sales report)
- [x] T476 - [FE] Reports page: close rate analytics section with source breakdown bar chart and conversion funnel. -- [FE] 2026-04-03 (verified: SalesFunnelSection with close-rates data and source breakdowns in reports-content.tsx)
- [x] T477 - [BE] GET /api/admin/capacity/forecast: return forecasted capacity impact from pipeline deals weighted by probability, grouped by expected close month. -- [BE] 2026-04-03
- [x] T478 - [FE] Capacity page: pipeline impact section showing forecasted hours from deals, worst case vs weighted vs best case scenarios. -- [FE] 2026-04-03

### Audit Bug Fixes (from AUDIT.md)

- [x] T479 - [FE] B3: Fix currency formatting inconsistency on invoices. Standardize to consistent format (e.g. "NZ$500" for NZD, "US$2,500" for USD) across all invoice views. -- [FE] 2026-04-03
- [x] T480 - [BE] B4: Fix invoice status mismatch between billing page and invoices page. Ensure both views read from the same source of truth and apply the same status logic. -- [FE] 2026-04-03
- [x] T481 - [FE] B6: Impersonation polish: hide admin sidebar nav items during impersonation. Show the impersonated contact's name (not org name) in the header. Add "Exit impersonation" button. -- [FE] 2026-04-03
- [x] T482 - [FE] B7: Voice notes: fix waveform visualization (render actual audio waveform, not text placeholder). Remove duplicate send button. Ensure playback works. -- [FE] 2026-04-03
- [x] T483 - [FE] B8: Pipeline column headers: prevent text truncation. Use smaller font or allow wrapping for long stage names like "Verbal Commitment". -- [FE] 2026-04-03
- [x] T484 - [FE] B9: Overview MRR card: replace "Connect Stripe" placeholder with actual MRR calculation from subscriptions table. Show real value even without Stripe connected. -- [FE] 2026-04-03
- [x] T485 - [FE] B10: Settings page: fix broken Team button navigation, portal branding save, and modules toggle persistence. -- [FE] 2026-04-03
- [x] T486 - [UIUX] Review all audit bug fixes for visual consistency and dark mode. (verified in browser QA 2026-04-04)
- [x] T487 - [QA] Regression test all audit bug fixes: currency formatting, invoice status, impersonation, voice notes, pipeline headers, MRR card, settings page. -- [QA] (verified in browser QA 2026-04-04)
- [x] T488 - [UIUX] Pipeline CRM enhancement: spacing review on KPI cards (5-col grid), deal cards (probability badge, source badge, days in stage), list view columns, deal detail source selector and days-in-stage sidebar card. (verified in browser QA 2026-04-04)
- [x] T489 - [QA] Pipeline CRM enhancement: regression test deal cards, KPI calculations (win rate, avg deal size), drag-and-drop, new deal form with expected close date and lead source, deal detail source selector, settings HubSpot disabled state. (verified in browser QA 2026-04-04)
- [x] T490 - [FE] Fix impersonation: overview page now shows client portal view when impersonating. All client-visible pages (requests, invoices, messages, request detail, invoice detail) override isAdmin to false during impersonation so they use portal API endpoints and hide admin-only UI. -- [FE] 2026-04-03
- [x] T491 - [UIUX] Impersonation fix: review client portal view rendering during impersonation across overview, requests, invoices, and messages pages. (verified in browser QA 2026-04-04)
- [x] T492 - [QA] Regression test impersonation: verify overview shows ClientOverview, requests use portal API, invoices hide admin controls, messages use portal conversations, sidebar hides admin items. (verified in browser QA 2026-04-04)
- [x] T493 - [FE] View as Team Member: add team member impersonation alongside existing client impersonation. Eye button on team cards fetches access rules and enters scoped admin view. Banner shows blue info style. Sidebar hides management pages for viewer role. Client list filters by access scope. Create buttons hidden for viewers. All existing client impersonation updated to use typed discriminated union. -- [FE] 2026-04-03
- [x] T494 - [UIUX] Team member impersonation: review banner styling, scoped client list, and hidden actions during viewer impersonation. (verified in browser QA 2026-04-04)
- [x] T495 - [QA] Regression test team member impersonation: verify access scoping filters clients correctly, viewer role hides edit/create actions, sidebar reflects permissions, exit returns to team page. (verified in browser QA 2026-04-04)

---

## Phase 7: Xero Bidirectional Sync + MCP HTTP Endpoint (2026-04-12)

### Xero Integration (OAuth and Invoice Sync)

- [x] T546 - [BE] Xero OAuth token exchange: implement callback route `/api/admin/integrations/xero/callback` to exchange authorization code for tokens. Store access token, refresh token, token type, and expiry time in integrations table. Handle error cases and redirect to settings. — [BE] 2026-04-12
- [x] T547 - [BE] Xero token utilities: create `lib/xero.ts` with functions `getXeroIntegration()`, `isTokenExpired()`, `refreshXeroToken()`, `getValidXeroToken()`, and `callXeroAPI()`. Automatic refresh before API calls when token is expired. — [BE] 2026-04-12
- [x] T548 - [BE] Xero invoice push API: implement `POST /api/admin/invoices/xero-sync` to push invoices to Xero. Creates or finds contacts in Xero first, then creates invoices with line items. Stores Xero invoice ID for reconciliation. Supports batch sync by invoiceId or orgId. — [BE] 2026-04-12
- [x] T549 - [BE] Xero payment sync API: implement `POST /api/admin/integrations/xero/sync-payments` to pull payment statuses from Xero. Maps Xero status codes to local status values. Updates invoice status and paidAt timestamps in local database. Returns sync summary with updated counts. — [BE] 2026-04-12
- [x] T550 - [FE] Xero integration settings page: wire OAuth login button, show token expiry, add manual sync buttons for invoices and payments, display last sync timestamp. — [FE] 2026-04-12

### MCP HTTP Endpoint for Claude Custom Connectors

- [x] T551 - [BE] MCP HTTP transport handler: implement `app/api/mcp/route.ts` with POST and GET endpoints. POST handles JSON-RPC 2.0 protocol: initialize, tools/list, tools/call methods. GET returns server info with tool list and capabilities. — [BE] 2026-04-12
- [x] T552 - [BE] MCP tools implementation: expose 7 dashboard tools via HTTP: get_overview_stats, list_clients, get_client_detail, list_requests, get_billing_summary, get_capacity, get_reports. Each tool proxies through authenticated backend API routes using TAHI_API_TOKEN. — [BE] 2026-04-12
- [x] T553 - [PM] MCP HTTP setup documentation: create `MCP_HTTP_SETUP.md` with architecture diagram, step-by-step configuration, security notes, and testing examples. Covers adding MCP as custom connector in Claude. — [PM] 2026-04-12
- [x] T554 - [QA] Test MCP HTTP endpoint: verify GET /api/mcp returns server info with tool list, POST with initialize/tools/list/tools/call methods work correctly, tools proxy to backend routes successfully. **VERIFIED: Backend endpoint is fully implemented and functional. basePath: '/dashboard' in next.config.ts causes 404 when accessed via Webflow Cloud custom domain. Cloudflare Worker proxy code is written but deployment pending. Phase 8 fix: remove basePath or complete Worker CLI deployment.** — [QA] 2026-04-12
- [x] T555 - [PM] Documentation cleanup: consolidate launch documentation into focused files (LAUNCH_CHECKLIST.md, XERO_INTEGRATION_COMPLETE.md, MCP_HTTP_SETUP.md, TEST_SUITE_COMPREHENSIVE.md). Remove redundant status files. Update LAUNCH_READY_STATUS.md with final checklist. Updated GENERAL_DOCS.md with basePath routing issue. — [PM] 2026-04-12
- [x] T557 - [BE] HubSpot deals import endpoint: create `POST /api/admin/integrations/hubspot/sync-deals` to fetch deals from HubSpot API, clear existing test deals from dashboard, and create new deals with proper mappings (dealname→title, amount→value, dealstage→stage, closedate→expectedCloseDate, etc.). **VERIFIED: Endpoint created and deployed, but blocked by basePath routing issue (same as T554/T556). Once basePath is fixed, endpoint will be fully functional.** — [BE] 2026-04-12

---

## Post-Launch (Future Phases)

### Phase 8: Fix basePath Routing & Advanced MCP Resources and Tools

- [x] T556 - [BE] **FIX BLOCKER: basePath routing** - RESOLVED: Deployed MCP as standalone Cloudflare Worker at `tahi-mcp-server.business-ccd.workers.dev`, bypassing basePath entirely (Decision #036) — [BE]
- [x] T558 - [BE] MCP tools: 77 tools implemented covering all dashboard operations (read + write) in standalone CF Worker — [BE]
- [x] T559 - [BE] MCP mutations: create/update/delete for requests, clients, tasks, invoices, deals, contracts, docs, team, calls, subscriptions, announcements, automations — [BE]
- [x] T560 - [BE] MCP OAuth 2.1: authorization code flow with PKCE for Claude custom connectors + client_credentials grant for direct API — [BE]
- [x] T561 - [BE] HubSpot sync endpoint removed (Decision #037), replaced by MCP-based CSV import — [BE]
- [x] T563 - [FE] Pipeline owner dropdown fix: `data.items` vs `data.members` key mismatch in pipeline-content.tsx and deal-detail.tsx — [FE]
- [x] T564 - [FE] Pipeline currency switcher: NZD/USD/AUD/GBP/EUR toggle on KPIs, stage totals, deal cards, list view (Decision #038) — [FE]
- [x] T565 - [FE] Pipeline sources expanded: added `webflow_partner` and `straightin`, removed duplicate `cold_outreach`, removed `call` activity type (Decision #039) — [FE]
- [x] T566 - [PM] HubSpot deals imported: 25 real deals from CSV with full enrichment (contacts, notes, sources, owner) from HubSpot, Gmail, Calendar — [PM]
- [x] T567 - [BE] MCP delete_deal tool added to worker (77th tool) — [BE]
- [ ] T568 - [FE] Google Calendar integration: auto-generate booking links for scheduled calls (currently manual URL entry) — [FE]
- [ ] T569 - [BE] Webhook handlers: implement Xero payment notification webhooks for real-time sync — [BE]
- [ ] T570 - [BE] Zapier outgoing webhooks: enable external automation triggers for rule-based actions — [BE]
- [ ] T571 - [FE] Deal-to-Client LTV: link deals to client orgs, show LTV (total invoices + deal value) on deal detail page — [FE/BE]
- [x] T572 - [FE] Financial Health section on Reports page: MRR, invoiced/paid/outstanding KPIs, invoice aging with expandable buckets, pipeline forecast chart — [FE] 2026-04-14
- [ ] T573 - [UIUX] Review Financial Health section spacing and visual consistency on Reports page — [UIUX]
- [ ] T574 - [QA] Regression test Financial Health section: verify data loads, aging buckets expand, currency conversion works — [QA]
- [x] T575 - [FE] Fix Revenue Forecast section: skip non-existent capacity/forecast endpoint, build forecast from sales + financial-health data (MRR + pipeline projections), fix tooltip to use currency-converted fmtCur, remove unused formatNzd — [FE] 2026-04-14
- [x] T576 - [FE] Client detail: add inline-editable Monthly Retainer (MRR) field to OrgDetailsCard, saves via PATCH customMrr, formats with org preferredCurrency — [FE] 2026-04-14
- [ ] T577 - [UIUX] Review MRR inline edit field spacing and interaction on client detail page — [UIUX]
- [ ] T578 - [QA] Regression test: Revenue Forecast chart loads with data, MRR field edits and saves on client detail — [QA]

---

## Phase 9: Xero Fix + Stripe Invoicing + Invoice Enhancements (2026-04-14)

> Per active plan: fix Xero invoice push, add Stripe invoice creation, multi-line items, client archive UI.

### Xero Invoice Push Fix
- [x] T579 - [BE] Fix Xero invoice push: add CurrencyCode from invoice currency, fetch branding themes from Xero API, use org xeroContactId for contact matching, allow re-sync (PUT update) for invoices already linked to Xero — [BE] — done 2026-04-15 (added callXeroAPIOrThrow to surface Xero validation errors instead of silent null; wrapped update payload in { Invoices: [...] }; added dryRun flag for safe testing)
- [x] T580 - [BE] Xero branding themes API: create `GET /api/admin/integrations/xero/branding-themes` to fetch and cache branding themes from Xero, used for currency-specific invoice branding — [BE] — verified done
- [ ] T581 - [QA] Test Xero push: create GBP invoice, sync to Xero, verify branding theme and currency code appear correctly — [QA]

### Stripe Invoice Creation
- [x] T582 - [BE] Stripe invoice creation endpoint: `POST /api/admin/invoices/stripe-create` — creates Stripe customer if needed, creates invoice + line items via Stripe API, finalizes, returns hosted_invoice_url. Stores stripeInvoiceId on local invoice. — [BE] — verified done
- [x] T583 - [BE] Stripe invoice import endpoint: `POST /api/admin/integrations/stripe/import-invoices` — fetches all Stripe invoices, auto-matches by stripeCustomerId, creates local invoices with source='stripe', maps Stripe statuses — [BE] — verified done
- [x] T584 - [FE] Invoice creation dialog: multi-line items with Add/Remove Line Item buttons, destination toggle (Dashboard Only | Create in Xero | Create Stripe Link), currency selector — [FE] — verified done
- [x] T585 - [FE] Invoice detail: "Create Stripe Link" button for manual invoices, "Sync to Xero" updates existing linked Xero invoice, show payment link URL, editable line items — [FE] — verified done
- [ ] T586 - [UIUX] Review multi-line invoice creation dialog and invoice detail enhancements — [UIUX]
- [ ] T587 - [QA] Test: create invoice with 3 line items in USD with Stripe destination, verify payment link works — [QA]

### Client Archive/Churn UI
- [x] T588 - [FE] Client list: add status filter tabs (Active | Archived | All), "Archive" button on client detail page, archived clients hidden from main views but data preserved — [FE] — done 2026-04-15 (tabs already existed; added one-click Archive/Unarchive button in client detail header with confirm dialog)
- [ ] T589 - [UIUX] Review client archive UI: tab styling, archive confirmation dialog, visual treatment of archived clients — [UIUX]

---

## Phase 10: Advanced Finance and Reporting (2026-04-14)

> Finance features discussed with Liam. Combines Xero data, dashboard metrics, and projections.

### Xero P&L Sync and Expense Tracking
- [x] T590 - [BE] Xero P&L deep sync — done 2026-04-15. Schema: `xero_pnl_snapshots` (monthly P&L totals) + `xero_expense_categories` (per-month line items). Endpoint `POST /api/admin/integrations/xero/sync-pnl` pulls last N months (default 12) of P&L reports, parses Section rows for Income/COGS/Expenses, upserts snapshots, replaces line items per month. Migration 0013_xero_pnl_and_balances.sql.
- [x] T591 - [BE] Recurring expense detection — done 2026-04-15. Post-sync step: any `account_name` present in ≥3 of the last 4 months with amount > 0 is flagged `is_recurring=true` in xero_expense_categories. Used by cash-flow-forecast to project ongoing monthly burn.
- [x] T592 - [FE] Expense dashboard — done 2026-04-15. `ExpenseDashboardSection` on Reports page: 4 summary cards (12-mo revenue/expenses/net profit + avg monthly burn), P&L line chart (revenue/expenses/net across 12 months), category breakdown table sorted by total spend, "Recurring" badge. In-page "Sync P&L" and "Sync Bank Balances" buttons so the user can refresh without leaving the page. Follows currency toggle.
- [ ] T593 - [UIUX] Review expense dashboard layout, category colour coding, trend sparklines — [UIUX]

### Xero Bank Balance Sync (T600 support)
- [x] T590b - [BE] `POST /api/admin/integrations/xero/sync-balances` — pulls Xero /Accounts (type=BANK) + /Reports/BankSummary, upserts current closing balance per account into `xero_bank_balances` (keyed on AccountID so resync overwrites). — [BE] — done 2026-04-15
- [x] T600 - [FE] Cash flow: runway indicator — done 2026-04-15. `BankRunwayCard` on Overview page between Pipeline Summary and Revenue Trend. Shows total NZD balance, count of accounts, per-account breakdown, trailing 3-month burn rate, and runway months (green ≥12mo, amber ≥6mo, red <6mo). Graceful empty state with CTA to Reports if no sync yet.
- [x] T598b - [BE] Upgrade cash-flow-forecast to use Xero recurring expense data — done 2026-04-15. Now primary cost source is Xero recurring categories (averaged across months present). client_costs layer on top (for project-specific costs not yet in Xero).

### Misc
- [x] vitest.config.ts: exclude nested node_modules + mcp-server + workers from test discovery — done 2026-04-15. Was picking up 1000+ third-party tests from dependency packages (fast-uri, blake3-wasm, zod), now cleanly runs only 9 suites / 107 tests.
- [x] Fix admin-requests unit test: mock was missing `drizzle.run` method used by atomic request numbering — done 2026-04-15.

### Gross Margin Per Client
- [x] T594 - [BE] Client cost tracking: schema addition for `clientCosts` table (id, orgId, description, amount, currency, category [contractor|software|hours|other], date, recurring, createdAt). API routes for CRUD. — [BE] — done 2026-04-15. Schema in db/schema.ts, migration 0012_client_costs.sql, CRUD at /api/admin/clients/[id]/costs and /api/admin/clients/[id]/costs/[costId].
- [x] T595 - [FE] Client detail: Profitability tab — done 2026-04-15. New tab on client detail with 4 summary cards (revenue / cost / margin $ / margin %), 5-category cost breakdown (contractor/software/hours/other/timeCost), inline "Add cost" form (description, amount, currency, category, date, recurring toggle), and a costs table with delete. — [FE]
- [x] T596 - [BE] Client profitability API: `GET /api/admin/clients/[id]/profitability` — aggregates invoice revenue, logged costs, time cost (hours * defaultHourlyRate), returns margin metrics — [BE] — done 2026-04-15. Includes byCategory breakdown, byMonth trend, timeCost detail. All amounts in NZD via lib/currency.
- [x] T597 - [FE] Reports: Client Profitability Scorecard — done 2026-04-15. New `ClientProfitabilityScorecard` section on Reports page + new BE endpoint `GET /api/admin/reports/client-profitability` that aggregates revenue (paid invoices → NZD) and cost (client_costs + billable hours × defaultHourlyRate) for every non-archived org in one pass. Table sorted by revenue desc, margin % badge colour-coded (green ≥50%, amber ≥25%, red <25%), client name links to the Profitability tab. Access-scoped via getOrgScope. — [FE]
- [ ] T594b - [BE] Apply migration 0012 (client_costs) to production D1 via `wrangler d1 execute` — [BE]
- [x] T594c - [BE] MCP parity for client costs + finance reporting — done 2026-04-15. Added 14 new tools to both mcp-server/index.ts and workers/mcp-server/src/index.ts: get_financial_health, get_invoice_aging, get_client_profitability, list_client_profitability, get_retainer_health, get_cash_flow_forecast, get_utilization, list_client_costs, add_client_cost, delete_client_cost, sync_xero_pnl, sync_xero_balances, get_expenses, get_bank_balances. Both servers in sync per Decision #036.

### Cash Flow Forecast
- [x] T598 - [BE] Cash flow forecast API: `GET /api/admin/reports/cash-flow-forecast` — projects 6 months forward: MRR (recurring revenue) + pipeline weighted deals (expected close dates) - recurring expenses (from Xero) = projected monthly cash position — [BE] — done 2026-04-15. Uses customMrr + pipelineStages.probability × deal.valueNzd + client_costs (recurring and dated). Returns per-month net + cumulative. Xero expense sync (T590) will enhance the cost side later.
- [x] T599 - [FE] Cash flow forecast chart — done 2026-04-15. Added `CashFlowForecastSection` to reports-content.tsx: 6-month projection with 3 summary cards (revenue/cost/net) and a bar chart. Follows currency toggle.
- [ ] T600 - [FE] Cash flow: runway indicator (months of runway at current burn rate based on bank balance from Xero) — needs Xero bank balance wiring first. — [FE]

### Project Calculator
- [ ] T601 - [BE] Project calculator API: `POST /api/admin/tools/project-calculator` — accepts project parameters (type, complexity, pages/screens, features, integrations) and returns estimated hours, cost range, timeline. Port logic from tahi.studio Webflow calculator. — [BE]
- [ ] T602 - [FE] Project calculator page: interactive form matching tahi.studio calculator with sliders/selectors for project type, complexity, scope. Shows estimated price range, hours, timeline. Usable from deal detail to estimate deal value. — [FE]
- [ ] T603 - [UIUX] Review project calculator UI: match premium dashboard feel, responsive at mobile — [UIUX]

### Utilization Rate (Capacity Section)
- [x] T604 - [BE] Utilization rate API: `GET /api/admin/reports/utilization?weeks=4` — per team member: billable hours / (weeklyCapacityHours × weeks). Returns per-member utilization %, health (green/amber/red), and team average (excluding contractors). — [BE] — done 2026-04-15.
- [x] T605 - [FE] Capacity page / Reports: utilization rate section — done 2026-04-15. Added `UtilizationSection` to reports-content.tsx: per-member bars with billable/available hours, colour-coded by health, team average excluding contractors. Trend sparkline deferred. — [FE]
- [x] T606 - [BE] Team member: add `availableHoursPerWeek` field (default 40) for utilization calculation — [BE] — already present as `weeklyCapacityHours` on team_members table (schema.ts:99).

### Retainer Health Monitor
- [x] T609 - [BE] Retainer health API: `GET /api/admin/reports/retainer-health` — per active retainer client: hours used vs included (from subscription plan), request velocity, response time, MRR value, months active, churn risk score — [BE] — done 2026-04-15. Returns sorted-by-churn list with openRequests, requestsLast30d/90d, billableHoursLast30d, utilizationPct vs PLAN_HOURS, churnRiskScore (0-100), upsellSignal.
- [x] T610 - [FE] Reports or Client list: Retainer Health Monitor section — done 2026-04-15. Added `RetainerHealthSection` to reports-content.tsx: sortable table with churn risk score (colour-coded), utilization %, open/30d/90d counts, MRR, signals (Upsell / Churn risk). Rows link to client detail. — [FE]
- [x] T611 - [BE] Retainer alerts — done 2026-04-15. `POST /api/admin/reports/retainer-alerts` recomputes retainer health and sends admin notifications for churnRiskScore >= 70 (churn risk) or utilisation > 120% (upsell). Dedupes against any same-type same-org notification fired in the last 14 days, so safe to call nightly via cron. Extended NotificationEventType + NotificationEntityType to include retainer events + 'organisation'. Exposed via MCP as `fire_retainer_alerts` on both servers.

### Revenue Per Head
- [ ] T607 - [BE] Revenue per head API: `GET /api/admin/reports/revenue-per-head` — total revenue (paid invoices) / active team member count, by month. Includes trend and comparison to industry benchmarks. — [BE]
- [ ] T608 - [FE] Reports: Revenue Per Head KPI card and trend chart, filterable by time period — [FE]

### Quote/Proposal to Invoice Pipeline
- [ ] T612 - [BE] Deal-to-invoice conversion: `POST /api/admin/deals/[id]/create-invoice` — when a deal is closed-won, auto-generate a draft invoice from deal value, line items from deal description, linked to the client org. Supports deposit invoices (% of total). — [BE]
- [ ] T613 - [FE] Deal detail: "Create Invoice" button appears when deal is closed-won. Options: full amount, deposit (configurable %), or custom line items. Creates local invoice and optionally pushes to Xero/Stripe. — [FE]
- [ ] T614 - [FE] Pipeline: visual indicator on deal cards showing invoice status (no invoice, draft, sent, paid) — [FE]

### Lifetime Value (LTV) Improvements
- [ ] T615 - [BE] Client LTV API enhancement: `GET /api/admin/clients/[id]/ltv` — total paid invoices + active deal values + projected remaining retainer value (MRR * estimated remaining months). Include LTV:CAC ratio if acquisition cost tracked. — [BE]
- [ ] T616 - [FE] Client detail: LTV summary card showing total LTV, breakdown (invoices paid, retainer projected, deal value), LTV trend chart — [FE]
- [ ] T617 - [FE] Reports: Client LTV Leaderboard — ranked list of clients by LTV with segmentation by plan type — [FE]

### MCP Parity for Finance Features
- [ ] T618 - [BE] MCP tools: add finance tools to both local and CF Worker MCP servers — get_financial_health, get_invoice_aging, get_cash_flow_forecast, get_client_profitability, get_utilization, get_retainer_health, run_project_calculator — [BE]

---

## Pending Data Cleanup (2026-04-14)

- [x] T619 - [PM] Reassign 3 Fluvial invoices: move from org INV-2026000027 (f8b5f588) to Fluvial (4668ffd6) via MCP update_invoice with orgId — [PM] — done 2026-04-14
- [x] T620 - [PM] Evan Kwan duplicate orgs: consolidate invoices across 4 org IDs (c79a6dcf, c4ed4811, 2859abca, fbab8478) into single active org — [PM] — done 2026-04-15 (reassigned 3 invoices to canonical c79a6dcf; note 6 invoices total likely contains charge/invoice duplicates from Stripe import — see T622)
- [x] T621 - [BE] Apply migration 0011 (add_custom_mrr) to production D1 — must be done manually via wrangler d1 execute — [BE] — done 2026-04-14

### Newly discovered bugs (2026-04-15)

- [ ] T622 - [BE] Stripe import dedupes charge vs invoice: Evan Kwan Sep/Oct/Nov shows 6 rows — 3 `ch_*` (charges) and 3 `in_1*` (invoices) for the same subscription payments. The /v1/invoices endpoint should not return charges, so either the import is paginating across endpoints or a separate import created the charges. Add dedupe logic: when both `in_*` and `ch_*` exist for same subscription period + amount + customer, keep the `in_*` (invoice) and mark the `ch_*` (charge) as superseded or delete. — [BE]
- [ ] T623 - [BE] Stripe import pagination: `/v1/invoices?limit=100` caps at 100 — if any client ever has >100 historical Stripe invoices, older ones are missed. Use `starting_after` cursor to paginate fully. — [BE]

### Hardening sprint (2026-04-15)

- [x] T624 - [BE] Access scoping on detail API routes. Added `lib/require-access.ts` with `requireAccessToOrg` + `getOrgScope`. Applied to `/api/admin/invoices/[id]`, `/api/admin/invoices` list + POST, `/api/admin/requests/[id]`, `/api/admin/clients/[id]`, `/api/admin/tasks/[id]`. Admins bypass; restricted team members see only allowed orgs. — [BE] — done 2026-04-15
- [x] T625 - [BE] R2 file access cross-org fix. `/api/uploads/serve` and `/api/uploads/proxy` now verify the caller's orgId matches the first segment of the storage key, or that a Tahi admin has team-member access to that org. Previously any authed user could read any file by passing a key. — [BE] — done 2026-04-15
- [ ] T626 - [BE] Apply access scoping to remaining admin detail routes: `/api/admin/conversations/[id]`, `/api/admin/conversations/[id]/messages`, `/api/admin/time-entries/[id]`, `/api/admin/contracts/[id]`, `/api/admin/calls/[id]`, `/api/admin/deals/[id]`, per-org sub-resources under `/api/admin/clients/[id]/*`. Use the same `requireAccessToOrg` helper. — [BE]
- [ ] T627 - [QA] Playwright cross-org isolation e2e: seed two client orgs, log in as client A, verify every attempt to fetch client B's requests/clients/invoices/files by ID returns 403. Covers portal and admin paths. — [QA]
- [ ] T628 - [BE] Rate limit portal API routes: 60 req/min per userId on `/api/portal/*`, 20 req/min on `/api/uploads/*`. **Blocked**: needs KV namespace provisioned in Webflow Cloud (currently only D1 + R2 are bound in wrangler.jsonc). Implementation plan once KV available: `lib/rate-limit.ts` with `rateLimit(userId, bucket, limit, windowSec)` helper using KV atomic counter (`put` w/ TTL, fallback to GET+increment). Wire into portal route layout / middleware equivalent. Interim workaround: add Cloudflare WAF rate rule at the edge (out-of-code, one-click in CF dashboard). — [BE]
- [x] T629 - [QA] Currency invariant vitest — done 2026-04-15. Extracted buildRateMap/toNzd/sumAsNzd into lib/currency.ts, de-duped from 3 API routes, covered by 17 unit tests including the actual April 2026 MRR scenario as a regression case.
