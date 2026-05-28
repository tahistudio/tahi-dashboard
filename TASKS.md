# tahi-dashboard — Active Task List

Last updated: 2026-05-21 (split from the historical 1,222-line file)

**Active block: Phase 11 — Platform Polish + Notifications + Portal Readiness.**
Aug 1 deadline. ~119 open tasks. Closed items are in `TASKS-ARCHIVE.md`.

Read `STATUS.md` first — it has the live "current sprint" and known live bugs.

Format:
- `[ ]` open, `[x]` shipped (mark and move to TASKS-ARCHIVE.md once verified live)
- Initials + date on claim: `— [AGENT] YYYY-MM-DD`
- Tasks only flip to `[x]` after the Definition of Done in `CLAUDE.md` rule 8 is met

---

## Phase I Slice 1 — Ideation engine (2026-05-27)

- [x] PI-S1.1 — [FE/BE] **Ideation cron + signals + Ideas tab.** Settings → Content engine signals section (GA4 auto-detect, Matomo url/token, SE Ranking key, cron toggle, weekly target). New routes: `POST /api/admin/integrations/google/discover-ga4`, `POST /api/admin/cron/ideation` (Sonnet w/ structured JSON output, gracefully skips missing signals, master toggle defaults off, ?force=1 bypass), `POST /api/admin/content/clusters/seed` (idempotent 8 default clusters), `GET /api/admin/content/clusters`, `GET /api/admin/content/ideas` (status + week filters with isoWeekLabel helper), `PATCH /api/admin/content/ideas/[id]` (approve/reject/notes). `/content-studio` Ideas tab: cluster filter chips, card grid with approve/reject/details, SlideOver detail drawer with 2-3 targeted questions (skipped for definition + comparison posts). Honours `?tab=ideas` from notifications. Cron registered in `/api/admin/crons`. type-check + lint zero errors. — [FE/BE] 2026-05-27

## Phase I Slice 2 — Drafting pipeline (2026-05-27)

- [x] PI-S2.1 — [BE] **Multi-agent drafting pipeline + content_drafts schema + Drafts tab.** Migration 0060 adds `content_drafts` (one row per drafting run, FK cascade to content_ideas). `lib/blog-researcher.ts` runs pre-write Sonnet research with web_search (max_uses=5). `lib/link-validator.ts` strict 200-validates citation URLs (HEAD with GET fallback, 10s timeout, batches of 8, drops tahi.studio). `lib/blog-writer.ts` runs the chain: Brand Voice Writer (Sonnet, all 6 ephemeral context docs) → Sales + Readability reviewers in parallel → Editor-in-Chief (Opus 4.7) merges + scores out of 100 with breakdown { aeo, voice, readability, seo, linksOk }. Markdown→HTML deterministic mini-renderer (Workers bundle-budget friendly). `lib/ai-context.ts` got `loadAiContextDocs` returning the 6 docs separately. New routes: `POST /api/admin/content/ideas/[id]/draft` (full orchestrator — research, validate links, write, schema-additions, hreflang, cover→R2, flip idea to drafted), `GET /api/admin/content/drafts` (status + counts), `GET/DELETE /api/admin/content/drafts/[id]`. `POST /api/admin/cron/draft-approved-ideas` picks up approved ideas hourly (disabled by default via `content.draftingEnabled`, capped 1-3 per tick). Cron registered. /content-studio Drafts tab: grouped sections (in-progress → ready → failed), progress stepper per card, score bar breakdown, soft 6s poll while in-flight, SlideOver detail with body preview, FAQs, takeaways, cover image, citations, reviewer notes (collapsed), JSON-LD schema (collapsed), Discard + Schedule (greyed for Slice 5) buttons. type-check + lint zero errors. — [BE] 2026-05-27

## Phase I Slice 6.5 — Backfill existing blog posts (2026-05-28)

- [x] PI-S6.5.1 — [BE] **Backfill existing blog posts with FAQs + Key Takeaways + AI Summary Prompt + JSON-LD schema + hreflang.** Migration 0063 (idempotent) creates `blog_backfill_log` (one row per item touched per run + 2 indexes). `lib/blog-backfill.ts` is the pure per-post orchestrator: Sonnet 4.6 call (web search OFF, ~3000 tokens, strict JSON output) generates 4-6 FAQs + 3-5 key takeaways + a topic-specific AI summary prompt; then composes the key-takeaways HTML, builds the JSON-LD schema via Slice 3's `buildBlogSchemaAdditions` (with the freshly-generated FAQs feeding the FAQPage block), and builds the hreflang block. Plus `buildWebflowPatchPayload` locks the exact Webflow CMS slugs (faq-question/answer-1..6, key-takeaways, ai-prompt, schema, hreflang-block) — body / title / slug / images / categories / author / related-posts untouched. Three API routes: `POST /api/admin/content/backfill/start` (list items, apply mode filter `all` | `missing` | `webflowIds`, return runId + webflowIds), `POST /api/admin/content/backfill/process` (process batchSize items serially, write log rows, return continueFromIndex for resume), `GET /api/admin/content/backfill/runs` (recent runs grouped by runId with counts + sample failures), `GET /api/admin/content/backfill/runs/[runId]` (per-item drill-down). UI: new `BackfillCard` on `/content-studio` Health tab. Live progress bar + per-batch updates (last processed slug + error count) + cancel-after-current-batch button. 3 action buttons (Backfill all / Backfill missing only / View last run). SlideOver per-item drawer with status badge + FAQs count + takeaways count + schema size + duration + error message + fields-written list. Staged edits only — never publishes. Caller pauses 1s between batches to respect Webflow + Anthropic rate limits. `npm run type-check` + `npm run lint` zero errors. — [BE] 2026-05-28

## Phase I Slice 5 — Publish controls (2026-05-27)

- [x] PI-S5.1 — [BE] **Publish + schedule pipeline.** Migration 0062 (idempotent) adds 4 columns to `content_drafts` (`published_webflow_item_id`, `scheduled_for`, `published_at`, `publish_url`) and creates `publish_history` (one row per publish, drives the 3/week cap + 14-day cluster cooldown). `lib/webflow.ts` extended with `createCollectionItem` (POST /collections/{id}/items, optional `isDraft`), `getBlogPostsCollectionId` (env override → discovery via `/sites/{id}/collections`), and `loadBlogReferenceLookups` (Authors + Categories item lookups by slug + name part, module-scoped cache). `lib/publish-scheduler.ts` is pure functions: `computeNextSlot({ mode, customDate?, recentSlots, newCluster, recentClusters })` snaps `auto` to the next Mon/Wed/Fri 09:00 UK (BST-aware), enforces the rolling 7-day cap (3 posts), and surfaces 14-day same-cluster cooldown conflicts as warnings (never blocks). `POST /api/admin/content/drafts/[id]/publish` loads the draft, resolves Webflow author + main category + other categories by slug, builds the full fieldData payload (name, slug, post-body, summary, key-takeaways, schema, hreflang-block, faq-question/answer 1-6, meta-title, meta-description, post-description, shortened-name, ai-prompt, main-image, thumbnail-image-2, featured=false, author, main-category, other-categories), creates the item live (`isDraft:false` + immediate publish) when the slot is within 60s, otherwise stages it (`isDraft:true`) and parks `scheduledFor`. Writes a publish_history row, flips the idea status to 'published' / 'scheduled', best-effort IndexNow ping (fire-and-forget, never blocks). `POST /api/admin/cron/publish-scheduled` (master toggle `content.publishCronEnabled`, disabled by default) finds staged-but-due drafts every 15 min and promotes them to live + IndexNow. `GET /api/admin/content/schedule` powers the new Schedule tab — returns readyDrafts (with pre-computed auto-slot + cooldown preview), scheduledDrafts, publishHistory, and counts. /content-studio Schedule tab fully replaces the placeholder: Ready-to-publish cards with Publish Now / Custom Date / Auto buttons + inline "Next slot" + cooldown chip, Scheduled-and-published DataTable below. DraftDetailDrawer Schedule button (was greyed in Slice 2) opens a PublishModal with the 3 modes + datetime-local picker for custom. type-check + lint zero errors. — [BE] 2026-05-27

## Up next (QA / UIUX)

- [ ] PI-S1.QA — [QA] **Live smoke test of Slice 1.** Hit Settings → Content engine signals on prod, click Auto-detect GA4 (post-Google reauth with analytics.readonly scope), set ideationEnabled=true. Then `/content-studio?tab=ideas` → Run ideation now. Verify ideas land in the cluster grid, approve / reject / details drawer work, week label is correct. Confirm SlideOver footer Save Notes / Approve / Reject buttons all save.
- [ ] PI-S1.UIUX — [UIUX] **Spacing + colour review** of Ideas tab card grid + SlideOver. Confirm cluster pill colours read against dark mode + brand pill (Liam/Staci) palette aligns with rest of dashboard.
- [ ] PI-S2.MIGRATE — [BE/Ops] **Apply migration 0060 to prod D1.** `GET /api/admin/db/migrate?run=0060`. Creates `content_drafts` table + 2 indexes. Idempotent.
- [ ] PI-S2.QA — [QA] **Live smoke test of Slice 2 drafting pipeline.** After 0060 runs: approve an idea in /content-studio?tab=ideas, watch the Drafts tab transition through researching → drafting → reviewing → finalising → ready. Verify content score lands 0-100, score breakdown bars render, body preview shows valid HTML, FAQs populate, citations are all 200-status, cover image displays from R2, Discard returns the idea to Approved. Test failed-path by hitting an invalid Anthropic key.
- [ ] PI-S2.UIUX — [UIUX] **Drafts tab visual pass.** Confirm progress stepper, score bars, and SlideOver layout (especially body preview height + cover image responsiveness) at 375px + dark mode.
- [ ] PI-S5.MIGRATE — [BE/Ops] **Apply migration 0062 to prod D1.** `GET /api/admin/db/migrate?run=0062`. Adds 4 columns to `content_drafts` (idempotent — runner swallows "duplicate column name") + creates `publish_history` table + 3 indexes. Strictly additive.
- [ ] PI-S6.5.MIGRATE — [BE/Ops] **Apply migration 0063 to prod D1.** `GET /api/admin/db/migrate?run=0063`. Creates `blog_backfill_log` + 2 indexes. Strictly additive.
- [ ] PI-S6.5.QA — [QA] **Live smoke test of the backfill flow.** Pre-req: `ANTHROPIC_API_KEY` + `WEBFLOW_TOKEN` set in Webflow Cloud. On `/content-studio?tab=health`, click "Backfill missing only" — should process every existing post without FAQ #1 in batches of 5. Verify progress bar updates between batches, last-processed slug renders, errors badge increments on failures. Open Webflow Editor → Blog Posts collection → spot-check 3 random items: FAQ 1-6 should be populated, Key Takeaways should be a `<ul>`, Schema field should contain a `<script type="application/ld+json">` block, AI Prompt should be a 1-2 sentence prompt specific to the post's topic, Hreflang block should contain 4 link tags. Confirm items stayed staged (not auto-published). Open the SlideOver drill-down on the run, verify per-item statuses + fields-written list. After Liam batch-publishes from Webflow, confirm live posts now render FAQs + key takeaways + JSON-LD on the public blog template.
- [ ] PI-S6.5.UIUX — [UIUX] **Backfill card visual pass.** Confirm the card sits well under the Health DataTable at 375px + dark mode. Progress bar + cancel button readable mid-run. SlideOver drill-down list items don't overflow on long URLs / long error messages.
- [ ] PI-S5.QA — [QA] **Live smoke test of publish + schedule flow.** Pre-req: `WEBFLOW_TOKEN` set in Webflow Cloud, optionally `WEBFLOW_BLOG_COLLECTION_ID`. On a ready draft, open Schedule tab: (a) "Auto" should land Mon/Wed/Fri 09:00 UK and stage in Webflow as draft; verify in Webflow editor. (b) "Custom date" 5 min in the future should also stage. (c) Toggle `content.publishCronEnabled=true` in settings, hit `/api/admin/cron/publish-scheduled?force=1`, confirm the staged item flips live. (d) "Publish now" on a fresh draft should create + publish live in one shot + ping IndexNow. Confirm 14-day cooldown warning surfaces when two same-cluster posts are within 14 days.
- [ ] PI-S5.UIUX — [UIUX] **Schedule tab visual pass.** Ready cards + Scheduled-and-published table at 375px + dark mode. PublishModal radio cards alignment + datetime-local input native styling cross-browser.

---

## Newly raised in this session (2026-05-21)

- [ ] T735 — [FE] **Voice note playback fix.** `app/(dashboard)/messages/messages-content.tsx:95` `VoiceNotePlayer` animates a progress bar instead of decoding the recorded blob. Recording (MediaRecorder) and R2 upload work; only the player UI is fake. Replace with `<audio>` element pointing at the R2 file URL from the message's voiceNote ref. Optional follow-up: wavesurfer.js for visualisation. — [FE]
- [ ] T736 — [QA] **Live Chrome verification of the pipeline polish backlog.** All 5 items (default owner, value model, optimistic drag, nudge signature, deletable activity) have shipped per code review on 2026-05-21 but have not been verified by the user on the deployed URL. Run a Chrome QA pass and report. — [QA]
- [ ] T737 — [QA] **Live R2 upload verification.** Code has graceful error reporting; confirm STORAGE binding is actually configured in Webflow Cloud by uploading a file end-to-end. If broken, the binding is in `wrangler.json`. — [QA]
- [ ] T738 — [QA] **Live settings page tab walk-through.** March QA flagged team / portal branding / modules toggles as broken. Code has no obvious stubs. Click every tab on prod and report what behaves vs what's broken. — [QA]

---

## Schema Additions (Phase 11)

Some columns from these are already in the schema — verify before writing the migration.

- [ ] S23 — [BE] Add `notificationPreferences` table: id (uuid pk), userId (text, unique), email/inApp/push toggles per event type, pushSubscription (text nullable JSON), createdAt, updatedAt. **Not yet in `db/schema.ts`.**
- [ ] S24 — [BE] Add `commentsLocked` (int default 0) column to requests table. **Note: `editedAt` and `deletedAt` on messages already exist in current schema; only `commentsLocked` needs adding.**
- [ ] S25 — [BE] Add `xero_category_overrides` table + `hourlyRateCurrency` and `salaryAnnual` columns on teamMembers. Plus `billingModel` (retainer | hourly | project | none), `retainerStartDate`, `retainerEndDate` on organisations for T668-T672.

---

## Phase 11 — Quick wins (T660–T667)

- [ ] T660 — [FE] Comments-only view in request activity (segmented control + localStorage preference)
- [ ] T661 — [FE] Filter requests by organisation tags (Tags dropdown joined through organisations)
- [ ] T662 — [BE] `{{requestNumber}}` variable in email templates + subject prefix `[REQ-{number}]`
- [ ] T663 — [BE+FE] Portal noindex toggle + `/robots.txt` route
- [ ] T664 — [FE] Accent colour sweep — migrate hardcoded rainbow hex (`#dbeafe`, `#ede9fe`, `#d1fae5`, `#fef3c7`) to brand-family tokens
- [ ] T665 — [BE] Stripe import dedupe — keep `in_*`, drop matching `ch_*`
- [ ] T666 — [BE] Stripe import pagination via `starting_after` cursor
- [ ] T667 — [BE] Xero category overrides table + sync-pnl respects manual flags after auto-detection

---

## Phase 11 — Retainer & billing model (T668–T676)

- [ ] T668 — [FE] Client detail: editable `customMrr` + currency + retainerStartDate + retainerEndDate
- [ ] T669 — [FE] Client detail: `billingModel` selector (retainer | hourly | project | none)
- [ ] T670 — [BE] Retainer Health filter — exclude `billingModel != 'retainer'`
- [ ] T671 — [BE] MRR forecast respects retainerEndDate; flag clients with past endDate still active
- [ ] T672 — [BE] Auto-churn on retainer end (scheduled check sets status to `churned` + notification)
- [ ] T673 — [BE] Team member `salaryAnnual` field + `hourlyRateUsd` editable via PATCH
- [ ] T674 — [FE] Team member profile: editable hourly rate, salary, currency
- [ ] T675 — [BE] Time entries return `costAmount` (hours × team rate) + `revenueImpact` (hours × client rate)
- [ ] T676 — [FE] Time entries page: cost + revenue + margin columns with totals row

---

## Phase 11 — Comments & messages polish (T677–T681)

- [ ] T677 — [BE] Lock comments on delivered/closed requests — portal POST 403s if status in (delivered/cancelled/archived)
- [ ] T678 — [FE] Hide reply box for clients on closed requests with gentle notice; admin override toggle
- [ ] T679 — [BE] Admin toggle uses `commentsLocked` column (S24); default locked on delivered/cancelled
- [ ] T680 — [BE+FE] PATCH + DELETE messages with permissions (owner edits own; admin edits any; soft delete via `deletedAt`)
- [ ] T681 — [FE] `(edited)` indicator + "This message was removed" placeholder

---

## Phase 11 — Notifications overhaul (T682–T699)

Largest single block, ~10 days.

### Schema + preferences
- [ ] T682 — [BE] GET + PUT `/api/notifications/preferences` (uses S23)
- [ ] T683 — [FE] Notification preferences page — toggle grid (event types × email / in-app / push)

### Rich content
- [ ] T684 — [BE] Enrich notification creation — actor name, entity title, preview snippet on every insert
- [ ] T685 — [BE] GET `/api/notifications/badges` — unread counts by category

### SSE
- [ ] T686 — [BE] Upgrade SSE stub at `/api/notifications/stream` to a real stream (heartbeat + Last-Event-ID)
- [ ] T687 — [FE] `useNotificationStream()` hook — auto-reconnect, toast on new

### Email
- [ ] T688 — [BE] Email dispatcher — respects prefs, queues via Resend with React Email templates
- [ ] T689 — [BE] Templates × 5: new-request, status-change, invoice-created, message-received, retainer-alert
- [ ] T690 — [BE] Email throttling — batch within 5 min, digest if 3+

### History page
- [ ] T691 — [FE] `/notifications` page — filters (All / Unread / By type) + mark-as-read + pagination
- [ ] T692 — [FE] Bell dropdown — latest 10 with unread badge

### Sidebar badges
- [ ] T693 — [FE] Messages + Requests nav items show unread badges fed by SSE

### Web Push
- [ ] T694 — [BE] POST `/api/notifications/push-subscribe` + DELETE to unsubscribe
- [ ] T695 — [BE] Web Push send via VAPID keys
- [ ] T696 — [FE] Service worker push handler — native notification with title/body/icon/action URL
- [ ] T697 — [FE] Push opt-in UI — toggle requests browser permission and subscribes

### Weekly MRR digest
- [ ] T698 — [BE] Cron Trigger (Mon 8am NZT) — MRR delta, churned, pipeline movement, retainer alerts, runway
- [ ] T699 — [FE] Settings toggle for the weekly MRR digest

---

## Phase 11 — Revenue features (T700–T705)

- [ ] T700 — [BE] POST `/api/admin/deals/[id]/create-invoice` — full / deposit % / custom from closed-won deal
- [ ] T701 — [FE] Deal detail: "Create Invoice" button on closed-won; optionally pushes to Xero/Stripe
- [ ] T702 — [FE] Pipeline: invoice status indicator on deal cards
- [ ] T703 — [BE] POST `/api/admin/tools/project-calculator` — port tahi.studio Webflow logic
- [ ] T704 — [FE] Project calculator page (sliders for type / complexity / pages / features / integrations)
- [ ] T705 — [BE] Xero payment webhook receiver

---

## Phase 11 — Data accuracy (T706–T708)

- [ ] T706 — [BE] Bank balance — fetch statement + cash from Xero, statement primary
- [ ] T707 — [FE] BankRunwayCard shows statement vs cash rows
- [ ] T708 — [BE] Outstanding KPI dedup — DISTINCT on invoice IDs, exclude voided/cancelled

---

## Phase 11 — Intelligence & analytics (T709–T715)

- [ ] T709 — [BE] Revenue per head API — paid revenue / active team member count by month + cost overlay
- [ ] T710 — [FE] Reports: Revenue Per Head KPI + trend chart
- [ ] T711 — [BE] Client LTV API — paid invoices + active deal value + projected retainer remaining
- [ ] T712 — [FE] Client detail: LTV summary + trend sparkline
- [ ] T713 — [FE] Reports: Client LTV Leaderboard segmented by plan type
- [ ] T714 — [BE] Pipeline quality API — dead/dormant/healthy breakdown + aging buckets
- [ ] T715 — [FE] Reports: Pipeline Quality section + "needs attention" list

---

## Phase 11 — Portal hardening (Aug 1 deadline, T716–T719)

Security-first. Run this batch before opening the portal to more clients.

- [ ] T716 — [BE] Email-to-Request intake — Cloudflare Email Routing or Resend inbound, parse subject/body, match sender to contacts
- [ ] T717 — [BE] Cross-org access scoping on conversations / time-entries / contracts / calls / deals / per-org sub-resources. Use `requireAccessToOrg` helper.
- [ ] T718 — [QA] Playwright cross-org isolation e2e — seed two orgs, verify A can't fetch B
- [ ] T719 — [BE] Cloudflare WAF rate rule (60 req/min `/api/portal/*`, 20 req/min `/api/uploads/*`) as interim until KV is provisioned

---

## Phase 11 — UIUX reviews (T720–T727)

- [ ] T720 — Financial Health section spacing on Reports page
- [ ] T721 — MRR inline edit on client detail
- [ ] T722 — Multi-line invoice creation dialog + invoice detail
- [ ] T723 — Client archive UI (tabs, confirm dialog, archived treatment)
- [ ] T724 — Expense dashboard layout + category colours + sparklines
- [ ] T725 — Project calculator UI premium feel + 375px responsive
- [ ] T726 — Notification history + bell dropdown + preferences grid + push opt-in
- [ ] T727 — Time entries cost/revenue columns + team profile edit

---

## Phase 11 — QA tests (T728–T734)

- [ ] T728 — Regression: Financial Health loads, aging buckets expand, currency converts
- [ ] T729 — Regression: Revenue Forecast chart + MRR edit on client detail
- [ ] T730 — Xero push: GBP invoice → Xero with branding theme + currency
- [ ] T731 — Invoice with 3 USD line items + Stripe destination → payment link works
- [ ] T732 — Notification flow E2E: create request → in-app + email + push fires
- [ ] T733 — Comment lock: deliver request → client can't post → admin toggle → client can post
- [ ] T734 — Retainer auto-churn: set endDate yesterday → status flips to `churned` + notification

---

## Pre-Phase-11 carry-overs (not duplicated by T660+)

- [ ] T568 — [FE] Google Calendar integration: auto-generate booking links for scheduled calls
- [ ] T570 — [BE] Zapier outgoing webhooks: enable external automation triggers
- [ ] T571 — [FE/BE] Deal-to-Client LTV link on deal detail (overlaps with T711-T713 — consider folding in)
- [ ] T594b — [BE] Apply migration 0012 (client_costs) to production D1 via `wrangler d1 execute`
- [ ] T600 — [FE] Cash flow: runway indicator (months at current burn) — needs Xero bank balance wiring first
- [ ] T618 — [BE] MCP tools: add finance tools to the Worker MCP server (per `feedback_mcp_worker_only.md`, ignore local mcp-server)

---

## North-star phases (queued behind Phase 11)

See `memory/project_phase_roadmap.md` for the full list. Driven by `SPECS/north-star-integrated-flow.md`. Do not start until Phase 11 is closed.

- N1 Discovery call workflow
- N2 Auto-onboarding state machine
- N3 In-portal onboarding tour
- N4 Permission roles + gated content
- N5 Mailerlite → in-dashboard CRM
- N6 Affiliate / referral program
- N7 Schedule → tasks bridge + live Gantt overlay
- N8 Co-founder hourly billing tracker + Xero draft invoice on month-end
- N9 Dashboard-wide premium UI/UX pass

---

## Trust-crossover targets (parallel to Phase 11)

Per `memory/project_trust_state_2026_05.md` — user currently daily-trusts pipeline + finance only. Each feature below gets a complete UX + bug audit + live QA pass before moving on. No rush; quality over speed.

1. Tasks — Decision #046 cleaned up the model; needs polish + add-flow QA
2. Requests — close any remaining privacy / file / voice-note gaps
3. Messages — T677–T681 above already cover comment lock + edit/delete
4. Time tracking — pair with T673–T676
5. Contracts / proposals / schedules / calculator — already premium; promote via pipeline integration
