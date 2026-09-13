# Design requirements: public-viewers

Group: public-viewers (audience: public, no login). Routes: `/p/proposal/[token]`, `/p/schedule/[token]`, `/p/contract/[token]`, `/p/contract/[token]/sign/[signerId]`.

Sources read: `CLAUDE.md`, `STATUS.md` (Since the last update, 2026-09-12 to 2026-09-13), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2c and 3, the four `/p/*` rows and their linked functionality rows), `docs/superpowers/plans/2026-09-13-design-review-checklist.md` (the "Public viewers" row under Studio), `TASKS.md` (Catalogue Batch C, T3.1 to T3.10, D3), the live code under `app/p/*`, `components/tahi/deliverable/*`, `app/api/public/*`, and the Claude Design project (`sales-artifacts-kit.jsx`, project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`, `ProposalViewer`, `ContractSignPage`, `ScheduleViewer` at the bottom of the file).

---

## 1. Purpose and audiences

Every route in this group is reached with no Clerk session, no organisation context, and no dashboard chrome. `app/p/layout.tsx` mounts only a `ToastProvider` and strips the dashboard's `.dark` class from `<html>` on mount so a visitor who once toggled dark mode elsewhere on tahi.studio never has that preference bleed into a document meant for an outside prospect or client. There is no sidebar, no top nav, no Messages item, nothing else reachable from these pages: the URL is the entire product.

Three document jobs:

- **Proposal** (`/p/proposal/[token]`): let a prospect read a sales pitch and decide, accept a package, decline, or ask a question, without an account.
- **Schedule** (`/p/schedule/[token]`): let a client see the committed project plan (a Gantt, risks, a RACI matrix). Read-only by design, no decision surface exists or is planned on this route (see open question).
- **Contract** (`/p/contract/[token]` and its `/sign/[signerId]` twin): let a signer read and sign a legal document with a tamper-evident hash chain, or let anyone holding a bare read link (no `signerId`) see status without taking any action.

What it must never show:

- **No dashboard chrome at all.** Not a stripped-down nav, not a Messages tab hidden per the client-portal rule, literally nothing but the document. The Messages-hidden-for-clients rule (STATUS, Batch A) does not apply here because there is no nav to hide it from.
- **No admin preview state on a public token.** `ProposalViewer`, `ScheduleViewer` and `ContractViewer` all accept a `previewProposalId` / `previewScheduleId` / `previewContractId` prop that fetches live, unpublished admin data and renders a "Preview of the live draft" pill. None of the four `page.tsx` files in this group ever pass those props, only `token`, so this state must never be reachable from a `/p/*` URL. If a design review ever sees a preview pill on a `/p/*` route, that is a defect.
- **No unpublished or mid-edit content.** Once a proposal or schedule has a `publishedSnapshot`, the public GET routes read the snapshot, never the live tables, so an admin editing a proposal never leaks a half-finished section to a link already in a client's inbox (T3.1, migration-era Phase 9 draft/publish model).
- **No other organisation's document.** The token is the only key. Every public GET route 404s (never 401/403) on a missing, revoked, or wrong-shape token, so a prober cannot learn whether a token ever existed.
- **No dead-on-arrival dark mode.** The document's own light/dark/feature slide theming is independent of the dashboard's `.dark` class and must render correctly on its own, with no dependency on any visitor's prior dashboard preference.
- **No raw browser `alert()`.** Errors must surface through the mounted `ToastProvider`.

There is no member-seat-versus-admin-seat distinction anywhere in this group: there is no auth at all. The only state variables are read-versus-sign (contract) and open-versus-decided (proposal).

---

## 2. Pages, sub pages and entry points

### `/p/proposal/[token]`

- Entry: token minted when a proposal is shared from the admin editor (`/proposals/[id]`, Share action or `EmailShareModal`).
- Cover page: title (with `{{accent}}` brand-green words), eyebrow, prepared-for/prepared-by, effective date, valid-until date.
- N data-driven section pages, each its own `PageChrome` page (light, dark, or feature theme per section): types `overview`, `about`, `terms`, `scope_shared`, `text`, `testimonial`, `value_anchor`, `process`, `differentiators`, `case_study`, `testimonial_stack`, `faq`, `guarantee`, `retainer_offer`, `founders`, `partner_badges`.
- Variants (package) page: tab strip when more than one package exists, scope checklist, animated pricing card, "compare side by side" toggle table, and the Accept / Ask a question / Decline actions.
- Decision modal: opened inline from the variants page, not a separate route. Fields: name, email, role (optional), comment (required only for a question).
- Post-accept "what happens next" timeline page: renders only once the proposal is accepted, replaces the closing CTA page.
- Closing CTA page: renders only when there are zero variants and the proposal is still open.
- Not-found state: same URL, same layout shell, renders a dead-link message instead of the document.

### `/p/schedule/[token]`

- Entry: token minted from `/schedules/[id]` admin editor Share action.
- Cover page: title, prepared-for/by, start date (or "Started" if in the past), target launch date.
- Section pages, each its own `PageChrome` page: `overview`, `gantt` (via `GanttGrid` plus a legend), `risk_register`, `raci_matrix`, `text`.
- No decision UI anywhere on this route. Pure read.
- Not-found state.

### `/p/contract/[token]` (read mode)

- Entry: token minted from `/contracts/[id]` admin editor Send action, shared with anyone (not signer-specific).
- Cover slide: contract type, name, status chip, "N of M signed" chip, sent/signed/expires metadata.
- Agreement body slide: `bodyHtml` rendered via `dangerouslySetInnerHTML`.
- Signatories slide: a card per signer (avatar initials, name, email, role pill, status pill, signature preview image once signed).
- Fine-print slide: collapsed by default, expands on tap.
- Not-found / gone states: revoked, cancelled, or expired all render distinct inline messages rather than the document.

### `/p/contract/[token]/sign/[signerId]`

- Entry: a per-signer token minted and emailed individually when the contract is sent for signature, one link per signer.
- Same slides as the read route, plus a signature-pad slide (canvas, "I am [name] and I intend to sign" checkbox, Clear, Sign and submit).
- Guard states render inline on the same page rather than as separate routes: invalid signer, signer already signed, signer removed ("skipped"), contract already fully signed by everyone else.
- Post-sign confirmation hero: renders above the agreement body once this signer has just signed, or immediately on load if the contract had already reached fully-signed before this visit.

All four routes share the one `app/p/layout.tsx` (dark-mode strip + `ToastProvider`). No further route nesting exists in this group.

---

## 3. States and variants

One line per state, per page. "N/A" means the concept genuinely does not apply to this audience (no auth exists, so there is no read-only-client-view or member-vs-admin-seat state anywhere in this group).

**`/p/proposal/[token]`**
- Loading: pulsing skeleton block, centred, before the first fetch resolves.
- Empty: not distinct from not-found; a proposal with zero sections still renders cover, variants (if any), and footer.
- Error / not found: `BrandMark` + "This proposal isn't available" + a short body line, same shell as loading.
- Decided (accepted/declined): banner above the cover, buttons on the variants page replaced by the decision message; the document stays fully readable.
- Question asked, not yet decided: blue "Question received" acknowledgement banner stays visible on the variants page; Accept/Decline/Ask remain active so the visitor can still decide.
- Expired, never decided: amber banner, Accept/Decline/Ask disabled with an explanatory line, everything else stays readable.
- 375px: package tab strip scrolls horizontally with scroll-snap and an edge mask-fade (fixed under C2); pricing card and modal stack single-column.
- 768px: no known defect.
- Dark mode: per-section `PageChrome` theme (light/dark/feature) is independent of the dashboard; a brief flash of the wrong theme is possible on first paint (residual C2 minor, post-hydration effect).

**`/p/schedule/[token]`**
- Loading: same skeleton pattern as the proposal viewer.
- Empty: N/A, same reasoning as above.
- Error / not found: same shell, schedule-specific copy.
- 375px: Gantt is still a fixed-width pinch-scroll strip below about 720px (open defect, not yet a card-stack fallback on this route specifically).
- 768px: no known defect outside the Gantt.
- Dark mode: risk-register section renders on the `dark` `PageChrome` theme; same residual flash risk as the proposal viewer, plus a named minor on `RiskRegisterSection` border hex (TASKS C2).

**`/p/contract/[token]` (read)**
- Loading: pulsing skeleton block.
- Error / not found ("isn't available"), and three further distinct inline states for revoked/cancelled/expired documents (410 from the API, rendered as status banners, not swapped for the generic not-found shell).
- Fully signed: `SignedHero` renders above the body with the audit-trail assurance block.
- 375px: signer grid collapses to one column; no known layout break, but the signature pad (sign route only) has a named rotation-misalignment risk.
- Dark mode: this route does not use the shared `PageChrome` theme system at all (see section 6); it has its own always-dark cover and always-light slide shells, so there is no dashboard-dark-mode interaction to test here, only whether the visual language matches the other two viewers.

**`/p/contract/[token]/sign/[signerId]`**
- All states above, plus: invalid signer link, already-signed-by-you, signer skipped, contract already fully signed by everyone else, each its own inline message.
- Submitting: button reads "Recording..." while the sign POST is in flight, disabled until ink and the agreement checkbox are both present.
- 375px: same as read mode, plus the named rotation risk on the signature canvas.

No print stylesheet exists for any of the four routes (see open question 5). No PWA/offline concept applies to this group.

---

## 4. Features and actions

### `/p/proposal/[token]`

**Works today**
- Publish-before-share: share snapshots content on first share only, publish re-arms after further edits, both email-send routes refuse to send an unpublished link (T3.1, C1).
- Accept / decline / question closes the loop: notifies every admin (bell plus email via `studioProposalDecisionEmailPlan`), writes a deal activity when the proposal is linked to one, and freezes the accepted variant's name and amounts from the published snapshot so a later live-table edit can never retroactively change what the client is recorded as having agreed to (migration 0098, T3.3, C3).
- Expired documents 410 on every write attempt, both lazily (server flips status on the first write after the deadline) and defensively client-side (`isProposalExpired`).
- A decided document (accepted or declined) keeps rendering and showing its decision even past expiry; only a genuinely revoked or never-shared token 404s.
- 375px package tab strip scrolls with snap points and an edge fade instead of clipping the third package (T3.5, C2).
- Per-document browser title, description, and OG/Twitter image via `generateMetadata` + `resolveProposalMetadata`, `noindex, nofollow` on every state including a fallback for invalid tokens.
- Share-view and per-section dwell analytics (`useShareViewTracking`, `useSectionDwellTracking`) feed the admin `ShareAnalyticsCard`.
- Errors surface through the mounted toast, not a raw `alert()`.

**Wrong or half-built**
- The live round trip (share, edit, verify the shared copy stayed pinned, publish, revoke, confirm 404, re-share) is still owed as a manual lap by Liam or the lead (TASKS C1).
- No automated end-to-end coverage exists yet: `e2e/public-viewers.spec.ts` and `e2e/sales-publish.spec.ts` are both still unwritten (D3, `[ ]`).
- Selecting a different package tab after already accepting is not locked out client-side today. The decided banner and post-accept timeline correctly keep pointing at the actual accepted package regardless (no data-integrity issue), but this is a real behavioural gap against the Claude Design file's `ProposalViewer`, which disables every other tab once decided ("This is the package you accepted. The others are closed.").

**Planned or missing**
- T3.9 small-fix batch: `EmailShareModal` preselect, founders-section image compression, dead `/pipeline` hrefs, em-dash metadata cleanup, the contract-search-reads-dead-table bug (shared migration, not this route specifically).
- A fresh critic re-verdict of the public-viewer section of the design file: it still carries only a Pass 1 FIX, never re-checked at Pass 2 or 3 (design-review-checklist.md).

### `/p/schedule/[token]`

**Works today**
- Same publish-before-share snapshot semantics as proposals.
- Per-document title/description/OG/noindex via `resolveScheduleMetadata`.
- Share-view and dwell analytics.
- Gantt, risk register, and RACI matrix all render through the same `PageChrome` light/dark/feature theming as the proposal viewer.

**Wrong or half-built**
- The Gantt is a fixed-width pinch-scroll strip below roughly 720px viewport width; no card-stack or narrow-mode fallback exists yet on this public route.
- Same unverified live-lap and missing-Playwright-coverage gaps as the proposal viewer.
- Two Giant Group schedules were shared before the snapshot model ever ran against them and still need a manual publish to heal (a live production data state named in TASKS C1, not a code defect).

**Planned or missing**
- No accept, decline, or question equivalent exists, and none appears in the backlog. Confirmed intentional (see open question 1), not an oversight.

### `/p/contract/[token]` (read)

**Works today**
- Live token read with correct 410s on cancelled or expired documents.
- Full signer roster with status pills and rendered signature preview images once signed.
- Collapsible fine-print block.
- Tamper-evident audit-trail copy (SHA-256 chain, one-way-hashed IP) shown once fully signed.

**Wrong or half-built**
- **Still the only public viewer off the shared deliverable kit.** `ContractViewer` hand-rolls its own `BRAND` token object, its own `BrandMark` (an `<img src="/favicon.png">` instead of the `TahiIconMark` / `TahiStudioWordmark` glyphs the other two viewers use), and its own cover/slide shell instead of `CoverPage` / `PageChrome`. A visitor who opens a proposal and then a contract from the same email thread sees two different visual systems (T3.10).
- **No per-document metadata.** `page.tsx` hardcodes the title "Contract" (and "Sign contract" on the sign route) for every document, with no `generateMetadata`, no OG image, and no description. Both other viewers in this group have this; the contract routes do not.
- **Signed-PDF download is wired on the backend but not in the UI.** `GET /api/public/contracts/[token]/signed-pdf` exists, resolves or regenerates the PDF from R2, and is gated on `status === 'signed'`. `ContractViewer` never renders a Download button or link to it anywhere on the page, so a signer who wants their own copy of the fully-executed contract has no way to get it from this page today. The catalogue's functionality table still lists "add download and admin resend action" as owed, even though the R2 persistence itself shipped separately (T3.6, C4).
- **Signer email addresses are shown in full to anyone holding a bare read link.** The Claude Design file's `ContractSignPage` includes a `maskEmail()` helper explicitly written for this: "Anyone holding a read link is anonymous... they do not get to read both signatories' email addresses off a shared page." The live `ContractViewer` shows `signer.email` unmasked regardless of mode. This is a real, if minor, information-exposure gap that the design already anticipated and the port has not yet carried over.

**Planned or missing**
- Everything under T3.10's scope: port onto the deliverable kit, mask email in read mode, add the download button, rotation-safe signature pad.

### `/p/contract/[token]/sign/[signerId]`

**Works today**
- SHA-256 hash chain per signature: folds the previous chain hash, signer id, signature image, timestamp, and a hash of the current `bodyHtml`, so tampering with either an earlier signature or the document body after signing is independently detectable (migration 0099, T3.7, C4).
- Every signature notifies the studio, not only the final one, closing the "silent partial signature" gap named in STATUS and TASKS (`notifyStudioOfContractSignature`, T3.3/T3.6, C4).
- On the final signature the fully-signed PDF render and multi-recipient email send are handed to `ctx.waitUntil` so the signer's own HTTP response is never blocked by the heavy work.
- Named guard rails for invalid signer, already-signed, skipped signer, and already-fully-signed, each with its own message rather than a generic error.

**Wrong or half-built**
- Two separate email code paths exist for the same event: C3 shipped `emails/contract-signature.tsx` (`studioContractSignatureEmailPlan`), C4 separately wired `emails/contract-partially-signed.tsx` through the sign route. Only the admin preview page still uses C3's template; TASKS explicitly flags the duplicate for retirement (owed in D2).
- Body-hash tamper anchor and "revoke resets partially-signed state" are both merged (`[~]`) but not yet re-verified live (C4).
- Same design-kit port, per-document metadata, and email-masking gaps as the read route.

**Planned or missing**
- T3.10 port, same scope as the read route.
- D3 Playwright coverage of the full send-to-sign-to-PDF-in-both-inboxes round trip, plus one live rehearsal with real inboxes before the first real client send.

---

## 5. Data and integrations

- **Tables:** `proposals`, `proposalSections`, `proposalVariants`, `proposalAcceptances`; `projectSchedules`, `scheduleSections`, `scheduleRows`; `contractDocuments`, `contractSigners`, `contractSignatures`; `organisations` (joined for display name only, never exposed as an id); `activities` (a deal activity row on proposal accept/decline/question, only when the proposal is linked to a deal); `notifications` (the studio bell).
- **API routes this group calls:** `GET /api/public/proposals/[token]`, `POST /api/public/proposals/[token]/accept`, `GET /api/public/schedules/[token]`, `GET /api/public/contracts/[token]`, `POST /api/public/contracts/[token]/sign/[signerId]`, `GET /api/public/contracts/[token]/signed-pdf`, `POST /api/public/views` (share-view tracking), `POST /api/public/section-views` (per-section dwell tracking).
- **No permission gate exists on any of the above**, by design: the token is the sole credential. Every route 404s (never 401 or 403) on a missing, malformed, or revoked token, so a prober can never confirm one ever existed. This is correct and should not change.
- **Email delivery:** Resend, via `lib/notification-email.ts` (`studioProposalDecisionEmailPlan`) and the contract signature / fully-signed templates under `emails/`, gated by the org-id allowlist (STATUS S4, MC.4). These are studio-facing notification emails, not client-facing sends, so they are not blocked by the client-email allowlist the way portal notifications are.
- **R2:** signed contract PDFs (`contractDocuments.signedStorageKey`), resolved or regenerated on demand by `lib/contract-signed-artifact.ts`.
- **Must be honest:** accepted amounts are frozen at acceptance time from the published snapshot rather than read live after the fact; expired documents 410 rather than silently continuing to accept a decision; no dead button was found on the proposal or schedule viewers. The one dead-end found in this audit is the contract read view's missing Download link (see section 4).
- **No third-party integration lives on these pages directly** (no Stripe, no Xero). The only external input is Cloudflare's `cf-connecting-ip` / `cf-ipcountry` request headers, hashed one-way for the audit trail and never stored in plain text.

---

## 6. Design system contract

- **Primitives that apply:** `components/tahi/deliverable/index.tsx` (hardcoded `BRAND` hex tokens, `AccentTitle`, `BrandMark`, `PageChrome`, `SectionHeader`, `CoverPage`, `RiskCards`, `Callout`, `LegendBar`) is the shared kit. Proposal and schedule viewers both consume it fully. The contract viewer does not consume it at all; it defines its own local `BRAND` object, its own `BrandMark`, and its own cover/slide shell.
- **Leaf radius** (`0 16px 0 16px` family) is used throughout, in both the shared kit and the contract viewer's own hand-rolled equivalents, so the radius language is consistent even where the component tree is not.
- **Dark mode is self-contained, not the dashboard's token system.** `PageChrome` exposes its own light/dark/feature palette per page via CSS custom properties (`--page-chrome-text`, `--page-chrome-card`), independent of `globals.css`, by explicit design ("self-contained because they sometimes load before token CSS," per the file's own header comment). Reviewing "dark mode" on these pages means reviewing the `dark` and `feature` `PageChrome` themes, not toggling the dashboard's `.dark` class (which is actively stripped on this route).
- **What the existing Claude Design file gets right** (bottom of `sales-artifacts-kit.jsx`): one shared `DocFrame` / `DocCover` / `DocPage` / `DocFoot` / `NotFound` / `DocLoading` grammar across all three document types, including a contract sign page (`ContractSignPage`) built on the exact same primitives as the proposal and schedule viewers, unlike the live code. It also specifies two behaviours the live build has not yet carried over: a `maskEmail()` helper for anonymous read-link visitors, and a decided-tab lockout on the proposal's package picker ("This is the package you accepted. The others are closed.").
- **What the design must change, or has not yet been re-verdicted:** the public-viewer section of the design file carries only a Pass 1 FIX verdict and has never been re-checked at Pass 2 or 3 (design-review-checklist.md, and the catalogue row for all four routes repeats the same note). A fresh critic pass is needed before or alongside the T3.10 port, specifically to (a) confirm the mobile package-tab-strip and any Gantt narrow-mode fixes already shipped in the live proposal/schedule code (C2) are reflected in the design file, and (b) decide whether `ContractSignPage` should be ported into `ContractViewer` as-is, or revised first, the way the proposals editor was flagged for a redesign before porting (AR.4).

---

## 7. Open questions for Liam

1. Should the schedule viewer ever gain a decision action (approve or flag a phase), or is read-only permanent by design? (yes or no)
2. Should the contract read link (no `signerId`) mask signer email addresses the way the Claude Design file already specifies, or is showing them in full acceptable since the link itself is only ever sent to named parties? (A: mask, B: leave as-is)
3. Should the Download-signed-PDF button on the contract viewer be available to every signer once the contract is fully signed, or only shown on the last signer's own confirmation screen? (A: everyone, B: last signer only)
4. Should the two Giant Group schedules that were shared before the snapshot model existed be manually re-published now, or left until the next real edit touches them? (yes or no, and who does it)
5. Should a print or PDF-export option exist for the proposal and schedule viewers (a client wanting an offline copy today has no button for it), or is "ask Tahi for the PDF" the intended path? (yes or no)

---

## 8. Acceptance for the design review

- At 1440 light, the proposal cover, one data section, and the variants page all read as one continuous document (leaf top-left, page number top-right, footer strip per `PageChrome`), not two different visual systems.
- At 1440 light, the contract cover uses the same brand mark and leaf-radius language as the proposal and schedule covers. Checking specifically whether the T3.10 port has landed: today it still uses a favicon `<img>` and its own gradient shell, which is a REDO if unchanged.
- At 375, the proposal's package tab strip is fully reachable by horizontal scroll with a visible edge fade, no package permanently clipped.
- At 375, the schedule's Gantt does not require pinch-zoom to read a single phase row (a card-stack or equivalent fallback is present).
- At 375, every interactive control across all four pages (Accept, Decline, Ask a question, Sign and submit, Clear, the fine-print toggle) measures at least 44px tall.
- In dark mode (a `dark` or `feature` `PageChrome` slide, not the dashboard's `.dark` class), every text element is legible with no invisible-on-invisible text, and no visible flash of the wrong theme on first paint.
- The decided and expired banners (accepted, declined, expired) are visually distinct by colour plus icon, not colour alone, and sit above the fold on both first view and a returning visit.
- The contract's signer grid does not expose a bystander's full view of another signer's email address on the read-only link, unless the design intentionally reversed that decision (cross-check against open question 2).
- No raw browser `alert()`, `confirm()`, or `prompt()` appears anywhere in the golden path on any of the four routes.
- Every one of the four routes carries an accurate, per-document browser tab title (not a generic "Contract" or "Proposal" placeholder) once the metadata work is confirmed ported to the contract routes.
