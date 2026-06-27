# Home / Overview - design brief

> The role-aware landing every user sees daily, and where onboarding routes on
> finish (/overview). Three homes from one route: the owner's studio cockpit, the
> teammate's "my work" desk, and the client's calm project home. Numbers are the
> hero; the page answers "what do I do next" before anything else.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

`app/(dashboard)/overview/page.tsx` is a server component: it computes `isAdmin = orgId === NEXT_PUBLIC_TAHI_ORG_ID`, fetches the Clerk name + org name, and branches **two ways only** - admin renders `<OverviewSwitcher>`, everyone else renders `<ClientOverview>`. There is no distinct teammate home; a teammate gets the admin layout filtered by permissions.

- **AdminOverview** (`overview-content.tsx`, the realized Studio Ledger, canonical) - one fetch to `/api/admin/overview`, a permission-gated bento:
  - `components/tahi/overview/ledger-masthead.tsx` - the hero: eyebrow ("Kia ora, {first}" + AKL/local clocks + a workshop-light timer dot + a New menu), **MRR** as a forest gradient leaf-radius block with CountUp (the one big number), then vitals (cash/runway, owed/aged micro-bar, clients, open) as hairline-separated figures, each permission-filtered, then a hairline and the **Studio Note** (one signed sentence a day: "While you slept: ..." + one next-action link).
  - `needs-you.tsx` - the act-now queue, hard-capped at 3 rows, one verb each, owning the page's single border-trace; sources are off-track engagements, the next call, and the oldest overdue invoice. Healthy state: "All quiet in the studio."
  - `the-wire.tsx` - a live activity feed (`/api/admin/overview/wire`).
  - Gated zones (`<Gate>`-wrapped, regrid when hidden): Growth, Work (worklog + today rail), Ahead (pipeline, capacity, hot leads, proposals), Clients (retainer health, contracts), Books (take-home, cash runway, cash-flow ribbon, receivables). Plus a time tracker, world clock, getting-started (0 clients), nothing-enabled card.
  - `/api/admin/overview/route.ts` returns one permission-aware payload (omits `mrr`/`outstanding` when denied): kpis, recentRequests, monthlyRevenue, cash, arAging, overnight, activeTimer, openByStatus. Every aggregate is try/caught and degrades to null, never 500s. Helpers in `lib/overview-aggregates.ts`. The canonical design thesis is `SPECS/homepage-studio-ledger.md`.
- **ClientOverview** (`overview-content.tsx`, the OLD pre-ledger surface, the redesign gap) - fetches `/api/portal/requests?status=active`; a plain greeting + New Request leaf button; three `StatCard` tiles (Open, Awaiting Review, and **Invoices Due hardcoded "--"**); `TrackCapacityCard` (`/api/portal/capacity`: plan, slot occupancy, queue, upsells); an in-review banner; `OnboardingChecklist`; schedule/booking widgets; review-outreach banner; a 6-row request list. Card-heavy; does **not** follow Studio Ledger.
- **Rich data already available but unsurfaced:** retainer health, financial health, utilization, response time, capacity, cash-flow forecast, invoice aging, off-track engagements (all exposed via existing routes / MCP tools).

So: the owner home is done and is the reference; the teammate home does not exist as a distinct surface; the client home exists but predates Studio Ledger and shows a fake number.

## Page purpose

In one glance, tell each person where things stand and what to do next. Owner: is the studio healthy and what needs me. Teammate: what is mine and due. Client: where is my work and what needs my attention. Reassurance for the client, signal for the team, control for the owner.

## Personas and jobs-to-be-done

- **Owner (super_admin).** "Is the studio healthy (money, delivery, pipeline) and what needs me today." Wants density-via-stacking, not bald minimalism. Largely built.
- **Teammate (team_member).** "What do I do next." My open requests/tasks, my calls today, my running timer, my utilization, not studio-wide money. The biggest new design in this spec.
- **Client.** "Where is my work, what is awaiting me, when is my next delivery, what do I owe." Calm, reassuring, one clear next action. Needs a Studio Ledger redesign.

## What others do (and what we take)

- **Linear** - Home / My Issues / Inbox: a personal "assigned to me" + a triage inbox above team-wide. The model for the teammate home.
- **Stripe Home** - answers "money in / pending / on the way" instantly; surfaces blocking items (disputes, verifications) at the top. We mirror this with the owner masthead + NeedsYou.
- **Vercel** - the overview highlights the two things that matter (prod + preview) and what teammates are working on: relevance over completeness.
- **Height / Productive / Teamwork** (agency PM) - "My Work" / Today views, workload and utilization visualization (who is overloaded / free), approvals + time front and center. Direct input to the teammate home.
- **ManyRequests / Designjoy** (client portals) - clean, white-labeled: submit / track / approve, active-request limit + queue position, deliverables, glanceable progress, minimal chrome. The client home target.
- **Timeless ideas** - one hero metric per audience; a next-actions queue above the fold; recency (what changed since I last looked); glanceability over density; progressive disclosure; honest empty/first-run states.

## Experience principles

1. **One hero figure per home.** Owner = MRR; teammate = my open work count (or my utilization); client = awaiting-your-review (or open requests). Rendered large and bare, Studio Ledger style.
2. **Next action before analysis.** A "needs you" queue (max ~3) sits above the descriptive zones on every home.
3. **Relevance over completeness.** Show the few things that matter to this person now; everything else is a click away.
4. **Scarcity is load-bearing.** Exactly one border-trace (NeedsYou), one CountUp (the hero), the leaf radius rare, status colours only when literally true. Breaking these breaks the aesthetic.
5. **Never fake a number.** Every figure is real or absent; aggregates degrade to null, never to a placeholder or a 500.

## The three homes

### Owner home (keep + extend)
Lock the realized Studio Ledger as the reference: masthead (MRR hero + vitals + Studio Note), NeedsYou (the one trace), TheWire, and the gated zones (Work / Ahead / Books / Clients / Growth). Extend only by surfacing already-available signals where a zone is thin (utilization, response time) following the same fallback-first pattern. Do not rebuild.

### Teammate home (new)
Its own identity, not filtered-admin:
- **Personal masthead:** "Kia ora, {first}" + clocks; hero = my open work count (or my utilization figure); vitals = my overdue, due today, my running timer, my replies awaited. No studio MRR or cash.
- **NeedsYou (personal):** assigned to me and due/overdue, my next call today, requests awaiting my reply. Same 3-row, one-verb pattern.
- **My work:** my requests and tasks worklog + a today rail; grouped by due.
- **Only the money/pipeline zones the role actually has** (via `<Gate>`), never the studio framing.

### Client home (redesign to Studio Ledger)
Port the existing portal data into the ledger language:
- **Hero vital line:** open requests, **awaiting your review** as the loud one, next delivery date.
- **NeedsYou (client):** "X awaiting your review" -> approve; a pending invoice; an onboarding step for first run.
- **TrackCapacityCard** as the signature: plan + slot occupancy + queue position (the productized-service "one active, next in queue" signal).
- Requests worklog (recent), invoices due (wire **real** data, retire the "--"), book-a-call, onboarding checklist on first run, review-outreach when relevant. Calm, reassuring, one accent.

## Component spec, motion, accessibility

- Reuse the masthead / vital / NeedsYou / zone primitives from `components/tahi/overview/*`; the teammate and client homes are new compositions of the same parts, not new widget kits.
- Permission-gated regrid: vitals and zones repack with no holes when a feature is denied (the existing dense-grid + col-span-swap pattern). Any new card follows it.
- Motion: CountUp on the single hero; calm fades; the one border-trace on NeedsYou; reduced-motion disables all of it.
- Accessibility: figures have accessible labels (not just big type); `data-private` on client-identifying text for private mode; AA contrast in light and dark; 44px targets on mobile.

## States and flows

- First run (0 clients owner / first-login client onboarding checklist / new teammate with no assignments) each get a real getting-started state, never an empty grid.
- Healthy NeedsYou ("All quiet" / "You are all caught up").
- Feature-denied zones absent (regrid), not empty.
- Loading: masthead and shell paint immediately; each zone shows its own skeleton; any failed aggregate renders null, never an error.
- Impersonation routes correctly through `OverviewSwitcher` (client and team-member lenses).

## Copy deck

- Owner Studio Note: "While you slept: ..." + one next action + "Noted 7:14am".
- Teammate hero label: "Your open work". NeedsYou: "Assigned to you, due today".
- Client hero label: "Awaiting your review". NeedsYou: "3 deliveries need your sign-off".
- Empty: owner "All quiet in the studio."; client "Nothing needs you right now."; teammate "You are all caught up."

## Tokens and visual reference

- Hero metric in the brand forest gradient leaf block (owner MRR pattern), reused per audience. Vitals are hairline-separated tabular figures. Cream canvas. Status colours only to signal. Leaf radius on the hero block + primary CTA only.

## Deliverables for Claude design

1. **Owner home - desktop** (reference, lightly extended).
2. **Teammate home - desktop** (new: personal masthead + personal NeedsYou + my work).
3. **Client home - desktop** (Studio Ledger redesign with TrackCapacity as signature, real invoices-due).
4. **Mobile** of teammate and client homes (375px).
5. **First-run** states for all three.
6. **Dark mode** of all three.
7. **State sheet:** healthy NeedsYou, denied-zone regrid, loading skeletons, private mode on client text.

**Integration constraints:**
- Reuse `components/tahi/overview/*` primitives and the fallback-first aggregate pattern in `route.ts`; new metrics (utilization, response time) must try/catch per aggregate and never 500.
- The teammate home must route through `OverviewSwitcher` and honor `resolveAccessScoping`.
- Wire a real portal endpoint for client invoices-due; do not ship the "--" placeholder.
- Tokens only (dark mode), `data-private` on client-identifying text, preserve the scarcity rules.

## Why this is premium

Most products ship one dashboard and hope it fits everyone, so the client feels like they wandered into an ops tool and the junior teammate drowns in studio finance they cannot act on. Three purpose-built homes from one route fix that: the owner gets a quiet instrument panel where the one number that matters glows and exactly what needs them is named; the teammate gets a calm desk that says "here is your next thing"; the client gets reassurance and a single clear action. The restraint, one hero figure, one action queue, real numbers only, is the editorial confidence a template never commits to.

## Open decisions and risks

1. **Teammate home is undefined today** (code only branches admin/client). The "filtered admin" stopgap leaks studio framing (money labels) to staff. This spec's main decision: build a distinct personal home. Confirm before building.
2. **Client "Invoices Due" is a hardcoded "--"** - needs a real portal endpoint; never ship a fake figure.
3. **Scarcity rules are load-bearing** (one trace, one CountUp, rare leaf, status colour only when true). New cards must not break them.
4. **Permission-gated regrid** must leave no holes when features are denied.
5. **Fallback-first data** - every aggregate degrades to null; new metrics follow the per-aggregate try/catch.
