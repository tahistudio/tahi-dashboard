# Dashboard Delight Layer — first-run journey (login → onboarding → home)

Status: 2026-06-11 — DESIGN, awaiting spec review. First slice of the dashboard
"delight layer" (microanimations + personality). Scope: the **first-run journey**
only — sign-in / sign-up, the onboarding phase, and the home (overview) page.
Full-app propagation is a later slice.

See [[project_client_detail_overhaul]] (design-system reference + primitives),
[[project_icon_pack]] (animated-icon set, used sparingly),
[[feedback_animation_reverse_on_leave]] (hover plays to completion, never
reverses), [[feedback_no_side_borders]], and the ICP doc (Brand > Ideal Client
Profile) for the audience.

## North star

The dashboard is a showcase of what Tahi can do. A client who just paid (often
$50k+) should log in and feel it. The buyer is a stressed senior marketer (Head
of Marketing / CMO / founder) at a **product-led SaaS** company (AI, data,
healthtech, dev tools : ElevenLabs / Physitrack tier). They build premium
software; their own brief is that things must "behave like real software." They
will clock cheap or janky UI instantly, and feel craft when it is there.

So **"lively" means alive, responsive, premium software craft : not playful.**
Three ICP-driven commitments:
1. **Motion serves perceived performance.** Their #1 pain is slow / buggy / "nobody
   owns it". Every interaction gets instant optimistic feedback; transitions mask
   latency; count-ups make data feel earned. Motion makes it feel faster and more
   in control, never slower.
2. **The first-run is a real moment.** Login -> a considered, warm, branded
   onboarding -> a home that rewards arrival. The first 10 seconds is where
   "worth it" is won.
3. **The hero joy moment is client-facing.** Onboarding completion + (later)
   "request delivered" : the things they paid for. The leaf sweep ties to the
   brand's warmth + environmental story (1% to native NZ trees).

Tuned **calm** throughout (the user is stressed): restrained, confident, never
busy. Everything one notch quieter than instinct says.

## Principles

- Organic + confident, on the existing `--ease-out` (cubic-bezier(0.22,1,0.36,1)).
  Controlled `--ease-spring` only for drag / the rare lift. **No bounce** (an
  AI-design tell).
- The **leaf** is the personality signature : loading, empty, completion.
- `prefers-reduced-motion: reduce` fully respected : reveals + count-ups + the
  celebrate flourish all degrade to instant / final value. (globals.css already
  has a reduced-motion block to extend.)
- **Transform / opacity only** (GPU, no layout shift). Entrances fire on mount;
  count-ups on value change : never on every render. Nothing animates that the
  eye must read immediately (no animating a number the user is mid-reading
  unless it just changed).
- Mobile-first : smooth at 375px, no jank. Dark mode parity.

## Grounding : how elite dashboards earn "premium" (research)

Distilled from design write-ups by Linear, First Round Review, Pencil & Paper and
others. (The research run's adversarial verification was cut short by a session
token limit, so treat these as credible design-source principles rather than
independently re-verified facts : they align with established UX and our own
system.)

- **Speed is the headline feature, not a nice-to-have.** Linear made "never slow"
  a founding design goal. This is the single strongest lever for THIS buyer (whose
  pain is "slow / buggy / nobody owns it"). Every motion choice must make the app
  feel faster and more in control, never slower; optimistic UI by default. This is
  why our motion is perceived-performance-first.
- **Hierarchy by de-emphasis.** Not every element carries equal weight : dim the
  secondary (nav, chrome) so the content area leads. (Our sidebar is already a
  distinct dark surface; keep the content the hero.)
- **Structure felt, not drawn.** Soften borders, kill purposeless dividers rather
  than boxing everything. Calm separation over visible lines. Border OR a hover
  shadow, never both on one object (we already do this).
- **Actionability is the premium test.** A widget that doesn't change what the user
  does next is just a report. Every overview card earns its place with a clear next
  step / deep-link; clutter = widgets with no pathway.
- **Scope discipline.** Answer ~6-8 outcome questions with ~6-10 well-chosen
  components; more forces the user to do synthesis we should have done.
- **Read order = importance.** Most important / global metric top-left (F/Z scan),
  overview in the middle, detail at the bottom or behind hover (progressive
  disclosure in charts).
- **Colour = meaning, not decoration.** Reserve brand / semantic colour for signal;
  keep the canvas calm.
- **Premium = craft details made explicit standards.** Optical alignment, tactile
  buttons (press feedback), considered word-wrapping, motion feel.
- **Never skip loading + empty states** : their absence is what reads cheap.
  Skeletons that match the final layout + characterful empties.
- **AI-slop tells to avoid:** purple / indigo gradients, glassy panels, endless
  identical card grids, big empty hero sections, Inter / Roboto, ~0.1-opacity
  shadows everywhere. (We already avoid these.)

## Visual references (Liam-picked, 2026-06-11)

Two Dribbble shots Liam loves : both clean / airy / rounded / subtle-border /
calm-premium, aligned with our system. We borrow ideas, not pixels.

**Fireart "Donezo" task dashboard** (green : near-identical to our palette):
- The LEAD KPI card is filled SOLID brand-green with white text while the others
  stay light : instant hierarchy / read-order. Adopt for the overview.
- Big confident stat numbers + a tiny "increased from last month" caption.
- Green data-viz: bar charts with rounded tops, a donut / gauge progress ring.
- Dark-green accent cards (time-tracker, a sidebar promo) : our `FeatureCard`
  "forest" variant already supports this.

**Nixtio "Crextio" HR dashboard** (warm / cream, yellow accent : we keep greens):
- A large, warm personal welcome ("Welcome in, {name}") : our first-run + greeting.
- The premium ONBOARDING pattern : a dark card titled "Onboarding Task 2/8" with a
  checklist + animated check circles + a progress count. Validates + sharpens our
  onboarding moment (brand-dark green card, check-draw, X/N progress).
- Circular progress rings (animated fill) for progress / capacity / time.
- The interaction Liam called out: **stacked cards with depth you swipe away to
  reveal the next** : a card-deck. We add a `CardStack` primitive.

## The reusable kit (built this slice, reused everywhere after)

Existing foundation in `globals.css`: `--motion-quick 220ms / --motion-base 420ms
/ --motion-medium 520ms / --motion-slow 720ms / --motion-grand 1100ms`,
`--ease-out`, `--ease-spring`, a `prefers-reduced-motion` block, and keyframes
(`fadeIn`, `slide-up`, `slideUp`). We EXTEND this, not replace it.

1. **Motion tokens (extend):** add `--stagger: 45ms` (per-child reveal delay) and
   a `--ease-leaf` alias if useful. Add keyframes: `tahi-reveal-up` (fade + 8px
   rise), `tahi-shimmer` (skeleton sweep), `tahi-leaf-float` (empty-state sway),
   `tahi-leaf-sweep` + `tahi-sparkle` (the celebrate flourish), `tahi-check-draw`
   (check-circle). All gated by the reduced-motion block.
2. **`<Reveal>` + `.tahi-stagger`** (`components/tahi/reveal.tsx`): a wrapper that
   fades children up on mount; `.tahi-stagger > *` applies incremental
   `animation-delay` via `--stagger * index` (CSS, capped ~8 children so late
   rows do not lag). Used on page sections, KPI strips, list rows, cards.
3. **`<CountUp value>`** (`components/tahi/count-up.tsx`): rAF tween from previous
   (or 0 on mount) to target, `--ease-out`, respects reduced-motion (jumps to
   final), preserves a `format` fn (currency / `data-private` wrapper stays on
   the parent). ~50ms-700ms scaled to magnitude.
4. **Shimmer skeletons:** a `.tahi-shimmer` utility replacing flat `animate-pulse`
   on the loading skeletons.
5. **Hover / press** standardised in the `Card` + `TahiButton` primitives (lift
   -2px + `shadow-leaf` on hover; `active:` scale 0.98 press). Propagates app-wide
   for free; this slice just confirms it on the surfaces in scope.
6. **`celebrate(type)`** (`components/tahi/celebrate.tsx`): a one-shot, portal'd
   leaf-sweep + sparkle overlay (~800ms, never confetti), fired imperatively on a
   completion. Respects reduced-motion (no-op or a single static check).
7. **`<CardStack>`** (`components/tahi/card-stack.tsx`): a deck of cards layered
   with depth (each card behind is offset + scaled down + dimmed), where the top
   card can be **swiped / dragged away** (controlled spring, not bounce) to reveal
   the next, which rises forward. A dot / "x of n" affordance + keyboard support
   (arrow keys / Enter) for a11y. Under reduced-motion or no fine pointer it
   degrades to a plain stacked list (no swipe). Used for onboarding tasks,
   reminders, and announcements. The more ambitious piece : if it risks the slice
   it drops to slice B, but it is the interaction Liam specifically asked for.
8. **`<ProgressRing>`** (`components/tahi/progress-ring.tsx`): an SVG circular
   progress with an animated `stroke-dashoffset` fill + a `CountUp` % in the
   centre. For onboarding progress, track capacity, and time. Brand-green stroke
   on a faint track. Reduced-motion -> static at final value.
9. (Deferred to slice B) sliding tab indicator + the broader icon micro-animation
   wiring : not needed for the first-run surfaces.

## Per-surface design

### 1. Sign-in / Sign-up (`app/(auth)/sign-in|sign-up/...`)

Today: Clerk's `<SignIn/>` / `<SignUp/>` rendered fairly plainly. This is the
first impression : make it feel like premium software without rebuilding Clerk.

- **Branded split layout** (desktop): left = a calm brand panel : the leaf mark +
  `TahiStudioWordmark`, a one-line value/tagline, on a subtle organic atmosphere
  (a soft brand-green gradient wash + a faint, slow-drifting leaf motif or grain :
  CSS only, very restrained, `--motion-grand` loop, paused under reduced-motion).
  Right = the Clerk form. On mobile the brand panel collapses to a slim header.
- **Clerk styled to the system** via Clerk's `appearance` prop : Manrope, brand
  colours, `--radius-button` / leaf radius on the primary CTA, our input + focus
  styles, border-not-shadow. No purple, no default Clerk look.
- **Entrance:** the panel + form `Reveal` (stagger) on load : a confident, quick
  fade-up, not a slow tween.
- Cream `#F3F4F2` page bg, white card. Accessible focus states (WCAG AA). Reduced
  motion -> static.

### 2. Onboarding phase (`components/tahi/onboarding-checklist.tsx` + overview)

Today: `OnboardingChecklist` + `OnboardingChecklistWrapper` on the overview, fed
by `/api/portal/onboarding` (`onboardingState`, `onboardingLoomUrl`),
dismissible via localStorage. Elevate it into the "$50k onboarding" moment.

- **Welcome moment (client portal, first run):** when onboarding is incomplete and
  not yet dismissed, lead the overview with a warm, branded welcome card : a
  personal greeting ("Welcome, {firstName}"), one calm sentence on what to expect,
  the **Loom embed** (`onboardingLoomUrl`) framed premium (leaf radius, not a bare
  iframe), and the checklist beneath. Reveal-staggers in.
- **Checklist with craft (Crextio dark-card treatment):** present the checklist on
  a brand-dark-green card titled with an **"X of N" progress** + a `ProgressRing`
  (animated fill, count-up %), each item with the `tahi-check-draw` check-circle on
  complete + a smooth row settle. Optionally render the steps as a `<CardStack>`
  the client can **swipe through** (swipe-away a done step to reveal the next) :
  the interaction Liam asked for, with a plain-list fallback under reduced-motion.
- **Completion = the hero joy moment:** when the last item is checked (or onboarding
  flips complete), fire `celebrate('onboarding')` : the leaf sweep + a short warm
  line ("You're all set."). This is the reinforce-the-value beat. Then the card
  gracefully retires (collapses, not a hard unmount).
- Calm + reassuring, never nagging. Dismiss stays. Reduced motion -> instant
  checks, no sweep.

### 3. Home / Overview (`app/(dashboard)/overview/overview-content.tsx`)

The landing for both admin (Liam/Staci) and client (portal). Apply the kit so it
feels alive + fast on arrival.

- **Greeting with warmth:** time-of-day aware ("Good morning, {name}"), already
  partially present : keep it human, Reveal in first.
- **KPI strip + stat tiles (Donezo treatment):** the single LEAD metric tile is
  filled solid brand-green with white text (a `FeatureCard` "forest"/"lime"
  variant); the rest stay light : instant hierarchy. Big confident numbers with a
  small "vs last month" caption. `CountUp` every number on load (the "data earned"
  feel); `data-private` masking preserved (CountUp sits inside the existing
  `data-private` element). Charts: green bars with rounded tops / a donut gauge
  via the existing Recharts theme : no restyle of data, just the green + rounded
  treatment.
- **Section + widget entrance:** the page's cards / widgets `Reveal`-stagger in on
  load (recent requests, pipeline summary, upcoming calls, off-track, track
  capacity), so the page assembles itself calmly rather than popping.
- **Shimmer** on the overview's loading skeletons; **hover/press** confirmed on its
  cards + CTAs.
- **Perceived performance first (the headline lever):** keep fetches optimistic; the
  staggered reveal covers the brief load so it never feels empty-then-pop. Nothing
  in the motion may add latency : the page must feel faster, not prettier-but-slower.
- **Read order = importance:** the most important / global signal sits top-left
  (the eye lands there first); overview in the middle; detail behind hover. Don't
  reorder existing widgets in this slice, but the CountUp + reveal emphasis should
  fall on the lead metric first.
- **Actionability:** every widget already earns its place by deep-linking to its
  next step (recent requests -> request, off-track -> the engagement, etc.). This
  slice doesn't add widgets : keep scope tight (~6-10 components) and make the
  existing pathways feel instant on hover/click. No new clutter.

## Architecture / files

- `app/globals.css` : extend motion tokens + add the keyframes + shimmer/hover
  utilities + reduced-motion coverage for the new animations.
- `components/tahi/reveal.tsx` (Reveal + `.tahi-stagger` helper), `count-up.tsx`,
  `celebrate.tsx` (+ a tiny `useCelebrate` or imperative `celebrate()`),
  `card-stack.tsx` (swipe deck), `progress-ring.tsx`.
- `components/tahi/card.tsx` + `tahi-button.tsx` : confirm/standardise hover+press.
- `app/(auth)/sign-in/.../page.tsx` + `sign-up/.../page.tsx` (+ a shared auth
  layout) : branded split + Clerk `appearance`.
- `components/tahi/onboarding-checklist.tsx` (+ the overview wrapper) : welcome
  moment, check-draw, progress, completion celebrate.
- `app/(dashboard)/overview/overview-content.tsx` : Reveal/stagger + CountUp +
  shimmer wiring.

Each new primitive is small, single-purpose, independently testable (Reveal =
mount entrance; CountUp = number tween; celebrate = one-shot overlay).

## Scope boundaries (YAGNI)

- This slice = the first-run journey only (auth + onboarding + overview) + the
  reusable kit. NOT deals/requests/tasks/finance propagation, NOT the sliding tab
  indicator, NOT admin-side deal-won celebration, NOT route-transition fades :
  those are slice B/C, made cheap because the kit lands here.
- Do not rebuild Clerk; style it via `appearance`.
- Do not add a motion library (Framer Motion etc.) : CSS-first + tiny rAF JS.

## Verification

- `npm run type-check` + `npm run lint` + `npm run build` green.
- Unit test the CountUp tween (final value, reduced-motion jump) and the
  reveal/stagger delay math if non-trivial.
- Live Chrome QA on the deployed URL: the login -> onboarding -> overview flow;
  **375px mobile** (no jank, no horizontal scroll, 44px targets); **dark mode**;
  and **`prefers-reduced-motion`** on (everything degrades to instant / final).
  Confirm count-ups preserve `data-private` masking. Screenshot the first-run.

## Decisions locked

- Motion level = **lively & characterful**, re-tuned **calm + premium** through the
  ICP lens (alive/responsive software craft, not playful). (Liam, 2026-06-11.)
- **Joy moments on the big wins**; the hero is client-facing onboarding completion
  (later: request delivered). Leaf sweep, never confetti. (Liam, 2026-06-11.)
- Approach = **CSS-first + tiny JS**, no motion library. (2026-06-11.)
- First build scope = **sign-in/up + onboarding + home** only. (Liam, 2026-06-11.)
