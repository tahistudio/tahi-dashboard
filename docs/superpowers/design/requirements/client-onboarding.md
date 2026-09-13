# Design requirements: client-onboarding

Group: client-onboarding (audience: client, plus one teammate-only route kept in this group because it shares the same shell and files). Routes: `/onboarding` (welcome, plan, pay, details, brief, invite, kickoff), `/welcome` (team onboarding), `/continue`.

Source of truth for this document: CLAUDE.md, STATUS.md "Since the last update", `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, TASKS.md (grepped for onboarding, welcome, continue, kickoff, LW.*, T1.4, T1.8, T1.20), and the live code: `app/(onboarding)/onboarding/page.tsx`, `app/(onboarding)/welcome/page.tsx`, `components/tahi/onboarding-content.tsx`, `components/tahi/onboarding-payment.tsx`, `components/tahi/onboarding-shell.tsx`, `components/tahi/onboarding-checklist.tsx`, `components/tahi/team-welcome-content.tsx`, `lib/onboarding-steps.ts`, `lib/onboarding-entry.ts`, `lib/onboarding-invites.ts`, `lib/org-onboarding.ts`, `app/api/onboarding/complete/route.ts`, `app/api/portal/kickoff-slots/route.ts`, `app/api/portal/calls/route.ts`. Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66: `Tahi Onboarding.html`, `onboarding-app.jsx`, `onboarding-spec.md`, `Tahi Team Onboarding.html`, `team-onboarding-app.jsx`.

---

## 1. Purpose and audiences

`/onboarding` is the client sign-up and setup wizard: the only place a brand-new or newly invited client organisation walks from "just signed in" to "inside the portal". It serves three distinct people through one shell, decided entirely by the link that brought them here (`lib/onboarding-entry.ts`, `lib/onboarding-invites.ts`), never by an in-page switcher:

- a **self-serve new retainer client** who signed up cold and has not chosen a plan yet;
- an **invited new project client** whose contract was settled off-platform and who is being welcomed onto the platform with no payment step;
- an **existing client** (already billed, often on the Xero rail) opening a second engagement, who must never see a plan picker or a card form again.

`/welcome` is the equivalent flow for a new Tahi teammate: a warm hello plus a light profile step (photo, preferred name, pronouns, timezone), never an HR form, because contract and payroll are handled off-platform. It is grouped here because it shares the same auth-shell scene, CSS and helper components (`onboarding-shell.tsx`) as the client flow, not because it serves the client audience.

`/continue` is not a wizard page at all: it is the landing spot for a signed-in Clerk session with no active organisation. It resolves which membership to activate (Tahi teammate, single client org, or "no membership yet" which falls through to `/onboarding` as a genuine new lead) and calls `setActive`. A user only sees this screen for the moment it takes to redirect; there is no meaningful "design" for it beyond a loading/transition state.

What this group must never show:
- A plan picker or a live Stripe card form to an **existing** client (`clientType === 'existing'`). The steps function (`buildSteps`) hard-codes this and the server backs it: `POST /api/portal/checkout` answers 409 for an org holding an active retainer or billing on the Xero rail. A design must not add a path back into `plan`/`pay` for this persona.
- Any invitee's PII (company name, contact name, contact email) to a signed-in visitor whose **verified** Clerk email does not match the invite's `contactEmail`. The visitor still gets the correct persona/flow, but never someone else's identity, on both the client (`/onboarding`) and team (`/welcome`) flows.
- A bookable kickoff slot as clickable when the session is a Tahi admin **previewing the portal as a client** (Client view / impersonation). The slot chips must render disabled with the copy "Read only while viewing as a client", because `POST /api/portal/calls` refuses that session by design (403).
- Messages. This group never links to `/messages` (the client nav hides Messages entirely per the 2026-09-13 Giant Group readiness work); do not add a "message the team" affordance to onboarding.
- Any super-admin-only surface. Nothing in this group is gated by `NEXT_PUBLIC_TAHI_ORG_ID` except the teammate `/welcome` flow itself (which only a Tahi org invite can reach); no client-facing screen here should expose studio-internal data (rates, other clients, margins).
- A payment form to a client who chose "invoice me". Once `organisations.paymentTerms` is set to net terms, the client is entitled and must never be routed back through `pay`.

## 2. Pages, sub pages and entry points

**`/onboarding`**: one route, one shell (`OnboardingContent`), state-driven by a `steps: string[]` array from `buildSteps(engagement, clientType)`, never separate URLs per step. Reached by: a self-serve sign-up (no token, no query params, defaults to the chooser); an admin-minted invite link carrying `?token=...` (or the `tahi-invite-token` cookie the middleware stashes across the Clerk auth round-trip when the query string is dropped); or legacy query-param personas (`resolveClientEntry(params)` in `lib/onboarding-entry.ts`, e.g. `?p=existing_project&company=Acme`), which the docs describe as a seam kept for links minted before the real token table existed.

Sub-states within `/onboarding` (all in one card, animated height transitions via `useGrow`):
- **Chooser** (`inChooser`): only for a brand-new, self-serve, not-yet-decided client (`clientType === 'new' && entry === 'selfserve' && !chosen`). Two options: "Ongoing design & build" (picks retainer, enters the step flow at `idx 0`) or "A one-off project" (`goSelf('proposal')`).
  - **Project enquiry sub-screen** (`selfView === 'proposal'`): company name, website, a required brief textarea, budget select, discipline select. Submits to `POST /api/portal/enquiry`. This is the closest thing to the "brief" step named in this group's route list; it is a dead end (no engagement is created), not a step inside the numbered wizard.
  - **Enquiry sent confirmation** (`selfView === 'done'`): a static "Thanks, we're on it" success card, no further action.
- **`welcome`** step (also reached as `orient`): different copy for existing vs. new, and for invited-known-company vs. cold self-serve. Shows the lead's avatar/name/role and a quote. Carries a disabled "Watch a 60-second hello" video trigger (see Variants).
- **`plan`** step: only on the new+retainer path. Two plan cards (Maintain, Scale), a "parallel track" add-on checkbox, an anchor-pricing line.
- **`pay`** step: only on the new+retainer path, immediately after `plan`. Renders `<OnboardingPayment>`: a Stripe PaymentElement inline, a currency picker, an "invoice me" fallback link. Own footer (Pay / Back), not the shared stepper footer.
- **`details`** step: on new+retainer and new+project paths. Identity chip, optional company-name field (only when not already known), role field, timezone field.
- **`invite`** step: on new+retainer and new+project paths. Add-by-email colleague invites (client-side list), sends via `POST /api/portal/invites` on continue; skippable.
- **`kickoff`** step: on new+project and existing (both engagements) paths. Lead card ("30 min with {lead}"), `<SlotPicker>` (real availability from `GET /api/portal/kickoff-slots`), a read-only note when previewing as a client, booking POSTs to `/api/portal/calls`.
- No separate `brief`/"Your brief"/"About the work" step exists in the shipped step arrays today (see section 4); the design file's `work` step (brand-asset links, "what are we building") is not ported.

**`/welcome`**: one route, one shell (`TeamWelcomeContent`), two steps only: `welcome` (role/start-day/buddy/gear summary) then `profile` (photo, preferred name, pronouns, timezone). Reached via a teammate invite link (`POST /api/admin/team/[id]/invite` mints it) carrying `?token=...` or the same invite cookie. No chooser, no branching.

**`/continue`**: one route, no visible sub-states beyond a brief loading moment while it resolves membership and redirects (to `/overview`, or into `/onboarding` when no membership resolves).

There are no dialogs, slide-overs, or tabs anywhere in this group; every "screen" is a full-card state transition inside the same auth-scene shell (`SceneShell` + `tahi-auth-card`).

## 3. States and variants

- **`/onboarding` loading**: brief moment resolving Clerk user + invite token server-side (no client-visible skeleton state before the card renders; the whole page is server-rendered per request). The kickoff step's `<SlotPicker>` has its own loading skeleton: 5 day columns x 4 chip placeholders, `aria-busy`.
- **`/onboarding` empty**: kickoff slot-load failure or zero-slots both fall back to quiet, non-alarming copy rather than an error banner: "We couldn't load live availability right now. Continue, and we'll follow up by email to find a time." / "No open times in the next few days. Continue, and we'll follow up by email to find a time."
- **`/onboarding` error**: invite/org-join failure shows an inline `role="alert"` banner ("We could not open your workspace. Please contact the studio.") above the card body, footer still usable; kickoff booking failure shows a similar inline banner with a specific message from `kickoffBookingErrorMessage(status, error)` and lets the client retry or use the skip link; "invoice me" failure shows an inline banner with a distinct 402 message ("Only the person who set up this workspace can switch it to invoicing...").
- **Read-only Client view (admin previewing as a client)**: kickoff slot chips render disabled with the note "Read only while viewing as a client"; booking is never attempted.
- **Member seat vs. admin/workspace-admin seat**: "invoice me" on the `pay` step is refused (402, generic recorded-preference failure copy) for any caller who is not the org's workspace admin or primary contact (`isOrgAdmin`); a plain member seat sees the same UI but the click will fail server-side. No client-visible role gate exists on the wizard itself today; the wizard does not know or show the caller's role.
- **375px**: the card and scene stack (mobile auth-shell layout is shared with `/sign-in`); the Stepper (dot rail) renders in place of the full vertical `Ledger` list, per `onboarding-shell.tsx`'s existing responsive split. Not verified live at 375px for every step per T1.8/CA2 (only confirmed the shell shares tokens, not a fresh visual pass at 375).
- **768px**: intermediate width, same shell breakpoints as `/sign-in`/`/sign-up`.
- **Dark mode**: the onboarding scene is a fixed dark forest-green panel by design (matches the auth shell's always-dark left scene), and the white card side does not currently read `.dark` / respond to the dashboard's dark-mode toggle at all; there is no dark-mode variant of the card today, and none is implied by the design file (the card is a fixed cream/white "Studio Ledger" surface regardless of the visitor's dashboard theme preference). Design should confirm this is intentional (see Open Questions).
- **`/welcome` loading/empty/error**: same auth-shell loading behaviour as `/onboarding`; the same invite-join error banner pattern (own copy: "We could not add you to the Tahi workspace. Please contact the studio."). No kickoff step, so no slot-loading state.
- **`/welcome` variants**: role, start date, gear and buddy are hard-coded defaults for every hire today ("New teammate", "your first day", "MacBook Pro 16", buddy always Liam) rather than read from a real invite record (see section 4).
- **`/continue`**: no distinct visual states beyond the momentary redirect; not designed as a page a person lingers on.
- **Print / public**: not applicable, this group is never public and never printed.

## 4. Features and actions

### `/onboarding`

**Works today:**
- Full branching by persona/engagement/clientType with a pure, unit-tested step-builder (`lib/onboarding-steps.ts`).
- Existing clients never see `plan`/`pay`; server-enforced with a 409 on `/api/portal/checkout` as a backstop (T1.4, S2, done).
- Real invite-token resolution (`lib/onboarding-invites.ts`) joins the visitor to a pre-created org with no payment, with PII disclosed only on a verified-email match.
- Org-level onboarding backfill: a second seat invited into an already-onboarded org (via a plain Clerk org invitation, not this wizard) is now recognised as onboarded through `lib/org-onboarding.ts`'s four signals, landing them in the portal instead of the wizard (LW.19, fixed).
- Self-serve org provisioning (`POST /api/portal/provision`) before the `pay` step, idempotent against a Clerk-created org.
- Real Stripe PaymentElement checkout on `pay`, with a currency picker and graceful "Stripe unavailable" fallback to the invoice-me path.
- "Invoice me" (net terms): records the preference, raises a real draft invoice priced from the plan catalogue, notifies the studio, audit-logs the action, and entitles the client (T1.4).
- Real kickoff availability (`GET /api/portal/kickoff-slots`, Google Calendar free/busy best-effort) rather than four fixed guessed time labels; the picker groups by the visitor's own day and names both zones (LW.6, LW.7).
- Kickoff booking writes a real `scheduledCalls` row, mirrors into `discoveryCalls`, notifies the studio, emails the client a confirmation, and (when Google is connected) creates a real calendar event with a Meet link (LW.8, T1.4).
- Read-only Client-view handling on the kickoff step: disabled slots with an honest reason instead of a 403 the client cannot interpret (LW.7).
- Colleague invites during `invite` step post to `/api/portal/invites` and are non-fatal on failure (re-sendable from the studio).
- Project enquiry (self-serve "one-off project" path) posts to `/api/portal/enquiry`, records a lead, and emails business@tahi.studio.
- Onboarding completion is honestly gated (`POST /api/onboarding/complete`): only stamped once the caller is a teammate, holds a consumed invite, has net terms recorded, or has an active/trialing/past_due Stripe subscription (including a webhook-lag fallback that asks Stripe directly).

**Exists but wrong or half-built:**
- The design's `work` / "Your brief" step (brand-asset links, "what are we building?") is not implemented in either the new-project or existing-client step arrays; the ported `META` table still carries a `work: 'Your brief'` label with nothing that ever renders it. Not tracked under a TASKS id today; flagging as a design/port gap for Liam to confirm is intentionally dropped or should be restored (see Open Questions).
- The onboarding hello video is fully built (captioned, scrubbable Loom-style modal) but hidden behind `ONBOARDING_VIDEO_ENABLED = false` (LW.2, merged, "live check pending").
- The post-onboarding cream "portal + first-run checklist" screen from the design (`onboarding-spec.md`'s "cross-to-cream" payoff, a seeded first request, a checklist card) is not rendered by the shipped flow at all: `onComplete()` calls the completion API and routes straight to `/overview`. The closest real equivalent, the client-home first-run checklist (`components/tahi/onboarding-checklist.tsx` / `ClientFirstRun`), is a separate component gated off by `CLIENT_HOME_ONBOARDING_CHECKLIST_ENABLED = false` (LW.9, "it will come back") and lives on `/overview`, not in this group.
- T1.14: portal write-path role gap. Brands/organisation/people/change-request routes assume "primary contact = admin"; a fresh org's first owner may not be able to invite teammates or edit org settings until `portalRole` is properly set. Directly touches the `invite` and `details` steps' promise of "you can do this later in settings."
- `/api/portal/kickoff-slots` free/busy filtering is best-effort and currently reports `calendarSynced: false` for the production Google grant until LW.8b (Liam reconnecting Google with the widened scopes) is done live; until then every visitor sees the plain working-hours window with nothing marked busy.
- The kickoff step's MCP twin (a worker MCP tool mirroring `GET /api/portal/kickoff-slots`) is an explicit follow-up named in TASKS (LW.6) but not yet built, which is a CLAUDE.md rule-14 gap for this route specifically.
- 375px and dark-mode passes on the onboarding screens are asserted "share the auth shell's tokens" (T1.8, CA2) but have not had a fresh, dedicated critic pass since the Pass-1 FIX verdict on the design file itself (checklist: "Client onboarding... live; existing clients now skip plan and pay (S2)" with no re-review row ticked).

**Planned or missing:**
- A real "resolveToken" implementation for `lib/onboarding-entry.ts`'s legacy query-param seam is superseded by the newer `lib/onboarding-invites.ts` table for the client flow, but the file's stub (`return null`) still exists and is documented as dead code (T1.20's write-up covers the team side of this same stub).
- Nothing in TASKS proposes restoring brand-asset capture or a real brief field to the client wizard; if wanted, this is a **proposal**, not a backlog item.

### `/welcome`

**Works today:**
- Two-step flow (welcome summary, then a light profile capture) with the same shell primitives as the client flow.
- Real invite-token consumption: `POST /api/admin/team/accept-invite` joins the hire to the Tahi Clerk org and activates it for the session (this replaced a plain Clerk organization invitation, per LW.18/T1.20 write-ups).
- Onboarding completion stamp (same `POST /api/onboarding/complete` route, teammate branch is unconditionally entitled).

**Exists but wrong or half-built:**
- T1.20 (open): role, start date, gear, and buddy are **hard-coded** for every hire ("New teammate", "your first day", "MacBook Pro 16", buddy always Liam Miller) because `lib/onboarding-entry.ts`'s `resolveToken` is a stub that always returns `null`; only the first name is ever real (from the invite's matched contact name or the signed-in Clerk user). `SPECS/redesign/03-team-onboarding.md` already flags these as seams.
- T1.17 (in progress): the durable hire-onboarding path (Clerk webhook backfill of `teamMembers.clerkUserId`, gated write routes, Linked/Not-linked column) is the bigger piece this welcome screen sits in front of; today a hire with no team-member row resolves to full admin access, which this screen's warm tone does not surface at all.
- The design's cream "Ready for day one" payoff screen (first-week schedule preview, a small "before you start" checklist, a photo-gated row) is not ported; the shipped flow ends by routing straight to `/overview`.

**Planned or missing:**
- Either build `resolveToken` against a real teammate-invite record (role, start date, gear, buddy) and feed it into this page, or deliberately drop the fake personalisation and render an honest, context-free welcome. TASKS explicitly frames this as an either/or decision, lower priority than T1.17.

### `/continue`

**Works today:**
- Resolves a fresh sign-in with no active org to the right membership (teammate, single client org) or falls through to onboarding as a genuine lead (AU.1, live; root cause of Staci self-provisioning a stray "Staci's workspace" resolved).

**Exists but wrong or half-built:**
- T1.4 (closed 2026-09-13, but the underlying dependency stays worth naming): before the Clerk webhook backfill, second-seat contacts could stick at this gate forever with no membership to activate; watch for regressions here since this is the single chokepoint every fresh session passes through.

**Planned or missing:** none identified; this route has essentially no design surface (see section 6).

## 5. Data and integrations

- **Clerk**: session identity, `publicMetadata.onboardingComplete` (per-user completion flag), org membership and `setActive` (both invite-consumption flows), org invitations for teammate/client seats.
- **D1 tables**: `organisations` (`onboardingState` JSON blob, `paymentTerms`, `onboardingLoomUrl`), `onboardingInvites` (real invite tokens: flow, persona, org/contract/schedule/proposal linkage, contact identity, usedByUserId), `contacts`, `subscriptions` (active/trialing/past_due gates entitlement), `projects` (project-engagement gate), `requests` (portal-authored request gate), `scheduledCalls` + `discoveryCalls` (kickoff booking + mirror), `teamMembers`, `teamMemberAccess` / `teamMemberAccessOrgs` (project-manager resolution for the kickoff host), `settings` (`studio.projectManagerId` studio-wide PM override), `invoices` + `invoiceItems` (invoice-me draft), `auditLog` (billing_terms_set).
- **Stripe**: `POST /api/portal/checkout` (subscription + PaymentElement client secret), Stripe subscription retrieval as a webhook-lag fallback in `/api/onboarding/complete`, presentment-currency pricing (`lib/stripe-plans.ts`).
- **Google Calendar**: `GET /api/portal/kickoff-slots` (free/busy read), `POST /api/portal/calls` (create/update calendar event, mint Meet link); both best-effort, never block the flow when absent or unauthorised.
- **Resend**: kickoff confirmation email (`emails/kickoff-booked.tsx`), project-enquiry notification to business@tahi.studio, invite emails (`emails/seat-invite.tsx`).
- **Notifications**: `notifyAllAdmins` on kickoff booking and on invoice-me.
- **Honesty constraints already enforced and that any redesign must preserve**: no fabricated slot times (real Google free/busy or an honest "we'll follow up by email" fallback, never four guessed labels); no dead CTA (every visible button either works or is explicitly labelled read-only/disabled with a reason); no invented company/contact data shown to a mismatched verified-email visitor; no second Stripe subscription opened against a client already paying or invoiced (409 from the server, not just a hidden step client-side).

## 6. Design system contract

- The onboarding/welcome shell is its own bespoke system (`components/tahi/onboarding-shell.tsx`, `ONBOARDING_CSS`), reusing the auth split-pane scene (`SceneShell`, `ScenePill`, `Ledger`, `Stepper`, `NeonLeaf`-style dark panel) that `/sign-in` and `/sign-up` also use. It intentionally does **not** use the dashboard's `PageHeader`, headline band, left rail, `DataTable`, or `SlideOver` primitives, because it renders before a person is inside the dashboard shell at all. This is correct and should not change.
- Leaf radius usage matches the design system's stated pattern (recommended plan card, the primary "Continue"/leaf-styled CTA button, the success ring) rather than being applied to every card.
- Tokens: the onboarding CSS carries its own `--ob-*` variables layered on top of the shared brand tokens (confirmed in `onboarding-payment.tsx`'s `INVOICE_LINK_STYLE` referencing `var(--ob-brand-dark)`); a redesign must keep pulling from CSS custom properties, not hardcoded hex, per CLAUDE.md rule 13, with the caveat that this scene is allowed to be permanently dark on its left panel (like the sidebar) by design intent.
- What the existing design file (`Tahi Onboarding.html` / `onboarding-app.jsx` / `onboarding-spec.md`) gets right and the port has faithfully carried over: the persona/engagement/clientType decision table, the plan/pricing copy and anchor line, the invite-team UX, the kickoff lead card and slot picker shape, the chooser's two-path split, the Studio Ledger scene reuse.
- What the design must change or the port has already correctly diverged from: (1) the design's mock Card/Bank/Apple Pay tab UI and fabricated declined-card demo state is superseded by a real Stripe PaymentElement in the port; a redesign should design around the real PaymentElement, not the mock tabs; (2) the design's `work`/"Your brief" step and the cream "Ready for day one"/"first-run checklist" payoff screens are unbuilt seams that need an explicit decision (build or formally cut) rather than silent drift between design and code; (3) the checklist's "Design and verdict" entry for this group carries no formal SHIP/FIX/REDO critic verdict at all (unlike the 23-page Pass 3 sweep that covered most of the rest of the app); this group has never been through that critic pass, so a fresh review should establish a first verdict rather than assume one; (4) T1.8/CA2 confirmed shared tokens with the auth shell but that is not the same as a dedicated 375px/dark-mode visual check of every onboarding step, which the checklist and catalogue both leave open.

## 7. Open questions for Liam

1. Should the client `/onboarding` card ever respond to the visitor's dashboard dark-mode preference, or is a permanently light/cream card (regardless of theme) the intended, final design for this flow? (Yes = build a dark variant. No = leave as-is and say so explicitly so it stops looking like an oversight.)
2. Is the design's "Your brief" step (brand-asset links, a one-line "what are we building?") wanted in the shipped project-engagement path, or should it be formally cut from the design file and the `META` table cleaned up to match? (A = build it. B = cut it.)
3. Is the cream post-onboarding "first-run checklist" payoff screen still the intended destination on finish, or has routing straight to `/overview` (with the client-home checklist re-enabled later, per LW.9) become the permanent plan? (A = revive the cream payoff inside `/onboarding` itself. B = the client-home checklist, once re-enabled, is the payoff and `/onboarding` should keep routing straight through.)
4. For `/welcome`, do you want `resolveToken` built out against a real teammate-invite record (true role/start-date/gear/buddy per hire), or should the hard-coded defaults be replaced with honest, context-free copy until T1.17's hire-onboarding path lands? (A = build resolveToken now. B = strip the fake personalisation now, revisit after T1.17.)

## 8. Acceptance for the design review

1. At 1440 and 375, light and dark: the existing client persona (`clientType === 'existing'`) never shows a plan card or a card-payment form anywhere in the screenshot set, on either engagement.
2. The kickoff step's slot picker shows real, distinct time chips grouped by day with a "Times shown in {zone} (your time). {lead} is in {studio zone}." line, not four fixed guessed labels, and its loading state is a skeleton, never a blank card.
3. When the reviewer marks the screenshot "Client view / read only", the kickoff chips render visibly disabled with the exact copy "Read only while viewing as a client"; no chip in that state looks clickable.
4. Every visible button in the flow either performs a real action or is visibly disabled/labelled with why (no dead CTA); the "invoice me" and "skip" links are present exactly where the current step's `buildSteps` branch says they should be, never elsewhere.
5. The onboarding card layout is fully usable at 375px with no horizontal scroll, and every tappable control (slot chips, plan cards, footer buttons, the invite-add button) meets a 44px touch target.
6. Dark mode: confirm with Liam's answer to Open Question 1 before flagging any contrast issue as a bug; if the card is meant to stay light-only, a reviewer should not flag it as a dark-mode miss.
7. The chooser (self-serve, new, undecided) and its two sub-paths (retainer pick, project-enquiry form, enquiry-sent confirmation) are all present as distinct, reachable states in the review set, not just the two-option chooser screen.
8. `/welcome`'s two steps (welcome summary, profile capture) are reviewed knowing the role/start-date/gear/buddy fields are currently fixed placeholder values for every hire, not per-hire data; the reviewer should judge the visual design, not read these as real content.
9. No screenshot in the set shows a Messages entry point, a super-admin-only data point, or another organisation's identity leaking into the current visitor's card.
10. If the reviewer captures the design file's `work`/"Your brief" step or its cream "Ready for day one"/first-run-checklist screens, they are labelled clearly as "design file only, not in the shipped port" rather than reviewed as if they were live.
