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
