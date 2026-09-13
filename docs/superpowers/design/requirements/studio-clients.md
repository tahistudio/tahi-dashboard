# Design requirements: studio-clients

Group: studio-clients (audience: studio only). Routes: `/clients`, `/clients/[id]`, `/clients/brands/[id]`, `/clients/contacts/[id]`.

Sources read: `CLAUDE.md`, `STATUS.md` "Since the last update", `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2a "clients" row, 2b "clients/[id]", "clients/brands/[id]", "clients/contacts/[id]" rows, section 3 functionality rows referencing clients), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, every `TASKS.md` line mentioning clients/CR.*/IC.2/MC.10/MC.10b/T668-676/T571, the live code under `app/(dashboard)/clients/**` and `app/api/admin/clients/**`, and the Claude Design project (`clients.jsx`, `clients-kit.jsx`, `clients-detail.jsx`, `clients-data.jsx`, `clients.css`; no design file exists for brands or contacts, confirmed against the project's file list).

---

## 1. Purpose and audiences

This whole group is studio-only. Every one of the four routes checks `orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID` at the top of its server component and redirects a client org away (`/clients` and `/clients/brands/[id]` and `/clients/contacts/[id]` all send a denied caller to `/overview` or `/requests`; `/clients/[id]` sends them to `/overview`). A client never reaches any page in this group by any route, deep link or nav item. This is the account layer: the master roster of client organisations, each account's full record (billing, health, tracks, contacts, brands, contracts, calls, money), and the two CRM-style leaf pages for a single brand or a single contact.

Its job: let the Tahi team find a client fast, read the state of the account in one glance (health, plan, tracks busy, who owns it, what needs attention), act on it (invite to portal, view as client, book a call, change owner, edit billing, pause or archive), and, for a super admin only, merge or delete a client record outright.

What it must never show:
- Money. The Invoices tab and the Money tab (Revenue, Profitability, Time, Deals) are gated on the `clients.billing_card` feature (`useFeature('clients.billing_card')` client-side, enforced again server-side on `/profitability` and `/costs`). A seat without that grant does not see a disabled tab; the tab is absent from the tab array entirely, and a deep link to `?tab=invoices` or `?tab=money` from a viewer without the grant silently rewrites the URL back to `?tab=` (Overview) with no toast or explanation.
- The Danger zone's Merge and Delete actions. `LifecycleDangerZone` returns `null` outright for anyone who is not `isSuperAdmin` (Liam or Staci per the granular-permissions system). There is no disabled button for anyone else to see; the whole block, including its heading and its warning copy, is not in the DOM.
- Another team member's out-of-scope clients. `GET /api/admin/clients` filters by `resolveAccessScoping(database, userId)`; `GET /api/admin/clients/[id]` additionally calls `requireAccessToOrg` so a scoped hire who guesses or is sent a client id outside their `teamMemberAccess` rule gets a 403, not a partial record.
- Super-admin-only merge and delete data even in a dry run. Both drawers require `isSuperAdmin` client-side and the DELETE route re-checks `resolvePermissions(...).isSuperAdmin` server-side before it will even preview a plan.

This group has no client-portal counterpart and no Messages surface at all, so the Messages-hidden-for-clients rule does not apply here directly, but it is worth noting: nothing on `/clients/[id]` links to `/messages` (verified by V1-FIX.1, `ct/dead-pointers` audit), which is deliberate, not an oversight.

---

## 2. Pages, sub pages and entry points

### `/clients` (list)

Entry points: sidebar "Clients" nav item; any "View Client" link from a brand or contact detail page; any "Clients" breadcrumb crumb from a detail page.

- The rail: search box, saved views (All, Active retainers, Projects, At risk, Paused, Completed, Archived), each carrying a live count. "Completed" was added under Decision #060 (2026-09-10) alongside the client status vocabulary change.
- Filter dimensions: status, plan, health, owner, tag, tracks, each opening its own chip menu; a "Clear filters" affordance when any is active.
- Sort: a sort-key select (Name, Health, Open requests, MRR admin-only, Last activity, Client since) plus a direction toggle.
- View switcher: list view and cards view, persisted per the rail's saved-state pattern.
- Bulk bar, appears on selection: assign owner, add tag, export CSV, archive.
- Per-row actions: Open, View as client, Invite, Archive or Restore (Unarchive), reachable from a kebab on desktop and inline on the mobile card.
- "New client" panel (a slide-over): Client or company name, Website, Industry, Plan (with a plan-specific hint line), primary contact First name / Last name / Email, and a "Send the portal invite now" toggle.
- Server-side paging with a page bar.
- States surfaced inline: first load, hard error, stale-error-with-cached-data, empty-for-real, empty-because-of-filters, empty-because-past-the-last-page.

### `/clients/[id]` (client detail)

Entry point: any row's Open action on `/clients`, or any client-name link elsewhere in the studio app. URL state: `?tab=<id>` for the open tab (omitted for Overview, the default).

Hero, always visible above the tabs, not a tab itself:
- Identity block: avatar, name, non-active status badge, studio tags, industry, website link, "Client since" date, brand chips (each opens Settings).
- Action row: Invite to portal (emails a link to the primary or first contact; disabled with no contacts), View as client (opens an impersonation banner and redirects to `/overview`), and an overflow menu: Edit details and settings, Book a call, Invoices, New deal, Refresh this page, Pause/Resume the retainer (only when a subscription exists), Archive/Unarchive client.
- Stat strip: Plan (with track words, e.g. "1 of 2 tracks busy"), MRR or Billing (admin-only column, drops out entirely for a seat without `clients.billing_card` so the grid never carries a dead column), Health (with a hover/tap tooltip naming the reason), Owner (a menu to reassign the account's PM from the team roster), Next call (links into the Calls tab, offers "Book a call" when none is scheduled).

Nine possible tabs (seven always shown, two gated on `clients.billing_card`), each a `?tab=` destination:

1. **Overview.** Needs-you strip (money-gated items only appear for a viewer who can see money), tracks rendered as mini-kanban lanes, recent requests, the onboarding checklist rail card, and the same Studio notes and AI health check cards that live in Settings (intentionally one component, one endpoint, not a duplicate).
2. **Requests.** The shipped Requests list/board/detail kit, scoped to this client; sub-requests are filtered out of the top-level count; an honest custom-column badge.
3. **Invoices** (gated). Per-currency sums, one shared overdue predicate used by the badge, the strip and the table so nothing reads red in one place and neutral in another.
4. **Files.** A flat list with working R2 serve links; search narrows the list; no folders, no per-file comment thread.
5. **People.** Contacts CRUD: add, edit, a contact detail slide-over panel (`?` state, not a route), portal role and last-login shown per contact; a same-email duplicate is flagged with a "Duplicate" badge and a row-level "Merge into" action that opens a `ConfirmDialog` naming the reference counts moving across, backed by `/api/admin/contacts/[id]/merge` (distinct from the org-level super-admin Merge drawer in the Danger zone).
6. **Papers.** Three independent lists in one tab: Proposals, Contracts, Schedules, each with its own empty state and its own icon.
7. **Calls.** Upcoming and past calls, a "Book a call" form (the hero's Next call stat and the overflow menu's "Book a call" both open this tab with the form expanded), honest attendee copy.
8. **Money** (gated). A four-way segmented control inside one tab, one section mounted at a time: Revenue (what has been invoiced, landed, still owed), Profitability (gross margin: revenue minus billable time at the client's default hourly rate, minus logged client costs, with a cost-entry form and cost deletion behind a confirm), Time (every hour logged against this client), Deals (pipeline still being sold to them).
9. **Settings.** Nine stacked sections: Organisation details (name, website, industry, health status and note, plan, billing model, custom MRR and its currency, default hourly rate, preferred currency, retainer start/end dates, invoice channel, payment terms, each auto-derived field carrying a manual-override pill and a "reenable auto" action), Subscription (plan, add-ons, billing interval, or a "no subscription" state), Tracks (how many parallel slots, a link back to Overview for the lanes themselves), Brands (a read-only footnote of legacy free-text brand labels, then the live Brands CRUD list backed by the `brands` table), Tags (studio-only labels), Studio notes (free text), AI health check (a human-in-the-loop Claude Sonnet card: narrative plus a suggested health status and suggested actions, nothing is applied until a person clicks "Apply" or "Save note"), Portal visibility (a link out to `/permissions`, deliberately not a second grid), and a collapsible Danger zone (Pause/Resume the retainer, Archive/Unarchive, and, super-admin only, Merge into another client and Delete this client).

Sub-panels and dialogs off the detail page:
- **Merge drawer** (`SlideOver`, super admin only): pick a surviving client, "Preview the merge" runs a dry run and prints a full plan (rows that move by table, external ids carried across, fields filled on the survivor, contacts moved versus folded into a matching email, warnings), then a second `ConfirmDialog` before the real write. Redirects to the survivor's page on success.
- **Delete drawer** (`SlideOver`, super admin only): "Check what would be deleted" runs a dry run (refused outright for an imported client, a real login, a signed-in contact, pipeline rows, or a paid invoice on a live rail), an "accidental workspace" checkbox appears only when every login on the org belongs to a Tahi teammate and the org holds no invoice or external id, a typed-name confirmation gate, then a second `ConfirmDialog`. Redirects to `/clients` on success.
- **Pause/Resume and Archive/Unarchive**: a single shared `ConfirmDialog`, reachable from the hero overflow menu or the Settings Danger zone.
- **New Invoice panel**, **File panel**, **Contact panel**: slide-overs opened from within their respective tabs (Invoices, Files, People), state held in the page's `fileId` / `contactId` URL-less state, not a route.

### `/clients/brands/[id]` (brand detail)

Entry point: any brand chip in the client hero, any brand row in Settings, any "View Client" on a tagged-request summary that names a brand.

- Breadcrumb: Clients > [Organisation] > [Brand name].
- Header: logo (falls back to a colour-swatch icon on image load error) or a gradient swatch, name, primary-colour chip with its hex, website link.
- Organisation card: click-through back to `/clients/[id]`.
- Brand details card: primary colour, website, tagged-request count, linked-contact count, free-text notes, created date.
- Contacts linked to this brand: a list, each row click-through to `/clients/contacts/[id]`; empty state names where to link one ("from the client detail page").
- Tagged requests: a count plus a "View Client" button (there is no list of the individual requests on this page, only the number and a bounce to the client).
- 404/fetch-error bounces to `/clients`.

### `/clients/contacts/[id]` (contact detail)

Entry point: any contact row in the client People tab, any contact row on a brand detail page, any contact link elsewhere that resolves a person.

- Breadcrumb: Clients > [Organisation] > [Contact name].
- Header: initials avatar, name, role chip, Primary chip when applicable.
- Contact information card: email (mailto link), role, last login (when known), added date.
- Organisation card: click-through back to `/clients/[id]`.
- Linked deals card: a list of deals this person is attached to, with stage and currency-formatted value.
- Activity timeline card, with an inline "Add" quick-form (type: Call/Email/Meeting/Note/Task, title, optional description) that posts to `/api/admin/activities`.
- Recent messages card: a list of this contact's message bodies with a "View request" link when the message belongs to a request thread.
- 404/fetch-error bounces to `/clients`.

---

## 3. States and variants

- `/clients` loading: `SkeletonTable` with 8 or 9 columns (canSeeMoney adds the MRR column), matching the eventual header shape so nothing reshuffles on load.
- `/clients` empty, no clients at all (Copy): "No clients yet" / "Add the first one and the roster starts here. Give them a primary contact and we email that person a link into their portal." with an "Add the first client" CTA.
- `/clients` empty, scoped teammate with zero clients in scope: "No clients in scope for this teammate" / "Their access rules do not reach any client, so this list is empty for them." No CTA.
- `/clients` empty, filters/search matched nothing: "No clients match" / "Try clearing a filter, a saved view, or the search." with a "Clear filters" action.
- `/clients` empty, page past the end: "Nothing on this page" / "This page is past the end of the list. The clients are on the earlier pages." with a "Back to page 1" action.
- `/clients` hard error (no cached data): inline `EmptyState`, "The client list did not load" / "The request to the clients endpoint failed. Nothing has changed on your side.", "Try again" action.
- `/clients` stale error (cached data still on screen): the table is kept, the error is not shown as a blocking state (SWR holds `error` until the next successful revalidation).
- `/clients/[id]` loading: a bespoke `LoadingSkeleton` (hero-shaped plus tab-strip-shaped placeholders).
- `/clients/[id]` fetch error: no rendered error state, the page silently `router.push('/clients')`.
- `/clients/[id]` tab-specific empty states: Requests ("No requests for X yet" when zero ever, "Nothing live right now" when all delivered), Files ("No files yet" or "No files match that search"), People ("Nobody here yet"), Papers (three independent empties: "No proposals for this client", "No contracts on file", "No delivery schedule yet"), Invoices ("No invoices for this client yet"), Time ("No time entries for this client yet"), Deals (its own `EmptyState`), Calls ("Nothing booked").
- `/clients/[id]` permission variant: a seat without `clients.billing_card` sees seven tabs and a four-cell stat strip; a seat with it sees nine tabs and a five-cell strip. Neither state shows a disabled affordance for the other, they are simply absent.
- `/clients/[id]` super-admin variant: the Danger zone's Merge and Delete rows exist only for `isSuperAdmin`; everyone else's Danger zone stops at Pause/Resume and Archive/Unarchive.
- `/clients/brands/[id]` and `/clients/contacts/[id]` loading: each has its own bespoke `LoadingSkeleton` (header-shaped plus card-shaped placeholders using `animate-pulse`), matching the pattern on `/clients/[id]`.
- `/clients/[id]` read-only client view: does not exist. There is no client-facing rendering of this page at all; the closest analogue is "View as client", which opens the actual client portal (`/overview`) under an impersonation banner, a different route entirely, not a read-only mode of this page.
- 375px: hero action row cannot wrap below `md`; the labelled Invite and View-as-client buttons shrink and truncate with an ellipsis rather than push the overflow kebab off-row (documented in code as a deliberate fix for a prior 328px-vs-311px overflow bug). Tab strip scrolls horizontally with the active tab auto-scrolled into view; nine tabs are roughly three screens wide at 375px. Mobile bottom-nav spacer (`h-28 md:hidden`) reserved beneath the content.
- 768px: hero stat strip is `grid-cols-2`; brand and contact detail pages drop from a 3-column grid to a single column below `lg`.
- Dark mode: every token in `client-hero.tsx`, `client-tabs.tsx`, `org-details-card.tsx` and the tab files reads CSS var references (`var(--color-...)`), so dark mode should render without hardcoded-hex regressions; this has not been re-verified live since the "tab-consistency pass" landed (catalogue, in flight, no ticket id given). Brand and contact detail pages also use CSS var references throughout despite their legacy Tailwind-class composition, so dark mode contrast should hold there too, but neither page has been screenshotted in dark per any audit on record.
- Print or public: not applicable, this whole group is studio-internal and has no public or printable variant.

---

## 4. Features and actions

### `/clients` (list)

**Works today:** saved views with live counts including the new Completed view (Decision #060); status/plan/health/owner/tag/tracks filters; sort with a direction toggle; list and cards view; health-reason tooltip, keyboard and touch reachable; MRR column with an honest fallback, admin-only; whole-row checkbox selection; bulk bar (assign owner, add tag, export CSV, archive); server-side paging; per-row Open/View as client/Invite/Archive-or-Restore; mobile card layout with 2.75rem actions; New client panel with labelled fields and a send-invite toggle; team-member access scoping enforced server-side on the list query (`resolveAccessScoping`).

**Exists but wrong or half built:** the catalogue's functionality section (T668-676) lists "retainer health filter" as still owed, but the live rail already ships a health filter dimension and an "At risk" saved view keyed on the same predicate; treat the catalogue line as partly stale for this specific piece and confirm with Liam what, if anything, is still missing beyond MRR forecast end-date awareness and auto-churn (both genuinely unbuilt, see below). MC.10b: Physitrack still carries two Stripe customer ids after the Evan Kwan merge, so any MRR/billing read for that one org is unresolved until Liam's judgement call lands.

**Planned or missing:** MRR forecast end-date awareness, auto-churn (an automated status transition), team salary/rate fields and their downstream margin columns at the studio-report level (T668-676, needs schema batch S25; note this is distinct from the per-client Profitability tab on the detail page, which already computes a real gross margin today using the client's default hourly rate as a cost proxy).

### `/clients/[id]` (client detail, all tabs and the hero)

**Works today:** the full hero (identity, actions, five/four-cell stat strip, owner reassignment); nine tabs (Overview, Requests, Invoices, Files, People, Papers, Calls, Money with four sub-sections, Settings with nine sections); `?tab=` URL sync with keyboard-roving, auto-scrolling tab strip; Invite to portal (emails the primary or first contact via `/welcome-email`, reports partial-send counts honestly); View as client (real impersonation banner, not a stub); Pause/Resume and Archive/Unarchive with confirm dialogs and honest copy about what does and does not change; per-client custom MRR, billing model, invoice channel, payment terms and retainer dates, all editable with an auto-derive override pill and a "reenable auto" action per field (IC.2, shipped); per-client gross-margin Profitability (revenue minus billable time at the default hourly rate minus logged costs, with a cost-entry and cost-deletion flow); AI health check, human-in-the-loop, never auto-applies (Claude Sonnet, cost recorded via `lib/ai-cost.ts`); Brands CRUD inside Settings; contact-level duplicate detection (same email) with a row action to merge one contact into another via `ConfirmDialog`, separate from the org-level Danger zone Merge; super-admin Merge (dry-run-first, full plan, external-id conflict refusal) and Delete (dry-run-first, refusal reasons named in the server's own words, typed-name confirmation, an "accidental workspace" Clerk-org-removal offer when every login is a Tahi teammate's).

**Exists but wrong or half built:** the catalogue notes "the tab-consistency pass already in flight" for this page with no further detail on record; a viewer denied `clients.billing_card` who follows a stale `?tab=invoices` or `?tab=money` link is silently bounced to Overview with no toast explaining why the tab they expected is gone; the page's own server component (`page.tsx`) does not call `requirePageFeature('clients')` the way `/clients`, `/clients/brands/[id]` and `/clients/contacts/[id]` all do, it only checks `orgId === NEXT_PUBLIC_TAHI_ORG_ID`; a denied teammate is instead caught by the API's `requireFeature` plus `requireAccessToOrg` 403 and a client-side `router.push('/clients')`, which is a real gate but a different, less consistent pattern than its sibling pages (code-verified, not in TASKS.md as its own ticket). MC.10b (Physitrack's two Stripe customer ids) affects this page's Money tab and hero MRR for that one client until Liam decides.

**Planned or missing:** client LTV (T571, folds into T711-T713 on `/financial-reports` and `/sales-analytics`); team salary/rate fields feeding a truer cost basis than the current default-hourly-rate proxy in Profitability (T668-676, needs S25); auto-churn and MRR forecast end-date awareness (T668-676); MC.10b resolution (Liam's judgement).

### `/clients/brands/[id]` (brand detail)

**Works today:** logo with graceful image-error fallback; organisation link-through; brand details (colour, website, tagged-request count, linked-contact count, notes, created date); linked-contacts list with click-through; tagged-requests summary; breadcrumb; 404/error bounce; page-level `requirePageFeature('clients')` gate (unlike the client detail page, this one does call it).

**Exists but wrong or half built:** no design file at all exists for this page (confirmed against the Claude Design project's file list); composition is legacy Tailwind cards with only `Breadcrumb` and `TahiButton` as shared primitives, no `PageHeader`, no leaf radius, no `DataTable`.

**Planned or missing:** design and port from scratch (catalogue Batch H5); no in-place editing of a brand's own fields from this page (creation and editing only happens from the client's Settings > Brands CRUD panel); no list of the individual requests tagged with this brand, only a count.

### `/clients/contacts/[id]` (contact detail)

**Works today:** contact info card (email, role, last login, added date); organisation link-through; linked deals list; activity timeline with an inline quick-add form (type, title, optional description) posting to `/api/admin/activities`; recent messages list with view-request links; breadcrumb; 404/error bounce; page-level `requirePageFeature('clients')` gate.

**Exists but wrong or half built:** no design file exists for this page either; legacy composition, same primitives gap as the brand page.

**Planned or missing:** design and port from scratch (catalogue Batch H5, flagged as "the page a CRM lives or dies on"); no in-place editing of the contact's own name, email, role or portal authority from this page (that only happens from the client's People tab); no pagination or filter on the activity timeline or the messages list, both render everything the API returns.

---

## 5. Data and integrations

**API routes:**
- `/api/admin/clients` (GET list with `resolveAccessScoping` and filter/sort/paging params, POST create).
- `/api/admin/clients/[id]` (GET with `requireFeature('clients')` and `requireAccessToOrg`, PATCH for org fields and status changes, DELETE super-admin-only with dry-run plans).
- `/api/admin/clients/[id]/pm` (GET/PUT account owner).
- `/api/admin/clients/[id]/merge` (POST, super-admin-only, dry-run and real).
- `/api/admin/clients/[id]/welcome-email` (POST, portal invite, per-contact send results).
- `/api/admin/clients/[id]/health-summary` (POST, AI health check, human-in-the-loop only).
- `/api/admin/clients/[id]/auto-derive` (auto-derivation for billing model, retainer dates, custom MRR).
- `/api/admin/clients/[id]/tracks` (track count configuration).
- `/api/admin/clients/[id]/contacts` (People tab CRUD).
- `/api/admin/contacts/[id]/merge` (POST, contact-level duplicate merge from the People tab row action, distinct from the org-level Danger zone Merge).
- `/api/admin/clients/[id]/calls` (Calls tab).
- `/api/admin/clients/[id]/costs` and `/costs/[costId]` (Profitability cost entries).
- `/api/admin/clients/[id]/profitability` (gross-margin computation).
- `/api/admin/brands` and `/api/admin/brands/[id]` (hero chips, Settings CRUD, brand detail page).
- `/api/admin/contacts/[id]` (contact detail page, bundles contact plus activities, deals, messages).
- `/api/admin/contacts/[id]/references` (GET, what a delete or merge would move: reference counts, the portal-login and only-primary blockers, and sibling contacts at the org, read before the People tab's merge or delete confirm).
- `/api/admin/activities` (quick-add on the contact detail page).
- `/api/admin/invoices?orgId=`, `/api/admin/contracts?orgId=`, `/api/admin/requests?clientId=` (shared reads the hero and several tabs pull from, one SWR key per resource so the hero and the tab body share one request).
- `/api/admin/team-members` (Owner menu, PM assignment).

**Tables:** `organisations`, `contacts`, `subscriptions`, `tracks`, `brands`, `requests`, `invoices` and `invoiceItems`, `timeEntries`, a client-costs table (Profitability), `deals`, `scheduledCalls`, `tags`, `contracts` (the catalogue flags that the Papers tab's contract search still reads a dead legacy `contracts` table rather than `contract_documents`, so a search there is not honest today), `auditLog` (merge and delete write an audit trail).

**Third parties:** Stripe (customer id surfaced on the delete-plan preview), Xero (`invoiceChannel` resolution via `lib/invoice-channel.ts`), Clerk (impersonation, accidental-workspace org removal on delete, invite email destination), Resend (the welcome-email invite send), Anthropic Claude Sonnet (AI health check, cost recorded via `lib/ai-cost.ts`, the same rate-card that carries the known Opus-pricing bug elsewhere in the app, though the health check itself is Sonnet, not Opus).

**Must be honest:** Money and Invoices are hidden rather than shown-and-blocked, correct today. The AI health check never mutates without an explicit human click, correct today. Merge and Delete are always dry-run-first with the server's own refusal wording surfaced verbatim, correct today. The one known dishonest surface in this group is the Papers tab's contract search reading the dead legacy table instead of `contract_documents`, which means a search there can silently miss or misname a real contract.

---

## 6. Design system contract

The live build already uses: `PageHeader` (list page), `Breadcrumb` (all three detail-level pages), `SlideOver` (Merge, Delete, New Invoice, File and Contact panels), `ConfirmDialog` (pause, archive, and the second confirmation inside Merge/Delete), a bespoke roving-tabindex `ClientTabs` primitive built specifically because the shared `SegmentedControl` only fits two or three plain-string options and this page needs nine with icons and badge counts, `Card`/`Section` local wrappers inside Settings, `TahiButton` sizing that clears 2.75rem at every breakpoint (CR.4), and leaf-radius avatar wrappers in the hero and on brand swatches.

**What the existing design file gets right:** `clients.jsx` / `clients-kit.jsx` / `clients-detail.jsx` / `clients-data.jsx` / `clients.css` carried a SHIP verdict at Pass 3 (the 23-page consistency pass) for the list and the original eight-tab detail composition (Overview, Requests, Invoices, Files, "Contacts and brands," "Contracts and proposals," Calls, Settings). The critic's own note on that pass was explicit: "keep Deals/Time/Revenue/Profitability via a Money tab, keep the status filter and an Archived view." The shipped build (CR.1 through CR.4) took that note further than the design file itself specified: it split "Contacts and brands" back into a standalone People tab with Brands folded into Settings instead, and it built the critic's suggested Money tab as a real ninth tab with four sub-sections (Revenue, Profitability, Time, Deals) behind a segmented control, none of which exists as rendered markup in the design file itself. The design's Settings tab also specified a per-client Health rules editor (quiet/overdue/idle-track day thresholds) and a Portal-visibility template picker with per-feature switches; the live build deliberately dropped both, with the reasoning left in code comments: there is no schema column to back a per-client health-rules override (the rules in `lib` are the studio default for every client), and portal visibility already belongs to the shipped `feature_visibility` system and its `/permissions` builder, so a second, weaker copy here would only drift out of sync.

**What the design must change:** the nine-tab, four-sub-section live composition has never been re-critiqued against the actual shipped shell; Pass 3 only reviewed the original eight-tab file. A fresh critic pass should confirm the Money tab's segmented-control treatment, the People/Brands split, and the Papers tab's three-lists-in-one-tab pattern against the design system's rail and headline-band standard (the standard the catalogue names `/requests` as the reference for) before calling this page's design settled. Separately, `/clients/brands/[id]` and `/clients/contacts/[id]` have no design file at all; both need a design pass from scratch, most plausibly composed from the same `clients-kit.jsx` primitives (`Hero`-style header, `Card`, `Field`, `EmptyState`) rather than a wholly new visual language, since they are one-person, one-brand leaf pages off the same account model.

---

## 7. Open questions for Liam

1. MC.10b: is Physitrack's Stripe-customer-id conflict ready for your judgement now, or should it stay parked until after the current sprint batches land?
2. Should `/clients/brands/[id]` and `/clients/contacts/[id]` go through a Claude Design pass before they are ported (design-first), or is a direct port straight onto existing v3 primitives acceptable for these two leaf pages, given neither carries novel interaction beyond what `/clients/[id]` already establishes? (A: design first / B: port directly)
3. The live build dropped the design file's per-client Health rules editor and its Portal-visibility template picker in favour of studio-wide defaults and the `/permissions` builder. Do you want either one rebuilt as a genuine per-client override (which would need new schema), or does the current studio-wide-plus-permissions-builder answer stand for good? (yes/no on each)
4. Should `/clients/[id]/page.tsx` gain the same explicit `requirePageFeature('clients')` server-side call that `/clients`, `/clients/brands/[id]` and `/clients/contacts/[id]` already have, purely for consistency, even though the API layer already enforces the same boundary today? (yes/no)
5. Is the nine-tab Money-as-a-container composition (Deals, Time, Revenue and Profitability folded under one Money tab, built ahead of a formal critic re-pass) the shape you want kept, or should any of those four move back out to their own top-level tabs the way `clients.jsx`'s literal markup still shows them? (A: keep Money as a container / B: split one or more back out, name which)

---

## 8. Acceptance for the design review

1. Client list: seven saved views (All, Active retainers, Projects, At risk, Paused, Completed, Archived) each show a real, non-zero-looking count in the screenshot; the MRR column is present in an admin/owner capture and absent in a scoped-seat capture.
2. Client detail hero at 1440: five stat cells (Plan, MRR or Billing, Health, Owner, Next call) render with no dead column; the same hero at a screenshot without `clients.billing_card` shows four cells, not five with one blanked out.
3. Tab strip at 375: the active tab's pill is fully in view after any tab change, no tab label is clipped mid-word, and the strip scrolls rather than wraps.
4. Danger zone: in a non-super-admin capture, Merge and Delete are entirely absent (no greyed-out button, no ghost row); in a super-admin capture both are present with their full warning copy.
5. Settings > Brands: the legacy free-text footnote (when present) is visually distinct (grey, read-only styling) from the live Brands CRUD list beneath it, so a reviewer cannot mistake one for the other.
6. Money tab: Revenue, Profitability, Time and Deals render as one segmented-control frame at both 1440 and 375, not as four separate top-level tabs competing with the other seven.
7. Dark mode: the hero stat strip, the health badge dot, and the Danger zone's red-bordered card all hold contrast with no hardcoded-hex bleed-through, per the CLAUDE.md token rule.
8. 375px: the hero's Invite-to-portal and View-as-client buttons stay on one row with the overflow kebab, never wrapping to an orphaned third line.
9. Brand and contact detail pages: the breadcrumb reads Clients > [Organisation] > [Brand or Contact name] at both 1440 and 375, and the organisation card visibly navigates back to the right client.
10. Papers tab: with a client that has zero proposals, zero contracts and a draft schedule, all three sections show their own icon and copy independently, never one shared blank state standing in for all three.
