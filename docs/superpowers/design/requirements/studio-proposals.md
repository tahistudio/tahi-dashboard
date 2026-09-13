# Design requirements: studio-proposals

Group: studio-proposals (audience: studio, Tahi team only). Routes: `/proposals`, `/proposals/[id]`, `/proposals/templates`.

Sources read: `CLAUDE.md`, `STATUS.md` "Since the last update", `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2b and 3, the proposals rows), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, every `proposal` line in `TASKS.md`, the live code under `app/(dashboard)/proposals`, `app/api/admin/proposals`, `app/api/public/proposals`, `lib/proposal-snapshot.ts`, `app/preview/proposal/[id]/page.tsx`, and the Claude Design file `sales-artifacts.jsx` (project `57bf60cf-5e6d-450f-9e2f-e25c8d12fd66`).

---

## 1. Purpose and audiences

Proposals is a studio-only surface. Only a Tahi team member reaches it: `page.tsx` on all three routes calls `getViewAudience()` and redirects to `/requests` when the caller is not an admin org member or is a team member currently previewing as a client (the `tahi-impersonate-org` cookie), so a client preview session cannot leak one client's proposal into another client's view. Every route also calls `requirePageFeature('proposals')`, so a team member without that feature grant in the permissions tree cannot open it even with the right org.

The job of this group is to let the studio build, price and send a premium client-facing proposal (a 16:9 slide deck with a cover, content slides and one to several priced packages), publish it to a public link, watch what the client does with it, and see the client's decision (accept, decline or ask a question) land back in the studio without anyone checking manually.

What it must never show:
- One team member's org-scoped access must never surface a proposal that belongs to (or whose linked deal belongs to) an organisation they are not scoped to. `requireProposalAccess` / `scopedOrgIds` (`app/api/admin/_sales-access/artifact-scope.ts`) enforce this on every read and write; an unrestricted caller (owner, `super_admin`, `admin`, or the MCP service token) bypasses the filter and sees everything. A proposal with neither `orgId` nor a linked deal is "unassigned" and is visible only to unrestricted callers, never to a scoped member.
- The public viewer (and therefore any client) must never see an admin's live, unpublished edits. The publish/share snapshot model (`lib/proposal-snapshot.ts`) is the only thing standing between "the admin is mid-edit" and "the client is reading it"; this group's design must never regress that by adding an editor affordance that writes straight to a client-visible surface.
- PII fields (proposal title, prepared-for name, acceptor name/email, org/deal names) are already wrapped in `data-private`; any new field the design adds that carries a person's name or email must carry the same wrapper.
- No area of this group is gated to `super_admin` specifically (Liam and Staci); the gate is the general Tahi-admin-org check plus the `proposals` feature flag, so any team member with that grant sees the same surface an owner does, scoped by org access.
- There is no Messages surface inside Proposals. The closest analogue, the Decisions panel, is a proposals-only response log (accept/decline/question), not a shared conversation thread, so it carries no Messages-hidden-for-clients conflict; it is never client-facing at all (it lives inside the studio-only editor).

## 2. Pages, sub pages and entry points

**`/proposals`**, the list page. Reached from the Sales section of the sidebar. `PageHeader` carries Refresh, a link to Templates, and "New proposal", which opens the `CreateProposalSlideOver` (a `SlideOver`): pick Blank or search and pick a saved template, either creates the row server-side and pushes to `/proposals/[id]`. Row click opens `/proposals/[id]`. Row actions: Open, "Open public viewer" (only when `publicShareToken` is set, opens `/p/proposal/[token]` in a new tab), Delete (`ConfirmDialog`).

**`/proposals/[id]`**, the two-pane slide builder. Reached from a list row, from either creation path, or a direct/bookmarked URL. There is one route; every sub-view is client-side state (`activeView`), not a distinct URL:
- Cover editor (`activeView === 'cover'`, the default): eyebrow, title, prepared for, prepared by, effective and expiry dates.
- Section (slide) editor (`section:<id>`): per-type structured fields (`TypedSectionFields`) for ten structured types, HTML/quote fallback for the rest; move up/down, delete.
- Package (variant) editor (`variant:<id>`): name, tagline, one-off and monthly amount, currency, scope/pricing HTML, CTA label, featured toggle, delete.
- Decisions panel (`decisions`): only listed in the right-rail nav when at least one `proposalAcceptances` row exists.
- Analytics panel (`analytics`): only listed when `publicShareToken` is set; renders `ShareAnalyticsCard`.
The right rail always shows a Slides nav group (with an Add-slide menu grouped Common/Other), a Packages nav group (with Add package), the conditional Decisions/Analytics group, a Public link section (Generate / Copy / Open / Email / Revoke), a Linked-to panel (org and deal, via `LinkedToPanel`), and a Cover-meta field block. The top toolbar: back arrow to `/proposals`, an inline-editable title, a status pill, a save indicator, an "Unpublished" badge plus Publish button (only when there are edits since the last publish), a Preview link (opens `/preview/proposal/[id]`, an admin-only chrome-less route reusing the public `ProposalViewer` component), and a More menu (Save as template → `PromptDialog`; Delete proposal → `ConfirmDialog`). "Email the link" opens `EmailShareModal`, lazy-loading the org's contacts on first open.

**`/proposals/templates`**, reached from the list page's Templates button. A table of saved blueprints: row click opens a preview (`previewTarget` state), plus per-row "New proposal" (creates and redirects to the new proposal's editor), Rename (`PromptDialog`), Delete (`ConfirmDialog`).

Entry points this group hands off to, outside its own scope: `/p/proposal/[token]` (the public viewer, via Open public viewer / Copy / Open), `/preview/proposal/[id]` (admin chrome-less preview), `/clients/[id]` (Org link, list and rail), `/pipeline/[dealId]` (Deal link, list and rail), and a `mailto:` reply link on a Decisions-panel question response.

## 3. States and variants

- `/proposals` loading: `DataTable`'s built-in skeleton via its `loading` prop.
- `/proposals` empty (no proposals at all): `EmptyState`, "No proposals yet" / "Create one to send a premium 16:9 deck with 1-3 packages." / "New proposal" CTA.
- `/proposals` filtered-empty (rows exist, filter/search matches none): inline `EmptyState`, "No proposals match your filters" / "Try clearing the search or changing the status chip."
- `/proposals` error: no dedicated `ErrorState`; a failed create or delete shows a toast ("Failed to create proposal", "Failed to delete proposal") and the list stays as last-fetched.
- `/proposals/[id]` loading: two pulsing skeleton blocks (no `PageHeader`/toolbar yet).
- `/proposals/[id]` error: a failed patch/section/variant write shows a toast ("Failed to save", "Failed to save section", etc.) and reverts on next `mutate`; there is no persistent inline error banner.
- Client view: not applicable to any of the three routes; a client session or an impersonated-client preview is redirected to `/requests` before anything renders, so there is no read-only client variant to design.
- Member seat vs admin seat: identical UI for both; the difference is server-side scoping. An unrestricted admin/owner sees every proposal and can create unassigned drafts; a scoped team member sees only proposals whose org (direct or via deal) they are granted, and a create call for an unassigned draft is denied to them.
- 375px: the builder grid (`.proposal-builder-grid`) collapses to a single column under 1024px, and the right rail moves below the editor with its border switching from left to top; the list's `DataTable`/`FilterBar` and the templates page's bespoke `<table>` have not been verified at 375px in the live app (the catalogue records the templates page as "PageHeader only", i.e. not yet on the responsive list primitives).
- Dark mode: `PageHeader`, `DataTable`, `FilterBar`, `Badge`, `EmptyState`, `SlideOver`, `ConfirmDialog` and `PromptDialog` are all CSS-var driven and should adapt automatically; the editor's own `statusPill()` function and the Decisions-panel response palette use hardcoded hex (`#eff6ff`, `#f0fdf4`, `#fef2f2`, etc.) rather than tokens, so their dark-mode contrast is unverified.
- Print or public: not applicable to these three routes; a print-quality static view exists only on the public viewer (`/p/proposal/[token]`), which is out of this group's scope.

## 4. Features and actions

### `/proposals`

**Works today:** status/org/deal/updated columns on `DataTable` with sortable headers; `FilterBar` search plus a permanent status multiselect chip; create blank or from-template via the `SlideOver` picker with template search; delete with a confirm step; per-row Open, Open public viewer (conditional), Delete; per-org scoping (Batch A, done for proposals per `TASKS.md` T1.16 and the artifact-scope module).

**Wrong or half-built:** none found beyond the port status itself; Refresh is a manual `mutate()`, there is no polling or SSE, which is expected for a studio list, not a bug.

**Planned or missing:** port onto the v3 sales-artifacts design (`sales-artifacts.jsx` proposals-list, Pass 3 SHIP verdict; catalogue effort 1d; was blocked on DL.1's write-ceiling problem, now unblocked per the catalogue's "corrections after compile" note that all 14 DL.1/DL.2 files are written). The design file also models saved views the live list does not have (All proposals / Out to read / Waiting on you / Drafts / Accepted / Declined / Closed / Mine), an org filter and an owner filter, a reading/views column with a sparkline, and a value roll-up per view; proposal, none of this carries a TASKS id today.

### `/proposals/[id]`

**Works today:** cover, section and variant CRUD with save-on-blur/patch and optimistic local state; section reorder (move up/down, optimistic with a refetch on failure); a grouped Common/Other section-type picker with ten structured editors (`value_anchor`, `process`, `differentiators`, `case_study`, `testimonial_stack`, `faq`, `guarantee`, `retainer_offer`, `founders`, `partner_badges`) and an HTML fallback for the rest; variant CRUD including a single-featured-package toggle; publish (snapshots sections/variants/cover into `publishedSnapshot`, "Unpublished" badge, Publish button correctly re-appears after an edit because `patchProposal` bumps the local `updatedAt` (the T3.2 "Publish button dies after the first publish" bug is fixed in the shipped code); share/unshare (mints or rotates a token, snapshots on first share only per Batch C1/T3.1, revoke clears the snapshot and reverts status to draft); email share via `EmailShareModal`; the Decisions panel (accept/decline/question responses, amounts frozen from the accepted snapshot variant, a `mailto:` reply link for questions); studio notification on every decision (bell plus Resend email plus a deal activity when the proposal is linked to a deal, Batch C3/T3.3, shipped, confirmed in `app/api/public/proposals/[token]/accept/route.ts`); the Analytics panel once shared; Save as template; Delete proposal; the Linked-to org/deal editor; the admin-only chrome-less `/preview/proposal/[id]` route.

**Wrong or half-built:** the `withdrawn` status exists in the type union, the status-pill palette and the list's filter chip, but no button anywhere in the shipped editor sets it, a dead status with a visible badge and no way to reach it. The Effective and Expires date fields (both the Cover editor and the rail's Cover-meta block) are raw unstyled `<input type="date">` elements, matching the Pass 3 critique of the design file's own native inputs. The status-pill and Decisions-panel colour palettes are hardcoded hex rather than CSS var tokens (dark-mode contrast unverified, see section 3).

**Planned or missing:** AR.4, a full redesign of the editor in Claude Design before any port (catalogue effort 5d, the most work of any editor in the catalogue; Pass 3 verdict FIX, re-checked at PASS-B); the specific "every row opens the same hardcoded document" wiring bug the catalogue still lists as open has in fact been fixed in the current design file (`ProposalEditor`'s own comment: "It used to be dropped on the floor and every row opened the same fixture... The demo string still picks a document when there is no id"), which is worth re-verifying against the catalogue before the next design pass, not re-fixing. Beyond that wiring fix, the design file models several things the live editor has none of: a Comments pane for per-slide client-left comments, a Versions pane with publish history, a locked read-only state once a proposal is accepted, declined or withdrawn (the live editor stays fully editable regardless of status), a one-click "Draft the contract" action on an accepted proposal, and a "Duplicate for another client" action. AR.5 (left-rail-on-every-list-page and one-headline-card-anatomy consistency rules) applies once this editor is ported. T3.9's small-fix batch touches this surface too: `EmailShareModal` preselect, em-dash metadata, `expiresAt` enforcement (already enforced server-side in the public accept route, so this item may already be satisfied), and save-as-template 400 handling.

### `/proposals/templates`

**Works today:** list, rename, delete, preview, create-a-proposal-from-template.

**Wrong or half-built:** none found beyond the port status.

**Planned or missing:** port to the design system's list primitives (`DataTable` in a `Card` under `PageHeader`, matching Proposals and Contracts. Today it is a bespoke `<table>` styled with Tailwind utility classes, not any shared component. Pass 3 verdict SHIP for the templates list pattern; catalogue effort 0.5d; was blocked with the rest of DL.1, now unblocked per the same corrections note as above.

## 5. Data and integrations

APIs: `GET/POST /api/admin/proposals`, `GET/PATCH/DELETE /api/admin/proposals/[id]`, `POST /api/admin/proposals/[id]/publish`, `POST/DELETE /api/admin/proposals/[id]/share`, `POST /api/admin/proposals/[id]/email`, `GET /api/admin/proposals/[id]/preview-data`, `POST/PATCH/DELETE` on `sections` and `sections/[sectionId]`, `POST/PATCH/DELETE` on `variants` and `variants/[variantId]`, `GET/POST` on `templates` and `PATCH/DELETE` on `templates/[id]`; publicly (consumed only via the "Open public viewer" / copy-link actions, not rendered inside this group) `GET /api/public/proposals/[token]` and `POST /api/public/proposals/[token]/accept`.

Tables: `proposals`, `proposalSections`, `proposalVariants`, `proposalAcceptances`, `proposalTemplates`; joined against `organisations` and `deals` for the Org/Deal display columns and links; `activities` (a deal activity row written on every accept/decline/question when a deal is linked); `notifications` (via `notifyAllAdmins`).

Third parties: Resend, for both the studio decision-notification email (`lib/notification-email.ts`, `studioProposalDecisionEmailPlan`) and the client-facing share email sent through `EmailShareModal`; Cloudflare D1 via Drizzle (`lib/db.ts`); Clerk, for the auth/org identity behind every admin route (`getRequestAuth`, `getViewAudience`).

What must stay honest: accepted amounts shown in the Decisions panel are frozen from the published snapshot at accept time, never recalculated against a since-edited live variant, so the studio never sees a number the client did not actually agree to. The Publish/Unpublished badge must keep visibly reflecting real snapshot state so nothing in the UI claims the client sees something they don't. The one confirmed dead affordance in the current UI is the `withdrawn` status: it renders as a real badge and filter option with nothing behind it.

## 6. Design system contract

Primitives already in correct use on the live routes: `PageHeader`, `FilterBar`, `DataTable` inside `Card`, `EmptyState` (full and inline variants), `SlideOver` (with `.Body`/`.Footer`), `Badge` with the shared tone map, `ConfirmDialog`, `PromptDialog`, `TahiButton`, `Input`, `LinkedToPanel`, `EmailShareModal`, `ShareAnalyticsCard`. Leaf radius is used narrowly (the create-slide-over and template-picker icon wrappers use `--radius-leaf-sm`) and should extend further once the editor is ported, to match the design system's icon-background convention elsewhere.

What the existing design file (`sales-artifacts.jsx`, shared with `sales-artifacts-kit.jsx` and `sales-artifacts-data.jsx`, the combined Proposals/Contracts/Schedules module) gets right: rail-driven saved views replacing the single status chip (All proposals, Out to read, Waiting on you, Drafts, Accepted, Declined, Closed, Mine), a reading/sparkline column, a locked read-only editor state once a proposal is decided, a Comments pane and a Versions pane, a "Draft the contract" cross-artifact shortcut, and, worth flagging directly to the reviewer, the row-to-document wiring bug the catalogue still lists as an open AR.4 item has already been fixed in the file on disk (confirmed by reading the current `ProposalEditor` source and its own in-line comment describing the fix).

What must change before or during the port, per the Pass 3 / PASS-B critic verdicts recorded in the checklist: AR.4, the editor needs a genuine redesign pass, not just a port. Native unstyled date and select inputs, misaligned baselines, and card-in-card-in-card nesting are the specific complaints on record. AR.5, apply the left-rail-on-every-list-page rule and the one-headline-card-anatomy rule to the Proposals list and editor, matching what DL.2 already applied to other surfaces. The proposals list itself carries a Pass 3 SHIP verdict and needs no redesign, only a port. The templates page also carries a Pass 3 SHIP verdict for its list treatment, but the live route has not adopted `DataTable`/`Card`/leaf radius at all, so its port is a primitive swap, not only a visual refresh.

## 7. Open questions for Liam

- Should the Withdraw action (present in the design, present in the status vocabulary and the list's filter chip, absent from every live button) ship as part of this port, or should the `withdrawn` status be removed if nothing is meant to reach it? (A: ship a Withdraw button, B: remove the status)
- Should the editor lock to read-only once a proposal is accepted, declined or withdrawn, the way the design models it, or should the studio keep full edit access to a decided proposal, the way the shipped editor works today? (A: lock on decision, B: keep editable)
- Should "Draft the contract" (a one-click contract creation from an accepted proposal, present in the design, absent from the backlog under any id) be built in this pass, since it also touches the Contracts surface, or held for later? (A: build now, B: hold, no id yet)
- Should the Comments pane (inline per-slide client comments) and the Versions pane (publish history) ship together with the AR.4 redesign, or are they separate backlog items to scope later, since neither has a TASKS id today? (A: bundle into AR.4, B: separate items)

## 8. Acceptance for the design review

1. The Proposals list's rail-or-filter, headline band and table follow the same anatomy as Requests, Tasks and Contracts, with no bespoke chrome left over.
2. The editor's outline (Slides, Packages, Decisions, Analytics) reads as one consistent left rail with no card-in-card nesting, and the screenshot at 375px shows the rail cleanly stacked below the editor, not clipped or overlapping.
3. The Effective and Expires fields use a styled date picker component, not a native unstyled `<input type="date">`.
4. The status pill and the Decisions-panel response colours hold readable contrast in both the light and dark screenshots (no hardcoded-hex washout).
5. The Templates page uses `DataTable` inside a `Card` under `PageHeader`, not a bare `<table>`, and its headline band matches the Proposals list.
6. The Publish / Unpublished state is unambiguous from the screenshot alone: a reviewer can tell whether the public link currently matches the editor's content.
7. At 375px, the New-proposal `SlideOver`, the builder's stacked rail, and the Templates list all show no horizontal scroll and every tap target measures at least 44px.
8. If Withdraw ships in this pass, it appears exactly once, behind a confirm step, and never appears once a proposal is already decided.
9. The Public-link, Linked-to and Cover-meta rail sections share one visual language end to end (same field style, same section-header treatment).
10. The dark-mode screenshots of both the list and the editor show no invisible text and no unreadable badge or pill combination.
