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
