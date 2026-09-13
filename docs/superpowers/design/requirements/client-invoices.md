# Design requirements: client-invoices

Group: client-invoices. Audience: client. Routes: `/invoices`, `/invoices/[id]`, and the How to pay block that lives inside `/invoices/[id]` (it is not a separate route).

Source read for this document: CLAUDE.md, STATUS.md ("Since the last update" plus the triage snapshot), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (rows for `/invoices` and `/invoices/[id]`, Batch B), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, every `TASKS.md` line naming invoices (T1.10, T2.1, T2.9, T2.10, PP.3, CB2 to CB5, IC.7, CT.14, IC.8, MR.6, CT.16, the 2026-09-06 founder decisions block), the live code (`components/tahi/portal/invoices/*`, `components/tahi/portal/portal-money-kit.tsx`, `lib/portal-invoice-view.ts`, `lib/invoice-how-to-pay.ts`, `lib/invoice-billing.ts`, `lib/invoice-status.ts`, `lib/portal-admin-label.ts`, `app/(dashboard)/invoices/page.tsx`, `app/(dashboard)/invoices/[id]/page.tsx`, `app/api/portal/invoices/route.ts`, `app/api/portal/invoices/[id]/route.ts`), and the Claude Design file `portal-money.jsx` (Invoices half, lines 1 to about 369 of 1260) plus `portal-money-kit.jsx`.

## 1. Purpose and audiences

Who opens it: a client contact who is an org admin (or the org's primary contact, which is the same predicate) of a client organisation. This is a money surface, so the gate is tighter than the rest of the portal: a client "member" seat (not an admin, not primary) is refused with a named reason, not shown a partial or blank page. A Tahi team member previewing "Client view" for a real client organisation is let through read-only (the pay link and every write action is disabled and explained), because the studio needs to see what the client sees to support them. Tahi's own organisation never reaches this route at all: `orgId === NEXT_PUBLIC_TAHI_ORG_ID` is refused outright, so nobody accidentally opens "the studio's own invoices" through the client-facing surface.

What it does: tells a client exactly what they owe, what they have paid, and what to do next, one bill at a time. Three words only for status (Awaiting payment, Overdue, Paid), one action per bill (Pay now, How to pay, or Ask), every figure in the invoice's own currency, never converted, because the portal holds no exchange rates and a converted total is a number the client cannot reconcile against their own bank statement.

What it must never show:
- Any studio-side fact: which rail raised the bill (Stripe vs Xero), the Stripe or Xero id, the studio's internal status words (Sent, Viewed, Written off), a "Source" badge. `xeroPayUrl` and `orgInvoiceChannel` are read server-side and stripped before the JSON reaches the client; the client is handed one `payUrl` and never told which rail issued it.
- Draft invoices. Both portal routes exclude `status = 'draft'` at the WHERE clause, not as a post-filter, so a draft (the studio's working copy, or a test) never renders and never counts toward any total.
- An import's provenance note. `invoices.notes` sometimes carries a bookkeeping line an importer wrote for the studio ("Imported from Xero: INV-0065", occasionally with a bookkeeping sentence appended). `clientInvoiceNote()` strips any note starting "Imported from" before it reaches the client, applied both server-side (the API route) and again client-side as defence in depth (`clientInvoiceNote` re-applied in the detail component). STATUS (S3, 2026-09-13) records this as still "fix in flight": treat it as not fully closed until verified live.
- A cross-tenant invoice. The org filter is part of the WHERE clause on the detail route: a guessed id belonging to another org is indistinguishable from a missing one and returns 404, never 403 (which would confirm the id exists). Covered by `e2e/tenancy-isolation.spec.ts` (S6, 3 of 3 green on the local harness, not yet wired into CI).
- Financial data to a member seat. `isOrgAdmin` gates both routes; a non-admin contact is refused with `code: 'not_org_admin'` and told, by name where possible, who their org admin is (`portalAdminLabel`), never a bare "Forbidden."
- Messages. Not part of this route, but relevant to what a client organisation sees in the same nav: Messages is hidden for every client organisation as of Giant Group readiness Batch A (STATUS, 2026-09-13). A reviewer should not expect an Invoices-to-Messages deep link or a "message the team about this bill" affordance that lands on a visible Messages tab; the "Ask" actions on this surface (below) exist specifically because Messages is not there to lean on.
- Super-admin-only areas. There are none on this route; it is a plain client/admin-preview branch, not a permissions-builder surface.

## 2. Pages, sub pages and entry points

- **`/invoices`** (list). Reached from the client portal nav (Invoices is a top-level nav item, `feature-tree` key `invoices`, `appliesTo: ['team','client']`, route `/invoices`) and from the client home's "Waiting on you" / billing summary tiles when one exists. Renders `PortalInvoiceList`. Admin preview of a client is reached the same URL, gated by the `tahi-impersonate-org` cookie (browser-wide) reconciled against the `useImpersonation` sessionStorage store (per tab), so a second tab cannot leak a live pay link.
- **`/invoices/[id]`** (detail). Reached by clicking any row/card on the list, by the "Open {reference}" button inside the overdue callout, by an invoice notification's deep link (email or in-app), and directly by URL. Renders `PortalInvoiceDetail`.
- **How to pay** is not a route: it is an anchor-jump section (`#how-to-pay`) inside the detail page, rendered only when the invoice is unpaid, has no `payUrl`, and the studio's channel for this org is Xero. The hero's secondary CTA on that page is an `<a href="#how-to-pay">` link, not a navigation.
- **Ask about billing / Question about this invoice / Ask (per line item) / Pay by card instead** are all the same `PortalAskSheet` slide-over, opened with different seeded titles/subjects depending on entry point (list header, detail hero, a specific line item, or the "ask for a card link" fallback inside the How to pay block). Two destinations inside the sheet: "Start a request" (POSTs to `/api/portal/requests`, lands in the client's own Requests queue) and "Email us" (opens a `mailto:` to the studio's contact address, writes nothing).
- No dialog, tab, or slide-over other than the Ask sheet exists on this surface today. The design file's per-invoice message Thread ("Questions about this invoice", with Reply and a running list of messages) is drawn in `portal-money.jsx` but is not built in the live code (see section 4).

## 3. States and variants

One line per state per page, as required.

**`/invoices` (list)**
- Loading: three `SummaryTile` skeletons plus four `SkeletonRow` rows; no summary, no filters, no counts are shown until data resolves.
- Empty (no invoices at all): leaf icon, title "No invoices yet", description "When we bill you, the invoice lands here and in your inbox on the same day.", action "Ask about billing" (opens the Ask sheet).
- Empty (filtered to nothing): search icon, title "Nothing matches that", description "Try clearing the search, or widening the year.", action "Clear filters".
- Error (fetch failed, not a 403): alert icon, title "We could not load your invoices", description "This one is on us. Nothing has changed on your account, and nothing here is out of date, because nothing here loaded.", action "Try again" (re-triggers the SWR fetch).
- Denied, member seat: lock icon, title "Invoices are visible to your organisation admin", description "Ask {name(s) or 'your organisation admin'} if you need one. Your requests, files and services are unaffected."
- Denied, feature disabled for the org: lock icon, title "Billing is switched off for your workspace", description "Contact Tahi Studio if you need an invoice. Your requests, files and services are unaffected."
- Denied, unlinked login (`no_org`): lock icon, title "Your login is not linked to a workspace yet", description "Contact Tahi Studio so they can connect your account. Your requests, files and services are unaffected."
- Populated, read-only (Client view / admin preview): identical to the normal populated state except every "Pay now" control renders disabled with a title tooltip "Read only while viewing as a client"; the Ask sheet still opens but both its destinations are disabled with the same reason string.
- Populated, member seat is never reached (blocked server-side before rows exist); only the admin seat sees rows.
- 375px: single-column card list (the `xl:grid` row is `hidden` below `xl`; every row is a stacked card instead), full-width primary action button, search and year filter stack under the segmented control. Pinned by `e2e/portal-invoices-mobile.spec.ts` (no horizontal scroll, 44px targets, list + detail + How to pay all covered).
- 768px: same card layout as 375 continues (the row/card breakpoint is `xl`, i.e. 1280px content column, not `md`), so a tablet still sees the stacked-card variant, not the six-column grid. This is a deliberate choice recorded in the component's own comment (the six-column row needs about 812px of content-column width, which the dashboard shell does not clear until roughly 1280px viewport).
- Dark mode: relies entirely on CSS var tokens (`--color-*`, `--badge-danger-*`, `--badge-positive-*`); the component comments explicitly call out that the overdue callout and the paid badge use the badge-family tokens rather than `--color-danger-bg` / `--color-success-bg`, because those two backgrounds are deliberately left un-overridden in dark mode and would render near-white text on a near-white fill.
- Print: not implemented and not required for this surface (money documents are downloaded as PDFs elsewhere, not printed from this list).

**`/invoices/[id]` (detail)**
- Loading: skeleton hero card plus a skeleton line-items card.
- Not found / withdrawn: alert icon, title "Invoice not found", description "It may have been withdrawn. Your other invoices are unaffected.", action "Back to invoices". Also the response for a cross-org id (never a 403).
- Error (fetch failed): alert icon, title "We could not load this invoice", same description pattern as the list, action "Try again".
- Denied: same three denial variants as the list (member seat / feature disabled / no org), same copy source (`portalInvoiceDenialCopy`).
- Populated, unpaid with a hosted pay link: hero shows "Pay {amount}" as the primary action (opens the hosted page in a new tab), no How to pay block.
- Populated, unpaid with no link, Xero rail (the ordinary state of a freshly pushed Xero invoice, which sits at Draft in Xero until Liam approves it): hero's secondary action is the "How to pay" anchor jump; the How to pay card renders with bank fields, a Copy per field, "Copy all details", and "Pay by card instead" (opens the Ask sheet pre-seeded to request a card link).
- Populated, settled (paid, written off, void, cancelled, refunded, or any row carrying a non-empty `paidAt`): no Pay action, no How to pay block; a "Paid {date}" or "Settled" confirmation card with "Nothing more to do on this one. Quote {reference} if you ever need to look it up."; list row shows "View receipt" instead of a pay action (opens the same detail page; there is no separate receipt document, see section 4).
- Populated, read-only (Client view): the hosted "Pay" button renders disabled with the same reason tooltip; the How to pay block still renders in full (it is informational, not a write) but "Pay by card instead" opens a read-only Ask sheet.
- Line items empty (invoice billed as a single amount): a single sentence in place of the table, "This invoice is billed as a single amount, with no itemised lines. Ask us if you would like it broken down."
- Studio note present and not an import artefact: a "A note from the studio" card renders below the line items, `white-space: pre-wrap`.
- 375px: hero stacks (amount/status above, actions below, full width), facts grid drops to one column via `sm:grid-cols-2`, line items collapse to stacked cards below `lg`. Pinned by the same mobile Playwright spec as the list.
- 768px: hero and facts still on the compact/stacked layout (breakpoints are `sm`/`lg`, not `md`, so a plain tablet width sits between the two and generally reads as the compact layout until `lg`, i.e. roughly 1024px+).
- Dark mode: same token discipline as the list; the "Paid" badge explicitly uses `--badge-positive-bg` / `--badge-positive-text` rather than `--color-success-bg` for the same near-white-on-near-black reason noted above.
- Print: not implemented.

## 4. Features and actions

### `/invoices` (list)

**What works today**
- Three-word client vocabulary (Awaiting payment / Overdue / Paid), derived once in `lib/portal-invoice-view.ts` and shared by every client money surface and the invoice email, so the wording cannot drift between them.
- Summary tiles: Still to pay (with an overdue sub-count), Next due / Waiting longest (whichever applies), Paid this year, each per-currency (see next point).
- Multi-currency honesty: `sumByCurrency` / `formatCurrencyTotals` render "NZ$2,300.00 + US$500.00" rather than a single misleading converted figure, because the portal has no exchange rates.
- Overdue callout naming the total past-due amount and a direct "Open {reference}" link to the oldest overdue bill.
- Tabs (All / To pay / Paid) with live counts, a year filter (only shown when more than one year exists in the data), and free-text search across the invoice reference and label.
- Pagination via `useSWRInfinite`, walking the route's 50-per-page pages automatically up to 20 pages (1,000 invoices) so every displayed total is a true sum over the whole book, not just the first page; past that cap the footer says so explicitly rather than silently truncating.
- Per-row action resolved from invoice state: "View receipt" (settled), "Pay now" (a link exists), "How to pay" (Xero rail, no link, still owed), or "Open invoice" (fallback).
- "Ask about billing" from the page header, always available, seeded to a generic billing question.
- The three honest denial states (member seat / feature disabled / no org), each phrased to reassure the reader that the rest of the portal still works.
- Real invoice numbers (CT.14 / IC.7, built and applied by Liam 2026-09-12): `invoiceReference(id, number)` now reads the persisted `invoices.number` column (minted `<prefix>-<YYYY>-<NNNN>`, backfilled for historical rows) everywhere a reference is shown on this route: the row/card reference, the overdue callout's "Open {reference}" link, and search. `lib/portal-invoice-view.ts`'s `portalInvoiceLabel` doc comment ("IC.7 still owes the number") is stale and should be corrected; the label itself (month plus "invoice") is unaffected since it never used the number column, only the reference does.

**What exists but is wrong or half built**
- Import provenance notes leaking onto the client invoice ("Imported from Xero: INV-0065" rendering as "A note from the studio"): found in the S3 smoke (STATUS 2026-09-13), fix stated as "in flight." Confirm live before treating this as closed; a reviewer should specifically check an imported invoice's note field.
- CB3 (2026-09-13 audit) found the shipped list and detail had **no** defect at 375px; the "Pay now cut in half by the rail" REDO verdict recorded against `portal-money.jsx` in Pass 3 was against the older prototype, not the live port. Treat the design REDO note in the checklist as stale for the ported surface; it still applies to the raw design file if that file is used as the source of truth for a future re-port.
- The studio-side counterpart, `invoices-studio.*` (list with totals strip, seven saved views, chase drafter, bulk bar), was critiqued FIX (two blocking interaction bugs, MR.6) and is unmounted; it does not affect this client route directly but its absence means there is no admin-side chase workflow yet feeding this page's Ask/How-to-pay content.

**What is planned or missing**
- PP.3 follow-ups, explicitly named in TASKS.md: a proper invoice-thread and receipts. Today "View receipt" just opens the detail page again; there is no generated/downloadable receipt document. (backlog: PP.3 follow-up, unticked)
- Design file (`portal-money.jsx`) shows a fourth summary tile, "On the record" (total invoice count "billed to you since day one"), not present in the shipped three-tile version. Not found named as a task; **proposal** if wanted.
- Design file wraps the list's Views (All/To pay/Paid) and the Year filter inside a full `RailLayout`/`Rail` (the same rail idiom Requests uses), with a collapsible filter rail and an active-filter count badge, versus the shipped version's inline `SegmentedControl` + `select`. Not found as a named backlog item; if the studio wants rail parity with Requests, that is a **proposal**, not a confirmed requirement, since STATUS records Requests' rail as the reference standard.

### `/invoices/[id]` (detail)

**What works today**
- Full money breakdown: subtotal, discount, tax (labelled "GST (15 percent)" for NZD, "Tax" otherwise), total, each derived defensively (falls back to summing line items when the header amount is zero).
- Pay now (hosted link) or How to pay (bank block) as the single primary action, mutually exclusive and both gated correctly on settled state.
- How to pay block: per-currency bank account resolution (`bankDetailsForCurrency`), only the fields that currency's account actually carries (a GBP bill shows sort code + SWIFT, a EUR bill shows IBAN and no account number), individual Copy per field, "Copy all details" (reproduces the exact rows shown, not a separately maintained list), "Pay by card instead" (opens an Ask seeded to request a card link).
- Ask on every line item, always visible (never hover-gated), each pre-filled with which line it is about.
- Studio note rendered when present and not an import artefact.
- Real invoice number as the Reference fact, the How to pay reference row, and the "Quote {reference}" settled copy (same CT.14 / IC.7 mechanism as the list, see section 4 above).
- viewedAt stamped on first genuine client open (never on an admin preview, never re-stamped), which is what lets the studio distinguish "sent" from "seen" without exposing that word to the client.
- Tenancy: id + orgId in the same WHERE clause, so a cross-org guess 404s rather than 403s.

**What exists but is wrong or half built**
- Same import-note leak risk as the list (S3, "in flight").
- No standalone critic verdict exists for this page; it rides on the invoices-studio set's verdict by association only in the catalogue's bookkeeping, not because anyone has actually reviewed this client detail page as its own artefact since the T2.10 port. Treat "no separate detail verdict" as an open item for the critic pass this document is feeding.

**What is planned or missing**
- Per-invoice message thread (PP.3 follow-up: "an invoice thread"). The design file draws a full "Questions about this invoice" thread component (avatar, own/other message styling, Reply), which does not exist in the shipped detail; the shipped surface substitutes the generic Ask sheet (fire-and-forget into Requests or email, no visible back-and-forth on the invoice itself).
- Receipts (PP.3 follow-up), as above.
- IC.8 stamp-invoiced backfill is a prerequisite for the *studio's* first live hourly Xero export to bill correctly, not a client-facing feature on this page, but a reviewer should know it gates whether historical invoices reconcile correctly once Xero export goes live (Ops decision, Liam's call to apply, not yet applied at time of writing).

## 5. Data and integrations

- **API routes**: `GET /api/portal/invoices` (list, paginated `page`/`limit=50`, optional `status` filter), `GET /api/portal/invoices/[id]` (detail + line items, stamps `viewedAt`).
- **Tables**: `invoices` (status, number, amounts, currency, notes, dueDate, sentAt, paidAt, viewedAt, `stripeHostedInvoiceUrl`, `xeroOnlineInvoiceUrl`, orgId), `invoiceItems` (description, quantity, unitPrice, total), `organisations` (name, `invoiceChannel`), `settings` (K/V: `invoicing.bankDetails`, `invoicing.bankDetailsByCurrency`, invoice channel default, Xero email mode).
- **Third parties**: Stripe (hosted invoice pay page, captured at invoice finalise time), Xero (`OnlineInvoiceUrl`, captured once Liam approves the invoice inside Xero; the invoice sits at Draft in Xero until then, which is the entire reason the How to pay block exists). No live third-party call happens on page load; both `payUrl` fields are pre-persisted columns read at request time, not live API calls to Stripe/Xero.
- **Access control dependency**: `lib/portal-access.ts` `isOrgAdmin`, `lib/require-feature.ts` (`requirePortalFeature(..., 'invoices')`), `lib/server-auth.ts` `getPortalAuth` (also resolves impersonation state).
- **Must be honest**: no dead buttons (every action on this surface hits a real endpoint or a real anchor link); no fake numbers (every summary figure is a sum over fetched rows, never a placeholder, and stands down entirely rather than showing 0 while loading or after a failed fetch); no currency conversion ever presented as a single total.

## 6. Design system contract

- Primitives already in use and correct to keep: `PageHeader`, `Card`, `EmptyState`, `TahiButton`, `SegmentedControl`, the shared `PortalAskSheet` / `PortalPayLink` / `PortalCopyRow` / `PortalStatusPill` / `PortalMoney` / `PortalSkeleton` / `PortalLeafIcon` kit (`components/tahi/portal/portal-money-kit.tsx`), leaf radius on icon badges (`--radius-leaf-sm`), CSS var tokens throughout (no hardcoded hex outside the one documented exception, `ACCENT_HOVER = '#8ACE6F'`, called out in the kit's own comment as deliberately theme-independent).
- What the existing design file (`portal-money.jsx` Invoices half) gets right: the same three-word vocabulary, the same "never show the rail" discipline, the same How to pay block shape and copy, the overdue callout, and the general information architecture (summary tiles, then a filtered list, then a detail page with hero + facts + pay path + line items). This is why the STATUS/catalogue verdict on the shipped port is good; the design and the port already agree on the fundamentals.
- What the design still has that the port does not: the per-invoice message Thread on the detail page (see section 4), a fourth "On the record" summary tile, and the Views/Filters wrapped in the shared `Rail`/`RailLayout` idiom (collapsible rail, active-filter count) rather than an inline `SegmentedControl` + `select`. Any of these being pulled forward is additive, not a fix.
- What the design must change, per the critic verdict record: the catalogue's REDO note ("Pay-now button cut in half by the rail," Pass 3) is superseded by the CB3 2026-09-13 audit, which found no such defect in the shipped list or detail. A fresh critic pass on this specific surface (list + detail, both breakpoints, both themes) is exactly what the catalogue asks for next ("a fresh critic pass on the client REDO, which is still the last formal verdict on a live surface"), because no verdict newer than Pass 3 exists against the actual rendered component tree described above. This document's job is to make that pass possible without re-discovering the plumbing.
- The studio-side `invoices-studio.*` design (list, chase drafter) carries its own FIX verdict (MR.6) and is out of scope for this client-facing group; do not conflate a fix there with a requirement here.

## 7. Open questions for Liam

1. Should the per-invoice message thread (PP.3's "an invoice thread") replace the generic Ask sheet on the detail page, or sit alongside it as an additional persistent history? A or B.
2. Should a real downloadable receipt (PDF or similar) be generated for a paid invoice, or is "View receipt" intentionally just a re-open of the paid detail page for now? Yes (build a receipt) or no (leave as is).
3. Should the Views/Filters on the invoices list move into the shared `Rail`/`RailLayout` component (matching Requests), or stay as the current inline segmented control plus year select? A (Rail) or B (keep inline).
4. Is a fourth "On the record" total-invoice-count tile wanted on the summary band, or is three tiles (Still to pay, Next/Waiting, Paid this year) the intended final set? Yes or no.

## 8. Acceptance for the design review

1. At 1440 and 375, no studio-only fact is visible anywhere on either page: no Source/rail badge, no Stripe/Xero id, no internal status word (Sent, Viewed, Written off).
2. At 375, the "Pay now" (or "How to pay") action is a full-width, uncut, tappable control at least 44px tall, on both the list row-as-card and the detail hero.
3. At 1440, the list renders as the six-column row (not the stacked card) only once the content column is wide enough to avoid clipping the Amount and action columns; below that width the stacked-card layout is used instead, with no horizontal scrollbar at any width in between.
4. Every currency total on screen (summary tiles, overdue callout, row amounts) is per-currency; no screen ever adds two different currencies into one converted number.
5. In dark mode, the overdue callout and the paid confirmation both read with clearly legible text over their tinted backgrounds (no near-white-on-near-white or near-black-on-near-black).
6. The three denial states (member seat, feature disabled, no org) are visually distinct in copy and each explicitly reassures the reader that requests/files/services are unaffected.
7. The How to pay block shows only the bank fields that currency's account actually carries (no empty labelled rows), and "Copy all details" reproduces exactly the rows visible on screen.
8. The empty, loading, and error states never render a numeric figure (a total, a count) that the underlying data has not actually produced.
9. Read-only/Client-view preview renders every write control (Pay now, Ask sheet's Start-a-request path) visibly disabled with a "Read only while viewing as a client" reason on hover/focus, never silently no-op.
10. No import-provenance note ("Imported from Xero: ...") is visible under "A note from the studio" on any sampled invoice.

