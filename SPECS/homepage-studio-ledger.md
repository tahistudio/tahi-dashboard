# Homepage redesign — "The Studio Ledger"

Source: 21-agent design exploration (17 per-card Opus designers + 3 Fable composition
stances + Fable synthesis), grounded in the ICP, the Clay/Notion/Stripe/Vercel/ElevenLabs
north-stars, the Donezo/Crextio/Okisuka references (SPECS/homepage-visual-refs.md), the
impeccable polish findings, and the Tahi token + concept-bank system. Run wf_e84870b7-58c.

## Thesis

The most important things on the page wear the LEAST chrome. MRR is set at display scale
directly on the warm-sand canvas, no card, no gradient, no icon. Five KPI tiles become a
typographic ledger; two pipeline cards become one; two frequently-empty hero tiles dissolve
into rails; the task chip-grid folds into a Today rail. Thirteen-ish cards become six.
Personality is load-bearing (it IS the information architecture), never decorative.
A healthy business is a shorter, calmer page; trouble visibly tightens it.

This resolves the Clay-meets-Vercel tension: Stripe-grade money typography under a
hand-signed morning note. It is structurally un-copyable because the character is the IA.

## The five signature moves (the spine)

1. **The Ledger Masthead.** Business vitals as broadsheet typography set directly on the
   canvas: no containers, hairline rules, tabular-nums, one CountUp (MRR only). The
   most important things wear the least chrome. No competitor dashboard does this.
2. **The Studio Voice.** The page speaks exactly one human sentence per day. "While You
   Slept" + the AI briefing + the off-track headline fuse into a single signed morning note
   ("Noted 7:14am") with a self-drawing leaf in the margin. The word "AI" never appears.
   NZ-works-while-they-sleep becomes the product's greeting.
3. **Glyphs that carry data, never decorate.** Edition Numbers turn the worklog into a
   numbered order book. The Growing Leaf appears in exactly three load-bearing homes (the
   note margin draw, the pipeline month rail growing a vein per win, the runway horizon's
   seasonal leaf). If a leaf is on screen, it is measuring something.
4. **Two Clocks + Workshop Light.** Every time surface renders the client's local time
   first, Auckland beneath. One breathing green dot exists anywhere on the page only while a
   timer is actually running. Place and presence as proof of real humans working right now.
5. **Earned loudness.** "Needs You" is hard-capped at three rows, one verb each, and owns
   the page's single border-trace. Amber/red appear only when literally true. Healthy states
   collapse to single calm lines ("All quiet in the studio"; "tide fully in"). Letterpress
   11px zone labels replace every icon-chip header. A good Tuesday is a short page.

## Layout (desktop, 12-col)

```
MASTHEAD (no card, type on warm-sand canvas)
  Kia ora, Liam . Wed 11 Jun . NZT 7:42 / PT 12:42 . (o) 47m on Acme   [cmdK] [+ New]

  NZ$24,800        CASH 142K . 9.2mo    OWED 6.4K [=-.]    (oo +5) 8     14 OPEN
  MRR  ~sparkbar~                                          CLIENTS       REQS
  ......................... hairline rule .........................................
  (leaf) While you slept: Stripe paid NZ$4,800, Mia replied on No.021.
         First thing: send the Vercel proposal.                       Noted 7:14am

NEEDS YOU  (max 3 rows, the ONE border-trace)
  o  Everbright launch phase 4d behind   [==planned==|--x]            [Reschedule]
  o  Sam (Stripe) in 2h 10m . 11:30 NZT / 16:30 PT                          [Join]
  o  INV-042 overdue 12d . NZ$3,200 . Northwind                            [Nudge]
  empty: "All quiet in the studio. Next: Sam at 11:30." + seasonal leaf

WORK
  [7] IN THE STUDIO (worklog: left-spine timeline, Edition Numbers, temperature time,
      Workshop Light row halos)          [5] TODAY (day-rail calls, client-local first,
                                              + next-on-the-bench task + 3 quiet rows)
AHEAD
  [7] PIPELINE (merged summary+forecast: 12-mo expected hero, raw->weighted gap line,
      erosion funnel, month rail with vein leaf, closing chips)
                                         [5] THE STUDIO (Liam + Staci beakers, live ember,
                                              plain-English verdict sill)
BOOKS
  [7] CASH & RUNWAY (runway is the answer, mood colour, horizon strip + seasonal leaf,
      cash-out date, quiet cash/burn footer)
                                         [5] RECEIVABLES (the tide line: shared-scale aging
                                              spine, high-water tick names oldest invoice)
```

Mobile 375px: masthead stacks (MRR, then 2x2 vitals), zones single-column, Needs You rows
full-width with 44px targets, Today rail above the worklog.

## Card-by-card disposition

| Current surface | Becomes |
|---|---|
| greeting + quick actions | two-word eyebrow + single "+ New" + Cmd+K chip |
| mrr tile | bare-canvas display ledger figure + sparkbar (only CountUp) |
| active_clients / open_requests / outstanding | masthead vitals (hairline-separated) |
| ai_briefing + while-you-slept + off_track headline | the one signed Studio Note |
| off_track (full) + imminent next_call + oldest overdue | Needs You (3-row capped queue) |
| recent_requests | In the Studio worklog (Edition Numbers, temperature time) |
| upcoming_calls + open_tasks | Today rail (call day-rail + bench tasks) |
| pipeline_summary + pipeline_forecast | one merged Pipeline card |
| team_capacity | The Studio (two beakers + verdict) |
| cash_position | Cash & Runway (runway-led) |
| receivables | the tide line |
| closing_month | folds into the Pipeline month rail |

## Decisions (RESOLVED by Liam, 2026-06-11)

1. **MRR** — Liam's call to me. Going bare-canvas display figure, but NOT minimalist: Liam
   likes information density and "card behind other cards that can be sliders." So build a
   reusable card-stack / slider primitive and use density-via-stacking in the rich zones
   instead of cutting data. Hierarchy stays (masthead inversion); zones get richer, not bald.
2. **Border-trace** — Needs You.
3. **Greeting** — "Kia ora, Liam".
4. **BOOKS** — always mounted, calm healthy states.
5. **Data lift** — FALLBACK FIRST. No blocking migration. Edition Numbers + Two Clocks
   degrade gracefully (worklog without numbers, calls NZT-only) and retrofit when fields land.

## Original open decisions (for reference; recommendations in **bold**)

1. **MRR presentation** — **bare canvas** (display type + sparkbar, green returns to pure
   signal) vs filled green band vs hybrid brand-50 wash. Build bare first; judge on the
   deployed page.
2. **The one border-trace lives on** — **Needs You** (mark the act-now surface, not the
   merely-important; MRR already owns the CountUp + display scale).
3. **Greeting language** — **"Kia ora, Liam"** (two words of te reo) vs "Good morning" vs no
   greeting. Genuinely Liam's call; fallback is time-of-day English.
4. **BOOKS zone** — **always mounted** with calm healthy states (a daily driver must be
   spatially trustworthy) vs conditional alarm band. Conditional energy lives in Needs You.
5. **Data lift** — **schema first**: slice-0 IF-NOT-EXISTS migration for
   `requests.deliveryNumber`, `organisations.timezone` (IANA), settings `monthlyCloseTarget`;
   backfill; then build UI on real data. Shipping the layout without Edition Numbers / Two
   Clocks would withhold the exact personality this redesign exists to add.

## Build slices

0. **Data groundwork (no UI).** Extend `/api/admin/overview` with: openByStatus, 6-month
   mrrHistory + month delta, overnightDelta {clientReplies, paymentsCleared,
   deliveriesCompleted} since lastSeen, activeTimer passthrough, oldest-invoice
   {clientName, amount, daysPastDue}, aged AR buckets (reuse ARAgingResponse). D1 migration
   (IF NOT EXISTS, reviewed vs prod): requests.deliveryNumber, organisations.timezone,
   settings monthlyCloseTarget. Backfill. Unit tests on the new aggregates.
1. **The Ledger Masthead.** Borderless masthead (eyebrow + Two Clocks + Workshop Light +
   Cmd+K + single "+ New"), MRR ledger figure + sparkbar + CountUp, four gated vitals, the
   Studio Note (leaf draw + inline-linked top concern + signed timestamp). Delete the
   greeting header, MRR tile, three LightKPICards, AIDailyBriefing. Add letterpress zone
   labels + zone spacing rhythm (space-8/10). Ship + live-QA 375px + dark before continuing.
2. **Needs You.** Capped 3-row queue, one verb per row, sourced from off-track + imminent
   call + oldest overdue. Wire the single border-trace here, remove elsewhere. Seasonal
   all-quiet empty state. Delete standalone off_track card + the two top tiles.
3. **WORK zone.** In the Studio worklog (left-spine, Edition Numbers, temperature time,
   Workshop Light halos) + Today rail (call day-rail client-local-first + bench tasks).
   Delete open_tasks chip grid + old upcoming_calls card.
4. **AHEAD zone.** Merged Pipeline card (12-mo expected hero, gap sentence, erosion funnel,
   month rail with vein leaf, closing chips) + The Studio two-beaker capacity card. One
   fewer card and one fewer fetch.
5. **BOOKS zone.** Cash & Runway (runway-led, horizon strip, cash-out date, quiet footer) +
   Receivables tide line. Fix outstanding tone logic so amber derives only from genuinely
   late slices.
6. **Polish lap + DoD.** Motion ladder audit (one reveal/session, one CountUp, one trace,
   hover animations play to completion), Instant Second Visit warm-load caching (zero
   skeletons on warm), full data-private sweep, prefers-reduced-motion fallbacks, dark
   4-level pass, 375px pass, then live Chrome QA on the deployed URL with screenshots.
```
