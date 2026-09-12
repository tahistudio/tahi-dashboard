# Sprint T3 re-verification and build plan (2026-09-12)

Re-verified against main at abeb9bc8 by four sonnet readers (one per artifact cluster), synthesised by one opus planner. Raw reader JSON: 2026-09-12-t3-reverify-results.json. Not in tonight's scope (Giant Group readiness comes first); pick up here when Tier 3 starts.

# Sprint T3 build plan
Planner pass over four reader reports, re-checked against today's tree at `C:\Users\Work\Projects\tahi-dashboard` (main, 4e43bd9d).

---

## 1. Drop these from TASKS.md (verdict `fixed_since`)

**T3.9 save-as-template 400** (route only 400s on a missing name or missing `fromProposalId`, and the caller always sends both; PromptDialog resets on open), **T3.9 client-detail ContractsTab data shape** (`app/(dashboard)/clients/[id]/tabs/papers.tsx` reads `expiresAt` and links to `/contracts/[id]`, landed b9b47cbd), **T3.8c no fake "sent" without RESEND_API_KEY** (`lib/email-delivery.ts` returns `success:false` and the nudges route writes `status:'failed'`, guarded by `lib/__tests__/no-resend-bypass.test.ts`).

Three more sub-claims need their wording corrected rather than dropped:
- **T3.1 schedules half is 80 percent done.** Share snapshots and revoke clears; only the email guard is missing. Rewrite as "schedules: email POST still accepts an unpublished schedule".
- **T3.3 contract half is partially done.** Final-signature emails to every party exist (`lib/contract-fully-signed-emails.ts`). Notifications rows, deal activities, and any partial-signature signal do not.
- **T3.4 third sub-claim is void.** The Light/Dark/Feature picker is wired end to end. There is nothing to hide; the effect it produces is what is broken.

---

## 2. Slices

Shared-file map, so nobody collides:

| File | Owner |
|---|---|
| `db/schema.ts`, `app/api/admin/db/migrate/route.ts`, `drizzle/migrations/` | S2 (0098), then S4 (0099), then S6 (0100). Merge in that order. |
| `lib/notification-links.ts`, `lib/notification-email.ts`, `emails/*` | S2 only. S4 imports what S2 adds. |
| `app/p/proposal/**`, `app/p/schedule/**`, `app/p/layout.tsx`, `components/tahi/deliverable/**` | S3 |
| `app/p/contract/**` | S5 (rebases on S3) |
| `app/(dashboard)/deals/**` | S6 |
| Everything else in S7 | S7 |

S1, S2, S3, S4, S6, S7 can run in six parallel worktrees today. S5 waits on S3 and S4. S8 waits on S1 to S5.

---

### S1. Publish before share (proposals to schedule parity, and the Publish button that dies)

**Closes:** T3.1 (both halves), T3.2.
**Effort:** 2 days.
**Client risk if wrong:** the top one in this sprint. A client opens the share link and reads whatever the studio is typing right now: a renamed package, a half-written scope, a price mid-edit. Then they accept it.

**Files**
- new `lib/proposal-snapshot.ts` (extract from `app/api/admin/proposals/[id]/publish/route.ts:30-97`, export `buildProposalSnapshot(database, id)` returning `{ proposal, sections, variants } | null`)
- `app/api/admin/proposals/[id]/publish/route.ts` (call the helper, behaviour unchanged, still idempotent re-snapshot)
- `app/api/admin/proposals/[id]/share/route.ts` (POST: select `publishedSnapshot` alongside `token`, snapshot only when null, write `...published` into both the rotate and no-rotate update branches, return `publishedAt`; DELETE: also null `publishedSnapshot` and `publishedAt`)
- `app/api/admin/proposals/[id]/email/route.ts` (add `publishedSnapshot` to the select at 65-79, 400 "Publish the proposal before emailing the link." next to the existing `!proposal.token` check)
- `app/api/admin/schedules/[id]/email/route.ts` (same guard; the select at 59-76 currently takes `token` only)
- `app/(dashboard)/proposals/[id]/proposal-detail.tsx` (optimistic `updatedAt` bump)
- new `app/api/__tests__/proposal-share-snapshot.test.ts`
- new `app/api/__tests__/sales-email-publish-guard.test.ts`

**Schema:** none. `publishedSnapshot` and `publishedAt` already exist on both tables.

**Order of work**
1. Extract `buildProposalSnapshot` and re-point the publish route at it. Run the suite: nothing should move.
2. Share POST. Copy the schedules shape verbatim (`app/api/admin/schedules/[id]/share/route.ts:44-91` is the reference implementation, comments and all): `const firstSnapshot = existing.publishedSnapshot ? null : await buildProposalSnapshot(database, id)`, then spread `...published` into both update branches. Never overwrite an existing snapshot: a re-share or a token rotation must not silently publish edits nobody pressed Republish on.
3. Share DELETE clears `publishedSnapshot` and `publishedAt` with the token, matching schedules 182-192.
4. Both email guards.
5. `proposal-detail.tsx`: `hasUnpublished` at 448-450 compares local `updatedAt` against `publishedAt`, and local `proposal` only refreshes through the SWR effect at 181-187. Add the same one-line optimistic bump `setProposal(prev => prev ? { ...prev, updatedAt: new Date().toISOString() } : prev)` to the success path of `patchProposal`, `patchSection` (245-265), `patchVariant` (328-338), `deleteSection` (271), `moveSection` (305), `deleteVariant` (344). Do not restructure this file: DL.1 will re-port the whole editor from Claude Design later, so keep the diff to six one-line additions.
6. Share POST returns `publishedAt` so the header button can read Publish or Republish without a refetch, the same way the schedules route already does.

**Tests** (vitest, fake-D1 harness: `vi.mock('@/lib/db')` with a thenable chain stub plus a `schema` Proxy; canonical example is `app/api/__tests__/schedule-share-snapshot.test.ts`)
- POST share on a never-published proposal writes `publishedSnapshot` and `publishedAt`, and returns `publishedAt`.
- POST share on an already-published proposal writes neither (no clobber), with and without `?rotate=1`.
- DELETE share nulls token, `publicSharedAt`, `publishedSnapshot`, `publishedAt` and sets `status:'draft'`.
- POST email with a token and a null snapshot returns 400 for both proposals and schedules; with a snapshot it proceeds.
- Playwright: `e2e/sales-publish.spec.ts` (chromium) create proposal -> edit a section -> one click Share -> open `/p/proposal/[token]` -> assert the shared text -> edit the section again -> reload the public link -> assert unchanged -> click Publish -> assert changed.

**Live smoke (production, `portal.tahi.studio`, as Liam)**
Create a throwaway proposal on Tahi Test Client. Edit a variant price. Share with one click. Open the public link in a private window and confirm the price. Edit the price again, reload the public link, confirm it did not move. Publish, reload, confirm it moved. Revoke the link, confirm 404. Re-share, confirm the link serves the current content and the header reads Republish.
Then heal the two known live rows: `.claude/backups/tahi-db-20260906T2140Z.sql:5237-5238` has two Giant Group `project_schedules` that are `status='shared'` with `published_snapshot` NULL, minted before CT.F. `POST /api/admin/schedules/<id>/publish` for each (no email, no client contact, the allowlist stays closed per MC.4).

---

### S2. The accept closes the loop, and accepts what the client saw

**Closes:** T3.3 (proposal half), T3.9 accept-validates-against-snapshot, T3.9 expiresAt enforcement (API half).
**Effort:** 2 days.
**Client risk if wrong:** a client accepts a proposal, the viewer promises "Liam replies within one business day" (`proposal-viewer.tsx:512,515,805`), and literally nothing happens anywhere: no bell row, no email, no deal activity. Second risk: the accepted price is not the price they saw. Third: an expired proposal is still acceptable at the old number.

**Files**
- `app/api/public/proposals/[token]/accept/route.ts`
- `app/api/public/proposals/[token]/route.ts` (add `expired` to the GET payload)
- `lib/notification-links.ts` (add `proposal_declined`, `proposal_question`, `contract_partially_signed` to `NotificationEventType`; `proposal_signed` already exists, reuse for accepted; no new `notificationHref` case needed if entityType stays `proposal`, otherwise add it)
- `lib/notification-email.ts` (add `studioProposalDecisionEmailPlan` and `studioContractSignatureEmailPlan`, both modelled on `studioNewRequestEmailPlan` at 712-738)
- new `emails/proposal-decision.tsx`, new `emails/contract-signature.tsx` (both on the Studio Ledger kit, `emails/_components.tsx`; the contract one is built here and consumed by S4 so the two slices never both edit `lib/notification-email.ts`)
- `db/schema.ts`, `drizzle/migrations/0098_proposal_accepted_amounts.sql`, `app/api/admin/db/migrate/route.ts`
- new `app/api/__tests__/public-proposal-accept.test.ts`
- extend `lib/__tests__/notification-links.test.ts` and `lib/__tests__/notification-email.test.ts`

**Schema: migration 0098**
```sql
ALTER TABLE proposal_acceptances ADD COLUMN accepted_variant_name text;
ALTER TABLE proposal_acceptances ADD COLUMN accepted_one_off_amount real;
ALTER TABLE proposal_acceptances ADD COLUMN accepted_monthly_amount real;
ALTER TABLE proposal_acceptances ADD COLUMN accepted_currency text;
```
`ALTER TABLE ADD COLUMN` cannot carry `IF NOT EXISTS` in SQLite; the runtime runner swallows the duplicate-column error, so re-running is safe. Any index added alongside must be `CREATE INDEX IF NOT EXISTS`. Follow the 0097 convention exactly: a `drizzle/migrations/0098_*.sql` file with the reasoning in the header comment and the wrangler apply order (staging `tahi-db-staging`, then deploy, then production `tahi-db`), plus a matching entry in the `MIGRATIONS` array in `app/api/admin/db/migrate/route.ts`. These columns are additive and nothing reads them until the deploy lands, so applying ahead of the deploy is harmless.

**Order of work**
1. Extend the select at 67-71 to `{ id, title, status, dealId, orgId, expiresAt, publishedSnapshot }`.
2. Expiry gate first, before any decision logic, mirroring the contract route (`app/api/public/contracts/[token]/sign/[signerId]/route.ts:74-79`): if `expiresAt` is in the past, update status to `'expired'` and return 410 "This proposal has expired."
3. Replace the live `proposalVariants` lookup at 78-88 with a lookup inside `JSON.parse(publishedSnapshot).variants`. If there is no snapshot (legacy row), fall back to the live table and note it in the response, do not 500. Copy the snapshot variant's name, amounts and currency into the new `proposalAcceptances` columns.
4. After the status update at 117-128, `notifyAllAdmins(database, payload)` from `lib/notifications.ts:459`. Payload shape is `{ type, title, body?, entityType, entityId, email? }` (`lib/notifications.ts:75-87`); the `email` plan is what turns a bell row into a real Resend send, so pass `studioProposalDecisionEmailPlan(...)`. Types: accepted -> `proposal_signed`, declined -> `proposal_declined`, question -> `proposal_question`.
5. If `dealId` is set, insert a `schema.activities` row with `createdById: 'system'` (the existing sentinel for unauthenticated writers, used at `app/api/admin/proposals/[id]/route.ts:139-165`), type `proposal_accepted` / `proposal_declined` / `proposal_question`. Do not auto-bump the deal stage in this slice; put the stage move behind a Liam decision (see section 4).
6. GET route: return `expired: boolean` and `status` so the viewer can render an expired state. This is the contract with S3; S3 renders it, S2 must not touch `app/p/**`.

**Tests**
- Vitest on the accept route with the fake-D1 harness: notifications insert happens on accept, decline and question; `deliverEmail` is invoked (mock `@/lib/notification-email` and `@/lib/email-delivery`); an activities row is written when `dealId` is set and skipped when it is null; accept on an expired proposal returns 410 and writes `status:'expired'`; accept with a variantId that exists live but not in the snapshot returns 400; accept records the snapshot price after the live variant price has been edited.
- Vitest on the GET route: `expired:true` when `expiresAt` is past.
- Playwright: covered in S8's end-to-end spec rather than duplicated here.

**Live smoke**
On production, with a Tahi Test Client proposal: set `expiresAt` to yesterday, load the public link, confirm the API refuses an accept (410) and the viewer shows the expired state once S3 lands. Reset the date, accept as a client in a private window, then confirm in the admin session that the bell shows the event, `business@tahi.studio` received the decision email, and the linked deal's timeline carries the activity. Recipients must stay inside `tahi.studio` (or a plus-alias); the allowlist stays closed.

---

### S3. Public viewer integrity: theme, the phone money path, honest errors, link previews

**Closes:** T3.4, T3.5 (gantt and VariantTabStrip halves), T3.9 alert-to-toast (public viewer), T3.9 public tab titles and OG (proposal and schedule).
**Effort:** 3 days.
**Client risk if wrong:** a prospect on a phone cannot select the third package, a dark-themed slide renders near-black text on near-black, a visitor who once toggled dark mode in the dashboard gets a corrupted public document, and a failed accept throws a raw browser `alert()` on the most expensive page the studio owns.

**Files**
- new `app/p/layout.tsx`
- new `lib/use-is-narrow.ts` (hoist the hook currently private at `components/tahi/schedule-section-renderers.tsx:18`; re-export from the old site to avoid touching unrelated call sites)
- `components/tahi/deliverable/index.tsx` (`SectionHeader` -> `AccentTitle` at 363 must pass the resolved theme; `--page-chrome-text` is defined at 272 and has zero consumers repo-wide)
- `components/tahi/schedule-section-renderers.tsx` (`proseStyle` 497-501 hardcodes `#1f2c1a`; `SlideShell`'s `AccentTitle` at 110; `RiskRegisterSection` and `RaciMatrixSection` hardcode `#ffffff` card backgrounds)
- `components/tahi/gantt-grid.tsx` (104-123: fixed `14rem` / `4.5rem` / week columns inside `minWidth: 64rem` in a lone `overflow-x-auto`)
- `app/p/proposal/[token]/section-blocks.tsx` (hardcoded `#1f2c1a` at 389, 393, 433, 443, 1063)
- `app/p/proposal/[token]/proposal-viewer.tsx` (`VariantTabStrip` at 836; `alert()` at 260 and 275; expired state from S2's GET payload)
- `app/p/proposal/[token]/page.tsx`, `app/p/schedule/[token]/page.tsx` (generateMetadata)
- `app/p/schedule/[token]/schedule-viewer.tsx` (only if the theme threading needs it)
- new `e2e/public-viewers.spec.ts`

**Schema:** none.

**Order of work**
1. **Theme.** Thread the resolved palette down rather than relying on inheritance: `PageChrome` already sets `--page-chrome-text` from `paletteForTheme` (index.tsx:196-224), so the cheapest correct fix is to replace every hardcoded `#1f2c1a` / `BRAND.ink` / `BRAND.body` text colour inside renderers that sit under `PageChrome` with `var(--page-chrome-text)`. Do the same for the `#ffffff` card and table backgrounds in `RiskRegisterSection` and `RaciMatrixSection` (use a second var, `--page-chrome-card`, set beside `--page-chrome-text`). Verify all three themes: light, dark, feature.
2. **`app/p/layout.tsx`.** `app/layout.tsx:78-82` injects a blocking script that adds `.dark` to `<html>` from `localStorage['tahi-theme']` on every route including `/p/*`. The public documents are print-like artefacts and must not follow a visitor's dashboard preference. Add a `/p` layout that removes the class for this subtree (a tiny client effect calling `document.documentElement.classList.remove('dark')` on mount is the minimum; a scoped light-token block on a wrapper element is the robust version, since it also survives a re-add). Mount `ToastProvider` from `components/tahi/toast.tsx` here at the same time, which pays for step 4.
3. **Gantt narrow mode.** `GanttSection` (`schedule-section-renderers.tsx:168`) renders `<GanttGrid>` with no `compact` prop, so the public viewer always gets the 64rem strip. Below 720px render a card per row: phase label, owner pill, start and end week, a mini progress bar. Copy the shape of the `RiskRegisterSection` card stack already shipped at 179-222. Keep the grid at 720px and up.
4. **VariantTabStrip.** Verified by the planner, since no reader was assigned it: the strip is `display:inline-flex`, `flexWrap:'nowrap'`, `overflow:'hidden'`, `maxWidth:'100%'` with `whiteSpace:'nowrap'` tabs at `0.625rem 1.125rem` padding. Three packages clip at 375px with no scroll affordance, so the third package is unreachable, exactly as STATUS.md says. Fix: `overflow-x:auto` with `scroll-snap-type:x mandatory` and an edge fade, and make the sliding indicator account for `scrollLeft` (it currently measures `tabRect.left - containerRect.left`, which drifts once the container scrolls) plus a `scroll` listener alongside the existing `ResizeObserver`. Alternative if the scroll feels wrong: wrap to a stacked list below 480px. Either way tabs keep their `2.75rem` min height.
5. **Errors.** Replace `alert()` at 260 and 275 with a toast (ToastProvider is now mounted) or a local dismissible inline banner on `--color-danger` / `--color-danger-bg`. Render the expired state from S2's `expired` flag: replace the accept, decline and question controls with a short "This proposal expired on <date>. Ask Liam for a fresh link." message.
6. **Metadata.** Convert both public `page.tsx` files to `generateMetadata({ params })`: real per-document title, `openGraph` title, description and image, and keep `robots: { index:false, follow:false }`. Reuse the same D1 lookup the public GET route does; do not fetch your own API over HTTP.

**Tests**
- Vitest: `PageChrome` renders `--page-chrome-text` per theme, and a tree-walk assertion that no renderer under `components/tahi/deliverable` or `app/p/proposal/[token]/section-blocks.tsx` still carries the literal `#1f2c1a` as a text colour.
- Playwright `e2e/public-viewers.spec.ts`, on both projects (`chromium` and `mobile-safari` / iPhone 13), using `primePage` and `expectNoHorizontalScroll` from `e2e/helpers.ts`:
  - with `localStorage['tahi-theme']='dark'` pre-set on the origin, open a shared schedule and a shared proposal, assert `document.documentElement` has no `dark` class and take screenshots.
  - a schedule with dark and feature sections: assert computed text colour differs from computed background (contrast check, not just a screenshot).
  - 375px: the gantt renders a card stack, not `role="table"`, and the page has no horizontal scroll.
  - 375px: all three package tabs are reachable (scroll the strip, click the third, assert the panel changes).
  - force the accept POST to 500 and assert `window.alert` was never called and a visible error appears.
  - assert `document.title` contains the real proposal title and `og:title` exists.

**Live smoke**
On production: in a normal browser, toggle the dashboard to dark, then open a shared proposal and a shared schedule link. Both must render light. On a real phone (or 375px emulation): select the third package, scroll a gantt section, trigger a failed submit (airplane mode for a second) and confirm an in-page error, not a browser alert. Paste a share link into Slack and confirm the preview card shows the document title.

---

### S4. Contract signature artefacts and integrity

**Closes:** T3.3 (contract half), T3.6, T3.7.
**Effort:** 4 days.
**Client risk if wrong:** a client signs and the studio is not told until the last signer lands; the signed PDF exists only as one fire-and-forget email attachment, so a lost email means no copy anywhere; the contract body stays editable after signatures and is not folded into the hash chain, so "this is what you signed" cannot be proven; revoking a partly signed contract leaves the old signatures chained under a document that now reads draft.

**Files**
- `app/api/public/contracts/[token]/sign/[signerId]/route.ts`
- `lib/contract-fully-signed-emails.ts`
- new `lib/contract-signed-artifact.ts` (R2 put plus key helper)
- new `app/api/admin/contracts/[id]/signed-pdf/route.ts` (GET stream or regenerate, POST resend)
- new `app/api/public/contracts/[token]/signed-pdf/route.ts` (signer download, token-scoped, only when status is `signed`; S5 links it)
- `app/api/admin/contracts/[id]/route.ts` (PATCH gate)
- `app/api/admin/contracts/[id]/send/route.ts` (DELETE revoke reset)
- `app/(dashboard)/contracts/[id]/contract-detail.tsx` (Download signed PDF, Resend signed PDF, distinct from the existing pre-sign `resendSigner` at 262-275)
- `db/schema.ts`, `drizzle/migrations/0099_contract_body_hash.sql`, `app/api/admin/db/migrate/route.ts`
- new `app/api/__tests__/contract-sign-notify.test.ts`, `contract-signed-artifact.test.ts`, `contract-body-lock.test.ts`, `contract-revoke-reset.test.ts`

**Schema: migration 0099**
```sql
ALTER TABLE contract_signatures ADD COLUMN body_hash text;
```
Same IF NOT EXISTS rule as S2: `ADD COLUMN` has no `IF NOT EXISTS` in SQLite and the runner swallows the duplicate-column error; any index must be `CREATE INDEX IF NOT EXISTS`. Nullable on purpose: existing signatures were taken before the body was hashed and must stay verifiable as "body not anchored", never back-dated into a false claim. `contract_documents.signed_storage_key` already exists (db/schema.ts:2908), so no column is needed for the PDF.

**Order of work**
1. **Notify on every signature.** The route's `doc` select at 58-66 takes `id, status, expiresAt`. Add `dealId, orgId, name, bodyHtml`. After the signer update and the document status update (152-196), for both the partial and final branches: `notifyAllAdmins` with `contract_signed` (final) or `contract_partially_signed` (partial), carrying `studioContractSignatureEmailPlan` from S2, and an `activities` insert when `dealId` is set (pattern at `app/api/admin/contracts/[id]/route.ts:104-129`, `createdById:'system'`). Today the partial branch does nothing at all.
2. **Hash anchor.** Fold `await sha256Hex(doc.bodyHtml)` into the chain input at 104-111: `sha256Hex(prev|signerId|sigUrl|now|bodyHash)`, and store `bodyHash` on the signature row. This is forward-only: say so in the code comment and in the commit body, because already-signed contracts cannot retroactively include it.
3. **Body lock.** `app/api/admin/contracts/[id]/route.ts:65-73` selects `orgId, dealId, name` into `current` and line 90 applies `bodyHtml` unconditionally. Add `status` to the select and 400 on any `bodyHtml` or `variableValues` change when status is not `draft`. Name the error so the UI can show it: "A sent contract cannot be edited. Revoke it first."
4. **Revoke actually resets.** The DELETE in `send/route.ts:72-88` resets the document only. Also set every non-pending `contractSigners` row back to `pending` (clear `signedAt`, `signatureId`), delete this contract's `contractSignatures` rows, and clear `finalHash` and `signedAt` on the document. Write the discarded signature ids to `auditLog` first: the rows are about to disappear and that is the only forensic trail left. The UI already promises this behaviour at `contract-detail.tsx:757`.
5. **Persist the PDF.** In `lib/contract-fully-signed-emails.ts`, after `buildSignedPdfBase64` succeeds (170-198) and before or alongside the send (236-244), upload to R2 and stamp the column: `(await getCloudflareContext({async:true})).env.STORAGE.put('contracts/<id>/signed.pdf', bytes, { httpMetadata: { contentType: 'application/pdf' } })` then `update(contractDocuments).set({ signedStorageKey: key })`. The binding is `STORAGE` (`cloudflare-env.d.ts:8`); `lib/blog-cover.ts:170-186` is the working precedent.
6. **Serve it.** Admin GET streams the R2 object behind `requireContractAccess`, regenerating on the fly from `bodyHtml` plus signatures when `signedStorageKey` is empty (covers every pre-fix row), `Content-Disposition: attachment`. Admin POST re-runs `sendFullySignedContractEmails`. Public GET is token-scoped and only serves when status is `signed`.
7. **Buttons.** `contract-detail.tsx` gains Download signed PDF and Resend signed PDF, visible only when status is `signed`, sitting apart from the existing signing-invite Resend so the two are not confused.

**Tests**
- Vitest with the fake-D1 harness plus a mocked `R2Bucket`: `put` is called with `contracts/<id>/signed.pdf` and `signedStorageKey` is persisted; a notifications row and an activities row are written on both a partial and the final signature; the partial branch attempts an email (mock `deliverEmail`).
- Vitest: PATCH `bodyHtml` on a `sent` contract returns 400 and on a `draft` contract succeeds.
- Vitest: revoke with 1 of 2 signers signed leaves both signers `pending`, zero `contractSignatures` for that contract, `finalHash` null, and one auditLog row naming the discarded signature ids.
- Vitest: chain verification diverges when `bodyHtml` is mutated in the DB after two signatures.
- Vitest: the admin signed-pdf GET is org-scoped and 403s for a non-permitted team member; the public one 404s unless status is `signed`.
- Playwright: covered by S8 (send -> sign -> download).

**Live smoke**
On production with two signers, both on `tahi.studio` addresses (never a client, the allowlist stays closed): send, sign as signer one, confirm the studio bell and email fire on the partial. Try to edit the body from the admin page and confirm it refuses. Sign as signer two, confirm the fully-signed email with the PDF, then Download signed PDF from `/contracts/[id]` and open it. Hit Resend signed PDF and confirm a second copy lands. On a separate draft contract, revoke after one signature and confirm both signers read pending and the document reads draft.

---

### S5. `/p/contract` onto the deliverable kit, plus a rotation-safe signature pad

**Closes:** T3.10, T3.5 (contract canvas half), T3.9 tab title and OG for `/p/contract`.
**Effort:** 2.5 days.
**Depends on:** S3 (the kit changes and `app/p/layout.tsx`) and S4 (the public signed-pdf route). Branch from main after both merge.
**Client risk if wrong:** the contract is the last thing a client sees before money moves and it is the only public viewer off the shared kit, so it visibly does not match the proposal they just read. Separately, a phone rotation mid-signature silently misaligns every subsequent stroke against the ink already drawn.

**Files**
- `app/p/contract/[token]/contract-viewer.tsx` (1433 lines)
- `app/p/contract/[token]/page.tsx`
- no changes to `components/tahi/deliverable/**` (S3 owns it; if the port needs a new export, request it in S3 before S3 merges)

**Schema:** none.

**Order of work**
1. Delete the local `BRAND` const (31-59), the local `useInView`, and the bespoke cover markup. Import `{ BRAND, BrandMark, CoverPage, PageChrome, AccentTitle, SectionHeader, Callout }` from `@/components/tahi/deliverable`, the same import the proposal viewer (31-34) and schedule viewer (19-22) use.
2. Wrap each block (contract body HTML, signer roster, signature pad, thank-you state) in `PageChrome`, following how `section-blocks.tsx` wraps proposal sections. Signing logic, the hash-chain POST and the signature payload shape are untouched: this is a chrome port.
3. Add `useSectionDwellTracking` alongside the existing `useShareViewTracking`. Contracts are the only artefact with no dwell data, so `ShareAnalyticsCard` is blank for them.
4. Signature pad rotation: the sizing effect at 745-760 runs once with `[]`, reading `getBoundingClientRect()` and applying `ctx.scale(dpr, dpr)`, while the shell (`padShell`, 1332-1342) is sized in `vw`. Add a `ResizeObserver` on the canvas that recomputes rect and dpr and reapplies `width`/`height` plus `scale`. Resizing a canvas clears its bitmap, so also reset `hasInk` and show a toast ("Screen size changed, please redraw your signature") rather than discarding ink silently. The ToastProvider is mounted by S3's `app/p/layout.tsx`.
5. `generateMetadata` with the real contract name and the same `robots` noindex the other two now carry.
6. Add the Download signed PDF link (S4's public token route) to the fully-signed state so the signer keeps a copy without depending on email.

**Tests**
- Vitest: the viewer renders `CoverPage`, `PageChrome` and `BrandMark` (component presence), not the old bespoke markup.
- Playwright, both projects: `/p/contract/[token]` at desktop and 375px, screenshots compared against `/p/proposal/[token]` for shared chrome; draw a stroke at 375x812, resize to 812x375, assert the canvas `width`/`height` attributes were recomputed to `rect * dpr` and that a fresh stroke submits successfully; assert `document.title` carries the contract name.

**Live smoke**
On a real phone: open a contract sign link, draw, rotate the device, confirm the prompt and that the redrawn signature submits and renders correctly in the admin detail. Compare the contract viewer against a proposal viewer side by side at desktop and 375px, and with the dashboard set to dark first.

---

### S6. Deals honesty (and Stalled as a flag, if Liam says build)

**Closes:** T3.8a, T3.8b, T3.8d, and the two `/pipeline` hrefs that live in deals files. Optionally MC.6.
**Effort:** 1 day if the answer is remove, 3.5 to 4 days if the answer is build. MC.6 adds 2 days.
**Client risk if wrong:** none directly, this is an internal surface. The cost is Liam's own trust: a deal shows "Nudge scheduled for Friday" and no nudge exists, an "Auto Nudges: Active" badge with no engine behind it, and a Send Nudge dialog that fails in total silence, including the allowlist 409 that pre-launch is the most likely outcome.

**Files**
- `app/(dashboard)/deals/[id]/deal-detail.tsx` (NudgeDialog 2853-2887, ActivityFormDialog 3071-3095, auto-nudge card 823-850, plus the silent catches at 2258, 2272, 2086, 2098)
- `app/(dashboard)/deals/deals-content.tsx` (badge 1393-1396, `DEFAULT_STAGES` 98, the two `/pipeline/${deal.id}` hrefs at 1256 and 1497, the em dashes in `LOST_REASONS` at 970-975 rendered at 1130)
- `app/api/admin/deals/[id]/nudges/route.ts`
- build path only: new `lib/deal-nudge-send.ts`, new `app/api/admin/cron/send-scheduled-nudges/route.ts`, new `app/api/admin/cron/auto-nudge-stalled/route.ts`, `app/api/admin/crons/route.ts` (the `CRONS` array), `.github/workflows/dashboard-crons.yml` (crons are driven from GitHub Actions, not `wrangler.json` triggers)
- MC.6 only: `db/schema.ts`, `drizzle/migrations/0100_deal_stalled_flag.sql`, `app/api/admin/db/migrate/route.ts`, `app/api/admin/deals/[id]/route.ts`, `app/api/admin/pipeline/seed/route.ts`, `app/api/admin/pipeline/stages/route.ts`, `workers/mcp-server/src/index.ts` (MCP parity, CLAUDE.md rule 14)

**Schema (MC.6 only): migration 0100**
```sql
ALTER TABLE deals ADD COLUMN stalled_at text;
CREATE INDEX IF NOT EXISTS idx_deals_stalled ON deals(stalled_at);
```
Duplicate-column error swallowed by the runner, index guarded by IF NOT EXISTS. No backfill without Liam's answer on the deals currently sitting in the Stalled stage.

**Order of work**
1. **T3.8d first, it is half a day and unblocks honest testing of everything else.** `useToast` is already imported and used in this file at 14, 302, 310-313, 330-333. Wire it into `NudgeDialog.handleSend` and `ActivityFormDialog.handleSubmit`: on `!res.ok` parse `{ error }` and toast it, keep the dialog open for a retry; on a 409 read `suppressedCount` and say "Held back by the email allowlist (n recipients)"; on a network catch toast "Network error, try again". Do the same for the four silent catches at 2258, 2272, 2086, 2098 while you are in the file.
2. **T3.8a and T3.8b: Liam decides remove or build** (see section 4). Remove is the 0.25 day each path: drop the schedule mode from `NudgeDialog` (2853, 2879-2880) and stop accepting `scheduledAt` in the POST; delete the auto-nudge `SidebarCard` and the list badge. Build is the honest path: factor the existing `deliverEmail` block out of `nudges/route.ts` into `lib/deal-nudge-send.ts`, add the two cron routes reading `dealNudges` where `status='scheduled' AND scheduledAt <= now` and stalled-and-enabled deals with a per-deal cadence guard, register both in the `CRONS` array with the right cadence text, and add them to the GitHub Actions cron workflow.
3. **`/pipeline` hrefs in this file set:** `/pipeline/${deal.id}` -> `/deals/${deal.id}` at 1256 and 1497. The page currently links to itself through a 308 redirect on every card and row click.
4. **Em dashes at 970-975**, which render in the close-as-lost dialog.
5. **MC.6, if approved:** flag column, PATCH support with a `deal_stalled_toggled` activity, replace every `deal.stageName === 'Stalled'` check (deal-detail 824, deals-content 1393) with the flag, add a badge that shows on any stage in the kanban card, the list row and the detail header, and remove Stalled from `DEFAULT_STAGES` / seed / stages defaults. Coordinate with DL.3: the Claude Design write-back has a "Stalled-as-a-flag rework" staged under `.claude/qa/stall` and its manifest warns that `sales-pipeline.jsx` is a three-way merge that keeps the shipped Stalled flag. Build the data and API layer here, take the visual from DL.4.

**Tests**
- Component test with a mocked fetch returning 409 and 500: the toast carries the server's error text and the dialog stays mounted.
- Build path, vitest on the fake-D1 harness: a scheduled nudge with `scheduledAt` in the past is sent on the next tick, a future one is left alone, a failed send writes `status:'failed'` and records suppressions; a stalled auto-nudge-enabled deal untouched for N days gets exactly one nudge per cadence window and is idempotent across repeated ticks; a paused deal is skipped.
- Remove path, vitest: the POST ignores or rejects `scheduledAt` and no scheduled row can be created.
- MC.6: migration idempotency (running twice does not error), PATCH writes one activity per transition, `DEFAULT_STAGES` contains no Stalled, a Discovery-stage deal with the flag renders the badge.
- Playwright: open Send Nudge against an address the allowlist blocks, assert a visible error and that the dialog is still open.

**Live smoke**
On production: open a deal, Send Nudge to a non-`tahi.studio` address, confirm a visible allowlist error rather than silence. Send one to `business@tahi.studio` and confirm it arrives and the timeline records it. Build path: schedule one for five minutes out and confirm the cron sends it and flips the status. Confirm no UI anywhere still promises something the engine cannot do.

---

### S7. Small fixes, and the guards that stop them coming back

**Closes:** the rest of T3.9: `/pipeline` hrefs outside deals, search reads `contract_documents`, founders image compression, em-dash metadata, EmailShareModal preselect, plus a regression test for save-as-template.
**Effort:** 1.25 days.
**Client risk if wrong:** small but real. The founders slide on a default proposal ships a 2.46 MB uncompressed JPEG to every prospect through a raw `<img>` with no `next/image` optimisation, which is the LCP image on the proposal viewer.

**Files**
- `app/api/admin/search/route.ts` (contract group query at 185-192; `/pipeline/${r.id}` deal href at 352)
- `app/(dashboard)/proposals/proposals-content.tsx:286`, `app/(dashboard)/schedules/schedules-content.tsx:214` (`/pipeline/${r.dealId}` -> `/deals/${r.dealId}`)
- `app/(dashboard)/clients/[id]/client-detail.tsx:373` (`/pipeline?new=1&orgId=` -> `/deals?new=1&orgId=`; `new=1` is read at deals-content 267)
- `app/(dashboard)/clients/[id]/tabs/deals.tsx:75,96` (75 -> `/deals?new=1&orgId=`; 96 is `/pipeline?deal=${deal.id}` and nothing reads `?deal=` on `/deals`, so make it `/deals/${deal.id}`, which is a real fix, not a rename)
- `components/tahi/email-share-modal.tsx:55-57` (add a `useEffect` on `open` that resets `selected` from `suggestions`, mirroring `components/tahi/prompt-dialog.tsx:51-57`; fix it inside the modal only, do not touch `proposal-detail.tsx`, which S1 owns)
- `public/proposals/founders-placeholder.jpg`
- the 18 `page.tsx` files carrying an em dash in `metadata.title` (`calculator`, `content-studio`, `content-studio/drafts/[id]/round-table`, `contracts/templates`, `contracts/[id]`, `financial-reports`, `leads`, `leads/[id]`, `proposals`, `proposals/[id]`, `schedules`, `schedules/templates`, `schedules/[id]`, `sitemap`, `social`, `preview/contract/[id]`, `preview/proposal/[id]`, `preview/schedule/[id]`)
- `CLAUDE.md` (the canonical page snippet that propagated the em dash)
- `app/(dashboard)/content-studio/audits/audits-content.tsx:41,55,66`, `.../drafts/[id]/round-table/round-table-detail.tsx:218-313`, `.../site-index/site-index-content.tsx:57,62,64` (nine plus six `alert()` calls, admin-only)
- new `lib/__tests__/house-rules.test.ts`

**Schema:** none.

**Order of work**
1. Search: swap `schema.contracts` for `schema.contractDocuments`. The legacy table has zero rows in production and eight live rows sit in `contract_documents`, so searching for a real contract by name returns nothing today. `id`, `name`, `status`, `orgId` all exist on the new table and the href at 372 is already `/contracts/${r.id}`, which matches. Do not drop the legacy table in this slice: `app/api/admin/danger/export/route.ts:85` still reads it.
2. The five `/pipeline` swaps plus the search href. Keep the `next.config.ts:88-89` redirect for old bookmarks.
3. EmailShareModal preselect.
4. Founders image: resize to the rendered box (about 4:5, max 1200px long edge), ship webp with a jpg fallback, target under 200 KB. Keep the raw `<img>` pattern (admin-entered external URLs need it) and only optimise the shipped default.
5. Em-dash metadata. The root layout already defines `template: '%s | Tahi Dashboard'` (`app/layout.tsx:5-9`), so the correct fix is to drop the manual suffix entirely: `title: 'Schedules'`. Update the CLAUDE.md example in the same commit or the pattern comes straight back. Scope this slice to `metadata.title` strings only; the roughly 1250 remaining hits in comments and migration descriptions are a separate sweep and need a Liam decision (section 4).
6. Content-studio `alert()` calls to `useToast`. Leave `design-system-content.tsx` alone, it is a component gallery.
7. `lib/__tests__/house-rules.test.ts`, modelled on the tree-walk in `lib/__tests__/no-resend-bypass.test.ts`: fail on a new `alert(` outside `design-system-content.tsx`, on a new em or en dash inside a `metadata.title` string, and on a literal `/pipeline` in an `href` or `router.push` outside `next.config.ts`. Fail on new violations only, with the current backlog allowlisted where a full sweep is not in scope.
8. Add the save-as-template route test the reader asked for: valid name plus `fromProposalId` returns success, missing name returns 400 "name required", neither returns 400 "fromProposalId or snapshot required".

**Live smoke**
On production: global search for a real contract name and confirm it appears and the result opens. Click a proposal's and a schedule's deal chip and confirm a direct navigation to `/deals/[id]` with no redirect hop (check the network panel). Open a client's Deals tab and click a deal row. Open the Email dialog on a proposal with contacts and confirm existing contacts are pre-checked. Load a proposal with the default founders slide and confirm the image is under 200 KB in the network panel.

---

### S8. T3.QA: the two round trips, then one live rehearsal

**Closes:** T3.QA.
**Effort:** 1 day plus the live rehearsal.
**Depends on:** S1 to S5 merged and deployed.

**Files:** new `e2e/sales-money-path.spec.ts`, extend `e2e/helpers.ts` if fixtures are needed.

**Specs**
1. Proposal path, both projects: create -> edit -> Share (one click) -> open the public link at 375px -> select the third package -> accept -> assert the admin session shows the notification and the deal timeline entry.
2. Contract path, chromium: send -> sign as signer one (assert the studio notification fired on the partial) -> sign as signer two -> assert the fully-signed state, the PDF download from both the admin detail and the public viewer, and two inboxes.

**Live rehearsal, before the first real client send**
One full round trip on production using `business@tahi.studio` and a plus-alias as the two parties: proposal shared, opened on a phone, accepted, notification and email received, deal moved or annotated; then contract sent, signed by both aliases, PDF downloaded from the dashboard. The allowlist stays closed and Giant Group receives nothing (MC.4). Record the screenshots in the commit body per CLAUDE.md rule 8 checks 4 to 7.

---

## 3. Order, and why

| Order | Slice | Days | Blocks on | Reason for the position |
|---|---|---|---|---|
| 1 | S1 publish before share | 2 | none | The client reads content nobody chose to show them. Every later slice ships on top of a link that tells the truth. |
| 2 | S2 accept closes the loop | 2 | none (logical follow-on from S1) | The client acts and the studio never hears. Also freezes the accepted price and stops accepts on expired documents. |
| 3 | S3 public viewer integrity | 3 | none | A phone client cannot select the third package, dark slides render invisible, a raw `alert()` fires on the accept flow. |
| 4 | S4 contract artefacts and integrity | 4 | none (parallel with S3) | Signing is silent until the last signer, the only PDF copy is one email, and the body stays editable after signature. |
| 5 | S5 contract viewer port | 2.5 | S3 + S4 | Visual consistency plus the rotation bug, on the last page before money moves. |
| 6 | S6 deals honesty | 1 or 4 (+2 MC.6) | Liam decision | Internal only. Real cost is Liam's trust in his own pipeline, not a client's. |
| 7 | S7 small fixes and guards | 1.25 | S6 for the deals-file hrefs | Cheap, broad, and the guard tests stop the whole class regressing. |
| 8 | S8 QA gate | 1 | S1 to S5 | The Definition of Done for the sprint. |

Wall clock with parallel worktrees: S1, S2, S3, S4, S6, S7 start together, S5 and S8 follow. Roughly 6 to 7 working days, 16 to 20 agent-days of work.

Merge order for the three shared files: S2 (migration 0098, and it owns `lib/notification-links.ts` plus `lib/notification-email.ts` and the new `emails/*` templates for both itself and S4) -> S4 (0099) -> S6 (0100, only if MC.6 is approved). If a slice merges out of order, renumber the migration and re-run the runner entry rather than reusing a number.

Standing constraints for every slice: `npm run type-check` and `npm run lint` clean, `npm run build` before pushing anything that touches a `route.ts` (Next rejects non-HTTP exports that tsc accepts), no em dashes, rem units, no single-side borders, tokens not hex outside the sidebar and the deliverable kit's own `BRAND`, and MCP parity on the worker server (`workers/mcp-server/src/index.ts`) for any new API capability. Pushes to main auto-deploy to production now; the approval gate is gone as of 2026-09-10.

---

## 4. Unverified, and what settles it

**Nobody was assigned VariantTabStrip (T3.5).** The planner checked it: `app/p/proposal/[token]/proposal-viewer.tsx:836-880`, `display:inline-flex` with `flexWrap:'nowrap'`, `overflow:'hidden'`, `maxWidth:'100%'` and `whiteSpace:'nowrap'` tabs at `0.625rem 1.125rem` padding. Three packages clip at 375px with no scroll affordance, which matches the STATUS.md claim. Settled: treat as still broken and fix in S3. One residual to watch: the sliding indicator measures `tabRect.left - containerRect.left`, so adding horizontal scroll without accounting for `scrollLeft` will leave the indicator behind.

**The two Giant Group schedules (T3.1, latent).** The reader found `status='shared'` with `published_snapshot` NULL in the 2026-09-06 backup, which means those links still fall through to live rows. Settle by querying production D1 for `SELECT id, title, status, published_snapshot IS NULL FROM project_schedules WHERE public_share_token IS NOT NULL` and then calling `POST /api/admin/schedules/<id>/publish` on any NULL row. No email is sent by that route, so it does not touch the allowlist.

**T3.8a and T3.8b need a Liam decision before S6 starts: remove or build.** Remove is half a day total and makes the UI honest immediately. Build is 3 to 4 days and gives a real scheduled-nudge sender plus a stalled-deal engine. This is a product call, not an engineering one, and S6 cannot be scoped without it. Recommendation if no answer arrives: remove now, because the sprint is about not lying to people, and re-add the engine post-cutover when Liam actually wants outbound automation running unattended.

**MC.6 needs a decision on existing data.** The deals currently sitting in the Stalled stage either migrate to `stalled_at` set plus a restored prior stage (which nothing records, so it would be a guess) or stay where they are and the flag applies going forward. Also check with the DL lane first: DL.3 stages a Stalled-as-a-flag rework at `.claude/qa/stall`, so building it blind here risks two implementations.

**T3.9 em-dash scope.** Rule 6 as written says no dashes in strings, comments or JSX text, and a scripted scan found 1309 lines across `app/`, `components/` and `lib/`. S7 fixes the 18 metadata titles plus the deals `LOST_REASONS` copy and installs a guard against new ones. Whether the remaining roughly 1250 (mostly comments and migration descriptions) get swept is a separate call: it is a large mechanical diff that touches almost every file and would conflict with every other slice in flight, so it should run alone after this sprint.

**T3.9 save-as-template 400 could not be reproduced.** Dropped as `fixed_since`. If Liam still sees it live, capture the response body: it can only be "name required" or "fromProposalId or snapshot required", and either answer points at a stale client bundle or a different entry point (the MCP create tool) rather than the route.

**Contract stage bump on proposal accept (T3.3, "optional stage bump").** S2 writes the activity but deliberately does not move the deal. Auto-moving a deal to Won on a client's click is a business rule with revenue-reporting consequences and should be Liam's explicit yes before it ships.