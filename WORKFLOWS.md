# Workflows — Tahi Dashboard

The dashboard is the place Liam runs the agency from. Each workflow below is a recurring thing he does that the dashboard should both **help him do** and **record** for later context.

This doc drives feature confidence. Pick a workflow, tighten everything along its path, mark it done.

---

## How to read this doc

Each workflow has:

- **Steps** — what happens, in order
- **Surfaces** — the dashboard pages / components involved
- **Status** — `design ✓` / `data ✓` / `feature ✓` for each surface
- **Open issues** — anything broken or missing today

A workflow is **`shipped`** only when every surface in its path is `design ✓ + data ✓ + feature ✓` AND Liam has used it end-to-end on the deployed site without falling back to email / Slack / spreadsheet.

---

## Build order (the lifecycle, in sequence)

The lifecycle-driven roadmap. Each phase compounds on the data captured by the previous one, so order matters — building Proposals before Lead intake means proposals start with no upstream context.

### Phase A · Sales CRM foundation (next up)

1. **Lead intake + qualification** — `leads` table, manual + Webflow form intake, qualifying flow. Pre-pipeline.
2. **Discovery call surface** — notes, signals, transcript upload (from Google Meet), next action. Outcome routes to: promote to deal OR archive.
3. **Calls log** — upcoming + past calls with prep notes, transcripts, attendees.
4. **Pipeline polish** — bring the existing pipeline page through the new design system. Pipeline becomes *post-discovery only* (qualified deals).

### Phase B · CRM depth (right after foundation)

5. **Gmail sync + email tracking** — Google OAuth, pull emails per contact, track opens / clicks on outgoing dashboard mail.
6. **AI deal scoring** — score deals on probability + suggested next action using deal + activity + call signals.
7. **Contact enrichment** — pull LinkedIn / company data when a lead is created (best-effort, via an enrichment API).

### Phase C · Affiliate program (replace Rewardful before ManyRequests cutover)

8. **Affiliates table** — 12 partners today; flat 10% per qualified lead that closes.
9. **Referral codes + tracking links** — `/r/{code}` cookies the visitor for attribution on lead capture.
10. **Attribution + payout tracking** — when a deal closes, credit the cookied affiliate. Manual mark-paid for v1; payment processor integration later (Liam may change Stripe).
11. **Affiliate portal** — small surface where affiliates see their referrals + commissions owed.

### Phase D · Marketing email CRM (Mailerlite replacement, deferred)

Low urgency: 4 campaigns/year + 3.7k subscribers + Mailerlite still works.

12. **Subscriber + list + segment tables** — natively in the dashboard. Sync OUT to Mailerlite (or send via Resend) so the dashboard is the source of truth.
13. **Forms + signup endpoints** — Webflow-form-to-subscriber webhook + unsubscribe page.
14. **Campaign composer + send** — pick a list/segment, write, schedule, send via Resend.
15. **Analytics** — opens / clicks / unsubscribes per campaign, per subscriber.

### Phase E · Productisation (existing surfaces, post-CRM)

Pipeline → Proposal → Schedule → Contract → Onboard → Deliver → Invoice → Upsell. These are mostly built; each gets a design-system polish lap once the lead/discovery flow is feeding them.

16. Proposals polish + AI draft from discovery
17. Schedules polish
18. Contracts polish
19. Onboarding checklist polish
20. Requests / Tasks / Messages / Time (the "Running a project" workflow)
21. Invoicing polish + Stripe + Xero reconciliation
22. Upsell prompts (retainer hours nearly out, etc.)

### Phase F · Messaging & social (much later — only after daily-trusted CRM)

Not a priority. Slated for after the dashboard becomes the daily driver for sales + delivery. Listed here so the architecture decisions land in writing.

23. **Buffer integration for social posts + scheduling** — use Buffer (Essentials tier or Free if 3k requests/month is enough) via their API. Dashboard surfaces a "social pipeline" view: scheduled posts, published posts, engagement rollup. Don't build a scheduler ourselves.
24. **Beeper API + MCP for unified DM inbox** — LinkedIn / WhatsApp / Slack / SMS in one place via Beeper. Three-defence privacy model so personal threads stay private:
    - **Per-account whitelist** in Settings → Inbox. Tick only work Beeper accounts.
    - **CRM-match filter as default** — threads only surface when the counterparty matches a lead / contact / org in the CRM. Friend texting "want a coffee?" never appears.
    - **Explicit opt-in** before any DM gets logged as an activity on a lead/deal. Auto-link suggests; Liam confirms.
    Actual chatting still happens in Beeper Desktop / native apps; the dashboard just tracks threads tied to records.
25. **LinkedIn outreach tracking (manual send, automated tracking)** — at low volume (Liam's scale: 3-10 leads/month), no need for a tool like Heyreach or Expandi. Use LinkedIn Premium directly to send connection requests + InMail, log each as an activity on the lead. Dashboard surfaces "follow up in 4 days" tasks. Auto-send is off the table (LinkedIn rate-limits or bans).
26. **Low-volume cold email outreach** — also manual send. Dashboard tracks sent / replied / no-response per lead so Liam doesn't double-touch. Volume stays under 20 emails / week / domain so the email reputation isn't burned.

### Phase G · Sales conversion levers (2026-05-24, after Phase B)

Decided 2026-05-24 after a "what would actually help" review. Inbound is THIN (Webflow Partner leads dried up when minimum moved from $2.5k → $5k USD; Tahi's own website doesn't generate leads because it needs redesign + SEO). So the lever is NOT volume automation — it's making every inbound count.

**Progress update 2026-05-25 (overnight build):** 5 of 5 deliverable items shipped. Item 29 (the big pipeline) still pending — that one's a multi-week build that needs proposal visual overhaul first.

27. **AI-drafted first reply on new inbound — SHIPPED ✓ (2026-05-24).** Sonnet drafts a personalised reply in Liam's voice using all 6 canonical docs (ICP, brand DNA, tone of voice, Liam personal voice, AI tells, services) + last 5 edited drafts as few-shot tone examples. Lives on the lead detail page; Liam taps Generate → Edit → Send. Tone learning compounds.
28. **Pre-call digest — SHIPPED ✓ (2026-05-25).** Cron at `/api/admin/cron/pre-call-digest` fires every ~5 min, scans calls in the next 25-35 min window, sends a React Email brief to business@tahi.studio with lead context + AI score/briefing + discovery questions + sources + Join button. Idempotent via activity stamps.
29. **Discovery → Proposal → Contract → Tasks pipeline (PENDING — task #148)** — the big one. After a discovery call, the dashboard generates:
    a. **AI-draft proposal** from transcript + scope notes + enrichment + Tahi's pricing logic + existing proposal templates. Liam edits, then sends within an hour of the call ending.
    b. **Capacity check baked in** — uses live capacity data to propose a realistic timeline ("you're at 65% this month, propose 6-week not 3").
    c. **Accept → auto-generate contract** from the proposal sections + Tahi's template library + the agreed scope. Liam reviews + sends for signature.
    d. **Sign → auto-create tasks + requests** with scope items as the work breakdown. Project kicks off without manual setup.
    Half-shipped: `/api/admin/cron/auto-promote-calls` closes the discovery→deal loop (outcome='promote' → auto-create deal with budget seed). Proposal/contract/tasks chain blocked on the proposals visual overhaul.
30. **Affiliate reactivation prompts — SHIPPED ✓ (2026-05-25).** `/api/admin/cron/affiliate-reactivation` scans `leads.affiliateCode` groups, finds codes idle 60+ days, pushes one notification per stale code (capped at 5/run, 30-day dedup). When the affiliates table lands later, swap the source — behaviour stays the same.
31. **Lead reactivation (DEFERRED)** — re-score archived leads weekly. Deprioritised because thin inbound volume = small archived pool. Revisit when archived > 50 leads.

### Phase G+ · Operational glue shipped overnight 2026-05-25

These weren't on Phase G originally but landed in the same push:

- **Cron scoring parallelisation (#151) ✓** — leads-ai cron processes 5 leads concurrently. 25-lead backlog drains in ~8s instead of 38s.
- **Force-rescore + auto-enrich queue ✓** — `/api/admin/leads/rescore-all` drains the entire active-leads pool with the ICP-aware rubric. Anything scoring ≥60 gets queued for Sonnet enrichment on the next cron tick.
- **Docs Hub → AI prompts wiring ✓ (#156)** — 6 settings (ai.icpDocId, ai.brandDnaDocId, ai.toneDocId, ai.liamVoiceDocId, ai.aiTellsDocId, ai.servicesDocId) point at Docs Hub pages. lib/ai-context.ts loads + caches them, prepends as ephemeral system blocks. Edit doc → AI updates within 5 min.
- **Lead firmographics columns ✓ (#153)** — 11 first-class columns (industry, employees, revenue, monthly visits, lead type, both LinkedIns, tech stack, cms, country, year founded) promoted out of brief blob. Edit-in-place on `/leads/[id]`.
- **Drive Gemini transcript autopull ✓ (#146)** — scans Drive for "Notes by Gemini" docs, matches to discovery_calls by time + attendee name, writes transcript + summary + next steps.
- **Buffer integration ✓** — personal social posts surfaced in Settings with engagement stats. 2 MCP tools for AI.
- **Daily summary notification ✓** — morning cron pushes a 1-line digest of yesterday's activity.
- **Pipeline weighted forecast ✓** — homepage card showing weighted-by-stage MRR projection + 12-month expected.
- **Lead score history sparkline ✓** — inline 200×28 SVG on the lead detail AI briefing card, parsed from activity timeline.
- **CSV export for leads ✓** — full firmographic columns + AI score + reason.
- **Bulk operations on leads ✓** — archive/rescore/assign-owner/set-status/delete backend endpoint.
- **Public lead intake with UTM capture ✓** — `/api/public/leads` accepts Webflow form payloads with utm_source/medium/campaign, gated by Bearer secret.
- **Auto-promote on positive call outcome ✓** — closes the call→deal loop.
- **AI cost report ✓** — `/api/admin/reports/ai-cost` aggregates token spend across surfaces.
- **AI context docs settings card ✓** — Liam can see which doc is wired to each AI surface + swap.
- **Upcoming Calls widget fix ✓** — reads `discovery_calls` (so Calendar-synced meetings appear).
- **Google OAuth bounce fix ✓** — callback no longer redirects to home page after auth.
- **Vitest test suite ✓** — 33 unit tests covering gemini-parser, tech-sniffer, buffer.

### Phase G++ · Sales-loop deliverables (shipped 2026-05-25 → 2026-05-26)

The schedule + deliverable rebuild that closed off most of Slice 1 + parts of Slice 2/3 prep:

- **Schedule viewer rebuild ✓** — CoverPage / PageChrome / SectionHeader / AccentTitle (with `{{accent}}` brace syntax) / BrandMark primitives in `components/tahi/deliverable/`. Dark gradient cover. Edge-to-edge on desktop, breathing room on mobile.
- **Schedule editor polish ✓** — leaf-sm active nav state (matches sidebar), mobile rail-as-card with clamp gutter, full-width slide editor (was 52rem-capped), publish/republish button in header, lead linkage row.
- **Schedule analytics deep dive ✓** — per-section dwell tracking via IntersectionObserver, `share_section_views` table, AnalyticsHeatmap primitive, ShareAnalyticsCard now shows brand-tinted heat bars + dwell + return-visit counts.
- **Schedule draft/publish ✓** — `publishedSnapshot` + `publishedAt` columns. Public viewer reads snapshot; falls back to live for pre-existing schedules. Mirrors proposal model. Edits no longer leak the moment they save.
- **Calendar classifier ✓** — Google Meet events get a `meetingType` (discovery / client / partnership / unclassified) on import based on attendee match + title heuristics. Unmatched events now land in a triage queue instead of being silently skipped.
- **/calls index page ✓** — unified list across all classification buckets, Upcoming/Past tabs, Type filter chips, inline reclassify actions per row.
- **/settings/crons ✓** — observability page with Run-now per cron + last-run + 10-run history. `cron_runs` table + `logCronRun` helper wired into every cron. Notifications fire on cron failure (6h dedup).
- **Transcript cap 50k → 250k ✓** — full Gemini transcripts no longer clip mid-call.
- **Past-call upcoming bug ✓** — Google Calendar's timezone-offset format caused lex-comparison to leak past calls onto the Upcoming widget. Numeric Date compare now.
- **LinkedToPanel polish ✓** — portal popovers (no more layout shift), lead row on schedules + proposals + contracts (post-migration 0053).
- **NewScheduleDialog ✓** — Client / Deal / Lead pickers at creation time.
- **EmailShareModal: Cc / Bcc / Subject ✓** — full email composition for proposal/schedule/contract sharing.
- **MCP catch-up ✓** — 4 new tools (publish_schedule, publish_proposal, list_crons, list_all_calls) + lead firmographic schema + meeting type / linkage fields + 250k transcript doc. Worker auto-deploy via GitHub Actions.

### Phase H · Finance overhaul (SHIPPED ✓ 2026-05-27 → 2026-05-28)

Triggered by the hiring decision + need for "am I on track?" visibility. Reports/billing/invoices/time placement got rethought.

**What landed:**
- `/financial-reports` page restructured into hero (Cash + Revenue) → Needs-attention card → Cash → Revenue → MRR → Sales → Outflows → Tax → Take-home → Planning. Section tabs removed after Liam pushed back on the visual noise.
- Hero cash card: total cash NZD-equivalent, reserve donut, dual runway (worst-case + net-burn with tax adjustment), bank-sync staleness stamp + Refresh button.
- Currency switcher in nav respected page-wide via a smart `formatNative` shim — NZD aggregates convert, native bank/reserve rows stay native.
- Auto/manual burn toggle on the Reserve target card. Auto sums every active commitment (currency + cadence aware). Manual preserves saved override when flipping back to Auto.
- Recurring outflows full CRUD: add/edit/delete via SlideOver, quick pause/resume, "Show paused" filter. Auto-detect cadence button infers billing day + cadence from 180d of Airwallex transactions with confidence scoring.
- Cash reserves CRUD (Settings → Cash reserves): tax/buffer/deposits/other pots with target + accrued amounts and optional accrual rate (cron auto-accrues from daily revenue).
- "Needs your attention" card surfaces overdue invoices, stalled sales engine, unreserved tax, high client concentration, and stale bank sync as a quiet structured list.
- Mobile: every responsive grid wraps its column minimum in `min(100%, Nrem)` so cards line up the same width on 375px viewports. Win-rate-by-source rows stack label/numbers above a full-width bar so long source names don't overflow.
- Bug fixes along the way: closed_at backfill on existing closed-won deals (migration 0057) + auto-set on stage move → sales velocity finally honest. Inverted FX formula fix in the summary route + retainer breakdown table. PB Tech transaction-related staleness surfaced via the sync stamp.

**Calendar two-way sync (sister feature, shipped 2026-05-28):**
- `POST /api/admin/calls` now pushes to Google Calendar with `conferenceData.createRequest` so Google generates a Meet link and emails attendees. Returned event id + Meet URL written back to the row.
- Same write also lands in `discovery_calls` so the home page "Next call" widget sees new calls instantly (no waiting for the next pull-sync).
- Home page "Next call" card got a live "Live now" badge + "Join now" button that pulses when the call is within 5 min or actively running.

**Status: shipped.** Spec locked 2026-05-26. Live as of 2026-05-28 across desktop + mobile + dark mode. Liam has used the page on the deployed site to identify accuracy issues and triage them.

**Original spec for reference:**

**Headline shape:**
- `/financial-reports` — single top-level page (not nested under /reports). Top half answers "am I on track?" (status traffic-lights, disposable cash now, cashflow forecast with scenarios). Bottom half answers "huh, that's interesting" (charts).
- `/billing` deleted. Recurring-billing setup folds into `/clients/[id]` (Billing tab).
- `/invoices` becomes the operational ledger — Stripe + Xero + Airwallex reconciliation, status, actions.
- `/time` stays in Workspace (personal action). Rollups live inside the finance + operations reports.
- `/reports` becomes a tiny hub linking to `/financial-reports`, `/sales-reports`, `/operations-reports`, `/marketing-reports` (built later as needed).

**Data sources, daily-synced:**
- Stripe (subscriptions + one-off charges)
- Xero (invoices + bills + reconciliation)
- Airwallex (bank balances + transactions — the truth-of-truths)
- Manual (cost rows added by hand)

Each invoice/expense row carries up to 4 source IDs. Mismatches surface as anomalies.

**Schema additions:**
- `projects.durationMonths` for project-MRR amortisation (value / months across the active window)
- `costs.frequency` + `nextDueAt` + `expectedAmount` — categorise as fixed_monthly / recurring_variable / one_off
- `reserves` table — tax accrual + custom reserve pots
- `accountIntegrations.airwallex` config row
- Multi-source IDs on invoices + costs: `stripeId`, `xeroId`, `airwallexTxnId`, `bankReconciledAt`

**Crons:**
- Daily 06:00 NZT — Airwallex + Stripe + Xero sync, reconcile pass
- Weekly Monday — AI sanity scan of recurring items
- Monthly 1st — AI deep scan: anomalies, hole-finding, cost-mix drift, monthly recap

**Charts to build / extend (reusable primitives in `components/tahi/charts/`):**
- MRR stacked area (retainer + project) with new/churn deltas
- Revenue per client over time (top 10)
- Cost-mix donut with month-on-month delta arrows
- Profit per logged hour (per employee + overall)
- Pipeline → cash conversion funnel
- Revenue seasonality heatmap
- Time-to-pay distribution

**Status: not started.** Spec locked 2026-05-26 morning session. Build order: WORKFLOWS lock → schema + migrations → Airwallex sync → reconciliation pass → cashflow forecast page → MRR/charts → daily/weekly/monthly crons.

### Phase H+ · Calculator dial-in (after finance lands)

Triggered by Slice 3 (AI proposal draft) needing a trustworthy pricing engine.

- Three input modes: range (`$10-15k`), hard scope (`6-page site, 3 integrations`), free text (`"redesign their portal + add Klaviyo + ship in 8 weeks"`)
- Output: price + time + capacity check, each cost component visible (Webflow build 30h, design 20h, integration 8h)
- Speed: keyboard-first, sub-second feel — usable on a live discovery call
- Calibration: seeded from last N projects' actual time + revenue (from Finance data). Liam tunes multipliers in a settings panel; AI learns from acceptance/reject signals over time.

**Status: not started.** Needs Liam in the room — pricing intuition isn't AI-guessable.

### Phase I · Content Engine (`/content-studio`) — spec locked 2026-05-28

**Goal:** drive Tahi traffic from ~1k/mo today to 10k+/mo within 12-18 months. Mechanism: agent-driven blog research, drafting, multi-reviewer QA, schema-rich publish, internal-link patching, and citation tracking — all inside the dashboard so Liam reviews in one place. Replaces the n8n-style flow Liam built for Giant Group with a Tahi-specific, dashboard-native version.

**Why this, why now:** traffic going down. 57 existing posts, many not indexed. 119 glossary entries under-linked. Need volume + structure + topical authority. AI engine citation (Claude, ChatGPT, Perplexity, Google AI Overviews) is the emerging traffic source — current SchemaFlow setup misses ~50% of the AEO playbook.

**Signal sources (Slice 1 ideation cron, Monday 08:00 UK):**
- Google Analytics 4 (top + decaying pages, last 30d) — OAuth via existing Google integration with new `analytics.readonly` scope
- Google Search Console (page-2 query gaps, last 90d) — OAuth with new `webmasters.readonly` scope
- SE Ranking (keyword gaps + competitor visibility) — existing MCP / API
- Matomo (Tahi's own analytics) — existing
- Tahi sitemap inventory (live fetch + parse for interlinking)
- LinkedIn engagement (Tahi's posts via Buffer, last 7d after first 4-week backfill)
- Competitor blog RSS — 14 tracked Webflow agencies: Flowninja, Flowout, Finsweet, N4, Videsigns, Bro Works, Nikolai Bain, Refokus, Edgar Allan, Studio Lumio, Wonderlab, Goodish, Webstacks, Made by Shape
- Timothy Ricks YouTube transcripts (RSS + transcript fetch)
- Webflow news / changelog RSS

**Topical clusters (8 seeded):**
1. Enterprise Webflow
2. Migration (WordPress / Framer / headless to Webflow)
3. Design-to-dev handoff
4. Webflow agencies + Partner Program
5. Performance + SEO
6. Product-led / Experience (Calculator, Nodeo, internal lessons — Tahi's E-E-A-T signal)
7. Sustainable web (Tahi's unique angle — sub-cluster: carbon-aware design, low-carbon hosting, page weight)
8. NZ + AU regional (geo play with `hreflang="en-NZ"` and `en-AU`)

**Webflow CMS fields (verified via API 2026-05-28, collection id `685941c739fa006940c9b4de`):**
- Existing: Name, Slug, Meta Title, Meta Description, Main Image, Thumbnail Image, Shortened name, Post Excerpt, Summary, Body, Featured?, Main Category, Other Categories, Author, Schema
- Added 2026-05-28 for the content engine: Key Takeaways (rich text), Related blog posts (multi-ref), AI Summary Prompt (plain text), FAQ Question/Answer #1-6 (12 discrete fields — plain text Q, rich text A)
- 30 fields total of 60 available
- Schema field carries the agent-generated JSON-LD additions layered on top of the existing SchemaFlow output (FAQPage + HowTo conditional + about + mentions + citation + speakable + richer Person)

**Multi-agent drafting pipeline:**
Researcher (with Anthropic web search) → Brand Voice Writer (uses Tahi tone-of-voice from Docs Hub) → 2 parallel reviewers (Sales + Readability — Marketing reviewer cut per audit feedback, overlapped too much with Sales) → Editor-in-Chief Opus signs off with a content score 0-100 against the Tahi rubric (AEO + voice + readability + SEO + link integrity).

**Author auto-classifier:** design-topic posts → Staci; everything else → Liam.

**Quality bars (locked from AEO/SEO audit 2026-05-28):**
- Word count by intent: definition 1,100-1,300 · how-to 1,800-2,200 · opinion 900-1,400 · comparison 2,400-3,000
- External links: 3-5 per 1,000 words, all dofollow to authority sources. Strict 200-status validation (no 301/302/403/404).
- Internal links from each new post: 6-10 outbound
- Internal links TO each new post within 7d: minimum 3, target 5-8, lifetime ceiling 15
- Title: 52-58 chars, under 580px desktop
- Meta description: 140-155 chars
- H2 count: 5-8, each opens with a 1-2 sentence direct answer (highest-leverage AEO change)
- FAQ block: 4-6 questions, 40-60 words per answer, wrapped in FAQPage JSON-LD
- Schema types per post: Article (or BlogPosting via SchemaFlow) + FAQPage + BreadcrumbList + Person + Organization + about + mentions + citation + speakable. HowTo conditional.
- Refresh trigger: GSC impressions drop >25% MoM for 2 consecutive months → auto-flag for refresh

**Liam-in-the-loop:**
- Triage 6-8 fresh ideas every Monday in `/content-studio` (yes/no/maybe → pick ~3-4 to run)
- Answer 2-3 targeted questions per accepted opinion/how-to post + free-form opinion paragraph (definition + comparison posts skip the questions to save time)
- Review the agent draft + content score + cover before publish (single sign-off, not a 4-person panel)
- Approve internal-link patches per old post (Slice 6 link engine surfaces these as a diff)

**Publish controls:**
- Now / Custom Date / Auto
- Auto: 2 days after the last scheduled post, snap to next Mon-Wed-Fri at 09:00 UK, max 3/week
- 14-day topical cooldown — no two posts on overlapping query clusters within 14d (anti-cannibalisation)
- IndexNow ping on publish (Bing + Yandex) + GSC submit-URL via API (Google)

**SVG cover generator:**
- 864×500 viewBox locked to Tahi dark-green base + diamond gradient overlay
- 5 hand-built scene templates (illustrated focal icon / stacked UI cards / agency-list / pricing comparison / abstract pattern) — Claude picks template + parameterised palette + accents
- Brand logos fetched live from simpleicons.org, mirrored to R2 on first fetch (avoid rate limit)
- Per-cover "Flag to Staci" button — sends in-dashboard notification with image preview if Liam wants Staci to rework. Otherwise Liam approves solo.

**Slice plan (locked 2026-05-28):**

| # | Slice | Why this order |
|---|---|---|
| 0 | Indexing audit + remediation | Fix the actual problem first. GSC API + sitemap diff + IndexNow + GSC submit-URL. |
| 1 | Ideation + cluster map | `content_ideas` + `content_clusters` tables, `/content-studio` surface, Monday cron with full signal mix |
| 2 | Drafting pipeline (lean) | 2 reviewers + EIC, link 200-validation, author classifier |
| 3 | Structured data layer | Agent-generated JSON-LD additions written to the new `Schema` field, layered on top of SchemaFlow's BlogPosting backbone. hreflang for UK/NZ/US on the same content. |
| 4 | SVG cover generator | 5 templates + Simple Icons mirrored to R2 + flag-to-Staci |
| 5 | Publish + schedule + cooldown | Now / Custom / Auto Mon-Wed-Fri 09:00 UK, IndexNow + GSC submit on publish |
| 6 | Internal link engine | Patch old posts on Monday with 2-link cap per post per week, prioritise glossary↔blog linking |
| 6.5 | One-time backfill of all 57 existing posts | FAQ + Schema additions + 2-3 extra internal links per post |
| 7 | Signal expansion | LinkedIn engagement (Buffer), competitor blog RSS, Timothy Ricks YouTube transcripts, Webflow news feed |
| 8 | Citation tracker + quarterly refresh | Weekly probe of Perplexity / Claude / ChatGPT / AI Overviews + GSC-decay auto-flag |
| 9 | LinkedIn auto-post (DEFERRED, logged) | Ship only when Liam commits to comment engagement in first 90min. LinkedIn-native standalone post + link in first comment pattern. |

**Realistic traffic curve (locked 2026-05-28 from the audit):** 1.0-1.3k at month 1-2 (backfill ships, no big move yet), 1.5-2.0k at month 3, 2.5-4k at month 6, 4-7k at month 9, **6-10k at month 12 — cross 10k somewhere between month 12 and month 18 if cadence holds.** Cadence holds beat post quality optimisation in the late phases.

**Prerequisites before Slice 0 starts:**
- ✅ CMS fields added (verified via Webflow API 2026-05-28)
- ⏳ Liam re-authorize Google with `analytics.readonly` + `webmasters.readonly` scopes (one-click in Settings → Integrations → Google once the route is ready)
- ⏳ `WEBFLOW_TOKEN` wired into Webflow Cloud env (Liam has the token; I add the env var in Slice 0)

**Status (2026-05-28, end of autonomous build session):**

Shipped end-to-end (code + commit + push):
- ✅ Slice 0 — indexing audit + /content-studio Health tab (migration 0059 applied)
- ✅ Slice 1 — ideation engine + cluster map + Ideas tab (cron disabled by default)
- ✅ Slice 2 — multi-agent drafting pipeline (Researcher → Writer → Sales + Readability → EIC Opus) + Drafts tab
- ✅ Slice 3 — JSON-LD layer (Article + FAQPage + HowTo conditional + Organization + Person + about + mentions + citation + speakable + 4-level Breadcrumb) + hreflang generator
- ✅ Slice 4 — SVG cover generator (5 scene templates spanning the 9 references, locked Tahi-green gradient base, Simple Icons mirrored to R2)
- ✅ Slice 5 — publish controls (Now / Custom / Auto Mon-Wed-Fri 09:00 UK, 14-day topical cooldown warning) + Schedule tab + 15-min publish-scheduled cron
- ✅ Slice 6 — internal link engine analyzer (suggests + Apply via Webflow patch, never auto-applies) + Links tab + weekly cron
- ✅ Slice 6.5 — backfill 57 existing posts with FAQs + Key Takeaways + Schema + AI Prompt + hreflang (staged edits only, Liam batch-publishes)

Pending migrations (queued, run after each deploy lands):
- 0060 (content_drafts table, Slice 2)
- 0061 (link_suggestions table, Slice 6)
- 0062 (content_drafts cols + publish_history table, Slice 5)
- 0063 (blog_backfill_log table, Slice 6.5)

Not yet shipped (deferred / future slices):
- Slice 7 — LinkedIn engagement + competitor RSS + Timothy Ricks YouTube transcripts + Webflow news feed signal expansion
- Slice 8 — citation tracker + quarterly refresh engine
- Slice 9 — LinkedIn auto-post (deferred until Liam commits to comment engagement)

Action items for Liam's QA session:
1. Wait for the Slice 5/6/6.5 deploy to land, then run migrations 0060/0061/0062/0063 (Claude can fire them via MCP once visible)
2. Settings → Integrations → Google → confirm GA4 + GSC + Calendar + Drive scopes all show as connected
3. Settings → Content engine signals → click "Auto-detect GA4 property" to populate the property ID + paste Matomo + SE Ranking keys
4. /content-studio Health tab → click "Scan now" to seed blog_health with indexing status of all 57 posts
5. /content-studio Health tab → "Backfill all 57" to populate FAQ + takeaways + schema across the back catalogue (staged edits in Webflow; spot-check 5-10 then batch-publish)
6. /content-studio Ideas tab → click "Run ideation now" to fire the Monday cron manually + see what ideas surface for this week
7. When an idea is approved, the drafting cron runs hourly (currently disabled — flip on via Settings → Content engine signals when ready)
8. Add Webflow CMS field "Hreflang block" — Plain text long, slug `hreflang-block` — so the hreflang patches land properly

### Content + presence (older note, mostly superseded by Phase I)

Earlier 2026-05-24 goal of "1 newsletter / month + 1 LinkedIn post / day" still stands as the supporting cadence around the Phase I blog engine. Newsletter mechanism + LinkedIn auto-post live as Slice 9 (logged, deferred until Phase I MVP is stable).

---

## Workflows

### Maintaining the knowledge base (Docs Hub) — **shipped 2026-05-23 ✓**

> Liam captures and finds operating docs, brand notes, services, sales playbooks, team SOPs, and product notes. The dashboard is the source of truth — not Notion, not Google Docs, not Slack threads.

**Steps:**
1. Open `/docs`
2. Filter by category (multi-select chip) or search title + content
3. Click a row → slide-over preview opens
4. Edit inline (or create new) with the Notion-grade editor
5. Review version history; click any version to view its content

**Surfaces:**
- Docs Hub page (`app/(dashboard)/docs/docs-content.tsx`)
- DataTable + FilterBar (multiselect, nonRemovable Categories chip)
- SlideOver (56rem) for view + edit + version history
- TiptapDocEditor (top toolbar, bubble menu on selection, slash commands, task lists, image)
- ConfirmDialog for destructive deletes

**Status:** design ✓ · data ✓ · feature ✓ · live-tested ✓

**Locked.** Do not change without explicit request. Past iterations covered: edit-bug fix, table layout, multi-category support, FilterBar multi-select extension, capped chips, wider slide-over, clickable historical versions, Notion-grade editor rebuild, white-card row surface.

---

### Lead intake & qualification (Phase A · 1-2)

> A new lead arrives — Webflow form, email referral, affiliate link, manual entry. Liam needs to capture it, then decide whether to pursue.

**Steps:**
1. Lead lands as a row in the `leads` table (manual quick-add OR Webflow form webhook OR affiliate referral)
2. Captures: name, email, company, source, brief, deal-size estimate, owner (default Liam)
3. Auto-creates "Schedule discovery call" task with 48h SLA
4. Liam reviews lead list, triages: pursue / nurture / archive
5. On "pursue": schedules the discovery call

**Surfaces:**
- `/leads` index page (DataTable + FilterBar pattern from Docs Hub)
- Lead detail (slide-over with capture form + activity)
- `leads` schema (new)
- Webflow form webhook receiver
- Affiliate referral capture (Phase C)

**Status:** (not started — first build for Phase A)

**Open issues:**
- Webflow form fields not mapped yet
- Decide schema: separate `leads` table OR re-use `deals` with a pre-pipeline stage. Lean: separate table (clean conversion metrics, easy archive)

---

### Discovery call (Phase A · 2)

> Liam jumps on a discovery call with a prospect. The dashboard should remind him what to ask, record what happened, and turn the call into a deal + next steps.

**Steps:**
1. Open the lead's record (search or `/leads`)
2. Review prep: brief, previous emails, source
3. Conduct the call (Google Meet, recorded)
4. Upload Google transcript afterwards (text paste OR file upload)
5. Log signals: budget, timeline, fit, decision-maker, objections
6. Pick outcome:
   - **Promote to deal** → creates a deal in pipeline at "Verbal interest" stage, copies discovery context forward
   - **Nurture** → schedule next-touch task
   - **Archive** → mark lead as dead with reason

**Surfaces:**
- Lead detail slide-over
- Calls log surface (new)
- Discovery notes editor (Tiptap with prompts as placeholder text)
- Transcript upload (file/text paste, stored in R2)
- Pipeline (deals)

**Status:** (not started — Phase A · 2)

**Open issues:**
- Transcript parsing: keep as raw text first, AI summary later (Phase B)

---

### Calls log + meeting prep (Phase A · 3)

> Liam needs to see what calls are coming up today / this week, who they're with, what to prep, and after the call upload the transcript.

**Steps:**
1. Liam opens `/calls` (or sees today's calls on Overview)
2. Each call shows: when, who, lead/deal context, prep notes, agenda
3. After the call: upload transcript, capture outcome, fire follow-up tasks
4. Past calls remain searchable, linked to the lead/deal

**Surfaces:**
- `/calls` index (DataTable, upcoming + past tabs)
- Call detail slide-over (prep notes, attendees, transcript, outcome)
- Existing `scheduled_calls` schema
- Overview integration (today's calls widget)

**Status:** (data partly built — `scheduled_calls` table exists; UI is stub)

**Open issues:**
- Decide: Google Calendar OAuth sync, or manual entry? Lean: manual for v1, calendar sync in Phase B
- Transcript storage: R2 as file OR text in DB? Lean: text in DB for search, file in R2 if too long

---

### Making a deal

> A prospect commits. Liam needs to spin up the proposal, contract, and onboarding.

**Steps:**
1. Move deal to `verbal_commit` / `negotiation` in the pipeline
2. Draft proposal from a template
3. Share proposal with the client
4. Capture acceptance
5. Generate contract
6. Send contract for signing
7. On signing: kick off onboarding (welcome email, mailerlite add, hubspot sync, etc.)

**Surfaces:**
- Pipeline (board + detail)
- Proposals (templates, draft, share)
- Contracts (templates, send, sign)
- Onboarding checklist
- Integrations (Mailerlite, HubSpot, Slack)

**Status:** (todo)

**Open issues:** (todo)

---

### Running a project (PM)

> A live engagement. Liam needs to know what's in flight, what's blocked, what's due, and who's doing what.

**Steps:**
1. Daily glance at active requests + tasks + capacity
2. Triage incoming requests (assign, prioritise, schedule)
3. Update statuses, comment on threads
4. Track time against work
5. Handle scope changes (flag, re-quote, re-schedule)
6. Deliver work, mark complete

**Surfaces:**
- Overview (KPIs, today's focus)
- Requests (board + detail)
- Tasks (three-level)
- Time tracker
- Schedules / Gantt
- Capacity
- Messages

**Status:** (todo)

**Open issues:** (todo)

---

### Sending an invoice / getting paid

> Either a manual one-off invoice or a recurring retainer. Stripe + Xero in the mix.

**Steps:**
1. Decide what to bill (project, retainer, hourly)
2. Generate invoice (manual, Stripe, Xero auto-gen)
3. Send to client
4. Track status (sent → viewed → paid → overdue)
5. Reconcile payments

**Surfaces:**
- Invoices (list + detail)
- Billing
- Stripe + Xero integrations
- Time entries (for hourly billing)

**Status:** (todo)

**Open issues:** (todo)

---

### Daily ops (the morning kick)

> Liam opens the dashboard first thing. What should it tell him?

**Steps:**
1. What needs my attention today
2. What's overdue
3. What's coming up (calls, deadlines)
4. Team workload — is anyone overloaded
5. Any new client requests, replies, or escalations

**Surfaces:**
- Overview / AI briefing
- Notifications
- Upcoming calls
- Recent requests + replies
- Pipeline at-a-glance
- Team capacity

**Status:** (todo)

**Open issues:** (todo)

---

### Onboarding a new client

> A deal closed. The client now needs portal access, project setup, kickoff comms.

**Steps:**
1. Create the org + first contact
2. Set plan, tracks, billing model
3. Send welcome email + portal invite
4. Add to Mailerlite
5. Mirror to HubSpot
6. Set up the first project + schedule
7. Schedule kickoff call

**Surfaces:**
- Clients (create + detail)
- Subscriptions / Tracks
- Integrations (Mailerlite, HubSpot)
- Schedules / Templates
- Calls

**Status:** (todo)

**Open issues:** (todo)

---

### Team management

> Hiring, assigning, reviewing.

**Steps:**
1. Add team member (Clerk + team_members row + access scoping)
2. Assign rights (project_manager / task_handler / viewer)
3. Scope to specific clients or plans
4. Review their utilisation / hours

**Surfaces:**
- Team page
- Team member access (scoping rules)
- Capacity
- Reports (utilisation)

**Status:** (todo)

**Open issues:** (todo)

---

### Gmail sync + email tracking (Phase B · 5)

> Liam wants every email to/from a contact visible on their record, plus tracking on emails sent from the dashboard.

**Steps:**
1. Connect Gmail via Google OAuth (per-user, stored in `integrations`)
2. Background sync pulls recent inbox + sent items, matches by email address, attaches to contact
3. New emails from contacts surface as activity events
4. Emails sent FROM the dashboard (transactional via Resend) get open/click pixels and link wrapping
5. Per-contact view shows full email thread history

**Surfaces:**
- Settings → Integrations (Google OAuth)
- Contact / lead / deal detail pages (activity timeline)
- New `email_messages` table linking to contacts/leads/deals
- Resend webhook receiver for open/click events

**Status:** (not started — Phase B · 5)

**Open issues:**
- OAuth scope: read-only inbox + sent? Or also send-on-behalf? Lean: read-only first
- Privacy: this surfaces everyone's emails to anyone who can see the contact. Need access scoping
- Volume: 3.7k contacts × ~10 emails each = manageable. Background sync runs nightly + on-demand

---

### AI deal scoring + contact enrichment (Phase B · 6-7)

> Score deals on probability + suggested next action. Enrich new leads with company / role data.

**Steps:**
1. When a lead is created or updated, fire an AI scoring job using: source, signals from discovery, deal value, owner, time-in-stage, last activity recency
2. Show score on lead/deal card (0-100) plus a one-line "next action" suggestion
3. When a lead is created, enrich automatically: company size, industry, LinkedIn URL via an external API (Clearbit / Apollo / People Data Labs)
4. Surface enriched fields on the contact record

**Surfaces:**
- Lead + deal detail pages (score badge, next-action callout)
- Contact detail (enriched fields section)
- New `lead_score` + `enrichment_data` columns OR separate tables
- Settings → AI provider, enrichment provider

**Status:** (not started — Phase B · 6-7)

**Open issues:**
- Which AI provider? Anthropic (already in stack via MCP) is the obvious lean
- Enrichment cost: pick a provider that lets you pay per-lookup, not per-seat
- Privacy + GDPR: enrichment pulls public data but check the provider's terms

---

### Affiliate program (Phase C · 8-11)

> Replace Rewardful before ManyRequests cutover. Simple model: anyone who refers a lead that closes gets 10% of the first invoice. 12 affiliates today.

**Steps:**
1. Liam creates an affiliate record (name, email, referral code, commission rate, payment method)
2. Affiliate gets a unique URL: `tahi.studio/r/{code}` that cookies the visitor
3. When a lead lands (from a cookied visitor), the referral is attributed to the affiliate
4. When the lead converts to a closed deal with paid first invoice, commission is owed
5. Liam reviews owed commissions, marks paid (manual payout v1; payment-system integration later)
6. Affiliate sees their referrals + commissions in a small portal surface

**Surfaces:**
- `/affiliates` admin index (DataTable + FilterBar)
- Affiliate detail (referrals list, commission ledger)
- New `affiliates` + `affiliate_referrals` + `affiliate_commissions` tables
- `/r/{code}` redirect route that sets a cookie
- Lead intake reads the cookie to attribute on capture
- Affiliate portal (small, under `/p/affiliate/{token}`)

**Status:** (existing `/affiliates` page reads from Rewardful; needs full replacement)

**Open issues:**
- Commission model: per-lead flat? Per first invoice? Per recurring monthly? Liam said "10% per lead that closes" — clarify: one-time on first invoice, or recurring on every payment? Lean: one-time on first invoice (Rewardful's "first payment" model)
- Cookie window: 30 days standard
- Payout method: hold off on integration; Liam may change Stripe. Manual PayPal / bank transfer notes for v1

---

### Marketing email CRM (Phase D · 12-15, deferred)

> Eventually replace Mailerlite. Low urgency: 4 campaigns/year. Build the data layer first, keep Mailerlite as the send engine until usage proves the design.

**Steps:**
1. Subscribers + lists + segments live in the dashboard (source of truth)
2. Sync OUT to Mailerlite (push new subs, push unsubscribes) OR send via Resend directly
3. Webflow forms + portal signup add to subscriber list
4. Unsubscribe link in every email points at a dashboard page that flips status
5. Liam composes a campaign, picks list/segment, schedules + sends
6. Analytics roll up opens / clicks / unsubscribes per campaign

**Surfaces:**
- `/subscribers` (DataTable + FilterBar)
- `/lists` + `/segments`
- `/campaigns` (compose, schedule, send)
- New `subscribers`, `email_lists`, `email_list_members`, `email_campaigns`, `email_events` tables
- Unsubscribe endpoint
- Resend integration for sending OR Mailerlite sync-out

**Status:** (not started — Phase D, deferred)

**Open issues:**
- Send infrastructure: Resend handles low-volume (Liam's 4 campaigns/year easily). For higher volume, may need a dedicated transactional/marketing sender
- Deliverability: domain reputation, SPF/DKIM/DMARC already set up for transactional emails — broadcast may need extra checks
- Campaign builder: rich-text via Tiptap is easy; visual block builder is a big lift. Lean: start with rich-text, defer block builder

---

## Adding a workflow

When Liam mentions a new recurring activity, add it here with the template:

```
### <Workflow name>

> One-line description of what he's trying to accomplish.

**Steps:** 1..N

**Surfaces:** which pages / components

**Status:** design ✓ / data ✓ / feature ✓ per surface

**Open issues:** specific things broken today
```

Then pick one workflow per session, tighten it to `shipped`, and check it off.
