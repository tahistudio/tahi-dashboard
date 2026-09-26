# Port plan: calculator-analytics

Routes: /calculator, /sales-analytics, /affiliates. Audience: studio only (no client variant, no public variant).
Status when shipped: ported, unchecked (Liam, 2026-09-26: build the 2026-09-14 designs following the app's own patterns; he has not reviewed them). Record each port commit under the calculator-analytics section of docs/superpowers/plans/2026-09-14-design-review-for-liam.md and leave its review box empty.

Sources read for this plan:
- Review doc section "calculator-analytics" (critic verdict FIX, standalone, 72 screenshots).
- docs/superpowers/design/requirements/studio-calculator-analytics.md and docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md.
- Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66, read in full through the claude-design MCP: calculator.jsx, calculator-kit.jsx, calculator-data.jsx, calculator.css, calculator-ct19.jsx, plus head-band.css section 1 (the shared headline band). Preview: https://claude.ai/design/p/57bf60cf-5e6d-450f-9e2f-e25c8d12fd66?file=previews%2Fcalculator-analytics-preview.html (add &page=<key>, &theme=dark, &device=phone).
- Live code: app/(dashboard)/calculator (page.tsx, calculator-content.tsx), app/(dashboard)/sales-analytics (page.tsx, sales-analytics-content.tsx), app/(dashboard)/affiliates (page.tsx, affiliates-content.tsx), lib/calculator (types.ts, compute.ts), app/api/admin/calculator (route.ts, draft/route.ts), app/api/admin/integrations/rewardful (route.ts, sync/route.ts), app/api/admin/deals/route.ts, components/tahi/settings/sections/integrations.tsx, and the primitives under components/tahi.

## Ground rules for every slice

- Existing primitives and patterns win over the prototype. The prototype hand draws its charts, buttons, fields and tables; the port uses PageHeader, Card, FeatureCard, KPI and chart primitives (DonutChart, FunnelChart, MultiBarChart in components/tahi/chart.tsx), DataTable, RailLayout, SegmentedControl, Input, Select, Textarea, Badge, ProgressBar, Callout, EmptyState, SkeletonBar and SkeletonChart, TahiButton, Private, RelativeTime and useToast.
- The design sets look, density and vocabulary. The repo and the data model set the fields: never drop a live field because the mock omitted it, and never add a field the model does not have because the mock drew one.
- No API change, no compute change, no migration. Everything new on the rail is derived client side from the inputs and outputs the routes already return.
- Tokens only (no hex outside the sidebar and outside the existing lib/chart-colors palette the chart primitives already use), rem not px, borders on all sides or none, leaf radius only on icon tiles, the quote hero and primary CTAs, 44px targets below md, no horizontal scroll at 375, dark mode through .dark, no em or en dashes in copy or comments, no console.log, no any.
- Pay stays NZ$64k each (Liam, 2026-09-26: "we haven't upped it yet"). The calculator's cost basis, CALC_CONSTANTS.effectiveHourlyRateNZD (95, described as including salary, opex and tools), is not retuned to a 74k or 78k assumption, and the design's sample per-discipline cost rates (NZ$138 to NZ$165 an hour) are sample data, not a model to port.
- Docs Hub is locked and untouched. None of these routes touch it.

## What the live code already matches (no work)

- Access. All three page.tsx files redirect a non-admin and a studio admin previewing as a client (getViewAudience, isPreviewingClient) and call requirePageFeature. That is the product answer to the design's calc-blocked, calc-denied and affiliates-denied pages and to the StudioOnly stop: they stay server redirects, and no in-page card is built for them.
- /calculator: the two column form plus sticky rail, 400ms debounced compute-and-save on every change, rename on blur (PATCH), the dealId/orgId anchoring and history fetch, the prior calculations panel appearing only when more than one saved calculation exists, retainer hidden on a one-off, pacing only on project plus retainer, draft actions that POST to /api/admin/calculator/draft and navigate to the editor, currency-aware Intl formatting.
- /sales-analytics: PageHeader, the forest and lime FeatureCard hero pair, the funnel, donut and six month stacked-by-owner bar on the shared chart primitives, the three exact empty-state strings, display-currency formatting, the Phase 8 roadmap card with its three links.
- /affiliates: DataTable with the six columns, default sort by commission descending, Badge states for active, pending and disabled, DataTable's built-in loading skeleton, the "No affiliates yet" and "No matches" empty strings.
- Stale review item: question 6 in the review doc (the /api/admin/deals scoping leak) is already fixed. app/api/admin/deals/route.ts now calls scopedOrgIds and orgColumnInScope. No backlog line is needed.

## What differs, page key by page key

### /calculator

- calc (ready): the live header is a hand-rolled block with an always-on "Back to deals" link, a hardcoded-px leaf icon tile and a "Saved Xs ago" text; the design has CalcHead (icon tile, in-place title with hover and focus, a save pill, an anchor pill only when anchored, a New calculation action). The live form uses hand-rolled Card, Field, NumberInput and select boxes; the design has icon-headed cards with a meta line, discipline rows with icons and a Delivery segmented control, radio cards for complexity, and a check row with explanation. The live rail shows the quote twice (a forest FeatureCard and an emphasis card) and three flat rows for cost; the design has one leaf hero with a floor to stretch range, a Recommendation card of derived rows, a donut with a legend, a capacity meter and a benchmark table.
- calc-computing: live shows the text "Computing" (with a Unicode ellipsis) in a placeholder card; the design keeps the hero box with a skeleton figure and a "Working out the range" line, and on later recomputes keeps the last figures with "Recomputing, these are the last figures".
- calc-oneoff: live hides the Retainer card silently; the design puts a quiet note in its place. The design's benchmark empty state ("No comparable closed deals yet") replaces live's disappearing card.
- calc-deal and calc-org: live cannot tell the two apart in its header (it always says deal); the design shows an info note and a "Back to <name>" pill for either anchor. Nothing in the app links here yet (Liam question 2), so both are reachable only by URL.
- calc-capacity: live colours the capacity state with three hardcoded hex values (#dc2626, #9a3412, #15803d); the design uses a meter plus a coloured line. The design's weekly bars need per-week booked hours the compute does not produce and are not ported.
- calc-error: live shows only a toast; the design adds a rail note with Try again and a "Not saved" save pill.
- calc-draft: live draft failures are silent; the design shows an error note in the Draft card.
- calc-denied, calc-blocked: server redirects already (no work).

### /sales-analytics

- analytics: the live three cell KPI strip is a local KPICell with a borderLeft divider (a single-side border); the design replaces it with the shared four tile headline band (hairline gaps, no side borders). The design adds section headings with one-line hints. The design's band sub-lines "moved stage this week" and "Up N points on last quarter" have no data behind them and are not ported.
- analytics-loading: live hero tiles print "Loading..." and a final-sounding description under it; the critic's FIX is that descriptions must not render final copy while the figure is a skeleton.
- analytics-empty: matches live copy; only the band values change ("Nothing yet", "No reading").
- analytics-error: live has no error state (a failed read looks like an empty pipeline); the design has an error card with retry.
- analytics-denied: live 403s silently when the seat holds sales_analytics but not deals; the design has a denied card.
- analytics-ct19: skipped (Liam question 1).

### /affiliates

- affiliates (connected, not syncing): live header is hand-rolled; it reads "Rewardful affiliate tracking and commission management" and a Refresh button; three StatTiles show zeros (with an em dash placeholder while loading). The design uses the page head, a "Last checked" stamp and "Check again", the shared band with "Not syncing" in place of zeros, a "Connected, and not syncing" note, and the left rail (views and counts) with search and count above the table instead of the Input plus FilterBar toolbar.
- affiliates-connect: live has a raw anchor with #ffffff pointing at /settings. New finding: Settings has no Rewardful control at all (components/tahi/settings/sections/integrations.tsx lists Stripe, Xero, Slack and Mailerlite only), so the CTA is a dead end. The port drops it and says so.
- affiliates-loading: design uses band and table skeletons; live uses DataTable loading plus em dash tiles.
- affiliates-error: live falls back to the connect card on any failed read; the design has a distinct error card. Also, the GET is gated on settings.integrations, not affiliates, so a seat with Affiliates but not Integrations gets a 403 today.
- affiliates-rows and affiliates-filtered: design-only shape states with sample rows; the port only makes sure the table renders well if rows ever arrive (mobile cards at 375, the filtered empty state).
- affiliates-denied: server redirect (no work); the 403 variant above gets its own honest card.
- affiliates-codes: skipped (proposal).

## Critic FIX items and where they are resolved

1. Title input clips mid-word at 375 (calc, calc-computing, calc-oneoff, calc-deal, calc-org, calc-capacity, calc-error, calc-draft): slice calculator, header item. Ellipsis at rest, full name in the title attribute, 1.25rem below 40rem, head wraps so the action drops to its own row.
2. analytics-loading tile descriptions render final copy under a skeleton: slice sales-analytics, states item. Both FeatureCard title and description render SkeletonBar while loading.
3. Dark hex on the active project-shape pill (.cal-pill.on): slice calculator, form item. The port has no filled brand pill; project shape is radio cards with a brand-50 tint and brand border, delivery is SegmentedControl.
4. Unverified below the fold: capacity meter in dark (slice calculator: Badge and ProgressBar tones, token backed); CT.19 sections (skipped); affiliates rows at 375 (slice affiliates: DataTable mobileCard).

Requirement-doc fixes folded in: the em dash in the calculator metadata title and in two code comments, the em dash stat-tile placeholder on /affiliates, the #fff and capacity hex literals, the #ffffff raw-anchor CTA, the KPICell side border, silent draft failures, the silent analytics error, and the affiliates error that pretended to be "not connected".

## Slices

Four slices with disjoint owned files. Slice band runs first because sales-analytics and affiliates both render the band. Calculator is independent and can run in parallel with band.

### Slice band: shared HeadlineBand primitive (0.5 day, only if absent)

Owned file: components/tahi/headline-band.tsx (new).

First check main for an existing band primitive (grep for HeadlineBand and for a file named headline-band.tsx). Other design modules (requests, clients, finance, sales-pipeline, ops) use the same band, so another port may already have created it. If it exists, skip this slice and use it as is; if its API differs from the one below, adapt the two consumer slices, not the primitive.

If absent, build it from head-band.css section 1 in the Claude Design project (the .hband rules). Exports:
- HeadlineBand({ label, children }): an outer div with container-type inline-size and an aria-label; inside, a grid with a 1px gap over background var(--color-border-subtle), border 1px solid var(--color-border) on all sides, radius var(--radius-lg), overflow hidden. Columns 1.35fr 1fr 1fr 1fr for four tiles, 1.35fr 1fr 1fr for three, 1.35fr 1fr for two.
- HeadlineBandCell({ icon?: LucideIcon, label, value, sub?, tone?: 'money' | 'growth' | 'time' | 'work' | 'danger', meter?: number, quiet?: boolean, private?: boolean }): background var(--color-bg), fixed height 6.125rem, padding 0.6875rem 0.875rem; label 0.625rem, 700, uppercase, letter-spacing 0.06em, var(--color-text-subtle), one line with ellipsis; value 1.375rem, 700, tabular numbers, one line with ellipsis; sub 0.6875rem var(--color-text-muted), clamped to two lines. The first tile is the lead: soft accent fill color-mix(in srgb, accent 7%, var(--color-bg)) (14% under .dark), value 1.625rem in the accent, and the optional 2px meter at its foot (meter is ignored on any other tile). Accents map to existing tokens, never new hex: money var(--color-link), growth var(--badge-warning-text), time var(--status-in-progress-text), work var(--color-text-muted), danger var(--color-danger-ink). A danger tone on a supporting tile gets the alarm tint; quiet dims the value to var(--color-text-subtle). private wraps the value in Private (components/tahi/private.tsx).
- HeadlineBandSkeleton({ cells = 4 }): the same box and tile heights with three SkeletonBar lines per tile, so nothing moves when data lands.
- Narrow rules as container queries in a scoped style string inside the component (the way components/tahi/requests/capacity-strip.tsx carries CAPACITY_CSS), not in globals.css: at 50rem or less, two columns and an odd last tile spans both; at 44rem or less, tile height 4.8125rem, padding 0.625rem 0.75rem, value 1.25rem, sub one line.
- Tiles are read-only. No single-side border anywhere: the hairline between tiles is the grid gap.
- Verify in both themes at 1440 and 375 on a scratch render (the two consumer slices do the live check).
- Do not add it to the design-system page or globals.css in this slice.

### Slice calculator: /calculator (2 days)

Owned files: app/(dashboard)/calculator/page.tsx, app/(dashboard)/calculator/calculator-content.tsx, and new files under app/(dashboard)/calculator/_parts/ (for example calc-head.tsx, calc-form.tsx, calc-rail.tsx, radio-cards.tsx).

Follow calculator.jsx (function Calculator, page keys calc, calc-computing, calc-oneoff, calc-deal, calc-org, calc-capacity, calc-error, calc-draft), calculator-kit.jsx (CalcHead, SavePill, Card, Row, Hero, HeroComputing, Meter, Tbl) and calculator.css (head, two column, form pieces, quote hero, draft and prior, narrow). Do not port the numbers in calculator-data.jsx.

Unchanged: lib/calculator/types.ts, lib/calculator/compute.ts, app/api/admin/calculator/route.ts and draft/route.ts. Keep DEFAULT_INPUTS, addWeeks, diffWeeks, the 400ms debounce effect, runCompute (POST), rename (PATCH), the history SWR key and the one-time initialisation.

1. page.tsx: metadata title becomes 'Project calculator - Tahi Dashboard' (the em dash goes). Keep the redirect and requirePageFeature('calculator').
2. Split the 35 KB content file: the content shell keeps state and effects; header, form and rail move to _parts. Delete the local Card, Field, NumberInput, Row, RangeStat, SaveStatus and the inline style tag with its 1024px media query. Layout: Tailwind static classes, one column below lg, grid-cols-[minmax(0,1fr)_24.5rem] from lg, rail sticky only from lg.
3. Header: icon tile 2.75rem, radius var(--radius-leaf-sm), background var(--color-brand-50), brand icon (drop the '0 12px 0 12px' literal). A visually hidden label "Calculation name" for the title input. The input is borderless at rest, var(--color-bg-secondary) on hover, brand border and tahi-focus-ring on focus, rename on blur as today. FIX 1: the input gets min-width 0, width 100%, overflow hidden, text-overflow ellipsis, white-space nowrap and a title attribute with the full name; 1.5rem from 40rem up, 1.25rem below; the head wraps so the action button drops to its own full-width row (min height 2.75rem) below 40rem. Check at 375 with a 40 character name that the input ends in an ellipsis, never a clipped word.
   Meta row under the title: a save pill built on Badge (Saving, neutral, spinning icon that stops under prefers-reduced-motion; Saved, positive, with RelativeTime of the last save; Not saved, danger, after a failed compute). Only when anchored, an anchor pill button "Back to <name>" to /deals/<dealId> or /clients/<orgId>; name from SWR on /api/admin/deals/<id> (deal.title) or /api/admin/clients/<id> (org.name), falling back to "Back to the deal" or "Back to the client" while loading or on a 403 or 404. Min height 2.75rem below md. Remove the always-on "Back to deals" link and the "Anchored to no deal yet" line.
   Right: TahiButton secondary "New calculation" that resets name to 'Untitled calculation', inputs to DEFAULT_INPUTS, outputs and savedId to null. The debounce then POSTs a fresh row with the same dealId or orgId, exactly as a page load does.
4. Anchored note: when dealId or orgId is set, a Callout tone info under the head with the design copy for calc-deal or calc-org.
5. Form (left column), each a Card with a small icon tile, a title and a one-line meta:
   - Project shape: radio cards (role radiogroup, roving tabindex with arrow keys) for the three live types only, one_off "One-off", retainer "Retainer", project_plus_retainer "Project + retainer", each with a one-line hint that says what the calculator does with it (no retainer or pacing; a monthly plan with no build pacing; a build that rolls into a monthly plan, with twelve month pacing). Selected: border var(--color-brand), background var(--color-brand-50), text var(--color-text). No filled brand pill, so there is no text-on-brand colour to hardcode (FIX 3). Min height 2.75rem, hover border brand, focus ring. Three columns from lg, one below 40rem.
   - Scope: one row per discipline (webflow, engineering, design, strategy): icon tile, label and the live SCOPE_META hint; Hours (Input type number); Delivery (SegmentedControl role radiogroup, size sm, options Ourselves and Contractor); "Their rate (<ccy>/h)" only when Contractor. A contracted row tints with var(--badge-warning-bg) and border var(--badge-warning-border). Keep the Tool licences field, which the mock omitted. Card foot: "<n> hours across four disciplines." plus "<x> ours, <y> contracted out." or "All of them ours." Below 40rem a row stacks: discipline on top, Hours and rate side by side, Delivery full width with 2.75rem segments.
   - Timeline: Start (Input type date), Duration in weeks, Target launch (type date), with the existing two-way sync. Meta "Change any one of the three and the other two follow". Three columns, two below 52rem, one below 40rem.
   - Retainer (when projectType is not one_off): the live fields stay: Monthly hours, Plan (Select: maintain, scale, tune, launch, custom), Duration in months. Add a derived hint when outputs.pacing.asProjectPlusRetainer exists: "Comes to <monthlyFee> a month at the target margin." On a one-off, a Callout tone neutral in its place: "No retainer on a one-off. Pick a shape with a plan behind it and the retainer comes back, with the pacing card."
   - Client and complexity: Currency Select (NZD, USD, GBP, AUD, EUR) and Relationship Select (cold, warm, returning), both live. Complexity as radio cards for the six live multipliers (Simple 0.7x, Light 0.85x, Standard 1.0x, Stretch 1.15x, Complex 1.3x, Very complex 1.5x), multiplier in var(--color-link), three columns from lg, two below 40rem. Returning client check row: a real checkbox in a 2.75rem row, "Returning client discount", "Takes <n> percent off the target." with n from CALC_CONSTANTS.returningClientDiscountPct (10, never the design's 5).
   - Notes: Textarea, meta "Studio only. Never copied into a proposal, schedule or contract." (true: the draft route does not read notes).
6. Rail (right column):
   - Quote hero: one card replacing both the forest FeatureCard and the duplicate emphasis card. Radius var(--radius-leaf), border var(--color-brand), background var(--color-brand-50). Eyebrow "Quote target" in var(--color-link); figure 2.125rem, 800, tabular, nowrap (1.75rem below 40rem); sub "<blended>/h blended over <total> hours" where blended is target divided by the sum of scope hours (omit when that sum is 0). Under it a floor to stretch range: a track in var(--color-brand-100), a marker at the target position, Floor and Stretch labels with values, role img with an aria-label naming all three. Money inside Private.
     First compute (outputs null): the same box with SkeletonBar for the figure and the line "Working out the range" (replaces the "Computing" text). Later recomputes: keep the figures and add a role status line "Recomputing, these are the last figures". The debounce stays 400ms.
   - Compute error: keep the toast and add a Callout tone danger on the rail, "The last change did not compute", body "Everything on this rail is from the compute before it.", action "Try again" re-running runCompute(inputs); the save pill shows Not saved; both clear on the next success.
   - Recommendation card of rows: Blended rate; Hours with sub "<x> ours, <y> contracted"; Complexity with the label as sub and "x1.15" style value; Returning client ("-10%" or "None"); Margin at target (sub "<pct> percent", value target minus cost.total, emphasised). All derived.
   - Draft from this calc (only when savedId): three full-width row buttons (leaf-sm icon tile, label, one-line sub, chevron), min height 2.75rem, hover border brand and brand-50 fill, focus ring. While one is busy its label reads "Creating" and the others are disabled. On a non-OK response read { error }, toast it, and show a Callout tone danger inside the card, "The <proposal | schedule | contract> was not created". On success router.push(url) as today. Omit the design's "Saved as <id>" meta.
   - Cost breakdown: keep DonutChart with the live three segments (Internal cost, Direct cost, Margin, centre Margin and percent) and the Internal, Direct, Total rows; caption "Internal hours are priced at NZ$<rate> an hour, converted to <ccy>." reading CALC_CONSTANTS.effectiveHourlyRateNZD.
   - Capacity: meta "<start> to <launch>" from the inputs. A Badge with a dot, tone from outputs.capacity.warning (comfortable positive "Comfortable", tight warning "Tight", over_capacity danger "Over capacity"), which replaces the three hex literals. ProgressBar with value requiredHoursThisQuarter and max availableHoursThisQuarter, tone matching the badge, label "This job", trailing "<required> of <available> free hours"; when available is 0 or below, a full danger bar and "No free hours in the window". Caption outputs.capacity.note. No weekly bars.
   - Benchmark vs similar deals: always rendered. Median null: EmptyState inline "No comparable closed deals yet", "Nothing closed with a value in the last 24 months, so there is no honest median to put this next to." Otherwise two stats (Median closed; This target, plus or minus N percent against the median, derived) and a compact list of outputs.benchmarks.similarDeals (title, closed month, value in its own currency). Meta "Closed deals with a value, last 24 months": the heuristic is not size matched, so do not write "similar size".
   - Project and retainer pacing (when asProjectPlusRetainer): a large stat "Twelve month value" with sub "<projectFee> build, <monthlyFee times 12> retainer", then the three live rows. No monthly chart.
   - Prior calculations (when history.length is more than 1): a card of row buttons (name, updatedAt, target and hours parsed from that row's JSON), the current one marked aria-current with a brand-50 background, at most five, loading on click as today. When parsing a saved row, fall back to DEFAULT_INPUTS for any scope line an old-shape row lacks, so an old calculation cannot crash the form.
7. States to show: first compute, populated, recomputing, compute error, draft error, one-off, anchored to a deal, anchored to an org, capacity comfortable, tight and over, benchmark empty and populated.
8. 375 and dark: no horizontal scroll; every control 2.75rem below md (inputs, selects, segments, radio cards, check row, draft and prior rows, anchor pill, New calculation). Dark: badges, callouts, brand-50 surfaces and ProgressBar tones all come from tokens; check the hero figure and range labels for contrast.
9. Do not build: a client picker, weekly capacity bars, a monthly pacing chart, per-discipline cost rates, a fourth "Project" shape, plan hints or a monthly money field, "Calculate for this deal" or "for this client" entry points, a switch from POST to PATCH for autosave, any API or compute change, in-page denied or studio-only cards.
10. Done means: type-check, lint and build clean; live smoke on /calculator, /calculator?dealId=<a real deal>, a one-off, a forced error (offline), and one draft (it creates a real proposal on production: delete it after); 375 and dark screenshots; commit body says "ported, unchecked"; the commit is recorded in the review doc.

### Slice sales-analytics: /sales-analytics (1 day)

Owned file: app/(dashboard)/sales-analytics/sales-analytics-content.tsx. Depends on slice band.

Follow calculator.jsx function SalesAnalytics (page keys analytics, analytics-loading, analytics-empty, analytics-error, analytics-denied) and calculator.css (feature tiles, sections, roadmap links). Existing chart primitives stay; the design's hand-drawn Funnel, Donut and StackBars are not ported.

1. PageHeader subtitle: "How the pipeline is shaped and what has closed. Read only, and studio only: nothing on this page has a client side."
2. Data: read every page of /api/admin/deals (the route caps limit at 100; request page 2, 3 and so on while a page returns 100 items) through one SWR key with a fetcher that loops over swrFetcher, so "Won, all time" is all time. Stages read unchanged. Keep useDisplayCurrency.
3. States: loading shows HeadlineBandSkeleton, the two FeatureCards with SkeletonBar in both the title and the description (FIX 2: no final copy under a skeleton), and SkeletonChart in each chart card. If either read errors with ApiError status 403, render only the denied card: EmptyState, lock icon, "This page needs the Deals grant as well", design body copy. Any other error renders only an error card: "The pipeline did not load", the design body ("An empty funnel would look exactly like a quiet quarter..."), TahiButton secondary "Try again" calling mutate on both keys. Neither state renders the band or the charts. Empty keeps the live copy everywhere and the band reads "Nothing yet", "No reading", "0".
4. Replace the local KPICell (borderLeft) and the grouped Card with HeadlineBand, four tiles: lead "Won, all time" (tone money, private, sub "<n> deals"); "Pipeline value" (growth, private, sub "<n> open"); "Close rate" (time, "<pct>%", sub "<won> won, <lost> lost"); "Open deals" (work, count, sub "Across <k> stages"). Delete KPICell. No meter, no quarter delta, no "moved this week".
5. Sections, each an h2 (1rem, 700, var(--color-text)) with a one-line hint in var(--color-text-muted): "Where the studio stands" (the two FeatureCards), "Where the open deals sit" (funnel and donut side by side from lg), "Closed won by month, by owner" (MultiBarChart), "Coming in Phase 8". Card headers: icon, title, meta ("<n> open deals", the open total, "<first month> to <last month>").
6. Next to close: "<value>. <stage>, <owner> owns it. Expected <date>." from live fields, skipping any part that is missing; the empty copy stays.
7. Roadmap card: the five items as a plain list with small icons (no list-disc); three Next Link tiles (Proposals, Schedules, Contracts) with a leaf-sm icon tile, label and chevron, min height 2.75rem, hover border brand and brand-50 fill, focus ring; three columns from 52rem, one below.
8. 375 and dark: band 2x2, tiles and charts one column, no horizontal scroll, link tiles 44px. Chart series colours come from lib/chart-colors (hex because Recharts SVG cannot read CSS vars; this is the existing exception, not new hex); confirm stages and owners stay distinguishable on the dark card and that both FeatureCards keep text contrast.
9. Do not build: the CT.19 sections, chart drill-down to /deals, hand-drawn charts, any change to /reports or to an API.
10. Done means: type-check, lint, build; live smoke with real pipeline data; 375 and dark; "ported, unchecked"; commit recorded in the review doc.

### Slice affiliates: /affiliates (1 day)

Owned files: app/(dashboard)/affiliates/affiliates-content.tsx and new app/(dashboard)/affiliates/affiliates-rail.tsx. Depends on slice band.

Follow calculator.jsx function Affiliates (page keys affiliates, affiliates-connect, affiliates-loading, affiliates-error, affiliates-denied; affiliates-rows and affiliates-filtered for the table shape only). Keep page.tsx as it is.

1. Header: PageHeader "Affiliates". Subtitle "Referral tracking and commission totals from Rewardful." when connected, "Referral tracking and commission totals, once an affiliate platform is connected." when not. Connected only: a "Last checked <time>" text (the client time of the last successful read, not integrations.lastSyncedAt, which never moves) and TahiButton secondary "Check again" (RefreshCw) calling mutate; when the result still has no rows, toast "Checked. Rewardful still returns no rows."
2. Not connected: EmptyState full, Plug icon, "Connect Rewardful", body "Affiliate tracking reads from Rewardful, and no key is set. There is no Rewardful control in Settings yet, so connecting it is an open question for Liam." No CTA: the live "Go to settings" anchor (with its #ffffff) goes, because Settings, Integrations has no Rewardful field and the button led nowhere. Do not port the design's "Connecting and disconnecting both live in Settings" line.
3. Connected with no rows (the only live connected state): HeadlineBand of four tiles, Affiliates, Referred leads, Conversions, Commission, each valued "Not syncing" with the design sub-lines (never a zero). Then a Callout tone warning, "Connected, and not syncing", with the design body minus the Settings action. Then the list.
4. List frame: RailLayout (components/tahi/rail/rail-layout.tsx), following components/tahi/notifications/notifications-rail.tsx for a light rail. affiliates-rail.tsx renders Views (All affiliates, Active, Pending, Disabled, each with a count, 0 when there are no rows) for both the desktop rail and the 44px sheet. RailLayout carries search ("Search affiliates by name or email"), the count (itemNoun "affiliate"), and one clearable chip for a non-default view. Remove the Input plus FilterBar toolbar. Sorting stays on the DataTable headers (defaultSort commissionsTotal desc); no rail Sort section.
5. Table: keep DataTable with the six live columns and Badge states. Add mobileCard for below md: name and email, state Badge, and a labelled 2x2 of Visitors, Leads, Conversions and Commission, min height 2.75rem. Empty: "No affiliates yet" with "Affiliate rows will appear here once the studio starts reading them from Rewardful. Nothing on this page can bring them across today." when there are no rows at all; "No matches" with a TahiButton secondary "Clear the filters" when rows exist but the view or search leaves none. If rows ever arrive, the band shows derived sums (count with active count, leads with visitors, conversions with percent of leads, commission in Private).
6. Loading: HeadlineBandSkeleton plus DataTable loading. The StatTile and its em dash placeholder are deleted, and so is the em dash in the old toolbar comment.
7. Errors: an SWR error other than 403 renders "The affiliate list did not load" with the design body and "Try again" (mutate), never the connect card. A 403 (the GET is gated on settings.integrations, not affiliates) renders "Your seat cannot read the Rewardful connection", "The affiliate read sits behind Settings, Integrations, which is off for your seat. Ask Liam to turn it on." No API change.
8. 375 and dark: no horizontal scroll (the six column table becomes cards below md), rail folds into the Filters sheet with 44px targets, Badge dots legible in dark, band 2x2.
9. Do not build: the affiliate-codes card (leads.affiliateCode), a per-affiliate detail, the "This is the shape, not the data" note or any sample rows, a call to the sync stub, a connect form, hiding the page from the nav, any API change.
10. Done means: type-check, lint, build; live smoke of whichever connection state production is in (the other states on local D1); 375 and dark; "ported, unchecked"; commit recorded in the review doc.

## Skipped (design proposals, design-only states, or waiting on Liam)

- analytics-ct19: the four sections CT.19 would move in from /reports (source breakdown, close rate by source, stage velocity, sales cycle length). Liam question 1; the port ships today's scope.
- affiliates-codes: the "Affiliate codes on leads" card over leads.affiliateCode, flagged Proposal in the design.
- The "This is the shape, not the data" note and sample rows on affiliates-rows and affiliates-filtered (preview-only states).
- The calculator Client select on an unanchored calculation (inert in the design; depends on the entry-point question).
- "Calculate for this deal" on /deals/[id] and "Calculate for this client" on client detail (Liam question 2).
- Weekly capacity bars (needs per-week booked hours the compute does not produce).
- The twelve month pacing bar chart (needs a billing milestone model the calculator does not have).
- Per-discipline cost-to-us rates, the fourth "Project" shape, plan hints and the monthly money field (sample data or fields the model does not have).
- Band sub-lines "moved stage this week" and "Up N points on last quarter", and a meter on a non-lead tile.
- In-page denied and studio-only cards for calc-denied, calc-blocked, analytics blocked and affiliates-denied (server redirects stay).
- A Rewardful connect control in Settings, and hiding /affiliates from the nav until N6 (Liam questions 3 and 4).
- Chart drill-down from /sales-analytics to /deals (marked proposal in the requirement doc).

## Questions for Liam

1. Sales analytics scope: small (ships now) or CT.19 large, which also means deleting the six sales sections from /reports?
2. Calculator entry points: add "Calculate for this deal" and "Calculate for this client", or keep the calculator a standalone sidebar tool? The anchored states work by URL today.
3. Is Rewardful still the affiliate platform? New finding: there is no Rewardful control anywhere in Settings, so /affiliates cannot be connected from the app at all. Add a Rewardful key field to Settings, Integrations (the POST route exists), or leave the page unconnectable until N6, possibly built on leads.affiliateCode instead?
4. Affiliates in the interim: keep the page in the nav with the "not syncing" framing (the port does this), or hide it until N6?
5. The calculator keeps the 400ms debounce with a moving save pill. Confirm.
6. Every debounced change POSTs a new project_calculations row, so a deal's prior calculations fill with autosaves. Should later changes PATCH the saved row instead (the PATCH route already recomputes)? The port keeps today's behaviour.
7. The /affiliates GET is gated on the settings.integrations grant, not on affiliates. Regate the read on the page's own grant? The port shows an honest 403 card instead.

## Risks

- The headline band is shared with other modules. Create it once (slice band, first), and have every other module reuse it; two parallel creations will conflict.
- Smoke tests write to production: every calculator change inserts a project_calculations row, and a draft creates a real proposal, schedule or contract. Delete test artefacts afterwards.
- /api/admin/deals caps a page at 100; without the paging loop the band undercounts once the pipeline passes 100 deals.
- Chart colours are hex in lib/chart-colors by necessity (SVG); that is the existing exception, not new hex.
- Six complexity radio cards lengthen the form at 375; check it still reads as one card, not a wall.
- Old-shape saved calculations: guard the form when a prior row lacks a scope line.
- The calculator's cost basis stays at the configured rate; the NZ$64k pay has not changed, so nobody should retune the rate or lift the design's sample per-discipline rates.

## Shared files (schedule around them)

- components/tahi/headline-band.tsx (new, shared by every module with a headline band).
- docs/superpowers/plans/2026-09-14-design-review-for-liam.md (each port records its commit).
- STATUS.md and TASKS.md (doc updates after the ports land).
- Consumed read-only, must not be edited by this module: components/tahi/rail/rail-layout.tsx, components/tahi/rail/rail-controls.tsx, components/tahi/chart.tsx, card.tsx, feature-card.tsx, segmented-control.tsx, data-table.tsx, progress-bar.tsx, badge.tsx, callout.tsx, empty-state.tsx, skeletons.tsx, input.tsx, private.tsx.
- app/globals.css is not touched; the band's narrow rules live in the component.
