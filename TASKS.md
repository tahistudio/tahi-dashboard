# tahi-dashboard — Task List

Last updated: 2026-03-28
Total tasks: 228 (S1-S11 schema + T1-T171 feature + T172-T217 audit findings)
Completed this session: T172-T180, T185-T186, T189-T192, T194-T196, T201-T203, T205, T207-T208, T210, T216-T217

Agents: claim a task by adding your initials and the date next to it.
Format: `— [AGENT] YYYY-MM-DD`
Mark done with `[x]`. Never delete tasks — mark them done or superseded.

Legend: BE = Backend, FE = Frontend, UIUX = UI/UX, QA = QA, PM = Project Manager

---

## Schema Additions (must be done before dependent features)

- [ ] S1 — Add `conversations` table: id, orgId, type (direct|group|org_channel|request_thread), visibility (internal|external), name, requestId (nullable), createdAt — BE
- [ ] S2 — Add `conversationParticipants` table: id, conversationId, userId, role (member|admin), joinedAt — BE
- [ ] S3 — Migrate any existing `messages` rows to new conversation model or discard (pre-launch, discard is fine) — BE
- [ ] S4 — Add `teamMemberAccess` table: id, teamMemberId, accessType (all_clients|plan_type|specific_client), trackType (nullable), createdAt — BE
- [ ] S5 — Add `teamMemberAccessOrgs` table: id, teamMemberAccessId, orgId — BE
- [ ] S6 — Add announcement targeting columns to `announcements`: targetType (all|plan_type|specific), targetIds (JSON), sentByEmail (int 0/1), emailSentAt — BE
- [ ] S7 — Add `requestForms` table: id, orgId (nullable), category (nullable), serviceType (nullable), fields (JSON), createdAt, updatedAt — BE
- [ ] S8 — Add `kanbanColumns` table: id, orgId (nullable), slug, label, colour, position, isDefault (int 0/1), createdAt — BE
- [ ] S9 — Add `contracts` table: id, orgId, type (nda|sla|other), fileName, fileUrl, signedAt, expiresAt, notes, createdAt — BE
- [ ] S10 — Add `scheduledCalls` table: id, orgId, contactId (nullable), bookedAt, notes, outcome, createdAt (for logging Google Cal bookings manually) — BE
- [ ] S11 — Add review outreach fields to `caseStudySubmissions`: outreachState (pending|emailed|yes|no|deferred), outreachSentAt, deferredUntil, npsScore, writtenReview, videoUrl, logoPermission (int), marketingPermission (int), submissionToken, tokenExpiresAt, aiDraft — BE


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
- [ ] T13 — Request detail page: full view with status editor, priority, assignee, due date, description (Tiptap), activity log — FE + BE
- [ ] T14 — Request detail: file attachments panel (upload to R2, list, download, delete) — FE + BE
- [ ] T15 — Request detail: voice note recording and playback panel — FE + BE
- [ ] T16 — Request detail: internal vs external comment toggle on each message — FE
- [ ] T17 — Request detail: time entry logging (hours, description, billable toggle) — FE + BE
- [ ] T18 — API route: GET + POST + PATCH /api/admin/requests/[id] — BE
- [ ] T19 — API route: GET + POST /api/admin/requests/[id]/files — BE
- [ ] T20 — API route: GET + POST /api/admin/requests/[id]/voice-notes — BE
- [ ] T21 — API route: GET + POST /api/admin/requests/[id]/time-entries — BE
- [ ] T22 — Client list page: table with search, filter by plan, sort by name/created — FE
- [ ] T23 — Client detail page: overview tab (health score, active requests, contacts, subscription) — FE + BE
- [ ] T24 — Client detail page: requests tab with inline create — FE
- [ ] T25 — Client detail page: files tab — FE
- [ ] T26 — Client detail page: invoices tab — FE + BE
- [ ] T27 — Client detail page: contracts tab (upload NDA/SLA, track signed/expiry dates) — FE + BE

- [ ] T28 — Client detail page: contacts tab (add/edit/remove contacts for the org) — FE + BE
- [ ] T29 — Admin impersonation: "View as client" button switches portal context to selected org — FE + BE
- [ ] T30 — Subscription management: edit plan type, slot count, billing cycle from client detail — FE + BE
- [ ] T31 — Track management: view active tracks, add/archive tracks per client — FE + BE
- [ ] T32 — Invoice list page: table with filters (status, client, date range), totals — FE + BE
- [ ] T33 — Invoice detail page: line items, status, payment link, Stripe sync indicator — FE + BE
- [ ] T34 — API route: GET /api/admin/invoices with Stripe sync — BE
- [ ] T35 — API route: GET /api/admin/invoices/[id] — BE
- [ ] T36 — Time entries page: list all time entries across clients, filter by billable/date/client — FE + BE
- [ ] T37 — API route: GET /api/admin/time-entries — BE
- [ ] T38 — Notifications: SSE endpoint for real-time in-app notifications — BE
- [ ] T39 — Notifications: bell icon in header with unread count, dropdown list — FE
- [ ] T40 — Notifications: mark as read (single + all) — FE + BE
- [ ] T41 — API route: GET + PATCH /api/notifications — BE
- [ ] T42 — Bulk request creation: create a request across all clients / selected plan / selected list — FE + BE
- [ ] T43 — "Save and create another" flow on request creation form (pre-fills category/service) — FE
- [ ] T44 — Bulk actions on request list: bulk status change, bulk assign, bulk delete — FE + BE
- [ ] T45 — Health score: automated calculation per client (response time, open requests, overdue, NPS) stored on org row, recalculated on relevant events — BE
- [ ] T46 — Health score: display as coloured indicator on client list and client detail — FE + UIUX


---

## Phase 2 — Messaging, Portal, Announcements

> Requires S1-S3 schema additions before any messaging work.

- [ ] T47 — Messaging: conversations list page (inbox) showing all conversations with unread counts — FE + BE
- [ ] T48 — Messaging: conversation detail page with message thread, send box, file attach — FE + BE
- [ ] T49 — Messaging: create new direct (1:1) conversation from client detail or contacts page — FE + BE
- [ ] T50 — Messaging: create group conversation with multiple participants — FE + BE
- [ ] T51 — Messaging: org-wide channel (1:many) — admin can post, clients read — FE + BE
- [ ] T52 — Messaging: request-thread conversations linked to a specific request — FE + BE
- [ ] T53 — Messaging: internal vs external visibility toggle per conversation — FE + BE
- [ ] T54 — Messaging: voice note recording and playback within conversations — FE + BE
- [ ] T55 — API route: GET + POST /api/admin/conversations — BE
- [ ] T56 — API route: GET + POST /api/admin/conversations/[id]/messages — BE
- [ ] T57 — API route: GET + POST /api/portal/conversations (client-scoped, external only) — BE
- [ ] T58 — Client portal: dashboard page (active requests summary, recent messages, announcements) — FE + BE
- [ ] T59 — Client portal: requests page (list + board, submit new request via intake form) — FE
- [ ] T60 — Client portal: request detail page (external comments only, file upload, status view) — FE
- [ ] T61 — Client portal: messages page (external conversations only) — FE
- [ ] T62 — Client portal: invoices page (view invoices, pay via Stripe link) — FE + BE
- [ ] T63 — Client portal: profile/settings page (update contact info, notification prefs) — FE + BE
- [ ] T64 — Announcements: create announcement form (title, body, target type/ids, email toggle) — FE + BE
- [ ] T65 — Announcements: in-app banner display on client portal dashboard (dismissible) — FE + BE
- [ ] T66 — Announcements: email delivery via Resend when email toggle is on — BE
- [ ] T67 — Announcements: admin list view with sent/draft status, recipient count — FE + BE
- [ ] T68 — API route: GET + POST /api/admin/announcements — BE
- [ ] T69 — API route: POST /api/admin/announcements/[id]/send — BE
- [ ] T70 — API route: GET /api/portal/announcements (client-scoped) — BE
- [ ] T71 — API route: POST /api/portal/announcements/[id]/dismiss — BE


---

## Phase 3 — Team Operations, Dark Mode, Mobile, Review Pipeline

> Requires S4-S11 schema additions. Schema S4+S5 before team tasks. S11 before review pipeline.

### Team Members and Access Scoping
- [ ] T72 — Team members page: list all team members with roles and access summary — FE + BE
- [ ] T73 — Invite team member: email invite via Clerk + create teamMembers row — FE + BE
- [ ] T74 — Team member detail: access scoping UI (all clients / by plan / by specific client list) — FE + BE
- [ ] T75 — Team member detail: track type scoping (all tracks / maintain only / scale only) — FE + BE
- [ ] T76 — API route: GET + POST /api/admin/team-members — BE
- [ ] T77 — API route: GET + PATCH /api/admin/team-members/[id]/access — BE
- [ ] T78 — Enforce team member access scoping in all admin API routes that return client data — BE
- [ ] T79 — Team member: assign as PM for specific clients (shows as PM in client detail header) — FE + BE

### Request Intake Forms
- [ ] T80 — Intake form builder: create/edit form fields per category, per service, per client — FE + BE
- [ ] T81 — Intake form: client portal request submission uses the resolved form for that category/service/client — FE + BE
- [ ] T82 — API route: GET + POST + PATCH /api/admin/request-forms — BE
- [ ] T83 — API route: GET /api/portal/request-forms/[category] (returns resolved form for org) — BE

### Custom Kanban
- [ ] T84 — Kanban column editor: per-client custom columns (add, rename, reorder, colour, delete) — FE + BE
- [ ] T85 — Seed default kanban columns when provisioning a new client — BE
- [ ] T86 — API route: GET + POST + PATCH + DELETE /api/admin/clients/[id]/kanban-columns — BE

### Call Scheduling
- [ ] T87 — Admin settings: store Google Calendar booking link (config value) — FE + BE
- [ ] T88 — Client portal: "Schedule a call" button/section that opens the stored Google Cal booking link — FE
- [ ] T89 — Scheduled calls log: admin can manually log a call that was booked (date, notes, outcome) — FE + BE
- [ ] T90 — API route: GET + POST /api/admin/clients/[id]/scheduled-calls — BE

### Charts and Reporting
- [ ] T91 — Capacity chart: visualise active request slots used vs available per client, and across all clients — FE + BE
- [ ] T92 — Request volume chart: requests created/completed over time (bar chart, filterable by client/plan) — FE + BE
- [ ] T93 — Response time chart: average time from request created to first response, by client and overall — FE + BE
- [ ] T94 — Overview charts embedded in AdminOverview page — FE


### Dark Mode
- [ ] T95 — Dark mode toggle button in sidebar footer (persists to localStorage) — FE
- [ ] T96 — Dark mode: add `.dark` overrides in globals.css for all surface and text tokens — UIUX
- [ ] T97 — Dark mode: audit all existing components for correct token usage in dark — QA + UIUX
- [ ] T98 — Dark mode: sidebar, header, cards, modals, tables — full visual pass — UIUX

### Mobile and PWA
- [ ] T99 — PWA: add manifest.json with name, icons, theme colour, display standalone — FE
- [ ] T100 — PWA: service worker for offline shell caching — FE
- [ ] T101 — Mobile layout: sidebar collapses to bottom navigation bar at mobile breakpoint — FE + UIUX
- [ ] T102 — Mobile layout: all Phase 1 pages responsive at 375px (iPhone SE) — FE + UIUX
- [ ] T103 — Mobile layout: all Phase 2 pages responsive at 375px — FE + UIUX
- [ ] T104 — Mobile layout: all Phase 3 pages responsive at 375px — FE + UIUX

### Review and Testimonial Pipeline
- [ ] T105 — Review outreach: automation trigger (X days after client onboarded) fires outreach — BE
- [ ] T106 — Review outreach email: sends via Resend with Yes / No / Not Right Now links (token URLs) — BE
- [ ] T107 — Review outreach: in-app banner on client portal with same three options — FE + BE
- [ ] T108 — Review state machine: "No" = never ask again. "Deferred" = set deferredUntil +7 days. "Yes" = start funnel — BE
- [ ] T109 — Review funnel step 1: NPS score (token-auth public page, no login) — FE + BE
- [ ] T110 — Review funnel step 2: written testimonial (token-auth public page) — FE + BE
- [ ] T111 — Review funnel step 3: optional video link submission — FE + BE
- [ ] T112 — Review funnel step 4: optional full case study (yes/no + details) — FE + BE
- [ ] T113 — Review funnel step 5: logo permission and marketing permission checkboxes — FE + BE
- [ ] T114 — AI draft: generate case study draft from submitted info using Claude API — BE
- [ ] T115 — Admin review submissions page: list all submissions with state, NPS, testimonial, logo, approvals — FE + BE
- [ ] T116 — Admin case study detail: view AI draft, edit, mark approved, download logo, copy formatted output — FE + BE
- [ ] T117 — API route: GET + PATCH /api/admin/case-studies — BE
- [ ] T118 — API route: GET + POST /api/public/review/[token] (token-auth, no Clerk) — BE


---

## Phase 4 — Integrations, CSV Exports, Automations, Audit, Zapier

### HubSpot Integration
- [ ] T119 — HubSpot: OAuth connect flow in admin integrations settings — FE + BE
- [ ] T120 — HubSpot: sync new client org to HubSpot as a Company on provisioning — BE
- [ ] T121 — HubSpot: sync contacts to HubSpot as Contacts linked to Company — BE
- [ ] T122 — HubSpot: sync deal/subscription data to HubSpot deal record — BE
- [ ] T123 — HubSpot: webhook receiver for HubSpot contact updates — BE

### Slack Integration
- [ ] T124 — Slack: OAuth connect flow in admin integrations settings — FE + BE
- [ ] T125 — Slack: post notification to configured channel when new request is submitted — BE
- [ ] T126 — Slack: post notification when a request status changes to completed — BE
- [ ] T127 — Slack: configurable channel per event type in admin settings — FE + BE

### Mailerlite Integration
- [ ] T128 — Mailerlite: API key config in admin integrations settings — FE + BE
- [ ] T129 — Mailerlite: add new client contact to configured Mailerlite group on provisioning — BE
- [ ] T130 — Mailerlite: remove/unsubscribe on client offboarding — BE

### Stripe Integration (Retainer Auto-Invoicing)
- [ ] T131 — Stripe: webhook receiver for subscription events (created, updated, invoice.paid, invoice.payment_failed) — BE
- [ ] T132 — Stripe: sync invoice.paid events to local `invoices` table — BE
- [ ] T133 — Stripe: auto-create Stripe subscription when client is provisioned with a paid plan — BE
- [ ] T134 — Stripe: client portal pay-now link using Stripe hosted invoice URL — FE + BE

### Rewardful Integration
- [ ] T135 — Rewardful: API key config in admin integrations settings — FE + BE
- [ ] T136 — Rewardful: sync affiliates list (name, email, referral link, status) — BE
- [ ] T137 — Rewardful: sync referrals per affiliate (who was referred, conversion date, status) — BE
- [ ] T138 — Rewardful: sync commissions earned and payout history — BE
- [ ] T139 — Rewardful: affiliates dashboard page (top affiliates by revenue, referrals over time chart, commissions table) — FE + BE
- [ ] T140 — Rewardful: scheduled background sync (daily refresh of affiliate/referral data) — BE


### CSV Exports
- [ ] T141 — CSV export: time entries (filter by client, date range, billable) — BE
- [ ] T142 — CSV export: invoices (filter by client, date range, status) — BE
- [ ] T143 — CSV export: requests (filter by client, status, date range) — BE
- [ ] T144 — Export buttons on time entries page, invoices page, and requests list — FE

### Automations
- [ ] T145 — Automation rules UI: create rule (trigger + condition + action) — FE + BE
- [ ] T146 — Automation triggers: request created, request status changed, request overdue, client onboarded — BE
- [ ] T147 — Automation actions: send email notification, send Slack message, create internal task, update request status — BE
- [ ] T148 — Automation log: view history of fired automations per client — FE + BE
- [ ] T149 — API route: GET + POST + PATCH + DELETE /api/admin/automations — BE

### Audit Log
- [ ] T150 — Audit log page: table of all admin actions (who, what, when, affected entity) — FE + BE
- [ ] T151 — Audit log: write entries on all create/update/delete actions across the app — BE
- [ ] T152 — API route: GET /api/admin/audit-log with filters — BE

### Zapier and Webhooks (nice-to-have)
- [ ] T153 — Outgoing webhooks: admin can register a webhook URL for selected events — FE + BE
- [ ] T154 — Outgoing webhooks: delivery with retry logic and signature verification — BE
- [ ] T155 — Zapier: Zap triggers for request created, request completed, new client — BE
- [ ] T156 — Zapier: Zap actions for create request, update request status — BE

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

- [ ] T167 — Admin settings page: general (workspace name, logo, Google Cal booking link) — FE + BE
- [ ] T168 — Admin settings page: integrations tab (HubSpot, Slack, Mailerlite, Stripe, Rewardful connect/disconnect) — FE + BE
- [ ] T169 — Admin settings page: team tab (invite, manage roles, access scoping shortcuts) — FE
- [ ] T170 — Admin settings page: notifications tab (which events trigger email/Slack/in-app) — FE + BE
- [ ] T171 — Admin settings page: billing tab (current Stripe plan, invoices for Tahi's own subscription) — FE + BE

---

## Audit Findings (2026-03-28)

Findings from UIUX, QA, FE, BE, and Accessibility audits. Duplicates across agents have been merged into single tasks.

### Responsive and Mobile

- [x] T172 — Request list table: replace fixed pixel grid columns (1fr 120px 140px 130px 80px 90px) with a responsive column strategy that works at 375px — [FE]
- [x] T173 — Search input: remove fixed width 260px, use a fluid or max-width approach that does not overflow at 375px — [FE]
- [x] T174 — Kanban board: replace fixed column width 272px with a responsive treatment (horizontal scroll with min-width on mobile, or single-column stack) — [FE]
- [ ] T175 — Request detail sidebar: add a md: breakpoint treatment to the lg:grid-cols-[1fr_280px] layout so tablets at 768px are not squeezed — [FE]
- [x] T176 — Touch targets: increase height of filter buttons, view toggle buttons, and tab buttons to minimum 44px to meet touch target guidelines — [FE]

### Large Desktop Scaling

- [x] T177 — Dashboard layout: add a max-width constraint (max-w-7xl mx-auto or equivalent) to the main content area in layout.tsx so content does not spread full width at 1440px+ — [FE]
- [x] T178 — Request list page: add max-width container matching the dashboard layout constraint — [FE] (covered by T177 layout wrapper)
- [x] T179 — Client list page: add max-width container matching the dashboard layout constraint — [FE] (covered by T177 layout wrapper)

### Design System and Color

- [x] T180 — Centralize duplicate BRAND/color constants: overview-content.tsx, app-sidebar.tsx, and request-list.tsx each define their own BRAND color values. Per CLAUDE.md, per-file hex consts are fine; verified all use #5A824E consistently — [UIUX]
- [ ] T181 — Replace 50+ hardcoded hex colors in overview-content.tsx, request-list.tsx, and status-badge.tsx with CSS custom property references (var(--color-*)) so dark mode works correctly when implemented — [UIUX]
- [ ] T182 — Merge duplicate status and category color configs: STATUS_CFG in request-list.tsx and the color map in status-badge.tsx define the same data. Consolidate into one shared config — [UIUX]
- [ ] T183 — Replace hardcoded border-radius integers (8, 12) with CSS variable references (var(--radius-button), var(--radius-card)) throughout components — [UIUX]
- [ ] T184 — Fix spacing values that break the 4px grid: values like 3px, 7px, and 20px found in overview-content.tsx and new-request-dialog.tsx. Replace with nearest 4px-grid value — [UIUX]
- [x] T185 — Standardize page heading sizes: overview uses text-2xl, requests uses text-xl. Use text-2xl consistently across all pages for h1 — [UIUX]
- [x] T186 — Fix incorrect CSS variable: client-detail.tsx uses bg-[var(--color-bg-primary)] which does not exist. Replace with bg-[var(--color-bg)] — [FE]
- [ ] T187 — Standardize heading font weight: request-detail uses font-semibold where other pages use font-bold for h1. Align to font-bold — [UIUX]
- [ ] T188 — Replace inline hover handlers (onMouseEnter/onMouseLeave) with Tailwind hover: utility classes throughout all components for consistency — [FE]

### Code Quality and Standards

- [x] T189 — Add export const metadata to overview/page.tsx (required by CLAUDE.md for every page) — [FE]
- [x] T190 — Remove 7 console.log calls from app/api/webhooks/stripe/route.ts (lines 42, 50, 57, 64, 71, 78, 83). Replace with console.error only where genuine error logging is needed, remove the rest — [BE]
- [x] T191 — Standardize API response shapes: PATCH /api/admin/requests/[id], PATCH /api/admin/clients/[id], and DELETE /api/admin/requests/[id] return { ok: true }. Change to { success: true } — [BE]
- [x] T192 — Standardize paginated response shapes: GET /api/admin/requests/[id]/messages and GET /api/admin/requests/[id]/files return flat arrays. Change to { items, page, limit } — [BE]
- [ ] T193 — Implement POST /api/admin/requests/[id]/files (GET exists but POST is missing) — [BE]
- [x] T194 — Add error state handling to AdminOverview, ClientOverview, and RequestDetail: currently only loading and data states exist. A failed fetch silently shows empty data — [FE]
- [x] T195 — Add .catch() handlers to AdminOverview fetch (overview-content.tsx lines 61-66) and ClientOverview fetch (lines 150-155) — [FE]
- [x] T196 — Add .catch() to Promise.all in RequestDetail (request-detail.tsx lines 105-128) — [FE]
- [ ] T197 — Move request list state (activeTab, view mode, search query) from useState to URL search params so refreshes and shared URLs preserve state — [FE]
- [ ] T198 — Move client list state (search, statusFilter) from useState to URL search params — [FE]
- [ ] T199 — Add error boundaries to overview page, request detail page, and client detail page — [FE]

### Accessibility

- [ ] T200 — Add focus trap to new-request-dialog.tsx and new-client-dialog.tsx: keyboard users can currently Tab to background content when dialogs are open. Use focus-trap-react or manual focus management — [ACCESSIBILITY]
- [x] T201 — Add aria-modal="true", role="dialog", and aria-labelledby to the root div of new-request-dialog.tsx and new-client-dialog.tsx — [ACCESSIBILITY]
- [x] T202 — Associate all form labels with inputs via htmlFor/id pairs in new-request-dialog.tsx and new-client-dialog.tsx (FieldGroup label elements are currently not associated) — [ACCESSIBILITY]
- [x] T203 — Add focus-visible rings to search input in request-list.tsx (line 230), filter buttons, and view toggle buttons. The current focus:outline-none removes the outline with no replacement — [ACCESSIBILITY]
- [ ] T204 — Pair all onMouseEnter/onMouseLeave interactive state handlers with matching onFocus/onBlur handlers so keyboard users get equivalent visual feedback — [ACCESSIBILITY]
- [x] T205 — Replace title attribute on Tiptap toolbar buttons and request-list view toggle buttons with aria-label (title is not reliably announced by screen readers) — [ACCESSIBILITY]
- [ ] T206 — Add aria-hidden="true" to all decorative SVG icons throughout the app so screen readers do not announce them — [ACCESSIBILITY]
- [x] T207 — Wrap decorative emojis in aria-hidden="true": wave emoji in overview-content.tsx line 78, lock emoji in new-request-dialog.tsx line 290 — [ACCESSIBILITY]
- [x] T208 — Add aria-live="polite" regions for error messages in dialogs so screen readers announce validation errors — [ACCESSIBILITY]
- [ ] T209 — Add aria-live regions or sr-only text to loading states so screen readers announce when content is loading or has loaded — [ACCESSIBILITY]
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

- [ ] T218 — Request dialog: fetch the client's active subscription planType when the org is selected. Hide the track selector (large/small) entirely if planType is not 'maintain' or 'scale'. Show it only for retainer plans. -- [FE]
- [ ] T219 — POST /api/admin/requests: make trackId optional and skip track slot validation when the org's plan does not use tracks. Return a clear error only when trackId is required (retainer plan) and missing. -- [BE]
- [ ] T220 — Schema check: verify timeEntries table has hourlyRate column (decimal/real) and billable column (integer 0/1). Add both via migration if missing. -- [BE]
- [ ] T221 — UIUX review: update request creation dialog to clearly separate the retainer flow (track selector visible) from the project/hourly flow (no track selector, just title + description + category). -- [UIUX]

### Hourly billing tracker (Decision #021)

- [ ] T222 — Time entries page: per-client hourly summary view. Show total hours logged this month per client, split by billable/non-billable. Filter by month and client. -- [FE]
- [ ] T223 — GET /api/admin/reports/billing-summary?month=YYYY-MM: return per-org breakdown of billable hours, hourly rate, and total amount due. -- [BE]
- [ ] T224 — Monthly billing email: Cloudflare Cron Trigger on the 1st of each month sends Liam a Resend email with a per-client table of billable hours and amounts for the prior month. -- [BE]
- [ ] T225 — Time entry form: add hourly rate field per entry (pre-fill from org's default rate if set). Add a default hourly rate field to the client detail page (stored on the org row or a settings key). -- [FE + BE]
- [ ] T226 — Xero hourly billing export (Phase 4): at end of month, auto-create draft invoices in Xero for each client with billable hours. One line item per client: "Design and development services - [Month] - [X] hours at $[rate]/hr". -- [BE]
