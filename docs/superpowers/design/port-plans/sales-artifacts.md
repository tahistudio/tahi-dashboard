# Port plan: sales-artifacts (Proposals, Contracts, Schedules, their templates, and the three public viewers)

Status: plan only, nothing built. Written 2026-09-26 for Liam's instruction "build the designs in the app following the UI/UX patterns used elsewhere; ships as ported, unchecked". Existing primitives and patterns win where the prototype differs. Docs Hub is locked and untouched by this plan.

## Sources read

- Review doc: docs/superpowers/plans/2026-09-14-design-review-for-liam.md, section "sales-artifacts" (76 page keys; first critic verdict FIX, final SHIP). The only FIX of the revision pass (schedule-risks, dead Owner and Impact selects) was resolved in the design file. There are no still-open critic FIX items for this module. Two disclosed leftovers are carried below: the RACI Add that only raised a toast (moot, the RACI editor is a Liam question and is not built) and the contract editor preview label that clipped "The signing pag" (resolved by construction in the kit slice).
- Requirements: docs/superpowers/design/requirements/studio-proposals.md, studio-contracts.md, studio-schedules.md, public-viewers.md, and DESIGN-BRIEF-2026-09-13.md.
- Design files, fetched through the claude-design MCP from project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66: previews/sales-artifacts-preview.html (the page key table, read in full), sales-artifacts.jsx (lists, create panels, template shelf; read in full), sales-artifacts-editors.jsx (proposal editor and its panes; read in full), sales-artifacts-builders.jsx (contract and schedule editors; read in full), sales-artifacts-kit-viewers.jsx (public viewers and the client papers index; read in full), sales-artifacts-shared.jsx (read in full), sales-artifacts-kit.jsx (read lines 1 to 15, 186 to 605 and 668 to 1235: band, head, table, states, builder head, fields, date input, overlays, share link, analytics, document frame, signature pad, hash row, spine, sign progress, rail, lifecycle rail, outline, preview pane, package tabs, totals, versions, comments; not read: the icon paths, pills, avatars and the gantt grid drawing), sales-artifacts-data.jsx (read the status vocabularies and the lifecycle stage builders only), sales-artifacts-editors.css (lines 1 to 289 of 537: responsive rules, rail and chips, lifecycle rail, three pane editor, outline, preview pane). sales-artifacts.css and sales-artifacts-viewers.css were not read line by line.
- Live code: app/(dashboard)/proposals/**, contracts/**, schedules/** (page, content, detail, templates), app/p/** (the three viewers and layout), app/preview/**, components/tahi/builder/index.tsx, rail/*, kpi-strip.tsx, data-table.tsx, empty-state.tsx, data-state.tsx, callout.tsx, gantt-grid.tsx, schedule-section-renderers.tsx, share-analytics-card.tsx, deliverable/index.tsx, money.tsx, the clients list and its _list folder (the house list pattern), and the API routes these pages call (admin proposals, contracts, schedules and their sub routes, admin views, engagements, public proposals, contracts, schedules), db/schema.ts for the eight artifact tables, lib/contract-signing-state.ts, lib/public-viewer-metadata.ts, and the MCP worker's list tools.

## Routes and audience

Studio only: /proposals, /proposals/[id], /proposals/templates, /contracts, /contracts/[id], /contracts/templates, /schedules, /schedules/[id], /schedules/templates. Every page.tsx already redirects clients and Client view previews and calls requirePageFeature; nothing in this plan changes a guard.

Public, no login: /p/proposal/[token], /p/schedule/[token], /p/contract/[token], /p/contract/[token]/sign/[signerId]. Admin chrome-less previews: /preview/proposal/[id], /preview/contract/[id], /preview/schedule/[id].

## Facts from the code that change what the design can honestly say

1. The contract body locks when the contract is sent, not at the first signature. PATCH /api/admin/contracts/[id] refuses bodyHtml and variableValues once status is not draft. The design's "locked from the first signature" copy is wrong for this product.
2. Revoke on a contract (DELETE /send) resets every signer to pending, deletes every signature and audit-logs what it discarded. The design's revoke copy ("the signatures already collected are kept") is false.
3. A contract can be set to signed by hand (markedSigned: status signed, finalHash null). Commits a8147d26 and b57ccaaa (today) made every surface say "Marked signed" with no date, no "0 of 2", no signed PDF. The port must keep every one of those rules.
4. Contract slots: substituteVariables leaves a missing value as the literal {{key}} in bodyHtml, and PATCH variableValues does not re-substitute. An honest Slots pane therefore fills by replacing the placeholder in bodyHtml and saving both fields together, while draft.
5. Proposal variants store scopeHtml and pricingNotesHtml (Tiptap HTML), one-off, monthly, currency, timelineScheduleId, ctaLabel, isFeatured. There are no discount, term, invoicing plan, deposit or GST-included columns, no scope line array, no comments, no version history (one publishedSnapshot), and no per-recipient links.
6. proposalAcceptances has status accepted, declined or question, with frozen accepted amounts since migration 0098 (null on older rows). Nothing records a question as answered.
7. share_view_events holds views per resourceType (proposal, contract, schedule) and resourceId; the three list routes return no view counts today. GET /api/admin/views gives per-item analytics.
8. createdById on all three artifacts is the creator's Clerk user id. There is no owner field.
9. Schedule sections PATCH accepts a data JSON, so the risk register and RACI could be edited with no backend change; that choice is a Liam question and is not built here.
10. The public schedule viewer shows no delivery progress, and projectSchedules has no column for "show progress to the client". The public schedule route 404s anything whose status is not shared (so archiving would kill the client link).
11. /api/admin/engagements/off-track is admin gated but not access scoped (it reads every org). Nothing in this plan calls it.
12. All three share routes accept ?rotate=1. POST /api/admin/contracts/[id]/email accepts signerIds (default every pending signer), subject and message, and reports per recipient through the delivery gate. POST /api/admin/schedules/templates accepts fromScheduleId; POST /api/admin/schedules accepts templateId.
13. The MCP tools list_proposals, list_contracts and list_schedules proxy the list routes, so additive list fields reach MCP with no worker change.
14. No styled single-date primitive exists in components/tahi (native type="date" inputs everywhere). No generic Dialog exists; SlideOver, ConfirmDialog, PromptDialog, Menu and Popover do.

## Page key by page key: what matches and what differs

### Proposals list (sales-artifacts.jsx ProposalsList)

- proposals: live has PageHeader, FilterBar with a status chip, DataTable in Card (title, status, org, deal, updated), row actions Open, Open public viewer, Delete, and the create SlideOver. Differs: no left rail of saved views, no headline band, no value or reading columns, no valid-until cell, no question marker, status badge only. Port: rail, band, new columns, Created by filter, Mine view.
- proposals-loading: live DataTable skeleton; band missing. Port: SkeletonKPIStrip plus SkeletonTable.
- proposals-empty: live EmptyState matches in intent; copy differs.
- proposals-filtered: live inline EmptyState matches in intent.
- proposals-error: not live (a failed read looks empty). Port: error card with Try again.

### Proposal editor (sales-artifacts-editors.jsx ProposalEditor)

- proposal (cover): live two pane builder with the nav and metadata in a right rail (local copies of the builder primitives, hardcoded status pill hex, raw date inputs). Differs: design is outline left, editor centre, live preview right, lifecycle rail under the head, styled date fields, Linked to moves into the cover pane.
- proposal-slide: live typed editors (section-editors.tsx) plus a Tiptap fallback; matches in function. Differs: card composition, theme swatches, preview beside it.
- proposal-package: live name, tagline, amounts, currency, scope and pricing HTML, CTA, featured. Differs: package tab strip, attached schedule select (the column exists, no UI today), compare table preview. The design's discount, term, invoicing plan, deposit, GST and totals need a migration and are skipped.
- proposal-decisions: live Decisions panel with frozen amounts and a mailto reply; hardcoded hex palette. Differs: card per decision with Badge tones.
- proposal-comments, proposal-versions: not live, no data. Skipped.
- proposal-share: live rail Public link (generate, copy, open, email, revoke). Differs: a full pane with the link panel, unpublished warning and a valid-until card. Per-recipient links skipped.
- proposal-reading: live ShareAnalyticsCard; matches.
- proposal-saving: live SaveIndicator; matches in intent.
- proposal-draft: live shows Share for an unshared draft; matches.
- proposal-accepted: live stays fully editable (the design's read-only lock is a Liam question and is skipped); the Accepted badge and frozen amounts match.
- proposal-declined: same as accepted.

### Contracts list (ContractsList)

- contracts: live PageHeader, FilterBar (status, type), DataTable (name, type, org, status with Marked signed, sent, expiry), LW.40 mobile cards and 44px row menus, row actions Open, Public viewer, Delete. Differs: rail, band, signing progress column, unfilled slot marker, stalled nudge, Chase and Download row actions.
- contracts-loading: DataTable skeleton; band missing.
- contracts-empty, contracts-filtered: match in intent.
- contracts-error: not live (silent empty). Port.

### Contract editor (ContractEditor)

- contract (signers): live Signers pane with per signer link, copy, resend, remove, add signer dialog, Email all pending and Customise and send in the rail. Differs: frame, partly signed strip, signed copy card inside the pane.
- contract-terms, contract-terms-draft: live Tiptap while draft, read-only when locked. Matches in function; copy and the lock rule follow the code (fact 1).
- contract-slots: not live. Port with fact 4.
- contract-audit: live Activity pane with HashRow and finalHash; matches; restyle as a timeline.
- contract-reading: not in the live editor. ShareAnalyticsCard with resourceType contract works (views are tracked). Port.
- contract-draft: matches in function.
- contract-signed: live Signed PDF rail section; matches; moves into the Signers and Audit panes.

### Schedules list (SchedulesList)

- schedules: live PageHeader, FilterBar (status), DataTable (name, status, org, deal, target launch), NewScheduleDialog. Differs: rail, band, reading column. The design's Delivery column, Off track view and nudge are list level delivery rollups (Liam question) and are skipped.
- schedules-loading, -empty, -filtered: match in intent.
- schedules-error: not live (silent empty). Port.

### Schedule editor (ScheduleEditor)

- schedule (gantt): live GanttGrid with toolbar, row editor, Linked work, delivery banner. Differs: frame, gantt gets full width with no preview, lifecycle rail with the rollup.
- schedule-row, schedule-linked: live row editor and linked work match in function; restyle, scrollIntoView on select, keep the typed draft when a save fails.
- schedule-risks, schedule-raci: live read-only PreviewOnlySection. The design's editable tables are a Liam question; keep read-only with honest copy.
- schedule-cover: live cover plus meta; the design splits Cover and Plan details; port.
- schedule-share, schedule-reading: live rail link and analytics; port into panes. The "Show live progress to the client" switch has no column and is skipped.
- schedule-draft: matches.

### Template shelf (ArtifactTemplates)

- templates, templates-loading, templates-empty, templates-preview, templates-edit: the unified three kind shelf is a Liam question (contracts Q2, schedules Q1) and is skipped. Each per kind page is brought onto the list primitives instead: proposals templates (a bespoke table today), schedules templates (a card grid without PageHeader today), contracts templates (already PageHeader, FilterBar, DataTable; small additions).

### Public proposal viewer (ProposalViewer)

- v-proposal, v-proposal-deciding, v-proposal-asking, v-proposal-declining, v-proposal-declined, v-proposal-question, v-proposal-expired, v-proposal-preview, v-proposal-loading, v-proposal-notfound: live already matches in function (publish before share, decision modal, decided, question and expired banners, 375 tab strip with scroll snap and edge fade, admin preview pill, not found, OG tags). No work beyond the item below.
- v-proposal-accepted: differs in one behaviour: after accepting, the other package tabs stay selectable live. Port the lockout.

### Public contract viewer (ContractSignPage)

- v-contract, v-contract-read, v-contract-signed, v-contract-fully, v-contract-expired, v-contract-invalid, v-contract-loading: every state exists live, including today's expired-before-pad, cancelled and marked signed truth. Differs: the viewer is the only one off the deliverable kit (own BRAND, favicon img brand mark, own cover shell), no per-document metadata, the signature pad does not survive a rotation, the read link has no "how to sign" page. Email masking and the Download button are Liam questions and are skipped.

### Public schedule viewer (ScheduleViewer)

- v-schedule-plan, v-schedule-loading, v-schedule-notfound: live matches (card stack under 720px since C2, dark slides readable). The design adds a "How to read this" page; port it.
- v-schedule (progress): the "Where we are" progress page needs a column and a public API change. Skipped.

### Client papers index (ClientPapers)

- papers-proposals, papers-contracts, papers-schedules, papers-empty, papers-loading: no live route (clients are redirected from all three studio routes; the client nav items are the B4 dead nav). Skipped, question for Liam.

## Slices

Five slices with disjoint owned files. artifact-kit merges first because proposals, contracts and schedules import it; those three then run in parallel. viewers is independent and can run at any time. Five rather than four because the shared editor frame would otherwise sit inside one artifact slice and block the other two for its whole length.

| Slice | Days | Backend | Migration | Depends on |
|---|---|---|---|---|
| artifact-kit | 2 | no | no | none |
| proposals | 4.5 | yes (additive list fields) | no | artifact-kit |
| contracts | 3.5 | yes (additive list fields) | no | artifact-kit |
| schedules | 3 | yes (additive list fields) | no | artifact-kit |
| viewers | 3 | yes (server metadata resolver, no route) | no | none |

### Slice artifact-kit

Owned files (all new unless noted): components/tahi/builder/artifact-frame.tsx, artifact-head.tsx, lifecycle-rail.tsx, artifact-outline.tsx, preview-pane.tsx, share-link-panel.tsx, components/tahi/builder/index.tsx (re-exports only), components/tahi/date-field.tsx, components/tahi/__tests__/date-field.test.tsx, components/tahi/artifact/list-cells.tsx, lib/sales-artifacts/status.ts, lib/sales-artifacts/__tests__/status.test.ts.

### Slice proposals

Owned files: app/(dashboard)/proposals/page.tsx, proposals-content.tsx, _list/* (new), [id]/page.tsx, [id]/proposal-detail.tsx, [id]/section-editors.tsx, [id]/_panes/* (new), templates/page.tsx, templates/templates-content.tsx, lib/proposal-scope-lines.ts and its test (new), app/api/admin/proposals/route.ts (GET additive), app/api/__tests__/admin-proposals-list.test.ts (new).

### Slice contracts

Owned files: app/(dashboard)/contracts/page.tsx, contracts-content.tsx, _list/* (new), [id]/page.tsx, [id]/contract-detail.tsx, [id]/_panes/* (new), templates/page.tsx, templates/templates-content.tsx, lib/contract-slots.ts and its test (new), app/api/admin/contracts/route.ts (GET additive), app/api/__tests__/admin-contracts-list.test.ts (new).

### Slice schedules

Owned files: app/(dashboard)/schedules/page.tsx, schedules-content.tsx, _list/* (new), [id]/page.tsx, [id]/schedule-detail.tsx, [id]/_panes/* (new), templates/page.tsx, templates/templates-content.tsx, components/tahi/new-schedule-dialog.tsx, app/api/admin/schedules/route.ts (GET additive), app/api/__tests__/admin-schedules-list.test.ts (new).

### Slice viewers

Owned files: app/p/contract/[token]/contract-viewer.tsx, app/p/contract/[token]/page.tsx, app/p/contract/[token]/sign/[signerId]/page.tsx, app/p/proposal/[token]/proposal-viewer.tsx, app/p/schedule/[token]/schedule-viewer.tsx, app/preview/proposal/[id]/page.tsx, app/preview/contract/[id]/page.tsx, app/preview/schedule/[id]/page.tsx, lib/public-viewer-metadata.ts, lib/__tests__/public-viewer-metadata.test.ts, new tests under app/p/contract/[token]/__tests__/.

Import contracts between slices: proposals imports ProposalSectionBlock and the PublicSection type from app/p/proposal/[token]/section-blocks.tsx read only (viewers must not change either signature, and does not own section-blocks.tsx at all); every slice imports from artifact-kit and must not edit it.

## Slice briefs

### artifact-kit

Build the shared editor family the design draws, once, so the three editors wear one frame. Follow sales-artifacts-kit.jsx BuilderHead, StatusRail, Outline, PreviewPane, ShareLink and DateInput, sales-artifacts-shared.jsx WhenCell and ReadChip, and sales-artifacts-editors.css sections THE LIFECYCLE RAIL, THE THREE PANE EDITOR, the live client view and RESPONSIVE. Preview: https://claude.ai/design/p/57bf60cf-5e6d-450f-9e2f-e25c8d12fd66?file=previews%2Fsales-artifacts-preview.html with &page=proposal, contract, schedule, proposal-share or contract-terms, plus &theme=dark and &device=phone. Existing primitives win: compose from TahiButton, Badge, Menu, SegmentedControl, Callout, EmptyState, Private, and BuilderShell, SaveIndicator and BuilderMoreMenu from components/tahi/builder/index.tsx.

1. artifact-frame.tsx: ArtifactEditorFrame { head, lifecycle?, outline, outlineToggleLabel, outlineCount?, preview?, previewable, children }. Root is BuilderShell. Under the head and the lifecycle rail, a grid of 14.5rem outline, minmax(0,1fr) main and clamp(17.5rem,23vw,24rem) preview; when the preview is closed or the current view is not previewable the grid has two columns and the preview is not rendered. On desktop each column scrolls on its own. Measure the grid with a ResizeObserver (a small hook in the same file): below 55rem the frame is one column in document flow, the outline sits behind a full width 2.75rem toggle (list icon, label, count, aria-expanded), and the preview, when previewable, sits above the main pane collapsed by default (max height 26rem, scrolls inside) behind a full width 2.75rem "See what the client sees" button. The preview is on by default above 55rem; once the user closes it, it stays closed for the session and a width change does not reopen it.
2. artifact-head.tsx: ArtifactHead { backHref, backLabel, title, onTitleCommit?, titleReadOnly?, pills, save (the SaveIndicator props), actions, moreItems }. A card with a border on all sides: a back link (chevron plus label, 44px on touch), a borderless title input that commits on blur and Enter and reverts on Escape (min-width 0, ellipsis, title attribute, aria-label "Title"), a pills row, then SaveIndicator, the actions and BuilderMoreMenu. Below 48rem the actions become a grid of two equal buttons and a 2.75rem More under the title, and the save indicator takes its own row.
3. lifecycle-rail.tsx: LifecycleRail { steps: { key, label, hint?, state: 'done' | 'current' | 'todo' | 'bad' }[], right? }. A bordered strip; each step is a 1.125rem dot (done: brand fill with a check; current: brand ring on var(--color-brand-50); bad: danger fill with an x; todo: border only) beside a bold label and a one line hint; the joins between steps are 1px high flex elements, not borders. aria-label "Status", aria-current="step" on the current step. Below 30rem hide every hint except the current or bad step's. Icon ink var(--color-text-on-dark).
4. artifact-outline.tsx: ArtifactOutline { groups: { key, label, count?, items, action?: { label, onClick } }[], active, onPick, readOnly? }, items { id, n?, icon?, label, hint?, badge?: { label, tone }, swatch?: { background, label }, menu?: { label, icon?, onClick, disabled?, danger? }[] }. Group header 0.625rem uppercase subtle with a tabular count. Rows are buttons (2.375rem, 2.75rem on touch) with a number or icon tile (brand fill when active), label and one line hint that ellipsise, an optional Badge and a decorative swatch with an aria-label; the active row gets a brand-50 wash, brand-dark ink and aria-current. The row menu is the existing Menu behind a kebab that is always visible on touch and on focus-within, never hover only. Reordering is Move up and Move down in the menu (callers supply them). The group action is a full width button with a dashed border on all four sides and a plus. An empty label reads "Untitled".
5. preview-pane.tsx: PreviewPane { label, meta?, width: 'phone' | 'desktop', onWidthChange, onOpenFull?, onClose?, children }. Header: an eye icon and the label in its own element that does not shrink, then the meta chip as the one flexible item (min-width 0, ellipsis). This resolves the critic's contract editor FIX ("The signing pag") by construction. Then a two option SegmentedControl (Phone, Desktop), an open-full icon button and a close icon button, each with aria-label, title and 44px on touch. Stage: children render at 390px or 880px wide and scale down to the stage width with a transform, the height compensated so the stage scrolls correctly (ResizeObserver on the stage and the inner node). var(--color-bg-secondary) stage, border on all sides.
6. share-link-panel.tsx: ShareLinkPanel { url, locked?, busy?, onMint, onCopy, onOpen, onRotate?, onRevoke?, mintLabel?, warning?, note? }. No link: the note and a full width "Generate public link" button (disabled while a warning is set, and the warning shown as a Callout). Live: the URL in a mono, selectable, ellipsised field with a title, then Copy, Open, Rotate (only when not locked and onRotate is given) and a quiet danger Revoke on the right (only when not locked and onRevoke is given). Locked: a lock line "Locked. The link can be read and copied but not rotated or revoked." Buttons 44px on touch.
7. index.tsx: add re-exports of the six modules. Change or remove nothing else; the live contract and schedule editors must keep compiling until their slices replace them.
8. date-field.tsx: DateField { value: string | null (YYYY-MM-DD), onChange(next: string | null), label, placeholder?, disabled?, min?, max?, clearable? }. The native date input stays the control (keyboard, picker, form semantics) but sits transparent over a face in the Input primitive's border, radius and type that reads "14 Mar 2026" (en-NZ) with a calendar icon and a chevron; an empty value shows the placeholder in subtle ink; a click calls showPicker when the browser has it; the focus ring shows on the face through :focus-within; disabled dims; h-11 md:h-9; clearable adds a 44px clear button that sends null. Test the formatter and the null path in date-field.test.tsx.
9. artifact/list-cells.tsx: WhenCell { at, settled?, settledLabel?, emptyLabel? } (short date over a relative line; warning ink under 7 days, danger when past, quiet with the settled label when settled, "Open ended" by default when null) and ReadCell { hasLink, views, viewers } ("Not sent", "Link live, unopened", "{n} views, {m} people"; no sparkline).
10. lib/sales-artifacts/status.ts with tests: PROPOSAL_STATUS (draft Draft neutral, shared Sent info, viewed Viewed warning as a display-only derivation for shared with views, accepted Accepted positive, declined Declined danger, withdrawn Withdrawn neutral, expired Expired warning) and displayProposalStatus(status, views); CONTRACT_STATUS (draft Draft neutral, sent Out to sign info, partially_signed Partly signed warning, signed Fully signed positive, expired Expired neutral, cancelled Cancelled danger) and contractStatusLabel(status, markedSigned) that returns "Marked signed"; CONTRACT_TYPE (nda NDA info, msa MSA neutral, sow SOW positive, sla SLA teal, mou MOU warning, other Doc neutral, each with its long label); SCHEDULE_STATUS (draft, shared teal, archived, plus the legacy sent, signed and completed values labelled plainly in neutral); proposalStages, contractStages and scheduleStages following propStages, conStages and schStages in sales-artifacts-data.jsx (Declined, Withdrawn, Expired, Cancelled end as bad steps; a markedSigned contract ends "Marked signed" with no date; Archived ends a schedule). Never print a date the record does not hold.

States: every component renders sensibly with empty input (no steps, no items, no url, null date). 375: toggles and head actions at 44px, no page scroll. Dark: dots, the active outline row, swatches, the URL field and the date face checked with .dark. Tokens only, rem units, no hardcoded hex, no single side borders, no em or en dashes.

Do not build: drag to reorder, the design's own Btn, Pill, Select, Input, Dialog, SlideOver, Toast or icon set, a Spine strip, any page. Do not edit components/tahi/rail/*, kpi-strip.tsx, data-table.tsx, globals.css or the design-system page.

### proposals

Follow sales-artifacts.jsx ProposalsList and NewProposalPanel, and sales-artifacts-editors.jsx ProposalEditor, CoverEditor, SectionEditor, PackageEditor, ComparePreview, PackagePreview, SharePane and DecisionsPane. Page keys: proposals, proposals-loading, proposals-empty, proposals-filtered, proposals-error, proposal, proposal-slide, proposal-package, proposal-decisions, proposal-share, proposal-reading, proposal-saving, proposal-draft, proposal-accepted, proposal-declined.

Backend first, GET only in app/api/admin/proposals/route.ts, additive: createdById; then, for the scoped item ids in chunks of 90 (the D1 bind cap pattern the schedules route uses), questionCount (acceptances with status question), views and viewers from schema.shareViewEvents where resourceType is 'proposal' (COUNT and COUNT DISTINCT sessionId), and a value: for an accepted proposal the newest accepted acceptance's frozen acceptedVariantName, acceptedOneOffAmount, acceptedMonthlyAmount, acceptedCurrency (valueBasis 'accepted'); if those are null (a pre 0098 row) the decided variant's live row (valueBasis 'decided_variant'); otherwise the featured variant, else the lowest position one ('recommended' or 'first'); null with no variants. Flat keys valueName, valueOneOff, valueMonthly, valueCurrency, valueBasis. POST, filters, scoping and ordering unchanged; nothing but HTTP verbs exported from route.ts. Vitest app/api/__tests__/admin-proposals-list.test.ts on the harness of contract-marked-signed.test.ts: frozen amounts win, the legacy fallback, featured beats first, question and view counts, a scoped member still sees only scoped rows.

List: rewrite proposals-content.tsx on the clients list pattern (app/(dashboard)/clients/client-list.tsx and its _list folder): app/(dashboard)/proposals/_list/views.ts (pure predicates, counts, sort and chips, tested in _list/__tests__/views.test.ts), rail.tsx (RailViewItem, RailGroupLabel, RailSelect, SaveDefaultControl; the same component with touch for the sheet), use-rail-state.ts (useUserPreference under proposals.*), mobile-card.tsx.
- PageHeader "Proposals", subtitle "Priced work, sent as a link, answered in the open." Actions Templates (secondary link to /proposals/templates) and New proposal (primary). The Refresh button goes (SWR revalidates; the error state carries Try again).
- KPIStrip desktopCols 4 from the loaded rows (use components/tahi/headline-band.tsx instead only if another module has already landed it on main; do not create it here). Out with clients (lead, Send icon): live means status shared and not past expiresAt; value is the summed value when every live row shares one currency (Money native with that currency, sensitive), otherwise "{n} proposals" with sub "Mixed currencies"; sub "{n} live, {m} opened"; value "Nothing out" and sub "Every proposal is decided or still a draft" when none. Questions in (HelpCircle, warning tone above zero): questionCount summed over live rows, sub "On proposals still open. Reply from the Decisions pane." or "No open proposal has a question". It is not "Waiting on you": nothing records a question as answered. Accepted (CheckCircle, positive): count, and the summed frozen value when one currency; sub "{org} most recently" or "None yet". Next to expire (Clock, danger under 7 days): soonest future expiresAt among live rows, sub "{org}, {relative}", or "None dated".
- RailLayout views: All proposals, Out to read (live), Has a question (live with questionCount above zero), Drafts, Accepted, Declined, Closed (expired, withdrawn, or shared past expiresAt), Mine (createdById equals the signed in Clerk user id from useUser, as team-content.tsx reads it). Filters: Client (orgs present in the rows), Created by (team members from /api/admin/team whose clerkUserId appears in createdById, unknown ids grouped as "Someone no longer on the team"; hide the filter if that read is refused). Sort: Last edited, Value, Valid until, Reading, Client, with the design's direction labels. Search: title, org name, prepared for. Chips with buildRailChips, Clear filters, Save as default, count "n proposals".
- DataTable in Card, density compact, row click to /proposals/[id]. Columns: Proposal (an org initial tile in a leaf-sm wrapper, the title in Private, sub "for {preparedFor}" and the org name, a small question chip when live with questions), Value (Money native sensitive, "{package}, accepted" or ", recommended"; "No figure" when null), Status (Badge from displayProposalStatus), Reading (ReadCell), Valid until (WhenCell; settled for accepted, declined, withdrawn with the design's settled labels). Row actions: Open, Open the client view (with a token, /p/proposal/{token} in a new tab), Delete (ConfirmDialog, "Every slide, package and recorded decision goes with it. If the client has the link, it stops working."). mobileCard per the design card with every control at 44px.
- New proposal SlideOver (keep CreateProposalSlideOver's POST): Title (required, hint "The client sees this on the cover"), Client (SearchableSelect over /api/admin/clients, "No client yet" allowed), a pick grid of Blank ("A cover, one slide, one package. Build the rest yourself.") and each template (name, description, slide and package counts from the snapshot when the list returns it, otherwise no counts, never "used N times"); a picked template shows "What lands in the deck" (slide titles and package names). Primary "Create blank" or "Create from {name}" POSTs { title, orgId, templateId } and routes to the new id. Icon tiles radius var(--radius-leaf-sm).
- States: loading (SkeletonKPIStrip, SkeletonTable, RailLayout loading); empty (EmptyState full, "No proposals yet", "Write one and send it as a link. Up to three packages, a price the client can compare, and an Accept button that tells you the moment they press it.", CTA New proposal); filtered (inline EmptyState "Nothing matches those filters" with the design's search or view wording, Clear filters); hard error with no data (Card with an inline EmptyState, alert icon, "Could not load proposals", "The list request failed. Nothing has been lost.", Try again; RailLayout countOverride "Could not load"; no band); stale error with rows in hand (the warning strip client-list.tsx uses); populated.

Editor: rebuild proposal-detail.tsx on ArtifactEditorFrame, split into app/(dashboard)/proposals/[id]/_panes/ (cover-pane, section-pane, package-pane, decisions-pane, share-pane, reading-pane, add-slide-panel, proposal-preview, outline). Keep every live data flow: the SWR reads, patchProposal and its updatedAt bump that re-arms Publish, save on blur and optimistic state, section and variant CRUD and reorder, publish, share (?rotate=1 for Rotate), revoke, EmailShareModal with the org contacts, Save as template (PromptDialog, fromProposalId), Delete (ConfirmDialog, back to /proposals), LinkedToPanel. Delete the local copies of SaveIndicator, BuilderMoreMenu, BuilderNavGroup, BuilderNavItem, RailSection, FieldGroup and statusPill and every hardcoded hex; statuses and decisions use Badge tones; the slide theme swatches read BRAND from components/tahi/deliverable, the document palette they stand for.
- Head: back "Proposals"; title (PATCH title); pills: status Badge, "Unpublished edits" warning when shared and edited since publish (the live rule), "Link matches this draft" teal when shared with nothing unpublished, an open question count Badge. Actions: Publish (shared with unpublished edits), Share (no token; opens the Sharing pane), Email the link (token and nothing unpublished; EmailShareModal), Full preview (/preview/proposal/{id} in a new tab). More: Save as a template, Delete proposal.
- LifecycleRail from proposalStages with views from /api/admin/views?resourceType=proposal&resourceId={id}; right side "Published {date}" when publishedAt is set.
- Outline: Slides (count; Cover fixed as 01, hint "For {preparedFor}" or "Title, dates, who it is for"; each section numbered from 02 with its type label as the hint and a swatch for dark and feature slides; menu Move up, Move down, Duplicate (POST a section with the same type, title plus " copy", subtitle, data and theme, then position it under the source), Remove slide (ConfirmDialog)); action "Add a slide" opens add-slide-panel, a SlideOver holding the live Common and Other groups as the design's type grid. Packages (count; each with a price hint and an Accepted or Recommended Badge; menu Recommend this one, Move up, Move down, Duplicate (POST a copy, not featured), Remove package (refuse the last one with a toast)); action "Add a package". Answers: Decisions (badge = acceptance count), Sharing ("Link is live" or "No link yet"), Reading ("{n} views" or "No views yet").
- Cover pane: heading "Slide 01, Cover" with a one line hint, a Card with Eyebrow (subtitle), Title, Prepared for, Prepared by, Effective (DateField), Valid until (DateField clearable, placeholder "Open ended", hint "Past this date the link stops accepting answers") and the live cover theme control; then a "Linked to" Card with LinkedToPanel (org and deal). This is where the old rail's Linked to and Cover meta go.
- Section pane: a Card with Title, Eyebrow (subtitle) and the three slide theme swatch buttons (aria-pressed); then the live typed editors from section-editors.tsx inside titled Cards (restyle only: tokens, rem, 44px on touch), and TiptapDocEditor for untyped sections (not the design's textarea and fake toolbar).
- Package pane: a package tab strip (role tablist; name, price meta, Badge; an Add a package tab) above a heading with an Accepted Badge when decided. Cards: identity (Name, Button label, Tagline, a Recommend this package switch); Price (One off, Monthly, Currency, Attached schedule select over /api/admin/schedules?orgId={orgId} writing timelineScheduleId, Pricing notes as TiptapDocEditor on pricingNotesHtml); What is included (TiptapDocEditor on scopeHtml, hint "Each bullet becomes a tick in the compare table"); The compare table when there is more than one package (rows are the union of bullets across packages, a tick or "not included" per package, and a price row) built on a new lib/proposal-scope-lines.ts (scopeLinesFromHtml, the same li extraction VariantCompareTable uses in the public viewer, with tests).
- Decisions pane: inline EmptyState "Nothing back yet" before any acceptance; otherwise one Card per acceptance, newest first: Badge (Accepted positive, Declined danger, Question info), the package name, the stamp, the comment as a quote, for accepted the frozen amount line ("Frozen at {amount}, the figure on the page when they pressed accept. Editing the package now cannot change it."), and a footer with name, role and email in Private and, for a question, a Reply mailto button.
- Sharing pane: a warning Callout when shared with unpublished edits ("The link is still serving the last published version. Publish before you send the address. Publishing swaps the same link and emails nobody."); a Card with ShareLinkPanel (mint is the live share POST, rotate is ?rotate=1, revoke is a ConfirmDialog: "The client's link stops working straight away and the published snapshot is cleared, so nobody can be served an old version by accident. You can share again any time.") and an Email the link button; a Valid until Card stating the date or "Open ended" and what happens after it (answers are refused).
- Reading pane: ShareAnalyticsCard resourceType proposal once shared; inline EmptyState "Nobody has opened this link yet" before.
- Preview: cover uses the deliverable CoverPage with the working copy; a section renders ProposalSectionBlock (app/p/proposal/[token]/section-blocks.tsx, read only) inside PageChrome with its theme; a package renders a light PageChrome page with the name, tagline, scope ticks, one off and monthly price and the CTA label (no totals). Labels "The cover", "Slide 0N", "The package"; meta "Draft", "Live" or "Not shared". Previewable on cover, sections and packages only.
- Titles: "Proposals - Tahi Dashboard", "Proposal - Tahi Dashboard", "Proposal templates - Tahi Dashboard". Keep getViewAudience and requirePageFeature('proposals').

Templates: templates-content.tsx gets PageHeader "Proposal templates" with a back link to Proposals and the subtitle "Save a proposal's slides and packages once. Start the next one from here."; DataTable in Card (Name with description, slide and package counts from the snapshot when present, Updated) with the live actions New proposal from this, Preview (in a SlideOver), Rename (PromptDialog), Delete (ConfirmDialog); mobileCard; loading SkeletonTable; empty "No templates yet", "Open any proposal and choose Save as a template from the More menu."; an error state with Try again (a failed read looks empty today).

375 and dark on all three routes: no horizontal page scroll (tables scroll inside their Card, the editor stacks through the frame), 44px targets on touch, tokens only, Private on titles, names, emails and money, rem units, no single side borders, and remove every em and en dash in the owned files (16 in proposal-detail.tsx, 6 in proposals-content.tsx, the page titles).

Do not build: Withdraw, the read-only lock after a decision, Draft the contract, Duplicate for another client, the Comments and Versions panes and their outline rows, per-recipient links, expiry reminders, discount, term, invoicing plan, deposit, GST and totals, the sparkline, an Owner filter, drag to reorder.

### contracts

Follow sales-artifacts.jsx ContractsList and NewContractPanel, sales-artifacts-builders.jsx ContractEditor, ContractBody, ContractVars, SignersPane, AddSignerDialog and AuditPane, and the kit's SignProgress. Page keys: contracts, contracts-loading, contracts-empty, contracts-filtered, contracts-error, contract, contract-terms, contract-terms-draft, contract-slots, contract-audit, contract-reading, contract-draft, contract-signed.

Two code truths win over the design copy everywhere: the body locks when the contract is sent, not at the first signature, and Revoke resets every signer and deletes every signature. Every markedSigned rule from lib/contract-signing-state.ts and commits a8147d26 and b57ccaaa stays: "Marked signed", no signing date, no "0 of 2", no signed PDF download or resend.

Backend, GET only in app/api/admin/contracts/route.ts, additive: createdById; unfilledSlots (distinct {{key}} placeholders left in bodyHtml, matched with substituteVariables' regex; select bodyHtml for the count and leave it out of the payload); firstPendingSignerName (the lowest position pending signer, null for markedSigned and terminal rows); views and viewers (resourceType 'contract'), chunked by 90. markedSigned, signedCount and totalSigners unchanged. Vitest app/api/__tests__/admin-contracts-list.test.ts; contract-marked-signed.test.ts stays green.

New lib/contract-slots.ts with tests: slotKeys(bodyHtml) (distinct keys in order), fillSlots(bodyHtml, values) (replace each placeholder whose value is non-empty with the HTML-escaped value, the route's escape, and leave the rest), slotLabel(key).

List on the clients pattern with app/(dashboard)/contracts/_list/ (views.ts plus test, rail.tsx, use-rail-state.ts, mobile-card.tsx, sign-progress.tsx).
- PageHeader "Contracts", "Terms, signatures and the hash chain that proves them."; Templates, New contract.
- KPIStrip: Signatures due (lead, PenLine): totalSigners minus signedCount over sent and partially_signed rows that are not past expiry and not markedSigned; sub "across {n} contracts, oldest out {d} days" or "Nothing is waiting on a signature". Slots unfilled (Hash, warning above zero): drafts with unfilledSlots; sub "{name} has {k} blanks" or "Every draft is filled in". Fully signed (CheckCircle, positive): signed rows; sub "{m} marked by hand" when any, else "On the record with a hash chain behind each one". Next to expire (Clock, danger under 7 days): soonest future expiresAt among unsigned live rows.
- Nudge (Callout warning, only with a populated list): the longest stalled row (sent or partially_signed, sent more than 7 days ago, pending, not past expiry): "{name} has been out for signature for {d} days, waiting on {firstPendingSignerName}." Action "Send a reminder" POSTs /api/admin/contracts/{id}/email with no signerIds and reports each recipient's result (sent, or held back by the delivery gate), never a blanket "Sent".
- Rail views: All contracts, Out to sign, Partly signed, Chase list (out more than 7 days), Unfilled slots, Drafts, Fully signed, Closed (expired, cancelled, or past expiry by isContractPastExpiry), Mine. Filters Client and Type. Sort Last edited, Sent, Expiry, Client. Search name, org and type label.
- Columns: Contract (name in Private; "{org}, sent {date}" or ", not sent"; a Hash chip with the count on drafts), Type (Badge), Signing (sign-progress.tsx: "{signed} of {total}" over "waiting on {first name}", "fully signed", "Marked signed", "No signers yet", "lapsed before it was signed" or "cancelled, nobody is chasing this"; no avatars), Status (Badge with contractStatusLabel), Expires (WhenCell, settled for signed, cancelled, expired). Row actions: Open, Open the client view (token), Chase the pending signer (pending, not terminal, not markedSigned; the nudge's POST), Download the signed PDF (signed and not markedSigned; GET /api/admin/contracts/{id}/signed-pdf), Delete (live copy). Keep the LW.40 mobile card behaviour, restyled to the design card.
- New contract SlideOver (keep CreateContractSlideOver's POST): Name, Client, Terms (a template select plus "Write custom terms", which keeps the live TiptapDocEditor body), and for a template, "Fill the slots": one Input per variableDefs entry (the def's label or slotLabel), "{filled} of {total} filled", and the note "Anything left blank reaches the signer as a blank line. Fill it here or on the Slots pane before you send." POST includes variableValues. Primary "Create and edit".
- States: loading skeleton band and table; empty "No contracts yet", "Write terms once as a template, then raise a contract per client. Signing happens on a link, in the browser, with a hash chain behind it.", CTA New contract; filtered; hard error "Could not load contracts" with Try again (replaces today's silent empty); stale error strip; populated.

Editor on ArtifactEditorFrame with app/(dashboard)/contracts/[id]/_panes/ (terms-pane, slots-pane, signers-pane, audit-pane, reading-pane, share-pane, details-pane, signing-preview, add-signer-dialog). Keep every live flow: SWR reads, title and body saves, signer add, remove, resend and copy link, send and email (POST email mints the token and flips to sent through the delivery gate), EmailShareModal "Customise and send", revoke, rotate (as live), signed PDF download and resend (POST signed-pdf), Save as template, Delete, LinkedToPanel (org, deal, proposal), HashRow and every markedSigned branch.
- Head: back "Contracts"; title; pills type Badge, status Badge, a lock Badge ("Terms locked while out for signature" for sent and partially_signed, "Locked" for signed, cancelled, expired), "{n} slots unfilled" warning on drafts. Actions: Send for signature (draft with at least one signer and no unfilled slot; otherwise disabled with the reason), Chase {n} (sent or partially_signed with pending, not markedSigned), Signed PDF (signed, not markedSigned), Preview (/preview/contract/{id}). More: Save these terms as a template, Delete contract.
- LifecycleRail from contractStages; right side the type short label and an Audit trail button.
- Outline: The document (Terms: "{k} clauses" or "Locked"; Slots: "{n} still empty" or "All filled" with a count badge; Signers: "{s} of {t} signed" or "Nobody added yet" with a pending badge; Audit trail; Reading). Sharing and detail (Sharing: "Link is live" or "No link yet"; Details: "{type}, {org}").
- Terms pane: draft is TiptapDocEditor on bodyHtml with the hint "Anything in double braces is a slot. Fill slots on the Slots pane."; sent or partially_signed is the read-only render plus a Callout "The terms are locked while the contract is out, because every signature is hashed against these exact words. To change the wording, revoke the link, which resets every signature collected so far and records what was discarded."; signed, cancelled and expired are the read-only render with a Locked Badge.
- Slots pane: slotKeys(bodyHtml) with the current value from variableValues. Draft: one Input per slot; save runs fillSlots and PATCHes { bodyHtml, variableValues } together; a warning Callout while any slot is empty. After send: the filled values read only. No placeholders: inline EmptyState "No slots in these terms".
- Signers pane: heading with Add a signer (hidden when locked); a partly signed strip (clock icon, "Partly signed, {s} of {t}.", "Waiting on {names}.", ProgressBar) when some have signed; the live SignerCard content restyled (Avatar in a leaf wrapper, name and email in Private, status Badge, side label, the per signer link with Copy, Email (POST email { signerIds: [id] }) and Remove for pending signers while unlocked); EmptyState "No signers yet", "Add at least one from each side, Tahi and the client, before you send it.", CTA Add a signer; a signed copy Card (signed, not markedSigned) with Download and Resend the copy; a Send for signature Card while unlocked with pending signers: "Email all pending ({n})" primary and "Customise and send" (EmailShareModal), disabled with the empty slot warning. Add a signer keeps the live dialog, restyled (Side: Tahi Studio, Client, Other; Full legal name; Email).
- Audit trail pane: the live ActivityPane events as a vertical timeline (dot tones by tokens), HashRow per signature, a "Waiting on {n} signatures" item, and the Document fingerprint Card with finalHash and the signed file; the markedSigned branch exactly as live.
- Reading pane: ShareAnalyticsCard resourceType contract; EmptyState before any link.
- Sharing pane: ShareLinkPanel (locked for signed, cancelled, expired; the empty slot warning), revoke ConfirmDialog with the live consequence copy.
- Details pane: Type select and Expires DateField (disabled when locked, live PATCH), LinkedToPanel, read-only Created, Sent, Signed ("Marked signed, no date on record" for markedSigned).
- Preview (signing-preview.tsx): a light PageChrome page with the type eyebrow and the contract name, bodyHtml rendered with each remaining placeholder as a blank underline span (aria-label "blank, {slot}"), never the variable name. Label "The signing page", meta "{n} blanks" or "All filled". Previewable on Terms, Slots, Signers and Details.
- Titles "Contracts - Tahi Dashboard", "Contract - Tahi Dashboard", "Contract templates - Tahi Dashboard".

Templates: keep PageHeader, FilterBar, DataTable and the SlideOver editor; add a back link, a type Badge and a description that do not truncate at 1440, a Slots column (variableDefs length), mobileCard, an error state with Try again, and the hint "Anything in double braces becomes a slot you fill when you raise a contract" in the SlideOver.

375 and dark as in proposals; remove the em dashes (7 in contracts-content.tsx, 1 in contract-detail.tsx, 1 in templates-content.tsx, the page titles).

Do not build: Cancel contract, the template isDefault toggle, the inline subject and covering note card (EmailShareModal does it), the Spine, signer avatars in the list, a Governing law line, any change to the lock rule, the unified template shelf, template usage counts.

### schedules

Follow sales-artifacts.jsx SchedulesList and its New schedule panel, and sales-artifacts-builders.jsx ScheduleEditor, GanttEditor and RowEditor. Page keys: schedules, schedules-loading, schedules-empty, schedules-filtered, schedules-error, schedule, schedule-row, schedule-linked, schedule-cover, schedule-share, schedule-reading, schedule-draft. For schedule-risks and schedule-raci keep today's read-only render.

Backend, GET only in app/api/admin/schedules/route.ts, additive: createdById, publishedAt, views and viewers (resourceType 'schedule'), chunked by 90; includeRows keeps working. Vitest app/api/__tests__/admin-schedules-list.test.ts.

List on the clients pattern with app/(dashboard)/schedules/_list/ (views.ts plus test, rail.tsx, use-rail-state.ts, mobile-card.tsx).
- PageHeader "Schedules", "The plan you send, wired to the work you are actually doing."; Templates, New schedule.
- KPIStrip: Shared with clients (lead, Link): status shared; sub "Live links a client can open right now" or "Nothing is live with a client". Opened (Eye): shared with views; sub "{m} of {n} shared plans opened". Drafts (FileText). Next launch (Flag): soonest future targetLaunchDate among non-archived, sub "{title}, {relative}", or "None dated". No delivery or off track figures on the list (Liam question).
- Rail views: All schedules, Shared, Drafts, Launching soon (target launch within 45 days, not archived), Archived, Mine. Filter Client. Sort Target launch (default, soonest first), Last edited, Client. Search title, org, deal, prepared for.
- Columns: Schedule (title in Private, "for {preparedFor}, {weeks} weeks", the org, deal or lead name), Target launch (WhenCell, settled for archived), Status (Badge), Reading (ReadCell). Row actions: Open the editor, Preview as the client sees it (/preview/schedule/{id}), Open the live client link (token), Save as a template (PromptDialog, POST /api/admin/schedules/templates { name, fromScheduleId }), Delete (ConfirmDialog, "Sections, rows and the links to requests and tasks all go. The requests themselves stay where they are.").
- New schedule: convert components/tahi/new-schedule-dialog.tsx (only this list uses it) into a SlideOver per the design: Title, Client, Deal and Lead pickers (keep the live lazy pickers and their relation rules), Weeks (1 to 52), and the pick grid Blank ("One gantt section, no rows. Build the phases yourself.") plus each template (name, description, weeks and rows from the snapshot when present); primary "Create and edit" POSTs as live (templateId when picked).
- States: loading, empty ("No schedules yet", "Map a project as weeks and gates, link each phase to the requests doing the work, and share it as a link.", CTA New schedule), filtered, hard error "Could not load schedules" with Try again (replaces the silent empty), stale error strip, populated.

Editor on ArtifactEditorFrame with app/(dashboard)/schedules/[id]/_panes/ (cover-pane, plan-pane, gantt-pane, row-editor, linked-work, prose-pane, register-pane, share-pane, reading-pane, schedule-preview, add-section-menu). Keep every live flow: section CRUD, reorder, rename, eyebrow, theme and zoom window; row CRUD and reorder; the row editor with Linked work (search, attach, detach); delivery-status and its overlay; publish, share (?rotate=1), revoke, EmailShareModal, Save as template, Delete, LinkedToPanel, admin Preview.
- Head: back "Schedules"; title; pills status Badge, "Unpublished edits" warning, "{n} weeks" teal. Actions Publish (shared with unpublished edits), Share (no token), Email link (token, nothing unpublished), Preview. More: Save as a template, Delete schedule.
- LifecycleRail from scheduleStages using /api/admin/schedules/{id}/delivery-status; right side a delivery Badge ("Delivery, {label}") and "{n} off track" in danger ink when the rollup has phases, and a Reading button.
- Outline: Sections (Cover fixed, then each section numbered with its eyebrow or type as the hint; menu Move up, Move down, Remove section; action Add a section opens the live five type menu). Sharing and detail (Reading, Sharing, Plan details).
- Cover pane: Title, Eyebrow (subtitle), Effective (DateField). Plan details pane: Prepared for, Prepared by, Weeks, Effective, Target launch (DateField), and LinkedToPanel (client, deal, lead, proposal). Same PATCH as today.
- Gantt pane (full width; the preview stands down on gantt, risk and RACI views): heading with the section title and a "Paint delivery status" switch (the live overlay toggle); the add row toolbar Phase, Task, Gate, Critical gate (icons by tokens, the critical gate in var(--color-danger)); "{n} rows across {w} weeks"; the live GanttGrid in a Card (it scrolls inside its card at 375) and GanttLegend; selecting a row opens the row editor Card below with scrollIntoView block nearest: Row type, Label, Owner (not for gates), Start week, End week (not for gates), a "Flag this phase at risk" switch, Linked work (the current link with its delivery Badge and Unlink, search over the client's requests and tasks, 44px pool rows that say when an item is already on another row), footer Delete row, Close, Save row. Fix the live bug: when a row save fails keep the typed draft and show the toast; refetch only on success.
- Risk register and RACI panes: today's read-only SectionRenderer with the section settings, restyled, and the honest line "These two tables are edited through the API or the MCP for now." in place of "lands in a follow-up".
- Overview and text panes: the live ProseSectionEditor (TiptapDocEditor).
- Sharing pane: an unpublished warning Callout, ShareLinkPanel, revoke ConfirmDialog ("The link stops working and the published snapshot is cleared, so a fresh link can never serve the version from the first share."), Email link.
- Reading pane: ShareAnalyticsCard resourceType schedule.
- Preview (schedule-preview.tsx): the cover (deliverable CoverPage from the working copy) and overview or text sections (SectionRenderer); label "The client sees", meta Draft, Live or Not shared.
- Replace the hardcoded status palette in schedule-detail.tsx with Badge tones; the owner bar colours and section header band inside gantt-grid.tsx stay (brand locked, not this slice's file). Titles without em dashes; clear the 10 em dashes in schedule-detail.tsx.

Templates: PageHeader "Schedule templates" with a back link; DataTable in Card (Name with description, Weeks and Rows from the snapshot when present, Updated) with Edit (SlideOver, name and description), New schedule from this (POST /api/admin/schedules { templateId } then route), Delete; loading; empty "No templates yet", "Open any schedule, then choose Save as a template from the More menu."; error with Try again.

375 and dark as in proposals.

Do not build: risk register or RACI editing, the studio gantt card stack, Archive or restore, the list Delivery column, Off track view, off track nudge, delivery band tiles or Progress sort, the "Show live progress to the client" switch, the Spine, the unified template shelf, URL state for the active pane.

### viewers

Follow sales-artifacts-kit-viewers.jsx ContractSignPage, ProposalViewer (PackageTabs lockout only) and ScheduleViewer (the "How to read this" page only), and sales-artifacts-kit.jsx SignaturePad. Page keys: v-contract, v-contract-read, v-contract-signed, v-contract-fully, v-contract-expired, v-contract-invalid, v-contract-loading, v-proposal-accepted, v-schedule-plan.

1. Contract viewer onto the deliverable kit (T3.10): replace the local BRAND object, the favicon img BrandMark and the hand-rolled cover and slide shells in contract-viewer.tsx with components/tahi/deliverable BRAND, BrandMark, CoverPage, PageChrome, SectionHeader and its Callout. Order, after the state banners: Cover (type eyebrow, name with the org as the accent, a status chip "{s} of {t} signed" or "Marked signed", meta Sent, Fully signed, Expires; no Governing law cell), The agreement (bodyHtml; any remaining {{slot}} renders as a blank line, never the variable name), Signatories (the live cards: role, status, signature image), How to sign (read link only, not fully signed: "Signing happens on the personal link emailed to each signatory, so the page always knows who is holding the pen. If you are a signatory and cannot find yours, reply to the email and we will send it again."), Your signature (sign route when this signer can sign, feature theme), Audit trail (dates from records only), the live Fine print, footer. Preserve verbatim every state and copy decision from a8147d26 and b57ccaaa: MarkedSignedHero and countSignedHere, the 410 expired and cancelled handling before any pad, the guard states (invalid signer, already signed, skipped, already fully signed), useShareViewTracking, toasts not alert, and the /p layout dark strip. Keep the exports SignedHero, countSignedHere and ContractViewer with their signatures (app/api/__tests__/contract-marked-signed.test.ts and app/preview/contract import them). Rewrite the design's partly signed banner to the code truth: "Partly signed, {s} of {t}. Still to sign: {first names}. The wording is locked, so what you are reading is exactly what is being signed."
2. Rotation-safe signature pad: re-fit the canvas on resize and orientationchange and carry the strokes across on a bitmap snapshot (the design SignaturePad), Clear and Sign and submit at 44px, the "I am {name} and I intend to sign this contract." checkbox, the submit label while in flight. Test the re-fit helper.
3. Per-document metadata for both contract routes: resolveContractMetadata(token) in lib/public-viewer-metadata.ts mirroring resolveProposalMetadata (noindex, OG, a not-found fallback, a marked signed or cancelled document still titled by name), generateMetadata in app/p/contract/[token]/page.tsx and the sign page; tests in lib/__tests__/public-viewer-metadata.test.ts.
4. Proposal viewer: once accepted, lock the package tabs to the accepted package (other tabs disabled with aria-disabled, the line "This is the package you accepted. The others are closed." under the strip); the compare table stays readable. Nothing else in the proposal viewer changes; do not change the exports VariantsSection, VariantTabStrip, coverPalette or isProposalExpired.
5. Schedule viewer: a "How to read this" page after the cover when the schedule has a gantt section (Bars are work, Diamonds are gates, Red diamonds are critical, one line each, legend marks from the gantt tokens). No progress page.
6. Remove the em dashes in the three app/preview page titles ("Proposal preview - Tahi Dashboard" and so on), in contract-viewer.tsx (4) and proposal-viewer.tsx (1).

States: loading skeleton, not found, every guard state, fully signed, just signed (partial and last), expired, cancelled, marked signed with zero, some and all signatures collected here. 375: no horizontal scroll, every control 44px (Sign and submit, Clear, the fine print toggle, tabs). Dark here means the PageChrome dark and feature themes, not the dashboard .dark class (the layout strips it): check the feature signature page for contrast. e2e/public-viewers.spec.ts and e2e/sales-publish.spec.ts must stay green; if copy changes break a selector, update the spec in the same commit.

Do not build: signer email masking, the Download signed PDF button, the schedule "Where we are" progress page, the design's post-accept promises ("A contract is on its way", "the schedule follows within a day", "Liam replies within one business day"), the client papers index, a print stylesheet. Do not edit components/tahi/deliverable/index.tsx, section-blocks.tsx or any /api/public route.

## Skipped (design proposals, Design file only, or waiting on Liam)

1. Proposal Withdraw action (studio-proposals Q1); the withdrawn status stays as today.
2. Proposal editor locked read-only once decided (Q2); the editor stays editable.
3. Draft the contract from an accepted proposal, in the head, the Decisions pane and the list row menu (Q3).
4. Proposal Comments pane, Versions pane, version history and "read vN" chips (Q4; no data).
5. Per-recipient proposal links, per-recipient open counts and the three-day expiry reminder (no data, no engine).
6. Package pricing detail: discount, term, invoicing plan, deposit, GST included, the totals block and instalments (needs a proposal_variants migration and viewer changes).
7. Duplicate a proposal for another client (no endpoint).
8. The Owner filter as drawn (no owner field; Created by is ported instead).
9. Reading sparklines on the three lists (needs per day series).
10. Cancel contract and the cancelled reason and date (studio-contracts Q3).
11. Contract template isDefault toggle (Q4).
12. Unified three kind template shelf, its band and usage counts (contracts Q2, schedules Q1; usage is not stored).
13. The Spine strip in the contract and schedule Sharing panes (three extra reads per editor, and its create affordances are not wired).
14. Editable risk register and RACI matrix (studio-schedules Q2 and the two review questions).
15. Studio gantt phone card stack with tap to edit (Q3).
16. List level delivery rollups on /schedules: Delivery column, Off track view, off track nudge, delivery band tiles, Progress sort, Delivery filter (Q4).
17. "Show live progress to the client" switch and the public "Where we are" page (no column, public API change).
18. Archive and restore a schedule (not in the backlog; archiving 404s the client link).
19. Signer email masking on the public read link (public-viewers Q2).
20. Download signed PDF on the public contract page (public-viewers Q3).
21. Client papers index pages for proposals, contracts and schedules (no live route; B4 dead client nav).
22. The design's own inline "Send for signature" subject and note card (EmailShareModal already does it).

## Questions for Liam

1. Proposals: ship a Withdraw button behind a confirm, or remove the withdrawn status nothing can reach?
2. Proposals: lock the editor once a proposal is accepted, declined or withdrawn, or keep it editable as today?
3. Build "Draft the contract" from an accepted proposal now (it crosses into Contracts), or hold it?
4. Comments and Versions on proposals: wanted, and bundled into AR.4 or separate? Both need new tables.
5. Do you want package pricing detail (discount, term, deposit or instalments, GST included, a totals block)? It needs a migration and a viewer change.
6. Contracts: make cancelled reachable with a Cancel contract button (the PATCH already accepts it)?
7. Contract templates: add the isDefault toggle?
8. Templates: one shared shelf for proposals, contracts and schedules, or keep three per kind pages (the port keeps three)?
9. Schedules: make the risk register and RACI editable in the studio? The section PATCH already takes the JSON, so this is UI only.
10. Schedules: a phone card stack for the studio gantt, or is editing a gantt on a phone out of scope?
11. Schedules list: add delivery rollups (Delivery column, Off track view and nudge)? Note /api/admin/engagements/off-track is not access scoped today and would need that fix first.
12. Public schedule: add a "show live progress to the client" choice per schedule (a column plus a public API change)?
13. Should Archive exist for schedules, knowing it makes the client link 404?
14. Public contract read link: mask signer emails as the design does?
15. Public contract: Download signed PDF for everyone holding the link, or only on the last signer's confirmation?
16. Client portal: should clients get Proposals, Contracts and Schedule pages (the papers index the design draws), or do the nav items go?
17. Headline band: keep KPIStrip as the list band everywhere, or move every list to one shared port of head-band.css? This port uses KPIStrip unless the shared band has landed.

## Risks

- Contract truth fixes from today (markedSigned, countSignedHere, expired and cancelled refused before the pad) are deployed but not yet seen live. The viewer port and the editor port touch the same surfaces; every branch must survive, and contract-marked-signed.test.ts, e2e/public-viewers.spec.ts and e2e/sales-publish.spec.ts must stay green.
- The design copy is wrong in places the code contradicts: the lock rule, revoke keeping signatures, "a contract is on its way", reminders three days before expiry, "Governing law, New Zealand", "Liam replies within one business day", "Waiting on you". Builders use the corrected copy in this plan.
- Publish and share snapshot semantics must not regress: no pane may write straight to a client visible surface, and the Publish badge must keep reflecting real snapshot state.
- The editor frame replaces a right rail people use today (Public link, Linked to, Cover meta, Signed PDF). Each moves into a pane named in the briefs; check nothing is lost, including Email, Revoke and analytics.
- The proposal preview imports ProposalSectionBlock from the public viewer; the editor bundle grows and a change to that component now shows in the studio. The viewers slice must not change its signature.
- The list routes gain grouped reads (views, questions, variant values, signer names, slot counts). Chunk ids by 90 for the D1 bind cap. The contract slot count reads bodyHtml for every listed contract; fine at today's volume, worth a stored count later.
- Amounts across currencies: sums are shown only when one currency; mixed lists show counts. No conversion is claimed.
- BuilderShell's fixed height and negative margins inside the dashboard scroll container: independent pane scrolling on desktop, one document flow on phones; check the sticky head does not cover the first field.
- The shared band decision is not settled across modules (calculator-analytics plans a new HeadlineBand, other plans use KPIStrip). A later swap is a small follow-up.
- Five slices touching adjacent files: the kit must merge first, and no artifact slice may edit it.

## Shared files (schedule around other modules)

- components/tahi/builder/* (owned by artifact-kit; the three editors import it)
- components/tahi/date-field.tsx (new shared primitive; other modules with date inputs may want it)
- components/tahi/artifact/list-cells.tsx and lib/sales-artifacts/status.ts (new, this module only)
- components/tahi/kpi-strip.tsx, skeletons.tsx, rail/rail-layout.tsx, rail/rail-controls.tsx, data-table.tsx, empty-state.tsx, callout.tsx, badge.tsx, slide-over.tsx, confirm-dialog.tsx, prompt-dialog.tsx, menu.tsx, page-header.tsx, private.tsx, money.tsx, searchable-select.tsx, segmented-control.tsx, progress-bar.tsx, avatar.tsx (used, not edited)
- components/tahi/linked-to-panel.tsx, email-share-modal.tsx, share-analytics-card.tsx, tiptap-doc-editor.tsx (used, not edited; shared with requests, calls and deals)
- components/tahi/gantt-grid.tsx, gantt-legend.tsx, schedule-section-renderers.tsx (used, not edited; shared with the public viewer, engagement health and discovery calls)
- components/tahi/deliverable/index.tsx and app/p/proposal/[token]/section-blocks.tsx (used, not edited)
- components/tahi/headline-band.tsx (only if another module lands it; not created here)
- lib/public-viewer-metadata.ts (viewers slice), lib/use-user-preference.ts (used)
- app/api/admin/engagements/off-track/route.ts (not touched; flagged)
- workers/mcp-server/src/index.ts (not touched; the list tools proxy the routes)
- app/(dashboard)/design-system/design-system-content.tsx and app/globals.css (not touched)
