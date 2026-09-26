# Port plan: overview (studio home, owner and teammate)

Written 2026-09-26. Status of the design: critic SHIP after one revision, not reviewed by Liam, so everything below ships as "ported, unchecked". Nothing here is committed.

- Route: `/overview` (owner and teammate halves only; the client half belongs to the portal-home module).
- Audience: studio (owner = super_admin or admin in the Tahi org, teammate = scoped team_member, plus an admin previewing a teammate).
- Design files read (Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): `overview.jsx`, `overview-kit.jsx`, `overview.css`, `overview-states.css`, `overview-data.jsx`, `previews/overview-preview.html`. Design fetched: yes.
- Other sources: the overview section of `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, `docs/superpowers/design/requirements/studio-home.md`, `DESIGN-BRIEF-2026-09-13.md` (by reference), the live code in `app/(dashboard)/overview/`, `components/tahi/overview/`, and the card routes under `app/api/admin/`.
- Page keys: owner, owner-loading, owner-empty, owner-error, owner-new, owner-brief, teammate, teammate-loading, teammate-empty, teammate-error, teammate-preview.
- Backend: none. Migration: none. Every card keeps the route it reads today.

## 1. What the live code already matches (no work)

The live `/overview` is already a port of an earlier cut of this same design, and the 2026-09-19 studio home accuracy pass (HA.1 to HA.10, Decision #065) made most populated cards more accurate than the prototype. These need no redesign:

- Page structure and order: the masthead (Wire, forest MRR hero with spark and New menu, Vitals, Needs you stacked over the Daily brief), then zones Books, Ahead, Work, Clients, Growth, with the same cards on the same 12 column spans. Teammate: masthead, then My day, Waiting, My week.
- The three honesty departures the design formalised: Social has no reach stat, Cash runway draws a horizon instead of an invented monthly series, Pipeline charts the real per stage weighted pipeline instead of a forecast squiggle.
- No Messages surface or CTA anywhere; client replies land on the request thread (CT.5).
- Populated figures on every owner card (live is the source of truth where it differs from the prototype's sample data): four bucket aged bar, drafts on their own line under Owed, MRR delta basis label, take-home from the one cash position ("free to spend now"), runway "if revenue stopped" with "a month net", pipeline on the forecast's basis with stage colours and a count basis, capacity by assigned hours and active members, proposals live without drafts, retainer health by status, the Suggestions from calls card (CN.1).
- Teammate populated content: no currency anywhere, the live ticking timer, overdue first task ordering, request threads only in replies, the honest "Studio docs" label.
- Container query responsiveness at 66rem and 46rem, the LW.40 phone fixes (`.bs-act` at 2.75rem on coarse pointers and in the phone container, brief date and time stacking, the Wire hanging indent on phone), reduced motion opt outs.
- owner-brief (all accordion sections open) is a preview lever only; the accordion already works.

## 2. What differs, page key by page key

**owner (populated)**
- Zone rails vanish below 46rem; the design turns them into a horizontal eyebrow so the Books to Growth rhythm survives on a phone.
- Leaf radius: the design puts the leaf on the New button, card icon chips, row avatars, Needs you icons, CTAs and the hero. Live uses plain radii and hardcodes the hero's `0 26px 0 26px`. The app already has the exact tokens (`--radius-leaf-sm` is 0 0.625rem, `--radius-leaf-lg` is 0 1.5rem).
- Chip, count, trend and icon inks: live uses one hex per tone in both themes; the design uses a darker ink on light and a lighter ink on dark. The app's `--badge-*` and `--color-danger-ink` tokens already do this.
- Focus: live has no visible focus ring on most `.ov` buttons (rows only get a background). The design adds one ring rule for every button and role=button in `.ov`.
- 44px targets: the design lifts card links, rows, overflow buttons, Needs you verbs, New menu items, accordion headers and every CTA to 2.75rem on a coarse pointer. Live only lifts `.bs-act` and the client Pay button.
- New menu: design items carry a sub line, the trigger has aria-haspopup and aria-expanded, Escape closes, the trigger is disabled (not only click guarded) while read only, and each item lands on the create form. Live goes to plain list pages.
- Card header links: the design adds "Open books" on Take-home and "All invoices" on Receivables.
- Copy: "Cash-flow projection" (live "Cash-flow ribbon"), "renew within 30 days" (live "renew < 30d"), "Reviews and case studies" (live "Reviews & case studies").
- Captions (`.ov-cap`) under Cash runway, Cash-flow, Pipeline, Client replies, Content engine and Social cadence that say what the chart is and is not.
- Cash runway horizon: the design draws twelve labelled month cells with a part filled last cell; live draws a thin line with tick marks from inline styles.
- Pipeline stage rows move onto a grid (`.ov-stagerow`) instead of inline flex styles.
- Receivables gains an "Oldest overdue" sub row (the route already returns `arAging.oldest`).
- Client replies uses the request icon, not the speech bubble (acceptance item 8, no Messages iconography).
- Today's calls Join uses the `.ov-cta.sm` class, not an inline 30px height.
- Daily brief: a leaf style spark icon in the header, a Refresh button with an icon that spins while busy, and a quiet "Nothing here right now." line for an empty section (live fakes a bullet row).

**owner-loading**
- Live: each card shims (fine), but the hero and vitals print a middle dot, Needs you says "All quiet in the studio." while its three sources are still loading, and the Daily brief says "All clear. Nothing is waiting on you right now." before the brief has arrived. Both are false claims. The Wire renders nothing.
- Design: skeletons everywhere, including the hero, the vitals, Needs you, the brief and the Wire label.

**owner-empty**
- Live: a single muted sentence per card with no action (Social is the one exception).
- Design: a leaf icon, the exact live empty sentence as the title, one explanatory line and a CTA where there is somewhere useful to go. MRR shows "Not set".

**owner-error**
- Live: only Client replies can say it failed. Every other card shims forever on a failed fetch, and Take-home treats a failed fetch as "Connect your finances" (a false instruction). The hero and vitals print middle dots.
- Design: one shared error block per card (alert icon, what did not answer, Try again), a masked hero figure with a named source and Try again, masked vitals tiles, a Needs you error, a brief error and a quiet Wire error line. This is the critic's FIX from the first pass, resolved in the revision (`overview-states.css`).

**owner-new**
- Covered by the New menu changes above.

**teammate (populated)**
- Hero: design uses the plain (neutral card) hero; live uses the forest money hero. The forest hero is the owner's money figure; the plain variant already exists in the kit.
- Reply icon and the Needs you reply row use the request icon; the reply verb reads "Open thread".
- Client replies rows use `.ov-cta.ghost.sm` "Open thread", disabled while read only (live relies on a CSS pointer-events rule a keyboard walks past).
- Today's calls: Join is `.ov-cta.sm` and disabled while read only; future calls say "Later".
- Time tracking: buttons say where they go ("Pause on Time", "Switch task") with a caption "These buttons open Time. The timer is not controlled from this page." (today's routing kept, question 3 stays open).
- Studio docs caption explains the studio wide label.

**teammate-loading / teammate-error**
- Same gaps and same fixes as the owner: live uses ad hoc inline skeleton spans and has no error state anywhere on this home.

**teammate-empty**
- Design adds the "why is this empty" block (T1.19's own wording asks for it) when the whole queue is empty.

**teammate-preview**
- Design adds the RoNote banner and relabels the hero "My open work, as Maia". Both hang on open question 5 and are skipped (see section 5).

## 3. Slices

Order: slice A first (kit and stylesheet), then B and C in parallel. Owned files are disjoint.

### Slice A: kit and stylesheet (shared states, masthead states, targets, inks)

Owned files: `components/tahi/overview/ov-kit.tsx`, `components/tahi/overview/card-state.ts` (new), `components/tahi/overview/__tests__/card-state.test.ts` (new), `app/(dashboard)/overview/overview.css`, `components/tahi/overview/overview-home.tsx`. About 1.25 days. No backend, no migration.

Build brief:

Read first: design `overview-kit.jsx` (Skel, CardState, CardBody, Horizon, StageBars, Hero, Vitals, NeedsYou, TheWire, NewMenu), `overview.css` lines 66 to 170 and 280 to 585, and `overview-states.css`. Grep `components/tahi/skeletons.tsx` and `components/tahi/empty-state.tsx` before writing anything.

Hard rule for the kit: `components/tahi/overview/homes/client-home.tsx` and `components/tahi/portal/home/waiting-on-you.tsx` import this kit and are owned by another module. Every new prop is optional and its default must reproduce today's output exactly. In particular `TheWire` with no `state` and no `emptyText` must still return null for an empty list, or clients would start seeing studio copy.

1. `card-state.ts` (pure, no React): `resolveCardState({ data, error, isEmpty })` returns `'loading' | 'error' | 'empty' | 'ready'`. Error only when there is an error and no data (SWR keeps data from this session on a failed revalidate; that data is dated and stays on screen). Loading when there is no data and no error. Add `resolveMultiState(sources, isEmpty)` for cards that read two or three routes: error if any source has an error and no data, else loading if any source has no data, else empty or ready. Unit tests cover all four outcomes, stale data plus error, and the multi source rules.
2. Kit primitives (in `ov-kit.tsx`, typed, no `any`):
   - Icons: add `alert`, `refresh`, `plug`, `pause` to the path map (paths are in the design kit). Keep `msg` for other callers; the studio homes stop using it.
   - `Skel({ rows, chart })`: compose from `SkeletonBar` in `components/tahi/skeletons.tsx` inside an `animate-pulse` wrapper (the app's loading pattern), not the prototype's shimmer keyframes. Pass `style={{ background: 'var(--bg-tertiary)' }}` so the ink card's local re-theme reaches it. Widths cycle 88, 64, 76, 58, 82 percent; `chart` adds a 3.25rem block. aria-hidden.
   - `CardState({ kind, title, body, cta, ctaIcon, onCta })`: the design's compact, left aligned block (`.ov-cstate`): OfficialLeaf in a leaf radius chip for empty, alert icon for error, bold title, small body, optional `.ov-cstate-cta` button. Error kind gets role="status". Not the shared `EmptyState`, for a stated reason: `EmptyState` paints the global `--color-bg-secondary` and centres its content, and the Take-home card's ink tone re-themes only the local short tokens, so a shared `EmptyState` inside it paints a light slab on dark green. Requirement doc section 6 also says this page is judged against its own kit.
   - `CardBody({ state, rows, chart, empty, error, children })`: loading renders `Skel`, empty renders `CardState` empty, error renders `CardState` error with "Try again" and the refresh icon only when `error.onRetry` is given, ready renders children.
   - `Horizon({ labels, months })`: twelve month cells, filled to the whole months covered, the last cell part filled to the real fraction, role="img" and aria-label "{n} months covered at the current burn".
   - `Hero`: optional `state?: 'loading' | 'error'`, `error?: { title, body }`, `onRetry?`. Loading renders `.ov-heroskel` bars; error renders the masked figure (`.ov-hero-mask`, aria-label "{label}, figure unavailable because the source did not answer") and the `.ov-hero-err` cluster with a Try again button. The action slot (New menu) stays in all three states.
   - `Vitals`: optional `state`. Loading renders skeleton bits in four cells; error renders `.ov-vitals.err` with each tile's label kept, a masked figure (role="img") and "did not answer" with the alert icon.
   - `NeedsYou`: optional `state`, `onRetry`, `partialFailure?: boolean`. Loading renders `Skel` in `.ov-needs-pad`; error renders `CardState` error "Could not work out what needs you." / "Invoices, calls and engagements each answer separately, and at least one of them failed." When `partialFailure` is set and items exist, the foot reads "One source did not answer, so this list may be short." instead of "Nothing else needs you today." (that line would be a claim the page cannot back).
   - `TheWire`: optional `state` and `emptyText`. Loading shows the label plus a skeleton bit; error shows `.ov-wire.quiet` "The feed did not answer. The cards below load on their own."; empty with `emptyText` shows that text quietly. Move the reduced motion branch's inline styles onto `.ov-wire.tall` and `.ov-wire-item.static`.
   - `NewMenu`: items gain optional `sub` (rendered in `.ov-nm-t`), trigger gets `aria-haspopup="menu"`, `aria-expanded`, `disabled={ro}`; the list gets role="menu", items role="menuitem"; Escape closes. Leave the unused `Masthead` alone.
3. `overview-home.tsx`: add three entries to `ROUTE_MAP` and nothing else: `'requests-new': '/requests?new=1'` (request-list opens its dialog on it), `'clients-new': '/clients?new=1'` (client-list opens its panel on it), `'settings-integrations': '/settings?section=integrations'` (settings-shell deep links sections). Leave the T1.19 preview comment and every audience branch as they are.
4. `overview.css`, all inside the existing `@layer components` block, new rules in rem:
   - Fold in `overview-states.css` (the review's wiring item): hero mask, hero error cluster, retry button, plain hero error, vitals error. Translate every `.ash[data-theme="dark"]` selector to `.dark`, and replace hex with tokens: error ink `var(--color-danger-ink)`, error wash `var(--color-danger-tint)`, error borders `color-mix(in srgb, var(--color-danger-ink) 30%, var(--border))`. On the forest hero (dark in both themes) keep the translucent white washes; the error icon ink becomes `color-mix(in srgb, var(--color-danger-dot) 30%, white)`.
   - Add the design's new blocks: `.ov-skel` (layout only, the pulse comes from `animate-pulse`), `.ov-skelbit`, `.ov-heroskel`, `.ov-cstate*`, `.ov-horizon` and `.ovh-c`, `.ov-stages` and `.ov-stagerow` (plus a three column variant for the count basis), `.ov-why*`, `.ov-cap`, `.ov-arline`, `.st-unit`, `.lg-big`, `.sr-name`, `.ov-meter.grow`, `.ov-statrow.tight`, `.ov-subrows.flush`, `.ov-soon`, `.ov-wire.quiet`, `.ov-wire.tall`, `.ov-wire-item.static`, `.ov-needs-pad`, `.ov-nm-t`, `.ov-timerline`, `.ov-timer`, `.ov-timeron`, `.ov-btnrow`, `.ov-brief-refresh` (with the busy spin), `.bs-none`, `.ov-cta.sm`, `.ov-cta.grow`, `.ov-cta.wide`, and `:disabled` states for `.ov-newbtn`, `.nr-verb`, `.ov-cta`. Do not port `.ov-ronote*` (skipped).
   - Leaf radius from the global tokens, never redeclared on `.ov` the way the prototype did: `var(--radius-leaf-sm)` on `.ov-newbtn`, `.ov-cta`, `.ch-ic`, `.ov-brief-ic`, `.rw-av`, `.nr-ic`, `.nq-ic`, `.ov-cstate-ic`, `.ov-why-ic`, `.ov-hero-err-ic`; `var(--radius-leaf-lg)` on `.ov-hero`.
   - Inks: `.ov-chip.info`, `.warn`, `.rose` take `--badge-info-bg/text`, `--badge-warning-bg/text`, `--badge-danger-bg/text`; `.ov-acc-count.warn` and `.risk`, `.nr-ic.money` and `.work` the same families; `.vt-trend.bad` and `.ov-arline .bad` take `--color-danger-ink`. Chart and status series hexes that live in the documented const objects in the homes (CLAUDE rule 2) may stay; add no new hex.
   - Hover and focus: `.ov button:focus-visible, .ov [role="button"]:focus-visible` ring (`0 0 0 0.125rem var(--bg), 0 0 0 0.25rem var(--brand)`), the lighter ring on the hero New button, an inset ring on `.ov-acc-h`, `.ov-acc-h:hover` background, the row title turning brand on hover, `.ov-cta:hover` and `.ov-cta.ghost:hover`.
   - Targets: the design's `@media (pointer:coarse)` block (2.75rem minimum on `.ov-acc-h`, `.ov-newmenu button`, `.ov-row.click`, `.ov-needs-more`, `.ov-card-more`, `.ov-newbtn`, `.ov-cta`, `.ov-cta.sm`, `.bs-act`, `.ov-brief-refresh`, `.ov-cstate-cta`, `.ov-hero-retry`, `.nr-verb`, and `.ch-link` with a little side padding), and repeat the same list inside `@container (max-width: 46rem)` because the 375 check measures rendered height whatever the pointer reports (the LW.40 pattern). `.ov-cta` moves from `height:38px` to `min-height:2.375rem` with inline-flex centring; pin `.ov-cta.ov-pay{ min-height:1.75rem }` on a fine pointer and `.ws-go{ min-height:2rem }` so the client home's dense rows do not grow on desktop.
   - Layout hardening from the design: `.ov-hero-sub` and `.ov-healthsum` wrap, `.ov-subrow b` no wrap, `.ov-row .rw-t small` ellipsis, drop `max-height:80px` on `.ov-needrow` (it clips a two line sub at 375), `.ov-vital .vt-num.muted` at 1.0625rem for word values, `.ov-hero-act` at 1rem insets in the phone container.
   - Zone eyebrow on phone, scoped to the studio homes only: inside the 46rem container query replace the studio rail's `display:none` with the design's horizontal eyebrow (`.ov.ov-studio .ov-zone-rail` as a row, label horizontal, a 90 degree fading line). Slices B and C add `ov-studio` to their roots. The client home keeps today's hidden rail.
   - The Wire: on desktop `.ov-wire-item .ov-wire-txt` becomes one line with an ellipsis (FU.6, the Wire half); keep the phone block's hanging indent wrap exactly as LW.40 left it. In `.dark` the Wire label and timestamp take `--text-muted` (FU.5, the Wire half; `--text-faint` is 3.2:1 on the dark card). `.ov-cap` and `.ov-soon` get the same dark treatment.
   - Reduced motion: add `.ov-heroskel i`, `.ov-brief-refresh.busy svg` and `.ov-acc-body` transitions to the existing block.
   - px to rem (the critic's non blocking ask the designer left out): convert the blocks this module owns (brief, chart hover, links, masthead, New menu, hero, vitals, aged bar, Needs you, Wire, zones, card, tones, stat, rows, chips, charts, slots, health strip, card-more, subrows, meter, read only, CTA, section heading, container queries) at 16px = 1rem, value preserving. Keep 1px, 1.5px and 2px hairlines and shadow offsets. Leave the client only blocks (`.ov-trackboard`, `.ov-tb-*`, `.ov-lane*`, `.ln-*`, `.ov-phase*`, `.ov-welcome*`, `.ov-wstep`, `.ws-*`) to the portal-home port.
5. Verify: type-check, lint, `npm run build`, the new unit tests. Before and after screenshots of `/overview` as owner, as a client (View as client) and as a teammate preview, at 1440 and 375, light and dark. The client home must look the same apart from focus rings, leaf avatars, chip inks and 44px touch targets. No horizontal scroll at 375; every control at least 44px tall on a phone.

Do not build: the RoNote banner, any Messages surface, new API calls, a shimmer keyframe, a redeclared `--radius-leaf`, changes to `client-home.tsx`, `ctx.ts` or any route file.

### Slice B: owner home

Owned file: `components/tahi/overview/homes/owner-home.tsx` (its test `homes/__tests__/owner-home-mrr-delta-label.test.ts` must stay green; keep the `mrrDeltaLabel` export). About 1.5 days. No backend, no migration. Depends on slice A.

Build brief:

Follow design `overview.jsx` OwnerHome and the page keys owner, owner-loading, owner-empty, owner-error, owner-new. Live figures and logic win wherever the prototype's sample data differs (section 1). Every card keeps the route it reads today.

1. Root: `<div className="ov ov-studio" data-ro=...>`.
2. Masthead:
   - Capture `error` and `mutate` from `useResource('/api/admin/overview')`. Hero state: error with no data gives the error state, title "Could not load MRR.", body "The overview figures did not answer. No figure is shown rather than one nobody can date.", retry calls `mutate()`. No data gives loading. When `mrr` is null after load, value "Not set" and sub "MRR not configured".
   - Vitals take the same state. After load, replace every middle dot placeholder with the muted word "Not available" and keep today's subs.
   - Needs you: the three sources are the overview (oldest overdue invoice), `/api/admin/engagements/off-track` and `/api/admin/discovery-calls/upcoming`. Use `resolveMultiState` for loading. If any source failed with no data, pass `partialFailure`; if that leaves no items, pass state error with a retry that mutates all three.
   - Daily brief (stays in this file): add the `.ov-brief-ic` spark icon; keep the live date, clock and "Updated" meta (LW.40 and the 2026-09-19 feedback fixes); the Refresh button becomes `.ov-brief-refresh` with the refresh icon, spinning while busy and disabled while loading. Check `res.ok` on the POST; on failure show "Refresh failed" in the Updated slot for a few seconds, no toast. Loading shows `Skel` rows instead of the lede and the accordion (never "All clear" before the data exists). Error with no data shows `CardState` error "Could not load this morning's brief." / "It is written once per morning and cached. Refresh asks for a new one." with Try again calling `mutate()`. An empty section shows `.bs-none` "Nothing here right now.". Rows keep the server built `r.text`.
   - Wire: pass `state` and `emptyText="Nothing has happened across the studio this week."` (the route looks back seven days, `wireSince` in `lib/overview-wire.ts`, so "today" would be wrong).
   - New menu items: New request, sub "Opens the request form", `go('requests-new')`; Add client, sub "Opens the new client form", `go('clients-new')`; Log time, sub "Opens Time", `go('time')`.
3. Every card goes through `CardBody` with `resolveCardState` or `resolveMultiState`. Empty titles are the exact live sentences (the design's `EMPTY` list is copied from them). Retry mutates that card's own resource or resources. Card by card:
   - Take-home: add link "Open books" to `financialreports`. A failed fetch is now an error ("Could not load take-home." / "The financial summary did not answer. No figure is better than a stale one."), not "Connect your finances". Empty: body "Take-home splits what came in against tax, reserves and deposits held.", CTA "Connect finances" with the plug icon to `settings-integrations`. Keep "free to spend now" and every live figure; move inline font styles to `.lg-big`.
   - Cash runway: state from the overview resource. Replace `HorizonStrip` with the kit `Horizon`: labels are the next twelve short month names from this month (en-NZ), months is `cash.runwayMonths` (omit the strip when it is null). Caption: "Months covered if revenue stopped, at today's burn. There is no monthly cash series behind this, only the balance and the burn." Keep the three live stats and use `.st-unit`. Empty: body "Runway needs a bank balance. Airwallex is the cash truth, Xero carries the ledger.", CTA "Connect Xero" to `settings-integrations`. Error: "Could not load runway." / "The balance sync did not answer, so the horizon would be a guess."
   - Cash-flow: title and `section` "Cash-flow projection". Keep the live basis line and ribbon. Caption "Net per month for the next twelve months." (the prototype's "Twelve months back" contradicts the route, which projects forward). Error: "Could not load the projection." / "The forecast route did not answer."
   - Receivables: add link "All invoices" to `invoices`. Keep the four bucket bar and its legend; move the current and overdue line onto `.ov-arline`; add an "Oldest overdue" sub row ("{client}, {n} days") when `arAging.oldest.daysPastDue > 0`; keep the no due date line. Empty body "Every invoice is either paid or not raised yet." Error: "Could not load receivables." / "The invoice totals did not answer."
   - Pipeline ahead: keep all live logic. Restyle `PipelineStages` onto `.ov-stages` and `.ov-stagerow` (name, bar in the stage's own colour, deal count, weighted value; the three column variant on the count basis). Caption "The bars are the headline split by stage, from one payload, so they cannot disagree." Multi source state over deals and forecast. Empty: body "Deals show up here the moment one leaves the lead list.", CTA "Open the pipeline" to `deals`. Error: "Could not load the pipeline." / "The forecast did not answer, so the headline and the bars would disagree."
   - Studio capacity: keep the live hours model (the prototype's slot model is not what the route returns). Classes instead of inline flex (`.sr-name`, `.lg-big`). Empty: body "Add the people who do the work and their hours fill this in.", CTA "Open Team" to `team`. Error: "Could not load capacity." / "The capacity route did not answer."
   - Hot leads, Proposals live, In the studio, Worklog, Retainer health, Contracts, Reviews, Docs hub: states only, plus these copy and class changes. Empty CTAs: "Open Leads", "Open Proposals", "Open Requests", "Open Time", "Open Clients", "Open Contracts", "Open Reviews", "Open Docs" to their routes. Bodies from the design: leads "New leads are scored overnight and the hottest surface here.", proposals "Anything shared with a client shows its status here, newest first.", studio "Every request a client raises lands here while it is moving.", worklog "Hours land here as the studio tracks them.", retainer "Health is scored off activity, replies and money, once a retainer is running.", contracts "NDAs, SOWs and renewals sit here with their dates.", reviews "Only live outreach shows here. A client who said no is never asked again.", docs "The three most recently edited pages sit here." Contracts stat label "renew within 30 days". Reviews title and `section` "Reviews and case studies". Worklog uses `.st-unit`. Keep the retainer "By health status, not churn score" note. The Docs card only links to `/docs`; the Docs Hub itself is locked and untouched.
   - Today's calls: states; Join becomes `className="ov-cta sm"` (no inline height); empty body "Discovery calls, check-ins and standups all show up here on the day.", CTA "Open Calls".
   - Client replies waiting: icon `request`; keep the row click to `t.to`; states (replace the ad hoc error line with `CardState` error "Could not load client replies. Try again shortly." / "Threads are read from the last 60 days and capped at twelve." plus retry); empty body "A request shows up here when a client had the last word on the thread."; caption "Each row opens the request thread the client replied on."
   - Suggestions from calls: keep as is (not in the design, shipped later); loading uses `Skel`; hidden at zero and when the overview failed (the hero already reports that).
   - Content engine: keep the live "ready" label (the count is `counts.ready`, not scheduled). Caption "Pieces published per week, last eight weeks." Multi source over drafts and schedule. Empty body "Drafts, reviews and scheduled pieces all count here.", CTA "Open Content" to `content`.
   - Social cadence: keep the link to `/social` and the not configured case as the empty state (`CardState` with CTA "Connect Buffer", plug icon, to `social`). Remove the `configured ?? true` fallback in favour of the state resolver. Multi source over status and posts, so a failed posts fetch never reads as zero posts. Error: "Could not reach Buffer." / "Without the connection there is no cadence to show, and this card will not guess one." Caption "Cadence only. Buffer does not give us reach, so this card does not claim any."
4. Delete `Shim`, `EmptyLine` and `HorizonStrip` once unused.
5. States to check on the deployed URL: populated as Liam; loading (throttle to Slow 3G); error (block `/api/admin/overview` and then one card route in DevTools, confirm the hero and vitals mask while the other cards still load, then Try again); empty is hard to reach on production, so check the empty branches on the local D1 snapshot or with a blocked route returning `{}` via DevTools overrides. 1440 and 375, light and dark, every tap target at least 44px at 375, no horizontal scroll, no hardcoded hex added.

Do not build: new API routes or calls, the prototype's slot capacity, the prototype's fabricated vitals trends, an "Open thread" button on owner reply rows (the row already opens the thread), the Wire's one line rule on phone, any Messages tile or link, anything on the brief route (FU.7 is separate).

### Slice C: teammate home

Owned file: `components/tahi/overview/homes/teammate-home.tsx`. About 0.75 days. No backend, no migration. Depends on slice A.

Build brief:

Follow design `overview.jsx` TeammateHome and the page keys teammate, teammate-loading, teammate-empty, teammate-error. No currency on this home, ever.

1. Root: `<div className="ov ov-studio" data-ro=...>`.
2. Hero: `variant="plain"` (the design's personal hero; the forest hero is the owner's money figure), NewMenu without the hero variant. Label stays "My open work" in every mode (see skipped items). State from the `me` resource: loading, or error with no data ("Could not load your open work." / "The member figures did not answer. An old count would send you at the wrong thing first.", retry `me.mutate()`). Remove the inline `Skel` span.
3. Vitals: state from `me`; keep the live values and subs; no invented trends.
4. Needs you: sources tasks, calls, replies; loading, `partialFailure` and error exactly as the owner slice does it. The reply item uses the `request` icon and the verb "Open thread".
5. Wire: `state` plus `emptyText="Nothing has happened on your work this week."` (seven day lookback).
6. New menu: New task, sub "Opens Tasks", `go('tasks')` (Tasks has no create deep link; see questions); New request, sub "Opens the request form", `go('requests-new')`; Log time, sub "Opens Time", `go('time')`.
7. Why is this empty (T1.19 asks for it; not a Liam question): render `.ov-why` below the masthead only when `me` has loaded with `openWork === 0`, the task list loaded with no open tasks, no calls today, no reply threads, and no source failed. Title "Your queue is genuinely empty, nothing is broken." Body "You see work once someone assigns you a task or adds you to a request. Access is granted per client, so a page with nothing on it usually means nothing has been handed to you yet, not that it is hidden." CTA `.ov-cta.ghost.sm` "Browse the task board" to `tasks`.
8. My work: `CardBody` over the tasks resource; keep the risk edge when something is overdue and the live ordering and chips. Empty body "Overdue work sorts to the top the moment something is assigned to you.", CTA "Open Tasks". Error "Could not load your work." / "The task list did not answer."
9. Today's calls: Join `className="ov-cta sm"` with `disabled={ro}`; a future call that is not joinable yet shows `.ov-soon` "Later"; a past call shows nothing on the right. Empty body "Calls for the clients you work on show up here on the day." (the route scopes by the member's client access, not by attendance, so the prototype's "Only calls you are on" would be untrue). Error "Could not load your calls." / "The calls feed did not answer."
10. Client replies waiting: icon `request`; each row's button becomes `className="ov-cta ghost sm"` "Open thread" with `disabled={ro}`; caption "Each row opens the request thread the client replied on."; error "Could not load client replies. Try again shortly." / "Threads are read from the last 60 days and capped at twelve." with retry; empty body "A request lands here when a client was the last to speak on a thread you are on."
11. Time tracking: move the inline styles onto `.ov-timerline`, `.ov-timer`, `.ov-timeron`, `.ov-btnrow`. Running: "Pause on Time" (pause icon) and "Switch task" (arrow icon); not running: "Start a timer on Time". All `.ov-cta.ghost.sm.grow`, `disabled={ro}`, still `go('time')`. Caption "These buttons open Time. The timer is not controlled from this page." If the week time fetch failed with no data, replace the three sub rows with `CardState` error "Could not load your time." / "The time route did not answer." and a retry over both time resources; never print 0h for a failed fetch.
12. Studio docs: states; caption "Studio wide, not scoped to your clients. Docs carry no client link, so the label says what it is."; empty body "The hub is studio wide, so anything written here shows for everyone.", CTA "Open Docs". The Docs Hub itself is locked and untouched.
13. Delete the local `Skel`, `RowsSkeleton` and `EmptyLine` helpers.
14. Verify: there is no scoped hire login, so check layout through /team "View as" (the admin's own data under the teammate layout, T1.19) and states through DevTools blocking. 1440 and 375, light and dark, 44px targets, and confirm every write control is disabled (not only faded) while previewing.

Do not build: the RoNote banner, the "My open work, as {name}" label, inline timer controls, any currency, any Messages iconography.

## 4. Critic items resolved in the slices

- owner-error FIX (hero and vitals printed ready figures on a failed load): slice A adds the masked states, slice B wires them.
- Wiring note (`overview-states.css` must load next to `overview.css`): slice A folds those rules into `overview.css`, translated to `.dark` and tokens, so there is no second sheet to forget.
- px to rem across the page sheet (non blocking, left out by the designer): slice A converts the blocks this module owns.
- Requirement gaps closed on the way: 20 of 21 cards could not show a failure (A and B), the teammate home had no error state at all (A and C), New menu items under delivered their labels (A and B), the 44px checks on the brief accordion header, New trigger and card links (A), no Messages iconography (B and C), FU.5 and FU.6 Wire halves (A).

## 5. Skipped (proposals, Design file only, or waiting on Liam)

The port keeps today's live behaviour for each of these.

- The RoNote banner while an admin previews a teammate (question 5).
- The "My open work, as {name}" hero label in preview; without the banner it would claim the admin's numbers are the hire's (question 5, T1.19).
- Real inline timer controls on the teammate Time card (question 3); the port only relabels the buttons to say they open Time.
- Unifying the Daily brief card with the nav bar briefing popover (T2.7, question 2).
- Showing the last known MRR with an "as of" stamp instead of the masked figure (the alternative in question 4); the masked figure is what the design drew and is built.
- The prototype's slot based Studio capacity (booked and open slots, per person on of); the route returns hours.
- The prototype's vitals trend chips ("6%", "1 this qtr", "since yesterday", "on pace", "2 since 9am"): sample data with no source.
- The prototype's "Twelve months back" caption on the cash-flow card: the route projects forward.
- An "Open thread" button on owner reply rows: the row already opens the thread.
- The Wire as one line always on phone: the live hanging indent wrap came from Liam's feedback comments (2026-09-19) and stays.
- The brief header without the date and clock meta: the live meta came from the same feedback round and stays.
- "New task" opening the task form directly: `/tasks` has no create deep link, and adding one belongs to the tasks module.
- Removing Messages from the shell sidebar and mobile tab bar (question 6): shell scope, not this module.

## 6. Questions for Liam

1. The masked hero on a failed load (no figure, a named source, Try again) is what ships. Or would you rather see the last known MRR with an "as of" stamp and a warning chip?
2. Daily brief and the nav bar briefing (T2.7): expand the home card and have the popover tease it (A), or fold the home card into the popover (B)? Both stay as they are until you say.
3. Teammate Time card: real inline Pause and Switch, or keep sending people to Time (the port says so out loud)?
4. Previewing a teammate: show a banner that says the figures are yours with their name on them until T1.19 lands, or hide preview on this page until then? Today neither happens.
5. Should Messages leave the shell sidebar and the mobile tab bar now that it is hidden platform wide?
6. The teammate hero moves from the green money style to the plain card the design drew. Happy with that?
7. Want a `?new=1` create deep link on Tasks so "New task" opens the form, like New request and Add client now do?

## 7. Risks

- `ov-kit.tsx` and `overview.css` are shared with the client home (`client-home.tsx`, portal-home module) and `waiting-on-you.tsx`. Kit props are opt in; the CSS changes to `.ov-cta`, `.ov-row`, `.rw-av`, `.ch-link`, chip inks, focus rings and the Wire ellipsis will also restyle the client home. Slice A must screenshot the client home before and after and keep the Pay button's desktop height.
- `TheWire` must keep returning null for an empty list when no `emptyText` is passed, or clients see studio copy.
- SWR returns stale data alongside a revalidation error; treating that as an error would blank good cards. The resolver in `card-state.ts` encodes the rule and is unit tested.
- Multi source cards (Pipeline, Content, Social, Needs you, teammate Time) must never turn a failed source into zeros.
- The teammate home still cannot be checked with a real scoped hire; admin preview shows the admin's data (T1.19).
- Renaming "Cash-flow ribbon" and "Reviews & case studies" changes the `data-section` anchors the feedback ball reads, so old comments anchored to those names may not match.
- Leaf radius on `.rw-av` changes avatar photo shapes on the client home too (the design system allows the leaf on avatar wrappers).
- `--text-faint` is 3.2:1 on the dark card; captions, the Wire label and timestamps use `--text-muted` in dark.
- The px to rem pass is a large mechanical edit in a shared file. It is value preserving, but it will conflict with a concurrent portal-home edit of the same sheet, so schedule slice A before the portal-home port touches `overview.css`.
- `FU.7` (moving non route exports out of `app/api/admin/overview/brief/route.ts`) is separate; this port does not touch any route file.

## 8. Shared files

- `app/(dashboard)/overview/overview.css` (also styles the client home)
- `components/tahi/overview/ov-kit.tsx` (imported by `client-home.tsx` and `components/tahi/portal/home/waiting-on-you.tsx`)
- `components/tahi/overview/overview-home.tsx` (the audience switcher, also routes the client home)
- `components/tahi/overview/ctx.ts` (read, not changed)
- `components/tahi/skeletons.tsx` (reused, not changed)
- `app/(dashboard)/app-shell.css` and `app/globals.css` (tokens read, not changed)
