# tahi-dashboard — Architectural & Product Decisions

This file records decisions made during planning so agents and contributors
don't relitigate resolved questions. Add new entries at the bottom.

---

## #001 — Tech Stack

**Decision:** Next.js 15 (App Router) deployed via `@opennextjs/cloudflare` to
Cloudflare Workers, with Cloudflare D1 (SQLite) as the primary database,
Drizzle ORM, Clerk for auth, Tailwind v4, React Email + Resend, Tiptap,
Recharts, Stripe, Cloudflare R2.

**Rationale:** Edge-first deployment keeps latency low globally. D1 is
serverless SQLite, which keeps ops overhead near zero. Clerk handles
multi-org auth without building it from scratch.

**Implications:** No traditional Node server. All DB access goes through
`db()` from `lib/db.ts` which calls `getCloudflareContext()`. No raw SQL
— always use Drizzle query builder.

---

## #002 — Single Drizzle Schema File

**Decision:** All tables live in `db/schema.ts`. No per-domain schema
splitting.

**Rationale:** Project is small enough that a single file keeps imports
simple. Splitting can happen in future if the file becomes unmanageable.

**Implications:** Agents must read the full schema before writing migrations
or queries. No barrel re-exports needed.


---

## #003 — Subscription Track Model

**Decision:** Every client org has a `subscription` row with a `planType`
(`maintain` | `scale` | `launch`). Active slots per plan: maintain = 2,
scale = 4, launch = unlimited. Requests are gated by available slots.

**Rationale:** ManyRequests uses a similar model. Tracks give clients
predictable throughput and give Tahi predictable capacity planning.

**Implications:** When provisioning a new client, the BE must create a
`subscription` row + default `tracks`. Slot counting must be checked on
every new request creation.

---

## #004 — Commit Directly to Main

**Decision:** All agents commit directly to the `main` branch. No feature
branches or PRs required.

**Rationale:** Solo project. PR overhead adds no value and slows agents
down. Liam reviews work visually in the running app.

**Implications:** Agents must not break the build. Run `tsc --noEmit` and
`eslint` before committing. QA agent is responsible for catching regressions.

---

## #005 — No Figma Reference

**Decision:** The existing codebase (`globals.css`, `app-sidebar.tsx`,
`request-list.tsx`, `overview-content.tsx`) is the design system reference.
No external Figma file exists.

**Rationale:** Design emerged through code iteration. The CSS tokens and
component patterns in the codebase are the source of truth.

**Implications:** UIUX agent reads existing components before designing new
ones. All new components must use `var(--color-*)` tokens and the
`--radius-leaf` shape. No hardcoded hex except inside `const` style objects
that mirror the token values.


---

## #006 — Messaging Architecture Overhaul

**Decision:** Replace the simple `messages` table with a full conversation
model. New tables: `conversations` (type: `direct` | `group` |
`org_channel` | `request_thread`) and `conversationParticipants`.
Each conversation has a `visibility` field: `internal` (Tahi-only) or
`external` (client-visible).

**Rationale:** The original `messages` table assumed simple 1:1 between
requests. The full feature set requires 1:1 DMs, group chats, org-wide
channels, and request-thread comments, each with independent visibility
control so Tahi staff can have private sidebar conversations alongside
client-visible ones.

**Implications:** Schema tasks S3 and S4 in TASKS.md must be completed
before any messaging UI work begins. The existing `messages` table rows
must be migrated or discarded (project is pre-launch, so discard is fine).

---

## #007 — Team Member Access is Deny-by-Default

**Decision:** By default, team members have no client access. Access is
granted explicitly via `teamMemberAccess` rows using one of: `all_clients`,
`plan_type`, or `specific_client`. A `trackType` column further scopes to
maintain/scale/launch tracks where relevant.

**Rationale:** Junior team members should not see all client data by
default. Principle of least privilege. Mirrors how ManyRequests handles
team scoping.

**Implications:** Every admin API route that returns client data must join
on `teamMemberAccess` when the caller is a team member (not owner). The
`isTahiAdmin` check alone is not sufficient for scoped team members.
Schema tasks S5 must be completed before team member permission UI.


---

## #008 — Announcements Deliver Both In-App and by Email

**Decision:** Announcements (banners) can target: all clients, clients on a
specific plan type, or a specific list of client orgs. Each announcement is
delivered in-app (rendered as a dismissible banner in the portal) and
optionally by email via Resend.

**Rationale:** Price rise notices and policy changes must reach clients who
haven't logged in recently. Email as a fallback ensures delivery.

**Implications:** The `announcements` table needs `targetType`, `targetIds`,
and `sentByEmail` columns. A background job (or on-demand send action) must
call Resend for email delivery. Schema task S6.

---

## #009 — Dark Mode via CSS Class Toggle

**Decision:** Dark mode is implemented using a `.dark` class on `<html>`,
toggled by a button in the UI and persisted in `localStorage`. All dark
mode colour overrides are defined in `globals.css` under `.dark {}` using
the existing `--color-*` token system.

**Rationale:** Tailwind v4 supports class-based dark mode natively.
Storing the preference in `localStorage` means it persists without a DB
column. This matches the pattern already partially defined in `globals.css`.

**Implications:** No server-side dark mode detection. The toggle button
lives in the sidebar or header. All new components must be tested in both
modes before being marked done.

---

## #010 — PWA and Mobile Responsiveness Required

**Decision:** The dashboard must be a Progressive Web App (PWA) with a
`manifest.json`, service worker, and offline-capable shell. All pages must
be fully functional at 375px viewport width (iPhone SE baseline).

**Rationale:** Liam and clients need to action requests and check status
on mobile. A native-feeling PWA removes the app store dependency.

**Implications:** Every new page component needs a responsive layout pass.
The sidebar collapses to a bottom nav or drawer on mobile. The UIUX agent
is responsible for mobile layout specs. QA must run Playwright mobile
viewport tests before marking mobile tasks complete.


---

## #011 — Stripe Handles Retainer Auto-Invoicing (not Xero)

**Decision:** Automated recurring invoice generation for retainer clients
uses Stripe subscriptions. Xero is already used for manual invoicing and
accounting and does not need to be automated from the dashboard.

**Rationale:** Liam already uses Xero manually and is satisfied with that
workflow. Stripe provides webhook-driven subscription billing that is
simpler to automate programmatically. Duplicating automation into Xero
would create reconciliation complexity.

**Implications:** The `invoices` table syncs from Stripe webhooks for
automated invoices. Xero remains a read/reference integration only (via
the existing Xero MCP). No outbound Xero write automation required.

---

## #012 — Request Intake Forms are Per-Category, Per-Service, Per-Client

**Decision:** Intake forms are configurable at three levels: category-level
defaults, service-type overrides, and per-client overrides. A per-client
form overrides the service form, which overrides the category default.

**Rationale:** Different clients have different onboarding needs and
different services require different information upfront. Rigid global forms
create friction.

**Implications:** Schema task S7 (`requestForms` table) must be completed
first. The form builder UI is a Phase 3 task. Until then, requests use a
simple free-text description field.

---

## #013 — Custom Kanban Columns are Per-Client with Shared Defaults

**Decision:** Each client can have custom Kanban column definitions stored
in the `kanbanColumns` table. If no custom columns exist for a client, the
default set is used: Requested, In Progress, On Hold, Completed, Cancelled.

**Rationale:** Some clients have unique workflows that don't fit the default
statuses. Custom columns let Tahi tailor the experience per client without
changing global status logic.

**Implications:** The `requests.status` field maps to a `kanbanColumns`
slug, not a hardcoded enum. Default columns must be seeded when a new client
is provisioned. Schema task S8.


---

## #014 — Bulk Request Creation Supports "Save and Create Another" and Cross-Client

**Decision:** Admins can create a request and immediately be returned to a
pre-filled creation form ("save and create another"). Separately, admins
can bulk-create a request across: all clients, clients on a specific plan,
or a specific list of clients. Visibility (internal/external) is set at
creation time.

**Rationale:** Liam frequently needs to assign the same deliverable to
multiple clients simultaneously (e.g., "everyone on Scale gets a quarterly
report"). Doing this one-by-one is unacceptably slow.

**Implications:** The bulk create endpoint must insert one `requests` row
per target org in a single transaction. The "save and create another" flow
is a frontend-only concern: after POST success, navigate to the new request
form with category/service pre-populated from the previous entry.

---

## #015 — Case Study and Review Pipeline Uses Token-Auth Forms

**Decision:** The testimonial/review/case study submission flow uses
token-authenticated public URLs (no login required). Tokens are stored in
`caseStudySubmissions.submissionToken` with an expiry. Each step of the
funnel (NPS, written review, video link, case study approval, logo
permission) is a separate token-authenticated page.

**Rationale:** Clients should not need to log in to the portal to submit a
review. Forcing login creates drop-off. Token URLs sent by email provide
sufficient security for low-sensitivity review data.

**Implications:** Token generation happens when the outreach email is sent.
Token validation is a standalone API route that does not use Clerk auth.
Tokens expire after 30 days. If expired, the client sees a "link expired,
contact us" message.

---

## #016 — Zapier and Outgoing Webhooks are Phase 4 Nice-to-Haves

**Decision:** Zapier integration and generic outgoing webhook support are
deferred to Phase 4 and are explicitly lower priority than all Phase 1-3
features.

**Rationale:** The core dashboard must be stable and fully featured before
adding external automation hooks. Phase 4 items are additive and do not
block any client workflows.

**Implications:** No webhook infrastructure (queuing, retry logic, signature
verification) needs to be built until Phase 4 begins. Agents should not
block Phase 1-3 work on webhook design decisions.

---

## Escalation Queue (Pending Liam's Input)

These items are blocked on a product decision and must not be implemented
until resolved. The PM agent should surface these to Liam before writing
specs for the affected features.

**E1 — Rewardful Integration Scope**
Should the dashboard display affiliate/referral data from Rewardful, or is
Rewardful managed entirely outside the dashboard? Define what data (if any)
should sync.

**E2 — Call Scheduling Integration**
Should scheduled calls use a built-in scheduling UI (custom availability,
booking link generation), or embed/integrate with an existing tool such as
Calendly or Cal.com? Built-in gives more control; an embed is faster to
ship.

**E3 — Case Study Publishing Automation**
Should approved case studies be automatically published to the Tahi website
(Webflow) via API, or does Liam copy the AI-generated draft manually into
Webflow? Auto-publish requires a Webflow integration.

---

## #017 — Call Scheduling Uses Google Calendar Embed (E2 Resolved)

**Decision:** The "schedule a call" feature embeds the existing Google
Calendar booking link. No custom scheduling UI, no Calendly, no Cal.com
integration.

**Rationale:** Liam already uses Google Cal for booking. Building or
integrating a separate scheduler adds complexity with no benefit. The embed
is instant to ship and already trusted by clients.

**Implications:** The scheduled calls UI is a simple "Book a call" button
or embedded iframe pointing to Liam's Google Cal link. The link is stored
as a config value (admin settings), not hardcoded. The `scheduledCalls`
schema table may still be used to log calls that were booked and their
outcome notes, but the scheduling itself is delegated to Google Cal.

---

## #018 — Approved Case Studies Wait for Manual Webflow Publish (E3 Resolved)

**Decision:** When a client approves a case study, the approved content
(AI-generated draft, logo, testimonial quote, marketing permission) is
stored in the dashboard and surfaced in an "Approved Case Studies" admin
view. Liam copies the content to Webflow manually.

**Rationale:** Webflow integration is not worth the engineering cost for
a low-frequency action. The bottleneck is client approval, not publishing
speed. Manual copy takes minutes.

**Implications:** No Webflow API integration needed. The admin case study
view should make it easy to copy content: one-click copy of the formatted
draft, logo download button, status badges for each permission granted.

---

## #019 — Rewardful is Fully Integrated (E1 Resolved)

**Decision:** Rewardful affiliate and referral data is fully integrated
into the dashboard. The integration syncs affiliate records, referral
links, conversion events, commission totals, and payout status.

**Rationale:** Understanding which affiliates are driving client growth is
valuable for Liam's business development. Having this data alongside client
and revenue data in one dashboard removes the need to context-switch to
Rewardful's own UI for routine checks.

**Implications:** A new `integrations` entry for Rewardful is needed. The
sync should pull: affiliates list, referral links per affiliate, referrals
(who was referred, when, conversion status), commissions earned, and payout
history. A dedicated Rewardful section in the admin dashboard displays this
data with charts (top affiliates by revenue, referrals over time). This is
a Phase 3 or Phase 4 integration depending on the Rewardful API's
complexity. The PM agent should confirm placement during sprint planning.
The Rewardful API key is stored in environment variables as
`REWARDFUL_API_KEY`.

---

## #020 — Track Type Selection is Plan-Conditional

**Decision:** The "large task / small task" track selector in the request creation form only appears when the client's subscription plan uses the slot model (maintain, scale). Clients on launch plans or one-off custom build projects do not use tracks at all and should never see that selector.

**Rationale:** Asking a custom project client "is this a large or small task?" is confusing and irrelevant. Track slots are a retainer model concept. Project clients are billed differently (hourly or fixed). Showing the selector unconditionally creates friction and erodes trust in the product's polish.

**How to apply:** When the new request dialog opens for a client, fetch their active subscription planType. If planType is 'maintain' or 'scale', show the track selector. If planType is 'launch', 'project', or null, hide it entirely. This logic lives in the FE dialog and the BE POST /api/admin/requests should not require trackId when the plan does not use tracks.

**Escalated to Liam:** No. Clear product rule.

---

## #021 — Hourly Billing Tracker with Monthly Xero Export

**Decision:** Time entries (already in schema as timeEntries table) are the source for hourly billing per client. At the end of each month, the system sends Liam an email (via Resend) with a per-client breakdown of billable hours and total amount. Phase 2: auto-push draft invoices to Xero via the Xero API.

**Rationale:** Liam needs to bill hourly clients accurately without manually tallying time sheets. An automated email summary is the fastest path to value. Xero sync removes the double-entry step once the integration is built.

**How to apply:** 
- Time entries already have orgId, teamMemberId, hours, billable (int), hourlyRate columns (verify in schema, add if missing).
- A monthly summary endpoint: GET /api/admin/reports/billing-summary?month=YYYY-MM returns total billable hours and amount per org.
- A Cloudflare Cron Trigger fires on the 1st of each month, calls Resend with the summary table.
- Phase 4: the same trigger creates draft invoices in Xero via POST to the Xero Invoices API.

**Escalated to Liam:** No. Architecture is clear.

---

## #022 - Tahi Dashboard MCP Server

**Decision:** Build a Model Context Protocol (MCP) server that exposes the Tahi Dashboard as a set of tools and resources for AI assistants. This allows Claude Code, Claude Desktop, or any MCP-compatible client to read and manage dashboard data programmatically.

**Rationale:** Liam already uses Claude Code for development. An MCP server means he (or his team) can ask Claude to "create a request for Acme Corp", "show me overdue invoices", "log 3 hours against this request", or "summarize this client's health" without opening the browser. It also enables AI-powered automation: Claude can monitor client health, draft responses, generate reports, and take action on the dashboard through natural language.

**Architecture:**
- Separate package at `packages/tahi-mcp/` (or `mcp-server/`) in the monorepo
- Connects to the same D1 database via Drizzle (shared schema)
- OR calls the existing API routes over HTTP with a service token
- Exposes MCP tools (actions) and resources (data reads)

**MCP Tools (actions):**
- `create_request` - create a request for a client
- `update_request_status` - change request status
- `assign_request` - assign a team member
- `create_client` - add a new client org
- `create_invoice` - create an invoice with line items
- `log_time` - log a time entry against a request
- `send_message` - send a message in a conversation
- `create_announcement` - publish an announcement

**MCP Resources (reads):**
- `dashboard://overview` - KPI summary
- `dashboard://clients` - client list with health scores
- `dashboard://client/{id}` - client detail with subscription, requests, invoices
- `dashboard://requests` - request list with filters
- `dashboard://request/{id}` - request detail with thread
- `dashboard://invoices` - invoice list
- `dashboard://time-entries` - time log
- `dashboard://reports` - aggregate stats

**Docs Hub connection:** The Docs Hub (T155-T158) serves as the knowledge base that the MCP server can reference. When Claude answers questions about Tahi processes, it reads from the docs hub. When it takes actions, it uses the MCP tools.

**Escalated to Liam:** No. Architecture is clear and non-destructive.

---

## #023 - Full Dashboard Build Session (2026-03-28 to 2026-03-29)

**Decision:** Built the entire Tahi Dashboard from core infrastructure to 300+ completed tasks in a single intensive session using multi-agent workflows.

**What was built:** 95 API routes, 27 pages, 31 components, 176 tests, MCP server with 18 tools/resources. Features: request management (list/board/workload/detail), client management with 7 tabs, invoicing, time tracking, messaging, reports with charts, team management with access scoping, docs hub, settings with 8 sections, announcements, review pipeline, services catalogue, dark mode, PWA, mobile responsive, keyboard shortcuts, product tour, AI suggestions, breadcrumbs, toasts, and file uploads.

**Key architecture decisions validated:** Cloudflare Workers + D1 + R2, Clerk multi-org auth, CSS custom properties for dark mode, rem units for scalability, shared status config, SearchableSelect for all pickers.

---

## #024 - Replace HubSpot with Built-in CRM Pipeline

Date: 2026-03-28
Decision: Build a native CRM pipeline inside the dashboard to replace HubSpot. New tables: deals, dealContacts, pipelineStages, activities, brands, brandContacts. Extends organisations and contacts with custom fields. Adds capacity tracking and forecasting from the pipeline. Adds proper multi-currency support. Promotes brands from a JSON array to a proper entity.

Why: HubSpot adds cost and requires context-switching. Tahi already has organisations, contacts, invoices, and time tracking in the dashboard. A built-in pipeline keeps all sales and delivery data in one system. Capacity forecasting from the pipeline is a key sales enabler: Liam needs to tell prospects when work can start.

How: BE agent creates schema batch 8 (deals, dealContacts, pipelineStages, activities) and batch 9 (brands, brandContacts). BE agent builds API routes for deals CRUD, activities CRUD, capacity calculation, and close rate metrics. FE agent builds pipeline Kanban board, deal detail page, capacity dashboard, contact detail page, and enhanced reports. UIUX agent reviews all new pages. QA agent tests pipeline flow end to end.

Escalated to Liam: Yes. Four items need confirmation before implementation starts: (1) NZD as base reporting currency, (2) default pipeline stages and probabilities, (3) whether brands should scope portal visibility, (4) whether to remove HubSpot API key from env vars. See SPECS/crm-pipeline.md escalation check section.

---

## #025 - No Unlayered CSS Resets with Tailwind v4

Date: 2026-03-30
Decision: Never place `* { margin: 0; padding: 0; }` or similar property resets outside a `@layer` block in globals.css. Tailwind v4's own `@layer base` already includes the full reset.

Why: CSS Cascade Layers spec states that unlayered styles always beat layered styles regardless of specificity. Since Tailwind v4 wraps all utilities in `@layer utilities`, an unlayered `*` reset kills every padding and margin utility class while other utilities (flex, grid, gap, text, bg, etc.) appear to work fine. This was the root cause of missing padding/margin across the entire dashboard on the Webflow Cloud deployment. 278 inline style workarounds accumulated across 16+ files before the root cause was identified.

How to apply:
- The `* { box-sizing: border-box; margin: 0; padding: 0; }` block was removed from globals.css
- If custom base resets are ever needed, place them inside `@layer base { }` so Tailwind utilities can override them
- Use rem/em units for all spacing, never raw px
- Dashboard main content area uses a `.dashboard-main` CSS class with responsive rem padding instead of Tailwind classes

Escalated to Liam: No. Root cause bugfix.

---

## #026 - Feature Depth Sprint: April 2026 Priorities

Date: 2026-04-03
Decision: Six priorities for the next sprint, directed by Liam. (1) Task management overhaul with dependencies, templates, AI wizard, track queue, and bulk ops. (2) Track queue visualization on client portal with drag reorder and upsell prompt. (3) @mentions system across tasks, requests, and messages with autocomplete and notifications. (4) Org chart with multiple roles per person and department grouping. (5) Subscription billing tiers: monthly, 3 month (includes SEO dashboard), 12 month (includes extra track, priority support, SEO dashboard), GST for NZ only. (6) Replace HubSpot entirely with built-in CRM, no HubSpot integration, remove all HubSpot references.

Why: These features close the gap between the dashboard and ClickUp/HubSpot, making the dashboard the single tool for both internal ops and client-facing work. Billing tiers enable upselling. CRM replacement removes a paid dependency.

How: BE agent handles schema additions S16-S22 first, then API routes. FE agent builds UI after schema is in place. UIUX reviews each feature. QA tests end-to-end. PM coordinates sequencing.

Escalated to Liam: No. All priorities came directly from Liam.

---

## #027 - Remove HubSpot Integration Entirely

Date: 2026-04-03
Decision: HubSpot is not integrated. It is replaced by the built-in CRM pipeline. All HubSpot OAuth routes, sync endpoints, webhook receivers, and integration settings UI must be removed.

Why: Liam explicitly said "do NOT integrate HubSpot, REPLACE it." The built-in CRM pipeline (Phase 6 tasks T286-T391 plus new tasks T472-T478) is the replacement. Keeping HubSpot code is dead weight.

How: BE agent removes HubSpot API routes and references. FE agent removes HubSpot from integration settings card. Tasks T119-T123 (HubSpot integration) are superseded by this decision.

Escalated to Liam: No. Direct instruction from Liam.

---

## #028 - Subscription Billing: GST for NZ Only, No VAT

Date: 2026-04-03
Decision: Tax is GST at 15% for New Zealand clients only. No VAT is charged for any other country. The billingCountry field on subscriptions determines tax treatment.

Why: Liam confirmed NZ GST is the only tax obligation. Implementing VAT for other jurisdictions is unnecessary complexity.

How: BE agent adds billingCountry to subscriptions schema (S21). Billing logic applies 15% GST when billingCountry is "NZ" and zero tax otherwise.

Escalated to Liam: No. Direct confirmation from Liam.

## #029 - Migration Safety: Always Use IF NOT EXISTS and Verify Against Production

**Date:** 2026-04-04
**Context:** This is a recurring issue. Migration 0004_orange_sumo.sql failed in production because it tried to ADD COLUMN `case_study_permission` which already existed from migration 0006. This happened because:

1. Drizzle `generate` creates migrations based on schema diff against the local snapshot, not the production DB state
2. Migration numbering (0004) can come after a migration (0006) that already ran in production, if 0004 was generated later
3. When a migration fails mid-way on D1, the entire transaction rolls back (nothing is applied), but the migration is NOT recorded - so the next deploy retries it

**Decision:**
- All migrations MUST use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`
- Before generating a migration with `drizzle-kit generate`, check what columns/tables already exist in production
- After generating, manually review the SQL and remove any ALTER TABLE ADD COLUMN statements for columns that already exist in production
- Never assume migration order matches chronological order of when schema changes were added
- When a migration fails in production, check the D1 state before fixing: if D1 rolled back the transaction, simply fix the SQL and re-push; if partial application occurred, create a compensating migration

**How to apply:** Every BE agent must review generated migration SQL against production schema before committing. Use `npx wrangler d1 execute <db> --remote --command "PRAGMA table_info(<table>)"` to check existing columns when in doubt.

## #030 - Requests are Client-Facing, Tasks are Internal-Only

**Date:** 2026-04-04
**Context:** Liam clarified the mental model for tasks vs requests.

**Decision:**
- **Requests** = client-facing work items. Clients see these, submit these, track these in their portal. This is the client's interface to Tahi's work.
- **Tasks** = internal-only. Tahi team uses these to run the business. Clients never see tasks.
- Both are functionally similar (title, description, status, priority, assignee, subtasks, dependencies, time, files, @mentions)
- Tasks can block requests, but clients only see the request status change (e.g. "On Hold") - they don't see the blocking task
- Task types remain: client_task (linked to a client but invisible to them), internal_client (ops for a client), tahi_internal (company-wide)
- Cross-entity dependencies work: task blocks request, request blocks task
- The task system needs full feature parity with requests
- Tahi should be able to run the entire business on tasks alone (internal ops, client delivery, sales)

---

## #019 -- S13 remaining: CRM fields on organisations

**Decision:** Add `custom_fields` (text, default '{}'), `default_hourly_rate` (integer), `size` (text), and `annual_revenue` (integer) columns to the `organisations` table as part of S13 batch 9 remaining work.

**Rationale:** The CRM pipeline spec requires custom fields and company metadata (size, revenue, hourly rate) to be stored on organisations. These were approved in S13 but not yet added to the schema. Migration 0006 adds these four columns.

---

## #031 - Xero Bidirectional Sync Strategy

**Date:** 2026-04-12
**Context:** Tahi generates invoices locally and needs to keep Xero in sync for payment reconciliation. Xero handles retainer invoice generation and payment processing.

**Decision:**
- **Token Management:** Store Xero OAuth tokens (access_token, refresh_token, expires_at) in the `integrations` table with type='xero'. Implement automatic token refresh before each API call.
- **Invoice Push:** When an admin manually creates or edits an invoice in Tahi, push it to Xero. Create contacts in Xero first if they don't exist, then create invoices with line items. Store the Xero invoice ID locally for reconciliation.
- **Payment Pull:** Periodically (or on-demand) pull invoice statuses from Xero to sync payment statuses back to the Tahi dashboard. Map Xero status codes to local status enum values.
- **No bidirectional pull:** Tahi is the source of truth for invoices. We do not pull invoice data from Xero back to Tahi (too complex for MVP). Invoice creation happens locally only.

**How to apply:**
- BE implements `lib/xero.ts` with token management utilities
- `POST /api/admin/invoices/xero-sync` pushes invoices to Xero
- `POST /api/admin/integrations/xero/sync-payments` pulls payment statuses from Xero
- FE wires sync buttons to settings integrations page

**Future:** Webhook handlers for Xero payment notifications (Phase 8+)

---

## #032 - MCP HTTP Endpoint for Claude Custom Connectors

**Date:** 2026-04-12
**Context:** Tahi dashboard is powerful (clients, requests, invoicing, capacity tracking) but users currently need to log in to the web UI. Exposing the dashboard as an MCP server allows Claude to query and act on Tahi data directly from conversations.

**Decision:**
- **HTTP Transport:** Implement MCP (Model Context Protocol) over HTTP via `app/api/mcp/route.ts`. This allows the MCP server to be called from Claude as a custom connector, without needing a separate process or Stdio transport.
- **Protocol Compliance:** Full JSON-RPC 2.0 support for initialize, tools/list, tools/call methods. GET endpoint returns server info with capabilities.
- **Tool Exposure:** Initially expose 7 read-only dashboard tools: get_overview_stats, list_clients, get_client_detail, list_requests, get_billing_summary, get_capacity, get_reports. Each tool proxies through authenticated backend API routes using TAHI_API_TOKEN.
- **Authentication:** Tools require valid TAHI_API_TOKEN header. Token is set in Webflow Cloud environment. Optional OAuth implementation for production (Phase 8+).
- **No mutations initially:** Phase 1 MCP endpoint is read-only (GET operations only). Mutation tools (create_request, update_status, create_invoice, etc.) deferred to Phase 8.

**How to apply:**
- POST /api/mcp handles JSON-RPC protocol
- GET /api/mcp returns server metadata
- Deploy to Webflow Cloud via main branch push (auto-deploys)
- Add to Claude as custom connector: https://tahi-test-dashboard.webflow.io/api/mcp
- Endpoint requires TAHI_API_TOKEN in environment

**Future:** Full mutation tools, OAuth, webhook handlers, resource implementation (Phase 8+)

---

## #033 - Resend Email Domain Fixed: tahi.studio

**Date:** 2026-04-12
**Context:** Email sending was failing with 403 Forbidden from Resend because the sender domain was incorrectly set to `notifications@tahistudio.com` instead of the verified domain `notifications@tahi.studio`.

**Decision:**
- Updated all email sending routes to use `from: 'Tahi Studio <notifications@tahi.studio>'`
- Affected routes:
  - `app/api/admin/clients/[id]/welcome-email/route.ts:71`
  - `app/api/admin/invoices/[id]/send-email/route.ts:86`
  - `app/api/admin/announcements/[id]/send/route.ts:86`
- All emails now send successfully from the verified tahi.studio domain

**Why:** Resend requires a verified sender domain. The typo in the domain name was silently failing all email delivery. Correcting to the verified domain resolves all email failures without any infrastructure changes.

---

## #034 - MCP HTTP Endpoint Implementation Verified (Not Deployed Yet)

**Date:** 2026-04-12
**Context:** The MCP HTTP endpoint was fully implemented in `app/api/mcp/route.ts` with all 7 tools working. However, the Cloudflare Worker proxy (tahi-mcp-server.business-ccd.workers.dev) is not properly exposing the endpoint due to a basePath routing issue.

**Decision:**
- **Endpoint Status:** `POST /api/mcp` and `GET /api/mcp` are fully functional in the Next.js backend
- **Routing Issue:** The `basePath: '/dashboard'` in `next.config.ts` causes Next.js API routes to return 404 when accessed via the Webflow Cloud custom domain because Webflow routing breaks API route discovery
- **Temporary Workaround:** The Cloudflare Workers domain (fdd08ec9-43a5-4c62-aa6d-309da23e3d0f.wf-app-prod.cosmic.webflow.services/dashboard/api/mcp) works but still returns 404 due to Webflow Cloud routing configuration
- **Phase 8 Solution:** Remove `basePath: '/dashboard'` from `next.config.ts` and configure routing at the Webflow layer instead, or complete the Cloudflare Worker proxy setup via CLI deployment

**7 Tools Exposed:**
1. `get_overview_stats` - Dashboard KPIs, recent requests, revenue
2. `list_clients` - All clients (filterable by status, planType)
3. `get_client_detail` - Single client with org, contacts, subscription, requests
4. `list_requests` - Work requests with filters (status, clientId, limit)
5. `get_billing_summary` - Financial summary, invoices, trends
6. `get_capacity` - Team utilization, available hours
7. `get_reports` - Aggregate reports (client count, billable hours, response times)

**How to apply:**
- MCP endpoint is ready for use as soon as the routing issue is resolved
- No code changes needed; only infrastructure configuration
- Cloudflare Worker proxy code is written but not deployed due to UI persistence issues; CLI deployment planned for Phase 8

**Future:** Complete Worker deployment, add mutation tools, OAuth, webhook integration

---

## #035 - HubSpot Deals Import Endpoint Created (Blocked by basePath Routing)

**Date:** 2026-04-12
**Context:** User requested importing HubSpot deals into the dashboard as a one-time data operation and clearing existing test deals. Endpoint was created but routing prevents deployment and testing.

**Decision:**
- **Endpoint Created:** `POST /api/admin/integrations/hubspot/sync-deals` implemented in `app/api/admin/integrations/hubspot/sync-deals/route.ts`
- **Functionality:**
  - Fetches all deals from HubSpot API using `HUBSPOT_API_KEY` environment variable
  - Deletes all existing deals from dashboard (clears test data)
  - Creates new deals from HubSpot data with mapping:
    - `dealname` → `title`
    - `amount` → `value` and `valueNzd` (USD conversion)
    - `dealstage` → matched to default lead stage
    - `closedate` → `expectedCloseDate`
    - `notes` → `notes`
    - Source set to 'hubspot' for tracking
- **Status:** Code committed to main but blocked by basePath routing issue (same as Decision #034)
- **Blocker:** The `basePath: '/dashboard'` in `next.config.ts` prevents API route discovery on Webflow Cloud, even after deployment
- **Phase 8 Solution:** Same as MCP endpoint - requires removing basePath and reconfiguring Webflow routing

**Test Data Cleared:**
- Before: 2 test deals ("sad" for $1000 USD, "fdgrdf" for $4500 NZD)
- After (once endpoint works): These will be replaced by actual HubSpot deals

**How to apply:**
- Once basePath routing is fixed in Phase 8, endpoint will be accessible at `POST /api/admin/integrations/hubspot/sync-deals`
- No authentication required beyond admin role check (POST requires Tahi admin token)
- Returns JSON with `{success, clearedCount, importedCount, failedDeals[]}`
- Alternative: Use `scripts/sync-hubspot-deals.ts` locally with env vars if needed for debugging

**Why:** Waiting on basePath fix. The endpoint is production-ready code but cannot be deployed until the routing architectural issue is resolved. This affects all new API endpoints added during Phase 5.

---

### Decision #036 (2026-04-13): Standalone Cloudflare Worker MCP Server

**Decision:** Deploy the MCP HTTP server as a standalone Cloudflare Worker (`tahi-mcp-server`) at `tahi-mcp-server.business-ccd.workers.dev`, independent of the Webflow Cloud Next.js app. This bypasses the basePath `/dashboard` routing blocker entirely.

**How to apply:**
- Worker code lives at `workers/mcp-server/` with its own `package.json`, `wrangler.jsonc`, and `tsconfig.json`
- 77 tools covering all dashboard operations (read + write), matching the stdio server
- OAuth 2.1 authorization code flow with PKCE for Claude custom connectors
- Client credentials grant also supported for direct API access
- Secrets `TAHI_API_TOKEN`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` stored in CF Worker secrets
- Deploy via `cd workers/mcp-server && npx wrangler deploy`
- Worker proxies all calls to the Webflow Cloud dashboard API using the internal token

**Why:** The basePath routing issue in Webflow Cloud made it impossible to serve MCP at `/api/mcp`. A standalone worker avoids this entirely, has its own domain, and can be updated independently of the main app deploy cycle.

---

### Decision #037 (2026-04-13): HubSpot sync endpoint removed, replaced by MCP-based import

**Decision:** Remove the `/api/admin/integrations/hubspot/sync-deals` API route. Deal imports from HubSpot are now done via CSV export + MCP tools (or direct API calls). The built-in CRM pipeline fully replaces HubSpot.

**How to apply:**
- HubSpot CSV exports are imported using the MCP `create_deal` tool or direct dashboard API
- Deal enrichment (contacts, notes, sources) done via cross-referencing HubSpot, Gmail, and Calendar data
- No HubSpot API integration needed going forward

**Why:** Decision #028 replaced HubSpot with built-in CRM. Maintaining a sync endpoint for a service being phased out adds complexity. One-time imports via MCP are simpler and more flexible.

---

### Decision #038 (2026-04-13): Pipeline currency switcher with OpenExchangeRates

**Decision:** Add NZD/USD/AUD/GBP/EUR currency switcher to the pipeline page. All deal values (KPIs, stage totals, deal cards, list view) convert via exchange rates from the OpenExchangeRates API.

**How to apply:**
- Currency toggle buttons appear above the KPI cards row
- Uses `convertFromNzd()` from `lib/currency.ts` with rates from `/api/admin/exchange-rates`
- All deals store `valueNzd` (normalized) and display in the selected currency
- `OPEN_EXCHANGE_RATES_APP_ID` env var required for rate refresh

**Why:** Tahi operates internationally (NZ, UK, US, AU clients). Seeing pipeline value in local currencies helps with forecasting and client conversations.

---

### Decision #039 (2026-04-13): Pipeline lead sources expanded

**Decision:** Add `webflow_partner` (Webflow Partner Program) and `straightin` (StraightIn LinkedIn agency) as pipeline lead sources. Remove duplicate `cold_outreach` option. Remove `call` from deal activity types (keep meeting, email, note, task).

**How to apply:**
- Source labels, filter dropdowns, new deal form, and won source options all updated in `pipeline-content.tsx`
- `straightin` distinguishes StraightIn agency outreach from Liam's own LinkedIn work
- `webflow_partner` covers Webflow Partner Matchmaking referrals (distinct from generic `partner`)

**Why:** Accurate source attribution matters for ROI tracking. StraightIn is a paid agency vs organic LinkedIn. Webflow Partner is a specific referral channel. Call and meeting were redundant as activity types.

---

## #036 - MCP Parity Rule: Any API Capability Must Be Exposed via MCP

**Decision:** Whenever a feature requires direct API access that the MCP tools do not yet support, the MCP tool definition must be updated to include that capability. Both MCP servers (local `mcp-server/index.ts` and Cloudflare Worker `workers/mcp-server/src/index.ts`) must be kept in sync.

**Rationale:** The MCP server is the primary interface for AI-assisted operations on the dashboard. If an operation is only possible via raw API calls, it means the MCP tooling has a gap. Closing these gaps proactively future-proofs the system and makes the dashboard fully operable through Claude and other AI assistants.

**How to apply:**
- Before making any direct API call for data mutations, check if the relevant MCP tool supports the required parameters
- If not, add the missing parameter to both `mcp-server/index.ts` (Zod schema) and `workers/mcp-server/src/index.ts` (prop definition)
- The handler pattern `const { primaryId, ...body } = args` means new optional fields just need to be added to the tool schema; the handler passes them through automatically
- Example: `update_invoice` was missing `orgId` for invoice reassignment. Added to both MCP servers.

**Why:** AI-first operations. If we can do it in the dashboard, we should be able to do it through MCP.

---

## #037 - Custom MRR Per Client

**Decision:** Add a `customMrr` (real) field to the `organisations` table. MRR is calculated by summing `customMrr` across all active clients, not by inferring from plan types.

**Rationale:** Clients are on custom retainer amounts that don't map cleanly to plan tier prices. Physitrack pays GBP 3,125/mo, Stride pays USD 1,200/mo, etc. Hardcoded plan prices ($1,500 maintain, $4,000 scale) were inaccurate. The custom field gives exact control.

**How to apply:**
- Set `customMrr` on each active retainer client via the client detail page or MCP `update_client`
- Financial health API sums `customMrr` from active orgs
- Overview MRR KPI reads from the same source
- Currency conversion applies based on org's `preferredCurrency`

---

## #038 - Finance Feature Roadmap (Phase 10)

**Decision:** Comprehensive finance and reporting roadmap logged as T590-T621. Covers: Xero P&L deep sync with expense categories, gross margin per client (costs tracking), cash flow forecast (MRR + pipeline - expenses), project calculator (ported from tahi.studio), utilization rate per team member, revenue per head, retainer health monitor with churn/upsell alerts, quote-to-invoice pipeline from closed deals, LTV improvements, and MCP parity for all finance tools.

**Rationale:** Liam wants the dashboard to be the single source of truth for Tahi's finances. Current reporting shows revenue but not costs, margins, or projections. Xero has the expense data but it's not surfaced in the dashboard. The project calculator from the website should be available internally for deal estimation.

**Priority order:** Xero invoice push fix (Phase 9) > Stripe invoicing > client archive > Xero P&L sync > gross margin > cash flow forecast > retainer health > LTV > project calculator > utilization > revenue per head.

**Deprioritized:** Client expense allocation (Liam doesn't expense to clients directly).

---

## #039 - Production Outage: WFCloud Builder 1.2.0 D1 Binding Regression

**Date:** 2026-04-16

**Incident:** All DB-touching API routes returned 500 for ~2 hours. Every request hit: "D1 database binding (DB) not found in Cloudflare context." Seven code hotfixes were deployed before the root cause was identified as a platform issue, not a code issue.

**Root cause:** Webflow Cloud upgraded their builder from **1.1.1 to 1.2.0** between deploys. Builder 1.1.1 preserved user wrangler config:
```
/repo/wrangler.json not found, checking for /repo/wrangler.jsonc
saving user-provided wrangler JSONC as /repo/clouduser.wrangler.json...
```
Builder 1.2.0 skips this step entirely, just printing "Copying wrangler.json template..." and overwriting the user config with its template (which only has ASSETS). The D1 and R2 bindings declared in the user's wrangler.jsonc were silently lost.

**Fix:** Ship `clouduser.wrangler.json` directly in the repo so the deployer reads it without needing the builder to generate it. Also removed `migrations_dir` from the config because the 1.2.0 deployer crashes with ENOENT when it cannot find the migrations at `output/migrations/drizzle/migrations`. We manage migrations ourselves via `/api/admin/db/migrate`.

**Files changed:**
- Added `clouduser.wrangler.json` (D1 + R2 bindings, no migrations_dir)
- Added `wrangler.json` (same content, for local dev and documentation)
- Removed `wrangler.jsonc` (original file, no longer needed)

**Lessons learned:**
1. When rolling back code does not fix the problem, investigate the platform (builder version, deploy logs, binding injection), not the code.
2. The Webflow Cloud deploy log line "Your Worker has access to the following bindings" is the definitive check. If DB is missing there, no code change will fix it.
3. Always compare deploy logs between working and broken deploys. The builder version difference (1.1.1 vs 1.2.0) was the smoking gun.
4. Keep `clouduser.wrangler.json` in the repo as the source of truth for storage bindings. Do NOT rely on the builder to generate it.
5. Do NOT use `migrations_dir` in the wrangler config. We run migrations via our own endpoint with idempotent DDL.

---

## #040 - Pipeline Math: Single Source of Truth via `lib/pipeline-math.ts`

**Date:** 2026-04-21

**Problem:** Overview and Pipeline pages showed different weighted forecasts (~$61k vs ~$42k). Root cause: Overview used the static `stageProbability` from the stage config; the Pipeline page used `historicalProbability` (actual close rate derived from won/reached deals), and Reports/Sales used static too. Three different numbers, one pipeline.

**Decision:** All pipeline/weighted math routes through `lib/pipeline-math.ts`:

- `pointEstimate(deal)` \u2014 canonical dollar value (midpoint when range, single value otherwise; prefers `valueNzd` over `value`).
- `effectiveProbability(deal, stages)` \u2014 prefers `stage.historicalProbability` \u2192 falls back to `stage.probability` \u2192 falls back to denormalised `deal.stageProbability` \u2192 falls back to 0.
- `calculatePipelineTotals(deals, stages)` \u2014 returns `{ totalValue, weightedValue, openDealCount, wonCount, lostCount, avgDealSize, winRate }`. This is the ONLY function that should be used to compute weighted pipeline totals anywhere in the codebase.
- `rangeConfidence(deal)` + `rangeConfidenceLevel(deal)` \u2014 quantifies how wide a range is relative to its midpoint.
- `formatDealValue(deal, formatter)` \u2014 renders `$10k\u2013$15k` for ranges, `$12.5k` for singles.

27 unit tests (`lib/__tests__/pipeline-math.test.ts`) guard against regression, including a scenario that explicitly reproduces the pre-fix overview-vs-pipeline discrepancy.

**Wired into:**
- `app/(dashboard)/overview/overview-content.tsx` \u2014 `PipelineSummaryCard` fetches `/api/admin/pipeline/stages` so the helper can read `historicalProbability`.
- `app/(dashboard)/pipeline/pipeline-content.tsx` \u2014 replaces inline `getEffectiveProbability` + weighted reducer.
- `app/api/admin/reports/sales/route.ts` \u2014 computes historical probability the same way `/api/admin/pipeline/stages` does, then aggregates via `calculatePipelineTotals`.

**Why historical wins by default:** Your actual close rate is more honest than an optimistic stage configuration. If a stage has <3 deals that reached it we fall back to the static probability so new pipelines aren't zeroed out.

---

## #041 - Deal Value Range + Comprehensive Activity Timeline

**Date:** 2026-04-21

**Context:** Leads often come in with a range (Webflow estimate $2k\u2013$4k, or a gut-feel $10k\u2013$15k). Forcing a single number hides uncertainty and the dashboard loses the history of how the estimate evolved. Separately, most deal mutations (owner changes, value changes, source changes, auto-nudges toggled) were invisible \u2014 only stage transitions were logged.

**Decision:**

### Data model (migration 0017)
- `deals.value_min`, `deals.value_max`, `deals.value_min_nzd`, `deals.value_max_nzd` \u2014 nullable. `deals.value` remains the point estimate (= midpoint when range, = user-entered when single).
- `activities.metadata` \u2014 JSON text column for structured before/after payloads on every timeline entry.
- All new columns are accessed via raw SQL until migration 0017 is applied on every environment (Decision #039 lesson #1).

### UX
- **Range input:** New Deal dialog and Deal Detail both have a "Set as range" toggle. Range mode shows two inputs (Min/Max) side-by-side. Midpoint is computed and labelled.
- **Display:** Kanban cards show `$10k\u2013$15k` when range is set, else the single value. Totals (pipeline value, weighted forecast) always use midpoint so aggregates stay scalar.
- **Confidence dot:** Small coloured dot next to ranged values \u2014 green (tight, width <20% of midpoint), amber (rough, <50%), red (speculative).
- **Last-touched label:** Replaces the per-card probability badge (which was redundant with the column header). Fresh = brand colour, stale = amber, very stale = red.
- **Stage-advance guard:** When moving a deal forward into Proposal / Negotiation / Verbal Commit with a range wider than 30% of midpoint, a dialog prompts to tighten the estimate before advancing.
- **Smart note chips:** Editing value in deal detail shows quick chips (`Scope grew`, `Scope shrunk`, `Budget confirmed`, `Discount applied`, `Webflow estimate`, `Client counter-offer`) plus a free-text field. Stored in `activities.metadata.note` and rendered inline on the timeline entry.
- **Value trendline:** Sparkline on the deal detail Value card plotting the estimate over time (deal creation + every value change). Up-arrow green when estimate grew, down-arrow red when shrunk.

### Activity logging
One helper: `lib/deal-activity.ts` \u2192 `logActivity(db, input)`. Wired into every deal mutation path:

- `POST /api/admin/deals` \u2192 `deal_created`
- `PATCH /api/admin/deals/[id]` \u2192 any of `value_change`, `currency_change`, `stage_change` (with days-in-previous-stage), `owner_change`, `org_change`, `source_change`, `engagement_change`, `close_date_change` (with shift-in-days), `notes_change`, `auto_nudges_toggled`, `won`, `lost`, `unarchived`
- `DELETE /api/admin/deals/[id]` \u2192 `archived`
- `POST /api/admin/deals/[id]/nudges` \u2192 `nudge_sent` (with recipient preview, subject, template ID)

Every entry includes structured `metadata` (before/after snapshots) so the UI can render diffs without parsing strings.

### MCP parity
`create_deal` and `update_deal` both accept `valueMin`/`valueMax`. `update_deal` also accepts `valueChangeNote` so AI assistants can explain why an estimate changed. Both MCP servers (stdio + HTTP) updated in lockstep (Decision #036).

**Lessons reused:**
- Raw SQL for new columns until migration is applied everywhere (Decision #039).
- MCP tool + dashboard must update together (Decision #036).
- Shared math helper with unit tests beats duplicated inline formulas (Decision #040).

---

## #042 - Global Display Currency Toggle

**Date:** 2026-04-21

**Problem:** The currency preview toggle existed on two pages (Pipeline, Reports) as local state, so changing it on one didn't carry over to the other, and every other page that shows money (Overview, Invoices, Deal Detail, Client Detail) either hard-coded NZD or showed native currency with no conversion. Users had to mentally re-do currency math when moving between pages.

**Decision:** One React Context at the dashboard layout level, one switcher in the top nav, persisted to `localStorage` under `tahi-display-currency`. Every page that shows money reads from the context. Rules:

- **Canonical totals** (weighted pipeline, MRR, outstanding, reports KPIs) use the display currency. These are the "what does this look like in the currency I care about?" numbers.
- **Legal records** (invoices, deal values) keep the native billed currency as the primary display. The display-currency equivalent appears as a secondary `\u2248 $X` line below. We never hide what the client was actually charged.
- **Deal value editor**: the currency selector defaults to the nav preference (so creating a new deal Just Works in whatever currency you're looking at), but can be overridden per-deal. Editing an existing deal keeps its existing currency unless you change it.
- **Client detail MRR/hourly rate**: primary display is the org's `preferredCurrency` (what we invoice them in). Display-currency equivalent is shown as secondary when different.
- **Client portal and emails**: not affected. Clients always see native currency; emails render in the recipient's context.

**Implementation:**
- `lib/display-currency-context.tsx` exposes `displayCurrency`, `setDisplayCurrency`, `exchangeRates`, `toDisplay(nzd)`, `format(nzd)`, and `formatNativeWithDisplay(amount, currency)` \u2014 the last of which produces `"NZ$X \u2248 US$Y"` automatically when the currencies differ.
- `components/tahi/currency-switcher.tsx` is the nav dropdown.
- Exchange rates are fetched once per session via `/api/admin/exchange-rates`.
- SSR prints NZD on first paint; `useEffect` hydrates to the stored preference on mount. Acceptable one-frame flash; not worth a cookie round-trip.

**Replaced:** The per-page `<Select>` + local `displayCurrency` state + duplicate exchange-rate fetches on Pipeline and Reports. Reports' `DisplayCurrency` type widened from 5 currencies to the full 10 supported by `lib/currency.ts`.

**Lessons reused:** SSR-safe context hydration from `localStorage`, same pattern as the briefing-collapsed preference.

---

## #043 - Scheduled AI Daily Briefing

**Date:** 2026-04-21

**Problem:** The daily AI briefing only generated when the user clicked Generate. Needed it automatic every weekday morning at 8am NZ, regardless of DST.

**Decision:** GitHub Actions cron fires twice per weekday (19:00 UTC and 20:00 UTC, Sun\u2013Thu). The endpoint checks the current hour in `Pacific/Auckland` and only actually generates when it's 7 or 8. The off-cycle fire no-ops. Dedup window of 3 hours prevents double-generation if the user clicked Generate manually at 7:58am.

**Implementation:**
- `POST /api/admin/ai/briefing/cron` \u2014 new endpoint, authed via `x-cron-secret` header against `TAHI_CRON_SECRET` env var. Uses `Intl.DateTimeFormat` with timezone `Pacific/Auckland` to read the current NZ local hour + weekday cleanly. Forwards to the existing `POST /api/admin/ai/briefing` using bearer auth with `TAHI_API_TOKEN` so we don't duplicate the 180+ lines of data-gathering + Claude call + XML parsing.
- `.github/workflows/ai-briefing-cron.yml` fires the cron and passes both `TAHI_DASHBOARD_URL` and `TAHI_CRON_SECRET` from GitHub repo secrets.

**Cost:** ~$0.04 per briefing (Claude Sonnet 4: ~4.4k input tokens + ~1.5k output tokens). Per month (~22 weekdays) = ~$0.90. Per year = ~$10.40.

**What to set up on the repo:**
1. Add `TAHI_CRON_SECRET` to Webflow Cloud env vars (any random string).
2. Add `TAHI_DASHBOARD_URL` GitHub secret = `https://tahi-test-dashboard.webflow.io` (no trailing slash).
3. Add `TAHI_CRON_SECRET` GitHub secret (same value as step 1).

**Why Github Actions over Cloudflare cron:** Webflow Cloud's builder overwrites wrangler.json (Decision #039). Adding a cron trigger there would fight the platform. GitHub Actions is free, reliable, and external \u2014 nothing for the Webflow Cloud builder to clobber.

---

## #044 - Pipeline Probability Uses Journey, Not Ordinal Position

**Date:** 2026-04-21

**Bug:** The `historicalProbability` on each stage was computed as `wonDeals / dealsAtOrPastThisPosition` using the `position` column. Default stages put Stalled at position 5, between Verbal Commit (4) and Closed Won (6). The formula assumed every closed-won deal "passed through" Stalled because `position 6 >= position 5`. That gave Stalled an inflated 52% win rate and flattened every other stage's win rate around 25%, regardless of where in the pipeline it sat. Verbal Commit reported 27% (should be much higher) and Stalled reported 29% (higher than Verbal Commit), which is backwards.

**Decision:** Replace the ordinal-position formula with a journey-based one:

> **For each stage S**: of all deals that were ever at S in their journey, what percentage are now at a closed-won stage?

Implementation in `lib/pipeline-probability.ts`:
- `buildJourneyMap(events)` reads `deal_created` and `stage_change` activity rows (Decision #041) and returns a `Map<dealId, Set<stageId>>` of every stage each deal has actually been in.
- `inferStagesVisited(deal, stages, journey)` uses that journey when present, or falls back to linear inference for deals with no history \u2014 **excluding non-linear stages** (Stalled, On Hold, Paused) from the backfill so being at a linear stage doesn't imply a deal passed through a side detour.
- `computeStageProbabilities({ stages, deals, stageEvents, minSample })` returns `{ stageId \u2192 { historicalProbability, dealsSampled, wonCount, source } }`. `source` tells you whether the number came from `'journey'`, `'linear'` fallback, or is `'insufficient'` (sample < 3).

A non-linear stage is identified by slug: `stalled`, `on_hold`, `on-hold`, `paused`. This is tolerant of user-customised stage names.

**Wired into:**
- `/api/admin/pipeline/stages` \u2014 emits `historicalProbability` per stage using the new math. Also now returns `wonSampled` and `probabilitySource` for UI debugging.
- `/api/admin/reports/close-rates` \u2014 "Stage Conversion Rates" table now progresses only through linear stages, so the previous "Verbal Commit \u2192 Stalled: 95%" and "Stalled \u2192 Closed Won: 52%" rows no longer appear. The table now reads like the real funnel: Lead \u2192 Discovery \u2192 Proposal \u2192 Negotiation \u2192 Verbal Commit \u2192 Closed Won.

**Tests:** `lib/__tests__/pipeline-probability.test.ts` (16 tests) guards the fix, including a regression test that reproduces the exact 21-deal/52% Stalled bug and verifies the new math gives Verbal Commit > Stalled.

**Data maturity:** With only today's activity log to draw from, most answers will still come from the linear fallback. As more `stage_change` activities accumulate the `journey` source will dominate and numbers will tighten toward reality.

---

## #045 - Currency UX Cleanup

**Date:** 2026-04-21

Three small changes that together make the multi-currency experience feel lighter:

1. **Trimmed display-currency switcher.** `lib/currency.ts` now exports a secondary `DISPLAY_CURRENCIES` array (NZD, USD, AUD, GBP, EUR) used by the nav switcher, the New Deal dialog currency picker, the Deal Detail per-edit currency override, and the commitment form. `SUPPORTED_CURRENCIES` still carries all 10 entries so invoices, deals, and costs billed in CAD / SGD / HKD / JPY / CHF still render with the right symbols and decimals.

2. **Whole-dollar displays by default.** `formatCurrency(amount, currency, options?)` defaults to `decimals: 0`. KPI cards (Outstanding, MRR, pipeline value, weighted forecast) and most money displays round to the nearest dollar. Invoice line items can opt back into cents with `{ decimals: 2 }` if a specific number needs precision. JPY stays 0-decimal regardless.

3. **Invoice list + detail already show native currency primary / display-currency secondary** (Decision #042). No change needed there.

---

## #046 - Tasks Are Always Internal; One Question: Is It For a Client?

**Date:** 2026-04-21

**Problem:** The tasks table had three type values (`client_task`, `internal_client_task`, `tahi_internal`) and three UI tabs, which was clunky. Clients never see tasks regardless of the type \u2014 the internal/external distinction was a leftover from an earlier model. The type tabs also mis-computed counts: when a type filter was active, the server returned only matching tasks, so the counts on the other tabs dropped to zero.

**Decision:** Collapse tasks to a binary distinction:

- **Tasks are always Tahi-internal.** Clients never see them, full stop.
- **Requests are the client-facing channel.** Anything on a request is visible to the client.
- Each task is either **"for us"** (Tahi-internal work like "build a new landing page") or **"for a client"** (work we're doing on their behalf, like "send onboarding email to Acme"). The source of truth is `task.orgId`: present \u2192 for a client, null \u2192 for us.
- The legacy `type` column remains populated (no migration needed). Both legacy client-flavoured values (`client_task`, `internal_client_task`) collapse into `client_task` going forward; `tahi_internal` stays. Historical data keeps its original value and maps to the new bucket by `orgId` presence.

**UI changes (`app/(dashboard)/tasks/tasks-content.tsx`):**
- Three tabs: **All tasks** / **For us** / **For a client**. Counts are always computed from the full task list client-side, so switching tabs never zeroes out the other tab's count.
- List view fetches *all* tasks (type filter dropped from the server query) and buckets client-side via the `taskBucket()` helper.
- New task dialog replaces the 3-way radio grid with a 2-way "Who is this for?" picker.
- Legacy templates that set `type: 'internal_client_task'` auto-map to "for a client".

**API changes (`app/api/admin/tasks` POST):**
- Auto-derives the stored `type` from `orgId` presence when the caller omits it, so MCP and older clients keep working without a migration.
- Still rejects a client task that has no `orgId` so we never orphan a task with no client.

**Left for a follow-up commit:** AI wizard on requests. The task AI wizard (`components/tahi/ai-task-wizard.tsx`) is unchanged; we'll mirror its pattern into `ai-request-wizard.tsx` next so both surfaces get AI help, for clients and for us.

---

## #047 - Per-User, Per-Surface UI Preferences Persist Across Sessions

**Date:** 2026-04-21

**Decision:** Any UI toggle that the user cares about (view mode, tab selection, sort order) persists to `localStorage` so leaving and coming back to a page restores the same layout.

**Implementation:** `lib/use-user-preference.ts` exports a drop-in `useState` replacement:

```ts
const [view, setView] = useUserPreference<'kanban' | 'list'>(
  'pipeline.viewMode', 'kanban',
  { validator: oneOf<'kanban' | 'list'>(['kanban', 'list']) },
)
```

- Keys are namespaced under `tahi-pref:` to avoid colliding with the currency preference, theme, or any other local state.
- SSR-safe: first render returns the default, then hydrates from storage inside a `useEffect` (one-frame flash, imperceptible for toggles).
- `validator` (optional) gates stored values to a closed set. If a stored value fails validation we fall back to the default AND clear the bad key \u2014 useful when tab enums change over time.
- `oneOf(['a','b','c'])` is a helper for tab-style enums.

**Wired into:**
- Pipeline: `viewMode` (kanban/list), `sortKey`.
- Tasks: `typeTab` (all / for us / for a client), `statusTab`, `viewMode` (list/board).
- Requests: `viewMode` (list/board/workload), `sortKey`, `activeTab`. Replaced the pre-existing bespoke `getStoredPreference` implementation so all preferences now go through one codepath.
- Invoices: `activeTab` (all / draft / sent / overdue / paid / written off).

**Not wired (intentional):**
- Search input (ephemeral, resets on reload).
- Date-range pickers (usually task-specific).
- Priority/source filters (case-by-case; can be added via the same hook later).
- Selected IDs for bulk actions (ephemeral).

---

## #048 - AI Wizard on Requests + MCP Parity Maintained

**Date:** 2026-04-21

**Decision:** Requests get an AI wizard with the same shape as the existing task wizard. Both are reachable via MCP under their respective tool names so AI assistants can draft requests or tasks depending on whether the work is client-facing or internal.

**Request wizard (`POST /api/admin/ai/request-wizard` + `components/tahi/ai-request-wizard.tsx`):**
- Conversational, multi-turn. Asks 2\u20133 scoping questions then returns one or more request drafts with `title`, `description`, `category`, `type`, `priority`, `estimatedHours`.
- Claude Haiku 4.5 when `ANTHROPIC_API_KEY` is set. Same deterministic fallback as the task wizard (category keyword detection, type inference, size heuristics) when the key is absent or the API is rate-limited.
- Category set: `design | development | content | strategy`. Type set: `small_task | large_task | bug_fix | new_feature`. Priority set: `standard | high` (matches the request schema).
- Wired into the Requests list page as an "AI draft" button next to "Create Request". Admin-only for now; client-portal surface is a Phase 2 follow-up.

**MCP parity (Decision #036):**
- Added `ai_request_wizard` tool to both MCP servers (stdio at `mcp-server/index.ts`, HTTP worker at `workers/mcp-server/src/index.ts`).
- Fixed `ai_task_wizard` schema: previously `context` was typed as a string, now correctly an object with `orgId` and `trackType`.
- Updated `create_task` and `list_tasks` docstrings to reflect Decision #046: `type` is no longer required, auto-derives from `orgId` presence, and the legacy enum is now advisory rather than enforced. Stops AI callers from getting rejected for leaving `type` off a task create.

**Portal-side wizard (shipped same day):** `POST /api/portal/ai/request-wizard` uses portal auth (denies the Tahi admin org, derives the client's `orgId` from Clerk) and a client-safe system prompt that never mentions internal hours, pricing, plan tiers, tracks, or "our team will". Priority defaults to `standard` and only escalates to `high` when the client explicitly uses urgent / ASAP language. The submit path bypasses `orgId` / `isInternal` because the portal's `/api/portal/requests` endpoint already scopes writes to the authenticated user's org.

The `AiRequestWizard` React component now takes optional `wizardEndpoint` + `submitEndpoint` props so one component drives both admin and portal flows. The request-list page chooses the right pair based on `isAdmin`. Clients see the same "AI draft" button they need it to feel like the rest of the portal.

---
