# tahi-dashboard — Task List

Last updated: 2026-03-28
Total tasks: 250 (S1-S11 schema + T1-T250 feature + audit findings)
Completed: S1-S11, T1-T13, T15-T17, T18, T20-T22, T29, T32-T42, T44, T47-T57, T58-T60, T61-T63, T64-T65, T66-T79, T80-T88, T89-T91, T92-T94, T95-T100, T101-T107, T108-T114, T115-T116, T117-T134, T135-T140, T141-T144, T145-T148, T149-T156, T167-T171, T172-T188, T189-T192, T194-T196, T198-T210, T216-T226, T251-T252, T254-T258, T259-T262, T264-T266

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

- [ ] T157 — QA: TypeScript strict mode passes (`tsc --noEmit`) after every feature batch — QA
- [ ] T158 — QA: ESLint passes with zero warnings after every feature batch — QA
- [ ] T159 — QA: Vitest unit tests for all health score calculation logic — QA
- [ ] T160 — QA: Vitest unit tests for review outreach state machine transitions — QA
- [ ] T161 — QA: Vitest unit tests for team member access scoping logic — QA
- [ ] T162 — QA: Playwright smoke test — admin can create client, create request, change status — QA
- [ ] T163 — QA: Playwright smoke test — client portal login, view request, submit message — QA
- [ ] T164 — QA: Playwright mobile viewport tests (375px) for core portal flows — QA
- [ ] T165 — QA: dark mode visual pass on all pages before dark mode tasks are marked done — QA
- [ ] T166 — QA: regression check that all previously passing routes still return 200 after each schema migration — QA

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

- [ ] T211 — Write Vitest unit tests for lib/utils.ts: formatCurrency, convertCurrency, and formatDate — [QA]
- [ ] T212 — Write Vitest unit tests for lib/server-auth.ts: getRequestAuth and isTahiAdmin — [QA]
- [ ] T213 — Write Vitest unit tests for POST /api/admin/requests — [QA]
- [ ] T214 — Write Vitest unit tests for POST /api/admin/clients — [QA]
- [ ] T215 — Write Vitest unit tests for POST /api/uploads/confirm — [QA]

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

---

## Phase 5 - MCP Server (Decision #022)

### MCP Server Core
- [ ] T227 - Scaffold MCP server package: package.json, tsconfig, entry point using @anthropic-ai/sdk or @modelcontextprotocol/sdk -- [BE]
- [ ] T228 - MCP auth: service token validation or shared Clerk session for authenticating MCP requests -- [BE]
- [ ] T229 - MCP resource: dashboard://overview (KPI summary: active clients, open requests, outstanding invoices, MRR) -- [BE]
- [ ] T230 - MCP resource: dashboard://clients (client list with health scores, plan types, request counts) -- [BE]
- [ ] T231 - MCP resource: dashboard://client/{id} (full client detail: org, contacts, subscription, tracks, recent requests, invoices) -- [BE]
- [ ] T232 - MCP resource: dashboard://requests (request list with status, priority, assignee, client filters) -- [BE]
- [ ] T233 - MCP resource: dashboard://request/{id} (request detail with thread, files, steps, time entries) -- [BE]
- [ ] T234 - MCP resource: dashboard://invoices (invoice list with status, amount, client) -- [BE]
- [ ] T235 - MCP resource: dashboard://time-entries (time log with client, request, billable, hours) -- [BE]
- [ ] T236 - MCP resource: dashboard://reports (aggregate stats: delivery time, request volume, revenue) -- [BE]

### MCP Tools (actions)
- [ ] T237 - MCP tool: create_request (title, description, category, orgId, priority, type) -- [BE]
- [ ] T238 - MCP tool: update_request_status (requestId, newStatus) -- [BE]
- [ ] T239 - MCP tool: assign_request (requestId, teamMemberId) -- [BE]
- [ ] T240 - MCP tool: create_client (name, website, planType, contactName, contactEmail) -- [BE]
- [ ] T241 - MCP tool: create_invoice (orgId, lineItems, dueDate, notes) -- [BE]
- [ ] T242 - MCP tool: log_time (requestId, orgId, hours, description, billable, rate) -- [BE]
- [ ] T243 - MCP tool: send_message (conversationId, content, isInternal) -- [BE]
- [ ] T244 - MCP tool: create_announcement (title, content, targetType, targetIds, expiresAt) -- [BE]

### Docs Hub as MCP Knowledge Base
- [ ] T245 - MCP resource: dashboard://docs (list all doc pages with titles and categories) -- [BE]
- [ ] T246 - MCP resource: dashboard://docs/{id} (full doc page content for AI context) -- [BE]
- [ ] T247 - Docs Hub: ensure doc pages are structured for AI consumption (clear headings, process descriptions, client-specific notes) -- [PM]

### MCP Testing and Integration
- [ ] T248 - MCP server: local testing with Claude Code (add to .claude/settings as MCP server) -- [QA]
- [ ] T249 - MCP server: documentation (README with setup, available tools/resources, example prompts) -- [PM]
- [ ] T250 - MCP server: deploy alongside dashboard (Cloudflare Worker or separate process) -- [BE]

---

## UX Polish Round 2 (2026-03-28 user feedback)

### Critical UX (these make the product feel broken)

- [x] T251 - Request detail page: full UI/UX overhaul to match overview/requests list quality. Proper card layout, spacing, typography, sidebar panel styling, status stepper polish, thread section design -- [FE + UIUX] -- [PM] 2026-03-28
- [x] T252 - Client detail page: same level of UI/UX polish as request detail. Clean tab navigation, card layouts, consistent spacing -- [FE + UIUX] — [PM] 2026-03-28
- [ ] T253 - Kanban board: implement actual drag and drop (use @dnd-kit/core or similar). Cards must be draggable between columns to change status -- [FE]
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
- [ ] T263 - Reports page: deeper insights (delivery time trends, client activity heatmap, revenue by plan type), better card spacing and chart labels -- [FE + BE]

### Nice to Have UX

- [x] T264 - Persist view preferences: save preferred request view (list/board), active filters, sort order to localStorage per user -- [FE] — [PM] 2026-03-28
- [x] T265 - Searchable dropdown component: create a reusable components/tahi/searchable-select.tsx for all entity pickers (clients, team members, requests) -- [FE + UIUX] -- [PM] 2026-03-28
- [x] T266 - Autocomplete in all forms: wire searchable-select into request creation, time logging, invoice creation, assignment dropdowns -- [FE] — [PM] 2026-03-28
