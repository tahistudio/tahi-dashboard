# Auth group — design requirements

Group: auth (audience: public / anyone with a browser and no session yet).
Routes: `/sign-in`, `/sign-up`, `/continue`, forgot password, verification, invite accept.
Source: CLAUDE.md, STATUS.md (Since the last update, 2026-09-10 to 2026-09-13), TASKS.md (Tier 1, T0/T1 sprint, LW block, Batch A), `docs/superpowers/plans/2026-09-13-page-catalogue.md` section 2c and 3, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, live code in `app/(auth)`, `middleware.ts`, `lib/workspace-choice.ts`, `lib/onboarding-invites.ts`, `app/api/portal/accept-invite`, `app/api/admin/team/accept-invite`, `e2e/auth-path.spec.ts`, and the Claude Design files `Tahi Auth.html` / `auth-app.jsx` / `auth.css` (project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66).

---

## 1. Purpose and audiences

This group is the single door every person walks through before they are anyone in the product: a Tahi teammate, a client contact, or a stranger who has not been invited at all. It has three jobs: authenticate a returning person (`/sign-in`), create a session for a new person (`/sign-up`), and resolve a signed-in session that has no active Clerk organisation yet onto the right workspace (`/continue`). Nothing here is client-scoped or admin-scoped in the product sense, because nobody has a role yet; the audience is "logged out" or "logged in but homeless."

What this group does not decide: which workspace a person lands in once resolved (that is `/overview` for a teammate, the client portal for a contact, `/onboarding` for a genuine lead), and what that workspace shows. This group must never leak into that decision by rendering client data, org names beyond a self-chosen workspace in the multi-org picker, or admin-only navigation. It must never show:
- Any organisation's requests, invoices, financials, or team roster. The auth card renders only Clerk's own form fields and Tahi's static marketing copy (testimonial, trust avatars) plus, on `/continue`, the signed-in user's own membership list (their own name and their own org names only — never another user's).
- The Messages-hidden-for-clients rule does not apply here (Messages is a dashboard nav item, not present anywhere in this group), but the same discipline applies: no feature this group renders may imply an entitlement the person does not have yet. The `/continue` picker shows organisation name and role label only, nothing about plan, billing, or health.
- Super-admin-only areas (Settings, danger zone, impersonation) are never referenced or linked from here. The footer link on `/continue` ("Not where you expected to be? Start onboarding") is the only escape hatch, and it goes to `/onboarding`, never to a dashboard route.
- Tenancy: `/continue` reads the real Clerk membership list client-side and activates one org via `setActive`; it must never let the person pick or type an org id that is not on their own membership list. That decision lives in `lib/workspace-choice.ts`, already isolated and unit-tested from Clerk/React so it can be audited on its own.

---

## 2. Pages, sub pages and entry points

**`/sign-in`** (`app/(auth)/sign-in/[[...sign-in]]/page.tsx`). Reached from the bare domain root when signed out (middleware redirects `/` → `/sign-in`), from any protected route hit while signed out (`redirect_url` query param preserves the destination), from the `/sign-up` footer link, and from the `/continue` "Wrong email"/back paths inside Clerk's own multi-step flow. Clerk's catch-all `[[...sign-in]]` route means every sub-step (password, forgot-password, reset, OTP) renders as a URL under `/sign-in/...` via Clerk's own client-side routing (`routing: 'path'`), not as separate Next.js pages.

**`/sign-up`** (`app/(auth)/sign-up/[[...sign-up]]/page.tsx`). Reached from the `/sign-in` footer link, from marketing/sales entry points (not part of this group), and same catch-all pattern: email verification (OTP) renders at `/sign-up/verify-email-address` under the same page via Clerk path routing.

**`/continue`** (`app/(auth)/continue/page.tsx` + `continue-content.tsx`). The one page in this group not backed by a Clerk widget — it is Tahi's own React component inside the same `AuthShell`. Reached only by the middleware, and only when a signed-in session (`await auth()`) has no active `orgId`. Three states render inside the same shell without a URL change: a loading spinner ("Opening your workspace"), a "Choose a workspace" list (when the person holds 2+ memberships and none is the Tahi org), and (implicitly, before either renders) an instant pass-through when there is exactly one membership or the Tahi org is one of them — the person never sees this page in that case, it activates and forwards in one paint. A `?next=` query param (set by the middleware) carries the original destination through; a stranded-after-6-seconds state offers "Taking too long? Continue to onboarding" as an escape hatch.

**Forgot password.** Not a separate route — a step inside `/sign-in`'s Clerk widget, reached by clicking "Forgot your password?" on the password field once an identifier has been entered. Verified in code and in `e2e/auth-path.spec.ts` (T1.3, done 2026-09-13): Clerk's catch-all keeps this in-shell, styled by the same `.cl-*` CSS. The design prototype (`auth-app.jsx`) names this step `forgot` and `reset` as two screens: "Forgot password?" (email entry) then "Reset your password" (6-digit code + new password).

**Verification.** Not a separate route — the email OTP step inside `/sign-up`, reached automatically after submitting the sign-up form. Renders at `/sign-up/verify-email-address` via Clerk path routing. Design names this screen `verify`: identity preview with an "Edit" link back to sign-up, 6-box OTP input, resend-with-countdown.

**Invite accept.** Not a page in this group's own tree. The actual UI lives at `/onboarding?token=...` (client invites) and `/welcome?token=...` (team invites) — both under `app/(onboarding)/`, a separate page group with its own design requirements owner. What belongs to *this* group is the auth-adjacent handoff: middleware persists the invite token into an httpOnly cookie (`tahi-invite-token`, 1 hour) when a signed-out person hits `/onboarding` or `/welcome` with a `?token=`, then bounces them to `/sign-in?redirect_url=...` so the token survives the sign-in/sign-up round trip; on return, `/onboarding` or `/welcome` recovers the token from the cookie and calls `POST /api/portal/accept-invite` or `POST /api/admin/team/accept-invite`. This group's design responsibility is limited to: the sign-in/sign-up card rendering correctly when arriving via that redirect (no different visually today — same card, same copy), and confirming nothing here strips or exposes the token. **Proposal**: a one-line trust cue on the sign-in/sign-up card when arriving with a pending invite ("You're accepting an invite to Giant Group" or similar) is not in the backlog today; flag as a nice-to-have, not a requirement.

**Dead reference found in code, not a real route**: `lib/email-previews.ts` and one committed test build sample invite URLs as `/accept-invite?token=...`. No page or redirect exists at `/accept-invite` anywhere in `app/` or `next.config.ts`. The real, production-used link builder (`lib/onboarding-invites.ts` → `invitePath()`) correctly emits `/onboarding?token=...` or `/welcome?token=...`, so live emails are not broken — only the preview-sample data and one email-template test use the wrong path. Not a design-review blocker for this group; worth a one-line backend fix ticket, not invented here as a design requirement.

---

## 3. States and variants

**`/sign-in`**
- Loading: Clerk widget shows a centred spinner (`ClerkSignIn` polls `clerk.loaded`) before mount; roughly instant.
- Populated: email + password fields, Google OAuth button, "Forgot your password?" link, footer switch to sign-up.
- Error, inline: field-level error under email or password (red border + icon + text), e.g. "Enter a valid email address."
- Error, page-level: a banner above the form for wrong credentials, styled `cl-alert`.
- OAuth interstitial: "Connecting to Google…" spinner replaces the card body.
- Loading, submit: primary button shows a spinner + "Signing in…", disabled.
- Empty state: not applicable — a form has no empty state, only unfilled fields.
- Read-only client view: not applicable, no session exists yet.
- Member vs admin seat: not applicable — the form is identical regardless of who is about to sign in; the distinction is resolved after, at `/continue`.
- 375px: single column, forest scene collapses to a 300px top band (wordmark hidden, trust row hidden), card pulls up -24px to overlap the seam, condensed trust line appears under the card. Verified by `e2e/auth-path.spec.ts` (no horizontal scroll, 44px minimum touch targets on the identifier field).
- 768px: same breakpoint bucket as 375 today — the shell's single responsive breakpoint is 1024px (`64rem`), so 768px renders the mobile layout, not an intermediate one. Flag this as worth checking visually in the review; there is no dedicated tablet treatment.
- Dark mode: the card is deliberately theme-pinned to light tokens regardless of the visitor's saved `tahi-theme` preference (verified live and by e2e: `.dark` can be on `<html>` while the card still renders `rgb(255, 255, 255)`). The forest scene is always-dark by design, like the sidebar. So "dark mode" for this page means: confirm the card stays light and legible even when the rest of the site is dark, not that the page grows a dark variant.
- Print: not applicable.

**`/sign-up`**
- Same state list as `/sign-in`, plus: legal line ("By continuing you agree to our Terms and Privacy Policy.") always visible under the form, first/last name fields, and the verification (OTP) step reached after successful submit.
- Verification sub-state: identity preview chip with an "Edit" link, 6-digit OTP grid (each box ≥44px per the e2e assertion), resend-with-countdown row, its own inline/page error states.

**`/continue`**
- Loading (default): spinner + "Opening your workspace" + "This usually takes a second." No CTA for the first 6 seconds.
- Stranded (after 6s with no resolution): same loading visual plus a "Taking too long? Continue to onboarding" link appears.
- Pick (2+ memberships, none is the Tahi org): "Choose a workspace" heading, list of orgs (name + role chip), a "None of these are mine" link to `/onboarding`. Each row is a ≥44px button with a spinner on the one being activated.
- Failed activation: red inline text ("That did not open. Try again, or pick another workspace.") above the list, list stays interactive.
- Empty (zero memberships): never rendered as a page state — the pure function resolves this to an immediate redirect to `/onboarding` before any UI paints.
- 375/768: same `AuthShell` responsive rules as sign-in/sign-up (forest scene collapses, card pulls up). Not covered by any e2e spec today — gap.
- Dark mode: same theme-pinned card as the other two pages; not explicitly e2e-covered for this page — gap.

**Forgot / reset steps**: loading (spinner + "Sending…" / "Updating…"), inline errors (invalid email, code, password), success is implicit (Clerk moves the person to sign-in or a signed-in state). e2e (`auth-path.spec.ts`) proves the forgot-password step is reachable and on-brand up to the point of code entry; the actual reset completion is never exercised live (T1.3's one remaining manual step, A5).

**Verification step**: loading (spinner + "Verifying…"), inline error (wrong/incomplete code), resend countdown state (button disabled, "Resend code in 0:SS").

---

## 4. Features and actions

### `/sign-in`
**Works today**: Clerk email/password sign-in, Google OAuth, forgot-password reachable and correctly routed in-shell (not silently redirected out to a bare Clerk-hosted page), `redirect_url` preserves the original destination, Ship Studio dev-only auto-auth bypass (hard-gated out of production by `NODE_ENV`), the branded shell and every Clerk sub-step share one visual system via `tahiClerkAppearance` + scoped `.cl-*` CSS, mobile layout with 44px targets pinned by e2e.
**Exists but wrong or half built**: T1.3's one remaining item — a human (Liam or Staci) has never actually clicked all the way through forgot-password to a completed reset on the live Clerk build; code and e2e prove reachability and branding only, not the full email-round-trip. This is A5 step 17 in the real-session lap (STATUS.md, still open as of 2026-09-13).
**Planned or missing**: nothing named in TASKS.md beyond T1.3's manual step. No further work is scoped for this page.

### `/sign-up`
**Works today**: Clerk email/password + Google OAuth sign-up, branded OTP verification step with correct wording sourced from `ClerkProvider` localization (`app/layout.tsx`), legal line with working Terms/Privacy links, footer switch to sign-in.
**Exists but wrong or half built**: same T1.3 residue as sign-in (branded states verified in code/e2e, not yet human-clicked live end to end for this flow specifically beyond OTP, which the e2e spec does exercise).
**Planned or missing**: none named beyond T1.3.

### `/continue`
**Works today**: the core bug this page exists to fix — AU.1, live since 2026-09-07 — a fresh sign-in with no active Clerk org resolves via the real membership list instead of guessing "lead," so a co-founder accepting a studio invite no longer lands in client onboarding. `resolveWorkspaceChoice` is a pure, unit-tested function (`lib/__tests__/workspace-choice.test.ts`) covering: single membership auto-activates, Tahi org wins when present alongside a client org, 2+ non-Tahi memberships trigger the picker, zero memberships routes to onboarding, an already-active org redirects straight through. `safeNextPath` rejects protocol-relative and backslash-prefixed `next` values and refuses to loop back to `/continue` itself.
**Exists but wrong or half built**: T1.4 (invited-client onboarding operable) is marked done 2026-09-13, but its own note says "second seat linking already covered by 34 tests" as the closure evidence — the underlying webhook-backfill concern the catalogue still lists (`docs/superpowers/plans/2026-09-13-page-catalogue.md` row 85: "second-seat contacts stick at this gate because no Clerk webhook backfills them") has not been re-verified against `/continue` specifically since that close. Treat as **exists, recently changed, not yet re-audited against this exact page** rather than confirmed broken.
**Planned or missing**: the A5 real-session lap (STATUS.md, TASKS.md) is the only proof of the greeting, the bell, the invite path and the second seat working end to end on a real account, and it is explicitly still open, owned by Liam or Staci, 20 minutes, incognito. No design-only gap is named for this page beyond that operational proof. Also missing from earlier passes: **T1.17** (Hire onboarding path) is a direct consequence of this page's own resolution rule, not just an onboarding-group concern. `resolveWorkspaceChoice` activates the Tahi org whenever it is present on the membership list, and the admin check downstream is only `orgId === tahiOrgId`, with no `teamMembers` row check. So a hire who accepts a Tahi Clerk org invite and signs up lands here, `/continue` auto-activates the Tahi org (correct per its own contract), and the person gets full admin (all financials) despite having no `teamMembers.clerkUserId` link, because no Clerk webhook and no accept-invite path (`flow: 'team'` is rejected) ever create one. T1.17's fix (verified-email backfill, invite-gated team writes) lands outside this group, but the exposure surfaces the moment `/continue` does its job, so it belongs in this page's own risk list.

### Forgot password / verification (shared across sign-in / sign-up)
**Works today**: reachable, correctly routed, branded per T1.8 (design-consistency pass, done 2026-09-13 — "the auth shell already carries the branded error and verification states... verified, no source change needed").
**Exists but wrong or half built**: nothing named.
**Planned or missing**: nothing named beyond T1.3's manual click-through.

### Invite accept (the handoff only, per section 2's scope note)
**Works today**: token survival cookie set by middleware on `/onboarding` or `/welcome` hits while signed out; `POST /api/portal/accept-invite` enforces email-binding to the invite's verified `contactEmail`, atomic single-use claiming, expiry, and a carefully reasoned ownership rule (an org with no admin promotes the accepting person only if the roster is empty or they match the primary contact — never simply "first to click"); `POST /api/admin/team/accept-invite` is the teammate-facing counterpart.
**Exists but wrong or half built**: T1.20 — the *teammate* invite token path (`flow: 'team'`) has zero real callers today (seat invites for team hires go through a different, working path per LW.18/T1.20's note: "Lower priority than T1.17 (the Clerk-invite path supersedes the token flow for hires)"), and `/welcome`'s `resolveToken` is a stub returning `null`, so the welcome page hardcodes fake personalisation (role "New teammate", gear "MacBook Pro 16", buddy "Liam Miller") for every hire. This is squarely inside `(onboarding)`'s page group, not this one, but it is the reason a token-bearing link into this group's sign-in/sign-up could dead-end downstream.
**Planned or missing**: T1.20 (implement `resolveToken` against `onboardingInvites` or drop the fake personalisation) — owned by the onboarding group, noted here only because its failure mode starts at this group's door.

---

## 5. Data and integrations

- **Clerk** is the entire authentication backend for `/sign-in` and `/sign-up`: `@clerk/nextjs` client-side widgets (`ClerkSignIn`, `ClerkSignUp` in `components/tahi/clerk-mount.tsx`), `ClerkProvider` with `localization` overrides in `app/layout.tsx`, `clerkMiddleware` in `middleware.ts` gating every non-public route. No Tahi-owned password storage, no Tahi-owned email-verification logic.
- **`/continue`** reads `useAuth()` and `useOrganizationList()` (Clerk hooks) client-side, calls `setActive({ organization })`, then does a full `window.location.assign` (not a client-side route push) so the new session token reaches the edge middleware, which is what actually decides admin-vs-client audience.
- **`middleware.ts`** owns: the public-route allowlist (this group plus `/p/*`, `/api/public/*`, webhook/cron endpoints), the bare-root redirect, the invite-token-cookie handoff for `/onboarding` and `/welcome`, and `resolveNoOrgRedirect` (from `lib/workspace-choice.ts`) which sends any no-org page request to `/continue?next=...` while letting `/api/*` self-guard.
- **`lib/workspace-choice.ts`** is a pure, dependency-free module (no Clerk import, no fetch) — the single source of truth for the org-resolution decision, deliberately kept testable in isolation.
- **`onboardingInvites` table** (via `lib/onboarding-invites.ts`) backs the invite-accept handoff: token minting, expiry (`INVITE_EXPIRY_DAYS = 14`), and `resolveInvite()` used by both accept routes.
- **`contacts` and `organisations` tables** (D1, Drizzle) are written by `POST /api/portal/accept-invite`: contact linking, `portalRole` promotion logic, lazy Clerk-org creation on first accept.
- Nothing on this page group must ever show a fabricated number or a dead button: the Google OAuth button, forgot-password link, and resend-code button are all real Clerk actions; the only cosmetic-only element is the trust-avatar stack (`TAHI_TRUST_AVATARS` in `lib/auth-shell-config.ts`), which uses placeholder stock photos — flagged in the code's own comment as "swap for real client faces/logos when available," not a lie about functionality but a placeholder worth naming to the designer.

---

## 6. Design system contract

- **Primitive**: `<AuthShell>` (`components/tahi/auth-shell.tsx`) is the only primitive this group uses — a bespoke two-column scene (58/42 split desktop, stacked mobile) that is *not* the standard dashboard `PageHeader` / left-rail / `DataTable` vocabulary, and that is correct: this is a pre-login, pre-tenancy surface with its own locked visual language ("Studio Ledger" forest scene), matching the sidebar's always-dark-hardcoded exemption named in CLAUDE.md.
- **Leaf radius**: used correctly — the card is `0 1.5rem 0 1.5rem` (`--radius-leaf-lg` equivalent) desktop, `0 1.25rem 0 1.25rem` mobile; the pill badge uses the small leaf radius. Primary CTA (Clerk's `cl-formButtonPrimary`) is `.5rem` radius, not leaf — worth a design-review question (see section 7).
- **Tokens**: the card intentionally hardcodes a light-only token set as inline CSS custom properties scoped to `.tahi-auth-card` (documented in the component's own comment as "theme-pin... so it never flip[s] with the app theme"). This is a deliberate, documented exception to CLAUDE.md's "always use CSS var references" rule, not an oversight — the design review should confirm this reasoning still holds rather than flag it as a violation.
- **What the existing design file gets right** (`Tahi Auth.html` / `auth-app.jsx` / `auth.css`): a faithful, self-contained clickable prototype that mirrors the live component structure almost 1:1 (same `cl-*` class names, same scene/copy data, same CSS custom properties), covering sign-up, sign-in, verify, forgot, reset, inline field error, page-level error, submit-loading, OAuth-connecting, and success/redirect as named, jumpable states in its own prototype menu ("Screens & states"). This is unusually close to the shipped code already — closer than most of the other groups in the checklist, which is why the catalogue marks this row "not critic-covered" rather than FIX or REDO: nobody has needed to re-verdict it.
- **What the design must add or change**: the design file has **no `/continue` screen at all** — no loading state, no "Choose a workspace" picker, no stranded/escape-hatch state, no failed-activation state. This is the one real gap between the design file and the live page, and it is the page most likely to be seen by a real person soon (every second-seat client contact and every dual-membership teammate hits it). The design file also has no explicit dark-mode-visitor state (not required functionally, per section 3, but worth one frame proving the card stays light against a dark `<html>`), and no mobile-frame captures of the picker list specifically. The Claude Design checklist row for this group ("Sign in, sign up, forgot password, invite accept") has never been ticked — Review column is blank — so this document is the first pass at a verdict, and the recommendation is **FIX**, scoped to: add the `/continue` screen (loading, picker with 2+ orgs, stranded, failed) to the prototype; everything else in the file is close enough to ship as reference.

---

## 7. Open questions for Liam

1. Should the primary CTA button (`cl-formButtonPrimary`) pick up the leaf radius like the card does, or is the current `.5rem` rounded-rect intentional (Clerk-widget buttons staying visually distinct from Tahi-native buttons)?
2. Is a "You're accepting an invite to [Org Name]" trust cue on the sign-in/sign-up card (when a `tahi-invite-token` cookie is present) worth building, or is the current silent handoff fine? (This is a proposal, not in the backlog.)
3. Does `/continue`'s "Choose a workspace" picker need a design pass now, or can it stay unstyled-by-comparison (it already uses Tahi tokens and the `TahiButton` component, just never appeared in the Claude Design file) until a dual-membership person actually reports friction?
4. Is the 1024px single breakpoint (desktop vs. everything else) acceptable for this group long-term, or does the design need an explicit tablet (768px) treatment distinct from phone (375px)?

---

## 8. Acceptance for the design review

1. At 1440px light, `/sign-in` and `/sign-up` show the 58/42 forest-scene/card split with the wordmark, pill, headline, testimonial and trust-avatar row all visible on the scene side.
2. At 1440px light, the card itself never shows Clerk's own default footer (hidden by `tahiClerkAppearance`); the "Sign in"/"Sign up" switch row at the bottom is Tahi's own link, not Clerk's.
3. At 375px, the forest scene collapses to a top band with the wordmark hidden, the card overlaps the seam, and every visible input and button is at least 44px tall with no horizontal scroll.
4. At 375px light and dark (`tahi-theme` set to dark in localStorage before load), the auth card itself stays on light tokens (white background, dark text) in both cases — the scene stays always-dark in both cases.
5. The forgot-password step, reached from `/sign-in`'s password field, keeps the same card chrome (leaf-radius corners, same padding, same font) as the sign-in step it replaced — no visual seam.
6. The OTP verification step shows 6 individually boxed digits at ≥44px each, an identity-preview chip with a working "Edit" link back to the previous step, and a resend-countdown row.
7. `/continue`'s loading state renders inside the same `AuthShell` (forest scene + card), not a bare unstyled spinner — screenshot it mid-resolution if the review environment allows forcing 2+ memberships.
8. `/continue`'s "Choose a workspace" list (when forced to render) shows each organisation as a ≥44px full-width row with name, role label, and no more than one row highlighted/spinning at a time.
9. No screen in this group at any breakpoint or theme renders a client-org name, an invoice figure, a request, or any other tenant data — only the signed-in user's own membership list on `/continue`, and only static marketing copy everywhere else.
10. The legal line on `/sign-up` and its two links (Terms, Privacy) render at both 1440 and 375 without wrapping into the form fields above it.

