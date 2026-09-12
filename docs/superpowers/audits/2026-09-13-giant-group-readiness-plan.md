# Giant Group readiness: audit and build plan (2026-09-13)

Eight sonnet auditors (code readers, live D1 via MCP, one read-only Client view walk on production) and one opus planner. Raw auditor JSON: 2026-09-13-giant-group-readiness-results.json.

# Tonight's run plan: Giant Group readiness (Batch A), 2026-09-12

Repo root for every path below: `C:/Users/Work/Projects/tahi-dashboard`. Eight auditor reports deduplicated; nothing below is re-derived from the reports alone, every claim named as blocker was re-read in source during this pass.

---

## 1. READINESS VERDICT

What would break or mislead Giant Group if Mickey Day and Mark Ramsey were invited as-is. Severity order, deduplicated across auditors.

### BLOCKER 1. The portal lies about what Giant Group pays and how much capacity they have, on every screen that shows it
Four auditors, one root cause, three visible symptoms. `/api/portal/subscription` never reads `custom_mrr`, so it serves the catalogue default (NZD 4,000 for `scale`) instead of the real GBP 2,000/mo, and `useOvFormat().money()` then FX-converts that fiction into the reader's display currency. The same route counts physical `tracks` rows (1) instead of the configured entitlement (1 small + 1 large = 2), and `/api/portal/tracks` repeats the undercount, so the large-track lane never renders on the home board at all.
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/subscription/route.ts:70` (`monthlyRate = catalogPlan?.monthlyRate ?? PLAN_MONTHLY_RATES[...]`) and `:97-101` (`trackCount = trackRows.length`); `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/tracks/route.ts:44-47`; `C:/Users/Work/Projects/tahi-dashboard/lib/billing.ts:33` (`scale: 4000`, NZD); consumers `C:/Users/Work/Projects/tahi-dashboard/components/tahi/overview/homes/client-home.tsx:1618`, `C:/Users/Work/Projects/tahi-dashboard/components/tahi/portal/services/portal-services.tsx:393`, `C:/Users/Work/Projects/tahi-dashboard/components/tahi/settings/sections/plan.tsx:167-169` and `:219`, `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/billing/billing-content.tsx:215` (hardcoded string `NZD`). Live confirmation: "Scale Active, NZ$4,000/mo . 1 track" captured in Client view on production (screenshot-1789209635373-6.jpg, -69.jpg, -74.jpg). Ground truth: `custom_mrr=2000`, `custom_mrr_currency`/`preferred_currency` GBP, `tracks_mode='custom'`, 1 small + 1 large.
- Extra trap found this pass, not in any report: `custom_mrr` and `custom_mrr_currency` are **not in the Drizzle schema**. They are read by raw SQL with a try/catch in `C:/Users/Work/Projects/tahi-dashboard/app/api/admin/clients/[id]/route.ts:78-108`. A builder who writes `schema.organisations.customMrr` will not compile.

### BLOCKER 2. An existing retainer client is routed through Choose-Plan and a live Stripe card form
`buildSteps()` returns `['welcome','plan','pay']` for `clientType === 'existing'` whenever engagement is `retainer`. Giant Group's invite persona resolves to `existing_retainer` (`lib/onboarding-entry.ts:84`), so Mickey lands on a pay screen advertising "Scale $4,000/mo" USD. If he pays, `/api/portal/checkout` creates a second, real Stripe subscription for a client already invoiced through Xero at GBP 2,000. He also never reaches a kickoff step, contradicting the run's own acceptance bar.
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/components/tahi/onboarding-content.tsx:94-102`; `C:/Users/Work/Projects/tahi-dashboard/lib/onboarding-entry.ts:80-84`; `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/checkout/route.ts:22-60` (no active-subscription and no invoice-channel guard); `C:/Users/Work/Projects/tahi-dashboard/lib/onboarding-invites.ts:113-120` whose own doc comment promises the opposite behaviour.

### BLOCKER 3. A real, due, unpaid Xero invoice can reach them with nothing to act on
Two halves, both required.
- (a) Data: `organisations.invoice_channel` is NULL for Giant Group, and the studio default is `stripe`, so `resolveInvoiceChannel` returns `stripe` for a client with 4/4 Xero-sourced invoices and no Stripe customer. The bank-details fallback only builds when the channel is `xero`. Evidence: `C:/Users/Work/Projects/tahi-dashboard/lib/invoice-channel.ts:52-59`, `C:/Users/Work/Projects/tahi-dashboard/lib/invoice-how-to-pay.ts:201-210`.
- (b) Code: even when the backend does build the block, no client-facing page renders it. Both portal routes return `howToPay` (`C:/Users/Work/Projects/tahi-dashboard/app/api/portal/invoices/route.ts:171-190` and `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/invoices/[id]/route.ts:127-152`) and `grep howToPay app/(dashboard)/invoices/` returns zero matches.
- Today's live invoice survives only because it carries a captured `xeroOnlineInvoiceUrl`. The next one, raised in the ordinary pre-approval gap, does not.

### BLOCKER 4. Client notification emails can never be delivered, even after Liam flips the allowlist
`sendWithBackoff` calls `sendEmail(to, subject, el, text)` with no fifth `context` argument, so `orgId` arrives at the delivery gate as `null` and the per-org exemption branch can never match. Thread replies, "ready for your review", "delivered" and the org standing-line message are therefore withheld forever regardless of `email.allowedOrgIds`. Already visible in production: two suppression rows logged as `template: "unspecified", orgId: null`.
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/lib/notification-email.ts:436-449`; `C:/Users/Work/Projects/tahi-dashboard/lib/email.ts:40-64`; `C:/Users/Work/Projects/tahi-dashboard/lib/email-allowlist.ts:493-497`; `C:/Users/Work/Projects/tahi-dashboard/lib/email-gate.ts:110-113`.
- Confirmed correct today and unaffected: invoice-sent, the manual chase, client-invite, Clerk org invites, announcement fan-out (all thread `orgId` properly).

### BLOCKER 5. The portal home shows the wrong upcoming call, with no link to join
`discovery_calls` row `2663a77a-a8b8-478c-9542-d6588c3ea5ab`, "N8N Content Engine", is tagged `meetingType: 'client'` with Giant Group's `orgId` and a null `googleMeetUrl`. It sorts ahead of their real weekly "Giant group x Tahi" (which does have a Meet link). `/api/portal/calls` queries faithfully and org-scoped, so a real Mickey Day session sees the same row.
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/calls/route.ts:106-126`; live screenshots -5.jpg / -77.jpg; classifier that produced it: `C:/Users/Work/Projects/tahi-dashboard/app/api/admin/integrations/google/sync-calendar/route.ts:219-264`.

### MAJOR 6. `/messages` is live for clients, contradicting the standing rule, and sends no email
Four auditors independently confirmed the code default is "visible". `decideFeature` returns `true` for an unrestricted client level, Messages is in `CLIENT_NAV` and in the four mobile primary tabs, and a live `get_feature_visibility` read for Giant Group and for the `client` role both return `{"overrides":[]}`. Combined with BLOCKER 4, a client can post into "your line to the studio" and nobody is emailed.
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/lib/permissions.ts:188-189`; `C:/Users/Work/Projects/tahi-dashboard/components/tahi/nav-model.tsx:138`; `C:/Users/Work/Projects/tahi-dashboard/components/tahi/mobile-bottom-nav.tsx:39`; commit `f29425a9` (2026-09-06) deliberately reversed the earlier hide; stale comment still asserting the old behaviour at `C:/Users/Work/Projects/tahi-dashboard/components/tahi/settings/sections/plan.tsx:395-398`.

### MAJOR 7. Their only request is a Tahi-side artifact that reads as an unexplained open item
Request #243 "Create tasks for design + dev": no description, zero comments, zero files, `isInternal=false`, created inside ManyRequests by Liam on 2026-08-14. Cross-checked 1:1 against ManyRequests request 334 (comments_total 0, attachments [], sole activity REQUEST_CREATED). Real production data, not a bug; a builder must not rewrite or delete it.

### MAJOR 8. The Services page is hollow on day one
All 18 catalogue rows carry `showInCatalog: 0` (by import design), and none is org-scoped to Giant Group, so `/api/portal/services` returns zero rows and the honest empty state renders. Evidence: `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/services/route.ts:20-30`; `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/plan.ts:916-919`.

### MAJOR 9. `/billing` "Manage Billing" is a silent dead click for a Xero-rail client
Rendered unconditionally whenever a subscription exists; the API 404s without a `stripeCustomerId` and the failure is swallowed into `console.error`. Only bites if a client reaches `/billing` directly (it is out of the nav per CT.16 default). The Settings > Plan & billing twin does at least flash a message (`C:/Users/Work/Projects/tahi-dashboard/components/tahi/settings/sections/plan.tsx:161`).
- Evidence: `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/billing/billing-content.tsx:119-137` and `:247-254`; `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/billing/session/route.ts:52-54`.

### MAJOR 10. There is no cross-org isolation proof
`e2e/portal-flow.spec.ts` is entirely `test.skip(true, ...)` (8 dead cases); no e2e anywhere signs in two client orgs. Tenancy assurance is unit-level only against a mocked D1. Nine portal routes a Giant Group contact hits weekly have zero handler-level coverage (files, conversations GET+POST, team, notifications GET+PATCH, announcements, uploads serve, uploads proxy, sub-requests, review POST). Direct code read shows all nine correctly org-scoped, so this is a proof gap, not a known leak. A4's own acceptance bar is at 0 percent.

### MAJOR 11. The invoice reference they see is a synthetic id, not `INV-0065`
Portal detail renders "REFERENCE E1162445"; `invoices.number` is null, notes read "Imported from Xero: INV-0065". A bank transfer quoting E1162445 is unmatched on the studio side. Fix is the already-scoped backfill, awaiting Liam's approval.

### MAJOR 12. Clerk configuration gaps (operator only, do not block tonight's two invites)
`CLERK_WEBHOOK_SECRET` unset means `/api/webhooks/clerk` returns 503 to every delivery (`C:/Users/Work/Projects/tahi-dashboard/app/api/webhooks/clerk/route.ts:58-65`). Tonight's exact flow survives because `accept-invite` writes `clerkUserId` synchronously and `linkContactOnSignIn` runs on every dashboard load. What genuinely stays broken: a colleague invited later through the in-portal Clerk-native invite has no server-side recovery, and `organizationMembership.deleted` never clears a stale link. Separately, if this Clerk instance still has the post-sign-up organization task enabled, a first-time signer is asked to create their own workspace before the invite is consumed (self-heals, but is a bad first screen).

### MINOR 13 to 18
- 13. Client invoice notifications always land on `/invoices`, never the specific invoice, five weeks after the portal detail branch shipped. `C:/Users/Work/Projects/tahi-dashboard/lib/notification-links.ts:139`.
- 14. `/tracks` is unlinked but still fully reachable for a client by URL. `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/tracks/page.tsx`. Note the route is also the studio's cross-client queue view, so "delete" is the wrong verb (see slice S1 and section 5).
- 15. `e2e/helpers/invites.ts:12` hardcodes `http://localhost:3000`, which would silently seed the wrong D1 if the A4 spec is run on the 3179 QA harness.
- 16. MC.7: a requests/messages/invoices-only import run never fetches the organisations list, so hand-mapped clients are refused. Does not affect Giant Group (already stamped), does block the planned subset re-import for the other 19 clients. `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/run.ts:81-89`.
- 17. Contracts have no portal API surface at all, so A4's contracts assertion must target the public share token instead.
- 18. The production `RESEND_FROM_EMAIL` value cannot be read from the repo, and `.env.local` (`dashboard@tahi.studio`) disagrees with `.env.migration` (`business@tahi.studio`). Also: `invoicing.bankDetails` is a single global account with no per-currency variant, so a GBP invoice would quote whatever account is configured.

---

## 2. BUILD SLICES

Standing rules for every slice:
- Own git worktree, own branch, no file touched by any other slice. Use `superpowers:using-git-worktrees`.
- **Schema: none of tonight's slices needs a migration.** Every column used already exists in production (migration 0016 for `custom_mrr` / `custom_mrr_currency`, 0079 for the tracks columns, 0096 for `invoices.number`). If a builder believes it needs one, it stops and reports rather than inventing 0098; the rule if it ever applies is `CREATE TABLE/ADD COLUMN ... IF NOT EXISTS` in `drizzle/migrations/0098_*.sql`, mirrored into `MIGRATIONS` in `C:/Users/Work/Projects/tahi-dashboard/app/api/admin/db/migrate/route.ts:33`, applied to both D1s before the push.
- Vitest: copy the fake-D1 recorder from `C:/Users/Work/Projects/tahi-dashboard/app/api/__tests__/portal-invoice-pay-path.test.ts:58-90`. Results are served **positionally**, so the order of reads is part of what you pin. The recorder exposes only `select/insert/update/delete`; a route that uses raw SQL needs an `all: () => entry('all')` added to the local handle.
- Playwright: run on the QA harness, not the main dev server. `npx playwright test -c playwright.local.config.ts <spec>` with `PLAYWRIGHT_TEST_BASE_URL=http://localhost:3179`.
- Gate before merge: `npm run build` (900s timeout), `npm run type-check`, worker tsc, `npm run lint` at zero, `npm run test`.
- No em dashes or en dashes anywhere, including comments and JSX copy.

---

### S1. Portal plan truth: their real rate, their real tracks
**Closes:** BLOCKER 1 (giant-group-data F1/F2, services-and-plan B2-1/B2-2, live-client-view F1), MAJOR 9 (giant-group-data F4), MINOR 14 (portal-pages-code F4).
**Model: opus** (money).
**Effort: 3.5 to 4 hours.**

**Files (exclusive to this slice):**
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/subscription/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/tracks/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/components/tahi/overview/homes/client-home.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/components/tahi/portal/services/portal-services.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/components/tahi/settings/sections/plan.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/billing/billing-content.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/tracks/page.tsx`
- new: `C:/Users/Work/Projects/tahi-dashboard/app/api/__tests__/portal-plan-truth.test.ts`

**Work order:**
1. In `app/api/portal/subscription/route.ts`, after the subscription lookup, read the org twice: a typed Drizzle select for `preferredCurrency`, `stripeCustomerId`, `tracksMode`, `customSmallTracks`, `customLargeTracks` (all in the Drizzle schema), and a **raw SQL read wrapped in try/catch** for `custom_mrr, custom_mrr_currency` copying the pattern at `app/api/admin/clients/[id]/route.ts:78-95`. Do not add these to `db/schema.ts`; the deliberate reason is in the comment there.
2. Compute `const customRate = typeof customMrr === 'number' && customMrr > 0`. Then `monthlyRate = customRate ? customMrr : (catalogPlan?.monthlyRate ?? PLAN_MONTHLY_RATES[sub.planType] ?? 0)` and `currency = customRate ? (customMrrCurrency ?? preferredCurrency ?? 'NZD') : 'NZD'`.
3. Add `currency`, `customRate` and `canManagePayment: !!stripeCustomerId` to the `subscription` object, and `currency` to the `billing` object. Leave the `plans` array alone: those are studio list prices in NZD and are correctly rendered with `<Money nzd>`.
4. Replace `trackCount = trackRows.length` with `resolveTracksConfig(org, sub.planType, !!sub.hasPrioritySupport)` from `@/lib/plan-utils` and `smallTracks + largeTracks`. Wrap the org read so a pre-0079 environment falls back, exactly as `app/api/portal/capacity/route.ts:105-118` does.
5. In `app/api/portal/tracks/route.ts`, load the same three tracks columns plus `hasPrioritySupport` on the subscription, call `resolveTracksConfig` then `buildEffectiveTracks(tracks, config.smallTracks, config.largeTracks)` and map `items` off the effective list (not the raw rows), so the synthetic large lane appears with its own empty queue. Keep the existing `isInternal=false` and status filters untouched. `config.mode === 'off'` keeps the raw rows, mirroring capacity.
6. UI, `client-home.tsx:1618`: stop passing a native amount through `money()`. Render `<Money native={subData.subscription.monthlyRate} currency={subData.subscription.currency} withDisplay sensitive />` (`components/tahi/money.tsx` already supports exactly this shape). Same for the tracks copy, which now reads the corrected count with no other change.
7. UI, `portal-services.tsx:393`: same swap, replacing `displayMoney(subscription.monthlyRate)`.
8. UI, `plan.tsx`: `baseRate` renders natively via `<Money native={baseRate} currency={currency} withDisplay />`. When `customRate` is true, **do not compute `total = baseRate + extras * trackRate`** (that adds an NZD track rate to a GBP base). Render the base rate alone and replace the composed total row and the extra-track cost math with the copy "Extra tracks are quoted for your plan, ask us and we will confirm." Gate "Manage payment method" on `canManagePayment`.
9. UI, `billing-content.tsx:215`: replace the hardcoded `NZD` string with the resolved currency via `<Money native={billing.cycleTotal} currency={billing.currency} />`, and gate the "Manage Billing" `TahiButton` (`:247-254`) on `subscription.canManagePayment`. Give `openBillingPortal()`'s `!res.ok` branch a real inline error state instead of `console.error`.
10. `app/(dashboard)/tracks/page.tsx`: in the non-studio branch, `redirect('/requests')` instead of rendering, matching how Schedules/Contracts/Proposals treat a client. **Do not delete the page and do not remove the `tracks` key from `lib/feature-tree.ts`**: the studio branch is a real cross-client queue view, and `/api/portal/tracks` guards on that key to power the client home widget.

**Tests (`portal-plan-truth.test.ts`, fake-D1):**
- Org with `custom_mrr=2000`, `custom_mrr_currency='GBP'`, `tracks_mode='custom'`, small 1 / large 1, one real small track row: route returns `monthlyRate: 2000`, `currency: 'GBP'`, `customRate: true`, `trackCount: 2`, `canManagePayment: false`.
- Org with no `custom_mrr` on a `scale` plan: returns `4000`, `currency: 'NZD'`, `customRate: false`.
- The raw-SQL read throwing (pre-0016 shape) falls back to the catalogue rate and does not 500.
- `/api/portal/tracks` with one real small row and a custom 1+1 config returns two items, the second with an id matching `/^synthetic-large-/` and an empty `queue` array.

**Live smoke (lead, production, as Liam through Client view, read-only):** open `/overview` as Giant Group. "Your plan" reads `£2,000/mo` (with the approximate display conversion appended) and `2 tracks`; "Your work in motion" renders two lanes. `/services` Rate fact reads the same figure. `/settings?section=plan` shows the same base rate, no composed NZD total, and no "Manage payment method" button. `/billing` by direct URL shows no "Manage Billing" button. `/tracks` by direct URL bounces to `/requests` in Client view and still renders the studio queue when Client view is off. Repeat `/overview` at 375px and with `.dark`.

---

### S2. An existing client never sees a plan picker or a card form
**Closes:** BLOCKER 2 (invite-and-signin F1).
**Model: opus** (money plus onboarding write paths).
**Effort: 2 to 3 hours.**

**Files (exclusive):**
- `C:/Users/Work/Projects/tahi-dashboard/components/tahi/onboarding-content.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/checkout/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/e2e/onboarding-personas.spec.ts`
- new: `C:/Users/Work/Projects/tahi-dashboard/app/api/__tests__/portal-checkout-existing-guard.test.ts`

**Work order:**
1. `onboarding-content.tsx:94-102`, `buildSteps`: for `clientType === 'existing'`, return `['welcome','kickoff']` for both engagements. Delete the `['welcome','plan','pay']` branch. Leave the `new` branches untouched. Update the doc comment at the top of the file (lines 10 to 20) so the step table matches.
2. Check the two places the component special-cases a retainer copy string (`:481-484`) and make sure the welcome copy still reads correctly when the next step is kickoff.
3. `app/api/portal/checkout/route.ts`: add a guard after the `isOrgAdmin` check and before any Stripe call. Read the org's active subscription and its `invoice_channel`. If an `active` subscription already exists for this org, return `409 { error: 'This workspace already has an active retainer. Talk to your studio contact to change it.' }`. Do the same when the resolved invoice channel is `xero` (use `resolveInvoiceChannel` with the studio default from settings, mirroring `app/api/portal/invoices/route.ts`). This is belt and braces: after step 1 the UI never calls it, and the route must still refuse.
4. `e2e/onboarding-personas.spec.ts`: add a persona case that mints an `existing_retainer` invite on a fresh test org, signs up a `+clerk_test@example.com` user, and asserts the step rail never shows "Plan" or "Pay", that the kickoff slot picker renders, and that no request to `/api/portal/checkout` is issued (assert via `page.on('request')`).

**Tests:** the e2e above, plus `portal-checkout-existing-guard.test.ts` (fake-D1): active subscription present returns 409 and never constructs a Stripe client; `invoice_channel='xero'` with no subscription returns 409; a clean new-client org with neither still reaches the Stripe-not-configured 503 path (proving the guard did not over-refuse).

**Live smoke:** none on production (no invite is minted tonight). Instead, on the QA harness, mint an `existing_retainer` invite for a plus-alias on Tahi Test Client, walk it in a real browser to the kickoff step, and screenshot at 375 and dark. Lead records the screenshots in the commit body.

---

### S3. A client can always see how to pay
**Closes:** BLOCKER 3(b) (portal-pages-code F1), MINOR 13 (portal-pages-code F3).
**Model: sonnet** (fully specified, no auth or money computation, the amounts come from the API).
**Effort: 2.5 to 3 hours.**

**Files (exclusive):**
- `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/invoices/invoice-list.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/app/(dashboard)/invoices/[id]/invoice-detail.tsx`
- `C:/Users/Work/Projects/tahi-dashboard/lib/notification-links.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/__tests__/notification-links.test.ts`

**Work order:**
1. Add `howToPay?: InvoiceHowToPay | null` to the `Invoice` interface in `invoice-list.tsx:62-84` and to `InvoiceRow` in `invoice-detail.tsx:73-112`. Import the type from `@/lib/invoice-how-to-pay` rather than redeclaring the shape.
2. `invoice-detail.tsx`: in the client CTA block around `:721-754`, when `!isAdmin && !payUrl && !settled && invoice.howToPay`, render a "How to pay" card carrying bank name, account name, account number, the reference to quote, the amount (`<Money native={howToPay.amount} currency={howToPay.currency} />`), the due date and `howToPay.hint`. Tokens only, no hardcoded hex, 44px minimum touch targets, dark-mode safe.
3. `invoice-list.tsx`: in the Pay column (`:1179-1198`) and in `InvoiceMobileCard` (`:138-206`), when the row is not payable but carries `howToPay`, render a "How to pay" link to `/invoices/{id}` instead of `null`. A table cell has no room for the block itself.
4. `lib/notification-links.ts:139`: `case 'invoice': return entityId ? '/invoices/' + entityId : '/invoices'`, mirroring the team map at `:90`. Delete the now-false explanatory comment at `:128-131` and replace it with one line noting the portal branch landed in `41461250`.
5. Extend `lib/__tests__/notification-links.test.ts` with a client-map invoice deep-link case and a null-entityId fallback case.

**Tests:** the notification-links unit cases above. No new API test needed (`portal-invoice-pay-path.test.ts` already pins the payload).

**Live smoke:** as Liam through Client view on Giant Group, open `/invoices` and the September invoice. With the live invoice the Pay Now button must still resolve to the Xero hosted page (unchanged). Then, to exercise the fallback, open Tahi Test Client's Xero-rail draft-state invoice in Client view and confirm the How to pay card renders with the bank block and reference. Check at 375 and dark.

---

### S4. The org id reaches the delivery gate
**Closes:** BLOCKER 4 (email-and-notifications EMAIL-1).
**Model: opus** (delivery gating is a safety boundary; a wrong change here can mail a real client).
**Effort: 3 hours.**

**Files (exclusive):**
- `C:/Users/Work/Projects/tahi-dashboard/lib/notification-email.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/email-previews.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/request-status-effects.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/admin/messages/[source]/[id]/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/admin/requests/[id]/messages/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/messages/[source]/[id]/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/requests/[id]/messages/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/requests/route.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/__tests__/notification-email.test.ts`
- new: `C:/Users/Work/Projects/tahi-dashboard/lib/__tests__/notification-email-orgid.test.ts`

**Work order:**
1. `NotificationEmailPlan` (`lib/notification-email.ts:92-95`) gains `template: string` (kebab-case, for example `request-thread-reply`, `request-status-client`, `org-channel-message`, `studio-new-request`) and `orgId: string | null`. Make both **required**, so `tsc` names every call site rather than letting one slip through silently. That is the entire point of the fix.
2. `sendWithBackoff` (`:436-449`) passes a fifth argument to both `sendEmail` calls: `{ template: plan.template, orgId: plan.orgId }`. Nothing else in the retry path changes.
3. Each plan builder (`threadReplyEmailPlan`, `channelMessageEmailPlan`, `clientStatusEmailPlan`, `studioNewRequestEmailPlan`) takes `orgId` on its input object and sets `template` itself from a constant, so a call site cannot mistype the template name.
4. Populate `orgId` at the six production call sites: `lib/request-status-effects.ts:156` (`request.orgId`, in scope), `app/api/admin/messages/[source]/[id]/route.ts:346` and `:391` (`t.orgId`), `app/api/portal/messages/[source]/[id]/route.ts:309` and `:401` (`orgId` in scope), `app/api/admin/requests/[id]/messages/route.ts:301`, `app/api/portal/requests/[id]/messages/route.ts:161`, `app/api/portal/requests/route.ts:630`. For studio-audience plans pass the client org id anyway: the gate only widens that org's own contacts, and the suppression log stops reading `orgId: null`.
5. `lib/email-previews.ts`: pass a clearly fake preview org id constant, never a real one.

**Tests (`notification-email-orgid.test.ts`):** mock `@/lib/email-delivery` and assert `deliverEmail` receives a non-null `orgId` and a non-`unspecified` `template` for a client-audience plan; assert the retry path passes the same context on the second attempt; assert an allowlisted org id reaches `resolveOrgRecipientScope` (import the real gate, mock only Resend). Update the four existing `clientStatusEmailPlan` cases in `notification-email.test.ts` for the new required fields.

**Live smoke:** nothing is mailed to Giant Group tonight. On production as Liam, post a reply on a Tahi Test Client request thread whose contact is a `business+test@tahi.studio` alias, then read `list_email_suppressions` (or Settings > Email delivery > suppression list) and confirm the row now carries the real `template` and `orgId` instead of `unspecified` / null. That is the whole proof and it costs one message.

---

### S5. The next call on their home page is a call they can actually join
**Closes:** BLOCKER 5 (live-client-view F2), code half only. The data half is an operator step.
**Model: sonnet.**
**Effort: 1.5 hours.**

**Files (exclusive):**
- `C:/Users/Work/Projects/tahi-dashboard/app/api/portal/calls/route.ts`
- new: `C:/Users/Work/Projects/tahi-dashboard/app/api/__tests__/portal-calls-attendee-guard.test.ts`

**Work order:**
1. After the `discovery_calls` read (`:106-126`), load the caller org's contact emails once (`select email from contacts where orgId = orgId`), lowercased into a Set.
2. Drop any `discovery_calls` row where **both** are true: no attendee email matches a contact of this org, and `meetingUrl` is null. Parse `attendees` defensively inside a try/catch; a malformed JSON blob means "no match", never a throw. Rows from `scheduled_calls` (a studio-created booking) are not filtered: those exist because someone deliberately booked them.
3. Add a short comment naming the reason: an auto-classified calendar event with no client attendee and no join link is not a call the client can act on.

**Tests:** a Giant-Group-shaped row (client meetingType, org id set, null meet url, attendees containing only tahi.studio addresses) is excluded; the real "Giant group x Tahi" row (meet url present) is included; a row with a matching client attendee and no url is included; malformed `attendees` JSON does not throw and the row is excluded.

**Live smoke:** as Liam through Client view on Giant Group, `/overview` "Next call" shows "Giant group x Tahi" with a join link (after Liam has also reclassified the stray row, operator step 8; the code guard alone already removes it).

---

### S6. A4: the cross-org isolation proof
**Closes:** MAJOR 10 (isolation F2, F3, F4, F5), and is the run plan's own A4 deliverable.
**Model: opus** (tenancy).
**Effort: 4 to 5 hours.**

**Files (exclusive):**
- new: `C:/Users/Work/Projects/tahi-dashboard/e2e/tenancy-isolation.spec.ts`
- `C:/Users/Work/Projects/tahi-dashboard/e2e/helpers/invites.ts`
- `C:/Users/Work/Projects/tahi-dashboard/package.json`

**Harness fix first:** `e2e/helpers/invites.ts:12` becomes `const BASE = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3000'`. Playwright exports `PLAYWRIGHT_TEST_BASE_URL` from the active config's `baseURL`, so nothing else needs wiring. Without this the spec silently seeds the wrong D1 on the 3179 harness.

**Seed (exactly as the isolation auditor specified):** `createTestOrg` plus `mintInvite` for two orgs, A and B. Sign up two distinct `+clerk_test@example.com` Clerk test users through the real invite links, the way `e2e/onboarding-personas.spec.ts` personas 2 and 3 already do (fixed OTP via `enterTestOtpCode()`). Save each `storageState` and build one `APIRequestContext` per org session (faster and less flaky in CI than two full browser UIs). Then, through the admin bypass context, seed for **each** org: one request, one file (presign plus confirm), one conversation, one non-draft invoice, one contract, one scheduled call, so every org has a real, known, non-guessable id to attempt against the other.

**Assertions (run A against every B id, then mirrored):**
- `GET`/`PATCH` `/api/portal/requests/{id}`, and `POST` on `.../review`, `.../reads`, `.../steps`, `.../sub-requests`, `.../files`: all **404**, never 403. That is the existing "not org-scoped equals not found" convention pinned in `portal-request-projection.test.ts`.
- `GET /api/portal/messages/request/{id}`: 404. `POST` there inserts nothing (verify with an admin-side read afterwards, not by trusting the response).
- `GET /api/uploads/serve?key=<org B's real storageKey>`: 403. Same for a guessed legacy-shaped key `<orgB>/general/...-file.pdf`: 403.
- `PUT /api/uploads/proxy?key=<orgB prefix>`: 403.
- `GET /api/portal/invoices/{id}`: 404, and the list never contains the other org's invoice id.
- Id-less routes (`/api/portal/project`, `/calls`, `/team`, `/tracks`, `/files`, `/notifications`, `/announcements`, `/conversations`): assert the payload contains **none** of a denylist of Org B's known strings (org name, request id, filename, conversation id, call id). There is no `[id]` to 404 on.
- Contracts: there is no portal contracts route (confirmed, only `/api/admin/contracts/*` and `/api/public/contracts/[token]/*`). Write the case as "Org A's share token cannot read or sign Org B's contract id or signer id" against the public token route, and note in the spec header that portal-authenticated contract isolation is not applicable until a portal route exists.
- Adversarial sweep over every route above: a never-issued random UUID (expect 404, never 500), a trailing-slash variant, and `?orgId=<other org>` plus `{orgId: <other org>}` appended to every JSON body (expect no effect). That last one specifically re-proves the `isService`-gated branch in `app/api/portal/messages/_shared.ts:72-78` is unreachable from a real browser session.

**Wiring:** add `"test:e2e:tenancy": "playwright test e2e/tenancy-isolation.spec.ts"` to `package.json`. Keep the spec in its own file and rerun with `--workers=1` if flaky; budget 30 to 45 seconds for the two OTP sign-ups.

**Live smoke:** none. This one is green-in-CI or it is not done. The lead adds the STATUS.md line naming it as the tenancy proof (STATUS.md is lead-only tonight, so no slice conflicts on it).

---

### S7. Services: publish enough that the page is not hollow
**Closes:** MAJOR 8 (giant-group-data F6, services-and-plan B2-3, live-client-view F5), tier 1 only. The full plan-ladder port stays in Batch B as planned.
**Model: sonnet** for the copy draft; **the lead applies the writes** through MCP `create_service` / `update_service` (the worker is an app endpoint, so this respects the "no wrangler writes" rule).
**Effort: 1.5 hours, no repo files touched, therefore no worktree and no overlap.**

**Work order:**
1. Draft two global rows (`orgId` null, `category='service'`, `isRecurring=true`, interval month, `showInCatalog=1`, `visibility='public'`) named "Scale" and "Maintain", written in the outcome-then-bullets convention `C:/Users/Work/Projects/tahi-dashboard/lib/portal-service-view.ts` already parses: first paragraph is the outcome, `- ` lines are the includes, a `Timeline:` line is the timeline. Source the copy from two places that already exist and were already reviewed: `DEFAULT_PLAN_COPY` tag and feats in `C:/Users/Work/Projects/tahi-dashboard/lib/plan-catalog-shared.ts:43-62`, and `RUNGS.scale` / `RUNGS.maintain` (bestIf, tracks, turnaround, services) in `C:/Users/Work/Projects/tahi-dashboard/.claude/qa/svc_data_block.txt`, which Liam reviewed on 2026-09-06.
2. Pick three of the 18 imported add-on rows to flip `showInCatalog=1` on: "50 Flexible Webflow Hours (10% Discount)", "Single Custom Lottie Animation", "Free Site Audit".
3. Order path stays "Ask about this" only (the undecided default). Do not build a checkout or a request-minting order button.
4. Prices: do not publish a price on the two plan rows. Giant Group's own rate is custom, and S1 is the surface that tells them what they pay.

**Tests:** none in code (no code changes). The existing `services-org-scope.test.ts` already pins the tenancy rule.

**Live smoke:** as Liam through Client view on Giant Group, `/services` shows the two plan cards plus three add-ons, every button opens the Ask sheet, no create or price-edit control anywhere, at 375 and dark.

---

### S8. MC.7: a subset import run resolves hand-mapped clients
**Closes:** MINOR 16 (manyrequests-reimport MC7). Precondition for the A1 messages-only re-import for the other 19 clients; not a Giant Group blocker.
**Model: sonnet.**
**Effort: 1.5 hours.**

**Files (exclusive):**
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/run.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/snapshot-client.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/client.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/types.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/__tests__/snapshot-client.test.ts`
- `C:/Users/Work/Projects/tahi-dashboard/lib/import/manyrequests/__tests__/client.test.ts`

**Work order:**
1. `needsOrgList` (`run.ts:81-89`) returns true unless the selected entities are only `team` and/or `services`. Fetching the organisations list is idempotent and already happens on every full run, so this is cheap and safe.
2. Remove the dead `clients` key: `listClients` on the `ManyRequestsClient` interface, `'clients'` from `SNAPSHOT_KEYS`, and `clients` from `ManyRequestsSnapshotPayload`. `fetchImportSource` never calls it (contacts come from `listOrgMembers` per org). Update the two test files' `listClients` assertions.
3. Add the hostile-input validator cases TASKS.md MC.7 asks for: one malformed row per remaining `SNAPSHOT_KEYS` entry.

**Tests:** a messages-only entity set now plans against a hand-mapped (name-matched, unstamped) org instead of refusing with "Run the organisations entity first"; a `team`-only run still skips the org list.

**Live smoke:** on production as Liam, a **dry run** of the messages-only import against a fresh snapshot. Expected: zero new comments for Giant Group (independently confirmed: ManyRequests request 334 has `activity_total: 1`, `comments_total: 0`, unchanged since 2026-08-14), and named plans rather than refusals for the other clients. Do not apply.

---

## 3. OPERATOR STEPS FOR LIAM TONIGHT

In the order that unblocks the most. Steps 1 to 8 are safe now. Step 9 stays off until you say the word.

**1. Clerk webhook secret and endpoint.**
Cloudflare dashboard or `wrangler secret put CLERK_WEBHOOK_SECRET` on **both** the production and staging workers, value copied from Clerk Dashboard > Webhooks > Signing secret (starts `whsec_`). Then in Clerk, add endpoint `https://portal.tahi.studio/api/webhooks/clerk` subscribed to `user.created`, `user.updated`, `organizationMembership.created`, `organizationMembership.deleted`.
*Stays broken until done:* every Clerk delivery gets a 503 (`app/api/webhooks/clerk/route.ts:58-65`). Mickey and Mark are covered by the synchronous linker either way, but a colleague either of them invites later through the in-portal Clerk invite holds a valid login with no portal identity (no role, no bell, messages stamped with a raw Clerk id) until they happen to load a dashboard page; and a removed teammate's `clerkUserId` link is never cleared.

**2. Clerk organization task on sign-up.**
Clerk Dashboard > Organizations settings for this instance. If "require an organization after sign-up" (the post-sign-up organization task) is on, turn it off.
*Stays broken until done:* Mickey's first-ever sign-up asks him to name and create his own workspace before the invite token is consumed. It self-heals (the throwaway Clerk org is abandoned) but it is a confusing first screen for someone joining a workspace that already exists.

**3. Resend sending domain and From address.**
Add Resend's DNS records on tahi.studio, then set `RESEND_FROM_EMAIL` on both workers to the branded lockup, for example `Tahi Studio <hello@tahi.studio>`. Then confirm which mailbox that resolves to and that somebody reads it: `.env.local` says `dashboard@tahi.studio`, `.env.migration` says `business@tahi.studio`, and the production value is a Worker secret this audit cannot read.
*Stays broken until done:* everything leaves from the `lib/email-from.ts` default `Tahi Studio <business@tahi.studio>`, SPF and DKIM are unproven, and replies to any client email may land in a mailbox nobody watches (which matters because every thread email tells the client "reply on the thread rather than by email if you can", see section 5).

**4. Giant Group's invoice rail.**
Clients > Giant Group > Overview tab > org details card > Edit > Invoice channel = Xero > Save. (The PATCH accepts `invoiceChannel` and validates it, `app/api/admin/clients/[id]/route.ts:329-333`.)
*Stays broken until done:* their channel resolves to `stripe` off the studio default, so the bank-details fallback never builds and the next Xero invoice in the pre-approval gap reaches them with no pay button and no bank details. Also re-check `auto_generate_invoices` is not scheduled against this client while the field is unset. Worth a sweep: any other client with only Xero-sourced invoices and a null `invoice_channel` is in the same state.

**5. Invoice number backfill (still needs your approval).**
As yourself, from the dashboard: `POST /api/admin/invoices/backfill-numbers {"dryRun":true}` first, read the plan, then `{"dryRun":false}` (93 rows fill from Xero and Stripe numbers).
*Stays broken until done:* Giant Group's September invoice shows "REFERENCE E1162445" instead of `INV-0065`, so a bank transfer quoting it cannot be matched on your side, and S3's How to pay block would print the same synthetic reference.

**6. Request #243, "Create tasks for design + dev".**
It is yours, not theirs: no description, no comments, no files, created by you inside ManyRequests on 2026-08-14. Pick one: give it a real client-facing description, mark it delivered with a note, flip it `isInternal=true`, or delete it. Do it through the request detail page, not the database.
*Stays broken until done:* the first thing they see in their queue is an unexplained, unactioned open item they never asked for.

**7. Messages for clients.**
Two questions, and the second is only yours. (a) For Giant Group tonight: `set_feature_visibility({subjectType: 'organisation', subjectId: 'aa80a2d6-0494-424d-8ccc-9af524c31fa7', featureKey: 'messages', effect: 'deny'})`, or the same through the /permissions builder. One key turns off the nav entry, the mobile tab, the page and both APIs. (b) The platform-wide default: today an unrestricted client sees Messages (`lib/permissions.ts:188-189`), which reverses the earlier "hide for V1" call in commit `f29425a9`. Say which you want and the run either flips the client branch of `decideFeature` or updates the standing rule and fixes the stale comment at `components/tahi/settings/sections/plan.tsx:395-398`.
*Stays broken until done:* they get a second, separate Messages surface alongside every request thread, and until S4 lands anything they post there emails nobody.

**8. The stray calendar row.**
`update_call` on discovery call `2663a77a-a8b8-478c-9542-d6588c3ea5ab` ("N8N Content Engine"): clear `orgId` or change `meetingType` off `client`.
*Stays broken until done:* S5's guard hides it from the portal, but it is still mis-filed against Giant Group in your own calls index and will keep reappearing in any surface that does not apply the guard.

**9. THE ALLOWLIST FLIP AND THE INVITE. Both stay OFF until you say so.**
When you do say so, in this order: Settings > Email delivery (`/settings?section=emaildelivery`) > "Exempt client ids" > enter `aa80a2d6-0494-424d-8ccc-9af524c31fa7` > Save. Then Clients > Giant Group > People tab > invite Mickey Day, then Mark Ramsey.
*Until you do:* `email.allowedOrgIds` is literally `[]`, every attempt to mail `michael.day@giantgroup.com` or `mark.ramsey@giantgroup.com` is withheld before it reaches Resend and logged to `email_suppressions`, the invite panel still mints a usable copy-link with `emailed:false`, and nobody at Giant Group hears anything. That is exactly the state you asked for. Note that flipping this alone does **not** turn on thread replies, review-ready or delivered emails until S4 ships: those never carry the org id to the gate.

**10. GBP bank details (before their first Xero invoice, not necessarily tonight).**
`invoicing.bankDetails` is a single global account with no per-currency variant, so a GBP invoice's How to pay block will quote whatever account is configured. Confirm that account can receive a GBP wire, or hold S3's fallback back for GBP invoices.

---

## 4. WHAT ONLY A REAL SESSION CAN PROVE (the A5 lap)

Twenty minutes, incognito, as a real Giant Group contact (or as a plus-alias contact on Tahi Test Client if the invite is still held). Two surfaces genuinely cannot be checked any other way: the greeting resolves from the real Clerk user, and the notification inbox follows real org membership, so Client view shows Liam's name and Liam's bell no matter what. Run the phone half at 375px and toggle dark once at the end.

1. Open the invite link in incognito. Expect: Clerk sign-up, no "create an organisation" screen, no plan picker, no card form.
2. Complete sign-up. Expect: `/continue`, then the onboarding welcome, then a kickoff slot picker. Expect **no** Stripe UI at any point.
3. Pick a kickoff slot. Expect: a confirmation on screen and a confirmation email in the inbox within a minute (only if step 9 of the operator list has been done; otherwise expect a suppression row instead).
4. Land on `/overview`. Expect: "Kia ora, Mickey" (their name, not Liam's), "Your plan: Scale, £2,000/mo, 2 tracks", two lanes under "Your work in motion", and "Next call: Giant group x Tahi" with a join link.
5. Open the bell. Expect: their own notifications, empty or near-empty. If any row mentions another client, a cron, a bank balance or a lead, stop the lap and report it.
6. Submit a new request with a title, a description and one uploaded file. Expect: it appears in their list within a few seconds with the file attached.
7. From a second browser as Liam, reply on that request thread. In the client window expect: the reply visible, a bell row, and an email in the client inbox (this is the S4 proof end to end).
8. From Liam, move the request to Client review. Expect in the client window: the stepper advances, an Approve or Request changes control, a bell row and a "Ready for your review" email.
9. Approve it as the client. Expect: the status moves, the composer stays usable, and Liam's side shows the approval.
10. Open `/invoices`, then the September invoice. Expect: GBP amounts throughout, the reference reading `INV-0065` (after the backfill), and either a working Pay Now or a How to pay block with bank details. Never both missing.
11. Open `/files`. Expect: the file uploaded in step 6, downloadable. Expect no 403.
12. Open `/services`. Expect: Scale and Maintain plus three add-ons, each with an Ask about this button that opens the sheet. Expect no prices on the plan cards and no create control.
13. Open `/settings`. Expect: their own name and email, their own org name, Mark listed, and under Plan and billing the same `£2,000/mo` from step 4 with no NZD anywhere.
14. Type `/messages` into the address bar. Expect: bounced to `/requests` (if operator step 7 is done). If the inbox opens, that is the decision not yet applied.
15. Type `/tracks` and `/billing` into the address bar. Expect: `/tracks` bounces to `/requests`; `/billing` either bounces or renders with no dead "Manage Billing" button.
16. Switch the phone to dark mode and re-walk `/overview`, the request detail and the invoice. Expect: no unreadable text, no horizontal scroll, every tap target comfortable.
17. Sign out, then use "Forgot password" on the sign-in screen. Expect: a real reset email and a successful sign-in afterwards. This is the one Clerk strategy nobody has clicked through on the live build.

Anything that fails is either fixed in the same run or written into the lap report with a named owner. Zero blockers is the acceptance bar.

---

## 5. WHERE THE AUDITORS DISAGREED, OR COULD NOT VERIFY

**a. Is `/messages` supposed to be visible to clients?** The brief says hidden; the code says visible, deliberately, since commit `f29425a9` on 2026-09-06; the 2026-09-06 next-surfaces assessment says "do not build the Messages page". Three auditors flagged it, one as a bug, one as a fact-check on the brief's premise. *Settle:* Liam's call, operator step 7. Cheap either way: per-org deny is one MCP call, platform-wide is one branch in `decideFeature` plus the nav entry plus the mobile tab, which the code's own comments say must move together.

**b. Does "delete /tracks" mean the page or the surface?** One auditor read CT.18 as "remove the route and the FEATURE_TREE node". That would be wrong two ways: `/tracks` is also the studio's cross-client queue view, and `/api/portal/tracks` guards on the `tracks` feature key to power the client home widget, so removing the key risks breaking the home board. *Settle:* S1 implements the conservative reading (client branch redirects, studio branch and key stay). If Liam wants the surface gone entirely, that is a separate five-minute change plus a re-check of the home widget.

**c. Is the email-to-request intake wired to a live inbound address?** STATUS.md has said "state unknown since 2026-07-07" for two months. If it is live, a client reply by email creates a brand-new unrelated request keyed off the raw subject line, with no `In-Reply-To` or `[REQ-n]` matching and no auto-reply, so the reply is silently orphaned. Meanwhile every thread email says "reply on the thread rather than by email if you can", which implies a working fallback. *Settle:* only Liam can check whether Resend inbound routing or a Cloudflare Email Worker points at `/api/webhooks/email-intake` for tahi.studio. If live, add subject or `In-Reply-To` matching (about 1.5 days, not tonight). If not wired, soften the email copy in `emails/new-message.tsx:79-81` tonight (one line, but it belongs to no current slice, so hand it to whichever builder finishes first) and keep the STATUS.md stub note.

**d. Mobile at a locked 375px was never fully verified.** The live auditor got clean captures at roughly 540 to 740px on Overview and Request detail and found no problems, but `resize_window` repeatedly snapped back to desktop width and once produced a tiled artifact. Requests list, Invoices and Services were never seen at a true 375. *Settle:* items 10, 12 and 16 of the A5 lap, on a real phone or a locked device toolbar. No evidence of a problem, just missing coverage.

**e. The greeting and the notification inbox cannot be checked through Client view.** `app/(dashboard)/overview/page.tsx` resolves the greeting from the real Clerk user, and `app/(dashboard)/notifications/page.tsx` deliberately follows real Tahi-org membership ("clearing a real bell from a preview would be a surprise"). So Client view showed "Kia ora, Liam" and Liam's own studio inbox. Both are documented intentional behaviour, neither is evidence of a bug. *Settle:* A5 lap items 4 and 5. There is no cheaper way.

**f. "Nothing changed in ManyRequests since 7 September" is inferred, not directly queried.** `find_requests` exposes no `updated_at`. The inference rests on three consistent facts: request 334's only activity event is REQUEST_CREATED on 2026-08-14, `comments_total` is 0, and three independent search terms return the same single request with `has_more:false`. *Settle:* if a stronger guarantee is wanted, re-read `activity_total` on request 334 (currently 1) immediately before any re-import. One number, one call.

**g. Whether an unrelated client's `invoice_channel` is also null.** The Giant Group case was proven; nobody swept the other clients. *Settle:* one admin query before the next invoice cycle, folded into operator step 4.

**h. `manyrequests_list_org_services` could not run** (`MANYREQUESTS_API_TOKEN not set on this worker`, the already-known pending item). It would only have told us whether Giant Group had a named ManyRequests plan row; none of the 18 imported rows is Giant-Group-specific, so S7 publishes generic Scale and Maintain rows rather than hunting for a missing one. No decision depends on it.