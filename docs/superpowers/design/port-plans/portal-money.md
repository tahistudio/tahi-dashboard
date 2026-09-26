# Port plan: portal-money

Written 2026-09-26. Status on landing: ported, unchecked (Liam has not reviewed the designs; the app's existing primitives and patterns win wherever the prototype differs). Nothing in this plan touches the Docs Hub.

## Sources read

- The portal-money section of docs/superpowers/plans/2026-09-14-design-review-for-liam.md (39 page keys, critic verdict FIX after one revision, the still-open FIX items, two questions for Liam).
- docs/superpowers/design/requirements/client-invoices.md and client-billing-services.md, and docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md.
- The Claude Design files, fetched live from project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66 and read in full: portal-money.jsx (all 1,328 lines), portal-money-invoices.jsx, portal-money-billing.jsx, portal-money-kit.jsx, portal-money-data.jsx, portal-money-billing-data.jsx, portal-money-billing.css, previews/portal-money-preview.html (the page key map). portal-money.css (67 KB) was not read line by line; its classes are replaced by app primitives in every brief below.
- Important: portal-money-invoices.jsx supersedes the Invoices half of portal-money.jsx (its own header says so, and the preview loads it second). Every Invoices page key below follows portal-money-invoices.jsx. Services follows portal-money.jsx. Billing follows portal-money-billing.jsx.
- Live code: app/(dashboard)/invoices/page.tsx and [id]/page.tsx, components/tahi/portal/invoices/portal-invoice-list.tsx and portal-invoice-detail.tsx, components/tahi/portal/portal-money-kit.tsx, app/(dashboard)/billing/page.tsx and billing-content.tsx, app/(dashboard)/services/page.tsx, components/tahi/portal/services/portal-services.tsx and plan-ladder.tsx, components/tahi/rail/rail-layout.tsx and rail-controls.tsx, components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx, components/tahi/callout.tsx, components/tahi/data-table.tsx (props), components/tahi/notifications/notifications-content.tsx and notifications-rail.tsx (the reference RailLayout consumer), components/tahi/nav-model.tsx and mobile-bottom-nav.tsx.
- Data only: app/api/portal/invoices/route.ts, app/api/portal/subscription/route.ts, app/api/portal/billing/session/route.ts, lib/invoice-how-to-pay.ts, lib/portal-invoice-view.ts, lib/next-invoice-date.ts, lib/billing.ts (PLAN_MONTHLY_RATES), lib/plan-utils.ts.
- Other port plans, for shared files: finance.md (owns the studio branches of /invoices and /billing), messages.md, clients.md and content-marketing.md (all build the headline band on KPIStrip), portal-account.md.

## Routes and audience

- /invoices and /invoices/[id], client branch (PortalInvoiceList, PortalInvoiceDetail). Client org admins, plus a Tahi admin previewing Client view (read only).
- /billing, client branch only. Unlisted in the client nav (CT.16). The studio branch belongs to the finance plan.
- /services, client branch only (PortalServices). The studio catalogue editor is out of scope.
- Audience: client.

## Decisions that shape the port

1. The headline band is KPIStrip. The design's Band and BandCell come from head-band.css; the app's equivalent, used by Notifications, Clients, Deals, Team and Capacity and chosen by the messages, clients and content-marketing plans, is components/tahi/kpi-strip.tsx. Not SkeletonKPIStrip for loading (two columns at every width, jumps at 64rem); loading is the real KPIStrip with SkeletonBar values, as the portal-account plan does.
2. The invoice list moves onto RailLayout. Requirement question 3 asked rail or inline. The design brief's list page rule (views and filters in the left rail, never a horizontal toolbar) and Liam's 2026-09-26 instruction to follow the app's own patterns point the same way: Requests, Tasks, Clients and Notifications all use RailLayout. The port takes the rail and lists the question for Liam; reverting is one slice.
3. Existing primitives replace the prototype kit throughout: PageHeader, Card, KPIStrip and KPICell, RailLayout with RailViewItem, RailGroupLabel and RailSelect, DataTable (with mobileCard), EmptyState, TahiButton, SegmentedControl, Badge, SkeletonBar, and the portal money kit (PortalAskSheet, PortalPayLink, PortalCopyRow, PortalStatusPill, PortalMoney, PortalSkeleton, PortalLeafIcon). The design's Btn, Pill, Seg, Select, Search, Sheet, Toast, Sk and Ic are not ported.
4. The overdue callout stays the live Card with the --badge-danger-* tokens. The Callout primitive's danger tone is a fixed rgba tint and its action is a small text link under 44px; the live card is the one requirement acceptance item 5 already passes in dark mode.
5. The rail name is never shown to a client. Where the two requirement docs disagree (client-billing-services allows "Invoiced monthly through Xero" on /billing; client-invoices forbids any rail word), the port follows the design and the stricter rule: /billing drops "through Xero".
6. No backend change and no migration anywhere. Every design element that needs a new column or table is skipped and listed.

## Page key by page key

### /invoices, the list (11 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| invoices | PageHeader with Ask about billing; three separate SummaryTile cards; overdue Card; inline SegmentedControl, search and year select; rows switch to a six column grid at the xl viewport breakpoint; foot note | Band (one grouped panel) instead of three cards; views and filters in a rail with a Currency filter when more than one currency exists; the late tile, not the money tile, turns danger; "All square" instead of a NZ$0.00 figure when nothing is owed; callout names the oldest bill's due date and says how many are late; foot note adds the never converted sentence for multi currency books; the row switch reads the table's own width, not the page's | Slice A |
| invoices-loading | Three skeleton cards, four skeleton rows | Band skeleton, rail present with no counts | Slice A |
| invoices-empty | Leaf, "No invoices yet", Ask about billing | None (no band, no rail) | No work beyond keeping it outside the rail in slice A |
| invoices-filtered | "Nothing matches that", Clear filters | Body says "widening the filters in the rail"; Clear resets currency too | Slice A (copy) |
| invoices-error | Alert, "We could not load your invoices", Try again | None (no band, no rail, no figure) | No work beyond keeping it outside the rail |
| invoices-denied-member, invoices-denied-feature, invoices-denied-noorg | Lock card, copy from lib/portal-admin-label.ts | Design copy differs slightly | No work. The shared lib copy is the requirement's wording and is shared with /billing |
| invoices-readonly | Pay now disabled with the reason; Ask sheet read only | None | No work |
| invoices-ask | PortalAskSheet, email only for a billing question (allowRequest false) | Design offers both destinations from the header ask | No work. The kit documents allowRequest false as deliberate for a question about a bill; a billing question is not a work request |
| invoices-ask-readonly | Read only sheet, both destinations disabled with the reason | None | No work |

### /invoices/[id] (12 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| invoice-hosted | Hero with Pay {amount} (PortalPayLink, external icon), caption, "Question about this invoice" | Label "Ask about this invoice"; caption says it opens in a new tab; a Currency fact | Slice B |
| invoice-bank | How to pay card: leaf tile, Amount, Due, bank rows per currency, Reference, Copy all details, Pay by card instead | Honest fallback when no account exists for the bill (the live card renders with no bank rows at all); arriving from the list's How to pay lands on the block; design adds a per currency account note | Slice B (fallback, hash jump). The account note is skipped (needs backend) |
| invoice-bank-gbp | GBP rows through howToPayRows; single amount sentence | None | No work |
| invoice-paid | Settled card with the badge positive tokens; studio note | Hero sentence wording | No work. The shared portalDueSentence stays |
| invoice-import-note | clientInvoiceNote applied server side and client side | None | Verification only (STATUS S3 said fix in flight): slice B confirms live on an imported invoice |
| invoice-ask | Ask sheet seeded per entry point | None | No work |
| invoice-readonly | Pay disabled with the reason; line Ask and Pay by card instead open a read only sheet | Design disables the triggers themselves | No work. The requirement specifies the read only sheet |
| invoice-loading | Two plain skeleton cards | Skeleton mirrors the hero (with two action bars), the facts row and the line items | Slice B |
| invoice-missing, invoice-error, invoice-denied | Back link plus EmptyState card | None of substance | No work |
| invoice-thread | Not built | "Questions about this invoice" thread | Skipped: proposal, PP.3, requirement question 1 |

Line items header: the design gives it the same leaf icon tile the How to pay card already has; live uses a bare icon on a tinted band. Slice B aligns it.

### /billing, client branch (7 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| billing | PageHeader with Refresh; a plain "Current Plan" card (raw status word, next invoice line, cycle total, add ons box); "Invoice History" DataTable with mobileCard | Plan card with leaf tile, "Your plan" eyebrow, name, status and interval pills, a facts grid (Rate, Next invoice with its source, On this plan since, cycle total when not monthly), a how you pay line, Ask about billing; history in its own card with a header, an Issued column, a Go to Invoices action and a per currency foot note; "through Xero" wording gone | Slice C |
| billing-stripe | Manage Billing button when canManagePayment | Same gate, plus a Client view caption | Slice C |
| billing-loading | LoadingSkeleton rows 5 | Plan card shaped skeleton and history loading | Slice C |
| billing-empty | "Your invoice history will appear here once invoices are generated." | "No invoices yet", first invoice date when known, Ask about billing | Slice C |
| billing-error | "We could not load your billing" | Fuller reassurance copy, primary Try again | Slice C |
| billing-denied-member | Lock card with the shared denial copy | None | No work |
| billing-readonly | No read only notion at all on the client branch | Ask disabled through the read only sheet; Manage billing caption | Slice C |

### /services, client branch (9 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| services | PlanPanel card, PlanLadder (matches the design near line for line), delivery mode chips, uniform card grid, foot card | Forest PlanStage with lanes, UsageBlock, editorial stories, fit key, add on shelf | Skipped (requirement question 4). Slice D ports only the catalogue heading that follows a plan |
| services-loading | Per section skeletons | Full page skeleton | No work |
| services-empty | "Nothing published here yet", Ask us anything | None | No work |
| services-error | Error scoped to the catalogue; plan and ladder stand on their own reads | Design replaces the whole page | No work. Live scoping is what the requirement asks for |
| services-feature-off | Server redirects to /requests (Liam, 2026-09-14) | Lock card | No work |
| services-member | Plan panel and ladder absent | None | No work |
| services-roomy | Calm line under the ladder | None | No work |
| services-custom | Hourly plan shows "N tracks of work running at a time" and a Rate of NZ$0.00 per month when the plan has no rate (PLAN_MONTHLY_RATES knows only maintain and scale) | An hourly client gets its own words and no invented figure | Slice D |
| services-readonly | Every ask disabled with the reason | None | No work |

Also in slice D: add on amounts on the plan panel go through useDisplayCurrency, which converts, and read as billed "per month"; /billing already shows the same figures unconverted as "value". Slice D aligns them so the two money pages cannot disagree.

## The critic's still-open FIX items, resolved

1. Messages in the client shell (flagged on all 39 page keys). Resolved by the live shell as it stands: Messages is denied for every client org by CLIENT_DEFAULT_DENY, the sidebar filters it through filterNav, and mobile-bottom-nav.tsx drops it from the phone tab bar through gateTabs. No shell edit. Each slice's live check confirms, in a real client session at 375 and 1440, that no Messages item appears in the sidebar or the tab bar.
2. Billing settles slower in the preview harness (Messages suppression and the phone collapse missed at a 1.5 second wait). A harness artefact: the preview drove the shell's Tweaks panel by script, while the app collapses to the tab bar through CSS breakpoints decided before first paint. Slice C resolves it by check, not code: hard reload /billing at 375 and capture the first paint; the tab bar is present, the desktop sidebar is not, and content is full width. Slice C must not add any JS width measurement.
3. Billing dark mode was clean. Slice C keeps every surface on tokens.

## Slices

Four slices with disjoint files. All four can run in parallel. None needs a backend change or a migration.

### Slice A: invoice list band, rail and row width (about 1.25 days)

Owned files: components/tahi/portal/invoices/portal-invoice-list.tsx, new components/tahi/portal/invoices/portal-invoices-rail.tsx, lib/portal-invoice-view.ts (one stale doc comment only).

Brief. Follow portal-money-invoices.jsx, function Invoices (not the superseded Invoices in portal-money.jsx), page keys invoices, invoices-loading, invoices-filtered, invoices-empty, invoices-error, invoices-readonly. Keep everything the live list already does: the useSWRInfinite walk over the whole book (MAX_PAGES 20, the capped footer), the three denial states, the preview prop plus useImpersonation read only rule, the Ask sheet, the row actions (View receipt, Pay now, How to pay, Open invoice), and every rule that no figure shows while settling or after a failure.

1. Headline band. Replace the three SummaryTile cards with a section aria-label "Your billing at a glance" holding KPIStrip with three KPICell children, no href. Icons from lucide-react.
   - Still to pay (icon Wallet, tone brand). Value: nothing open reads "All square"; one currency reads PortalMoney of formatCurrencyTotals(sumByCurrency(open)); more than one currency stacks each currency total on its own line at var(--text-lg) inside the value (never joined into one converted figure, never one long line that clips at 375). Sub: "{n} invoice(s), {k} overdue" or "{n} invoice(s), none overdue"; when nothing is open "Nothing is waiting on you".
   - Next due or Waiting longest (icon CalendarClock). Label "Waiting longest" when the soonest open bill is overdue, else "Next due". Tone danger when late, neutral otherwise (the lead money tile keeps its tone even when something is late, per the design). Value formatPortalDate of the due date, or "Nothing due". Sub "{portalDueLabel}, {reference}", or "You are all square".
   - Paid in {year} (icon CheckCircle2, tone positive). Keep the live label and sub ("{n} invoices settled"). Value as Still to pay, per currency, "Nothing yet" when zero.
   - Loading: the same KPIStrip with the three labels and each value a SkeletonBar (about 7rem by 1.5rem) in an animate-pulse wrapper. Not SkeletonKPIStrip. The band is absent (not zeroed) on error, on an empty book and on any denial.
2. Overdue callout. Keep the live Card with --badge-danger-bg, --badge-danger-border and --badge-danger-text (do not switch to Callout). Title "{per currency total} is past its due date." for one bill, "... is past its due date across {k} invoices." for more. Body "{reference} was due {formatPortalDateLong(dueDate)}. If something is wrong with it, ask us and we will hold it while we sort it out." Keep the Open {reference} action at 44px on a phone.
3. Rail. Wrap the list card and its foot note in RailLayout (components/tahi/rail/rail-layout.tsx), only once the book has at least one invoice or is still loading. Pattern: notifications-content.tsx and notifications-rail.tsx.
   - New portal-invoices-rail.tsx exporting PortalInvoicesRail with props view, onViewChange, counts (all, open, paid, or null while settling), years, year, onYearChange, currencies, currency, onCurrencyChange, variant ('rail' or 'sheet'), touch. Views group (RailGroupLabel "Views"; RailViewItem "All invoices", "To pay", "Paid" with counts; count null while settling) renders in the rail variant only. Filters group (RailGroupLabel "Filters") renders only when years.length > 1 or currencies.length > 1: RailSelect "Year" (All years, then each year) when more than one year, RailSelect "Currency" (All currencies, then each code) when more than one currency, one openKey in state so only one menu is ever open, active and onClear when not 'all'. When the sheet variant has no filters to show, it renders one muted sentence: "Every invoice here is in one year and one currency, so there is nothing to narrow by."
   - RailLayout props: rail the rail variant, railTouch the sheet variant with touch, railLabel "Invoice views and filters", sheetTitle "Filters", switcher a SegmentedControl (All, To pay, Paid with counts) wrapped in a div with className lg:hidden so a phone keeps one tap views, chips from buildRailChips over year and currency with defaults 'all', onClearChip resetting that dimension, onClearAll resetting view, year, currency and search, query and onQueryChange for search with placeholder "Search invoices", total rows.length, itemNoun "invoice", loading while settling.
   - Search keeps the live haystack (reference plus label). Year keeps the live derivation (sentAt, else createdAt). Currency filters on invoice.currency with a null currency treated as NZD, matching sumByCurrency.
   - Empty book, error and denial render without RailLayout, exactly as today.
4. Row width. The rail takes 14.5rem plus a 1.25rem gap from lg up, so the xl viewport switch would now clip the Amount and the action (the Pass 3 bug). Make the list Card a container and switch rows on its own width: add the Tailwind v4 @container class to the Card and replace hidden xl:grid and xl:hidden on the header and the row pair with @min-[51rem]:grid plus hidden, and @min-[51rem]:hidden. 51rem is the live GRID_COLUMNS measurement (45rem of tracks, 3.75rem of gaps, 2rem of padding, rounded up). Confirm the variant compiles; if it does not, put the two rules in a small co-located CSS file with a named container query, as overview.css does, and add that file to this slice.
5. How to pay from the list. The How to pay row action pushes /invoices/{id}#how-to-pay (slice B scrolls to the block on arrival; harmless if B lands later).
6. Copy. Filtered empty body: "Try clearing the search, or widening the filters in the rail." Clear filters also resets currency. Foot note keeps the live "Showing {n} of {m}" and capped sentences, and appends, only when the book holds more than one currency: " Each amount is in the currency it was billed in. We never add two of them together."
7. lib/portal-invoice-view.ts: correct the portalInvoiceLabel doc comment, which still says IC.7 owes the number (the number column shipped; the label never used it). Comment only, no behaviour change.

States to verify: loading (band skeleton, rail with no counts), populated single currency, populated two currencies (band stacks at 375, currency filter appears, foot sentence appears), overdue one and several, nothing open (All square), filtered to nothing, empty book, error then Try again, each denial, capped footer, read only Client view (Pay now disabled with the reason, rail and search still work), and a member seat test account. Widths: 375 (segmented switcher plus Filters button, band two by two with the third tile below, every row a card with a full width 44px action, no horizontal scroll), 768 (still sheet mode, cards), 1024 (rail visible, cards because the table is narrower than 51rem), 1440 with the sidebar open (six column rows with nothing clipped). Dark mode: band tiles and tones, the overdue card, rail active rows. Tokens only, no hex, rem spacing in any new inline style, no em or en dashes in copy or comments.

Do not build: a fourth "On the record" tile; the design's Band, Seg, Select or Search; any change to rail-layout.tsx, rail-controls.tsx, kpi-strip.tsx, skeletons.tsx or portal-money-kit.tsx; a Request destination on the header Ask; any JS width measurement; a converted total anywhere.

### Slice B: invoice detail (about 0.5 day)

Owned files: components/tahi/portal/invoices/portal-invoice-detail.tsx.

Brief. Follow portal-money-invoices.jsx, functions InvoiceDetail, HowToPay, InvoiceLoading, page keys invoice-hosted, invoice-bank, invoice-bank-gbp, invoice-loading, invoice-import-note. Keep the live data handling (subtotal and tax fallbacks, clientInvoiceNote re-applied, the 404 versus failure split, the denial card, the read only rule, the settled card, the Ask sheet state that survives the exit animation).

1. Hero secondary action label "Ask about this invoice" (was "Question about this invoice"); the sheet title and subjects stay as today. Hosted pay caption: "A secure payment page. Card or bank transfer, and it opens in a new tab."
2. Facts: add a Currency fact after Due (the invoice's own code). With Paid present that is five facts: pick between two static class strings, "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" and "grid gap-3 sm:grid-cols-2 lg:grid-cols-5", never a runtime built class.
3. How to pay with nowhere to pay. When invoice.howToPay exists but hasBankDestination(invoice.howToPay) from lib/invoice-how-to-pay.ts is false, render the card's header with the body "We do not have a bank account on file for {currency} bills yet. Ask us and we will send the right account, or a card link, within a working day." and one primary TahiButton "Ask us where to pay it" that opens the Ask sheet seeded "Where should I pay {reference}?", allowRequest false, title "Ask where to pay". No Amount, Due or Reference copy rows and no Copy all details in that state. The hero's How to pay anchor still jumps here.
4. Arriving with #how-to-pay. After the invoice has loaded and the block is rendered, if window.location.hash is "#how-to-pay", scroll the block into view once (smooth, block start; instant when prefers-reduced-motion is set). Guard with a ref so it fires once per load.
5. Line items header: put the FileText icon in the same leaf tile the How to pay header uses (2.25rem, var(--radius-leaf-sm), --color-brand-50 and --color-brand-dark), on the card's own background rather than the tinted band. Keep the copy.
6. Loading skeleton mirrors the page: the back link, a hero Card whose left side holds three PortalSkeleton lines (org, title, amount at about 2.25rem) and whose right side holds two 2.75rem action bars (side by side from lg, stacked full width below), four fact skeleton cards in the same grid classes, and a line items Card with its header bar and three rows.
7. Keep: "GST (15 percent)" and "Tax" labels exactly (do not add "included"; subtotal plus tax is additive in the live data), the note card, the foot sentence, the read only behaviour of Pay by card instead and the line Asks (they open the read only sheet, as the requirement says).
8. Live verification (no code): open an imported invoice whose notes start "Imported from" and confirm no "A note from the studio" card renders.

States to verify: hosted link, Xero rail with bank rows (NZD, and GBP with sort code and SWIFT), Xero rail with no account for the currency (the fallback), settled with a note, settled imported (no note), single amount, discount present, loading, missing, error, each denial, read only. Widths 375 (hero stacks, pay action full width at 44px or more, facts one column, line items as cards, copy rows wrap without overflow), 768, 1440. Dark mode on the fallback card, the leaf tiles, the settled card. Tokens only, no hex, rem spacing, no em or en dashes.

Do not build: the thread proposal, a receipt or PDF download, the per currency account note ("The account we hold for..."), disabled Ask triggers in Client view, any change to portal-money-kit.tsx or lib/invoice-how-to-pay.ts.

### Slice C: /billing client branch (about 1 day)

Owned files: new components/tahi/portal/billing/portal-billing.tsx, app/(dashboard)/billing/page.tsx, app/(dashboard)/billing/billing-content.tsx (remove the client branch only).

Brief. Follow portal-money-billing.jsx (PlanCard, History, Billing) and portal-money-billing.css section 3 for layout intent, page keys billing, billing-stripe, billing-loading, billing-empty, billing-error, billing-denied-member, billing-readonly. The live data wins over the design's sample data everywhere below: there is no card name, no add on price and no "first of each month" fact in the API.

1. Move the client branch into PortalBilling ({ preview }) in the new file, carrying over every live behaviour: the two SWR reads (/api/portal/invoices?status=all and /api/portal/subscription), the portalMoneyDenial classifier and the /api/portal/people lookup, the failure state, openBillingPortal with its on page error line, the refresh. In page.tsx render PortalBilling preview={isPreviewingClient} when the viewer is not the studio, and BillingContent isAdmin for the studio. In billing-content.tsx delete the client branch, its types and InvoiceHistoryMobileCard; leave AdminBillingView and its helpers byte for byte (the finance plan's slice C moves those). readOnly is preview or useImpersonation().isImpersonatingClient, as the invoice pages do.
2. Header: PageHeader "Billing", subtitle "Your plan, what it costs, and every invoice we have raised for you.", Refresh stays (TahiButton secondary).
3. Plan card (Card). Header row: a 2.5rem leaf tile (Layers icon, --color-brand-50 and --color-brand-dark), eyebrow "Your plan", h2 planLabel, and to the right on wide screens (wrapping under on a phone) two Badges: status (tone positive, capitalised; the route only returns active rows) and interval (neutral: Monthly, Quarterly, Annual). Facts in "grid gap-4 sm:grid-cols-2 lg:grid-cols-4", each an eyebrow label, a value and a muted sub, in the PlanFact treatment portal-services.tsx already uses (no boxed tiles):
   - Rate, only when billing.monthlyRate > 0: PortalMoney of formatPortalMoney(monthlyRate, billing.currency or NZD), sub "A month". No GST claim.
   - Next invoice: when nextInvoiceDate is set, value formatPortalDate; sub "The end of your current billing period" when currentPeriodEnd is set, else "Projected from your {cadenceWord} cycle". When it is null, value "Invoiced {cadenceWord}" and sub "The date comes with the invoice". Never the word Xero or Stripe, never a bare TBC.
   - On this plan since: formatPortalDateLong(createdAt) when present (add createdAt to the local type; the route returns it). No "unbroken" claim.
   - Each {n} month invoice, only when billing.cycleMonths > 1: cycleTotal, sub "Every {n} months".
   Add ons block under the facts: eyebrow "Included with your plan"; each addonDetails row as label plus "{formatPortalMoney(monthlyValue, 'NZD')} a month in value" (studio value estimates, never converted, never presented as billed); the live savings line reworded "You save {amount} a year against paying for these monthly." when monthlySavings > 0; with no add ons the sentence "No add ons on your plan."
   How you pay line (muted, small icon): canManagePayment true: "Manage billing opens your payment portal, where you can change how you pay and read past receipts." False: "Each invoice shows how to pay it, and the invoice page has the bank details. If you would rather pay by card, ask us and we will send a link."
   Actions row: Manage billing (TahiButton primary, ExternalLink icon, "Opening" while loading) only when canManagePayment, absent otherwise; Ask about billing (secondary, MessageSquare) opening PortalAskSheet with title "Ask about billing", subtitle "A question about your plan, your invoices or how you are billed.", seed "About our {planLabel} plan: ", requestTitle and emailSubject "Question about our billing", allowRequest false, readOnly and the reason. Both full width on a phone, their own width from sm. When readOnly and canManagePayment, a muted caption under the row: "This opens the client's real payment portal. Anything changed there changes their account." Keep the portalError line.
   No subscription: in place of the plan card, a Card with the leaf tile and "There is no plan on your account at the moment. Anything we bill for one off work is listed below." plus the Ask about billing button.
4. History card (Card padding none). Header: leaf tile (Receipt icon), h2 "Invoice history", lede "Every invoice we have raised for you, newest first. Open one to see what it covers and how to pay it." (loading: "Loading your invoices."; empty: "Nothing has been billed yet."), and when there are rows a ghost TahiButton "Go to Invoices" (ArrowRight) that pushes /invoices. Body: DataTable with the live columns plus Issued (sentAt, else createdAt, formatPortalDate, sortable, width about 7rem) after Invoice; defaultSort issued descending; loading passes DataTable's own loading prop; mobileCard keeps the live card (min-h-11). Empty: EmptyState with PortalLeafIcon, "No invoices yet", description "Your first invoice lands on {formatPortalDateLong(nextInvoiceDate)}, here and in your inbox." when a date is known, else "When we bill you, the invoice lands here and in your inbox on the same day.", and the Ask about billing button.
5. Foot note under the history, only with rows. The read is one page of up to 50. When fewer than 50 came back: open bills present, "Still to pay: {formatCurrencyTotals(sumByCurrency(open))}. Each amount is in the currency it was billed in." (map rows to totalAmount first); none open, "Everything we have raised has been paid." When exactly 50 came back: "These are your 50 most recent invoices. Invoices has the full list." and no total.
6. Loading: the plan card skeleton (tile, name bar, four fact skeletons with label, value and sub bars) plus the history card with DataTable loading. Error: EmptyState alert, "We could not load your billing", "This one is on us. Your plan has not changed, nothing has been billed because of it, and your requests and files are unaffected.", primary Try again. Denial: unchanged (PageHeader subtitle "Your plan and invoices.", lock card, shared copy).
7. FIX item 2 check (see above): hard reload /billing at 375 in a real client session and confirm the first paint has the tab bar, no desktop sidebar, no Messages, full width content.

States to verify: Xero rail with no add ons, Stripe rail with add ons and Manage billing (success and the on page error), quarterly plan (cycle fact and savings line), no next invoice date, no subscription, empty history with and without a date, 50 row book, loading, error, member seat denial, Client view (Ask read only, caption under Manage billing). Widths 375 (facts one column, badges wrap under the name, actions full width at 44px, history as cards, no horizontal scroll), 768 (table returns; any overflow scrolls inside the card, never the page), 1440. Dark mode on badges, leaf tiles, the facts, the caption. Tokens only, no hex, rem spacing, no em or en dashes.

Do not build: a nav entry for /billing; a card name line; priced "Added to your plan" add ons; a lapsed add on line; the design's hand drawn sortable table (DataTable wins); any change to AdminBillingView; any change to /api/portal/billing/session (read only enforcement there is a question for Liam).

### Slice D: services plan panel honesty (about 0.5 day)

Owned files: components/tahi/portal/services/portal-services.tsx.

Brief. Follow portal-money.jsx, the Services function's plan handling (PLAN_HOURLY and the services-custom key) and the catalogue section head, and portal-money-data.jsx PLAN_HOURLY. Everything else on the page stays as it is, including plan-ladder.tsx (not owned, not edited).

1. PlanPanel speaks for the plan it is. For planType hourly: eyebrow "How you are billed", title planLabel, body "Billed by the hour, with no retainer and no monthly commitment. You send work when you have it and we book it in.", no Tracks running fact. For every plan: the Rate fact renders only when monthlyRate > 0 (never NZ$0.00 per month); the Tracks running fact and the tracks sentence render only when trackCount > 0. Retainer copy for maintain, scale and custom plans with tracks is unchanged.
2. Add ons on the plan panel: replace displayMoney (useDisplayCurrency, which converts) with formatPortalMoney(monthlyValue, 'NZD') followed by " a month in value", matching slice C, so the two money pages say the same thing about the same figure. Remove the hook import if nothing else uses it.
3. Catalogue heading: when the plan panel rendered (a subscription is present), add the eyebrow "The rest of the studio" and title "What else we take on"; otherwise keep "What we take on". Append to the intro: " Asking commits you to nothing."

States to verify: Scale admin (unchanged apart from the add on wording and heading), hourly plan with zero rate, custom plan with a negotiated rate, member seat (no panel, heading "What we take on"), Client view, loading, catalogue error with the plan still showing. Widths 375, 768, 1440; dark mode on the panel. Tokens only, no hex, no em or en dashes.

Do not build: PlanStage, lanes, UsageBlock, feature stories, ServiceArt, FitKey, the Fits {plan} scope control, the add on shelf, a locked member placeholder, a services switched off card, any change to plan-ladder.tsx or lib/plan-ladder.ts.

## Skipped proposals (live behaviour kept)

- The per invoice thread "Questions about this invoice" (page key invoice-thread, marked "Proposal, not built" in the design; PP.3; requirement question 1).
- A fourth band tile "On the record" (the design itself dropped it as a proposal; requirement question 4).
- Receipt and invoice PDF downloads (removed by the design as dead buttons; PP.3 follow up, requirement question 2). "View receipt" keeps reopening the detail page.
- The per currency account note in How to pay ("The account we hold for pounds sterling..."): the block cannot tell a currency account from the legacy fallback account, so the claim could be false. Needs a backend field.
- Services PlanStage (forest hero, per track lanes with busy days, Delivered this quarter, Waiting in your queue): requirement question 4; lane occupancy has no source.
- Services UsageBlock (turnaround, revisions used, tracks busy, delivered by kind mix bar, month by month chart): requirement question 4; revisions and occupancy have no source.
- The editorial catalogue (feature story, story cards, line items, ServiceArt placeholder geometry, FitKey, who, why, forYou, planNote) and the "Fits {plan}" scope control: requirement question 4; needs new services columns (a migration).
- The add on shelf (running, ended, offered): requirement question 4; no add on catalogue table and no endedAt.
- A locked "Your plan" placeholder for a member seat on /services and /billing (requirement question 5; the design also draws absent).
- A nav entry for /billing, and the preview's mounting of Billing under the Invoices nav slot (requirement question 2).
- Invoices promoted into the client phone tab bar in place of Messages (the preview harness's wiring note, not reviewed). The live bar keeps three tabs plus More.
- The services "switched off" lock card (the live page redirects a denied client to /requests, Liam 2026-09-14).
- Design copy the data cannot back: "Charged to your Visa ending 4417", "on the first of each month", "Unbroken since your first invoice", "GST included" on rates and totals, priced "Added to your plan" add ons.
- Both destinations on the list header Ask (the kit keeps a billing question email only on purpose).
- Disabled Ask triggers in Client view on the invoice detail (the requirement specifies a read only sheet instead).
- The full page Services error state (live scopes the failure to the catalogue).

## Questions for Liam

1. The invoice list now uses the left rail like Requests (requirement question 3). Keep it, or go back to the inline segmented control and year select?
2. Member seats: locked "Your plan" placeholder on /services and /billing, or absent as today?
3. /billing: back into the client nav, or unlisted but reachable by URL as today?
4. Manage billing in Client view opens the client's real Stripe customer portal, where a card can be changed. Keep it live with the warning caption the port adds, or disable it in preview?
5. With Messages switched off, the client phone tab bar shows three tabs plus More. Promote Invoices (org admins only) into the fourth slot?
6. The port removes "through Xero" from the /billing next invoice fallback, following the rule that a client never sees the rail. Agree?
7. Services: port the fuller showcase (plan stage, usage, editorial stories, add on shelf, most of which needs new columns), or keep the current plan card, ladder and grid as the target? (Requirement question 4.)
8. Per invoice thread (PP.3) and a real receipt document: build either, or keep the Ask sheet and "View receipt" reopening the page?
9. Headline band: KPIStrip everywhere, or one shared port of head-band.css across all list pages (the calculator-analytics plan proposes components/tahi/headline-band.tsx)?

## Risks

- Tailwind v4 container variants (@container, @min-[51rem]:) are not used anywhere in the codebase yet; slice A must confirm they compile and fall back to a co-located CSS container query if not. Without the switch the rail reintroduces the clipped Pay now action at 1280 to about 1400px.
- app/(dashboard)/billing/billing-content.tsx is shared with the finance plan's slice C (which moves AdminBillingView out). Slice C here deletes only the client branch. Whichever lands second rebases; the regions do not overlap.
- If a shared headline band primitive lands (calculator-analytics proposes one), the KPIStrip band here should be swapped for it.
- The /billing history reads one page of 50; the foot note only totals a complete book and says so otherwise.
- Manage billing in Client view is a write surface in Stripe (payment methods, possibly cancellation, depending on the Stripe portal configuration). The port keeps today's behaviour and only warns.
- The #how-to-pay jump depends on the block existing after the fetch; the app shell scrolls inside its own container, so scrollIntoView (not window.scrollTo) is required.
- Two currency band values at 375 are tight inside a half width KPICell; check the longest realistic figures (five digit NZD plus a GBP total).
- Live smoke needs a real client admin session or act mode, a member seat account for the denials, a Stripe rail client for Manage billing, and an imported invoice for the note check. The Definition of Done screenshots at 375 and in dark are owed per slice.
- The rail adds weight to a page most clients use to pay one bill. With one year and one currency the Filters sheet on a phone holds only a sentence; watch whether that reads as broken.

## Shared files

- app/(dashboard)/billing/billing-content.tsx (slice C removes the client branch; the finance plan moves the studio branch)
- app/(dashboard)/billing/page.tsx (slice C; the finance plan reads it)
- lib/portal-invoice-view.ts (slice A, comment only; consumed by billing, services, email)
- app/(dashboard)/invoices/page.tsx and app/(dashboard)/invoices/[id]/page.tsx (not edited; shared with the finance plan)
- components/tahi/portal/portal-money-kit.tsx (consumed, not edited; other portal modules use it)
- components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx (consumed, not edited)
- components/tahi/rail/rail-layout.tsx, components/tahi/rail/rail-controls.tsx (consumed, not edited)
- components/tahi/data-table.tsx, card.tsx, empty-state.tsx, tahi-button.tsx, badge.tsx, segmented-control.tsx, page-header.tsx (consumed, not edited)
- lib/invoice-how-to-pay.ts (hasBankDestination consumed)
- components/tahi/impersonation-banner.tsx (useImpersonation consumed)
- components/tahi/nav-model.tsx and components/tahi/mobile-bottom-nav.tsx (not edited; questions 3 and 5 would edit them)
- components/tahi/portal/services/plan-ladder.tsx and lib/plan-ladder.ts (not edited)
- app/globals.css (not edited)
