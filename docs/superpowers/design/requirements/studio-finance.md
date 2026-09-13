# Design requirements: studio-finance

Group: studio-finance. Audience: studio. Routes: `/invoices` (studio ledger half), `/invoices/[id]` (studio half), `/billing` (studio half), `/financial-reports`, `/time`.

Source read for this document: CLAUDE.md, STATUS.md ("Since the last update" through 2026-09-13 plus the triage snapshot), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (rows for `/invoices`, `/invoices/[id]`, `/billing`, `/financial-reports`, `/time`, plus Batch B and the Functionality table entries IC.8, MR.6, T707-T715, T668-T676, T600, CT.16), `docs/superpowers/plans/2026-09-13-design-review-checklist.md` (Studio invoices row; Time/Team/Tracks/Capacity row; "Not designed yet" list, which names Billing (studio) and Financial reports explicitly), every `TASKS.md` line naming these routes or their features (IC.1 to IC.9, CT.13, CT.14, CT.16, MC.10, MC.10b, MR.6, CB1/CB2/CB5, T600, T668-676, T700-715, T716), the live code (`app/(dashboard)/invoices/page.tsx`, `invoice-list.tsx`, `[id]/invoice-detail.tsx`, `source-badge.tsx`, `invoice-status.tsx`; `app/(dashboard)/billing/page.tsx`, `billing-content.tsx`; `app/(dashboard)/financial-reports/page.tsx`, `financial-reports-content.tsx`; `app/(dashboard)/time/page.tsx`, `time-list.tsx`; `app/api/admin/invoices/**`, `app/api/admin/billing/**`, `app/api/admin/time/**`, `app/api/portal/invoices/**`, `app/api/portal/billing/session/route.ts`; `lib/require-feature.ts`, `lib/feature-tree.ts`, `lib/invoice-*.ts`, `lib/hourly-export.ts`, `lib/stamp-invoiced.ts`, `lib/portal-admin-label.ts`), and the Claude Design project (`invoices-studio.jsx` in full, 694 lines, plus `invoices-studio-kit.jsx`/`invoices-studio-data.jsx`/`invoices-studio.css` by name only; `ops.jsx` lines 1 to 129 of 1142, the Time module's opening). No design file exists for `/billing` (studio) or `/financial-reports`; both are on the checklist's "Not designed yet" list, confirmed against `list_files` on the project (no `billing-studio.*` or `financial-reports.*` files present).

Sibling documents already cover the client-portal halves of `/invoices` and `/billing` (`client-invoices.md`, `client-billing-services.md`) and are not repeated here except where the studio and client branches share one file, one route, or one design decision.

## 1. Purpose and audiences

Who opens it: exclusively Tahi's own team, on the studio org (`orgId === NEXT_PUBLIC_TAHI_ORG_ID`). `/time` and `/financial-reports` are studio-only in the strictest sense: a client org is redirected off the route server-side (`/time` to `/requests`, `/financial-reports` to `/overview`) before any data fetch runs, and a Tahi admin previewing "Client view" (the `tahi-impersonate-org` cookie) is treated as a client for that purpose and redirected too, so a support session can never leak the studio's own cash position into a screenshot of what a client sees. `/invoices` and `/billing` are shared routes: the same file branches on `isAdmin` (and, for `/invoices`, on whether an admin is currently previewing a client), so the studio half described here is only reachable by a real Tahi login that is not currently impersonating anyone.

Within the studio org, three of the four routes are gated a second time by the granular permission tree (`lib/feature-tree.ts`), independent of the org check: `invoices`, `billing`, `financial_reports` and `time` are each their own feature-tree node (`appliesTo: ['team']` for billing/time/financial_reports; `invoices` also `appliesTo: 'client'` since the client half of the file shares the key). A team member denied one of these by a permission rule is redirected server-side (`requirePageFeature`) before the page component ever renders, not merely hidden from nav. This is the floor T1.15/T1.18 (deny-by-default, nav gating) are meant to make universal; today these four specific routes already enforce it at the route.

What each page's job is:
- `/invoices` (studio): the whole studio ledger across every client, in one table, answering "what is owed, by whom, and can they actually pay it."
- `/invoices/[id]` (studio): one bill's full lifecycle, meaning line items, which rail carries it, what the last write to that rail actually did, and every next action available on it.
- `/billing` (studio): a cross-client subscriptions and revenue overview, the KPI-and-table cousin of the client's own plan card.
- `/financial-reports`: the finance cockpit Liam opens to make hire, spend and tax decisions. Cash, runway, MRR, AR aging, tax, take-home, and the recurring-outflow forecast, sectioned under one sticky jump nav.
- `/time`: the manual time ledger every hourly-billed hour and every Xero export is built from, plus rollups by client and by team member.

What it must never show:
- Client-side vocabulary or a client's own money surface bleeding sideways: nothing on this list is portal-scoped, but every write these pages make (mark paid, void, sync to Xero, create a Stripe link) is exactly what the client eventually sees reflected on their own `/invoices` and `/billing`, so the studio and portal invoice-status vocabularies must never diverge. `InvoiceStatusBadge` and `isInvoiceOverdue` are imported from the same `../invoices/invoice-status` module by both the studio invoice list and the studio `BillingContent`'s admin view, so there is exactly one status-colour mapping to keep in sync, not three.
- A cross-tenant row. Every admin API route here (`GET /api/admin/invoices`, `/api/admin/time`, `/api/admin/billing/financial-health`) is scoped by `isTahiAdmin(orgId)` plus, on `/api/admin/invoices` specifically, `requireFeature(..., 'invoices')`; there is no org-boundary concern on the admin side the way there is on the portal side, because every row IS the studio's own ledger. The only tenancy concern that applies is the reverse one: a team member whose access is scoped to specific clients (per `teamMemberAccess`, planned) must not see another client's invoices or time entries once T1.16 ("per-org scoping batch B: deals, conversations, calls, time entries, announcements") lands; today `/api/admin/time` and `/api/admin/invoices` are visible in full to any seat that passes the `invoices`/no-feature-gate check, which is the pre-T1.15 default described in STATUS as "deny by default" not yet flipped.
- Draft invoices are still visible here (this is the studio's own working-copy list, unlike the portal one), but the list says so out loud rather than folding a draft's total into anything the client could mistake for owed money: the draft note under the filter row reads "N drafts, {amount} not yet issued", grouped by currency, and is never shown to the client branch.
- Super-admin-only areas: none of the five routes are gated beyond the `invoices`/`billing`/`financial_reports`/`time` feature nodes; there is no super-admin-only sub-panel inside this group (contrast `/permissions`, which is out of scope here).
- Not part of this route group, but relevant background for a reviewer: Messages is hidden for every client organisation as of Giant Group readiness Batch A (STATUS, 2026-09-13). None of the five pages in this group link to a client-visible Messages surface; the studio invoice detail's "AI chase" flow and the client's own "Ask" actions exist specifically because Messages is not there to lean on.

## 2. Pages, sub pages and entry points

- **`/invoices`** (studio branch). Reached from the sidebar "Invoices" nav item (feature-tree key `invoices`, route `/invoices`), and from `/billing`'s "Recent Invoices" table ("View all" link) and its row click-through. Renders `InvoiceList` when `isAdmin && !previewing`.
  - **Create invoice** slide-over (`CreateInvoiceSlideOver`), opened by the "Create invoice" header button or by the empty-state CTA. Three destination tabs inside it: Dashboard only, Xero draft, Stripe link, defaulted from the picked client's `invoiceChannel`/`paymentTerms`/`preferredCurrency` (IC.2, IC.3) the moment a client is selected, never before.
  - **Export CSV** (header button, `GET /api/admin/export/invoices`, browser download, no dialog).
  - **Import from Stripe** (header button, `POST /api/admin/integrations/stripe/import-invoices`, no dialog; reports imported/updated/skipped counts as a toast).
  - Date range filter is two inline native `<input type="date">` controls beside the FilterBar, not a FilterBar-native date kind (the component comment states FilterBar has no date kind yet).
- **`/invoices/[id]`** (studio branch). Reached by any row click on the studio list, by `/billing`'s recent-invoices table, by a deep link from an invoice email or notification, and directly by URL. Renders `InvoiceDetail` when `isAdmin && !previewing`.
  - **Edit**: reopens `InvoiceForm`/the same create-style slide-over pre-filled, available only while the invoice is a draft (per the Claude Design file's stated rule; live code exposes "Revert to Draft" and the create form separately rather than one editable-draft affordance, see section 4 for the discrepancy).
  - **Void / Bring back** confirm dialog (`ConfirmDialog`, "Void this invoice?").
  - **Delete** confirm dialog ("Delete this invoice?"), enabled only for a draft.
  - **AI chase draft** card (`ChaseDraftCard`), shown only when `status` is `sent` or `overdue`: Draft → edit subject/body inline → Send or Dismiss. This is a real, already-wired AI generation and send flow (`POST` to a draft-chase route, not a mock), the studio-side sibling of the lead AI-reply pattern.
  - **Send / Resend email** (`SendInvoiceEmailButton`), which also folds in the Xero-side "did Xero email its own copy" outcome into one status line, distinct tones for a clean send, a partial bounce, and a hard failure.
  - **Sync to Xero**, **Create Stripe Link**, **Copy Payment Link**: one-off action buttons, each conditional on the invoice not already carrying that rail's id.
  - **Mark as Paid** and **Revert to Draft**: direct status-patch buttons, no dialog.
- **`/billing`** (studio branch, `AdminBillingView`). Reached from the sidebar "Billing" nav item (feature-tree key `billing`, route `/billing`, studio-only in the tree even though the same URL also serves clients). No sub-pages, dialogs or slide-overs of its own; every interactive element is a link out (to `/clients/[orgId]`, to `/invoices/[id]`, to `/invoices` itself) or a Refresh button that re-fetches both `/api/admin/subscriptions` and `/api/admin/invoices?limit=10`.
- **`/financial-reports`**. Reached from the sidebar "Financial reports" nav item (feature-tree key `financial_reports`). One page, eight sections under a sticky jump nav (Cash, Revenue, MRR, Sales, Outflows, Tax, Take-home, Planning), each independently scrollable-to, not separate routes or tabs.
  - **Reserve target editor**: inline edit affordance on the Cash section's reserve card (`onSavedTarget`/`ReserveTargetCard`), saves in place, no navigation.
  - **Take-home target editor**: same pattern on the Take-home card (`TakeHomeCard`, `onSaved`).
  - **Recurring outflow / commitment editor**: a full slide-over (`add`/`edit` states, `emptyCommitmentForm`) reached from the Outflows section's "Add commitment" button and each row's Edit action; pause/resume toggle per row; delete confirm dialog; a separate "Auto-detect cadence" dialog that infers a billing day and cadence from the last 180 days of Airwallex transactions.
  - No print or public variant; this is an internal-only financial cockpit.
- **`/time`**. Reached from the sidebar "Time" nav item (feature-tree key `time`). Two view tabs inside the page (not separate routes): **Entries** (flat list) and **By client** (grouped rollup, `ByClientView`).
  - **Log time** slide-over (`LogTimeSlideOver`), opened by the header "Log time" button or the empty-state CTA; billable toggle, optional client and request link, optional rate override.
  - **Edit** (reopens the same slide-over pre-filled) and **Delete** (confirm dialog, "Delete time entry") per row, via a row menu.
  - **Export CSV** (header button, `GET /api/admin/export/time`).
  - No dialog exists yet for previewing or triggering an Xero export from this page; the hourly export (IC.6/CT.13) and the pre-export backfill stamp (IC.8) are both operated from Settings or the MCP, not from `/time` itself (see section 4).
  - This page is the one route in the group with no equivalent client-facing branch at all: there is no portal `/time`.

## 3. States and variants

**`/invoices` (studio list)**
- Loading: `DataTable` internal skeleton rows (the `loading` prop passed straight through), filter row and header render immediately.
- Empty, no invoices at all: leaf icon, title "No invoices yet", description "Create your first invoice to get started.", action "Create invoice".
- Empty, filtered to nothing: title "No matches", description "Try clearing a filter or adjusting your search."
- Error: plain centred text "Failed to load invoices." plus a Retry button (this state has no `EmptyState`/leaf-icon treatment the way the client branch and every other v3 list does; see section 6).
- Populated: full table (Invoice, Client, Amount, Status, Source, Due, Created); no mobile card variant is defined for the admin branch (`mobileCard={isAdmin ? undefined : renderMobileCard}`), so below `md` the admin table falls back to the DataTable's own horizontal-scroll behaviour rather than a stacked card.
- Read-only / member-seat / dark-mode variants specific to the client branch are out of scope here (see `client-invoices.md`); the studio branch has no read-only mode, because a Tahi admin who is genuinely on this route is never previewing.
- 375px: not a designed state today. The admin table has no card fallback, so at 375px the operator scrolls the table horizontally; this is an accepted studio-internal trade-off recorded implicitly by the code comment contrasting it with the client card treatment, not a documented decision.
- 768px: same horizontal-scroll table as 375px; no distinct tablet layout.
- Dark mode: every colour on the page is a CSS var reference (`--color-*`, `--badge-*`), so dark mode should render without contrast regressions, unverified live.

**`/invoices/[id]` (studio detail)**
- Loading: `InvoiceDetailSkeleton`.
- Not found: `InvoiceLoadFailed` with `notFound` set, reading "Invoice not found." plus a back-to-invoices link, no retry (nothing to retry).
- Error (fetch failed, not not-found): `InvoiceLoadFailed` with a Retry action.
- Populated, draft: primary action is "Email to client" (the Send button in its primary/filled variant); Mark as Paid withheld (nothing has been asked for yet); Revert to Draft withheld (already a draft); Void and Delete both available.
- Populated, sent/overdue: `ChaseDraftCard` renders; Mark as Paid becomes the second action; Revert to Draft becomes available; Delete withheld (only a draft can be deleted).
- Populated, paid/written-off/settled: Send withheld, Mark as Paid withheld, Void withheld; the sidebar's Getting-paid card and any pushback outcome line still render (what happened the last time this invoice's rail was told about the payment).
- Populated, a rail pushback failed or was skipped: `OutcomeLine` renders in the tone matching the outcome (`pushbackCopy`), carrying the actual reason string from the rail (e.g. "No Xero payment account code in settings") rather than a generic failure.
- 375px: the two-column `grid-cols-[1fr_16rem]` sidebar layout collapses to `grid-cols-1` below `md`, so the Getting-paid/Dates/Linked-records sidebar stacks under the main column; action buttons wrap onto multiple lines rather than overflowing.
- 768px: still single-column (the sidebar split only engages at `md`, 768px, so a 768px viewport is at the exact boundary; verify live which side of it a real 768px device lands on).
- Dark mode: CSS-var-only styling throughout; the danger-zone / confirm-dialog copy is theme-agnostic text.

**`/billing` (studio, `AdminBillingView`)**
- Loading: `LoadingSkeleton rows={6}`.
- Error (either `/api/admin/subscriptions` or `/api/admin/invoices?limit=10` failed): `EmptyState` with an alert icon, title "We could not load billing", description "Nothing has changed on any account. Try again in a moment.", action "Try again".
- Empty, no active subscriptions: `EmptyState` inside the subscriptions table, title "No subscriptions", description "Client subscriptions will appear here."
- Empty, no recent invoices: `EmptyState` inside the invoices table, title "No invoices yet", description "Invoices will appear here once created."
- Populated: four KPI cards (Active Subscriptions, Total Clients, Recent Invoices, Outstanding), a billing-interval summary grid (Monthly/3-Month/12-Month client counts, rendered only when at least one interval has clients), an Active Subscriptions table, a Recent Invoices table (capped at 10, "View all" links to `/invoices`).
- 375px: KPI grid is `grid-cols-2` at every width (no `sm`/`md` step-up is defined for the admin KPI row the way the interval-summary grid has one), so four cards render two-by-two even at 375px; the two DataTables have no mobile-card definitions and rely on the DataTable's default horizontal scroll.
- 768px: interval-summary grid becomes 3-across at `sm` (640px), so a 768px viewport already sees the widened layout.
- Dark mode: CSS-var-only; unverified live.
- No read-only, member-seat, or print variant applies (studio-only branch).

**`/financial-reports`**
- Loading: `PageHeader title="Financial reports" subtitle="Loading…"` with nothing else rendered below it (no skeleton body for the eight sections).
- Error: `PageHeader title="Financial reports" subtitle="Could not load financial summary."`, likewise with no retry action or further detail on the page itself.
- Populated: hero band (cash + revenue at a glance) then the eight sections in one continuous scroll behind the sticky jump nav; a "Needs attention" card surfaces computed risk items (stale bank sync, concentration risk, AR aging, etc) ahead of the sectioned detail.
- Empty sub-states exist per card, not per page: e.g. "No commitments yet" inside Outflows, "No reserve pots" inside Cash, each as an inline `EmptyHint`, not a full-page empty state (this page can never be "empty" as a whole while the studio has any financial history).
- 375px: not verified against a documented breakpoint audit; the page comment states "rem units only, no raw px" and CSS-var-only colour, but no explicit mobile grid collapse note the way `/invoices/[id]` has one. Treat 375px behaviour of the eight sections, the jump nav (sticky, likely too wide for 375px in its current form), and the commitment slide-over as unverified and worth a dedicated pass.
- 768px: same, unverified.
- Dark mode: CSS-var-only per the file's own design-rules comment; unverified live.
- No client, read-only, or print variant; studio-only, redirect-gated before render.

**`/time`**
- Loading: `LoadingSkeleton rows={5} height={56}` inside the By-client view; the Entries view's `DataTable` uses its own internal `loading` skeleton.
- Empty, no entries at all (Entries tab): leaf icon, title "No time entries yet", description "Log your first time entry to start tracking hours.", action "Log time".
- Empty, filtered to nothing (Entries tab): title "No matches", description "Try clearing a filter, search term, or date range."
- Empty, no entries at all (By-client tab): `Users` icon, title "No time entries yet", description "Log your first time entry to start tracking hours by client." (a different description string from the Entries tab's empty state for the same underlying condition; see section 6).
- Populated: three `SummaryCard` tiles (Total hours, Billable hours, Entries), then, once loaded with at least one row, an insight row (a `FeatureCard` hero tile, a bar chart of hours by team member, a donut of billable vs non-billable), then the table or the by-client card list.
- 375px: `IC.9` records specific under-44px controls at this width, namely segmented tabs (37px), Add filter (30px), sort headers (18px) and search input (19px), all below the 2.75rem (44px) touch-target rule, currently open and explicitly noted as "superseded if the week-grid redesign happens first," meaning not worth fixing in place if the port replaces the whole page.
- 768px: not separately documented; the insight-row grid collapses to a single column at `max-width: 64rem` (1024px) per the inline media query, so a 768px viewport already sees the stacked single-column chart layout, not the three-across one.
- Dark mode: CSS-var-only; unverified live.
- No client, read-only, or print variant; studio-only, redirect-gated before render.

## 4. Features and actions

### `/invoices` (studio list)

**Works today**
- Create invoice on any of three rails (Dashboard only, Xero draft, Stripe link), defaulted from the client's own channel/terms/currency the instant a client is picked (IC.2, IC.3), with an explicit warning when the operator overrides the client's usual rail.
- Stripe pre-flight check: blocks invoice creation on the Stripe rail when the selected client has no contact with an email, with an inline fix-it message naming the client.
- Export CSV, Import from Stripe (with imported/updated/skipped counts surfaced as a toast).
- Status filter (Draft/Sent/Viewed/Overdue/Paid/Written Off), Source filter (Manual/Xero/Stripe), date-range filter, free-text search across client name, invoice id and invoice number.
- Draft total note, grouped and summed by currency, shown only to the studio.
- Real invoice numbering (`INV-YYYY-NNNN`, IC.7/CT.14) everywhere a reference is shown, with a short-id fallback for anything numbered before the migration.

**Exists but wrong or half built**
- The fetch-error state ("Failed to load invoices.") is plain centred text with a Retry button, not the `EmptyState` component every other v3 list on this route group uses (visible contrast against the client branch's own denial states, which do use `EmptyState`). Cosmetic/consistency issue, not a data bug.
- No mobile-card fallback on the admin branch; a phone-width operator session scrolls the table horizontally rather than getting the client branch's stacked-card treatment. Not flagged in TASKS as a defect (studio-internal), but out of step with CLAUDE.md's mobile rule if a teammate genuinely works this page from a phone.

**Planned or missing**
- MR.6: the studio invoices surface is designed in Claude Design (`invoices-studio.*`) but critic-verdicted FIX (two blocking interaction bugs in the scratch mount, plus defects); a fixer is running; port is blocked on that fix landing, then on CB4 ("studio invoices port waits on the critic FIX (MR.6) and Liam's design review").
- No pagination on the admin list; the code comment states the server returns at most 50 rows and pagination is a follow-up task (not independently ticketed under a backlog id found in this read).

### `/invoices/[id]` (studio detail)

**Works today**
- Full lifecycle actions: Send/Resend email (with a real Xero-side "did Xero also email its own copy" outcome folded into one status line, tri-state tone), Mark as Paid, Revert to Draft, Void/Bring back, Delete (draft only), Sync to Xero, Create Stripe Link, Copy Payment Link.
- A real AI chase-draft flow for sent/overdue invoices (generate, edit subject and body inline, Send or Dismiss), the sibling of the lead AI-reply pattern, not a stub.
- Rail pushback outcome is surfaced verbatim (e.g. a missing Xero payment account code), not swallowed.
- Getting-paid sidebar (bank details, Xero payment account code, invoice-email mode), Dates sidebar, Linked-records sidebar.
- Source badge (Manual/Xero/Stripe) shown only to the studio, shared component with the list.

**Exists but wrong or half built**
- The design file (`invoices-studio.jsx`) documents an "Only a draft can be edited" rule with a single dedicated `InvoiceForm` reused for both create and edit; the live code instead exposes "Revert to Draft" as a separate status action and reopens the create-style slide-over for editing. Functionally similar, not verified to be the identical interaction the design specifies. Worth a design-vs-build reconciliation pass rather than treating the design file as already matched.
- No standalone critic verdict exists for this half of the invoices-studio design file (the checklist and catalogue only name one MR.6 verdict covering the whole module: list, detail, create, chase).

**Planned or missing**
- Live pay-link round trip as a real client at 375px, named explicitly as outstanding polish/QA in the catalogue (effort 0.5d, priority 1) even though the underlying detail page is already ported and live.
- MC.10 (judgement, decided 2026-09-12): two Dante Media invoices show VOIDED in Xero but were recorded paid on the dashboard by Liam's own judgement (paid_at set, rail pushback off); `lib/xero-status.ts` now refuses to let a Xero void demote a locally-paid row, so this reads as a permanent reconciliation exception on that pair of rows, not an open task. Worth surfacing on the detail page itself (an outcome-line-style note) rather than only in TASKS, since a future operator looking at either invoice would otherwise see paid with no explanation for the Xero mismatch.
- MC.10b (judgement, open): Physitrack carries two Stripe customers (one kept after the Evan Kwan contact merge, the other still referenced by older invoice rows), so a studio operator opening one of those older invoices sees a Stripe customer link that no longer matches the client's current Stripe record. Still open, Liam's call.

### `/billing` (studio)

**Works today**
- KPI strip (Active Subscriptions, Total Clients, Recent Invoices, Outstanding), billing-interval breakdown (Monthly/3-Month/12-Month client counts), Active Subscriptions table, Recent Invoices table (10 most recent, links to `/invoices` and `/invoices/[id]`).
- Already composed on v3 primitives (`PageHeader`, `KPICard`, `DataTable`, `Card`, `Badge`) as of the CB2 merge (STATUS, c1e8c24e). This is more built than the 2026-09-13 page-catalogue row states ("Legacy (3 raw tables, PageHeader only)"); treat the catalogue's "Legacy" classification for `/billing` as stale relative to STATUS and this code read, and the checklist's "Not designed yet... Billing (studio)" line as still accurate (no Claude Design file exists regardless of the port state).

**Exists but wrong or half built**
- No dedicated per-row action beyond "View all" / navigate-away; the page is read-only by design (subtitle: "Subscriptions, invoices, and revenue overview"), so there is nothing here comparable to the studio invoice detail's action set. Not a defect, a scope note for a reviewer expecting write controls.

**Planned or missing**
- No Claude Design file exists for this surface at all (confirmed against the project file listing); any redesign starts from a blank canvas, not a critic verdict to react to.
- CT.16's decision half (whether `/billing` belongs in the client nav at all) is resolved for the client branch (out of the client nav by default, per STATUS); it has no bearing on the studio branch documented here, which is always reachable via the sidebar regardless.

### `/financial-reports`

**Works today**
- Daily-trusted per STATUS: cash and bank balances (multi-currency, source-of-truth chips for Stripe/Xero/Airwallex), reserve pots, revenue (effective monthly, quarterly target, year-on-year), MRR breakdown by client with concentration-risk flagging, sales section (recent paid invoices, recent signed deals, AR aging), outflows (recurring commitments with pause/resume/edit/delete/auto-detect-cadence), tax reserve progress, take-home progress toward Liam and Staci's individual targets (editable target), planning/what-if spend-impact tiles, a "Needs attention" computed risk card ahead of the sectioned detail.
- Full CRUD on recurring commitments (add/edit/delete/pause/resume) plus an "Auto-detect cadence" tool that infers billing day and cadence from 180 days of real Airwallex transaction history. This is a genuine backend-wired editor, not a display-only card.
- Editable reserve target and take-home targets, saved in place.

**Exists but wrong or half built**
- `finance.yieldHoldings` is stale against Airwallex (Xero shows Yield USD 33,956.89 / AUD 638.80 vs the setting's 20,014.13 / 531.51). STATUS P0, open, fix is a settings update after the next deploy lands (T0.3).
- Loading and error states are minimal (a one-line subtitle swap on the `PageHeader`, no skeleton body, no retry action), unlike every DataTable-backed list on the other four routes in this group.

**Planned or missing**
- T707-T715 ("Intelligence and analytics"): `BankRunwayCard` statement rows, outstanding-KPI dedup (T708, two KPI tiles currently compute overlapping "outstanding" figures from different sources), revenue per head, client LTV, pipeline quality.
- T668-T676 ("Retainer and billing model"): `customMrr`/`billingModel` editors, retainer health filter, MRR forecast end-date awareness, auto-churn, team salary/rate fields, time cost/revenue/margin columns; needs schema batch S25 first.
- T600: cash-flow runway indicator, described as "largely shipped; verify then close." Treat as functionally present but not yet formally signed off.
- No Claude Design file exists for this surface (confirmed against the project listing and the checklist's "Not designed yet" list).

### `/time`

**Works today**
- Log/edit/delete a time entry (client, optional request link, billable toggle, rate override), Entries and By-client views, summary tiles, hours-by-member bar chart, billable-mix donut, CSV export, filter by billable/client/team-member, date-range and text search.
- Feeds real downstream billing logic: `time_entries.invoice_id`/`invoiced_at` (migration 0095, IC.6/CT.13) makes the hourly Xero export idempotent, and `POST /api/admin/time/stamp-invoiced` (IC.8) can retroactively stamp historical entries as already invoiced before that export's first live run over an old period. Both are built, both are dry-run-by-default, and neither is exposed as a control ON this page (see below).

**Exists but wrong or half built**
- IC.9: four controls fall under the 44px touch-target minimum at 375px (segmented tabs 37px, Add filter 30px, sort headers 18px, search input 19px). Explicitly marked "superseded if the /time week-grid redesign happens first," meaning this is a known, accepted-as-temporary defect, not a silent one.
- No UI on this page for the Xero export or the backfill stamp: an operator has to go to Settings or the MCP to preview or run either, even though both operate directly on the rows this page displays. The design file (`ops.jsx`) draws a running top-of-page timer card on the Time surface itself; the live app has no such card on `/time` (the equivalent timer exists as a separate global `TimerChip` in the top nav, wired to `/api/admin/timers/*` and to `general`-kind entries against an internal Tahi org per the 2026-09-02 general-time-timer plan). A reviewer should not expect the design file's on-page timer to be a feature the port needs to invent; the underlying capability already exists elsewhere in the app and the design just surfaces it on a different page.

**Planned or missing**
- Full port of the `ops.jsx` Time module (week-grid, rollups, rate editor with an explicit save step, per-client value/unpriced totals) is not started; blocked on a re-critique (Pass 3 verdict was FIX: "week-grid VALUE column clips money to 'NZ$2,7...'").
- IC.8's apply step ("run the dry run, read the count, then apply") is Liam's call and has not been run against production history as of the last STATUS entry read.

## 5. Data and integrations

- **Tables**: `invoices`, `invoiceItems`, `organisations` (for `invoiceChannel`, `paymentTerms`, `preferredCurrency`, `defaultHourlyRate`), `subscriptions`, `timeEntries` (plus `invoice_id`/`invoiced_at` from migration 0095), `teamMembers`, `requests` (time-entry linkage), `exchangeRates`, `settings` (studio invoicing defaults: `invoicing.defaultChannel`, `invoicing.numberSequence`, `invoicing.bankDetails`, `invoicing.xeroPaymentAccountCode`, `invoicing.xeroEmailMode`, `finance.yieldHoldings`, `invoice_number_prefix`), `auditLog` (implied by the outcome-line pattern, not independently verified in this read).
- **Admin API routes**: `GET/POST /api/admin/invoices`, `GET/PATCH/DELETE /api/admin/invoices/[id]`, `POST /api/admin/invoices/[id]/send-email`, `POST /api/admin/invoices/[id]/draft-chase` (implied by `ChaseDraftCard`), `POST /api/admin/invoices/xero-sync`, `POST /api/admin/invoices/stripe-create`, `POST /api/admin/invoices/backfill-numbers`, `POST /api/admin/invoices/dedupe-manyrequests-twins`, `POST /api/admin/invoices/dedupe-stripe-charges`; `GET /api/admin/billing/financial-health`, `POST /api/admin/billing/monthly-email`, `POST /api/admin/billing/xero-export`; `GET/POST /api/admin/time`, `GET/PATCH/DELETE /api/admin/time/[id]`, `POST /api/admin/time/stamp-invoiced`; `GET /api/admin/subscriptions`; `GET /api/admin/export/invoices`, `GET /api/admin/export/time`; `POST /api/admin/integrations/stripe/import-invoices`.
- **Portal routes touched indirectly** (because the studio and client branches share files on `/invoices` and `/billing`): `GET /api/portal/invoices`, `GET /api/portal/invoices/[id]`, `GET /api/portal/billing/session`, `GET /api/portal/subscription`. Not this group's responsibility to redesign, but any studio-side status-vocabulary or currency-formatting change must stay in step with them since the components are literally shared.
- **Third parties**: Stripe (invoice/hosted-page creation, customer portal session, import), Xero (draft push, online-invoice-URL capture, payment reconciliation, P&L and bank-balance reads for `/financial-reports`, the hourly export), Airwallex (bank balances, reserve pots, cash trend, commitment auto-detect-cadence, read via Xero-adjacent sync jobs per `project_bank_truth_architecture` in memory: Airwallex is the cash truth, and Xero's ledger drifts and must never be quoted as cash on this page).
- **What must be honest**: draft invoices must never count toward any total a client-facing figure could echo; the "Outstanding" KPI on `/billing` and the AR-aging figure on `/financial-reports` currently compute from overlapping-but-not-identical sources (T708, open); `finance.yieldHoldings` is a stale hand-entered figure until T0.3 lands, so any card reading it should be treated as unverified until then; every rail-pushback outcome shown on the invoice detail must keep surfacing the real reason string rather than collapsing to a generic success/fail, since that is the one thing standing between "marked paid" on the dashboard and a client still being chased by Xero.

## 6. Design system contract

- **Primitives already in use, correctly, across this group**: `PageHeader` (all five pages), `Card`/`Card.Divider`, `DataTable` (list/table surfaces on `/invoices`, `/billing`, `/invoices/[id]` line items), `EmptyState` (most empty/error states, the studio invoice-list fetch-error state is the one exception, see below), `SlideOver` (create invoice, log time, add/edit commitment), `ConfirmDialog`, `FilterBar`, `SegmentedControl`, `KPICard`, `Badge`, `TahiButton`, `Money`, the leaf radius on primary CTAs and icon wrappers, CSS var tokens throughout (no hardcoded hex found in any of the five live files read).
- **What the existing design file gets right** (`invoices-studio.*`, the one file this group has): it names the three questions the surface has to answer ("What is owed", "Can this client pay", "What do I do about this one") and builds the totals-strip-plus-saved-views list, the rail chip carrying live pay-link state, the bulk action bar, and the chase drafter to answer them directly. This matches what the live code already does functionally (a real chase drafter, a real rail-pushback outcome line), so the port is much closer to a visual reskin of working logic than a from-scratch build. The design file also states every screen takes a `demo` prop of `ready | loading | empty | error | scoped`, which is the same five-state discipline this document asks for in section 3.
- **What the design must change / has an outstanding critic verdict**: MR.6 verdict is FIX, not SHIP ("two blocking interaction bugs in the scratch mount, plus defects"); a fixer is running per TASKS, so do not treat the current file as port-ready without confirming the fix landed and was re-verified. No critic verdict exists yet for `/billing` (studio) or `/financial-reports`, because no design file exists for either; both need a from-scratch design pass, not a fix pass, before any port conversation starts. `ops.jsx`'s Time module carries a Pass 3 FIX verdict specifically on the week-grid VALUE column clipping money at narrow widths, the same defect class IC.9 already names on the live page, so the fix has to solve both the design file's clipping and the live page's sub-44px controls, not just one.
- **A gap between the design file and the built app worth flagging explicitly, not silently porting over**: `ops.jsx`'s Time module includes an always-visible running-timer card at the top of the page. The live `/time` page has no such card; the equivalent capability (start/pause/resume/stop a timer against a client or task) already exists as a separate, already-shipped `TimerChip` in the global top nav. A designer picking this up should decide whether the Time page gains its own timer card (duplicating the top-nav one) or whether the design should be revised to point at the existing top-nav affordance instead of inventing a second one.
- **Consistency issue for the design pass to fix, not just port**: the studio invoice list's fetch-error state is plain centred text with a Retry button, while every other error/empty state across this group (and every other v3 list in the app) uses the `EmptyState` component with a leaf/alert icon. This is a one-line code fix, not a design decision, but the design file should specify it explicitly (a Failed/EmptyState variant) so the port does not reproduce the inconsistency.

## 7. Open questions for Liam

1. Should `/billing` (studio) keep its current KPI-strip-plus-two-tables layout as the basis for a v3 design pass, or does it need a structural rethink (e.g. folding the interval-summary grid into the KPI row) before Claude Design starts on it. A) keep the current structure and just re-skin it, or B) treat it as a from-scratch layout problem?
2. Should `/financial-reports` gain a full skeleton loading state and a retry action to match every other page in this group, or is the current one-line "Loading…"/"Could not load financial summary." subtitle swap intentional for this specific page (it never legitimately renders empty, so a heavier skeleton may be wasted effort). Yes to the fuller skeleton, or no, leave it as is?
3. Should the studio `/time` page gain its own on-page running-timer card (as `ops.jsx` draws it), or should the design instead point at the existing top-nav `TimerChip` and leave `/time` itself timer-free. A) add a page-level timer card, or B) leave timing to the top nav only?
4. Does the studio invoice list need a mobile-card fallback (matching the client branch's `InvoiceMobileCard`) for teammates who genuinely work this page from a phone, or is horizontal-scroll-on-a-table an accepted trade-off for a studio-internal surface. Yes, build a card fallback, or no, leave the table as is?
5. For the "Outstanding" KPI dedup (T708), should `/billing`'s Outstanding KPI and `/financial-reports`'s AR-aging figure be made to read from the exact same computed source (one number, two places it appears), or are they intentionally different metrics (e.g. one scoped to recent invoices only, the other to the full ledger) that should just be labelled more precisely instead of unified. A) unify to one source, or B) keep them distinct and relabel?

## 8. Acceptance for the design review

1. At 1440px light and dark, the studio `/invoices` list, `/invoices/[id]` detail, `/billing`, `/financial-reports` and `/time` all use the same status-colour vocabulary for an invoice (Draft/Sent/Viewed/Overdue/Paid/Written Off reads identically wherever it appears across the five screens in the screenshot set).
2. At 1440px, `/invoices/[id]`'s action row for a sent-or-overdue invoice shows the AI chase-draft card, and its copy in the screenshot reads as a real generated draft (subject + body), not a placeholder lorem block.
3. At 375px light and dark, every primary action button on all five pages (Create invoice, Log time, Add commitment, Mark as Paid, Send email) measures at least 44px tall in the screenshot's own scale reference, and no page shows a horizontal scrollbar on its outer page frame (a table's own internal horizontal scroll, if any, is acceptable and should be called out as such, not treated as a fail).
4. At 375px, the `/time` page's segmented tabs, Add filter control, sort headers and search input either measure at least 44px or the screenshot is accompanied by a note confirming this is the known IC.9 gap being carried forward, not a new regression.
5. At 1440px light and dark, `/financial-reports`'s sticky jump nav stays legible and does not overlap the hero band or any section heading when scrolled to each of the eight sections in turn.
6. At 1440px, `/billing` (studio)'s KPI strip, interval-summary grid and both tables all use `KPICard`/`DataTable`/`Card` primitives with no bespoke table markup, matching the "already on v3 primitives" state recorded in section 4 (i.e. the redesign should not regress this to bespoke HTML tables).
7. In dark mode at 1440px, the studio invoice detail's rail-pushback `OutcomeLine` (success/partial/failure tones) is legible in all three tones, and the danger-zone Void/Delete section reads as visually distinct from the ordinary action row without relying on a side-only border.
8. At 1440px, the studio invoices list's error state (currently plain centred text) is redesigned as an `EmptyState`-pattern screen (icon, title, description, Retry action) consistent with every other list in the group, and the screenshot set includes this state explicitly, not just the populated one.
