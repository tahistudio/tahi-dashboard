# Homepage expansion — "The Studio Ledger, lit."

Source: 7-agent audit + colour + dynamics workflow (SPECS/_wf_homepage_expansion.mjs, run wf_cc625cd5-22a).
Builds ON the shipped Studio Ledger. Liam's brief: MORE cards/info from across the whole dashboard
(named content + social), and MORE colour + dynamics ("it's lacking color and Dynamics, nothing really
pops") while staying a premium $50k product.

## Headline

Keep the calm ink-on-sand masthead as the anchor; the page ramps into colour and life BELOW it. Density
comes from Crextio mechanics not clutter: every new domain gets ONE card, each carrying a second layer
(stack-deck behind, hover/tap footer reveal, or flip-side) so we get ~2x the information in ~1.3x the
footprint. Colour is a CLOSED 7+1 palette deployed sparingly. Dynamics mean only "data changed, time
passed, or you pointed" - with a hard rule that a resting page moves only the Wire ticker + the minute
marker.

## Colour system (closed 7+1 domain palette)

Tokens in globals.css @theme + .dark (no hardcoded hex). Canvas stays warm sand; cards stay white/dark.
- `--domain-money` #5A824E (= brand; the ONLY green-allowed domain) · money/MRR/cash/take-home
- `--domain-delivery` #0E7490 teal · requests/tasks/worklog/beakers
- `--domain-sales` #D97706 amber · deals/leads/proposals/calls
- `--domain-content` #7C3AED violet · blog pipeline/clusters
- `--domain-social` #0284C7 sky · Buffer
- `--domain-seo` #4F46E5 indigo · SE Ranking/index/sitemap/AEO
- `--domain-clients` #A21CAF orchid · health/reviews/testimonials
- `--domain-ops` = --color-text-muted (warm ink, achromatic) · automations/docs/contracts/team

Each gets a `-tint` (color-mix 11% light / 16% dark) and a dark `-bright` (L~0.78) for icons/chips/strokes.
**Colour lives in exactly 5 places:** (1) at most TWO tinted hero tiles per viewport (Content violet,
Pipeline amber); (2) leaf-radius icon chips per card; (3) Recharts stroke/fill (domain ink + 10% area,
second series always neutral); (4) count pills (tint bg + ink text); (5) card-stack peek edges.
**Never:** card backgrounds at large, the canvas, any borders, numerals/money/names (always ink), the
status/priority pills, the lime CTA, red/rose (danger only), the sidebar, multi-hue gradients.
**Guardrails:** one hue per card; green reserved for money/done/go; adjacent non-green cards differ by
40+ OKLCH degrees; sales amber at block scale, warning amber at pill scale, never both in one card;
deltas stay semantic; palette is closed (no new hue without retiring one). Dark mode reads slightly MORE
luminous (hero tiles become velvet panels, inks swap to -bright) - the direction Liam wants.

## Dynamics system (3 layers; resting-page budget)

- **Layer 1 - data breathes:** masthead MRR count-up over a 48px 12-month area sparkline drawing itself
  (monthlyRevenue is already in the payload, unused); 90s refetch with odometer-roll (400ms, tabular,
  zero layout shift) + brand-50 cell flash on changed figures; a shared `useLiveValue` count-up/odometer
  hook on every headline figure; charts draw on first mount only; localStorage diff flashes what moved
  since last visit.
- **Layer 2 - reactive surfaces (how MORE info ships without clutter):** every stat card hover lifts 2px,
  warms its border, and slides up one extra footer row (0fr->1fr, 240ms, server-fetched so instant,
  tap-toggle on touch) - cash-runway reveals 90d forecast + reserves, retainer reveals concentration,
  content reveals the 12-week publish heatmap, social reveals the 7-day dot matrix; the shared CardDeck
  gains 8s autoplay + conic progress ring + swipe + deal-in entrance, reused by calls/content/leads/
  proposals/retainer; beakers fill via IntersectionObserver + meniscus settle + timer bubbles.
- **Layer 3 - ambient choreography:** ONE orchestrated entrance (masthead then stagger, 1.4s cap, once/
  session); THE WIRE stepped ticker (4s dwell, 240ms slide-up, domain-ink dots, pause on hover/hidden,
  aria-live); ONE shared 1s + 60s tick for the whole page (countdowns, day-progress now-marker gliding
  each minute); Studio Note inks word-by-word after the leaf draw.
- **Budget check:** at rest (no timer/hover) the only moving things are the Wire's 4s step + the minute
  marker. All inside prefers-reduced-motion; one perpetual loop max (the workshop ember); hovers play to
  completion; border-trace stays exclusive to Needs You; nothing > 400ms except the once/session entrance.

## New cards

**Now (8, all real endpoints today):**
1. **Content Engine Deck** (violet HERO) - drafts by stage + "N ideas await you" + publish heatmap. /api/admin/content/drafts + /ideas + /schedule.
2. **Social Cadence (Buffer)** (sky) - 30-day cadence bars, streak, queue runway. Buffer status/posts. Cadence only, no reach.
3. **Hot Leads Deck** (amber) - AI-scored unworked leads, swipeable stack. /api/admin/leads?status=new.
4. **Proposals Live Board** (amber) - shared/viewed/accepted + live view ticker + open pulse + expiry. proposals + /api/admin/views.
5. **Contracts: awaiting signature / expiring** (ops ink) - signer progress + expiry countdown. /api/admin/contracts (+ add signed/total count).
6. **Retainer Health Deck** (orchid) - churn-risk + upsell, riskiest on top. /api/admin/reports/retainer-health.
7. **Cash-Flow Forecast Ribbon** (green) - 6-month forward area chart, trough callout. /api/admin/reports/cash-flow-forecast.
8. **Take-Home vs Target gauges** (green) - Liam + Staci $52k->$74k twin radial gauges. financial-reports/summary.

**Liam's two FIRM must-haves (fold in as "now"):**
9. **Time Tracker card** (delivery teal) - full standalone start/stop timer, today logged + billable hours, dark-native. The masthead Workshop-Light is the lite signal; this is the real card. Sources: get_active_timer / timers + timeEntries.
10. **World Clock + Meeting Planner** (ops ink + accent) - live current time in selectable zones (NZ home + US/UK/AU), click to choose/add zones, AND a draggable time-SCRUBBER converter: drag a reference time and all zone clocks move together ("2pm Wed my time = UK / NY / Sydney"). The page's most dynamic + useful single widget; client-zone data optional (manual zone picker, no schema needed). This is a recurring real pain scheduling across zones.

**Next (5):** The Wire (cross-dashboard ticker; needs a /overview/wire aggregator), Stuck Work (blocked/
overdue/scope-flagged), Team Utilisation flip (billable, behind the beakers), Reviews & Outreach funnel,
Index Health ring (SEO; ships with a "Connect Search Console" empty state).

**Later (4, data-layer gated):** Top Posts leaderboard, AI-Search Visibility (AEO), Client Health
Constellation, Delivery Spine portfolio off-track. **Permanently out:** AI spend meter (contradicts
Liam's quality-over-token-spend stance), affiliates (empty), onboarding (no schema), glossary, lead-source mix.

## Layout (top to bottom)

MASTHEAD (calm, one green moment) -> NEEDS YOU (border-trace) -> THE WIRE (32px ticker) ->
DESK row (Time Tracker + World Clock, Liam's daily tools) -> WORK (worklog + Stuck Work | Today rail) ->
GROWTH (Content violet HERO + Social sky + Index indigo) -> AHEAD/SALES (Pipeline amber HERO + Hot Leads +
Proposals) -> CLIENTS (Retainer orchid + Contracts ink + Reviews) -> BOOKS (Take-Home + Cash&Runway +
Forecast ribbon + Receivables). Mobile 375px: single column, decks swipe, hover footers become taps,
Wire stays one line.

## Decisions (RESOLVED by Liam, 2026-06-12)

1. Colour loudness: **B - chips/inks/pills + exactly two tinted hero tiles per viewport** (Content violet, Pipeline amber), tint capped 11% light / 16% dark.
2. Build approach: **A - all eight (now) cards at once, one big push** (not waves). Include the 2 must-haves + colour + dynamics + The Wire.
3. Sales hue: amber (sky stays social-only).
4. The Wire: build the /overview/wire aggregator as part of the push (it is the heartbeat; Liam wants the pop).
5. GROWTH position: directly under Needs You / The Wire.
6. Live refresh: 90s polling now, SSE later.
7. Time + World Clock: **folded into the zones** - Time Tracker into WORK; World Clock + meeting-planner scrubber near the masthead clocks (not a dedicated Desk strip).

## Build phases

1. **Foundation** (no new endpoints): 8 --domain-* token families + tints + dark; motion infra
   (useLiveValue hook, shared 1s/60s ticks, IntersectionObserver reveal, CardDeck swipe+autoplay+ring);
   masthead MRR sparkline + YoY chip + Studio Note word-ink + once/session entrance; beaker fill fix.
2. **Desk + GROWTH wave** (the named ask): Time Tracker + World Clock converter; Content Engine Deck
   (violet hero) + Social Cadence; idea-approval rows into Needs You. First eyes on the colour/motion
   vocabulary.
3. **SALES wave:** Hot Leads + Proposals Live + amber Pipeline hero upgrade. BE: add signed/total to contracts.
4. **BOOKS + CLIENTS wave:** Take-Home gauges + Cash-Flow ribbon + Retainer deck + Contracts; hover-footer
   rollout.
5. **The Wire + live page:** /overview/wire aggregator; 32px ticker; 90s odometer refresh; resting budget check.
6. **NEXT cards:** Stuck Work, Utilisation flip, Reviews funnel, Index Health (connect-state); full DoD sweep.
7. **LATER (data-layer gated):** scorecards->Top Posts, AEO cron->AI-Search, health GET->Constellation,
   spine rollup->Off-track.

Each phase: type-check + lint + build + deploy + live smoke + 375px + dark + reduced-motion.
