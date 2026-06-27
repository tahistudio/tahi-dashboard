# Auth pages - design brief (sign-in + sign-up)

> Research-backed brief for Claude design. Prepend `_studio-ledger-theme.md` when prompting.
> Generated 2026-06-27 from a 5-lens research + synthesis pass. This is also the TEMPLATE for every later page brief.

## As built (implemented 2026-06-27)

What actually shipped, so future briefs reflect how we really build. The brief below is the rationale; this is the reality.

- **Approach.** Mounted Clerk widget (`ClerkSignIn` / `ClerkSignUp` via `components/tahi/clerk-mount.tsx`) inside our `AuthShell` scene (`components/tahi/auth-shell.tsx`). We did NOT use Clerk Elements (the brief's pixel-perfect option) - the mounted widget plus scoped `.cl-*` CSS matched the final design and kept the edge-safe mount we already rely on, with no new dependency. Theming lives in the scoped `.cl-*` CSS block in `auth-shell.tsx` (more reliable than Tailwind-in-appearance); `tahiClerkAppearance` only sets social-buttons-on-top and hides Clerk's footer.
- **Per-step headings via localization.** Clerk owns the card heading; wording is set in `ClerkProvider` `localization` (`app/layout.tsx`): sign-up "Create your workspace" / "Takes about a minute.", verify "Check your email" / "Enter the 6-digit code we just sent you.", sign-in "Welcome back" / "Sign in to pick up where you left off."
- **Email verification.** Enforced by the Clerk dashboard setting (email code). The mounted widget renders the OTP step automatically and we style it; no code gates it ourselves.
- **Scene + card.** Studio Ledger forest panel (always-dark, hardcoded) plus a floating white card theme-pinned to light tokens (survives a dark-mode-saved visitor). Contrast fixes applied: primary button `--color-brand-dark` (not `--color-brand`), inputs use `--color-border-strong`. `overflow:visible` on the Clerk wrappers fixed the Google-button corner clipping. Mobile: forest collapses to a centred band with the wordmark hidden; card overlaps the seam -24px.
- **Neon leaf scene motif (final).** The brief's ambient layering (drifting radial glows + a slow sheen sweep, Motion section below) was replaced by an animated `NeonLeaf`: the brand leaf, sampled into ~340 points and drawn on a `<canvas>` (`.ta-neon`) as a glowing neon line. It draws itself on first paint (~2s reveal) and brightens along the path under the pointer, over a soft green bloom (`.ta-nbloom`) bottom-right; static grain retained. It reads `prefers-reduced-motion` in JS and paints fully drawn, skipping the reveal. This is the canonical scene treatment; the glow/sheen description in the Motion section is superseded.
- **Copy as shipped.** Pill "Your workspace"; sign-up headline "Your project, start to finish, in one place." plus sub "From the first brief to the final invoice, you can always see where things stand."; sign-in "Welcome back." plus "Your project, right where you left it." Testimonial: Evan Kwan, Marketing Manager, Physitrack (real, ICP-grade). Trust line "Trusted by some of the biggest companies." with a "+40" stack. Reassurance/helper lines were removed at the user's request. Footer switches sign-in to sign-up and back. Legal points at `/terms` and `/privacy`.
- **Deviations / deferred.** No custom OAuth interstitial or success card (Clerk handles the redirect). First/last name fields appear only if the Clerk instance is set to collect them (dashboard setting, not code). The trust stack uses placeholder profile photos (the `TrustAv` component renders a photo, a "+N" chip, or a colour-swatch fallback) - swap in real client faces/logos later. Live smoke on the deployed URL (mobile 375px + dark mode) still pending per Definition of Done.
- **Files.** `components/tahi/auth-shell.tsx`, `app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `app/(auth)/sign-up/[[...sign-up]]/page.tsx`, `app/layout.tsx`. Design source: Claude design project `57bf60cf` ("Tahi Auth").

---

## Page purpose

`sign-in` and `sign-up` are the two routes in the `(auth)` route group: `app/(auth)/sign-in/[[...sign-in]]/page.tsx` and `app/(auth)/sign-up/[[...sign-up]]/page.tsx`. Both render a shared scene shell (`components/tahi/auth-shell.tsx`) that wraps a Clerk widget mounted via `components/tahi/clerk-mount.tsx`, themed through a single `tahiClerkAppearance` config. They sit before everything: a visitor cannot reach `/overview`, the portal, or any dashboard surface without passing through here. Clerk handles org routing invisibly after auth (admin org -> admin dashboard, any other org -> client portal).

They are the same shell doing two different jobs:

- **`sign-up` is persuasion and arrival.** It is the screen a brand-new client lands on, often minutes after signing a contract worth up to NZD 100,000, usually via a personalised invite link. It must sell while it gates: confirm the decision, frame the relationship, and collect the absolute minimum (name, email, password, or Google). It carries the extra email-verification-code step that Clerk requires to complete account creation.
- **`sign-in` is recognition and re-entry.** It is the daily door for returning clients and Tahi team members. It must be the fastest thing on screen, lead with the last-used method, and never re-pitch a person who is already sold. Narrative recedes to ambient brand.

The hard constraint that shapes every spec below: **Clerk renders all actual form fields** (`mountSignIn` / `mountSignUp`). We do not build inputs. We design (a) the surrounding forest scene and floating card shell, which is fully our code, and (b) how the Clerk-rendered elements look and behave via class overrides in `tahiClerkAppearance`. Real flows (Google OAuth redirect, email verification, forgot password, MFA) are Clerk-owned states we account for, never custom forms we invent.

## Why we are on this page

The functional goal is trivial: authenticate the user and route them correctly. The emotional goal is the entire point.

A client who just committed six figures arrives in a buyer's-remorse-adjacent state: the high of committing, shadowed by a quiet "did I just do the right thing?" They are not impatient, they are *evaluating*, and they form a durable quality judgment in the first 7-10 seconds that then acts as a confirmation-bias lens over the whole relationship. A janky form here is a hairline crack in a very expensive promise. A calm, considered screen makes them read every later interaction as calm and considered.

The north-star is **"they know exactly why they are here."** This is not a generic login. The scene names the destination ("The studio workspace"), frames the relationship ("Start your project the calm way"), shows peers already inside (a real testimonial, an avatar stack, "Trusted by independent studios across Aotearoa"), and hints at the value they bought (track requests, message the team, see delivery, pay invoices in one calm place). The client should feel *arrival*, not a gate, and *expected*, not processed.

**The single experiential throughline, which every element must serve or be cut:**

> You are in good hands - calm, capable, and unmistakably premium.

If the new $100k client exhales when they land, the page worked. Premium here is communicated through restraint, steadiness, and editorial confidence, never through busy-ness. The page should lower the user's heart rate, not raise it.

## Personas and jobs-to-be-done

**1. The new high-ticket client (the wow moment).** A founder, marketing lead, or ops director who just signed a tens-of-thousands contract and arrived via a personalised invite, often within minutes.
- *Mindset:* hyper-alert to quality signals, evaluating, quietly seeking reassurance they chose right.
- *JTBD:* "Create my account and show me the room I just bought a key to - that this is real, organised, and worth what I paid."
- *Must see:* the forest panel doing the work before they touch a field (wordmark, pill, relationship headline), a peer testimonial, a one-line glimpse of what is inside, the "Made in NZ" trust row.
- *Must feel:* relief and pride. Like being handed a beautifully bound welcome folder, not paperwork.

**2. The returning client (calm re-entry).** An existing client checking a status, an invoice, a message, mid-project.
- *Mindset:* mild, task-focused, slightly time-pressed, zero appetite for ceremony. The brand no longer needs to sell; any friction is now cost.
- *JTBD:* "Get me back to my project in two taps."
- *Must see:* email/password or Google immediately, the remembered/last-used method first, an obvious primary button, no layout shift.
- *Must feel:* frictionless familiarity. "Oh good, home."

**3. The Tahi team member (utility and trust).** A Tahi designer, PM, or admin signing into the same surface daily to run the agency.
- *Mindset:* pure utility, wants in fast on any device, and subconsciously wants to feel proud of the thing they sell.
- *JTBD:* "Authenticate and get to work - and don't make me look bad in front of clients who see this same screen."
- *Must see:* the same fast Google/SSO path, no client-only copy that feels wrong for staff, zero flicker, correct invisible routing.
- *Must feel:* quiet confidence in their own product. "This holds up."

**4. The prospect / curious visitor (first taste).** Someone who followed a referral or proposal link, not yet a client, comparing.
- *Mindset:* curious, slightly guarded, will judge the whole agency on this one screen.
- *JTBD:* "Understand what this is and whether these people are my calibre, without being forced to commit."
- *Must see:* a self-explaining frame (pill + headline + subcopy answers "what is this" in under three seconds), proof of the league the agency plays in, a graceful switch link so curiosity has somewhere to go.
- *Must feel:* intrigued and aspirational. A beautifully lit shopfront at night - closed to them for now, unmistakably premium.

**The tension to resolve:** persona 1 needs the panel to *speak*; persona 2 needs it to *whisper*. **The call:** the form is always instantly usable and never gated behind the narrative. The forest panel is rich but passive - it rewards a glance, never demands a read. `sign-up` leans the narrative warmer and louder; `sign-in` dials the headline down to a single quiet line and keeps only the testimonial.

## Experience principles

1. **The form is the hero, the scene is the world.** The dark panel owns all colour and atmosphere; the white card stays near-monochrome and effortless. Proof persuades on the panel, the form converts in the card, and the two jobs never mix. *(Studio Ledger: contrast of rich world / clean tool.)*
2. **Restraint is the luxury.** Brand-green appears in at most three places on the light side (primary button, focus ring, one tiny accent). The leaf radius is rare. Hairlines over heavy cards. Whitespace does the work. Scarcity is what makes green read as a signature, not decoration.
3. **Never gate the door behind the pitch.** Both auth methods are equally prominent, the sign-in/sign-up switch is always one obvious click, and the form is usable the instant the page paints. Returning users get speed; new users get story; nobody gets trapped.
4. **Calm motion or none.** Animate one thing slowly (a 20-30s gradient drift, a 12-20s sheen), never many. No bounce, no spring, no fast. Grain is static. Motion should read as "alive and expensive," and fully yields to `prefers-reduced-motion`.
5. **Figures and provenance as the premium tell.** Numbers set large and tabular where they appear; "Made in Aotearoa / your data stays here" as a genuine trust asset, not flag-waving. This is the anti-generic moat a template cannot fake.
6. **Forgiving, specific, quiet.** Validate on blur and submit, never on first keystroke. Errors sit inline under the field as a hairline, never a red alert block. Reassurance copy is editorial and plain, never exclamatory.
7. **Accessible is premium.** 44px targets, visible focus rings, real labels, 4.5:1 contrast on both worlds. Senior buyers sign up on phones between meetings; a screen that fails them signals the product will too.

## What is on the page and why

**Scene / brand side (our code, the dark forest panel):**

- **Tahi wordmark, top-left.** Orients instantly and anchors brand. Has a real text alt ("Tahi Studio"); it is the one named (non-decorative) brand element.
- **Pill badge "The studio workspace" with a leaf.** Names the destination in three words so persona 4 understands "what is this" with no login, and persona 1 feels arrival. One of the rare leaf-accent moments.
- **Headline, large and tight.** Frames the *relationship*, not a feature ("Start your project the calm way."). Loud on `sign-up`, reduced to one quiet line on `sign-in`.
- **One line of subcopy.** A single promise of what the workspace does. Restraint - one sentence, never a paragraph.
- **Glass testimonial card.** A real, named quote from a peer studio/brand founder with a real avatar, role, and company. A specific named voice out-converts a star rating for a high-consideration purchase, and tells persona 1 and 4 that people like them are already inside.
- **Trust footer row.** An overlapping avatar stack (4-5 + "+N"), "Trusted by independent studios across Aotearoa," and a discreet "Made in NZ" mark. Identity-based proof ("studios like me use this") plus provenance, the boutique's credible flex.

**Form side (Clerk-rendered, themed by us; floating white card):**

- **Card heading + subhead.** Modest, because the panel already did the selling ("Create your workspace" / "Welcome back").
- **"Continue with Google" button, first, full-width.** SSO removes password-creation friction entirely and signals modern infrastructure; placed as a peer to the form, not a footnote.
- **"or" hairline divider.** The universal premium separator between SSO and fields.
- **Fields.** `sign-up`: Full name, Email, Password. `sign-in`: Email, Password. Minimum viable set; company and role are collected later via progressive profiling inside the dashboard.
- **Primary submit, brand-green, full-width.** One confident action ("Create your workspace" / "Sign in").
- **Forgot-password link** (sign-in) and **password reveal toggle** (both).
- **One fine-print reassurance line under the CTA** (no card / privacy / time expectation) and **legal microcopy** with real links.
- **Footer switch link.** The always-present route between sign-in and sign-up.

**Deliberately left OUT:**

- No company size, phone, role, or "how did you hear about us" on the auth screen - collected later, personally or in onboarding.
- No confirm-password field (the reveal toggle replaces it).
- No generic logo wall unless logos are genuinely recognisable to NZ studios.
- No live counters, "1,247 signed up today," urgency timers, or scarcity badges - volume signals cheapen a high-ticket boutique.
- No padlock-icon security theater; trust comes from the row and one plain privacy line.
- No testimonials, badges, or proof inside the white card - the card only converts.
- No pre-ticked consent, buried opt-outs, or upsell interstitials. None, ever.
- No magic-link-as-default; these accounts touch billing, so password + optional MFA stays primary.

## Layout and composition - desktop

A two-column split on the cream canvas. The dark panel and the white card are the only two structural elements; the card floats and overlaps the seam.

**Proportions and grid:**
- Viewport split: **panel 58% / form column 42%** at `>=1024px` (the panel earns the larger share because at this tier the scene is the differentiator). At `>=1440px` cap the form column so the card never exceeds **`480px`** wide; extra width goes to the panel.
- Page background: `var(--color-bg-cream)` `#F7F6F3`. The form column sits on this cream; the card floats on top of it.
- The white card overlaps the panel/cream seam by **`-32px`** (negative margin into the panel) so it reads as a physical object resting on the scene. This single overlap is the cheapest "designed, not templated" signal.

**Panel internal layout (vertical rhythm, `64px` padding desktop):**
- Top: wordmark (top-left), pill badge below it.
- Upper-middle: headline, then subcopy. Vertically the headline block sits at roughly the optical centre-top (about 38% down).
- Lower-middle: glass testimonial card.
- Bottom: trust row pinned to the panel footer.

**Card internal layout (`40px` padding desktop, `--radius-leaf-lg` = `0 1.5rem 0 1.5rem`):**
- Heading + subhead, `24px` gap to the Google button, Google button, `24px` to divider, divider, `24px` to first field, fields stacked `16px` apart, `24px` to primary button, `12px` to reassurance line, `16px` to legal, hairline, `20px` to footer switch.

**Spacing scale used throughout:** `4 / 8 / 12 / 16 / 24 / 32 / 40 / 64`.

+--------------------------------------------------------------+  cream #F7F6F3
|  FOREST PANEL  (58%)                  |   FORM COLUMN (42%)  |
| .......................................                      |
| : Tahi (wordmark)                    :                       |
| : [ leaf  The studio workspace ]     :   +---------------+   |
| :                                    :  -| Create your   |   |
| :  Start your project                : / |  workspace    |   |
| :  the calm way.                     :|  | Your studio.. |   |
| :                                    :|  |               |   |
| :  One calm place to brief, track    :|  | [G  Continue  |   |
| :  and receive your studio's work.   :|  |     with Google]  |
| :                                    :|  | ----- or -----|   |
| :  +-------------------------------+ :|  | Full name     |   |
| :  | "Calm, sharp, exactly the..." | :|  | [__________]  |   |
| :  | (o) Mereana K.  Founder, ...  | :|  | Email         |   |
| :  +-------------------------------+ : \ | [__________]  |   |
| :                                    :  \| Password  (o) |   |
| :  (o)(o)(o)(o)+12  Trusted by       :   | [__________]  |   |
| :  independent studios. Made in NZ   :   | [ Create your |   |
| :......................................   |   workspace ] |   |
|         ^ card overlaps seam -32px        | No card req.. |   |
|                                           | Terms Privacy |   |
|                                           | -------------- |  |
|                                           | Have an acct? Sign in
|                                           +---------------+   |
+--------------------------------------------------------------+

**Hierarchy (eye path):** wordmark/pill (orient) -> headline (frame) -> card heading -> Google -> fields -> green CTA. The DOM order places the card region first for keyboard users (see Accessibility) so the marketing column is not a tab detour.

## Layout and composition - mobile

Do not stack the full panel. Collapse to a **compact forest band** on top and the white card below, so the premium first-impression survives without pushing the form below the fold.

**Breakpoints:** mobile `<640px`, tablet `640-1023px` (band can grow / card centres at max `480px`), desktop split `>=1024px`.

**Mobile structure (375px reference):**
- **Forest band**, full-width, about `300-340px` tall: wordmark, pill, headline (smaller), one subcopy line. Grain kept, sheen optional. Testimonial and trust row do NOT vanish - they move *below* the card, condensed (one-line quote + avatar; avatar stack + trust line), so trust signals survive the smaller canvas.
- **White card**, full-width minus `16px` gutters, overlapping the band's bottom edge by `-24px`, `--radius-leaf-lg`, `24px` internal padding.
- Card contents identical order to desktop; inputs `>=48px` tall, `16px` font (prevents iOS zoom-on-focus), touch targets `>=44px`.
- Condensed proof block below the card, then legal/switch.

+---------------------------+
|  FOREST BAND              |
|  Tahi                     |
|  [ leaf The studio... ]   |
|  Start your project       |
|  the calm way.            |
|  One calm place to...     |
+---------------------------+
|  +---------------------+  | <- card overlaps -24px
|  | Create your         |  |
|  |  workspace          |  |
|  | [G Continue w/Google]  |
|  | ------ or ------    |  |
|  | Full name [_______] |  |
|  | Email     [_______] |  |
|  | Password  [____](o) |  |
|  | [ Create workspace ]|  |
|  | No card required.   |  |
|  | Terms . Privacy     |  |
|  +---------------------+  |
|  "Calm, sharp..." (o)     |
|  (o)(o)(o)+12 Trusted by  |
|  studios. Made in NZ.     |
|  Have an account? Sign in |
+---------------------------+

## Component spec

All field components are **rendered by Clerk** and themed only via class overrides in `tahiClerkAppearance` (in `components/tahi/auth-shell.tsx`). We never hand-build inputs. Where a value is a Clerk appearance key, it is noted. The card pins light tokens regardless of saved theme (see States and flows).

**Wordmark** (our code)
- Purpose: orient and anchor brand. Text alt "Tahi Studio".
- Tokens: `--color-text-on-dark` `#FDFDFC`. Size ~`20px`, weight 700, letter-spacing `-0.01em`.
- States: static. If linked to marketing home, needs a visible light focus ring.

**Pill badge** (our code)
- Purpose: name the destination; one rare leaf accent.
- Tokens: fill `rgba(255,255,255,0.06)`, 1px inner border `rgba(255,255,255,0.14)`, text `--color-text-dim-on-dark` `#DCE8D9` at `13px` weight 600, leaf icon in `--color-brand-light` `#7aab6b`. Radius `--radius-leaf-sm` (`0 .625rem 0 .625rem`). Height `28px`, horizontal padding `12px`.

**Headline** (our code)
- Purpose: frame the relationship.
- Tokens: `--color-text-on-dark`, weight 700, line-height `1.05`, letter-spacing `-0.02em`. Size: `sign-up` `clamp(2.25rem, 3vw, 3rem)`; `sign-in` `clamp(1.5rem, 2vw, 1.875rem)` (one quiet line). Two lines max.
- Semantic level: `<h2>` (the `<h1>` is the card heading).

**Subcopy** (our code)
- Tokens: `--color-text-dim-on-dark` `#DCE8D9`, `16px`, weight 400, line-height `1.6`, max-width `42ch`. One line/sentence. `sign-in` may omit.

**Testimonial / glass card** (our code)
- Purpose: peer-level proof, present before the form.
- Tokens: fill `rgba(255,255,255,0.05)`, 1px border `rgba(255,255,255,0.12)`, `backdrop-filter: blur(12px)`, radius `--radius-md` `.5rem`, padding `20px`. Quote `--color-text-on-dark` `15px` line-height `1.55`. Avatar `40px` circle (NOT leaf radius), name `--color-text-on-dark` 600, role/company `--color-text-dim-on-dark` `13px`. Real person, real name, never stock. Avatar `aria-hidden`; name/role real text.

**Trust footer row** (our code)
- Avatar stack: 4-5 `28px` circles, `-8px` overlap, 2px panel-coloured ring each, "+N" chip; stack is `aria-hidden`. Trust line + "Made in NZ" as real text, `--color-text-dim-on-dark` `13px`, must hit 4.5:1 on the gradient's lightest point.

**Form card** (our code shell, Clerk content inside)
- Tokens: background pinned `#ffffff` (light token, theme-locked), radius `--radius-leaf-lg`, shadow soft low-spread `0 24px 48px -24px rgba(26,25,20,0.18)` (not a hard drop), no internal shadows. Padding `40px` desktop / `24px` mobile. Overlaps seam.
- Clerk appearance: `card` and `rootBox` set to transparent/`box-shadow:none` so our shell owns elevation; `cardBox` background transparent.

**Card heading + subhead** (Clerk `headerTitle` / `headerSubtitle`)
- `headerTitle`: `--color-text` `#121A0F`, `text-2xl` (`24px`) weight 600, this is the page `<h1>`. `headerSubtitle`: `--color-text-muted` `#5D5B55` `14px`.

**Google / SSO button** (Clerk `socketButtonBlock` / `socialButtonsBlockButton`)
- Purpose: fastest path, first, full-width.
- Tokens: white fill, 1px `--color-border-strong` `rgba(26,25,20,0.16)` (NOT the 10% border - fails 3:1), text `--color-text` 500, radius `--radius-md`, height `48px`, real "G" logo with accessible name "Continue with Google". NOT leaf radius.
- States: hover bg `--color-bg-secondary` `#F4F3EF`; focus-visible 2px ring `--color-brand-dark` `#425F39`; active slight inset; loading shows "Connecting to Google..." (see flows).

**Divider** (Clerk `dividerRow` / `dividerText`)
- 1px `--color-border` hairline, centered "or" in `--color-text-subtle` `#63615B` `13px`. Not focusable.

**Name / Email / Password inputs** (Clerk `formFieldInput`, labels `formFieldLabel`)
- Purpose: minimum field set. Persistent visible labels (never placeholder-only).
- Tokens: height `48px`, `16px` text `--color-text`, white fill, 1px `--color-border-strong` border (perceivable at 3:1), radius `--radius-md` (NOT leaf - inputs stay calm), internal padding `12px 14px`. Label `13px` weight 600 `--color-text`.
- Autocomplete/types (verify Clerk emits, do not override): Name `type=text autocomplete=name`; Email `type=email autocomplete=email inputmode=email`; Password `autocomplete=new-password` (sign-up) / `current-password` (sign-in).
- States: default border-strong; **focus** 2px `--color-brand` ring + border `--color-brand` (focus ring is one of the 3 green moments); **error** border + ring `--color-danger` `#f87171` plus icon + text (never colour alone), input retains typed value; **disabled** `--color-bg-secondary` fill.
- Password reveal toggle (Clerk `formFieldInputShowPasswordButton`): eye icon, keyboard operable, state-aware name "Show password" / "Hide password", `>=24px` target, default hidden. Do not block paste.

**Primary submit** (Clerk `formButtonPrimary`)
- Purpose: the one confident action.
- Tokens: **`--color-brand-dark` `#425F39` fill** (not `--color-brand` `#5A824E` - the lighter green is ~4.0:1 with white text and fails 4.5:1; `brand-dark` is ~5.6:1). White text `16px` weight 600, full-width, height `48px`, radius `--radius-md` (leaf permitted as a rare signature - pick one and be consistent across the app).
- States: default; hover darken toward `--color-brand-deep` `#2A3626` over `200ms --ease-out`, no scale-bounce; focus-visible 2px ring offset; **disabled** until form minimally valid; **loading** inline spinner + label swap ("Creating your account..." / "Signing you in...") and stays disabled to prevent double-submit, `aria-busy`.

**Forgot-password link** (Clerk `formResendCodeLink` area / footer action, sign-in only)
- `--color-text-muted` `14px`, underline on hover, visible focus ring, `>=24px` target. Routes to Clerk's reset flow.

**Verification-code step** (Clerk `otpCodeFieldInput`, sign-up completion)
- Purpose: where sign-up actually completes - a dedicated calm step, not an afterthought.
- One 6-digit input group, `inputmode=numeric autocomplete=one-time-code` (do not override - enables OTP autofill/paste), each box `>=44px`, `16px` text. Resend timer link, "Wrong email? Go back" link. Move focus to the step heading on transition.
- States: default, filling, error (neutral "That code did not match. Try again."), success.

**MFA step** (Clerk, returning users with 2FA)
- Same OTP styling as verification. Account for it as a Clerk state, do not invent a custom form. Authenticator code field `autocomplete=one-time-code`. Calm heading, clear "use a backup code" fallback link Clerk provides.

**Inline errors** (Clerk `formFieldErrorText`, global `alert`)
- Field-level: hairline `--color-danger` text `13px` directly under the field with an icon, `aria-describedby` wired to the field, field `aria-invalid=true`. No top banner for field errors.
- Page-level (failed sign-in, network): single neutral message "Email or password is incorrect." in a quiet `--color-danger`-bordered inline region with `role=alert` / `aria-live=assertive`. Never leak account existence.

## Motion and dynamism

Ambient, slow, singular. The whole tempo is `--motion-base 200ms` for micro-interactions and 12-30s for background life, all `--ease-out` `cubic-bezier(.22,1,.36,1)`, no spring, no bounce.

**Scene (panel) layering, back to front:**
1. Base linear gradient `--color-brand-deepest` `#1E3019` -> `--color-brand-deep` `#2A3626`.
2. One or two large off-canvas radial glows in `--color-brand-dark`, low opacity, top-left + bottom-right. These **drift** on a 20-30s ease-in-out loop, a barely-perceptible position shift (kills the flat "CSS gradient" look).
3. Faint film grain: a **static** SVG `feTurbulence` at ~3-5% opacity (kills gradient banding, adds analogue warmth). Never animated noise.
4. A single slow diagonal **sheen** sweep on a 12-20s linear loop.

**Parallax (desktop, pointer only):** at most a 2-4px shift of the glow layers following the cursor. Skip entirely on touch.

**Entrance:** panel paints instant; form card fades up `8-12px` over `200ms --ease-out`, staggered `+80ms` after the panel. A gentle settle that signals craft without delaying the user.

**Micro-interactions:** button hover darken over `200ms`, no scale; field focus ring appears instantly (accessibility, no transition delay on the ring itself); link underline on `200ms`.

**`prefers-reduced-motion: reduce` fallback (full):** kill the glow drift, sheen sweep, parallax, and card entrance entirely. **Keep** the static gradient + static grain so the panel is still a finished, on-brand scene, never blank or broken. Any decorative layer that would run >5s is gated here. This is both the accessibility-correct and the premium-correct default for users who opt out.

## Accessibility

A concrete WCAG 2.2 AA pass for this specific page. Audit both surfaces: our shell, and the Clerk form (Clerk's baseline is good, but `tahiClerkAppearance` overrides can silently break contrast, focus, and target size).

**Labels and association**
- Every field (Full name, Email, Password, OTP) has a persistent visible label, programmatically tied (`label for`/`id` - confirm Clerk's survives the appearance override). Confirm no override set `formFieldLabel` to `display:none`.
- Password reveal, Google button, and any icon-only control have accessible names; reveal name reflects state ("Show password"/"Hide password") or uses `aria-pressed`.

**Input types and autocomplete (1.3.5)**
- Email `type=email autocomplete=email inputmode=email`; sign-in password `current-password`; sign-up password `new-password`; name `autocomplete=name`; OTP/2FA `autocomplete=one-time-code inputmode=numeric`. Verify Clerk emits these and the override did not strip them.

**Focus visibility and order (2.4.7, 2.4.11, 2.4.3)**
- Visible focus on every interactive element on both surfaces. Never `outline:none` without a `:focus-visible` substitute.
- Focus ring >=2px and >=3:1 against its background. On the white card use `--color-brand` `#5A824E` (~3.4:1 on white - OK). On any control sitting on cream, or for the primary green button, use `--color-brand-dark` `#425F39`. On the dark panel use a light ring.
- Tab order top-to-bottom: card region (Google -> fields -> submit -> forgot/switch); the marketing panel must not inject tab stops before the form. Provide a "skip to form" / focus-form-first behaviour so keyboard users are not dragged through the panel (2.4.1).
- No keyboard trap (2.1.2); if a Clerk CAPTCHA/overlay opens, Esc closes and focus returns. On step change (password step, OTP step) move focus to the new heading/first field.

**Contrast - dark panel (1.4.3, measured against the gradient's lightest pixel, grain layer on)**
- Body/testimonial/trust text use `--color-text-on-dark` `#FDFDFC` (safe). `--color-text-dim-on-dark` `#DCE8D9` only for large text (>=18.66px bold / 24px regular); never fine print. Pill text and trust row must hit 4.5:1 (3:1 if large). Re-test with grain on.

**Contrast - white card (1.4.3, 1.4.11)**
- `--color-text` `#121A0F` ~17:1, `--color-text-muted` ~6.5:1 fine. Confirm fine print in `--color-text-subtle` `#63615B` at 11-12px still clears 4.5:1.
- **Primary button: do not use `--color-brand` with normal white text (~4.0:1, fails).** Use `--color-brand-dark` (~5.6:1) or bold label >=18.66px. (Top likely failure.)
- **Input/divider borders: do not use `--color-border` `rgba(26,25,20,.10)` (~1.2:1, fails 3:1 as a control boundary).** Use `--color-border-strong` so inputs are perceivable. (Second likely failure.)
- Error never by colour alone - icon + text (1.4.1).

**Error and status (3.3.1, 4.1.3)**
- Errors in text next to the field naming the fix ("Enter a valid email address"); errored field gets `aria-invalid=true` + `aria-describedby`. Page-level errors `role=alert` / `aria-live=assertive`; inline hints `aria-live=polite`. Async transitions ("Sending code...", "Signed in, redirecting...") announced politely. Submit spinner has accessible name / `aria-busy`.

**Reduced motion (2.2.2, 2.3.3 as baseline)** - per the Motion section; static panel remains.

**Target size (2.5.8, floor 24px, target 44px)** - both buttons, reveal toggle, switch link, OTP boxes >=24px (aim 44px for thumb-driven). Reveal eye and legal links are the usual sub-24 offenders.

**Password and auth (3.3.8 Accessible Authentication, new in 2.2)** - do not block paste into password/OTP; no restrictive `maxlength` blocking manager-generated values; CAPTCHA has an accessible alternative and no focus trap; OTP can be pasted/autofilled (not transcription-only).

**Structure, zoom, language** - one `<h1>` (card heading), marketing headline `<h2>`; `<html lang="en-NZ">`; reflow at 320px / 400% zoom to the mobile stack with no horizontal scroll; readable at 200% text zoom; decorative leaf/grain/sheen/avatars `aria-hidden`, wordmark named.

**Forced colors** - test `forced-colors: active`: give the panel a solid `background-color` fallback under the gradient so text stays legible when the gradient is stripped; focus rings use system colours; the green button outline survives.

## States and flows

**Theme pinning (critical):** the white card must stay light even if the visitor has `tahis-theme: dark` saved in `localStorage`. The `(auth)` route group does not apply the `.dark` class to the card; the card and its Clerk content use hard-pinned light tokens (`#ffffff` background, `--color-text` ink) regardless of saved preference. The dark forest panel is its own intentional dark scene, not the dark theme. Verify a dark-mode-saved visitor sees an identical, readable card.

**Default (sign-in):** form is hero, headline reduced to one line, last-used method surfaced first (Clerk remembers Google or email), "Remember me" on by default with a quiet explanation. Card present immediately, no layout shift.

**Default (sign-up):** narrative warmer, full headline + testimonial + trust row, fields Name/Email/Password, first field (name) is the effortless opener that pulls the user through.

**Focus:** green ring on the active field/control; one field active at a time; no premature validation.

**Loading (submit):** button disabled, inline spinner, label swap ("Creating your account..." / "Signing you in..."), `aria-busy`, stays disabled to prevent double-submit.

**Inline error:** field-level hairline + icon + text directly under the field, typed value preserved (especially email), validate on blur/submit only. Sign-in failure shows the single neutral "Email or password is incorrect."

**Email-verification-code step (sign-up only, the extra step):** after submit, Clerk transitions to the OTP step - a dedicated calm screen with one 6-digit input, OTP autofill/paste, `inputmode=numeric`, a resend timer, and a "Wrong email? Go back" link. Focus moves to the step heading. This is where sign-up actually completes; treat it as a first-class screen.

**OAuth redirect:** show an explicit owned interstitial "Connecting to Google..." rather than a blank round-trip. Design the **OAuth-return-error** state (user cancelled / popup blocked): land back on the card with a gentle retry, not a stack trace - cancellations are common and must not feel like failure.

**MFA step (sign-in, enrolled users):** Clerk renders an authenticator/backup-code step styled like the OTP step; account for it, do not rebuild it.

**Success/redirect:** brief "Signed in, redirecting..." announced politely, then Clerk routes invisibly (admin org -> dashboard, other org -> portal). No flicker between auth and destination.

## Copy deck

Calm, premium, plain NZ voice. No exclamation, no growth-hack punch. Hyphens only, no em/en dashes.

**Sign-up**
- Scene headline: `Start your project the calm way.`
- Subcopy: `One calm place to brief your studio, track delivery, and receive every file and invoice.`
- Badge: `The studio workspace`
- Testimonial: `"Calm, sharp, and exactly the kind of partner we hoped for. Everything in one place, nothing dropped."` - `Mereana K., Founder, [Studio name]`
- Trust line: `Trusted by independent studios across Aotearoa. Made in NZ.`
- Card heading: `Create your workspace`
- Card subhead: `Takes about a minute.`
- Primary CTA: `Create your workspace`
- Reassurance (under CTA): `No card required. Your data stays private to your studio, hosted here in Aotearoa.`
- Legal: `By continuing you agree to our Terms and Privacy Policy.`
- Footer switch: `Already have an account? Sign in`

**Sign-in**
- Scene headline (one quiet line): `Welcome back.`
- Subcopy (optional): `Your studio workspace, right where you left it.`
- Badge: `The studio workspace`
- Testimonial: (keep the same single quote, panel dialled down)
- Trust line: `Made in Aotearoa.`
- Card heading: `Welcome back`
- Card subhead: `Sign in to your workspace.`
- Primary CTA: `Sign in`
- Google button (both): `Continue with Google`
- Divider (both): `or`
- Forgot link: `Forgot your password?`
- Reassurance (under CTA): `Encrypted and secure. Hosted in Aotearoa.`
- Footer switch: `New here? Talk to the studio`  *(prospect-friendly; for invited clients Clerk's standard "Create account" link also applies)*

**Shared states**
- OAuth interstitial: `Connecting to Google...`
- OAuth error: `That did not complete. Try again.`
- Verification heading: `Check your email`
- Verification subcopy: `We sent a 6-digit code to [email]. Enter it below.`
- Verification resend: `Resend code` / `Wrong email? Go back`
- Submit loading: `Creating your account...` / `Signing you in...`
- Sign-in failure: `Email or password is incorrect.`
- Success: `Signed in, redirecting...`

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Page canvas | `--color-bg-cream` `#F7F6F3` |
| Panel base gradient | `--color-brand-deepest` `#1E3019` -> `--color-brand-deep` `#2A3626` |
| Panel glows | `--color-brand-dark` `#425F39`, low opacity |
| Grain | static SVG `feTurbulence`, 3-5% opacity |
| Panel body/quote text | `--color-text-on-dark` `#FDFDFC` (4.5:1+) |
| Panel large/dim text | `--color-text-dim-on-dark` `#DCE8D9` (large only) |
| Pill leaf accent | `--color-brand-light` `#7aab6b` |
| Card background (theme-pinned) | `#ffffff` |
| Card radius | `--radius-leaf-lg` `0 1.5rem 0 1.5rem` |
| Card shadow | `0 24px 48px -24px rgba(26,25,20,0.18)` |
| Card heading ink | `--color-text` `#121A0F` |
| Subhead / muted | `--color-text-muted` `#5D5B55` |
| Fine print / divider text | `--color-text-subtle` `#63615B` |
| Input / button / divider border | `--color-border-strong` `rgba(26,25,20,.16)` (NOT `--color-border` 10%) |
| Input radius | `--radius-md` `.5rem` |
| Focus ring (white card) | `--color-brand` `#5A824E` |
| Focus ring (on cream / button) | `--color-brand-dark` `#425F39` |
| Primary button fill | `--color-brand-dark` `#425F39` (NOT `--color-brand`, fails contrast) |
| Primary button hover | toward `--color-brand-deep` `#2A3626` |
| Error | `--color-danger` `#f87171` + icon + text |
| Leaf radius usage | card (leaf-lg), pill (leaf-sm), optionally primary button. NOT inputs/Google/avatars |
| Green budget (light side) | primary button + focus ring + one tiny accent. No more |
| Motion | micro `--motion-base 200ms`; ambient 12-30s; all `--ease-out` `cubic-bezier(.22,1,.36,1)`; no bounce |
| Font | Manrope 400-800; headline 700 / `-0.02em` / `1.05` |
| Spacing scale | `4 / 8 / 12 / 16 / 24 / 32 / 40 / 64` |

## Deliverables for Claude design

Generate these screens/variants:

1. **Sign-up - desktop** (`>=1024px`): full split, warm narrative, testimonial + trust row, card with Name/Email/Password, card overlapping seam `-32px`.
2. **Sign-in - desktop**: same shell, headline dialled to one line, form-first, Email/Password + forgot link.
3. **Sign-up - mobile** (375px): forest band + overlapping card + condensed proof below.
4. **Sign-in - mobile** (375px).
5. **Verification-code step** (sign-up): dedicated OTP screen, resend + go-back.
6. **State sheet:** field focus, inline field error, page-level sign-in error, submit loading (label swap + spinner), Google OAuth interstitial + OAuth-return-error, success/redirect.
7. **Dark-mode-saved proof:** the card rendered identically with light tokens pinned while a `.dark` preference is set.
8. **Reduced-motion variant:** panel with static gradient + grain only.

**Integration constraints (non-negotiable so it drops into the codebase):**
- Clerk owns all form fields. Design only the shell (our code) plus the *appearance* of Clerk elements; deliver class-override intent that maps to `tahiClerkAppearance` keys, do not mock custom inputs as if we build them.
- Use the exact CSS variables from the Tokens table; no hardcoded hex outside the documented inline-const pattern.
- Pin light tokens on the card; the `(auth)` group never applies `.dark` to the card.
- Honour the contrast corrections: primary button `--color-brand-dark`, borders `--color-border-strong`, panel body text `--color-text-on-dark`.
- Real flows (Google redirect, email code, forgot password, MFA) are states to render, never new forms to invent.
- Touch targets `>=44px`, inputs `>=48px` / `16px` font, visible focus everywhere, full `prefers-reduced-motion` fallback.
- Relevant files for the implementer: `components/tahi/auth-shell.tsx`, `components/tahi/clerk-mount.tsx`, `app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `app/(auth)/sign-up/[[...sign-up]]/page.tsx`.

## Why this is premium

Every decision serves the first 7-10 seconds of a six-figure relationship. The split shell sells while it gates, so a new client feels arrival and proof before touching a field, while the form stays a calm, low-friction column they can use instantly - resolving the persona tension between "speak" and "whisper." The rationed green, rare leaf, hairlines, and generous whitespace read as editorial confidence rather than decoration, the "Studio Ledger" restraint that templates always skimp on. The four anti-generic tells are all present: the card overlaps its container, grain kills the flat gradient, type is genuinely tight and hierarchical, and one accent colour is held scarce. Real named proof and "Made in Aotearoa / your data stays here" are provenance a template cannot fake and a boutique can credibly own. Slow singular motion reads as alive and expensive; the absence of counters, urgency, and security theater is itself the premium signal. And the contrast, focus, and target-size corrections mean it holds up for a senior buyer signing in on a phone between meetings - because at this tier accessible *is* premium. The client should exhale: calm, capable, and unmistakably in good hands.

---

## As built and entry routing (added 2026-06-27)

Auth is implemented and live (`components/tahi/auth-shell.tsx`, `clerk-mount.tsx`, both `(auth)` pages, `tahiClerkAppearance`, per-step headings via ClerkProvider `localization` in `app/layout.tsx`). Clerk owns every field; we ship only the Studio Ledger shell and the scoped `.cl-*` theming. The neon leaf is a canvas line that draws on first paint and brightens under the pointer; trust avatars are real profile photos plus a "+40" chip.

**Auth is the front door for three kinds of arrival, and the link decides what happens after sign-in.** Whoever issues the link (teammate invite, client invite, or a client who already has a project / schedule / contract set up) encodes the context in the link, and that context must survive sign-in and route the person into the correct onboarding:

- **Teammate** -> after auth, `/welcome` (team "Welcome to Tahi", warm hello only). See `03-team-onboarding.md`.
- **Client, self-serve** (no link context) -> `/onboarding`, the chooser (retainer self-serve and paid, or project enquiry).
- **Client, invited** (company known, project/contract attached) -> `/onboarding` care path, no payment, dropped straight to the right engagement. See `02-onboarding.md`.

**Mechanism.** The onboarding pages resolve entry context from the link before rendering (`lib/onboarding-entry.ts`: `resolveClientEntry` / `resolveTeamEntry`). If the visitor is not signed in, the page redirects to `/sign-in?redirect_url=<the original onboarding link, query intact>` so the full link context is preserved through Clerk and replayed on return. Link context is read from query params today (e.g. `?p=existing_project&company=Acme`), with an opaque invite-token lookup as the production upgrade (`resolveToken` seam). No persona is ever inferred client-side or chosen from a dev panel.
