# Onboarding flow - design brief

> Research-backed brief for Claude design. Prepend `_studio-ledger-theme.md` when prompting.
> Page 02 in `SPECS/redesign/`, the sequel to `01-auth.md`. Same structure, same Studio Ledger theme.
> Generated 2026-06-27 from a 6-lens research + synthesis pass (activation, payment, team setup, conditional branching, personas, accessibility).

## Page purpose

Onboarding is the bridge between two states: "account created" (the moment Clerk finishes sign-up + email verification on `01-auth.md`) and "running the project" (the live client portal). It is not auth and it is not the dashboard. It is the short, gated, conditional sequence in between, and it does two jobs at once: real setup work (org, payment, contacts, assets) and the first lived proof of the brand promise.

It spans two surfaces, one language:

- **The onboarding scene** reuses the auth `AuthShell` scene language: the dark forest panel left, the floating white card right. Steps 1 to 6 live here. This is where the single hard gate (payment, for pay-now clients) sits, and it is the only part a pay-now client cannot skip past.
- **The in-portal first-run checklist** lives on the cream dashboard canvas (`--color-bg-cream` `#F7F6F3`). Everything the scene deferred finishes here, resumable across sessions, as a dismissible card on the overview.

Routing context. After verification, Clerk has a `userId` and (for invited teammates) an `orgId`. Onboarding reads the org's **billing mode** (`pay_now` / `invoiced` / `external`) and **engagement type** (`project` vs `retainer`, mirrored onto the org from `requests.engagementType` / the chosen plan) to decide which steps render. Admin org (`NEXT_PUBLIC_TAHI_ORG_ID`) never sees this flow; Tahi team members go straight to the admin dashboard.

How it differs from auth. Auth is a single shell doing one job (authenticate + route) for four personas who all see the same screen. Onboarding is **one spine that branches**: the same scene shows a 6-step journey to a self-serve pay-now redesign client and a 3-step journey to an external maintenance client, and lands a teammate in the portal almost immediately. Auth sells while it gates the door; onboarding sets up while it gates only the money.

What we own vs what Clerk and Stripe own:

- **Our code:** the scene shell (reused `AuthShell`), the step shell + progress rail, plan cards, the set-amount and invoiced panels, the file-upload UI, the capture forms, the teammate-invite rows, and the in-portal checklist card.
- **Clerk owns:** org creation, org naming/metadata, teammate invitations, and roles (`admin` / `member`). We render the chrome; Clerk does the org primitives via its SDK.
- **Stripe owns:** the actual payment surface (Payment Element), subscriptions for retainers, one-off PaymentIntents for set amounts, and the customer portal. Existing endpoints: `/api/portal/billing/session`, `/api/admin/integrations/stripe/provision`. We theme the Element and own the card it sits inside.
- **Existing portal APIs to build on:** `/api/portal/onboarding`, `/api/portal/profile`, `/api/portal/billing/session`, `/api/portal/subscription`. Schema: `organisations` (has `onboardingState`, `onboardingLoomUrl`, `healthStatus`), `subscriptions`, `tracks`, `projects`, `contacts`.

## Why we are here

The functional goal is to provision an org, take payment where due, and capture the minimum needed to start. The emotional goal is the entire point, exactly as it was for auth.

A brand-new client is often onboarding minutes after committing up to NZD 100,000, frequently to people they have mostly met through a website and a proposal. They arrive in the high of committing, shadowed by the quiet "did I just do the right thing?" The brand sells "no gaps, everything in one place, a real partner." Onboarding is the first five minutes where that is either made true or revealed as a claim. A redundant field, a payment screen that bounces them to a stranger's domain, an empty room on the other side of the gate: each is a hairline crack in a six-figure promise.

Continuity is a feature. The white card they signed up on is the same object that now carries them through setup. The forest panel is the same world. Nothing about the visual language resets between auth and onboarding, so the experience reads as one continuous arrival, not three apps stapled together. The reward for finishing is the surface itself changing: the white card lifts, the canvas warms to cream, and they are in. The visual change is the payoff.

**The single experiential throughline, which every element must serve or be cut:**

> You are in good hands, and you are already moving.

Every path, every screen, compounds one feeling: the gaps are already closed. The system knows them, asks only what it must, never asks twice, takes the money cleanly where money is due and never mentions it where it is not, and hands them a room that is already furnished. If a NZD 100k client exhales and feels expected, the flow worked. Premium here is competence felt as calm, never announced.

## Personas and paths

Four actors. Billing mode and Clerk membership decide which one a given arrival is.

**1. Self-serve new client, `pay_now`.** Signed up via an invite link, no invoice exists yet, must pay before reaching the portal.
- *Mindset:* excited but exposed. They just put real money on the line. The dominant feeling is "prove this was smart," sharpest the instant the card field appears.
- *JTBD:* "Help me commit with confidence. Show me what I am buying, take my payment without friction, and let me start."
- *Must see / feel:* the plan or price laid out plainly (what is included, what it costs, when they are charged); a payment step that looks as considered as the rest of the brand, never a redirect; a clear sense of what is on the other side *before* they pay; one human signal (their lead's name and face). The pay gate must read as a handshake, not a tollbooth.

**2. Team-created client, `invoiced`.** Tahi sold the engagement, set up the org, and already sent an invoice (Stripe or Xero). Onboarding must never charge again.
- *Mindset:* already decided. The hard yes happened in the sales conversation. They want to feel expected and to stop re-explaining. Their fear is the opposite of persona 1: not "is this worth it" but "did the handoff drop me."
- *JTBD:* "Recognise me. Skip me past anything already handled. Let me do the useful setup and get on with it."
- *Must see / feel:* their company name and details already in place; zero payment ask, at most a calm invoice-status line with an optional pay link; setup that feels like real work (assets, contacts, brief), not a form. Every redundant field says the handoff failed.

**3. External / comp client.** Money handled entirely offline (Xero reconciliation, comp, partner deal). No payment UI at all.
- *Mindset:* calm, often a known relationship or a favour. Expects warmth, not process. Any payment screen would confuse or faintly insult.
- *JTBD:* "Welcome me and let me set up. Do not make me think about billing, I am sorted."
- *Must see / feel:* pure welcome, no price, no plan, no pay link, no mention of money; straight into setup; the same premium feel as every other path. Comped does not mean lesser. This path is defined by what it removes.

**4. Invited teammate.** Joining a Clerk org someone else created and paid for. Colleague, not buyer.
- *Mindset:* practical, slightly out of context. They were added, they did not decide. They want in and out fast.
- *JTBD:* "Confirm who I am, drop me into the workspace my colleague set up."
- *Must see / feel:* instant context (which company, who invited them, what this is); the shortest path, profile basics and timezone at most; a workspace that is already furnished when they land. They must never see plan selection or a payment screen.

The tension to resolve: persona 1 needs reassurance the purchase was right; persona 2 needs recognition that they are known; persona 3 needs money to vanish; persona 4 needs speed. **The call:** one spine that subtracts steps and swaps the gate's contents per path, with an honest progress count so no path ever feels like a stripped-down version of another. Each client sees a journey correctly sized for them, never a generic 6-step rail with mysterious skips.

## Experience principles

1. **One spine, two toggles.** Billing mode and engagement type are independent axes. Billing mode decides whether a payment gate appears and what it contains; engagement type decides which capture steps appear. They never fork the layout, the chrome, the progress rail, or the voice. Model it as one of each step with conditional slots, never as four separate flows that will drift. *(This is the structural payoff of "no gaps, one.")*
2. **Gate only the irreversible decision.** Payment is the single hard gate, and only for `pay_now`. Everything else (company info, brand assets, brief, teammate invites, legal details) is finishable inside the portal via the first-run checklist. Deferred steps survive drop-off instead of blocking entry; a hybrid wizard-plus-checklist out-completes a long linear wizard.
3. **Ask the minimum at the gate.** Each extra field at the gate costs completion; progressive profiling recovers it. Confirm prefilled org and contact now, push brand assets, legal, and the full brief to the checklist. The scene length must visibly differ between a lean retainer and a full design engagement.
4. **Honest progress.** Compute the real step count up front from the two toggles, before step 1 paints. An external maintenance client might see "Step 2 of 3"; a pay-now redesign sees "Step 2 of 6." No phantom steps, no "skipped 3" jumps. This single rule does more than anything to make divergent paths feel like one coherent journey.
5. **Studio Ledger, continued.** The scene is the same dark forest world and floating white card from auth. Brand-green is the only accent. The leaf radius is reserved for one signature moment per scene (the recommended plan card, or the final "enter your studio" CTA). Hairlines over heavy cards. Whitespace does the work.
6. **Recognise, never re-ask.** Prefill aggressively from Clerk identity, email domain, browser timezone, and what the team already entered. For team-created clients, every known field is confirm-only, never a blank input. Re-collecting data we already hold is the exact gap the brand sells against.
7. **Skip without guilt.** Optional fields carry a calm, visible "Add later in your portal" link in `--color-text-subtle`, never a hunted-for muted control. The framing is *relocated, not abandoned*: the first-run checklist shows precisely what was deferred, so skipping visibly moves the task rather than dropping it.

## The onboarding model

The model is **one spine plus two independent toggles**.

```
  Welcome  →  [Payment gate, conditional]  →  Org setup  →  [Capture, conditional]  →  Invite team  →  Land in portal
   marketing      HARD GATE (pay_now only)     shared          tiered + skippable        shared           soft checklist
```

**Toggle 1, billing mode** (read off `organisations`, set per-org at creation, never shown as a word to the client):
- `pay_now` -> a payment step renders and is a hard gate. Self-serve sign-ups default to this.
- `invoiced` -> a payment step renders as an informational status line, advance is *not* blocked.
- `external` -> the payment step does not render at all, and money is never mentioned.

**Toggle 2, engagement type** (derived, mirrored onto the org):
- `retainer` (plan `maintain` / `scale`) -> capture is thin: confirm contact, optional current-site URL, invite team. No brand-asset step.
- `project` (one-off build / redesign / set amount) -> capture surfaces brand assets (promoted but still deferrable), a brief, and key links.

**Field tiering** resolves against both toggles:

| Field | Tier | Project (build / redesign) | Retainer (maintain / scale) | In-scene? |
|---|---|---|---|---|
| Company name | Critical | required | required | Yes (step 2); prefilled, confirm-only for team-created |
| Primary contact + role | Critical | required, prefilled from Clerk | required, prefilled from Clerk | Yes, one confirm tap |
| Timezone | Optional | auto-detect, editable | auto-detect, editable | Yes, prefilled |
| Brand assets (logo, colours, guidelines) | Conditional | promoted to important, still deferrable | hidden | No (checklist) |
| Project brief / goals | Conditional | light "what are we building" line in-scene, full in checklist | optional | Partial |
| Key links (current site, references) | Conditional | repeatable URL rows | current-site only, optional | Partial |
| Billing / legal (legal entity, address, GST, PO) | Conditional on billing mode | only if needed for the tax invoice | only if needed | No (checklist) unless invoice requires it |

Rules:
- **Critical** = the flow cannot advance, no skip affordance exists, inline validation only.
- **Optional** = a visible "Add later in your portal" link, a first-class action.
- **Conditional-on-engagement-type** = the field's *tier is promoted* by the branch (brand assets are hidden for a retainer, important-but-deferrable for a redesign). Even when promoted, brand assets stay deferrable: a redesign client without their logo to hand at 11pm should still reach the portal.

**The gating rule, stated once:** there is exactly one hard gate, the `pay_now` payment, enforced server-side on portal entry against subscription / PaymentIntent status (never a client flag). Org name and primary contact are collected in-flow because they are trivial and Critical. Everything else is soft and lives on the first-run checklist.

**Decision table (mode x engagement -> steps shown):**

| Billing mode | Engagement | Steps in the scene | Hard gate? |
|---|---|---|---|
| `pay_now` | retainer | Welcome, Plan select, Payment, Confirm company, Your details, (Invite team) | Yes, at Payment |
| `pay_now` | project (plan-priced) | Welcome, Plan/scope, Payment, Name company, Your details, About the work, Invite team | Yes, at Payment |
| `pay_now` | project (set amount) | Welcome, Confirm scope + amount, Payment, Name company, Your details, About the work, Invite team | Yes, at Payment |
| `invoiced` | retainer | Welcome, Invoice status (info), Confirm company, Your details, (Invite team) | No |
| `invoiced` | project | Welcome, Invoice status (info), Confirm company, Your details, About the work, Invite team | No |
| `external` | retainer | Welcome, Confirm company, Your details, (Invite team) | No |
| `external` | project | Welcome, Confirm company, Your details, About the work, Invite team | No |
| any | invited teammate | Welcome/orient, confirm profile + timezone -> portal | No (never sees payment or org setup) |

## The steps and why

Every step in canonical order. Each notes capture, required / optional / conditional, and which paths collapse or skip it.

**Step 1 - Welcome (all paths, marketing mode).** One editorial line on the dark panel, the client's name and company prefilled where known. One CTA: "Let's set things up." Computes the real rail length now from the two toggles. *Conditional sub-case:* if a self-serve client's engagement is genuinely ambiguous (no plan implied), a single two-option segmented control appears here ("A new build or redesign" / "Ongoing work on something live") to set engagement type in one tap. This is the only path that ever sees this question; team-created clients and self-serve plan-choosers derive it silently. *Why:* sets a calm, short tone and signals this will not take long.

**Step 2 - Payment gate (conditional on billing mode).** Position is constant; contents swap.
- `pay_now` plan: plan cards (`maintain` / `scale`) then the Stripe Payment Element. Hard gate.
- `pay_now` set amount: a single confirm-and-pay card stating the line item and figure, then the Element. Hard gate.
- `invoiced`: a calm status row ("Invoice 1042 is with you. Due in 14 days."), optional pay link, advance allowed.
- `external`: step omitted entirely; the rail is one shorter and says so from step 1.
*Why this is the only hard gate:* gating the commercial commitment protects revenue at the moment they committed up to NZD 100k; gating anything else taxes a client who has already paid.

**Step 3 - Name / confirm company (all paths, functional).** Creates or confirms the Clerk org.
- Self-serve: one editable field, prefilled from the email domain as a guess. Client names it. Critical.
- Team-created: org already named, shown as a one-tap "Confirm [Company]" with a quiet edit affordance. Never make a paying client re-type what the team entered.
A URL slug is derived silently and never shown.

**Step 4 - Your details (all paths, functional).** Primary contact name + role (Critical, prefilled from Clerk identity, one confirm tap) and timezone (Optional, auto-detected from the browser, editable). *Why:* contact and timezone are how Tahi knows who to talk to and when; both are near-free to confirm.

**Step 5 - About the work (conditional on engagement type).** Renders for `project` only.
- Brand assets (logo, colours, guidelines): promoted but deferrable, three named slots (see Component spec). "Add later in your portal" always present.
- Project brief: a light "what are we building" textarea in-scene, full version in the checklist.
- Key links: repeatable URL rows (current site, references).
For `retainer`, this collapses to at most an optional current-site URL, or is skipped entirely. *Why:* a maintenance retainer does not need brand guidelines; asking signals you do not know who they are.

**Step 6 - Invite teammates (all paths, optional, functional).** Email + role rows via Clerk org invitations. "Do this later" always present, mirrored to the checklist. *Why:* account-level activation (more than the first user) correlates with materially higher retention, so invites belong in the core flow, but never as a gate.

**Plan selection (sub-step of Step 2, `pay_now` only).** Two plan cards, recommended one marked, benefit-led copy. Plan choice doubles as the engagement-type signal. Collapses to a single confirm card for a pre-set amount; does not render for `invoiced` / `external`.

**Finish / first action (all paths).** The white card lifts, the canvas warms to cream, and the client lands on the overview with the first-run checklist card. *Proposed default (flagged):* pre-seed a first request / project drafted from the engagement type as the top checklist item, editable not mandatory, so the portal is never an empty room.

Per-path collapse summary: `external` drops Step 2 and (for retainer) Step 5; `invoiced` turns Step 2 into a status line; `retainer` thins or drops Step 5; the invited teammate skips Steps 2, 3, 5, 6 entirely and confirms only profile + timezone.

## Flow

End to end, from verification to first action. Entry is always the completion of `01-auth.md` (account created + email verified).

```
                         Clerk: account created + email verified
                                          │
                                          ▼
                          Read org billing mode + engagement type
                                          │
        ┌─────────────────┬───────────────┼────────────────┬──────────────────┐
        ▼                 ▼               ▼                 ▼                  ▼
  SELF-SERVE         TEAM-CREATED      EXTERNAL /        INVITED            (admin org →
  pay_now            invoiced          comp              teammate            admin dash,
        │                 │               │                 │                no onboarding)
        ▼                 ▼               ▼                 ▼
  1 Welcome          1 Welcome        1 Welcome        1 Orient
  2 Plan/scope       2 Invoice        3 Confirm org    confirm profile
  3 Pay  ◄HARD GATE    status (info)  4 Your details   + timezone
  4 Name org         3 Confirm org    5 About work*         │
  5 Your details     4 Your details   6 Invite team        ▼
  6 About work*      5 About work*        │            PORTAL (already
  7 Invite team      6 Invite team        │             furnished)
        │                 │               │
        └─────────────────┴───────────────┴────────► CROSS TO CREAM
                                          │
                                          ▼
                        PORTAL OVERVIEW + first-run checklist
                        (deferred items: brand assets, brief,
                         legal, invites, + seeded first request)
                                          │
                                          ▼
                              FIRST ACTION (submit / edit
                              the seeded request)

  * "About work" renders for project engagements only; thin or omitted for retainers.
```

Explicit differences between the three money paths:
- **`pay_now`** is the only path where a client can be stopped. They cannot see the dashboard until Stripe confirms. Plan or set-amount, then the Element, then the cross to cream.
- **`invoiced`** never charges and never blocks. The payment slot is a receipt-like status line with an optional Stripe/Xero pay link. They flow straight through to org confirmation and capture, because chasing payment is the team's job in Xero, not a wall in front of a committed client.
- **`external`** has no payment slot at all. No price, no plan, no pay link, no mention of money anywhere in the scene. Org confirmation -> capture -> portal.

Resume behaviour (all paths): progress persists server-side on `organisations.onboardingState`. A returning client lands on the next incomplete step with prior answers prefilled, never a blank restart. A pay-now client who dropped before paying returns to the gate; one who paid but deferred the rest returns to the portal with the checklist waiting.

## Layout and composition

The decision: **a full-screen wizard reusing the Studio Ledger `AuthShell` scene for the gated pre-entry part (Steps 1 to 6), and the in-portal first-run checklist on the cream dashboard canvas for everything deferred.** The justification: the scene owns only the irreversible gate and the org, where continuity from auth and a contained, distraction-free frame matter most; the checklist owns the resumable rest, where the client benefits from being inside the real product with their files to hand. The handoff between the two is the reward moment.

**Desktop scene (Steps 1 to 6), reusing the auth split:**
- Two-column split on the cream canvas, panel 58% / card column 42% at `>=1024px`, card capped at `480px` (wider for the plan-select and payment steps, see below), card overlaps the seam by `-32px`.
- Page background `--color-bg-cream` `#F7F6F3`. Card background pinned `#ffffff`, `--radius-leaf-lg`, soft low-spread shadow `0 24px 48px -24px rgba(26,25,20,0.18)`.
- **Panel content evolves per step** as a quiet ledger / progress motif: the steps rendered as ruled lines, the current one lit. `--color-text-on-dark` `#FDFDFC` and `--color-text-dim-on-dark` `#DCE8D9` only. The same forest scene from auth: the animated neon-leaf motif (the brand leaf drawn as a glowing, pointer-reactive line over a soft green bloom) plus static grain. No stock imagery.
- **Card content is the step.** A slim stepper at the card top ("Step 2 of 5", brand-green active node), the step heading (`<h1>`), the step body, then Back / Next in the footer (Back precedes Next in DOM and tab order).
- Plan-select and payment steps may widen the card to `~560px` to fit two plan cards side by side and the Payment Element comfortably.

**Mobile scene (375px reference):** do not stack the full panel. Collapse to a compact forest band (~`280px` tall: wordmark, a one-line "Setting up [Company]", the stepper) above a full-width card (minus `16px` gutters, overlapping `-24px`, `24px` padding). Steps are single-column. Plan cards stack vertically. The Payment Element is full-width. Touch targets `>=44px`, inputs `>=48px` / `16px` font.

**Text wireframe - plan selection (desktop, `pay_now` retainer):**
```
+----------------------------------------------------------+ cream
| FOREST PANEL (58%)                |  CARD (~560px)        |
| Tahi                              | Step 2 of 5  ●─○─○─○─○|
| ── Welcome           (done ✓)     | Choose how we'll      |
| ── Your plan         (active)     |  work together        |
| ── Payment                        | You can change this   |
| ── Your details                   |  anytime.             |
| ── Invite your team               |                       |
|                                   | +---------+ +--------+|
| "Pick the pace that fits.         | | Maintain| | Scale  ||  ◄ leaf radius
|  Change it anytime."              | | NZD ... | | NZD ...|     on recommended
|                                   | | + list  | |Recommended  card only
| (o) Aroha will be your lead.      | | (o)radio| | (●)radio|
|                                   | +---------+ +--------+|
|                                   | [ Continue ]          |
+----------------------------------------------------------+
```

**Text wireframe - payment (desktop, set amount):**
```
| Step 3 of 7   ●─●─○─○─○─○─○                              |
| One step to open your studio.                            |
|                                                          |
|  Project deposit (50% of NZD 80,000)        NZD 40,000   |
|  GST (15%)                                    NZD 6,000   |
|  ─────────────────────────────────────────────────────  |
|  Total due now                              NZD 46,000   |
|                                                          |
|  [ Stripe Payment Element, themed to tokens          ]   |
|  [ card number / expiry / cvc                        ]   |
|                                                          |
|  [ Pay NZD 46,000 ]            ◄ brand-dark fill         |
|  Secured by Stripe.                                      |
|  Prefer a bank transfer? We'll sort it.                  |
```

**Text wireframe - a conditional capture step (About the work, project):**
```
| Step 6 of 7   ●─●─●─●─●─○─○                              |
| About the work                                          |
|                                                          |
|  Your logo            [ drop or browse ]  Add later →    |
|  Brand colours        [ #______ ] [ + ]   Add later →    |
|  Brand guidelines     [ link or file ]    Add later →    |
|  ─────────────────────────────────────────────────────  |
|  What are we building?                                   |
|  [ textarea, optional                              ]     |
|  Key links            [ https://current-site   ] [ + ]   |
|                                                          |
|  [ Continue ]      Add the rest later in your portal →   |
```

**Text wireframe - in-portal first-run checklist (cream canvas):**
```
+----------------------------------------------------------+ cream #F7F6F3
|  You're in. Here's what's next.            3 of 6 done   |
|  +----------------------------------------------------+  |
|  | ✓  Your workspace is set up                        |  |
|  | ✓  Primary contact confirmed                       |  |
|  | ✓  Payment received                                |  |
|  | ○  Add your brand kit        why: so we design in  |  |
|  |    your colours from day one        [ Add → ]      |  |
|  | ○  Tell us what we're building      [ Start → ]    |  | ◄ seeded first request
|  | ○  Invite your team                 [ Invite → ]   |  |
|  +----------------------------------------------------+  |
|                                        [ Collapse ]      |
+----------------------------------------------------------+
```
The checklist is a card, not a modal. Collapsed, it becomes a small progress pill ("3 of 6") on the overview. It persists until complete, then celebrates subtly and offers dismissal.

## Component spec

Component by component. Tokens are the real codebase variables. States listed where they matter.

**Step shell + progress rail** (our code)
- Purpose: hold one step, show honest position.
- Rail: a thin horizontal stepper, nodes joined by a 1px `--color-border-strong` line, active node filled `--color-brand` `#5A824E`, completed nodes a check glyph in `--color-brand`, upcoming nodes hollow. Labelled "Step X of Y" as real text (not colour alone). `role="group"` `aria-label="Step 2 of 5"`; active node `aria-current="step"`.
- Step heading: `<h1>` per step, unique, focus moved to it on every transition.
- Footer: Back (secondary, hairline border, `--radius-md`) then Next (primary). DOM and tab order match visual order.

**Plan cards** (our code)
- Purpose: the retainer choice, `maintain` / `scale`.
- Semantics: a true radio group, `role="radiogroup"` with label "Choose your plan", each card `role="radio"` (or native `<input type=radio>` styled as a card) with `aria-checked`. Arrow keys move, Space/Enter selects, single tab stop.
- Tokens: card fill `#ffffff`, 1px `--color-border-strong` border, `--radius-lg` `.75rem` for the standard card; the **recommended** card uses `--radius-leaf-lg` (the one signature moment), a 1px `--color-brand-light` `#7aab6b` border, and a small "Recommended" pill (`--color-brand-50` `#f0f7ee` fill, `--color-brand-dark` text). Selected state adds a 2px `--color-brand` ring + a check glyph + "Selected" text (more than colour).
- Content order: outcome line, then price (NZD, tabular figures, GST note adjacent), then a 3-to-5 item tick list. Price and inclusions are in each radio's accessible name.
- Prices and tiers live in `SPECS/billing-tiers.md` and the Services and Pricing docs page. Do not invent figures. `maintain` and `scale` are the plan names; billing cycle options (monthly / quarterly / annual with bundled extras) come from that spec.

**Stripe payment surface** (Stripe owns the fields, we own the card and theme)
- **Decision: use the embedded Payment Element, not hosted Checkout.** A client who just committed six figures must never be bounced to `checkout.stripe.com` and back; that context switch breaks the Studio Ledger scene and cheapens the moment. The Element renders inside our floating white card, so payment is one continuous step.
- Drive it with a Subscription (retainer, confirm the first invoice's PaymentIntent) or a one-off PaymentIntent (set amount). Same component, different server setup via `/api/portal/billing/session`.
- Theme via the Appearance API mapped to tokens: primary `--color-brand-dark` `#425F39`, input border `--color-border-strong` `rgba(26,25,20,0.16)`, font Manrope, field radius `--radius-md` `.5rem`. Leaf radius stays *off* the fields; it appears on the confirm button and success state only.
- Do not use the Stripe Pricing Table (cannot be fully themed). Build our own plan cards and feed the chosen price in.
- States: default; processing (`aria-disabled` + spinner + "Processing payment, do not close this page" in a live region, button not removed from DOM); inline decline (calm specific copy, form retains input); success (slow brand-green state, then cross to cream).

**Set-amount payment panel** (our code wrapper, Stripe Element inside)
- Purpose: confirm a pre-configured one-off price / deposit from a proposal.
- A line-item summary (label, amount, GST line, total), amount pulled server-side from the org record (never the client), then the Element and a single "Pay NZD X" CTA. Labelled as deposit / milestone / full fee.

**Invoiced-state panel** (our code)
- Purpose: show invoice status, never a payment form, never double charge.
- A calm status row: invoice number, sent date, due date, status pill (`--color-info` for sent, `--color-success` for paid). An optional "Pay now" link to the Stripe/Xero hosted invoice page, off the critical path. Reconcile status from the source of truth (Xero if the invoice lives there). Advance is not blocked. Announced as content ("Invoice sent, no action needed"), never an empty void.

**File upload (brand assets)** (our code, R2 via existing upload endpoints)
- Purpose: capture logo, colours, guidelines for project engagements; hidden for retainers.
- Three named slots, not one dump:
  - Logo: real `<input type=file>` with a visible keyboard-operable "Upload logo" button (drag-drop is enhancement only), accepts `SVG, PNG, PDF, AI, EPS`, previews on a light and a dark swatch.
  - Colours: hex chip inputs *or* a file upload; never force a file.
  - Guidelines: accepts `PDF` and links (Figma / Drive / Notion URL) as first-class.
- States per slot: empty / uploading (`role="progressbar"` or polite "Uploading logo, 60 percent") / uploaded (file name, size, thumbnail, `>=44px` Remove). Format and size limits stated in visible text before upload ("SVG preferred, up to 25MB"); errors via `role="alert"` naming the file and the rule. Partial uploads persist; never lost on tab close. All non-blocking and resumable from the checklist.

**Teammate-invite rows** (our code chrome, Clerk owns the invitation)
- Purpose: add colleagues via Clerk org invitations, optional and skippable.
- A single email input ("Add a colleague's email") with a role selector defaulting to `member`, plus a list of pending invites: each row email, role, "Invited 2 days ago", status pill (Pending / Joined / Expired), and Resend + Revoke actions. Resend is rate-limited and shows "Last sent"; Revoke immediately invalidates the Clerk invitation. "Do this later" always present. Roles default proposal: `admin` (billing + invite + everything) and `member` (collaborate, no billing). See Open items.

**Form fields** (our code)
- Purpose: company name, contact, role, timezone, brief, links, legal.
- Tokens: height `48px`, `16px` text `--color-text`, white fill, 1px `--color-border-strong` border, `--radius-md`, internal padding `12px 14px`. Persistent visible labels in ledger-label style (`--text-xs` weight 600 uppercase `0.08em` tracking `--color-text-subtle`). Focus: 2px `--color-brand` ring + brand border. Error: `--color-danger` `#dc2626` border + icon + text, value retained.
- Autocomplete tokens: company `organization`; contact `name`; email `email`; address `street-address` / `address-level2` / `address-level1` / `postal-code` / `country-name`; GST `off` with a clear label. Timezone is a searchable native select. Country defaults to Aotearoa New Zealand, editable. Legal entity name is a separate field from company display name.

**In-portal checklist card** (our code, on the cream canvas)
- Purpose: catch everything deferred, resumable across sessions.
- Tokens: `#ffffff` surface, 1px `--color-border-strong`, `--radius-lg`, hairline row dividers, on the `--color-bg-cream` canvas. Each row: label, one-line why-it-matters in `--color-text-muted`, status (done = `--color-success` check + recedes / to-do), inline action button. A quiet "3 of 6 done" indicator, never a gamified bar. Ordered by what unblocks Tahi's work first (brand assets before "explore the docs"). Collapses to a small progress pill; persists until complete, then a subtle completion state and a dismiss affordance.

Ownership recap: **Clerk** owns org create, org naming/metadata, invitations, and roles. **Stripe** owns the Payment Element, subscriptions, PaymentIntents, and the customer portal. We own all surrounding chrome and theming.

## Plan selection and payment

The money step in depth.

**Plan cards (`pay_now` retainer).** Two cards, `maintain` and `scale`, side by side, one marked recommended (the recommended card carries the leaf radius, a `--color-brand-light` border, and a quiet "Recommended" pill, not a loud badge). Each card leads with the outcome ("Ongoing design and build, handled."), then the price, then a 3-to-5 item tick list. Currency is explicit NZD and GST handling sits next to the price (GST 15% for NZ clients only, per `billing-tiers.md`). The selected card settles with a slow 200ms ease-out lift and a brand border, then reveals the Payment Element below on the same scrollable step, so plan choice and card entry feel like one short path.

**Monthly / annual.** `billing-tiers.md` defines monthly, quarterly, and annual cycles with bundled extras (no plan discount, value via add-ons). Default to monthly; present longer commitments as a quiet "commit longer, get the SEO dashboard / extra track / priority support included" line, not a prominent toggle war. A loud toggle reads as pressure at a high-stakes moment. **Flag:** confirm whether all three cycles are offered at onboarding or only at launch in settings.

**Set amount.** When the org carries a pre-set figure from a proposal, plan selection is skipped entirely and a single confirmation summary shows the line item, the amount, GST, and the Element. Labelled as what it is (deposit / milestone / full fee). Re-presenting plans would insult the decision they already made. Amount is authoritative server-side.

**Hosted vs embedded.** Embedded Payment Element. Justification in the Component spec: continuity, brand control, no context switch on a six-figure payment.

**Paywall placement and hard-gate behaviour.** The gate sits after Welcome and plan/scope, framed as activation ("One step to open your studio."), not a tollbooth ("Payment required to continue."). A quiet line shows what is waiting ("Your portal, your team, and your first request are ready."). A `pay_now` client can never glimpse the dashboard before Stripe confirms; portal entry is gated server-side on subscription / PaymentIntent status, never a client flag. Everything else is finishable inside, so the gate stays small and specific to money.

**Invoiced path.** Show invoice status, never a payment form. Never gate the portal on payment; invoiced terms mean access on net terms. Offer an optional pay link, never blocking. Reconcile from the source of truth (Xero if the invoice lives there) so we never show "unpaid" on something already paid.

**External / comp path.** Render zero payment UI. No price, pay button, or invoice reference anywhere. Skip the gate logic entirely; treat like a paid client for access. Onboarding is org setup plus conditional capture, full stop.

**Tax / GST + PO.** Capture PO number and tax ID before confirming payment (high-value B2B finance teams need the PO on the receipt), pass to Stripe as PaymentIntent / invoice metadata. GST 15% for NZ clients only, zero-rated elsewhere, calculated at invoice time on the org's country. Displayed price and receipt must agree.

**Receipts.** Send a Tahi-branded receipt (via Resend / React Email, or Stripe's receipt with our logo and brand colour), including PO, GST breakdown, and the legal entity name (not the trading name) for the client's accounts payable. **Flag:** Resend-branded vs Stripe-default is a build-cost call.

**Failure / retry.** Card failures handled inline in the Element with calm specific copy ("Your bank declined this. Try another card or contact them."), input preserved. Expect international card friction on large charges; offer an immediate fallback ("Prefer a bank transfer or invoice? We'll sort it.") routing to the team. For retainer subscriptions, configure Stripe smart retries and a clear past-due banner reachable from the portal billing area, not email-only.

## Company setup and team invites

**Naming / confirming the org.**
- Self-serve: the client names the org (Critical field, Step 3), prefilled from the email domain as a guess (`acme.com` -> "Acme"). One editable input, not a wizard. This creates the Clerk org.
- Team-created: the org arrives pre-named, shown as a settled fact ("We've set up [Company]. Look right?") with a quiet "Not right? Tell us" edit link, not a blank field. Re-asking a paying client to type their own company name reads as a gap.
- Company name is org metadata stored on the Clerk org and the `organisations` row from step one, so every downstream surface (invoices, contracts, messages) reads one source. A slug is derived silently and never surfaced. Legal entity name is captured separately (in the billing / legal tier) from the display name.

**Inviting teammates (Clerk org model).**
- One optional, skippable step, never a gate, mirrored inside the portal checklist. Single email input + role selector.
- Roles, proposed default: `admin` (full access, billing, can invite/remove) and `member` (requests, files, messages; no billing, no invite). New invites default to `member` (least privilege). **Flag:** whether a distinct `billing` role is needed for finance contacts who need invoices but not project access.
- Seats: no hard cap at launch, a soft nudge past ~10. **Flag:** whether retainer plans cap seats. A NZD 100k client hitting a seat wall on day one is a brand insult.
- Pending-invite management: one list with email, role, "Invited 2 days ago", status pill (Pending / Joined / Expired), Resend (rate-limited, shows "Last sent") and Revoke (invalidates the Clerk invitation immediately). Roles editable later from the same member list.
- The accept screen shows inviter + company by name ("Sarah invited you to Acme's workspace on Tahi.") to drive acceptance.

**Invited members skip payment and onboarding.** A teammate joining an org someone else paid for never sees a Stripe screen (it would imply they are being charged and could kill the invite) and never re-captures org info (already captured). They get a short one-card orientation ("Acme's workspace with Tahi. Here's where requests and invoices live.") then land in the already-furnished portal. They can still complete non-blocking checklist items the owner left open (their own timezone, an asset upload).

## Accessibility

A concrete WCAG 2.2 AA pass across the wizard, the checklist, payment, and file upload. Highest-risk items to verify first: Stripe Element labelling, plan-card radio semantics, focus-to-heading on step change, muted-ink contrast on the dark scene and cream canvas, keyboard-operable file upload.

**Step and progress semantics (1.3.1, 2.4.6)**
- Wizard wrapped in `role="region"` `aria-label="Onboarding"`; progress rail `role="group"` `aria-label="Step 2 of 5"`. Each step heading a real `<h1>`, unique. Current node `aria-current="step"`. Completed vs upcoming conveyed by glyph + accessible name, not colour alone. Announce transitions via either a polite `aria-live` status or focus-to-heading, not both.

**Focus management (2.4.3, 2.4.7, 2.4.11)**
- On forward / back, move focus to the new step's heading (`tabIndex={-1}` + `.focus()`), never to body top or a removed button. Back precedes Next in DOM and tab order. No focus trap (the card is inline); any confirm-leave modal traps correctly and restores focus on close. Visible focus ring `>=2px` and `>=3:1` on all three surfaces: 2px `--color-brand-light` `#7aab6b` on the dark scene, 2px `--color-brand-dark` `#425F39` on light card and cream. Focus never hidden behind a sticky footer or header.

**Labels and autocomplete (3.3.2, 1.3.5)**
- Every field a persistent visible label, not placeholder-as-label. Autocomplete tokens per the Component spec. Timezone select has an accessible name and native typeahead (or a correctly wired `role="combobox"`). Required fields use `required` + `aria-required` plus a visible "Required" / "Optional" marker, not a bare asterisk. Conditional fields that appear on engagement type are announced when revealed and carry their own labelled heading.

**Errors and aria-live (3.3.1, 4.1.3)**
- Inline errors via `aria-describedby` + `aria-invalid="true"`, described in text not colour. On submit with errors, move focus to the first invalid field (or a linked error summary) and announce the count via `role="alert"`. One persistent `role="status"` (polite) and one `role="alert"` (assertive) region created on load, not injected at announce time. `--color-danger` `#dc2626` passes on white / cream; use a lighter danger tint on the dark scene.

**Accessible file upload (2.1.1, 3.3.2, 4.1.3, 2.5.7)**
- Real `<input type=file>` with a visible keyboard-operable button; drag-drop is enhancement only (satisfies the dragging-movements alternative). Formats and max size in visible text referenced by `aria-describedby`. Upload progress via `role="progressbar"` or polite live text. Success announced; file exposed as a labelled removable item with a `>=44px` Remove. Format / size errors via `role="alert"` naming the file and the rule.

**Accessible payment (4.1.2, 3.3.1, 2.2.1)**
- Stripe Payment Element with explicit labels; verify each iframe field exposes an accessible name (cannot wire `label for` across the iframe, the Element's own config is the only lever, test with a screen reader). Mirror Stripe inline errors into our own `role="alert"` region. Confirm button has an accessible busy state (`aria-disabled` + spinner + "Processing payment, do not close this page" live), not removed from DOM mid-transaction. Blocked-gate state explains why and what to do, in text, with focus moved to it. Invoiced / external "nothing to do here" state announced as content. Currency and amount in text ("NZD 46,000"). Any Stripe session timeout warns and allows extension (2.2.1).

**Plan-card radios (4.1.2, 2.1.1, 1.4.1, 1.4.11)**
- True radio group with group label; arrow-key navigation, Space/Enter selects, single tab stop. Selection shown by more than the brand border (check glyph + "Selected" text). Selected border / fill `>=3:1` against unselected and the card background. Price, cadence, and inclusions in each radio's accessible name.

**Contrast across surfaces (1.4.3, 1.4.11)**
- Dark scene: body `--color-text-on-dark` `#FDFDFC`; secondary `--color-text-dim-on-dark` `#DCE8D9` for large text only; never `text-subtle` / `text-muted` on forest green. White card: `text-muted` `#5D5B55` and `text-subtle` `#63615B` confirmed `>=4.5:1` on `#fff`. Cream canvas: re-verify muted / subtle inks off pure white. Input borders `--color-border-strong` (the spec's "NOT the 10% border" note exists exactly for the 3:1 control-boundary rule); on the dark scene use a light-alpha border. Primary button `--color-brand-dark` with `#FDFDFC` text passes; `--color-brand-light` is never text-on-white.

**Targets, motion, resume (2.5.8, 2.3.3, 3.3.7, 3.3.4)**
- All interactive targets `>=44x44px` with adequate spacing (Back / Next especially). `prefers-reduced-motion: reduce` disables the cross-to-cream sweep, card slides, and rail animation, replaced by instant / opacity; no motion is essential to understanding progress. No auto-advancing steps. Progress persists server-side; a returning user lands on the next incomplete step with prior answers prefilled (Redundant Entry, AA). The checklist persists across sessions with state in text. A confirm-before-leave guards unsaved legal / billing input.

**Structure (2.4.2, 3.1.1)**
- Page `<title>` updates per step ("Brand assets - Onboarding - Tahi"). `<html lang="en-NZ">`. Logical heading hierarchy, no skipped levels. Milestone states ("Payment complete") move focus to a heading, not just a vanishing toast. Whole flow operable keyboard-only and screen-reader-tested (VoiceOver/Safari + NVDA/Firefox), including the Stripe step.

## States and flows

**Per billing mode x engagement type:** see the decision table in The onboarding model. The scene renders only the steps that mode + engagement resolve to, with an honest count computed before step 1.

**Resume / incomplete onboarding.** `organisations.onboardingState` tracks progress. Returning lands on the next incomplete step, prior answers prefilled, never a restart. Pay-now drop-before-pay returns to the gate; paid-but-deferred returns to the portal with the checklist.

**Payment success.** Slow brand-green success state in the card (leaf radius earns its keep here), a one-line "You're in. Here's your studio.", then a deliberate cross to the cream canvas. Focus moves to the portal overview heading.

**Payment failure.** Inline decline in the Element, calm specific copy, input preserved, retry one tap. Persistent international-card fallback to the team. Subscription past-due handled by smart retries + a portal banner.

**Payment pending.** For async methods or processing, a busy state ("Processing payment, do not close this page") in a live region, button disabled but present, no double-submit. On confirmation, proceed to the cross.

**Invited-teammate state.** Short orientation card, no payment, no org setup, lands in the furnished portal, can pick up open checklist items.

**The gate.** Server-side check on portal entry against subscription / PaymentIntent status. A `pay_now` client who reaches a portal URL unpaid is routed back to the gate with a text explanation and focus moved to it, never a blank wall or a stack trace.

**Empty states in the checklist.** The checklist itself prevents the empty-room problem: every deferred item is a prompt with an inline action, and the seeded first request (proposed default) sits at the top. A fully complete checklist shows a subtle completion state then offers dismissal.

**What "onboarding complete" means.** The hard gate is cleared (or never applied) and the client is in the portal. The *checklist* completing is a separate, softer milestone: when every item is done, the card celebrates quietly and can be dismissed (collapsing to nothing, not a persistent pill). Onboarding is "done" for access purposes at the cross to cream; "done" for setup purposes when the checklist clears. The two are deliberately decoupled so access is never held hostage to setup.

## Copy deck

Calm, premium, NZ English (organise, colour, centre, Aotearoa). Functional steps utilitarian; persuasive steps (welcome, plan) benefit-led. Hyphens only, no em/en dashes. Imply, never announce.

**Welcome**
- Self-serve / known: `Welcome to Tahi. Let's set up [Company]. A few minutes, then you're in.`
- Engagement segmented control (ambiguous self-serve only): `What are we starting on?` -> `A new build or redesign` / `Ongoing work on something live`
- CTA: `Let's set things up.`

**Plan selection (marketing)**
- Heading: `Choose how we'll work together.`
- Subhead: `Pick the pace that fits. Change it anytime.`
- Maintain outcome line: `Steady upkeep, handled.`
- Scale outcome line: `Ongoing design and build, handled.`
- Recommended pill: `Recommended`
- Price note (NZ): `+ GST` / (overseas): `GST not charged`
- CTA: `Continue`

**Payment (`pay_now`)**
- Gate heading: `One step to open your studio.`
- Reassurance: `Your portal, your team, and your first request are ready.`
- Set-amount line example: `Project deposit (50% of NZD 80,000)`
- CTA: `Pay NZD [amount]`
- Trust: `Secured by Stripe.`
- Lead signal: `[Name] will be your lead.`
- Fallback: `Prefer a bank transfer or invoice? We'll sort it.`
- Decline: `Your bank declined this. Try another card, or contact them.`
- Processing: `Processing payment. Please don't close this page.`
- Success: `You're in. Here's your studio.`

**Invoiced notice**
- Status: `Invoice 1042 is with you. Due in 14 days. You're all set to carry on.`
- Pay link (optional): `Pay now`

**External / comp**
- Welcome: `Welcome to Tahi. Let's set up [Company].` (no money copy anywhere)

**Company / org**
- Self-serve: `What should we call your workspace?`
- Team-created: `We've set up [Company]. Look right?` / edit link `Not right? Tell us.`

**Your details**
- Heading: `Who's our main point of contact?`
- Fields: `Your name` / `Your role` / `Your timezone` (prefilled)
- Skip (timezone): `Add later in your portal`

**Capture prompts (project)**
- Heading: `About the work`
- Logo: `Your logo` / hint `SVG preferred, up to 25MB.`
- Colours: `Brand colours` / hint `Paste your hex codes, or upload a swatch.`
- Guidelines: `Brand guidelines` / hint `A PDF, or a link to Figma, Drive or Notion.`
- Brief: `What are we building?`
- Links: `Key links` / placeholder `https://your-current-site`
- Skip affordances: `Add later in your portal`

**Teammate invite**
- Heading: `Bring your team in.`
- Input: `Add a colleague's email`
- Skip: `Do this later`
- Roles: `Admin` (`Billing and full access`) / `Member` (`Collaborate, no billing`)
- Pending: `Invited [time] ago` / actions `Resend` `Revoke`
- Accept screen: `[Name] invited you to [Company]'s workspace on Tahi.`

**Completion / checklist**
- Hand-off heading: `You're in. Here's what's next.`
- Progress: `3 of 6 done`
- Brand kit item: `Add your brand kit` / why `So we design in your colours from day one.`
- First request item: `Tell us what we're building` / action `Start`
- Invite item: `Invite your team` / action `Invite`
- Complete state: `That's everything. Nice work.`

**Resume**
- `Welcome back. Let's pick up where you left off.`

## Tokens, deliverables for Claude design, and why this is premium

**Tokens (use these exact variables):**

| Where | Token / value |
|---|---|
| Page / portal canvas | `--color-bg-cream` `#F7F6F3` (dark `#131211`) |
| Scene panel gradient | `--color-brand-deepest` `#1E3019` -> `--color-brand-deep` `#2A3626` |
| Panel body text | `--color-text-on-dark` `#FDFDFC` |
| Panel dim / large text | `--color-text-dim-on-dark` `#DCE8D9` (large only) |
| Card background (theme-pinned) | `#ffffff` |
| Card radius | `--radius-leaf-lg` `0 1.5rem 0 1.5rem` |
| Card shadow | `0 24px 48px -24px rgba(26,25,20,0.18)` |
| Recommended plan card | `--radius-leaf-lg` + `--color-brand-light` `#7aab6b` border |
| Standard card / checklist | `--radius-lg` `.75rem`, 1px `--color-border-strong` |
| Recommended pill | `--color-brand-50` `#f0f7ee` fill, `--color-brand-dark` text |
| Stepper active node | `--color-brand` `#5A824E` |
| Primary button fill | `--color-brand-dark` `#425F39` (NOT `--color-brand`, fails 4.5:1) |
| Primary button hover | toward `--color-brand-deep` `#2A3626` |
| Input / control border | `--color-border-strong` `rgba(26,25,20,0.16)` (NOT the 10% border) |
| Input / button radius | `--radius-md` `.5rem` |
| Focus ring (light) | `--color-brand-dark` `#425F39`; (dark scene) `--color-brand-light` `#7aab6b` |
| Ledger label | `--text-xs` weight 600 uppercase `0.08em` `--color-text-subtle` `#63615B` |
| Skip link | `--color-text-subtle` `#63615B` |
| Status | success `#4ade80`, warning `#fb923c`, danger `#dc2626`, info `#60a5fa` |
| Leaf usage | recommended plan card, final CTA, success state. NOT inputs, Stripe fields, file slots |
| Motion | micro `--motion-base 200ms`; cross-to-cream slow; all `--ease-out` `cubic-bezier(.22,1,.36,1)`; no bounce |
| Font | Manrope 400-800 |
| Spacing scale | `4 / 8 / 12 / 16 / 24 / 32 / 40 / 64` |

**Screens / variants to generate:**

1. **Plan selection - desktop** (`pay_now` retainer): two cards, recommended carrying the leaf radius, stepper, panel ledger motif.
2. **Payment - desktop**: set-amount summary + themed Payment Element + brand-dark CTA + trust line + fallback.
3. **Invoiced welcome - desktop**: invoice status panel, optional pay link, no charge, advance allowed.
4. **External / comp welcome - desktop**: pure welcome, zero money UI anywhere.
5. **Conditional capture step - desktop** (project, "About the work"): three brand-asset slots + brief + links, each with "Add later".
6. **Brand-asset upload state sheet**: empty / uploading / uploaded / format-error per slot, light + dark logo preview.
7. **Teammate invites - desktop**: email + role rows, pending list with Resend / Revoke status pills.
8. **In-portal first-run checklist - cream canvas**: card with done / to-do items, seeded first request, collapsed progress-pill variant.
9. **Mobile (375px)**: forest band + overlapping card for plan select, payment, and a capture step; full-width Element.
10. **Reduced-motion variant**: static panel, instant cross to cream, no rail animation.
11. **State sheet**: payment success (leaf + green), decline, processing; resume / incomplete; invited-teammate orientation; blocked-gate explanation.

**Integration constraints (non-negotiable so it drops into the codebase):**
- **Clerk owns** org create, naming/metadata, invitations, and roles (`admin` / `member`). Design the chrome, not the org primitives.
- **Stripe owns** the Payment Element (embedded, not hosted Checkout), subscriptions, PaymentIntents, and the customer portal via `/api/portal/billing/session` and `/api/admin/integrations/stripe/provision`. Theme via the Appearance API to the tokens above.
- **Reuse the auth `AuthShell` scene** for Steps 1 to 6; the checklist lives on the dashboard cream canvas. Continuity from `01-auth.md` is the point.
- Use the exact CSS variables; no hardcoded hex outside the documented inline-const pattern. Pin light tokens on the card.
- Prices and tiers come from `SPECS/billing-tiers.md` and the Services and Pricing docs page. Do not invent figures.
- Honour the contrast corrections: primary button `--color-brand-dark`, control borders `--color-border-strong`, panel body `--color-text-on-dark`.
- One hard gate only (`pay_now` payment), enforced server-side. Everything else resumable via the checklist.
- Touch targets `>=44px`, inputs `>=48px` / `16px` font, visible focus everywhere, full `prefers-reduced-motion` fallback.

**Open items to confirm (proposed defaults, each flagged as a decision, not settled):**
- **Teammate roles + seat cap.** Default: two Clerk org roles, `admin` (billing + everything) and `member` (collaborate, no billing); no hard seat cap, soft nudge past ~10. Confirm whether a distinct `billing` role is needed and whether retainer plans cap seats.
- **Self-serve open vs invite-link only.** Default: invite-link only at launch (sign-up reachable only via a team-sent link), architecture ready to open later. Confirm whether public sign-up is ever wanted.
- **Who names the company.** Default: self-serve client names it; team-created orgs arrive named and the client only confirms (editable). Confirm whether a self-serve name can be locked / edited by the team afterward.
- **Does onboarding end in a first request.** Default: pre-seed a first request / project drafted from the engagement type as the top checklist item, editable not mandatory, so the portal is never empty. Confirm whether auto-seeding is acceptable or it should be a client-triggered prompt.

**Why this is premium.** Every decision serves the first five minutes of a six-figure relationship. One spine with two toggles means a retainer client and a redesign client each get a journey correctly sized for them, and the honest progress count means no path ever feels like a stripped version of another, which is what makes four payment paths and two engagement types read as one calm experience. Gating only the money, and deferring the rest to a resumable checklist, means a client who already paid is never taxed with a form, and the empty-room problem is killed by a furnished portal and a seeded first request. The embedded Payment Element keeps the most expensive moment inside the Studio Ledger scene rather than bouncing it to a stranger's domain. Recognition over re-asking, prefill over blank fields, "add later" over "skip", the rationed green, the rare leaf on the recommended card and the success state: these are the brand promise made literal. Nothing falls between sign-up and the portal. The client should feel known, expected, and already moving, which is exactly the proof that "no gaps, one" is true and not just a claim.

Written to `/Users/liammillerdev/ShipStudio/tahi-dashboard/SPECS/redesign/02-onboarding.md`.

---

## As built (added 2026-06-27)

Implemented as a Studio Ledger flow driven entirely by the entry link, not by an in-page switcher.

**Files.**
- `components/tahi/onboarding-shell.tsx` - shared scene (`SceneShell`, `ScenePill`, `Ledger`, `Stepper`), the `useGrow` height-animation hook, shared `TimezoneField` / `PhotoField`, and `ONBOARDING_CSS`. Reuses the auth neon leaf and brand glyphs; scene split flips to 42% scene / 58% card so the stepped form gets the room.
- `components/tahi/onboarding-content.tsx` - the client flow (chooser, welcome + Loom hello, plan, Stripe payment, details, invite, kickoff).
- `app/(onboarding)/onboarding/page.tsx` - server entry; resolves context + Clerk identity, renders the flow.
- `lib/onboarding-entry.ts` - link -> context resolver.

**Entry model.** The link decides the path (see `01-auth.md` "entry routing"). `resolveClientEntry` maps a persona key to `{ engagement, clientType, entry, hasEngagement }`: `selfserve`, `retainer`, `project`, `existing_project`, `existing_retainer`. Self-serve new clients see the chooser (retainer self-serve vs project enquiry -> proposal dead-end, since projects are invited to the platform later). Invited / existing clients skip the chooser and never see payment; when a project / schedule / contract is attached, the engagement is known and the flow goes straight to the right care path.

**Steps** are assembled by `buildSteps(engagement, clientType)`:
- new retainer: welcome, plan, pay, details, invite
- new project: welcome, details, invite, kickoff
- existing retainer: welcome, plan, pay
- existing project: welcome, kickoff

**Decisions carried through from the research.** Retainers ($1,500-$4,000/mo) are card-first and self-serve; projects and large scopes go to proposal / invoice, never gated behind a card. An "invoice / net terms" fallback is offered on the pay step (portal access is not hard-coupled to payment). Plan cards read "+ tax where it applies" (confirm NZ GST treatment before launch).

**Payment (wired).** The pay step uses an inline Stripe PaymentElement (`components/tahi/onboarding-payment.tsx`). `POST /api/portal/checkout` ensures a Stripe customer for the org, resolves the plan + optional parallel-track prices by `lookup_key`, creates a `default_incomplete` subscription, records a `subscriptions` row, and returns the first-payment client secret. The webhook (`customer.subscription.updated`) flips the row to active. Plans/add-ons are defined in `lib/stripe-plans.ts` and created idempotently by `POST /api/admin/integrations/stripe/setup-plans` (run once per Stripe environment). If Stripe is not configured or prices are missing, the step degrades to the invoice / net-terms path so onboarding is never blocked.

**Invites (wired).** The invite step posts to `POST /api/portal/invites`, which creates Clerk organization invitations (role `org:member`) for the client's org; each invitee gets an email immediately.

**Config note.** Requires `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in env (test and live). Add the keys, then call setup-plans once to mint the products/prices for that environment.

The design's preview-only Tweaks panel and the duplicate `SelfServe` component are dropped.

**Skipped here.** The final cream "portal / care portal" screens are intentionally not built in onboarding; they fold into the first home/tour feature. On finish the flow routes to `/overview`.

## Removed

`02-onboarding-research.md` (the productized-vs-enterprise audit) has been removed now that its conclusions are folded into this spec and the build.
