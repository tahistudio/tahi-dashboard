# Design requirements: studio-leads

Routes: `/leads`, `/leads/[id]`
Group audience: studio (Tahi team only)
Prepared 2026-09-13 for the Claude Design pass. Source: CLAUDE.md, STATUS.md, `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md, the live code under `app/(dashboard)/leads`, `app/api/admin/leads`, and the Claude Design file `sales-pipeline.jsx` (Leads and LeadDetail sections, read directly from the design project).

---

## 1. Purpose and audiences

Leads is the pre-qualification inbox that sits in front of the sales pipeline (Deals). A prospect lands here (Webflow form, referral, manual entry, cold outreach, an affiliate code) before there is an organisation, a contact or a deal for them. The job of the page is: capture the prospect, let AI research and score them, hand the studio a discovery-call script, and either promote them into a deal (creating the organisation, contact and deal in one step) or archive them.

Who opens it: Liam (founder) today, and any teammate later granted the `leads` permission. There is currently no second team member, but the permission model is already built for one (see Decision: team access scoping in CLAUDE.md, Batch 2).

Audience: studio only, always. This is not a client-facing surface in any form, and there is no read-only or client variant.

What it must never show:
- **Never reachable by a client.** Both `app/(dashboard)/leads/page.tsx` and `/leads/[id]/page.tsx` redirect to `/overview` when the caller is not an admin, and also redirect a client-view-mode preview (`isPreviewingClient`, the `tahi-impersonate-org` cookie) even though that cookie belongs to a Tahi admin acting as a client, so a studio member previewing a client's portal can never see another client's lead data leak through. There is no client half of this page anywhere in the file structure, sidebar, or API surface.
- **Permission-gated per team member, deny by default.** Both pages call `requirePageFeature('leads')`, and every API route calls `requireFeature(..., 'leads')`. A Tahi-org identity with no role assignment sees nothing (CLAUDE.md granular permissions rule: "visible = permitted, clickable = allowed, absent = denied"). This is not tenancy scoping (leads have no `orgId` until promoted) - it is a single studio-wide feature gate, same as Deals, Calls, Proposals.
- **Not a Messages surface.** No conversation, thread or client-visible messaging touches this page; the "Messages hidden for clients" rule from STATUS.md does not apply here because clients never reach this surface at all.
- **No super-admin-only sub-area.** Every studio member with the `leads` grant sees the whole page; there is no super-admin-only slice inside it (unlike, say, danger-zone actions elsewhere).

---

## 2. Pages, sub pages and entry points

- **`/leads`** - the list page. Entry points: sidebar "Sales > Leads" (adminOnly nav item), or a direct link. Renders `LeadsContent`.
  - **Quick-view slide-over** - opens over the list on row click, or via the row action "Quick view (slide-over)". State lives in React state (`selectedLead`), not the URL, except for one case below. Shows the read-only `LeadDetail` view: badges (status, source, estimate, affiliate code), a detail grid (email/phone/company/job title/website/source detail/owner), the AI section (score, reasoning, Run/Re-run AI button, auto-fill suggestion banner, Discovery-call questions, Briefing, Company signals, Sources, token spend, enrich error box), a promoted-deal banner and link when applicable, the shared `DiscoveryCallsCard`, and an activity timeline.
  - **Edit mode inside the same slide-over** - toggled by the "Edit" footer button or row action. Swaps the body for `LeadForm` (name, email, phone, company, job title, website, source + source detail, estimated value + currency, brief). Also reachable pre-opened-in-edit via `?lead=<id>` in the URL (used by the full-page detail's own "Edit" link, which navigates back to the list with that query param).
  - **New-lead slide-over** - opened by the "New lead" header button. Same `LeadForm`, footer is "Create lead".
  - **Bulk-import slide-over** - opened by the "Bulk import" header button. Currently a thin panel (see section 4) with no paste/map/preview flow live yet.
  - **Delete confirm dialog** - from the row action menu, the quick-view footer, or the full-page Delete button.
  - **Promote confirm dialog** - from the row action menu ("Promote to deal"), the quick-view footer, or the full-page "Promote to deal" button. On confirm, POSTs to the promote route and, on success, hard-navigates to `/deals?deal=<dealId>`.
  - **Re-enrich confirm dialog** - fires automatically after a save when website or company changed on a lead that has prior enrichment and has not suppressed the prompt (`enrichRepromptSuppressed`). Has a secondary "Don't ask again" action that PATCHes the suppression flag.
  - Row-level status change is inline (a `DataTable` cell editor, no dialog) and optimistic.

- **`/leads/[id]`** - the full-page lead workspace (`LeadPageContent`). Entry points: DataTable row click (`onRowClick` hard-navigates here), the row action "Edit" (goes here via `startEdit` in some flows) - actually the list's row click always goes to the full page; the slide-over "Quick view" action is the only way to stay on the list. Breadcrumb back to `/leads`.
  - **Edit-in-place** (not a separate route or dialog) - the whole page (Person card, Company card, Brief) swaps into edit fields when "Edit" is clicked; Save/Cancel appear in the hero.
  - **AI briefing card** - score-history sparkline (parsed from the activity timeline), score reason, structured briefing (Snapshot / Why they might fit / Watch-outs, falling back to plain text for legacy summaries), company signals, sources list, token spend. Only rendered once `enrichedAt` is set.
  - **AI first reply card** - only rendered when the lead has an email. Before a draft exists: one button, "Draft a reply". After a draft exists: editable subject + body, Send / Regenerate / Dismiss, token spend. This is a studio-authored outbound email generated and edited before send, distinct from the client-portal Messages system.
  - **Discovery call card** - the shared "always ask" template plus AI-generated per-lead questions.
  - **Calls** - the shared `DiscoveryCallsCard` (schedule, edit, extract-insights, promote-to-deal from a call). Same component used on Deals.
  - **Activity composer + timeline** - a note textarea (Cmd/Ctrl+Enter to save) plus a reverse-chronological feed of every system and human event.
  - **Person / Company / Source sidebar cards** - firmographics fields not present on the list's slide-over form: industry, employee count, revenue band, monthly visits, lead type, LinkedIn (personal and company), tech stack, CMS, country, year founded. These are 0047-migration columns the list-page `LeadForm` does not expose at all (see section 4).
  - **Owner and status quick-pickers** - native `<select>` elements in the hero, always editable, no edit-mode required (PATCH fires immediately).
  - Delete and Promote confirm dialogs, same semantics as the list page.

There is no kanban/board view of Leads (unlike Deals), no bulk-select UI, and no "Studio tools" menu (rescore/triage/backfill) anywhere in the live port - see section 4.

---

## 3. States and variants

One line per state, per page, only where the state is meaningfully different from "normal."

- `/leads` loading: `DataTable`'s built-in loading skeleton (`loading={loading}` from SWR `isLoading`); no page-level skeleton exists in the code today.
- `/leads` empty (no leads at all): EmptyState title "No leads yet", description "Capture your first lead manually, or wait for one to land via Webflow / referral.", CTA "New lead".
- `/leads` empty (filtered to nothing): EmptyState title "No matches", description "Try clearing a filter or adjusting your search.", no CTA.
- `/leads` error: none rendered today - a failed `useSWR` fetch leaves `leads` as `[]` (SWR error is not surfaced to the user; no `ErrorState` component is used, unlike the design file's `demo='error'` variant).
- `/leads` populated: DataTable with default sort "Updated" desc, default status filter pre-set to `new, qualifying, nurturing` (promoted/archived hidden until the filter is cleared).
- `/leads/[id]` loading: plain text "Loading lead..." (no skeleton card, unlike the design's `SkelCard` layout).
- `/leads/[id]` not-found/error: plain text "Lead not found." with a link back to `/leads`. No distinction between a 404 and a network error.
- `/leads/[id]` populated, not enriched: AI briefing card and AI-questions-for-this-lead section are absent entirely (only the "always ask" discovery block shows, if a template exists); "Run AI" button reads "Run AI" not "Re-run AI".
- `/leads/[id]` populated, enriched: full AI briefing, sparkline, signals, sources; button reads "Re-run AI".
- Read-only Client view: not applicable - there is no client rendering path for this route at all (redirect, section 1).
- Member seat vs admin seat: both are "admin" seats in the Clerk model (only `isAdmin` matters), but within the Tahi org the `leads` feature grant can be withheld per team member via the permissions builder; a denied teammate is redirected server-side and the sidebar item is hidden. There is no partial/read-only teammate variant - grant or no grant.
- 375px: the list page has no left rail (uses `FilterBar` above the table) and no card fallback for mobile - the `DataTable` is the only rendering path, so at 375px the table scrolls horizontally inside its `Card`. The full-page detail's two-column grid (`lg:grid-cols-[2fr_1fr]`) collapses to one column below the `lg` breakpoint, which does cover 375 and 768 correctly.
- 768px: same collapse behaviour as 375 for the detail page; the list page's `FilterBar` wraps (`flexWrap`) and the header actions wrap.
- Dark mode: all styling in both files uses `var(--color-*)` tokens exclusively (no hardcoded hex found), so dark mode should follow the global token set without extra work, but it has not been screenshotted in `.dark` as part of any recorded QA pass for this route.
- Print or public: not applicable - internal tool only, no share link, no PDF.

---

## 4. Features and actions

### `/leads` (list)

**Works today:**
- List with search (name/email/company/brief) and multiselect filters for status and source (`FilterBar`), client-side.
- Sortable columns: Lead (name), Status, AI score, Source, Estimate, Owner, Updated.
- Inline status change per row (optimistic, then PATCH, then refetch).
- Row actions: quick view, edit, promote to deal (hidden once promoted), delete.
- Create lead (slide-over form), edit lead (same form), delete with confirm, promote with confirm and org/contact/deal creation, all wired to real endpoints.
- `?lead=<id>` deep link auto-opens the slide-over in edit mode.
- Auto-prompt to re-run AI enrichment after a save that changed website or company, with a "don't ask again" per-lead suppression.
- Run AI (enrich) and view the result inline in the slide-over.
- Website favicon-style external-link icon per row when a website is set.

**Exists but wrong or half built:**
- **Bulk import** (backlog: catalogue `/leads` row, "port: swap composition") - the header button opens a slide-over, but the panel itself is a thin wrapper (`BulkImportPanel`, not shown in the excerpt above but confirmed present) while the backend route `POST /api/admin/leads/bulk-import` already supports a full paste-CSV → column-mapping → dry-run-preview → import flow with a 2,000-row cap and duplicate-skip option. The Claude Design file's `ImportPanel` shows the intended three-phase UI (paste, map, preview-and-import) that the live port has not fully matched.
- **No bulk selection or bulk action bar** - `components/tahi/data-table.tsx` already supports `selectable` + `onSelectionChange` (used elsewhere in the app), and the backend `POST /api/admin/leads/bulk-actions` already implements `archive`, `rescore`, `assign_owner`, `set_status` and `delete` (with a typed `DELETE` confirm guard) - but `leads-content.tsx` never passes `selectable` to `DataTable`, so none of this is reachable from the UI. This is a straight design-and-port gap, not a backend gap.
- **No "Studio tools" menu** - the backend has three working, permission-gated batch tools (`POST /api/admin/leads/rescore-all`, `POST /api/admin/leads/triage-pipeline`, `POST /api/admin/leads/backfill-fields`), each with its own dry-run semantics, but the live page has no entry point to any of them. The Claude Design file already specifies this exact menu (a "Studio tools" dropdown next to Bulk import/New lead, opening a `Modal` per tool with a dry-run-then-apply pattern) and gives copy for all three.
- **Design verdict pending re-verification** - catalogue says `sales-pipeline.jsx` was marked FIX at Pass 3 ("OWNER and TOUCHED columns lost to the new rail, NEXT STEP clips mid-word"), but the design-review-checklist instead records "design approved as-is (AR.3)". Reading the file directly today, the table header does include both an Owner and a Touched column and a rail (`Rail`/`RailLayout`) - STATUS.md notes "the WRITESET re-check believes fixed it but never verified live." Treat the Owner/Touched/Next-step-clipping question as open until a reviewer looks at the rendered shell, not just the source.

**Planned or missing (backlog id where one exists):**
- Left filter rail (design has Views + Filters + Sort in a collapsible `Rail`; live page uses a flat `FilterBar` instead) - part of AR.5 ("filters in a left rail on every list page... apply in Claude Design... then port") and the general port-status "Not ported" line for this route in the catalogue.
- "Next step" column (due-date chip, sortable) - present in the design, absent from the live table.
- "Touched" recency colour-coding (green/amber/red by days since last touch) - present in the design (`touchedTone`), the live "Updated" column is plain text.
- Score-band colour thresholds already match (design and live both use 80/60/40 cutoffs), so this is one thing that does NOT need a design decision, just confirmation the port carries it over unchanged.
- Mobile card list (design has a dedicated `LeadCard` grid for `isMobile`; live page relies on table horizontal scroll only) - proposal: if Liam wants a card fallback below a breakpoint rather than horizontal scroll, that is a net-new decision, not backed by any TASKS line today. Mark as **proposal**.
- Per-row "Schedule a call" and "Archive with a reason" quick actions shown in the design's row menu are not implemented in the live row-action menu (only Delete has a confirm; archive happens via the status dropdown with no reason field, and scheduling a call requires opening the lead first).

### `/leads/[id]` (workspace)

**Works today:**
- Full read/edit of every lead field including the 0047 firmographics set (industry, employee count, revenue band, monthly visits, lead type, LinkedIn x2, tech stack, CMS, country, year founded) that the list-page slide-over form does not expose.
- Owner and status quick-pickers, always editable, independent of edit mode.
- AI enrichment (Run/Re-run), AI first-reply draft/edit/send/regenerate/dismiss (this is a real outbound-email feature via Resend, not present at all in the design file, which only stubs a "Draft reply" button that fires a toast).
- Score-history sparkline parsed live from the activity feed.
- Discovery calls (shared component: schedule, edit link-and-purpose, post-call notes, AI action-item extraction, promote a call directly to a deal).
- Activity note composer and timeline.
- Delete and promote, same semantics as the list.

**Exists but wrong or half built:**
- Loading and not-found states are unstyled plain text, not the skeleton-card layout the design specifies for loading and the `ErrorState` component the design specifies for a fetch failure.
- `AR.5` (headline-card consistency) is explicitly called out for this page in the catalogue ("Polish: consistent headline card per AR.5") - the hero is a bespoke flex header, not the shared PageHeader/headline-band pattern used on Requests and Tasks.

**Planned or missing:**
- No standalone critic verdict exists for `/leads/[id]` - catalogue: "Part of the `sales-pipeline` set, no standalone verdict." Port ordering per the catalogue is "Port after the list re-critique," i.e. this page should not be redesigned in isolation from the list.
- Automation surfacing: Settings has a working "Lead automations" section (`leads.cronEnabled` master switch, a default-lead-owner setting used by `finance-anomaly-scan`) but neither lead page links to or explains that cron - a teammate has no way to tell from this page whether the daily AI cron is on, or when it last ran, other than the per-lead `lastAiRunAt`/`enrichedAt` timestamps.

---

## 5. Data and integrations

- **Tables:** `leads` (name, contact fields, source/sourceDetail/affiliateCode, brief, estimatedValue/currency, status, archiveReason, ownerId, promotedDealId/promotedAt, the 0047 firmographic columns, and the AI columns `aiScore`/`aiScoreReason`/`aiSummary`/`aiSources`/`aiQuestions`/`aiSignals`/`enrichedAt`/`lastAiRunAt`/`aiTokensSpent`/`enrichRepromptSuppressed`), `people` (canonical identity a lead resolves against via `lookupOrCreatePerson`, so the same human keeps one record across lead/contact/team-member roles), `activities` (lead-scoped rows: notes, `lead_scored`, `lead_enriched`, `lead_status_changed`, "demoted from pipeline"), `teamMembers` (owner), `deals`/`organisations`/`contacts` (created on promote), `project_schedules` (can carry a `lead_id` for a pre-deal AI-drafted schedule), `settings` (`leads.cronEnabled`, a default-lead-owner key), and the AI reply-draft table backing `/api/admin/ai-reply-drafts/[id]`.
- **API routes:** `GET/POST /api/admin/leads`, `GET/PATCH/DELETE /api/admin/leads/[id]`, `POST /api/admin/leads/[id]/promote`, `POST /api/admin/leads/[id]/enrich`, `POST /api/admin/leads/[id]/draft-reply`, `PATCH/DELETE /api/admin/ai-reply-drafts/[id]` and `.../send`, `GET/POST/PATCH/DELETE /api/admin/leads/[id]/calls`, `POST /api/admin/leads/bulk-import`, `POST /api/admin/leads/bulk-actions`, `POST /api/admin/leads/rescore-all`, `POST /api/admin/leads/backfill-fields`, `POST /api/admin/leads/triage-pipeline`, `GET /api/admin/export/leads` (CSV), `POST /api/admin/activities` (note composer), `GET /api/admin/team-members` (owner picker), and the cron `POST /api/admin/cron/leads-ai`.
- **Third parties / systems:** Claude Haiku (cheap scoring, `SCORE_MODEL = claude-haiku-4-5-20251001`) and a Sonnet pass for full enrichment (research + briefing + signals + sources + discovery questions), gated behind `leads.cronEnabled` in Settings; Resend for the AI first-reply send; the MCP worker exposes matching tools (`create_lead`, `update_lead`, `delete_lead`, `promote_lead`, `enrich_lead`, `bulk_import_leads`, `leads_rescore_batch`, `triage_pipeline_to_leads`, `list_lead_calls`/`schedule_lead_call`/`update_lead_call`, `apply_lead_ai_suggestions`, `get_lead_ai_briefing`) per CLAUDE.md rule 14 MCP parity.
- **Must stay honest:** AI score/summary/signals must always show their source URLs (already the case - `SourcesToggle`/sources list) rather than presenting a claim with nothing to check it against; token-spend figures shown are real (`aiTokensSpent`), not estimated; the "Studio tools" dry-run pattern (rescore/triage/backfill) must keep its dry-run-first default in any ported UI - the backend defaults `dryRun` to true on `triage-pipeline` and requires an explicit apply, and that must not become a single "no undo" button in the design port.

---

## 6. Design system contract

- **Primitives that must be used:** `PageHeader`/headline band (both pages currently use ad hoc `<h1>` + description blocks, not the shared component used on Requests/Tasks - AR.5 names this as an open consistency debt); `DataTable` (already used on the list, with `selectable` available but unused); `SlideOver` (already used correctly for quick view/edit/new/bulk import); `FilterBar` today, but the design system's `Rail`/`RailLayout`/`RailSec`/`RailItem` left-rail pattern is the one AR.5 wants ported everywhere lists exist, Leads included; `ConfirmDialog` (already used); leaf radius (`--radius-leaf`) on primary CTAs like "New lead" and "Promote to deal" - verify this is actually applied, not just a plain rounded button, once ported; CSS var tokens throughout (already true in both files - no hardcoded hex was found in either).
- **What the existing design file gets right:** a working left rail with Views (Working set / All leads / per-status) and Filters (owner, score threshold, source) plus a Sort section, replacing the flat filter bar; a `StatBand` header strip (Warm/New this week/Gone quiet/Promoted) the live page has no equivalent of at all; a bulk-selection checkbox column and `BulkBar` (assign owner, set status, re-score, archive, delete) that maps one-to-one onto the already-built `bulk-actions` API; a "Studio tools" menu wrapping the three batch endpoints in a dry-run-then-apply `Modal` pattern; a `LeadDrawer` "peek" pattern for a fast AI-briefing glance without leaving the list, plus a full `LeadDetail` hero with quick-pickers for status/owner and a score dial with sparkline; a three-phase (paste → map → preview) bulk-import panel; consistent `EmptyState`/`ErrorState`/skeleton coverage across every demo state (`ready`/`loading`/`empty`/`error`/`filtered`/`selection`/`drawer`/`import`), which the live port does not fully match (no error state, plain-text loading).
- **What the design must change before it ships:** re-verify at Pass-3-flagged risk areas live in the rendered shell, not from the file alone - the Owner/Touched columns and Next-step label clipping the catalogue flagged as lost/broken after the rail-collapse revision (STATUS.md: "the WRITESET re-check believes fixed it but never verified live"); reconcile the "Draft reply" stub in the design's `LeadDrawer` footer with the real, much richer AI-first-reply feature (draft/edit/send/regenerate/dismiss with token spend) that already exists on the live full page - the design should show the real capability, not a placeholder toast; decide where the 0047 firmographic fields (industry, employees, revenue band, tech stack, etc.) live in the design's `LeadDetail` - they are not visible in the excerpt read and must not be dropped from a redesign since the live page already ships them; add the missing `ErrorState` variant to the ported list (design has it, live page doesn't use it) and a matching one for the detail page's "lead not found" case.

---

## 7. Open questions for Liam

1. Should the "Studio tools" menu (re-score all / find deals that should be leads / backfill company fields) ship as part of this port, or wait for a separate pass? (A: port now alongside the list re-critique per the catalogue's stated order; B: defer to a later Sales-tools batch.)
2. Do you want bulk selection and the bulk action bar (assign owner, set status, re-score, archive, delete) on by default once ported, given the backend already supports all five actions? (Yes/No.)
3. Should Leads get a mobile card-list fallback (like the design's `LeadCard` grid) instead of a horizontally-scrolling table at 375px? (Yes/No - this is a **proposal**, not backed by an existing TASKS line.)
4. For the AI first-reply feature: keep it exactly as built on `/leads/[id]` (draft/edit/regenerate/send/dismiss with Resend), or fold its UI into the design's `LeadDrawer` "Draft reply" button so it is reachable from the list too? (A: full page only; B: also from the slide-over/drawer.)
5. Is the "Next step" column (a due-date chip driven by scheduled discovery calls) something you want wired to real data on port, or should it be dropped since the live page has never had it? (A: wire it up; B: drop it from the design.)

---

## 8. Acceptance for the design review

1. At 1440px light and dark, the Leads list shows a left filter rail (Views/Filters/Sort) instead of the current flat filter bar, and the rail collapses or scrolls without clipping any control.
2. At 1440px, the table header includes Lead, AI score, Status, Source, Next step, Owner, Touched columns with no truncated/clipped labels (the specific Pass-3 complaint) - confirm Owner and Touched are both visible.
3. At 375px light and dark, either the table scrolls cleanly with no page-level horizontal scroll, or the approved mobile card fallback renders instead - no column is cut off mid-word.
4. The slide-over "peek" (quick view) and the full `/leads/[id]` page both render the AI briefing section identically in shape (score, reason, snapshot/fit/watch-outs, signals with sources, token spend) so a reviewer can tell they are the same underlying data.
5. A bulk-selection checkbox column and an action bar (assign owner / set status / re-score / archive / delete) are present and reachable at both 1440 and 375.
6. The "Studio tools" entry point (re-score all / triage / backfill) is present, and each of its three panels shows a dry-run result before any "apply for real" control is offered.
7. Every status pill, source pill and score badge uses only CSS var tokens - toggling `.dark` on the shell changes every one of them with no hardcoded-hex leftovers.
8. The AI first-reply capability (draft, edit subject/body, send, regenerate, dismiss, token count) is visibly represented in the design, not stubbed as a single toast-only button.
9. Loading and not-found/error states use the shared skeleton and `ErrorState` components on both pages, not plain unstyled text.
10. Primary CTAs ("New lead", "Promote to deal") carry the leaf radius; empty states use the EmptyState pattern with a leaf/leaf-adjacent icon, a title, a description and (when leads exist) no CTA, or (when there are none) a "New lead" CTA.
