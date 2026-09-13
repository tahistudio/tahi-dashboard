# Design requirements: client-billing-services

Group: `client-billing-services`. Routes: `/billing` (both audiences, client half is the gate for this brief), `/services` (both audiences, client half is the gate).

Sources read: CLAUDE.md, STATUS.md ("Since the last update" and the triage snapshot), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2a and 3), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md (CT.11, CT.16, MC.5, MC.10b, MR.7, CL.2, CL.3, CB1, CB2, T2.8, T2.9, DL.3), the live code for both pages and their API routes, and `portal-money.jsx` / `portal-money-data.jsx` in the Claude Design project (`57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`).

One correction up front: the catalogue and STATUS both describe `/billing` as "legacy, 3 raw tables, PageHeader only." That is stale. Commit `c1e8c24e` (CB2, referenced by TASKS CT.16) already ported it onto Card, DataTable, KPICard and Badge, and pulled it out of the client nav. The live code is the source of truth below; the catalogue's "Not ported" line for `/billing` should be treated as done pending live smoke, not as a build task.

---

## 1. Purpose and audiences

`/billing` is the client's own plan-and-invoice ledger and the studio's read-only revenue dashboard. `/services` is the client's showcase of what Tahi Studio takes on, keyed to their own plan, and the studio's catalogue editor for that showcase. Both routes are single files that branch by audience inside one server component; there are no separate URLs per audience.

Who opens `/billing`:
- A client workspace admin, checking their plan, next invoice date and invoice history, or opening the Stripe customer portal. Reached by direct URL only (see section 2); no nav item points here for a client today.
- A client member seat (a contact who is not the org's primary/admin contact). They are refused the whole page with an honest denial card, not an empty or broken one.
- A Tahi team member with the `billing` feature grant. Sees every client's subscriptions and recent invoices.
- A Tahi admin previewing a client ("Client view" impersonation). Sees the client branch, read-only, exactly as that client would.

Who opens `/services`:
- Any client seat, including a member seat, can browse the full catalogue and use every "Ask about this" and "Talk about..." action.
- A client workspace admin additionally sees the plan panel (rate, tracks, next invoice, add-ons) and the plan ladder (their rung and its neighbours), because those reads are money-gated the same way `/billing` is.
- A Tahi team member with any granted role reaches the admin catalogue editor (`requirePageAnyGrant`, not a specific feature key).
- A Tahi admin previewing a client sees the client's read-only catalogue, never the admin editor, even though the underlying login is an admin's.

What it must never show:
- Cross-tenant data. `/api/portal/services` filters on `showInCatalog = 1 AND visibility = 'public' AND (orgId IS NULL OR orgId = caller's own orgId)`; a private catalogue row belonging to another client can never reach this client's grid. `/api/admin/services` applies access scoping (CLAUDE.md rule 11) to private rows only; a deny-all scoped team member still sees the studio's global catalogue but no client's private row.
- A member seat must never see the plan panel, the ladder, rate, add-on values, or next invoice date. Both `/api/portal/subscription` and `/api/portal/capacity` 403 a member seat; the UI treats that 403 as a rule (the panel simply is not there) and never renders it as an error.
- The "Manage Billing" button must never render for a client on the Xero rail (no Stripe customer): it is conditioned on `subscription.canManagePayment`, which is false for any org without a Stripe customer id.
- Studio KPIs and tables on the admin `/billing` view must never show a placeholder number; every figure (`Active Subscriptions`, `Outstanding`, invoice rows) comes from a live SWR fetch against `/api/admin/subscriptions` and `/api/admin/invoices`.
- No price ever appears on the client catalogue or the plan ladder except the client's own rate on their own plan card. `lib/plan-ladder.ts` enforces "a rung only carries a number if the number is the client's own" in code, not just in copy.
- The client-portal-wide rule that Messages is hidden from the nav by default (Liam, 2026-09-13) is not specific to this group, but the design shell for this audience must not reintroduce a Messages tab or any billing/services affordance inside it; Messages stays out of scope here.
- Neither page has a super-admin-only area. `/billing`'s studio branch is gated on the `billing` feature grant (any Tahi team member who holds it, not only Liam/Staci); `/services`'s studio branch is gated on holding any grant at all.

---

## 2. Pages, sub pages and entry points

### `/billing`
One route, no sub-routes, no slide-overs, no dialogs. Behaviour branches on `getViewAudience()` (studio admin vs. everyone else) inside `billing-content.tsx`.

- **Studio view** (`AdminBillingView`): KPI row (Active Subscriptions, Total Clients, Recent Invoices, Outstanding), a "Clients by Billing Interval" card row, an Active Subscriptions `DataTable` (row click goes to `/clients/[orgId]`), and a Recent Invoices `DataTable` (row click goes to `/invoices/[id]`, capped at 10, with a "View all" link to `/invoices`). Reached today only via the sidebar Finance group, `adminOnly: true`; there is no client-side link into this branch.
- **Client view**: a Current Plan card (plan name, status badge, billing interval badge, next invoice line, cycle total, add-ons box) and an Invoice History `DataTable` (row click goes to `/invoices/[id]`). Reached by direct URL only: CT.16 (merged) removed `/billing` from `CLIENT_NAV` on purpose, so there is no sidebar or bottom-tab entry for a client. The only in-app paths that land here are a stale bookmark, a notification link that predates the removal, or a hand-typed URL.
- **Manage Billing**: not a sub-page, an `<a target="_blank">` open of a Stripe-hosted billing-portal session URL from `/api/portal/billing/session`. Renders only when `subscription.canManagePayment` is true.

### `/services`
One route, no sub-routes. Behaviour branches on `isAdmin` and a `previewing` flag (the `tahi-impersonate-org` cookie) inside `page.tsx`.

- **Studio view** (`AdminServicesContent`): a flat list of catalogue rows with Refresh and "Add service" actions, a modal-style create/edit form (Audience: Everyone or one named client via `SearchableSelect`; Visibility: Shown or Hidden; price, currency, recurring interval, category), and a coupons panel. Reached only by direct URL; `/services` has no entry in `ADMIN_NAV` and no link to it from any other admin page (checked: no other file references the `/services` href). This is worth flagging to Liam (see section 7).
- **Client view** (`PortalServices`): one scrolling page, four stacked sections, no tabs and no query-string state:
  1. Plan panel (Card): rate, tracks running, on-plan-since date, next invoice date, add-ons list, a "Talk about your plan" action. Org-admin only; absent (not errored) for a member seat.
  2. Plan ladder (`PlanLadder` + `RungItem`): the client's own rung with its down/up neighbours, a "Talk about moving up" / "Talk about how this is running" nudge card that appears only when `planPressure()` fires, or a calm reassurance line when it does not. Org-admin only, same gate as the plan panel.
  3. Catalogue grid with filter chips (by delivery mode: ongoing / add-on / top-up / project) and per-card "Ask about this."
  4. A foot card, "Not sure which of these you need? Ask us anything."
  - **Ask sheet**: a `SlideOver` (`PortalAskSheet`), opened from every "Ask about this" / "Talk about..." action across the page. Two destinations inside it: "Start a request" (posts to `/api/portal/requests`, lands in the client's own Requests queue) and "Email us" (opens a `mailto:` link, writes nothing). This is the only interactive sub-panel on either page in this group.

---

## 3. States and variants

One line per state per page.

**`/billing` studio**
- Loading: `LoadingSkeleton` (6 rows) while both SWR fetches are in flight.
- Empty: "No subscriptions" / "No invoices yet" `EmptyState` per table when the arrays are empty.
- Error: a full-page `EmptyState` ("We could not load billing") with a Try again button when either fetch errors.
- Read-only client view: not applicable, this is the studio branch.
- Member vs admin seat: not applicable, studio-only.
- 375px: KPI grid drops to 2 columns (`grid-cols-2`), interval cards stack to 1 column; both `DataTable`s need a live check for horizontal scroll at 375px (not yet verified, see section 8).
- 768px: KPI grid at 4 columns.
- Dark mode: all surfaces use CSS var tokens (`Card`, `Badge`, `DataTable`, `KPICard`); no hardcoded hex found in this branch.
- Print or public: not applicable.

**`/billing` client**
- Loading: `LoadingSkeleton` (5 rows) while the invoice and subscription SWR calls resolve.
- Empty: "No invoices yet" `EmptyState` inside the Invoice History card when the array is empty; "No active subscription found" inline sentence when there is no subscription row.
- Error (member seat denial): a dedicated `EmptyState` with a `Lock` icon, title "Invoices are visible to your organisation admin" (or the feature-disabled / no-org variants), body naming the actual org admin by name where known. This is a rule state, not an error state, and is visually distinct from the failure state below.
- Error (real failure): "We could not load your billing" `EmptyState` with a Try again button, shown only when the fetch failed for a reason that is not one of the three known denials.
- Read-only client view (Tahi admin previewing): renders identically to a real client admin seat; "Manage Billing" still opens Stripe if the previewed org has a Stripe customer (this is a read from Stripe, not a write, so preview does not need to block it; confirm this is intentional, see section 7).
- Member seat: sees the denial card above, never the plan or invoice data.
- 375px: the Invoice History table swaps to `InvoiceHistoryMobileCard`, a full-width tappable card per row (44px+ touch target, confirmed `min-h-11` in code); the Current Plan card's header row wraps (`flex-wrap`).
- 768px: table view returns; two-column add-ons layout unaffected (single column throughout).
- Dark mode: all tokens; `Money`, `PortalMoney`, `Badge` and `PortalStatusPill` are all token-driven.
- Print or public: not applicable.

**`/services` studio**
- Loading: verified against the full file. Both the catalogue list and the coupons panel render an inline `animate-pulse` skeleton (3 rows / 2 rows) off `useSWR`'s `isLoading`; neither uses the shared `LoadingSkeleton` component, but the state exists and is not a blank flash.
- Empty: verified against the full file. A zero-row catalogue shows a hand-built empty state (leaf-radius icon, "No services yet" title, body copy, a "Create Service" CTA); the coupons panel shows its own inline empty state ("No coupons yet"). Neither calls the shared `EmptyState` component, so this is a primitives gap, not a missing state.
- Error: confirmed not handled. Neither `useSWR` call in `services-content.tsx` destructures `error`, so a failed fetch renders the empty-state copy ("No services yet") instead of a failure message, which is dishonest when the real cause is a broken request rather than a genuinely empty catalogue. This is a real gap, not just an unverified one (see section 7).
- Read-only client view: not applicable, studio-only; a Tahi admin previewing a client never reaches this branch (routed to `PortalServices` instead).
- Member vs admin seat: not applicable, studio-only, any grant holder.
- 375px / 768px / dark mode: not verified in this pass; the catalogue itself flags this page as "the worst page in the app, zero primitives" (page-catalogue.md), so a fresh audit at both widths is warranted before build.

**`/services` client**
- Loading: `PortalSkeleton` blocks for the plan card and `PlanLadderSkeleton` for the ladder (drawn at the real height of the ready state, per the code comment, specifically to avoid layout jump); `SkeletonCard` x4 for the catalogue grid.
- Empty (no catalogue rows at all): `EmptyState` "Nothing published here yet" with an "Ask us anything" CTA.
- Empty (a filter chip has zero matches): `EmptyState` "Nothing in that group" with a "Show everything" CTA that resets the filter.
- Error: `EmptyState` "We could not load this page" with a Try again button; explicitly scoped so a services-fetch failure never touches the plan or ladder sections, which have their own independent SWR calls and denial states.
- Read-only client view (Tahi admin previewing): every ask action (`onAsk`, `onTalk`) is disabled with a `title="Read only while viewing as a client"` tooltip; the plan panel and ladder still render (they are reads) but "Talk about your plan" and "Talk about moving up" are disabled.
- Member seat: catalogue and every ask action are fully available; the plan panel and ladder are simply absent (no card, no error, no gap that reads as broken).
- 375px: catalogue grid drops to 1 column; ladder grid drops from 3 columns to stacked (the hairline rail between rungs is hidden below `md`, by design, per the code comment about the negative margin overrunning 375px).
- 768px: catalogue at 2 columns; ladder rail reappears if 3 rungs fit, or 2-column grid for a 2-rung view (Tune/Launch clients).
- Dark mode: all tokens (`--color-brand-ink`, `color-mix()` for the "here" rung border); no hardcoded hex found.
- Print or public: not applicable.

---

## 4. Features and actions

### `/billing`

**Works today**
- Admin: KPI row, billing-interval breakdown, active subscriptions table, recent invoices table, all real reads with row-level navigation to `/clients/[id]` and `/invoices/[id]`.
- Client: real plan card (name, status, interval, next invoice date projected from cadence when there is no Stripe period, per `lib/next-invoice-date.ts`), real add-ons list with NZD "value" figures, real invoice history with sortable columns, honest member-seat denial copy shared verbatim with `/invoices` (so the two money surfaces never disagree), an honest generic-failure state distinct from the denial state, and a Manage Billing button gated correctly on `canManagePayment` (CT.16, merged `c1e8c24e`).
- Refresh button on both branches re-fetches without a full reload.

**Exists but wrong or half-built**
- CT.16: the fix has merged and the "Manage Billing fails silently" bug is closed in code, but STATUS records "live smoke pending" and the catalogue still lists the surface as "Not ported." Treat both as pre-live-verification, not as open build work.
- T2.9 ("/billing v3 lap, 3 raw tables") is stale as written; the actual remaining item is a live browser smoke and a 375px/dark check per Definition of Done, not a redesign.
- No FEATURE_TREE gap found for `billing` itself (it has a mapping, contrary to T1.18's blanket claim); T1.18 may still be accurate about `filterNav` not honouring `adminOnly` cosmetically, which would only affect whether a roleless team member sees the nav link, not whether the page itself (server-guarded by `requirePageFeature('billing')`) admits them.

**Planned or missing**
- CT.16's other half, the decision of whether `/billing` belongs in the client nav at all, was decided (out, by default) but is worth re-confirming with Liam now that the page itself works, since "unlisted but reachable" is an unusual final state for a page this complete (see section 7).
- No design file exists for `/billing` at all (confirmed against the Claude Design project file list); nothing to port TO, only a page to design if a client-nav decision reverses.
- MC.10b: Physitrack's two Stripe customer ids need reconciling after a merge; affects the studio Recent Invoices / Active Subscriptions rows for that one client, not a `/billing`-specific bug.

### `/services`

**Works today**
- Client: full catalogue grid with delivery-mode filter chips, plan panel, plan ladder with the client's own live figures (track count, measured average turnaround) on the middle rung and words-only neighbours, the pressure nudge that only fires from real queue-overflow data, the ask sheet (real request creation or real mailto), all denial and failure states independently scoped per section.
- Studio: catalogue CRUD (create, edit, audience scoping to Everyone or one client, visibility Shown/Hidden written in lockstep), coupons panel, client-name resolution for the "Private to X" badge.
- CT.11 scoping half: services table has `orgId` and `visibility`; a private row never reaches another client's portal; the studio editor cannot move a row to a client a scoped team member cannot see (403 both ends).
- CL.2: the client preview of `/services` correctly shows the read-only catalogue, not the admin editor, after the impersonation-cookie fix.
- CB1 (plan ladder port, `52bd9289` + fix `a925b8f4`): merged to main, matches the Claude Design ladder section closely (same three-state rung model, same "no price, no Start" rule, same off-ladder note for hourly/custom).

**Exists but wrong or half-built**
- CB1 is marked "Review BLOCKED, merge after re-review" in TASKS.md, but the fix commit is already on `main` per `git log`. This needs a fresh live re-critique (DL.4), not a merge; treat the port as landed-but-unverified, not as pending code.
- The admin `/services` catalogue editor has no nav entry anywhere in the app (`ADMIN_NAV` omits it, no other admin page links to it). Team members reach it only by typing the URL. This may be intentional (a rarely-touched studio page) or an oversight; flagged for Liam in section 7.
- The admin catalogue editor has a working loading skeleton and a working empty state for both the services list and the coupons panel (confirmed in this pass, see section 3), but no error state: neither `useSWR` call destructures `error`, so a genuine fetch failure renders the same "No services yet" / "No coupons yet" copy as a real empty catalogue. A team member cannot tell "nothing here" from "this broke." Small fix (destructure `error` and branch to a distinct message), not a redesign.

**Planned or missing**
- CT.11's order path: "ordering mints a request or a Stripe checkout" is explicitly not built. Today every catalogue card only offers "Ask about this," which opens the ask sheet (a request or an email), never a checkout. `/api/portal/checkout` exists but is wired only to the onboarding plan-and-pay step for a brand-new client, not to any catalogue card here. This is Liam's decision to make (see section 7), tracked as CT.11.
- CL.3 "Ask about this" upsell: the backlog item describes a plan-aware suggestion rule (a Maintain client sees the Scale upgrade nudge; a project client sees a retainer nudge) beyond the pressure-triggered ladder nudge that already exists. Not built; the current ladder nudge is closer to MC.5 (show what they have, lower, higher) than to CL.3's cross-sell suggestion.
- MR.7's fuller showcase (see section 6) is designed but not ported: the plan panel is a plain Card, not the "forest stage" with lane visuals and a full facts grid; there is no usage-analytics block (turnaround, revisions-used, tracks-busy stats, a delivered-by-kind mix bar, a month-by-month chart); the catalogue is a uniform card grid, not the editorial "feature story plus line items" layout; there is no dedicated add-on shelf (running / lapsed / offered), only the plain add-ons list inside the plan panel.
- T2.8 ("/services v3 lap") is partly stale: the client half already runs on the repo's primitives (`Card`, `Badge`, `TahiButton`, `EmptyState`); what remains is the admin editor's own primitives pass and the MR.7 showcase gap above.

---

## 5. Data and integrations

`/billing`:
- `/api/admin/subscriptions`, `/api/admin/invoices?limit=10` (studio reads).
- `/api/portal/invoices?status=all`, `/api/portal/subscription`, `/api/portal/billing/session` (client reads and the one write-adjacent action, which only opens a Stripe-hosted session and writes nothing itself).
- `/api/portal/people` (only fetched when the denial is `member_seat`, to name the real org admin in the copy).
- Tables: `subscriptions`, `invoices`, `organisations` (for `invoiceChannel`), `settings` (for the studio default invoice channel and the invoice number prefix, indirectly via `invoiceReference`).
- Third parties: Stripe (customer portal session, subscription status), Xero (named as the rail when there is no Stripe period to project from).
- Must stay honest: the "Outstanding" KPI and every invoice amount must come from real rows, never a placeholder; the next-invoice date must either be a real Stripe period end, a genuine cadence projection, or an explicit "Invoiced [cadence] through Xero" sentence, never a bare "TBC" when a better answer is knowable (this is already the current behaviour, worth protecting in any redesign).

`/services`:
- `/api/portal/services` (client catalogue read, three-condition filter as described in section 1), `/api/portal/subscription` (plan panel), `/api/portal/capacity` (the one pressure signal the portal can source; the "tracks busy" pressure lane exists in `lib/plan-ladder.ts` but is never fed live data because no nightly roll-up writes track-day usage yet), `/api/portal/requests` (the ask sheet's "Start a request" path).
- `/api/admin/services`, `/api/admin/services/[id]`, `/api/admin/services/coupons`, `/api/admin/clients` (for the audience picker) on the studio side.
- Tables: `services` (with `orgId` and `visibility` from migration 0097), `subscriptions`, `organisations`.
- `lib/plan-ladder.ts` is pure and unit-tested; the rung copy (`RUNGS`) is hardcoded in this file today, not yet in the `plan_catalog` settings key that `Settings > Client plans` (`components/tahi/settings/sections/plans-retainers.tsx`) already edits for plan names. Only plan-name overrides flow through from settings; the "best if," tracks, turnaround and included-services sentences per rung are code, not data.
- `lib/portal-service-view.ts` derives a card's outcome, inclusions and timeline by parsing the free-text `description` column (first paragraph, bullet lines, a "Timeline:" line). There is no structured schema field for outcome, inclusions, timeline, an editorial image, or a "fit" tag (plan / add-on / project), which is what the Claude Design showcase assumes exists. Any redesign that wants the richer editorial layout needs either a schema change (proposal) or a continued reliance on description-parsing.
- Must stay honest: no price on the client catalogue or ladder except the plan panel's own rate; no dead "Start" or "Order" button anywhere until CT.11 is decided and built; the pressure nudge must never render from an invented number.

---

## 6. Design system contract

Both pages already use the shared primitives: `PageHeader`, `Card`, `Badge`, `DataTable` (with a `mobileCard` renderer, which is the pattern for a money table at 375px), `KPICard`, `EmptyState`, `LoadingSkeleton`/`PortalSkeleton`, `TahiButton`, `SlideOver` (via `PortalAskSheet`), and the leaf radius on icon chips (`var(--radius-leaf-sm)`). The client Services page in particular is disciplined about CSS var tokens throughout; no hardcoded hex was found in either component reviewed.

What the existing Claude Design file (`portal-money.jsx`, Services half, plus `portal-money-data.jsx`) gets right, and the live port keeps faithfully:
- The plan ladder's three-state model (down/here/up), the "only your own rung carries a number" rule, and the calm-line-versus-nudge-card branching are a near line-for-line match between the design (`Rung`, `PlanLadder` in `portal-money.jsx`) and the port (`RungItem`, `PlanLadder` in `plan-ladder.tsx`). This piece needs no further design work, only the DL.4 re-critique against the live shell.
- The "no price, no Start button" rule is enforced identically in both.

What the design has that the port lacks, and a redesign pass should account for:
- **PlanStage**: the design's plan panel is a full "forest surface" hero (glow/grain background, lane visuals per track, a facts grid of Rate / Next invoice / Delivered this quarter / Waiting in your queue) with a locked-state note for a member seat. The live port's `PlanPanel` is a plain two-column `Card` with a shorter fact list (Rate, Tracks running, On this plan since, Next invoice) and no lane visualisation, no delivered/queued counts, and no locked-state note (a member seat gets no card at all instead of a locked one, which is arguably more honest but is a real deviation from the design's intent).
- **UsageBlock**: an entire "How you are using Tahi" section (turnaround / revisions-used / tracks-busy stat trio, a delivered-by-kind mix bar, a month-by-month bar chart, a closing note) exists in the design and has no equivalent in the port at all.
- **Catalogue as editorial stories**: the design distinguishes a single "feature" story (larger card, an image via `ServiceArt`, a "why" callout, open inclusions) from "line items" (compact rows) and carries a `FitKey` legend (plan / add-on / project fit tags). The port renders every card identically in a uniform grid with no feature distinction, no imagery, and no fit tags.
- **Add-on shelf**: the design has a dedicated section grouping add-ons the client already runs, add-ons they have run before and could restart, and add-ons offered but not yet taken. The port folds "on your account" add-ons into the plan panel's list only; there is no lapsed or offered section anywhere in the live code.

What must change regardless of which direction is chosen: the critic verdict on record for this file is FIX, not REDO ("best single tile in the prototype" per MR.7's note in TASKS.md), so treat the design file as sound and the port as the gap, not the other way round. Any new design work for `/billing` starts from nothing (no file exists); anything drawn for it should match the plan-ladder file's restraint (tokens, leaf radius, no invented numbers) rather than invent a new visual language for a page this text-and-table-driven.

---

## 7. Open questions for Liam

1. CT.11: when a client orders something from the Services catalogue (beyond "ask a question"), should that action create a request in their queue, or start a Stripe checkout? (A or B.)
2. Now that `/billing`'s client branch actually works end to end (real plan, real invoices, real Manage Billing gating), should it go back into the client nav, or does it stay unlisted-but-reachable on purpose? (Yes, add it back to the nav / No, leave it URL-only.)
3. Should the admin catalogue editor at `/services` get a sidebar nav entry (it currently has none anywhere in the app), or is direct-URL access intentional because it is edited rarely? (Yes, add a nav entry / No, leave as is.)
4. For the richer Services showcase (usage stats, editorial stories, add-on shelf) drawn in the Claude Design file, should the redesign pass port that fuller version, or is the current simpler port (plan card plus ladder plus uniform catalogue grid) the one you want to keep shipping forward? (Port the fuller design / Keep the current simpler build as the target.)
5. Should a member seat see a locked "Your plan" placeholder card on `/services` and `/billing` (as the design's PlanStage implies with its lock note), or is the current behaviour, where the card is simply absent for them, the one you want? (Show a locked placeholder / Keep it absent.)

---

## 8. Acceptance for the design review

Checks a reviewer can tick from a screenshot at 1440 and 375, light and dark.

1. On `/billing` (client), the Current Plan card never shows a bare "TBC" for next invoice when a cadence projection or a Xero-rail sentence is possible, and the Manage Billing button is present only when the screenshot's account is Stripe-rail.
2. On `/billing` (client), a member-seat screenshot shows the Lock-icon denial card with the real org admin's name in the body, never the plan card or an unstyled 403.
3. On `/billing`, the Invoice History table becomes full-width tappable cards at 375px with no horizontal scroll and no touch target under 44px; the same table at 1440 is a sortable `DataTable`.
4. On `/services` (client), no dollar figure appears anywhere except inside the Your Plan card; the plan ladder's down/up rungs contain only words, never a number, in every screenshot.
5. On `/services` (client), the ladder nudge card (or its calm-line alternative) is present exactly once, directly under the ladder, never duplicated and never shown for a plan with no ladder (hourly, custom, project).
6. On `/services` (client) at 375px, the catalogue grid is a single column, the ladder rungs stack without the horizontal hairline rendering as a stray line, and every "Ask about this" button is at least 44px tall.
7. On `/services` (studio), the audience control on the create/edit form reads "Everyone" or a named client, never a raw org id, and a private row carries its "Private to [client]" badge in the list.
8. Dark-mode screenshots of both pages show no washed-out or invisible text against `--color-bg` / `--color-bg-secondary`, and the "here" rung's highlighted border and check icon remain legible against the dark card background.
9. A screenshot of the ask sheet (`PortalAskSheet`) open from any card shows both destinations (Start a request / Email us) as a real radiogroup with a visible focus ring, never a plain unstyled toggle.
10. Neither page's screenshot set includes a visible "Start," "Order," "Buy" or "Checkout" affordance anywhere in the catalogue, since CT.11 is undecided; every action reads as "Ask" or "Talk about."
