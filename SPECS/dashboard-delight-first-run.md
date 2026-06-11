# Tahi Dashboard — Premium Design Refresh (foundation + first-run delight)

Status: 2026-06-11 — DESIGN v2, awaiting Liam's review. Build paused per Liam
("spec everything fully first"). v2 incorporates a Fable-powered research +
adversarial review (4 research angles + spec critique + concept generation;
sources at the bottom). Verdict: **direction validated, execution corrected** in
eight places, plus a bank of twelve novel concepts.

A premium refresh in two parts: **(Slice 0)** an app-wide colour + light + motion-
token + space foundation that fixes the "dirty" green-tinted feel, then
**(Slices A-C)** the motion + personality layer, focused first on the first-run
journey (sign-in / sign-up, onboarding, overview).

See [[project_client_detail_overhaul]], [[project_icon_pack]],
[[feedback_animation_reverse_on_leave]], [[feedback_no_side_borders]], and the
ICP doc (Brand > Ideal Client Profile).

## North star

The dashboard is a showcase of what Tahi can do. A client who just paid (often
$50k+) should log in and feel it. The buyer is a stressed senior marketer (Head
of Marketing / CMO / founder) at a product-led SaaS company (ElevenLabs /
Physitrack tier). They build premium software; they will clock cheap or janky UI
instantly, and feel craft when it is there.

**"Lively" means alive, responsive, premium software craft : not playful.**
1. **Motion serves perceived performance.** Their #1 pain is slow / buggy. Every
   interaction gets instant feedback; motion makes the app feel faster, never
   slower.
2. **The first-run is a real moment.** Login -> warm branded onboarding -> a home
   that rewards arrival, ending on a tangible artifact.
3. **The hero joy moment is client-facing** (onboarding completion; later,
   request delivered). Leaf sweep, never confetti.

Tuned calm throughout: restrained, confident, one notch quieter than instinct.

## Slice 0a — Colour & light (the premium foundation)

**Diagnosis (validated by research).** The "dirty" feel = TINTED NEUTRALS, and
there are actually THREE clashing tints in the token file today: green-tinted
backgrounds/borders (`#f5f7f5`, `#f7f9f6`, `#eef3ec`, `#d4e0d0`), green-tinted
INK (`--color-text-muted #5a6657`, `--color-text-subtle #647461`), and cool-blue
Tailwind-grey table chrome (`--color-row-hover #fafafa`, `--color-th-bg #f9fafb`,
`--color-th-text #9ca3af`). De-greening only the backgrounds would leave warm
canvas + green ink + blue tables on one screen.

**Direction: WARM SAND (decided by the research, not left open).** The 2026
premium consensus is warm neutrals over cold greys (UPDIVISION + Lummi 2026
trend reports; Linear's own warm shift; Radix's sand-over-sage caution for green
accents). Note `#F3F4F2`'s highest channel is green : it still leans green. The
proven anchor is Notion's canvas territory: **`#F7F6F3` (warm, red-leaning;
oklch ~0.97 0.004 85)**.

**One generative OKLCH ramp, not hand-picked hexes.** Linear generates every
surface from three variables (base, accent, contrast) in LCH; Tailwind v4 +
shadcn are OKLCH-native. We define ONE warm ramp (fixed hue ~85, chroma ~0.004,
lightness-only steps) and derive EVERYTHING from it: canvas, secondary surfaces,
borders, the text ladder, table chrome, and all four dark elevation levels. This
makes "de-green" a one-line hue change and keeps light/dark mathematically
related (and gives a near-free high-contrast theme + future per-client accent
theming).

**Light mode**
- Canvas `--surface-canvas` ~`#F7F6F3`; cards `--surface` = pure `#ffffff`. The
  quiet 2-3% lightness delta IS the hierarchy (Notion/Attio polarity : not
  Stripe's white-canvas-plus-shadow polarity).
- Text ladder as near-black ALPHA steps (~90% / 54% / 35% of `#121A0F`-ish warm
  near-black), replacing the green-tinted muted/subtle inks.
- Borders as alpha hairlines: `rgba(18,26,15,0.08)` territory (the current
  `#CDCFCC` is heavier than the elite 8-9% alpha norm). Alpha borders give dark
  mode `rgba(255,255,255,0.08)` for free.
- Table chrome (row hover, th bg/text) re-derived from the same warm ramp : kill
  the Tailwind cool greys.
- Brand green = signal only: primary CTA, active nav, focus rings, ProgressRing /
  Growing Leaf, the celebration. Neutrals carry zero green. The always-dark green
  sidebar becomes the single strongest brand surface once the canvas is clean.

**Dark mode**
- Base canvas ~`#131211` (oklch ~0.16, same warm hue whisper : the current
  `#0F1410` / `#1B2419` greens are the same "dirty" problem in dark clothing).
- **FOUR elevation levels** (consensus minimum): canvas -> card -> nested/hover ->
  overlay, stepping **+5-8% luminance each** (Mercury sanity check: bg L~6% /
  surface ~10% / elevated ~15%). Elevation by lightness, NOT shadow.
- `box-shadow: none` on every in-flow surface inside `.dark` (the current `.dark`
  block INCREASES shadow opacity : research-rejected; "the signal disappears").
- Text ~`#E8E6E2`, never pure white. Brand green maps to the lighter `#7aab6b`
  for interactive elements (saturated `#5A824E` reads muddy on near-black).
- Hover behaviour split by mode: dark hover = elevate one lightness step; light
  hover = border darkens one ramp step (encoded in the semantic tokens).

**Shadow policy (Atlassian/Attio rule, written into tokens).** In-flow data cards:
1px hairline border, ZERO shadow, ever. Exactly ONE ambient shadow token exists
(~`0 4px 12px rgba(0,0,0,0.12)`) reserved for floating layers only: popover,
dropdown, modal, toast, drag-lifted card. Card hover = background tint
(`--color-hover-tint`) or border step : **no lift, no shadow** (the -2px lift +
shadow hover is the generic template/AI move). Press = `scale(0.98)`. The only
lift that survives is the CardStack's top card (genuinely floating).

**Depth budget (written rule).** Grain / gradient / atmosphere allowed ONLY on:
auth screens, onboarding welcome, proposal covers, empty states, brand moments.
Banned on tables, kanban, and any data card. Optional 1-2% noise on the light
canvas (test for banding at 375px). Glass, at most: the sticky top nav with
backdrop-blur heavily tinted toward canvas, degrading to solid : never
translucent cards or panels over data.

## Slice 0b — Motion tokens (re-based: the current scale is 2-4x too slow)

The existing scale (`--motion-base 420ms` as "the studio default hover") fails
our own perceived-performance commitment: Carbon puts hover/press micro-
interactions at 70-110ms; NN/g caps the envelope at 100-500ms with >500ms
reading as drag. A 420ms hover on a DataTable row, felt hundreds of times a day,
is "prettier-but-slower". Re-base:

- `--dur-1: 70ms` hover / press feedback
- `--dur-2: 110ms` small fades / colour shifts
- `--dur-3: 150ms` popovers / dropdowns
- `--dur-4: 240ms` SlideOver / toasts / list reveals
- `--dur-5: 400ms` expressive only (count-up, ProgressRing, reveal total)
- Exits run 50-100ms SHORTER than entrances (never previously specified).
- Easing split (Carbon model): productive (UI feedback) vs expressive (brand
  moments). Keep `--ease-out` cubic-bezier(0.22,1,0.36,1) as expressive; add a
  productive standard. For true springs (CardStack settle, leaf sweep), pre-
  generate `linear()` curves behind `@supports`, falling back to the bezier
  (the current `--ease-spring` bezier is not a spring).
- 520/720/1100ms demoted to brand moments only (auth atmosphere, leaf-sweep).
- `font-variant-numeric: tabular-nums` becomes a GLOBAL rule for all numeric /
  money display (Ramp mandates this; without it any number change shudders the
  layout). Verify Manrope's tabular figures render correctly.

**Reduced-motion architecture (inverted).** The current block nukes everything
(`animation-duration: 0.01ms !important` on `*`) : wrong shape ("reduce, don't
remove"; it also freezes shimmer mid-gradient). Invert: base styles are
motionless; transforms / reveals / sweeps / stagger live inside
`@media (prefers-reduced-motion: no-preference)`. Under reduce: sub-200ms
opacity fades stay, CountUp renders final value, ProgressRing renders final
sweep, shimmer renders a designed static placeholder, celebrate no-ops.

## Space, density & responsiveness

Standardise rem spacing; consistent card padding (~1.25rem) + section rhythm.
De-emphasise chrome so content leads (Linear). Tile size maps to importance;
~6-10 components per view; every widget deep-links to a next step. True
mobile-first: 375 / 768 / desktop reflow gracefully (stack + reorder, not just
shrink); no horizontal scroll; 44px targets; portal sidebar -> bottom tab bar.

## The reusable kit (Slice A, reused everywhere after)

1. **`<Reveal>` + `.tahi-stagger`** : fade-up entrance, children cascade at 45ms
   steps, capped at 8 children, total <600ms. **HARD RULE: fires once per route
   per session** (module-level / sessionStorage flag) : NEVER on refetch, filter
   change, tab switch, or pagination (the current fetch pattern remounts lists;
   replayed entrances are the #1 cheap-dashboard tell). Skip entrances entirely
   on keyboard-triggered navigation.
2. **`<CountUp>`** : RESTRAINED: the lead KPI tile (at most the KPI strip) on
   /overview + recap surfaces, once per load, 400-600ms decelerating. NOT every
   number. Polled/live updates get a ~2s brand-50 background tint instead of a
   re-roll. Requires tabular-nums. Preserves formatting + `data-private`.
3. **Shimmer skeletons** : slow left-to-right wave, ~1.6s loop (wave reads as a
   shorter wait than pulse : Chung), skeleton variants built FROM the real card /
   list components so layout matches 1:1 (mismatched skeletons perform worse
   than spinners : Viget). Cold loads only (see Instant Second Visit doctrine).
4. **Hover / press** per the shadow policy: tint/border hover, `scale(0.98)`
   press, no lift on in-flow cards.
5. **`celebrate(type)`** : one-shot portal'd leaf-sweep + sparkle (~800ms), fired
   on completion moments. Per-user disable toggle in /settings (Asana pattern)
   in addition to reduced-motion no-op.
6. **`<ProgressRing>`** : SVG ring, animated stroke-dashoffset + CountUp centre.
7. **`<CardStack>`** : depth-stacked swipe-away deck (controlled `linear()`
   spring settle; test the mid-settle re-grab failure case at 375px). **Debuts on
   announcements / reminders** where sequential consumption is natural : NOT
   onboarding (a swipe deck hides remaining steps; the Crextio pattern Liam
   liked is a VISIBLE checklist with X/N + ring). Keyboard + reduced-motion
   fallback to a plain list.
8. **Theme toggle via `document.startViewTransition`** (progressive enhancement;
   skip React's experimental wrapper) : today the body cross-fades 420ms while
   every token-driven element snaps.
9. (Slice B) sliding tab indicator + the broader icon micro-animation wiring.

## Per-surface design (first-run journey)

### 1. Sign-in / Sign-up
Branded split layout, but the left panel must DO WORK (logo + tagline + gradient
is the default of every Clerk/shadcn template since 2023 : this ICP signs into
ten a week). Two sanctioned treatments:
- A poster-scale typographic moment: ~56-64px Manrope 700 at -0.03em against an
  11px tracked uppercase label (the cheapest premium signal), OR
- A glimpse of the thing they bought: a blurred/abstracted live schedule or
  portal frame (Mercury-demo energy).
Grain/gradient atmosphere allowed here (per the depth budget) but any leaf drift
is play-once, not an infinite loop. Clerk styled via `appearance` (Manrope,
brand tokens, leaf radius on the primary CTA). Mobile: slim brand header. Cream
canvas, white card, AA focus states.

### 2. Onboarding phase
- **Welcome moment:** warm personal greeting, one calm sentence, the Loom embed
  framed premium (leaf radius), checklist beneath : all Reveal-staggered.
- **Checklist (Crextio treatment):** brand-dark-green card, "X of N" +
  `ProgressRing`, check-draw on complete, smooth row settle. Visible checklist
  (not a deck).
- **The first-run ends on an ARTIFACT, not a checklist:** the climax of the
  sequence is "see your delivery schedule" : land the client on their live
  schedule (delivery spine #148 already computes it) within 60 seconds
  (Loom/Stripe activation pattern).
- **Completion = the hero joy moment:** `celebrate('onboarding')` + "You're all
  set." Then the card gracefully retires.

### 3. Home / Overview
- Time-of-day greeting, Reveal-staggered assembly (once per session), shimmer on
  cold load only.
- **KPI treatment (Donezo reference):** lead metric tile filled solid brand-green
  with white text (FeatureCard forest/lime), others light; big numbers + "vs
  last month" captions; CountUp on the lead KPI only. Charts: green rounded
  bars / donut via the existing Recharts theme.
- Read order = importance (lead metric top-left); actionability (every widget
  deep-links); scope ~6-10 components, no new widgets in this slice.

## Concept bank (from the review : twelve novel, ICP-fitted ideas)

Ship-with-Slice-0/A (all S effort, compounding): **Edition Numbers** (every
delivery carries "Delivery No. 014, prepared for Acme by Tahi Studio" : tahi
means one), **Two Clocks** (client local + Auckland time + honest reply window
by the composer), **Studio Notes** (scarce margin annotations from Liam/Staci
explaining decisions on deliverables), **Southern Seasons** (the empty-state
leaf + footer mark cycle through NZ seasons : bud / full / turning / bare).

Ship with delivery-spine portal work: **The Growing Leaf** (a single-stroke leaf
that draws itself as a request advances : stem -> midrib -> veins -> full leaf;
our proprietary progress glyph, replaces generic ring vocabulary for requests),
**The Workshop Light** (a quiet "In the studio right now" pulse on a request
while a Tahi timer runs against it : real-time proof of work, binary state
never a duration), **While You Slept** (login ribbon: the delta since last
visit, deep-linked : turns the NZ timezone into the product's signature).

Ship with recap/tracks work: **Annual Rings** (the engagement as tree growth
rings, one per month, weight = delivered work; recap archive hangs off the
rings), **Board-Ready Receipts** (monthly recap gets "Share with your team" : a
tokenized, beautifully typeset summary the CMO forwards to their CEO; share
analytics tell Liam when renewal conversations warm up), **The Queue Is Yours**
(drag-reorder the backlog with spring physics : "You set the order. We work top
down."; feeds #189).

Platform doctrine (spec now, build later): **Instant Second Visit**
(stale-while-revalidate cache so repeat visits paint real content <100ms;
skeletons become cold-load-only; changed cards get a one-time border shimmer),
**Portal Command Palette** (real Cmd+K in the client portal : no agency portal
has one; every tool this ICP loves does).

## Rollout

- **Slice 0:** colour foundation (0a) + motion token re-base (0b) + tabular-nums
  + reduced-motion inversion + shadow policy. Highest impact, changes everything.
- **Slice A:** the kit + first-run journey (auth, onboarding, overview) + the
  four S-effort concepts (Edition Numbers, Two Clocks, Studio Notes, Southern
  Seasons).
- **Slice B:** propagate kit across pages + sliding tab indicator + icon wiring +
  space/responsiveness pass.
- **Slice C:** joy moments rollout (request delivered), CardStack on
  announcements, Growing Leaf / Workshop Light / While You Slept with spine work.

## Scope boundaries (YAGNI)

- No motion library; CSS-first + tiny rAF JS. No Clerk rebuild (appearance only).
- No glass/grain/3D on data surfaces, ever (depth budget).
- Concept bank items beyond the four S-effort ones are NOT in the first build.

## Verification

- type-check + lint + build green; CountUp unit tests (final value,
  reduced-motion jump, tabular layout stability).
- Live Chrome QA on deploy: full first-run flow; 375px + 768px; dark mode (four
  elevation levels legible, no shadows); `prefers-reduced-motion`; `data-private`
  preserved under CountUp. Screenshot the first-run.
- Contrast audit on the new ramp (AA for text ladders on both canvases).

## Decisions locked

- Motion level = lively & characterful, tuned calm + premium (ICP). (Liam.)
- Joy moments on big wins; hero = client-facing; leaf sweep never confetti. (Liam.)
- CSS-first, no motion library. Spec fully first, then build. (Liam.)
- **Canvas = WARM SAND ~#F7F6F3 territory** via one generative OKLCH ramp; cards
  pure white; de-green ink + tables too, not just backgrounds. (Research-decided,
  2026-06-11; supersedes the "cream vs cool" open question.)
- Dark = four elevation levels +5-8%, no in-flow shadows, lighter brand green.
- Motion tokens re-based (70-400ms ladder); 420ms+ demoted to brand moments.
- Reveal = once per route per session. CountUp = lead KPI only. Card hover = tint
  / border, no lift. CardStack -> announcements, NOT onboarding.
- First-run climax = the client's live delivery schedule (artifact, not checklist).

## Sources (key)

Linear "How we redesigned the Linear UI part II" (LCH 3-variable themes,
elevation-by-lightness); Carbon Design System motion (70-110ms productive,
easing split); NN/g animation duration + frequency guidance; Muzli "Dark Mode
Design Systems" (4 levels, +5-8%, no dark shadows); Atlassian elevation
foundations (border default, shadow = floating only); Radix palette composition
(sand vs sage); Notion canvas #F7F6F3; Attio design breakdowns (hairline borders,
#F4F5F7 canvas); UPDIVISION + Lummi 2026 colour trends (warm neutrals); Tailwind
v4 / shadcn OKLCH; Asana celebration playbook (rare, brief, disable toggle);
Viget skeleton research (mismatch worse than spinners); Chung (wave < pulse
perceived wait); Ramp tabular-nums; Apple Liquid Glass walk-back (WWDC 2026);
Kittl grainy-gradient trend (brand moments only); Loom/Stripe activation
(land on an artifact <60s).
