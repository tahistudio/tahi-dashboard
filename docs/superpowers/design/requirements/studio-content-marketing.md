# Design requirements: studio-content-marketing

Group: studio-content-marketing (audience: studio only). Routes: `/content-studio`; `/content-studio/drafts/[id]/round-table`; `/sitemap`; `/social`; `/reviews`; `/announcements`.
Prepared 2026-09-13 for the Claude Design pass. Source: CLAUDE.md, STATUS.md ("Since the last update"), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (sections 2 and 3), `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md, live code in `app/(dashboard)/content-studio`, `app/(dashboard)/sitemap`, `app/(dashboard)/social`, `app/(dashboard)/reviews`, `app/(dashboard)/announcements` and their API routes, and the Claude Design project (57bf60cf-5e6d-450f-9e2f-e25c8d12fd66), confirmed empty for this group by `list_files` at full depth.

No design file exists for any page in this group. Every `.jsx`/`.css` in the project belongs to a different surface (overview, requests, tasks, clients, sales pipeline/artifacts, ops, invoices, portal, permissions, settings, auth, onboarding, emails). The checklist's own "Not designed yet" section names Content studio, Social, Announcements and Reviews explicitly; the catalogue names Sitemap too and adds that it is "missing from the checklist's own bookkeeping." This is a first design pass for the whole group, not a redesign: there is no critic verdict (SHIP/FIX/REDO) to inherit anywhere in section 6 below because nothing has been drawn yet.

## 1. Purpose and audiences

This group is the Marketing nav section (`components/tahi/nav-model.tsx`, `group: 'Marketing'`): five studio-only tools that run Tahi's own content and outreach engine, not anything a client ever opens. Each page answers a different internal question: is our blog getting indexed and what should we write next (`/content-studio`), what does the redesigned tahi.studio site look like as a planned tree (`/sitemap`), how is Liam's personal LinkedIn cadence doing (`/social`), which clients still owe us a testimonial (`/reviews`), and what is broadcast to every client portal right now (`/announcements`).

Audiences:
- **Liam (admin, `business@tahi.studio`).** Full access to all five pages, plus a further inner gate on `/sitemap` and `/content-studio`: only Liam sees the AI machinery (`/sitemap`'s Boardroom 6-reviewer run and `/content-studio`'s ideation/drafting/round-table/link/audit pipelines are all Anthropic/Perplexity/OpenAI/Replicate calls that cost real money).
- **Staci (admin, `staci@tahi.studio`).** Full access to `/content-studio`, `/social`, `/reviews`, `/announcements`, and to `/sitemap` for planning and documentation (tree, node editor, Tiptap body), but `sitemap-content.tsx`'s `SITEMAP_AI_OWNER` constant hides the Boardroom button and the site-wide reviews bar from her; she is not on Liam's email specifically, so the AI review layer is Liam-only by design, not an oversight.
- **A scoped Tahi team member.** Every page in this group redirects a non-admin (`isAdmin` false) straight to `/overview` (or `/requests` for Announcements) before rendering, and every page also redirects an admin who is currently previewing a client (`isPreviewingClient`) the same way, so an admin's client-preview session can never leak one client's marketing/outreach data to another. Beyond that admin gate, each page also calls `requirePageFeature(...)` for granular permissions: `content_studio`, `social`, `reviews` and `announcements` are all named resources. `content_studio`, `social` and `reviews` have no seeded row in the permission catalogue (`lib/permissions.ts`'s `FEATURE_RESOURCE` map, commented "no rows in the seeded permission catalogue... deny by default per audit finding T1.18"), so a team member with no explicit `feature_visibility` grant sees none of the three even if they hold a broad role. `announcements` does have a seeded resource, so it follows the normal role-baseline gating instead of deny-by-default. Nobody without an explicit grant reaches any of these five pages today; only Liam and Staci hold the admin org id that satisfies `isAdmin`. **T1.18's own bug report reads as stale on re-check**: it claims `filterNav` never reads `item.adminOnly` and that `FEATURE_RESOURCE` has no mapping for `content_studio`/`social`/`reviews`/`announcements`, but the live code contradicts both today (`nav-model.tsx`'s `filterNav` does gate on `item.adminOnly`; `lib/permissions.ts`'s `FEATURE_RESOURCE` maps all four keys), and all four `page.tsx` files already call `requirePageFeature(...)` before rendering. Treat this the same way as T1.16's stale-checkbox note on `/announcements` (section 4): worth a quick re-verify rather than assuming the nav-gating hole T1.18 describes is still open.
- **`/sitemap` only, an additional hard gate below all of the above**: a hardcoded email allowlist (`lib/sitemap-auth.ts`, `business@tahi.studio` and `staci@tahi.studio`) that returns a bare 404, not a 403, to anyone else, "the route doesn't even hint at existing," per the file's own comment. This is the one truly super-admin-only surface in the group; nothing else in the whole dashboard is allowlist-gated this way except `/sitemap`.

What this group must never show:
- A client org, ever, on any of the five pages or the round-table sub-route: each `page.tsx` redirects before rendering when `isPreviewingClient` is true, specifically so an admin's "view as this client" session cannot show that client (or anyone) the blog pipeline, the site plan, social cadence, testimonial outreach status, or the announcement builder.
- The Messages-hidden-for-clients rule (Batch A, STATUS.md) does not apply here directly, none of these five pages has a client-facing counterpart to hide anything from. `/announcements` is the one page in this group with a client-visible downstream effect (the `<AnnouncementBanner>` strip a client sees in their own portal), and that banner path is a separate, already-scoped read (`/api/portal/announcements`) that only ever returns announcements actually targeted at that client's org or plan.
- A denied team member must see nothing that hints these pages exist beyond the sidebar itself following `adminOnly`/`emailAllowlist` filtering (`nav-model.tsx`'s `filterNav`); the page-level redirects are the real enforcement, the nav is only ever a convenience.

## 2. Pages, sub pages and entry points

### `/content-studio`
Reached from the sidebar's Marketing group. Server-gated by admin + not-previewing-client + `requirePageFeature('content_studio')`. Client component renders a `PageHeader`, an `SpendStrip` (AI spend today/week/month, by provider, silently renders nothing if the SWR call fails), then a tab strip (state-driven, not sub-routes; `?tab=<id>` on load selects a starting tab for deep links from notifications) with eight tabs:
- **Health** (default). Scan strip (last-scan badge + "Scan now"), a 4-cell KPI strip (Indexed / Not indexed / Partial-Neutral / Unknown), a persistent warning card when the last scan indexed nothing, a collapsible last-scan-errors card, a sortable `DataTable` of every URL's Search Console status, and a `BackfillCard` embedded at the bottom of this same tab (see the Backfill tab below, the same functionality exists in two places on this page).
- **Backfill**. Its own tab (`BackfillContent`, a separate 1,189-line component) doing the same staged-content-edit job as the `BackfillCard` embedded under Health. Two entry points to what reads as one feature.
- **Ideas**. Week header with proposed/approved/rejected counts, "Run ideation now" and "New idea" (manual) actions, cluster filter chips (multi-select, coloured by a deterministic hash of the cluster slug), a card grid of ideas. Sub-panels, not routes: an idea's own `SlideOver` (Liam's opinion + per-idea targeted questions, Approve/Reject footer) and a manual-idea `SlideOver` (title/angle/keyword/cluster/notes, with a duplicate-detection step that must be force-confirmed before it creates the idea). Approving from the ideas grid, or clicking "Run round table" on an idea, navigates away to the round-table sub-route below.
- **Drafts**. Grouped by pipeline status (in-progress bucket, ready, failed), soft-polls every 6s while anything is in progress. Opening a row loads a draft-detail `SlideOver` (not the round-table page, a lighter summary view). A `PublishModal` (bespoke centred dialog, not the shared `SlideOver`) offers Publish now / schedule for a custom date / auto-schedule. Discard and Retry (re-drafts through the round-table pipeline) are also available per draft.
- **Links**. Internal-link suggestions grouped by target URL (first target auto-expanded), each suggestion individually Apply (stages a Webflow patch) or Reject; "Scan" kicks off a fresh crawl.
- **Schedule**. Ready-drafts list plus a merged chronological history table of scheduled and already-published posts, each row openable in its own `SlideOver` with the same publish controls as Drafts.
- **Site index** (`SiteIndexContent`, its own file). Every live tahi.studio URL with a one-line AI summary and embedding, feeding internal-link and related-post suggestions elsewhere in the pipeline.
- **Audits** (`AuditsContent`, its own file). Runs the same 23-reviewer round table against an already-published post instead of a fresh draft, producing scores and critiques without touching Webflow until a change is explicitly applied.

### `/content-studio/drafts/[id]/round-table`
A distinct route (not a tab), reached only by navigating from an approved idea's "Run round table" action or a failed draft's "Retry." Same admin + feature gate as the parent page. Shows: a status pill with a cost tracker and an AI-service-availability banner (Perplexity/Replicate/OpenAI/Anthropic flags), the Strategist's brief (intent, target word count, primary/secondary keywords, heading outline), revision tabs (1, 2, 3…) each carrying all 23 reviewer critiques grouped by verdict, a conflicts section with per-conflict override buttons (side with reviewer A, B, or the editor), an "Advance pipeline" action while the draft sits in a non-terminal status, an FAQ section, and a body preview of the latest revision. Polls every 4s while non-terminal. `awaiting_brief_approval` is a deliberate human gate the auto-tick stops at.

### `/sitemap`
Reached from the sidebar (only visible to the two allowlisted emails) or by direct URL (404s for anyone else). Two-pane layout: a tree on the left (page / section / CMS-collection nodes, expand/collapse, click to select) and a detail editor on the right. At 768px and below the layout stacks (tree caps at a fixed height and scrolls, detail flows with the page instead of scrolling in its own box). Page-header actions: Boardroom (Liam only), Export (downloads a bundle), Add section, Add CMS, Add page. Per-node detail: editable fields (title, slug, url, purpose, ICP audience, primary keyword, AEO intent, positioning vertical, success metric, special features, design notes, content notes, content blocks needed, target launch date, status), a Tiptap rich-text body, duplicate and delete node actions, and a per-node "Sub-agent review" panel running six reviewers (SEO+AEO, ICP fit, Brand voice, CRO, Sales, Marketing) against that one page. The Boardroom bar (collapsible, Liam only) shows the same six reviewers run against the whole sitemap at once, gated behind a confirm dialog that names the node count and an estimated cost (~$0.30).

### `/social`
A single page, no tabs, no sub-routes. Header with Refresh and an "Open Buffer" external link. Three top-level states depending on `/api/admin/integrations/buffer/status`: not configured (missing `BUFFER_API_KEY`), configured-but-not-connected (an inline error message), connected. When connected: a 4-cell KPI row (Channels, Posts last 30 days, Scheduled, Cadence), a Channels card (chips per connected channel, paused badge where relevant), a 30-day cadence bar chart, a Scheduled-queue card (top 5), a Recent-posts card (top 10 of up to 50 fetched, with a "showing 10 of N, open Buffer for the rest" note), and a closing disclaimer that per-post engagement is not available from Buffer's API and never will be shown here.

### `/reviews`
A single page, no sub-routes. Header, a 5-cell stats strip (Total clients, Reviews completed, NPS score with an average sub-label, Marketing permission count, Video testimonials count), a search box, seven filter tabs (All / Not sent / Asked / In progress / Completed / Declined / Deferred) each with a live count, and one expandable row per organisation. Expanding a row (click anywhere on the row, not a separate affordance) reveals: a three-column detail grid (Review details with NPS/submitted/follow-up date/opted-out flag, Permissions granted with website/logo/case-study rows, Feedback with loved-most and to-improve free text), a written-testimonial block, a video-testimonial link (only if present), a Clutch-review link or a "leave a review at clutch.co" fallback, a Generate-draft action for completed submissions that calls an AI case-study drafter and renders the result inline as preformatted text, and a row of status-change badges to move the org between all seven states by hand. Per-row quick actions outside the expansion: a Send icon (only while `not_sent`) and a Copy-link icon (only once a `submissionToken` exists). Neither opens a sub-page; both are inline mutations/clipboard writes. The client-facing destination this outreach is supposed to point at is a separate route, `/review/[token]`, entirely outside this group's studio surfaces.

### `/announcements`
A single list page, no sub-routes. Header, a `FilterBar` (Status / Type / Audience multiselect plus a title/content search), a `DataTable` of every announcement (Title, Type, Audience, Status, Created), and a "New announcement" action. Two `SlideOver`s, neither reachable by URL: a read-only View panel (opened by clicking any row) showing every field plus published/expiry dates with a single Close button, and a Create panel (Title, Content, Type select, Audience select [All clients / By plan / Specific clients], a Plan select that only appears when Audience is "By plan," an optional expiry date, a "Publish immediately" checkbox, Cancel/Create). The client-facing destination is `<AnnouncementBanner>`, mounted globally in the dashboard layout, which is not part of this group but is this page's only real output.

## 3. States and variants

### `/content-studio`
- **Loading.** Health: 4 pulsing tile placeholders instead of the KPI strip, plus the DataTable's own loading rows. Ideas/Drafts/Links/Schedule: each tab's own skeleton grid (`animate-pulse` tiles) while its SWR call is in flight.
- **Empty, first-time.** Health: full `EmptyState` ("Run your first scan," description naming the ~201-URL count and the 60-to-90-second estimate, "Scan now" CTA). Ideas: full `EmptyState` ("Seed the cluster map first," "Seed default clusters" CTA) when no clusters exist yet, and a second empty state ("No ideas yet for this week" / "No ideas in those clusters this week") once clusters exist but nothing has been proposed or the cluster filter zeroes the list. Drafts: full `EmptyState` ("No drafts yet," pointing back at approving an idea). Links: not directly inspected in this pass but follows the same SWR-empty pattern as its siblings.
- **Error.** Health's scan flow surfaces a structured 412 ("Search Console not connected") with the connected account and visible properties named in the toast, plus a persistent on-page diagnostic card that survives a refresh; every other tab's mutation failures surface as a toast only, no persistent banner.
- **Read-only Client view.** Structurally impossible: the server component redirects to `/overview` before rendering whenever `isPreviewingClient` is true.
- **Member seat vs admin seat.** `content_studio` is deny-by-default for a team member with no explicit grant (see section 1); a granted member sees the identical page Liam and Staci see, with no visible difference in capability inside the page itself once granted.
- **375px / 768px.** Not verified live. The tab strip scrolls horizontally on overflow (`overflow-x-auto`, `scrollbar-hide`) which is the one explicit mobile affordance in the code; the eight-tab strip at 375px has not been screenshotted.
- **Dark mode.** Not verified live. All styling routes through `var(--color-*)` tokens by construction.
- **In-progress polling.** Drafts soft-polls every 6s while any draft is mid-pipeline; the round-table sub-route polls every 4s while its own draft is non-terminal.

### `/content-studio/drafts/[id]/round-table`
- **Loading.** Not directly inspected; the parent pattern (SWR + skeleton) is the project convention.
- **Empty.** Not applicable, the route only exists once a draft has been created.
- **Terminal states.** `ready_for_publish`, `failed`, `cost_capped`, `paused`, `awaiting_brief_approval`, `audited` all stop the poll and change the available actions (e.g. `awaiting_brief_approval` is a deliberate human gate, `cost_capped` presumably blocks further spend, not confirmed against a live cost-cap run in this pass).
- **375px / 768px / dark mode.** Not verified live.

### `/sitemap`
- **Loading.** A centred spinner in the tree pane while nodes load; the detail pane shows nothing until a node is selected.
- **Empty, no nodes.** Full `EmptyState` in the tree pane ("Empty sitemap," pointing at "Add a page or section").
- **Empty, nothing selected.** Full `EmptyState` in the detail pane ("Select a page"), reachable even with nodes present, e.g. immediately after the tree first loads before the auto-select effect runs.
- **Error.** Not modelled with a dedicated banner; create/duplicate/save failures surface as toasts only.
- **Read-only Client view.** Structurally impossible: `isPreviewingClient` 404s before rendering, same as the allowlist gate.
- **Owner (Liam) vs Staci (both allowlisted, different capability).** Boardroom button, the Boardroom results bar, and the site-wide reviews SWR fetch itself are all gated on `SITEMAP_AI_OWNER === business@tahi.studio`; Staci gets the full tree/editor/duplicate/export/per-node-review experience with the AI-machinery chrome absent rather than disabled.
- **375px behaviour is explicitly designed for, unlike most of this group**: below 768px the fixed-height two-pane grid collapses to a normally-flowing page, the tree caps at 15rem and scrolls internally, and the detail pane switches to `overflow: visible` so the full document is readable by scrolling the page rather than trapped in an internal scroll box. Not yet screenshotted live, but the CSS intent is present and deliberate, unlike the other four pages in this group.
- **Dark mode.** Not verified live; tokens used throughout.

### `/social`
- **Loading.** `LoadingSkeleton` (2 rows) while the status call is in flight; posts render nothing extra while their own calls are loading beyond the "Recent posts" card's own `LoadingSkeleton`.
- **Not configured.** A plain warning-coloured `<div>` naming the missing `BUFFER_API_KEY` and linking to where to generate one. Not the shared `EmptyState` component.
- **Configured, not connected.** A plain danger-coloured `<div>` with the server's error message or a generic fallback. Also not `EmptyState`.
- **Connected, empty.** "No sent posts yet." as an italic inline string inside the Recent-posts card, again, not `EmptyState`; there is no icon, no title/description/CTA structure anywhere on this page.
- **Error (fetch failure).** Rendered as a plain danger-coloured banner string at the top of the page.
- **Read-only Client view.** Structurally impossible: redirects before rendering.
- **375px / 768px.** The KPI row is an explicit `grid grid-cols-2 lg:grid-cols-4` (2-up below the `lg` breakpoint), the cadence bar chart is a fixed 30-column grid that will compress bars to sub-pixel widths on a 375px viewport; not screenshotted live.
- **Dark mode.** Not verified live; tokens used throughout.

### `/reviews`
- **Loading.** `LoadingSkeleton` (5 rows) in place of the row list; the stats strip does not have its own loading skeleton and will render zeros/`--` briefly on a slow load.
- **Empty, no matches.** Inline `EmptyState` ("No reviews found," description differs for an active search vs. an empty filter view, this can't actually be reached from "no orgs at all" since every organisation always gets a synthetic `not_sent` row).
- **Error.** Not modelled; a failed GET leaves `reviews` as `[]` via the SWR fallback, indistinguishable from a genuinely empty (impossible, per above) result.
- **Read-only Client view.** Structurally impossible: redirects before rendering.
- **375px / 768px.** The row's NPS column (`hidden sm:flex`) and content-indicator icons (`hidden md:flex`) both disappear below their breakpoints, so a 375px view shows org name, status badge and quick actions only, not yet screenshotted live to confirm nothing clips.
- **Dark mode.** Not verified live; tokens used throughout.
- **Generate-draft in flight.** Per-submission loading state on the "Generate draft" button; on success the draft renders as a scrollable `<pre>` block with no save/edit affordance, it is read-only output, not committed anywhere.

### `/announcements`
- **Loading.** `DataTable`'s own skeleton rows via its `loading` prop.
- **Empty, none created.** `EmptyState` ("No announcements yet," "New announcement" CTA).
- **Empty, filtered.** `EmptyState` ("No matches," no CTA, copy tells the user to clear a filter instead).
- **Error.** Not modelled on the list; the create `SlideOver` has its own inline `role="alert"` error banner for a failed POST.
- **Read-only Client view.** Structurally impossible: redirects to `/requests` (not `/overview`, unlike every other page in this group) before rendering.
- **Draft vs Active vs Expired.** Computed client-side from `publishedAt`/`expiresAt` (`getStatus`), not stored, an announcement can silently flip from Active to Expired between two page loads with no notification to the person who created it.
- **375px / 768px.** `DataTable` and `FilterBar` both have project-wide responsive conventions; this specific page has not been screenshotted at either breakpoint.
- **Dark mode.** Not verified live; tokens used throughout.
- **Client-visible banner (downstream, different route).** `<AnnouncementBanner>` self-gates to render nothing when there is nothing targeted and non-dismissed for the signed-in user; per-type colour/emoji, optional CTA, and a dismiss button that persists both to `localStorage` (instant, cross-tab) and server-side (`POST /api/portal/announcements/[id]/dismiss`, cross-device).

## 4. Features and actions

### `/content-studio`

**What works today**
- Full Search Console health scan (batched, resumable via `continueFromIndex`, up to 50 batches) with a persistent diagnostic that survives a refresh, distinct from the in-session error list.
- End-to-end ideation: seed clusters, run ideation (cron-equivalent manual trigger), manually add an idea with AI duplicate-detection, approve/reject, per-idea notes and targeted questions, then hand off into the 23-reviewer round-table pipeline.
- The round-table pipeline itself: strategist brief, drafting, 23 reviewers, conflict resolution with human override, revision history, FAQ generation, cost tracking against configured AI services, and a publish step (now / custom schedule / auto) that writes to Webflow.
- Internal-link suggestion scan, per-suggestion apply (staged Webflow patch) or reject, with a 409 path for a source body that drifted since the scan.
- Schedule tab merges scheduled-but-unpublished drafts with already-published history into one chronological table.
- Site index (per-URL AI summary + embedding) and Audits (23-reviewer round table against already-published posts) both exist and run independently of the drafting pipeline.
- MCP parity is broad for the ideation/drafting side (content tools are wired into the worker MCP per CLAUDE.md rule 14); not independently re-verified in this pass.

**What exists but is wrong or half built**
- **Backfill is duplicated**: a full `BackfillCard` sits at the bottom of the Health tab and an entire separate `BackfillContent` tab exists for what reads as the same staged-edit feature. Nothing in the code explains why both exist; likely one should absorb the other.
- **Content engine ops residue** (TASKS.md, "Content engine ops (Phase I residue)"): migrations 0060 to 0063 need their applied-to-prod state verified; PI-S1/S2/S5/S6.5 need a live QA pass; none of this is visually inspectable from the page itself, but it gates whether the data on screen can be trusted as real.
- **Slice 7 (signal expansion) and Slice 8 (citation tracker)** are named in both TASKS.md and the catalogue as deliberately deferred, not missing by accident, do not design for them.

**What is planned or missing**
- Nothing beyond the deferred Slice 7/8 above is recorded as a numbered backlog gap for this specific page in TASKS.md or the catalogue; the catalogue's own "what is left" for `/content-studio` is exactly "Ops: verify migrations 0060-0063 on prod, live QA passes, Slice 7 and 8 stay deferred," priority 4, 1 day of effort.
- **Proposal**: collapse the Backfill duplication into a single surface (either drop the embedded card from Health or drop the standalone tab).

### `/content-studio/drafts/[id]/round-table`

**What works today**
- The full pipeline visualisation described in section 2: brief, revisions, 23 reviewers grouped by verdict, conflicts with override, cost tracker, service-availability banner, FAQ section, body preview, and an "Advance pipeline" action gated by terminal-status detection.

**What exists but is wrong or half built**
- Nothing specific to this sub-route is named in STATUS.md, TASKS.md or the catalogue beyond the catalogue's own note.

**What is planned or missing**
- Catalogue: "Polish only," priority 4, 0.5 day, the catalogue does not itemise what the polish covers, so treat this as open scope for the design pass rather than a known punch list.

### `/sitemap`

**What works today**
- Full node CRUD (add page/section/CMS-collection, edit every metadata field, Tiptap body, duplicate, delete), a per-node six-reviewer AI critique, a whole-sitemap Boardroom run with a cost estimate and a confirm gate, and an export of the full bundle.
- The 768px-and-below responsive collapse is real and deliberate (see section 3), unlike the rest of this group.

**What exists but is wrong or half built**
- Nothing page-specific is recorded in STATUS.md or TASKS.md; the catalogue instead frames the entire page's future as conditional (see below).

**What is planned or missing**
- Catalogue: "Design if it ever leaves the email allowlist; otherwise nothing," priority 4, 0.5 day. TASKS.md's Batch J closing note explicitly parks `/sitemap` alongside `/social` and a handful of others "until Batch J lands," and the catalogue also flags it as "missing from the checklist's own bookkeeping" (i.e. even the person maintaining the design-review checklist forgot this page exists). This is the one page in the group whose entire need for a design pass is conditional on a product decision, see section 7.

### `/social`

**What works today**
- A real, working read-only mirror of Buffer: connected-channel list, 30-day cadence histogram, scheduled queue, recent posts, and an honest, explicit disclaimer that per-post engagement is unavailable from Buffer's API rather than being faked or omitted silently.
- Three real configuration states (not configured / configured-not-connected / connected) each with distinct, if not design-system-consistent, messaging.

**What exists but is wrong or half built**
- **Zero use of the shared component library beyond `Badge`, `TahiButton` and `LoadingSkeleton`** (catalogue: "Legacy (Badge, LoadingSkeleton, TahiButton)"). No `PageHeader`, no `Card`, no `EmptyState`, no `KPIStrip`, no `DataTable`, every card, KPI tile and empty/error message on this page is a bespoke inline-styled `<div>`. This is the least design-system-compliant page in the entire group.
- **No `EmptyState` component anywhere**, so CLAUDE.md's "every list view must handle loading, empty (leaf icon + title + description + CTA), and populated" rule is not met structurally even though the underlying empty/error conditions are all correctly detected.

**What is planned or missing**
- Catalogue: "Design and v3 lap," priority 4, 1 day. TASKS.md's Batch J closing note also parks `/social` "until Batch J lands," alongside `/sitemap` and `/affiliates`.

### `/reviews`

**What works today**
- The read/list side is real: every organisation is listed with its live outreach status, NPS, permission flags, testimonial text, video link, and Clutch link, with working filters, search and a manual status-change control covering all seven states.
- AI case-study draft generation from a completed submission is a real, working call, rendered inline.

**What exists but is wrong or half built, this page actively lies to whoever uses it (catalogue's own wording)**
- **CT.15**: the Send button (the per-row Send icon, visible only while `outreachStatus` is `not_sent`) sends nothing. It calls `updateStatus(orgId, 'asked')`, which only writes the status column, no email, no notification, no message ever leaves the platform. A user clicking Send has every reason to believe an ask went out to the client; it did not.
- **CT.15**: Copy review link produces a URL of the shape `/review?token=<token>` (a query-string form), but the only page that exists is `/review/[token]/page.tsx` (a path-segment form). The copied link 404s for the client every time.
- **Decision #018 / catalogue**: `videoUrl` and `caseStudyInterest` (the client's own submission answers) are read by this page but, per the catalogue, "never persist" on the client-side submission flow that is supposed to write them, meaning what the studio side happily displays may not reliably reflect what a client actually submitted, depending on how far that submission-side gap extends.
- **Decision #018**: the decision record calls for an "Approved Case Studies" admin view once a client approves marketing/logo/case-study permission; no such view exists anywhere in this codebase (confirmed by file search, there is no `/case-studies` or "approved" listing page). The Generate-draft button on this page produces a one-off draft, not the persisted, browsable library the decision describes.
- **Orphaned outreach routes**: TASKS.md's CT.15 line and Batch D4 both call out "the orphaned outreach routes" as needing deletion or repair alongside Send and Copy link; this pass has not independently traced every one of those routes, so treat "which routes are orphaned" as something the implementation side resolves, not something to design around blindly.

**What is planned or missing**
- **CT.15** (1 day, FE): fix or delete Send and Copy link.
- **Decision #018 / catalogue functionality note** (bundled with CT.15's family in the catalogue, 1 day to delete the lies plus 3 days for the real pipeline): a working Send, a correct review link, persisted `videoUrl`/`caseStudyInterest`, and the Approved Case Studies view.
- **Batch D4** (TASKS.md): "CT.15, delete the lies on `/reviews` (Send, Copy link, orphaned outreach routes)" is explicitly sequenced after Batch C (the deliverable-truth work) in the plan of record.

### `/announcements`

**What works today**
- Full create-and-list flow for a draft or immediately-published announcement, targeting all clients or a specific plan type, with an expiry date, and a working DataTable with sort/filter/search.
- The publish-time email fan-out (`POST /api/admin/announcements/[id]/send`, also reachable via `send_announcement` on the worker MCP) is a real, guarded implementation: it will not double-send (`emailSentAt` is checked before fan-out), a delivery failure never blocks the publish, and it honours each announcement's own `sentByEmail` flag and per-contact notification preferences through the shared fan-out used elsewhere.
- The client-facing `<AnnouncementBanner>` honestly self-gates (renders nothing when there is nothing to show) and its dismiss is genuinely cross-device (server-persisted), not just a local hide.

**What exists but is wrong or half built**
- **The "Specific clients" audience option is unusable from this UI.** The create form's Audience `Select` offers `all` / `plan_type` / `org` (labelled "Specific clients"), but only `plan_type` gets a follow-up control (the Plan select); choosing `org` collects no `targetIds` anywhere in the form. The API (`POST /api/admin/announcements`) explicitly refuses an `org`-targeted announcement with no `targetIds` ("An org-targeted announcement nobody can see is a publish that lies"), so selecting this option and submitting will 400 with no client picker ever having been shown to explain why.
- **No emoji or CTA fields in the create form**, despite the API accepting `emoji`, `ctaLabel` and `ctaUrl` and the client-facing banner fully supporting both (a lead emoji per type with a manual override, and an optional CTA button). Every announcement created through this UI is therefore emoji-default and CTA-less, even though the surface it renders on was built to carry both.
- **No "send email" toggle in the create form**, despite the API accepting `sendEmail` and a whole fan-out pipeline existing behind it; every announcement created through this UI is banner-only, in-app, with no path to the Resend email channel at all from the studio side.
- **No Edit, Delete, or Publish-later action anywhere.** The View slide-over is read-only (Close only); a draft created without the "Publish immediately" checkbox has no visible way to publish it afterward from this page, even though `POST /api/admin/announcements/[id]/send` exists and is wired for exactly that.
- **Draft/Active/Expired status is computed, not stored**, so an announcement silently expires with no notice to whoever created it and no "expiring soon" warning anywhere in the list or detail.
- **W-QA (STATUS.md)**: the entire email fan-out path "has never been smoke-tested live", treat the send/email behaviour as unverified in production even though the code path looks complete.

**What is planned or missing**
- Nothing beyond the gaps above is separately itemised in TASKS.md for this specific page; T1.16 ("per-org scoping rollout," Batch B) lists `announcements` among the routes still needing scoping verification, but the live route code (`app/api/admin/announcements/route.ts`, `_access.ts`) already calls `scopedOrgIds`/`canReadAnnouncement`/`canWriteAnnouncement` on both GET and POST, this looks like it may already be done and TASKS.md's checkbox is stale; worth a quick re-verify rather than re-scoping from scratch.
- **Proposal**: add a client picker for the "Specific clients" audience option (or hide the option entirely until one exists), add the emoji/CTA fields, add a "send email" toggle, and add Edit/Delete/Publish-later actions to the row and the View slide-over.

## 5. Data and integrations

- **`/content-studio`**: content-pipeline tables (ideas, clusters, drafts, revisions, per-revision reviewer critiques, conflicts, link suggestions, publish history, site-index rows, AI spend log) behind `/api/admin/content/*`, `health`, `health/scan`, `spend`, `ideas`, `ideas/[id]`, `ideas/[id]/round-table`, `ideas/manual`, `clusters`, `clusters/seed`, `drafts`, `drafts/[id]`, `drafts/[id]/publish`, `links/suggestions`, `links/scan`, `links/[id]/apply`, `links/[id]/reject`, `schedule`, plus a cron endpoint (`/api/admin/cron/ideation`). Third parties: Google Search Console (health scan), Anthropic/OpenAI/Perplexity/Replicate (drafting, reviewing, ideation, surfaced honestly as per-provider spend and per-service availability flags), Webflow (the actual publish target and the internal-link patch target). Must be honest: the AI-spend strip and cost tracker must reflect real provider spend, never a placeholder; a staged Webflow patch must not be described as "published" until it actually is.
- **`/content-studio/drafts/[id]/round-table`**: same tables as above, read at the single-draft level, plus `linkCheck` (dead-link detection against the drafted body) and `voiceWeights` (per-brand voice tuning weights).
- **`/sitemap`**: `sitemapNodes` and a per-node/whole-site AI review table, behind `/api/admin/sitemap/nodes`, `nodes/[id]`, `nodes/[id]/duplicate`, `nodes/[id]/review`, `nodes/[id]/review-all`, `review-site`, `export`. Third party: Anthropic (the six reviewers, and the Boardroom run). Must be honest: the Boardroom's cost estimate shown in its confirm dialog (~$0.30) should track whatever the real per-run cost is, not a stale hardcoded guess, if that ever drifts.
- **`/social`**: no local persistence beyond whatever caching SWR itself does; every read is live against Buffer's GraphQL API via `/api/admin/integrations/buffer/status` and `/api/admin/integrations/buffer/posts`. Third party: Buffer (`BUFFER_API_KEY`). Must be honest: never fabricate engagement numbers Buffer doesn't expose (already correctly avoided today); the "Cadence" KPI's "consistent/building/getting started" labels should stay tied to a real day-count threshold, not vibes.
- **`/reviews`**: `caseStudySubmissions` (org outreach status, NPS, testimonial text, video URL, marketing/logo/case-study permission flags, Clutch URL, submission token) joined against `organisations`, behind `GET`/`POST /api/admin/reviews` and `/api/admin/case-studies/draft`. The client-facing submission side lives at `/api/public/review`, `/api/portal/review-outreach`, and the public form at `/review/[token]`. Must be honest, and currently is not on two specific points (see section 4): the Send action must not claim a message went out unless one did, and the copied link must resolve to a real page.
- **`/announcements`**: `announcements` and `announcementDismissals`, behind `/api/admin/announcements` (GET/POST), `/api/admin/announcements/[id]` (referenced by the view/edit surface), `/api/admin/announcements/[id]/send` (publish + email fan-out), and the client-facing `GET /api/portal/announcements` / `POST /api/portal/announcements/[id]/dismiss`. Third party: Resend (`fanOutAnnouncementEmails`, a shared React Email template also used by other notification paths). Must be honest: "Publish immediately" must mean immediately live on the client banner, not eventually; the email-sent count returned by the send route must reflect real deliveries, not an assumed one-per-target count; and the create form must not offer an audience option ("Specific clients") that the API will reject with no explanation shown to the user (current bug, see section 4).

## 6. Design system contract

**Primitives already in use, inconsistently, across the group:**
- `PageHeader`: used by `/content-studio` and `/sitemap`. `/reviews` and `/announcements` both build their own inline `<h1>`/`<p>` header block instead. `/social` does the same with a hand-rolled flex header.
- `Card`: used by `/content-studio` (tab bodies, empty states) and `/announcements` (table wrapper, stat-adjacent framing). `/reviews` wraps its whole list in one `Card` but its per-row expansion and stat tiles are bespoke `<div>`s. `/social` uses none.
- `DataTable`: used by `/content-studio`'s Health tab and by `/announcements`. `/reviews` uses a hand-built expandable-row list instead of `DataTable`, and `/social` has no tabular data at all (a card+chip pattern for channels, a bar-chart for cadence, list `<ul>`s for posts).
- `EmptyState`: used by `/content-studio`, `/sitemap`, `/reviews` (inline variant), and `/announcements`. `/social` has none, every "nothing here" and every error condition on that page is a plain coloured `<div>` with a string, not the leaf-icon/title/description/CTA pattern CLAUDE.md requires for every list view.
- `KPIStrip`/`KPICell`: used by `/content-studio`'s Health tab only. `/reviews` (`StatCard`) and `/social` (`KpiCard`) each independently reinvent the same "label, big number, subtitle" tile with their own bespoke component, in slightly different visual language (icon top-right pill vs. no icon, upper-case label styling differences). This is duplicated pattern-building the redesign should collapse into one shared component all three consume.
- `FilterBar`: used by `/announcements`. `/reviews` uses `PageToolbar.Search` plus its own bespoke tab-button strip rather than `FilterBar`'s multiselect chips. `/content-studio`'s eight-tab strip is its own bespoke tab implementation (explicitly commented as matching "the client-detail tab pattern"), not `FilterBar`.
- `SlideOver`: used extensively and consistently on `/content-studio` (idea detail, manual-idea create, draft detail, schedule-row detail) and `/announcements` (view, create). Not used on `/sitemap`, `/social`, or `/reviews`, none of those three currently needs a slide-over, but if the redesign adds a detail surface to any of them, `SlideOver` is the established pattern to reach for rather than a new bespoke panel.
- **Bespoke dialogs**: `/content-studio`'s `PublishModal` is a hand-rolled centred `role="dialog"` overlay (fixed inset, `rgba(0,0,0,0.45)` scrim, hardcoded `border-radius: 0.75rem`), consistent with the project's existing convention of per-feature bespoke modals (there is no shared `Modal` primitive in `components/tahi` at all, `confirm-dialog.tsx`, `email-share-modal.tsx`, `new-request-dialog.tsx`, `new-schedule-dialog.tsx` and `prompt-dialog.tsx` are all their own bespoke implementations too), but it does not reach for the leaf-radius tokens CLAUDE.md specifies for this kind of chrome.
- **Leaf radius** (`--radius-leaf`/`-sm`/`-lg`): not confirmed in use anywhere in this group's five pages. CLAUDE.md reserves it for icon backgrounds, avatar wrappers, primary CTAs and feature callouts, the redesign should audit every icon tile, primary button and callout card across all five pages against this token rather than assume it is already applied.
- **Dark mode tokens**: all five pages route colour through `var(--color-*)` CSS custom properties rather than hardcoded hex, so dark mode should work by construction; none of the five has actually been screenshotted with `.dark` applied in this pass.

**What the (nonexistent) design file gets right:** nothing, there is no design file for any page in this group to inherit from. This is a from-scratch design pass.

**What the design must establish, since there is nothing to critique against:**
- Bring `/social` up to the same primitive baseline as the rest of the dashboard: `PageHeader`, `Card`, `EmptyState` (all three configuration/error/empty states currently rendered as raw coloured `<div>`s), and either `DataTable` or a deliberately-chosen card grid for the post lists rather than bare `<ul>`s.
- Bring `/reviews` onto `DataTable` (or a documented, deliberate reason not to, given how well its current expand-in-place row pattern may already serve its own purpose) and onto the shared `KPIStrip` instead of its own `StatCard`.
- Bring `/announcements` and `/reviews` onto `PageHeader` instead of their bespoke inline headers.
- Decide, once, whether `/content-studio`'s eight-tab pattern should become a `FilterBar`-driven experience or stay the bespoke "client-detail tab pattern" it already deliberately mirrors, either is defensible, but the choice should be made explicitly for this pass rather than left to whichever tab was built most recently.
- Resolve the Backfill duplication (embedded card vs. standalone tab) as part of the same design decision, not as an afterthought.
- Give `/announcements`' create flow a real audience picker for "Specific clients" (the API already requires and supports `targetIds`), plus emoji/CTA fields and a send-email toggle, since the client-facing banner and the backend both already support all of it.

## 7. Open questions for Liam

- Should `/reviews`' Send button be built for real (an actual email via the same Resend fan-out `/announcements` already uses), or removed entirely until a real send exists, leaving only Copy link (once that link is fixed) as the outreach action? (A: build a real send / B: remove Send, keep Copy-link only)
- Should the "Specific clients" audience option in `/announcements`' create form get a client picker now, or should it be hidden from the dropdown until a picker is built? (A: add the picker now / B: hide the option until it's ready)
- Is `/sitemap` ever going to leave the two-person email allowlist and become a normal permission-gated page any admin or granted team member can open, or does it stay a permanent Liam-and-Staci-only planning tool? The catalogue's own scoping of this page's design need depends entirely on this answer. (A: eventually open it up to more roles / B: stays allowlist-only forever)
- Should `/content-studio`'s duplicated Backfill surface (its own tab, and an identical card embedded under Health) collapse into one location, and if so, which one survives? (A: keep the standalone tab, drop the embedded card / B: keep the embedded card, drop the standalone tab)
- Should `/social` gain any write capability (composing or scheduling a post from inside the dashboard), or stay a deliberately read-only mirror with "Open Buffer" as the only path to actually post? (A: add compose/schedule / B: stay a read-only mirror)
- Should an "Approved Case Studies" admin view (Decision #018) be scoped into this same design pass alongside `/reviews`, or treated as a separate, later piece of work once the Send/Copy-link lies are fixed first? (A: design it now, in this pass / B: defer it to a later pass after CT.15 lands)

## 8. Acceptance for the design review

- At 1440 and at 375, all five pages (and the round-table sub-route) render with no horizontal scroll and no clipped or truncated primary content; `/content-studio`'s eight-tab strip and `/social`'s 30-bar cadence chart are the two highest-risk elements at 375px and should be checked first.
- Every state named in section 3 for each page (loading, first-time empty, filtered/no-matches empty, and, where one is designed in, an explicit error state distinct from empty) is present and visually distinguishable, with `/social`'s three configuration states rebuilt onto the shared `EmptyState` pattern rather than raw coloured banners.
- `/announcements`' create flow shows a working, honest path for every audience option in its own dropdown, no option that will 400 on submit with no explanation, per the "Specific clients" bug in section 4.
- Dark mode (`.dark` class applied) shows no contrast regressions on any KPI tile, badge, banner, tab strip, or slide-over across all five pages.
- `/reviews`' Send and Copy-link affordances either genuinely work (real send, a link that resolves) or are visibly absent from the reviewed design, the design must not perpetuate a button that looks actionable but does nothing.
- `/sitemap`'s two-pane layout collapses cleanly at 768px and below (tree capped and independently scrollable, detail pane flowing with the page) exactly as the live CSS already intends, so the redesign should preserve this behaviour rather than regress it.
- Every icon background, primary CTA, and feature-callout card across the group uses the leaf radius (`--radius-leaf`/`-sm`/`-lg`) per CLAUDE.md, not an ad hoc border-radius value (the current `PublishModal`'s `0.75rem` is the one already-known offender to fix).
- Every touch target across all five pages is at least 44px tall at 375px, matching CLAUDE.md's mobile rule, `/reviews`' per-row icon-only quick actions (Send, Copy link) are the most likely candidates to check first.
- The two duplicated KPI-tile implementations (`/reviews`' `StatCard`, `/social`'s `KpiCard`) are shown in the reviewed design as one shared component, not two visually-similar-but-different ones.
