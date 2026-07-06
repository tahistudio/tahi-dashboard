# Home / Overview - design brief

> The role-aware landing every user sees daily, and where onboarding routes on
> finish (/overview). Three homes from one route: the owner's studio cockpit, the
> teammate's "my work" desk, and the client's calm project home. Numbers are the
> hero; the page answers "what do I do next" before anything else.

> Arrival is gated: a user only reaches this home once they are entitled (a paid
> retainer client, an invited project/existing client, or a teammate). An
> unprovisioned or unpaid lead is held in onboarding (spec 02), so every home can
> assume a real, entitled occupant and a first-run state that is "welcome, here is
> your studio", never "you have not paid". The client's first-run is persona-aware:
> an invited project client lands with their engagement already set up (no payment
> step in their history); a self-serve retainer client lands having just paid.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design. This page
> lives inside the app shell of spec 04 (always-dark forest rail, hairline top bar,
> cream canvas); design only the canvas content and the page-owned overlays.

## What exists today (as built)

`app/(dashboard)/overview/page.tsx` is a server component: it computes `isAdmin = orgId === NEXT_PUBLIC_TAHI_ORG_ID`, fetches the Clerk name + org name, and branches **two ways only** - admin renders `<OverviewSwitcher>`, everyone else renders `<ClientOverview>`, both inside an `ErrorBoundary` ("Overview failed to load"). There is no distinct teammate home; a teammate gets the admin layout filtered by permissions.

- **AdminOverview** (`overview-content.tsx`, the realized Studio Ledger, canonical) - one SWR fetch to `/api/admin/overview` (skipped entirely when none of `clients / requests / invoices / financial_reports` are visible), a permission-gated bento at `maxWidth: 71.25rem` with a `2.5rem` left zone rail:
  - `components/tahi/overview/ledger-masthead.tsx` - the hero: a visually hidden `<h1>Studio overview</h1>`; an eyebrow ("Kia ora, {first}" + a mount-gated date/clock cluster: date, "AKL 07:42", "you 12:42" only when the viewer's zone differs from Pacific/Auckland, and a workshop-light pulsing dot + timer label only while a timer runs) with a "+ New" menu on the right (New request / Add client / Log time, permission-filtered); **MRR** as a forest gradient (`linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))`) leaf-radius block with the page's one CountUp; then vitals in order Cash (runway sub), Owed (aged micro-bar sub), Clients, Open (in-progress sub), each permission-filtered with `1px` hairline divider elements between them (never single-side borders); then a hairline rule and the **Studio Note** (one signed sentence: "While you slept: ..." or "Quiet overnight in the studio." + one next-action link + "Noted 7:14am" + a self-drawing leaf glyph).
  - `needs-you.tsx` - the act-now queue, hard-capped at 3 rows, one verb each, owning the page's single border-trace (`tahi-border-trace`, applied only when populated); sources: off-track engagements (`/api/admin/engagements/off-track`) [Reschedule], the next call within a 2h window (`/api/admin/discovery-calls/upcoming?limit=5&includePast=1`) [Join], and the oldest overdue invoice (prop from `arAging.oldest`) [Nudge]. Urgency bands: invoice (2,000,000 base) > call (1,000,000) > off-track. Healthy state: "All quiet in the studio." + optional "Next: {call} at {time}".
  - `the-wire.tsx` - a `2rem` stepped ticker (`/api/admin/overview/wire`): one event at a time, domain-ink dot (`--domain-content/social/sales/money/clients/ops`), 4s dwell, 240ms slide-up, pauses on hover/focus/hidden tab, `aria-live="polite"`, reduced-motion degrades to a static 4-item list.
  - Gated zones (`<Gate>`-wrapped, `Zone` renders a vertical uppercase label in the left rail, aria-hidden, and the grid re-packs via col-span swaps when a half is hidden): **Growth** (ContentEngine 7 / SocialCadence 5), **Work** (InTheStudio worklog 7 / TodayRail 5), **Ahead** (PipelineAhead 7 / StudioCapacity 5, HotLeads 6 / ProposalsLive 6), **Clients** (RetainerHealth 7 / ContractsCard 5), **Books** (TakeHomeGauges 5 / CashRunway 7, CashFlowRibbon 7 / ReceivablesTide 5). Plus a top band: TimeTracker 5 / WorldClock 7. Recharts cards are dynamically imported with pulse skeletons. Also: GettingStarted (0 clients), NothingEnabledCard (no features).
  - `/api/admin/overview/route.ts` returns one permission-aware payload (omits `mrr` / `outstandingInvoicesNzd` when denied): kpis, recentRequests, monthlyRevenue, cash, arAging, overnight, activeTimer, openByStatus. Every Studio Ledger aggregate is try/caught and degrades to null/0, never 500s. Helpers in `lib/overview-aggregates.ts`. The canonical design thesis is `SPECS/homepage-studio-ledger.md`.
  - **Audit finding (confirmed in code):** the "recent 8 requests" query orders by `updatedAt` **ascending** (`.orderBy(schema.requests.updatedAt)` with no `desc`), so the worklog actually shows the eight stalest requests. Fix alongside this redesign.
- **ClientOverview** (`overview-content.tsx`, the OLD pre-ledger surface, the redesign gap) - fetches `/api/portal/requests?status=active&page=1`; a plain greeting ("Welcome back, {first}" + "{orgName} (Tahi Studio workspace)") + New Request leaf button; three `StatCard` tiles (Open Requests, Awaiting Review, and **Invoices Due hardcoded "--"**); `TrackCapacityCard` (`/api/portal/capacity`: subscription plan + `hasPrioritySupport`, entitlements, summary string, per-track slots with `currentRequest`, queue, `showGhosts` upsell gate); an in-review banner; `OnboardingChecklist` (5 steps: welcomeVideoWatched, brandAssetsUploaded, firstRequestSubmitted, billingSetUp, meetTheTeam; dismissal in localStorage `tahi-onboarding-dismissed`); ScheduleCallWidget (`/api/portal/settings/booking`) + BookingWidget; ReviewOutreachBanner (`/api/portal/review-outreach`, Yes / Not right now / No thanks); a 6-row request list. Card-heavy; does **not** follow Studio Ledger.
- **A real portal invoices endpoint already exists:** `/api/portal/invoices` (org-scoped, returns `items` with `totalAmount`, `currency`, `dueDate`, `status`, paginated). The "--" tile predates it; nothing on the client home consumes it yet.
- **Rich data already available but unsurfaced:** retainer health, financial health, utilization, response time, capacity, cash-flow forecast, invoice aging, off-track engagements (all exposed via existing routes / MCP tools).

So: the owner home is done and is the reference; the teammate home does not exist as a distinct surface; the client home exists but predates Studio Ledger and shows a fake number.

## Page purpose

In one glance, tell each person where things stand and what to do next. Owner: is the studio healthy and what needs me. Teammate: what is mine and due. Client: where is my work and what needs my attention. Reassurance for the client, signal for the team, control for the owner.

## Why we are on this page

This is the most-opened URL in the product. The owner opens it with coffee to decide the day; the teammate opens it between tasks to find the next one; the client opens it, sometimes anxiously, to answer "is my money turning into work". Each of those is a different emotional contract, and one generic dashboard breaks all three: the client wanders into an ops tool, the teammate drowns in studio finance they cannot act on, and the owner gets a page diluted for audiences that are not them. The home is also where the Studio Ledger aesthetic earns its keep or dies: if the first screen of the day is calm, real, and specific, every other page inherits that trust.

**The single experiential throughline, which every element must serve or be cut:**

> One glance, one number, one next thing - and every figure on the page is true.

## Personas and jobs-to-be-done

**1. The owner (super_admin: Liam / Staci).** Runs the studio end to end.
- *Mindset:* first look of the day, deciding where attention goes; wants density-via-stacking, not bald minimalism; allergic to fake numbers.
- *JTBD:* "Is the studio healthy (money, delivery, pipeline) and what needs me today."
- *Must see:* MRR as the one big number, cash/owed/clients/open vitals, the one signed Studio Note, a max-3 act-now queue, then the zones (Work / Ahead / Books / Clients / Growth).
- *Must feel:* in command of a quiet instrument panel. A good Tuesday is a short page.

**2. The teammate (team_member: a designer, developer, or PM).** Scoped access, lives in their work.
- *Mindset:* "just tell me what is next"; protective of attention; quietly resentful of studio-finance framing that is not theirs to act on.
- *JTBD:* "What do I do next - what is mine, what is due, what is waiting on me."
- *Must see:* their open work count, overdue / due today / timer / replies vitals, a personal needs-you, today's calls + the timer, a short my-work digest linking to the full cockpit.
- *Must feel:* this desk was set for me. Never a subtracted admin page.

**3. The client (a contact at a client org).** Sees the portal only.
- *Mindset:* checking on work they are paying for; time-pressed; reassured by clarity, unsettled by internal vocabulary or placeholder data.
- *JTBD:* "Where is my work, what is awaiting me, when is my next delivery, what do I owe."
- *Must see:* awaiting-your-review as the loud figure, their track slots and queue position, recent requests with honest statuses, real invoices due, the next call.
- *Must feel:* looked after. One clear action, zero machinery.

**4. The owner-as-client (impersonation lens).** The owner previewing a client's portal via `OverviewSwitcher`.
- *Mindset:* QA, support, empathy check.
- *JTBD:* "Show me exactly what this client sees, and stop me acting as them."
- *Must see:* the full client home rendering with that org's data, write affordances (New request, Review, Pay, Book a call) visibly disabled with the read-only tooltip, the shell's impersonation banner above.
- *Must feel:* safe. A read-only lens, server-enforced.

**The tension to resolve:** the owner wants reach, the teammate wants focus, the client wants warmth. **The call:** three purpose-built compositions of the same ledger primitives (masthead, hero figure, vitals, NeedsYou, zones), each with its own hero and its own copy, all resolved by role server-side.

## What others do (and what we take)

- **Linear** - Home / My Issues / Inbox: a personal "assigned to me" + a triage inbox above team-wide. The model for the teammate home.
- **Stripe Home** - answers "money in / pending / on the way" instantly; surfaces blocking items (disputes, verifications) at the top. We mirror this with the owner masthead + NeedsYou.
- **Vercel** - the overview highlights the two things that matter (prod + preview) and what teammates are working on: relevance over completeness.
- **Height / Productive / Teamwork** (agency PM) - "My Work" / Today views, workload and utilization visualization, approvals + time front and center. Direct input to the teammate home.
- **ManyRequests / Designjoy** (client portals) - clean, white-labeled: submit / track / approve, active-request limit + queue position, deliverables, glanceable progress, minimal chrome. The client home target; the "one active, next in queue" slot signal is the productized-service trust device we make our signature.
- **Timeless ideas** - one hero metric per audience; a next-actions queue above the fold; recency (what changed since I last looked); glanceability over density; progressive disclosure; honest empty/first-run states.

## Experience principles

1. **One hero figure per home.** Owner = MRR; teammate = my open work count; client = awaiting your review. Anything else set at display scale dilutes the glance.
2. **Next action before analysis.** NeedsYou (max 3 rows, one verb each) sits directly under the masthead on every home; descriptive zones never outrank it.
3. **Relevance over completeness.** Each home shows the few things this person acts on now; everything else is one click away, so nothing here needs a scrollbar to matter.
4. **Never fake a number.** Every figure is real or absent (a muted middot); a placeholder like "--" is a defect that erodes the whole ledger's credibility.
5. **Audience-shaped, not audience-filtered.** The teammate home is its own composition, not the admin grid minus cards; a subtracted page reads as second-class and leaks studio framing.
6. **Fallback first.** Every aggregate try/catches to null and the layout regrids without holes; a broken integration must never cost the page.
7. **Personality carries information.** The Studio Note, the workshop light, the queue positions - each charming element measures something true, or it is cut.

### Scarcity rules (hard constraints, breaking one breaks the aesthetic)

- **One border-trace per screen**, and it lives on NeedsYou, only when populated. A second trace anywhere demotes the act-now queue to decoration.
- **One CountUp per screen**, on the hero figure only. A second animated number turns the ledger into a slot machine.
- **The leaf radius is rare:** the hero block, the primary CTA, icon/avatar wrappers, the active nav (shell-owned). A leafed card grid reads as a template.
- **Brand green is the only accent; status colours only when literally true.** Amber means genuinely at risk, red means genuinely overdue; tinting a healthy figure lies.
- **Real numbers only, fallback-first.** A gated or failed aggregate renders absent (regrid) or as a muted middot, never as a fake figure or an error slab.

## Anatomy

Every home shares the same vertical skeleton on the cream canvas (the shell's title is a visually hidden `<h1>`; the masthead is the visual title):

1. **Masthead** - eyebrow row (greeting + clocks + workshop light, quick-create on the right), the hero figure, the vitals row, a hairline rule, and (owner + teammate) the Studio Note sentence.
2. **NeedsYou** - the act-now queue, max 3 rows, the screen's single border-trace.
3. **The live band** - owner: TheWire + TimeTracker + WorldClock; teammate: the Today rail (calls + timer); client: none (calm is the point).
4. **The body** - owner: the five gated zones; teammate: the My Work digest + role-granted zones; client: Your tracks (the signature), Your requests, Next call, first-run checklist.
5. **Page-owned overlays** - the "+ New" menu; everything else (palette, banners) is shell-owned (spec 04).

## Layout and composition - desktop (three full sub-specs)

All three sit on `--color-bg-cream`, single column of stacked bands, `--space-6` (1.5rem) between bands, 12-col grid inside zone bands with `--space-6` gutters.

### 1. Owner home - KEEP (the reference to replicate, not redesign)

Max content width `71.25rem` plus a `2.5rem` left zone rail (vertical zone labels). This surface is built and live; Claude design reproduces it as the reference frame and extends nothing except where a zone is thin (utilization, response time may join Ahead/Work later, same fallback-first pattern).

```
   2.5rem rail | content 71.25rem max
+------------------------------------------------------------------------------+
| Kia ora, Liam · Wed 11 Jun · AKL 07:42 · you 12:42 · (o) 47m on Acme  [+ New] |
|                                                                              |
| +--------------------+  CASH        | OWED          | CLIENTS  | OPEN        |
| | MONTHLY RECURRING  |  NZ$142,000  | NZ$6,400      | 8        | 14          |
| | NZ$24,800  CountUp |  9.2mo runway| [==--] microbar| active  | 5 in prog   |
| +- leaf-radius block-+  (hairline dividers between vitals)                   |
| ----------------------------- hairline ------------------------------------ |
| (leaf) While you slept: NZ$4,800 cleared and 2 client replies.               |
|        Chase Northwind (12d overdue) ->                        Noted 7:14am  |
+------------------------------------------------------------------------------+
| NEEDS YOU  (the one border-trace, only when populated)                       |
|  o Everbright delayed · 4 phases off track                      [Reschedule] |
|  o Sam Kerr in 1h 40m · 11:30 / 09:30 AKL                             [Join] |
|  o Invoice overdue 12d · NZ$3,200 · Northwind                        [Nudge] |
+------------------------------------------------------------------------------+
|  o Stripe paid NZ$4,800 · 3h                                      (The Wire) |
|  [ TIME TRACKER (5 cols) ]  [ WORLD CLOCK (7 cols) ]                         |
G |  [ Content engine (7) ]  [ Social cadence (5) ]                            |
W |  [ In the studio (7)  ]  [ Today rail (5) ]                                |
A |  [ Pipeline (7) ] [ Studio capacity (5) ]  [ Hot leads (6) ][Proposals (6)]|
C |  [ Retainer health (7) ]  [ Contracts (5) ]                                |
B |  [ Take-home (5) ][ Cash & runway (7) ]  [ Cash-flow (7) ][Receivables (5)]|
+------------------------------------------------------------------------------+
```

Exact proportions: MRR block is `flex-shrink: 0` with `--space-4 --space-5` padding; vitals push right (`margin-left: auto`), each `min-width 5.5rem`, `--space-4` horizontal padding, `1px --color-border-subtle` divider elements between. Zone bands are 12-col grids, `gridAutoFlow: dense`, col-span pairs 7/5 or 6/6; a gated-off half's survivor takes all 12. Vertical zone labels stand aria-hidden in the rail (`writing-mode: vertical-rl`, `--text-sm` 700 uppercase `0.16em` tracking, `--color-text-subtle`), centred on the band.

### 2. Teammate home - NEW (the main design effort of this spec)

Its own identity, not filtered-admin. Max content width `64rem`, no zone rail (the page is short enough to not need the editorial spine). No studio MRR, cash, or pipeline framing in the masthead ever, regardless of role grants.

Zones top to bottom: (1) personal masthead, (2) personal NeedsYou, (3) a two-column band: Today rail (5 cols) + My Work digest (7 cols), (4) only role-granted gated zones, in the owner order, using the same Zone primitive with horizontal labels.

```
+------------------------------------------------------------------------------+
| Kia ora, Staci · Wed 11 Jun · AKL 07:42 · (o) 47m on Acme             [+ New] |
|                                                                              |
| +--------------------+  OVERDUE  | DUE TODAY | TIMER       | REPLIES         |
| | YOUR OPEN WORK     |  2        | 3         | 0:47        | 1               |
| | 9        CountUp   |  items    | due       | on Acme     | awaiting you    |
| +- leaf-radius block-+  (hairline dividers between vitals)                   |
| ----------------------------- hairline ------------------------------------ |
| (leaf) Two things due today. Start with the Everbright banner set. ->        |
+------------------------------------------------------------------------------+
| NEEDS YOU                                                                    |
|  o Everbright banner set overdue 2d                                   [Open] |
|  o Sam Kerr in 1h 40m · 11:30 / 09:30 AKL                             [Join] |
|  o Mia is waiting on No.021 · 22h                                    [Reply] |
+------------------------------------------------------------------------------+
| TODAY (5 cols)                    | MY WORK (7 cols)            View all ->  |
| [ next call, client-local first ] |  OVERDUE                                 |
| [ time tracker: running clock  ]  |   [] Banner set · Everbright   2d overdue|
|                                   |  TODAY                                   |
|                                   |   [] Homepage QA · Acme        Due today |
|                                   |  THIS WEEK                               |
|                                   |   [] Blog template · Northwind  Due Fri  |
|                                   |   (7 rows max across all groups)         |
+------------------------------------------------------------------------------+
| (role-granted zones only, e.g. WORK / KNOWLEDGE, same Zone primitive)        |
+------------------------------------------------------------------------------+
```

The digest and the `/tasks` My Work view (spec 08) are never the same component duplicated: the digest is a fixed-height, 7-row-max summary whose only interaction is opening the item or "View all"; the cockpit owns grouping controls, quick-add, and bulk actions.

### 3. Client home - Studio Ledger redesign

Max content width `56.25rem`, single column, no zone rail. Calm above all: no wire, no ticker, at most one status colour on screen at rest.

Zones top to bottom: (1) client masthead (hero vital line), (2) client NeedsYou, (3) Your tracks (the signature), (4) Your requests worklog, (5) Next call band, (6) first-run: Getting set up checklist, (7) review outreach (only when pending).

```
+------------------------------------------------------------------------------+
| Kia ora, Mia · Everbright · Wed 11 Jun                        [+ New request] |
|                                                                              |
|  AWAITING YOUR REVIEW   | OPEN       | INVOICES DUE   | NEXT CALL            |
|  2                      | 5          | NZ$3,200       | Thu 26 Jun           |
|  (display scale,CountUp)| requests   | 1 due 20 Jun   | 11:30 your time      |
| ----------------------------- hairline ------------------------------------ |
+------------------------------------------------------------------------------+
| NEEDS YOU                                                                    |
|  o 2 deliveries need your sign-off                                  [Review] |
|  o Invoice due 20 Jun · NZ$3,200                                       [Pay] |
|  o Upload brand assets to finish setting up                       [Continue] |
+------------------------------------------------------------------------------+
| YOUR TRACKS                                                                  |
|  Your plan: Scale [Priority]        1 active now, next up from your queue    |
|  (o) Small track            "Homepage refresh"  [In Progress]                |
|  (o) Small track (Priority) Available                                        |
|  ( ) Large track            Available                                        |
|  QUEUE (3 waiting)   1. Landing page animations   2. Blog template   3. ...  |
|  ^ Upgrade to Scale for large tasks and more capacity (quiet, only if true)  |
+------------------------------------------------------------------------------+
| YOUR REQUESTS                                                  View all ->   |
|  [Client Review] Homepage refresh · design                       2h ago  ->  |
|  [In Progress]   Blog template · development                     1d ago  ->  |
|  (6 rows max, hairline-separated)                                            |
+------------------------------------------------------------------------------+
| NEXT CALL   Thu 26 Jun · 11:30 your time / 09:30 AKL          [Book a call]  |
+------------------------------------------------------------------------------+
| GETTING SET UP (first run only, dismissible)                                 |
|  [x] Watch the welcome video   [ ] Upload brand assets   [ ] Submit your...  |
+------------------------------------------------------------------------------+
```

The hero vital line: "Awaiting your review" is the loud figure at display scale (2.5rem, weight 300-400, tight tracking, bare ink on the canvas - the client hero is bare, not the gradient block, so the page's only green stays on the CTA); Open / Invoices due / Next call follow at `--text-lg` 700, hairline dividers between, same Vital anatomy as the owner. Invoices due is wired to the **real** `/api/portal/invoices` data (sum of `sent` + `overdue` items in the org's currency, count + soonest `dueDate` as the sub-line); the "--" placeholder is retired. Next call comes from the org's scheduled calls; when none exists the vital reads "none booked" and the Next call band leads with the Book a call CTA.

## Layout and composition - mobile (375px)

Everything stacks single-column, `--space-4` gutters, no horizontal scroll, touch targets >= 44px. The shell's bottom tab bar (spec 04) sits below. The hero block goes full-width; vitals wrap into a 2x2 grid with hairline dividers; NeedsYou rows stack their action button under the body text at full width. On the owner home the zone labels fall back to small horizontal ledger labels above each band (as built); the Wire keeps its single-line ticker.

**Teammate home, 375px:**

```
+---------------------------+
| Kia ora, Staci    [+ New] |
| +----------------------+  |
| | YOUR OPEN WORK   9   |  |
| +----------------------+  |
| OVERDUE 2   | DUE TODAY 3 |
| TIMER 0:47  | REPLIES 1   |
| ------ hairline --------- |
| (leaf) Two things due     |
|  today. Start with... ->  |
+---------------------------+
| NEEDS YOU                 |
| o Banner set overdue 2d   |
|   [ Open ]  (full width)  |
| o Sam Kerr in 1h 40m      |
|   [ Join ]                |
+---------------------------+
| TODAY                     |
| [ next call ] [ timer ]   |
+---------------------------+
| MY WORK       View all -> |
| OVERDUE                   |
|  [] Banner set  2d overdue|
| TODAY                     |
|  [] Homepage QA Due today |
| (7 rows max)              |
+---------------------------+
| (granted zones, stacked)  |
+---------------------------+
| (o)  (o)  (o)  (o)  (=)   |
| Ovw  Req  Tsk  Msg  More  |
+---------------------------+
```

**Client home, 375px:**

```
+---------------------------+
| Kia ora, Mia              |
| Everbright                |
|        [ + New request ]  |
| AWAITING YOUR REVIEW      |
| 2                         |
| OPEN 5     | DUE NZ$3,200 |
| NEXT CALL Thu 26 Jun      |
| ------ hairline --------- |
+---------------------------+
| NEEDS YOU                 |
| o 2 deliveries need your  |
|   sign-off    [ Review ]  |
| o Invoice due 20 Jun      |
|   NZ$3,200       [ Pay ]  |
+---------------------------+
| YOUR TRACKS               |
| Your plan: Scale [Prio]   |
| (o) Small "Homepage..."   |
| ( ) Large  Available      |
| QUEUE 1. Landing page...  |
+---------------------------+
| YOUR REQUESTS  View all ->|
| [Client Review] Homepage  |
| [In Progress] Blog temp.  |
+---------------------------+
| NEXT CALL  [ Book a call ]|
+---------------------------+
| GETTING SET UP (first run)|
+---------------------------+
| (o)  (o)  (o)  (o)  (=)   |
| Ovw  Req  Msg  Files More |
+---------------------------+
```

Collapses/hides at 375px: the owner zone rail (labels go horizontal), the WorldClock (folds into the eyebrow clocks), the "you {time}" local clock when it equals AKL, the vitals' sub-lines stay but the aged micro-bar shrinks to `3rem`. Nothing is hover-gated; every action is a visible button.

## Component spec

**Masthead eyebrow (all homes)**
- Purpose: orient in time and person; hold the quick-create.
- Anatomy: greeting span (`--text-xs`, weight 600, `--color-text-muted`), then middot-separated: date ("Wed 11 Jun"), clocks ("AKL 07:42" tabular-nums; "you 12:42" appended in `--color-text-subtle` only when the viewer's zone differs; client order reverses: local first, AKL after), workshop-light (a `0.4375rem` pulsing dot in `--color-link` + the timer label, `data-private`, present only while a timer runs). Right: the "+ New" button. Whole row `--text-xs`, `--color-text-subtle`, wraps on narrow screens with `--space-2-5` gaps.
- Tokens: `--color-text-muted`, `--color-text-subtle`, `--color-link`.
- States: SSR renders greeting + button only (the time cluster is mount-gated so no dangling middots); the light appears/disappears live on the shared minute tick.

**"+ New" menu (page-owned overlay)**
- Purpose: the one create affordance above the fold.
- Anatomy: brand button (`--color-brand` fill, white, `--radius-leaf-sm`, `--text-sm` 600, plus icon 14px, `--space-1-5 --space-3` padding); menu panel `min-width 11rem`, `--color-bg`, `1px --color-border`, `--radius-md`, `--shadow-floating`, `--space-1` padding; items `--space-2 --space-3`, `--text-sm`, `--radius-sm`.
- Items by home: owner - New request / Add client / Log time (permission-filtered); teammate - New request / Log time (per grants); client - the button is "New request" and links straight to `/requests?new=1` (no menu).
- States: hover fill `--color-bg-secondary` on items; `aria-haspopup="menu"` + `aria-expanded`; open focuses the first item; ArrowUp/Down/Home/End cycle; Escape and outside-click close; focus ring visible on the trigger. Disabled (impersonation): 50% opacity + tooltip.

**Hero figure block (owner MRR / teammate open work)**
- Purpose: the one number, unmistakable.
- Anatomy: forest gradient block, `--space-4 --space-5` padding, `--radius-leaf`; ledger label on top (`0.6875rem` 600 uppercase `0.08em`, white at 92%); the figure `clamp(2.25rem, 6vw, 3.25rem)` weight 700, `-0.02em`, tabular-nums, white, `data-private` (owner), with the page's single CountUp.
- Tokens: `linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))`, `--radius-leaf`.
- States: loading - a `3.25rem x 11rem` white-18% shimmer inside the block; denied/absent - a muted white-70% middot at `--text-xl` (owner) / the teammate hero never gates (a count of your own work is always yours).

**Client hero vital ("Awaiting your review")**
- Purpose: the client's one number, bare on the canvas.
- Anatomy: ledger label, then the figure at `2.5rem` weight 400 `-0.02em` ink, tabular-nums, the single CountUp; sub-line `--text-2xs` `--color-text-subtle` ("deliveries" / "delivery"). Zero renders as a calm ink `0` with sub "all approved".
- Tokens: `--color-text`, `--color-text-subtle`. No tint at any value; the action urgency lives in NeedsYou.

**Vital (shared)**
- Purpose: one supporting figure.
- Anatomy: ledger label (`0.6875rem` 600 uppercase `0.06em` `--color-text-subtle`), value (`--text-lg` 700 ink, tabular-nums, `data-private` on money), sub-line (`0.6875rem` subtle; may host the aged micro-bar: `4rem x 0.25rem` pill, segments neutral `--color-border-strong` / `--color-warning` / `--color-danger`, `aria-hidden`, with a text equivalent in the label). `min-width 5.5rem`, `--space-4` horizontal padding; `1px --color-border-subtle` divider elements between vitals (all-sides-or-absent rule: dividers are standalone elements, never a side border).
- States: loading shimmer `1.5rem x 3.5rem`; denied - the vital is absent and the row repacks; failed aggregate - muted middot value.

**Studio Note (owner + teammate)**
- Purpose: the page speaks one human sentence.
- Anatomy: self-drawing leaf glyph (16px, `--color-brand`, 1.4 stroke) + one sentence (`--text-base`, ink, 1.55 line-height, `data-private`) + at most one inline action link (`--color-link`, 600, arrow-right 12px) + the stamp ("Noted 7:14am", `--text-xs` subtle). Teammate variant sources from their own day: overdue count, due-today count, first suggested item.
- States: loading - one `1.25rem` x 70% shimmer line; quiet - "Quiet overnight in the studio." / "A clear desk today."

**NeedsYou (shared shell, per-home sources)**
- Purpose: the act-now queue; owns the screen's single border-trace.
- Anatomy: white card `--color-bg`, `--radius-lg`, `--space-6` padding; ledger zone label "Needs you"; up to 3 rows, each: `--color-bg-secondary` fill + `1px --color-border-subtle` all-sides + `--radius-md`, `min-height 2.75rem`, `--space-3 --space-4` padding; a `0.5rem` tone dot (danger / warning / brand, `aria-hidden`, with an sr-only "Urgent:" / "Warning:" prefix), body text `--text-sm` ink (names/amounts `data-private`), and one action button (white fill, `1px --color-border`, `--radius-leaf-sm`, `--color-link` 600, icon 13px, `min-height 2.75rem`).
- Sources: owner - off-track [Reschedule], imminent call within 2h [Join], oldest overdue invoice [Nudge]. Teammate - my most-overdue assigned item [Open], my next call today [Join], the oldest request awaiting my reply [Reply]. Client - deliveries in Client Review [Review], the soonest unpaid invoice [Pay], the next onboarding step (first run) [Continue].
- States: populated (the trace, one row per line); empty (no trace, standard subtle hairline, leaf glyph + the calm line + optional "Next: ..."); loading (no trace, two `2.75rem` shimmer rows). Status colour only when literally true: the client Review row uses the brand dot unless the review has aged past 3 days (then warning).

**Today rail (teammate)**
- Purpose: today's fixed points + the running clock.
- Anatomy: reuses the owner TodayRail + TimeTracker primitives in one 5-col stack: upper - next calls as a card deck, time client-local first with AKL beneath, [Join] appears only inside the 10-minute window when a `meetingUrl` exists; lower - the tracker: running face (live HH:MM:SS from the shared 1s tick, target `data-private`, ember pulse, Stop) or idle face (Start + request picker), then today's logged/billable totals over a hairline.
- States: no calls - "No calls today."; timer idle / running; totals absent until the time endpoint returns entries.

**My Work digest (teammate)**
- Purpose: the 7-row summary that links to the cockpit; never the cockpit itself.
- Anatomy: white card, `--radius-lg`, header row (ledger label "My work" left; "View all ->" link right, `--color-link` 600 `--text-sm`, to `/tasks` My Work per spec 08); groups in order Overdue / Today / This week, each a ledger micro-label; rows `2.75rem`, hairline-separated (`1px --color-border-subtle` between, none on the last): a `1.125rem` checkbox (completes the task optimistically), title `--text-sm` 500 ink truncating (`data-private`), client name `--text-xs` subtle, right-aligned due chip (`--radius-sm` quiet chip; danger text only when overdue, `--color-due-soon-text` when due today, subtle otherwise). Max 7 rows total; overflow goes to the count in "View all (12)".
- States: rest / hover (`--color-row-hover` row fill) / focus ring on the row link; loading (4 shimmer rows); empty ("You are all caught up." + leaf glyph, no CTA needed); error - the card renders the empty frame with "Could not load your work." and a Retry link.

**TrackCapacityCard - "Your tracks" (client, the signature)**
- Purpose: the productized-service trust device: what is active now, what waits, where you stand.
- Anatomy, top to bottom: header row - "Your plan: {Maintain|Scale}" (`--text-sm` 600 ink) + a quiet "Priority" chip (`--radius-full`, `--color-brand-50` bg, `--color-brand` text, only when `hasPrioritySupport`) + the server `summary` line (`--text-xs` muted); slot list - one row per track, `2.75rem`: a `0.625rem` slot dot (filled `--color-brand` when occupied; hairline ring `--color-border` on `--color-bg-secondary` when free), track name ("Small track", "Small track (Priority)", "Large track", `--text-xs` 600 uppercase muted), then the active request title (`--text-sm` 500 ink, `data-private`, truncating) with its status chip, or "Available" in `--color-text-subtle`; queue block - ledger label "Queue ({n} waiting)", then up to 5 numbered rows ("1.", "2." in subtle 500 `min-width 1rem`, title `--text-xs` ink `data-private`); footer - upsell lines (`--text-xs` muted, trending icon 12px brand) only when `showGhosts !== false` and the plan genuinely lacks the upgrade, or the success strip "You have the full package" (`--color-success-bg`, `--color-success` text) only when literally scale + priority.
- Tokens: card `--color-bg` + `1px --color-border` + `--radius-lg`; internal hairlines `--color-border-subtle`.
- States: no subscription (project client) - the card is absent and the delivery schedule band (shared read from spec 04's client nav) takes its slot; loading - a `12rem` card shimmer; queue empty - the queue block is absent (never "0 waiting").

**Your requests worklog (client)**
- Purpose: recency and honesty: the last thing that moved.
- Anatomy: white card, header ("Your requests" + "View all ->" to `/requests`); up to 6 rows, `--space-4 --space-5` padding, hairline-separated: StatusBadge (pill, the canonical pipeline labels: Submitted, In Review, In Progress, Client Review, On Hold, Delivered, Cancelled), title `--text-base` 500 ink `data-private` (+ scope flag icon and a "High" priority pill only when true), type sub-line `--text-xs` subtle, right-aligned relative time (tabular-nums `--text-xs` subtle), row arrow.
- States: hover `--color-row-hover`; loading 4 shimmer rows; empty - leaf-radius icon wrapper + "No requests yet" + "Submit your first request and the Tahi team will get started." + CTA.

**Next call band (client)**
- Purpose: one honest answer to "when do we talk next".
- Anatomy: quiet band (`--color-brand-50` bg, `1px --color-brand-100` border, `--radius-lg`, `--space-4 --space-5` padding): left - "Next call" ledger label + the call title, date, "{local} your time / {AKL} AKL" (tabular-nums); right - [Join] (only in the 10-minute window) or [Book a call] (brand fill, `--radius-leaf-sm`) when no call is scheduled and a booking URL exists.
- States: call scheduled / none + booking URL ("Need to chat?" + CTA) / neither - the band is absent.

**Getting set up checklist (client first run)**
- Purpose: a warm, finishable arrival, persona-aware.
- Anatomy: white card, ledger label "Getting set up", progress line ("2 of 5 done"), five rows (44px+): check circle, step title (`Watch the welcome video` / `Upload brand assets` / `Submit your first request` / `Set up billing` / `Meet the team`), a CTA link per step; the welcome-video row expands to the Loom embed when a URL exists; a quiet "Dismiss" text button (persists to localStorage `tahi-onboarding-dismissed`). Invited project clients (no payment in their history) never see "Set up billing".
- States: per-step done/undone (optimistic toggle, reverts on failure); fully done - the card swaps to one line "You are all set." with Dismiss; dismissed - absent.

**Zone + regrid (owner + teammate bodies)**
- Purpose: labelled bands that repack with no holes.
- Anatomy: a `<section aria-label>` per zone; desktop owner label vertical in the rail (aria-hidden), mobile/tablet + teammate horizontal ledger label above; inside, a 12-col dense grid, `--space-6` gap; every card declares its span and its partner-absent span (7<->12, 5<->12, 6<->12).
- States: a `<Gate>`-denied card is absent (never disabled, never an empty slot); a zone with nothing visible does not render at all.

## Motion and dynamism

All motion uses `--ease-out cubic-bezier(.22,1,.36,1)` (the codebase alias `--ease-productive` for the leaf draws); no bounce, no spring. The resting-page budget: at most two things move at rest (the Wire step and the minute tick), everything else animates once on arrival.

- **Hero CountUp:** the single count-up on the hero figure, ~700ms, once per load. Reduced motion: the final value paints instantly.
- **Leaf glyph draw:** stroke-dashoffset draw-in, 700ms, on the Studio Note and the NeedsYou empty state. Reduced motion: painted fully drawn.
- **Reveal:** the masthead and the grid fade up ~8px with a short stagger on first paint (the existing `Reveal` primitive), <= 300ms total. Reduced motion: instant.
- **The Wire (owner only):** 4000ms dwell, 240ms slide-up swap (transform + opacity only); pauses on hover, focus-within, and hidden tab. Reduced motion: a static list of the 4 most recent events, no auto-advance.
- **Workshop light / ember:** a slow opacity pulse on the timer dot, only while a timer literally runs. Reduced motion: a static dot.
- **Row hover:** background fill to `--color-row-hover` over `--motion-quick` 110ms; action buttons use the `tahi-press` compression. Hover-triggered animations play to completion; never reversed mid-way, re-armed on the next enter.
- **Optimistic checks (digest checkbox, checklist steps):** the check draws in 200ms; on failure the row restores with no shake.

## Accessibility (WCAG 2.2 AA)

- **Landmarks + headings:** each home renders exactly one visually hidden `<h1>` ("Studio overview" / "Your work" / "Project overview"); every band is a named `<section aria-label>` ("Needs you", "My work", "Your tracks", "Your requests"). NeedsYou rows are an `<ul>`.
- **Figures have names:** every hero and vital pairs the big number with its ledger label in the accessible name (the label precedes the figure in the DOM); the aged micro-bar is `aria-hidden` with the amounts available as text.
- **Live regions:** the Wire announces via a stable `aria-live="polite"` sr-only span (never the animated node); the timer clock is not live-announced (it would chatter) - its Stop button carries the elapsed label.
- **Contrast:** ink on cream and white cards clears 4.5:1 by token. On the forest gradient block, the hero figure is large bold text (3:1 rule, passes), but the `0.6875rem` white-92% ledger label over `--color-brand` sits near 4.0:1 - promote it to solid white or deepen the gradient start (flagged in Open decisions). Status text (danger/warning) never carries meaning alone: rows pair colour with the sr-only prefix and literal words ("overdue 12d").
- **Keyboard paths:** eyebrow menu (full ARIA menu pattern, as built); every row is a real link with a visible `:focus-visible` ring; the digest checkbox is a focusable button ("Mark {title} done"); tab order follows the visual order masthead -> NeedsYou -> bands.
- **Target size:** all action buttons and rows >= 44px on mobile (`min-height 2.75rem` everywhere); checklist toggles 44px.
- **Private mode:** every client-identifying string and money figure carries `data-private` (names, amounts, timer targets, request titles) so the shell's private-mode blur covers all three homes.
- **Reduced motion:** per the Motion section, every animation has an instant-state fallback; nothing renders blank.

## States and flows

- **First run:** owner with 0 clients - GettingStarted steps card (add client / create subscription / submit request / connect Stripe); new teammate with no assignments - the digest renders the guided empty ("You are all caught up." + "Work assigned to you lands here."); client first login - the Getting set up checklist present, NeedsYou seeded with the next onboarding step, persona-aware (invited project client: no billing step, no payment history implied).
- **Healthy:** owner NeedsYou "All quiet in the studio." + "Next: ..."; teammate "You are all caught up."; client "Nothing needs you right now." No trace in any of them.
- **Loading:** the masthead shell and eyebrow paint immediately; the hero shows its in-block shimmer; each band owns its skeleton; no full-page spinner ever.
- **Partial data:** any failed aggregate renders a muted middot or an absent band (fallback-first); the page never shows an error slab for one bad integration. Only a failed root fetch shows the single quiet error banner with the danger hairline.
- **Permission regrid:** denied vitals and zones are absent and the layout repacks with no holes (col-span swaps); a teammate with only Workspace grants sees masthead + NeedsYou + Today + digest and nothing else - and it reads complete.
- **Impersonation:** `OverviewSwitcher` routes the owner's client lens to the client home with that org's data, read-only: New request, Review, Pay, Book a call, checklist toggles all render disabled with the tooltip "Read-only while viewing as a client."; the team-member lens renders the teammate home scoped to that member.
- **Timer states:** workshop light present only while running; the tracker's Start flow handles the 409 already-running confirm.
- **Dark mode:** all three homes on the dark tokens; the forest gradient block and the sidebar are the constants; status tints use the dark-mode variants.

## Copy deck

Calm, plain NZ voice. Hyphens only, no em or en dashes.

**Shared**
- Greeting: `Kia ora, {first}` (fallback `Kia ora`). Clocks: `AKL {hh:mm}` / `you {hh:mm}` (client order: `{hh:mm} your time / {hh:mm} AKL`).
- New menu: `New` (owner/teammate button), items `New request`, `Add client`, `Log time`. Client button: `New request`.
- Zone label: `Needs you`. Row verbs: `Reschedule`, `Join`, `Nudge`, `Open`, `Reply`, `Review`, `Pay`, `Continue`.
- Error banner: `Failed to load overview data. Please refresh the page.`
- Read-only tooltip: `Read-only while viewing as a client.`

**Owner**
- Hero label: `Monthly recurring`. Vitals: `Cash` (`{n} mo runway` / `no burn data`), `Owed` (micro-bar / `nothing overdue`), `Clients` (`active`), `Open` (`{n} in progress`).
- Studio Note: `While you slept: {amount} cleared, {n} client replies, and {n} shipped.` / quiet: `Quiet overnight in the studio.` Concern links: `Chase {client} ({n}d overdue)` / `Move the open requests forward`. Stamp: `Noted {time}`.
- NeedsYou rows: `{client} {delayed|blocked|at risk} · {n} phases off track`; `{name} in {1h 40m} · {local} / {AKL} AKL`; `Invoice overdue {n}d · {amount} · {client}`. Empty: `All quiet in the studio.` + `Next: {name} at {time}`.
- Wire empty: `The wire is quiet. New activity across the studio shows up here.`
- Zones: `Growth`, `Work`, `Ahead`, `Clients`, `Books`. Getting started: `Getting started` / `Complete these steps to set up your dashboard.` / steps `Add your first client`, `Create a subscription or project`, `Submit a request on their behalf`, `Connect Stripe for billing`. Nothing enabled: `Nothing enabled on your home yet` / `Ask an admin to switch on home cards for you in Settings under Permissions.` / `Open Settings`.

**Teammate**
- Hero label: `Your open work`. Vitals: `Overdue` (`items`), `Due today` (`due`), `Timer` (`on {client}` / `off`), `Replies` (`awaiting you`).
- Note: `{Two} things due today. Start with {title}.` / clear: `A clear desk today.`
- NeedsYou rows: `{title} overdue {n}d`; `{name} in {1h 40m} · {local} / {AKL} AKL`; `{name} is waiting on {request} · {22h}`. Empty: `You are all caught up.`
- Today: `Today`, `No calls today.` Digest: `My work`, groups `Overdue` / `Today` / `This week`, chips `{n}d overdue` / `Due today` / `Due {Fri|12 Jul}`, link `View all` (`View all ({n})` on overflow), empty `You are all caught up.` + `Work assigned to you lands here.`, error `Could not load your work.` + `Retry`.

**Client**
- Hero label: `Awaiting your review`, sub `deliveries` / `all approved` (at zero). Vitals: `Open` (`requests`), `Invoices due` (`{n} due {date}` / `nothing due`), `Next call` (`{hh:mm} your time` / `none booked`).
- NeedsYou rows: `{n} deliveries need your sign-off` (singular `1 delivery needs your sign-off`); `Invoice due {date} · {amount}` (overdue: `Invoice overdue {n}d · {amount}`); `{Step title} to finish setting up`. Empty: `Nothing needs you right now.`
- Tracks: `Your tracks`, `Your plan: {Maintain|Scale}`, chip `Priority`, `Available`, `Queue ({n} waiting)`, upsells `Add Priority Support for an extra small track` / `Upgrade to Scale for large tasks and more capacity`, full: `You have the full package`.
- Requests: `Your requests`, `View all`, statuses `Submitted / In Review / In Progress / Client Review / On Hold / Delivered / Cancelled`, priority pill `High`, empty `No requests yet` / `Submit your first request and the Tahi team will get started.` / `Submit a request`.
- Next call: `Next call`, `Book a call`, `Need to chat?` / `Book a quick call with the Tahi team.`, `Join`.
- Checklist: `Getting set up`, `{n} of 5 done`, steps `Watch the welcome video`, `Upload brand assets`, `Submit your first request`, `Set up billing`, `Meet the team`; done: `You are all set.`; `Dismiss`.
- Review outreach: `We would love your feedback!` / `Your experience matters. Share a quick review to help us improve.` / `Yes, I will` / `Not right now` / `No thanks`.

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Canvas | `--color-bg-cream` (never hardcoded) |
| Hero block (owner/teammate) | `linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))`, `--radius-leaf`, white figure |
| Hero figure type | `clamp(2.25rem, 6vw, 3.25rem)` 700 `-0.02em` tabular-nums (block) / `2.5rem` 400 ink (client, bare) |
| Ledger labels | `0.6875rem` 600 uppercase `0.06em-0.08em` `--color-text-subtle` |
| Vitals | `--text-lg` 700 `--color-text`, dividers `1px --color-border-subtle` (standalone elements) |
| Cards | `--color-bg`, `1px --color-border-subtle` (subtle) or `--color-border` (tracks card), `--radius-lg` |
| NeedsYou rows | `--color-bg-secondary` fill, `1px --color-border-subtle` all sides, `--radius-md`, `min-height 2.75rem` |
| Border-trace | the `tahi-border-trace` class, NeedsYou populated state only |
| Action buttons | white fill, `1px --color-border`, `--radius-leaf-sm`, `--color-link` 600 |
| Primary CTA | `--color-brand` fill, white, `--radius-leaf-sm` |
| Tone dots | `--color-danger` / `--color-warning` / `--color-brand`, `0.5rem`, aria-hidden + sr-only prefix |
| Aged micro-bar | `4rem x 0.25rem` pill: `--color-border-strong` / `--color-warning` / `--color-danger` |
| Wire domain dots | `--domain-content/social/sales/money/clients/ops`, `0.4375rem` |
| Due chips | quiet chip; `--color-danger` text overdue, `--color-due-soon-text` due today, subtle later |
| Status pills | the existing StatusBadge status tokens (`--status-*`) |
| Next call band | `--color-brand-50` bg + `1px --color-brand-100` |
| Row hover | `--color-row-hover` |
| Shimmers | `tahi-shimmer`, sized per slot |
| Motion | CountUp/leaf ~700ms; Wire 4000ms/240ms; hover 110ms `--motion-quick`; all `--ease-out`; full reduced-motion fallback |
| Leaf radius budget | hero block + primary CTA + action buttons (leaf-sm) + empty-state icon wrapper. Nothing else |
| Type | Manrope; body `--text-base`; rows `--text-sm`; subs `--text-xs` / `0.6875rem` |
| Widths | owner `71.25rem` + `2.5rem` rail; teammate `64rem`; client `56.25rem`; band gap `--space-6` |

## Deliverables for Claude design

1. **Owner home - desktop** (the KEEP reference: masthead + NeedsYou populated + Wire + all five zones), reproduced from this spec, not reinvented.
2. **Teammate home - desktop** (the new build: personal masthead, personal NeedsYou, Today rail + My Work digest, one granted zone below).
3. **Client home - desktop** (the redesign: hero vital line with real invoices due, client NeedsYou, Your tracks signature, worklog, next call band).
4. **Teammate home - mobile 375px** and **client home - mobile 375px** (stacking per the diagrams, 44px targets).
5. **First-run sheet:** owner 0-clients, new teammate empty digest, client Getting set up (both personas: invited without billing step, self-serve with it).
6. **Healthy sheet:** all three NeedsYou empty states (no trace), zero awaiting-review client hero.
7. **Dark mode** of all three desktops.
8. **State sheet:** loading skeletons per band, denied-zone regrid (teammate narrow role), failed-aggregate middot vital, private mode on the client home, impersonation read-only client home.
9. **TrackCapacityCard close-up:** occupied + available slots, queue with positions, upsell footer, full-package strip, no-subscription absence.
10. **My Work digest close-up:** all three groups, overflow "View all (12)", checkbox hover/focus, empty.

**Integration constraints:**
- Reuse `components/tahi/overview/*` primitives (LedgerMasthead, NeedsYou, TheWire, TodayRail, TimeTracker, Zone/Gate regrid) - the teammate and client homes are new compositions of the same parts, not new widget kits.
- The teammate home routes through `OverviewSwitcher` (page.tsx grows a third branch on resolved access level, server-side) and its data endpoint (`/api/admin/overview/me` or equivalent) must honour `resolveAccessScoping` and the fallback-first per-aggregate try/catch; it never 500s.
- Wire the client "Invoices due" to `/api/portal/invoices` (or a small summary endpoint over it); the "--" placeholder is retired. All portal fetches stay org-scoped via `getPortalAuth`.
- Fix the recent-requests ordering bug (`orderBy` ascending) in `/api/admin/overview/route.ts` when touching the worklog.
- Tokens only (dark mode by construction); `data-private` on every client-identifying string; preserve the scarcity rules (one trace, one CountUp, rare leaf, real numbers only); no single-side borders anywhere; canonical status labels everywhere.

## Why this is premium

Most products ship one dashboard and hope it fits everyone, so the client feels like they wandered into an ops tool and the junior teammate drowns in studio finance they cannot act on. Three purpose-built homes from one route fix that: the owner gets a quiet instrument panel where the one number that matters counts up once and exactly what needs them is named with a verb; the teammate gets a calm desk that says "here is your next thing" and links to the full cockpit only when they want depth; the client gets one loud honest figure, their place in the queue rendered as physical slots, and a single clear action. The restraint is the argument: one trace, one CountUp, one accent, real numbers or nothing - the editorial confidence a template never commits to, held consistently across three audiences who never see each other's page.

## Open decisions and risks

1. **Teammate home is undefined today** (code only branches admin/client). The "filtered admin" stopgap leaks studio framing (money labels) to staff. This spec's main decision: build a distinct personal home, with a third server-side branch on resolved access level. Confirm before building.
2. **Client "Invoices Due" is a hardcoded "--"** - `/api/portal/invoices` already exists; wire it (sum of sent + overdue) or add a light summary endpoint. Never ship a fake figure.
3. **Scarcity rules are load-bearing** (one trace, one CountUp, rare leaf, status colour only when true). New cards must not break them; the client hero deliberately goes bare-ink so the CTA keeps the only green.
4. **Permission-gated regrid** must leave no holes when features are denied; every new card declares its partner-absent span.
5. **Fallback-first data** - every aggregate degrades to null; new metrics (my-work counts, replies awaited, invoices due) follow the per-aggregate try/catch.
6. **Confirmed audit finding: worklog ordering bug** - `/api/admin/overview` orders recent requests by `updatedAt` ascending, so "recent" is actually the stalest 8. One-line fix (`desc`), ship with this work.
7. **Contrast on the hero block label** - the `0.6875rem` white-92% "Monthly recurring" label over `--color-brand` sits near 4.0:1; promote to solid white or start the gradient darker before signing off AA.
8. **Project clients have no subscription** - TrackCapacityCard returns null for them; decide what owns its slot (the shared delivery schedule read is the recommendation) so a project client's home never feels emptier than a retainer client's.
9. **"Replies awaited" needs a real source** - requires a "last message author vs assignee" aggregate on requests/conversations; scope it fallback-first (the vital renders a middot until the aggregate lands).
10. **Old greeting copy leak** - the as-built client greeting reads "{orgName} (Tahi Studio workspace)", internal framing on a client surface; the redesign copy (`Kia ora, {first}` + org name) replaces it.
11. **Onboarding checklist dismissal is device-local** (localStorage), so it reappears on a new device; acceptable for v1, note for the portal-readiness arc.
