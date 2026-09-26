# Port plan: auth (sign-in, sign-up, Clerk sub steps, /continue)

Written 2026-09-26 for Liam's instruction to build the Claude Design pass in the app following the app's own UI and UX patterns. Nothing here has been reviewed by Liam, so everything ships as "ported, unchecked". Existing primitives and patterns win over the prototype where they differ. Planning only: no code was edited and nothing was committed.

## Sources read

- Review: `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, section "auth" (28 pages, first verdict FIX, final verdict SHIP after a CSS-only revision).
- Requirement: `docs/superpowers/design/requirements/auth.md` and `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`.
- Design files, fetched from Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66 through the claude-design MCP: `auth-app.jsx` (page registry and all 28 page keys), `auth-kit.jsx` (scene, card parts, frame), `auth-data.jsx` (copy, memberships, invite fixtures), `auth.css` (29.8 KB, the revised pass). Design fetched: yes.
- Live code: `components/tahi/auth-shell.tsx`, `components/tahi/clerk-mount.tsx`, `lib/auth-shell-config.ts`, `app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `app/(auth)/sign-up/[[...sign-up]]/page.tsx`, `app/(auth)/continue/page.tsx`, `app/(auth)/continue/continue-content.tsx`, `app/layout.tsx` (ClerkProvider localization), `app/(onboarding)/onboarding/page.tsx` (also renders AuthShell), `e2e/auth-path.spec.ts`, `app/(auth)/__tests__/sign-up-invite.test.ts`, `components/tahi/tahi-button.tsx`, `components/tahi/badge.tsx`, `app/globals.css` token blocks. Clerk types checked in `node_modules/@clerk/shared/dist/types/index.d.ts` for the localization keys used below.

## Critic status

Final verdict SHIP. The one first-pass FIX (the 42px "Forgot your password?" link) was resolved in the design's CSS revision, but the live code still has the old unpadded link (about 18px tall), so the port must carry the fix into `auth-shell.tsx`. That is done in slice A. The 37px Terms and Privacy links are a disclosed exception pending Liam (question 3), not an open FIX. No other FIX items remain open.

## What the live code already matches (no work)

The design file was drawn as a mirror of the shipped auth shell, so most of it is already live:

- The Studio Ledger scene: forest gradient, bloom, grain, the canvas neon leaf with reduced-motion handling, wordmark, pill, headline, sub, glass testimonial (Evan Kwan, Physitrack), trust row. Scene copy for all three families (sign-up, sign-in, hold) is word for word the same.
- The 58/42 split, the single 64rem breakpoint, the forest collapsing to a centred top band with the wordmark, testimonial and desktop trust row hidden, the card pulled up over the seam, the condensed trust line under the card.
- The theme-pinned white card (a `.dark` visitor still gets a white card; pinned by the 375 dark e2e).
- Card headings via ClerkProvider localization: "Welcome back" / "Sign in to pick up where you left off.", "Create your workspace" / "Takes about a minute.", "Check your email" / "Enter the 6-digit code we just sent you."
- Clerk's footer hidden, social buttons on top, Tahi's own switch row, the legal line pointing at /terms and /privacy, 48px inputs, social and primary buttons, 48px OTP boxes.
- /continue behaviour and copy: the pure `resolveWorkspaceChoice` decision, paging through all memberships before deciding, "Opening your workspace" / "This usually takes a second.", the 6 second stranded escape "Taking too long? Continue to onboarding", "Choose a workspace" / "You belong to more than one. Pick the one you want to open.", the failed line "That did not open. Try again, or pick another workspace.", "None of these are mine", the footer "Not where you expected to be? Start onboarding", `roleLabel`, the full-page `window.location.assign` after `setActive`.
- The invite handoff: `/sign-up` reads the token (query, then the `tahi-invite-token` cookie), prefills the invited email, renders SignIn instead of SignUp when the address already has a Clerk account, and shows a plain one-line cue "You are accepting an invite to {company}." (shipped 2026-09-14 in 2347bbeb, after the design pass).

## Differences, page key by page key

Sign in group
- `sign-in`: the design draws email and password on one card. The live Clerk instance is identifier-first (the password and forgot link appear after the email is recognised, as the e2e relies on). That is a Clerk dashboard setting, not a port item; keep it. Visual differences to port: the "Forgot your password?" link grows to a 2.875rem tap box without growing the label row; the show-password toggle grows from 32px to a 2.75rem square; inputs gain a hover border; the switch link grows to 2.75rem; the switch row's single top border becomes a hairline drawn by a pseudo element (house rule: no single-side borders); every rule inside the card reads pinned tokens instead of hex; px spacing becomes rem.
- `sign-in-loading`: live shows a bare spinner in a 12rem box while Clerk loads. Design shows a status block with a title. Port the title ("Loading your sign in"); drop the design's sub line, which names the vendor ("as soon as Clerk is ready") and is not user copy.
- `sign-in-field-error`: live styles `aria-invalid` inputs and `.cl-formFieldErrorText`; the port aligns the error icon to the first line and takes the design's copy "Enter a valid email address." through Clerk's `unstable__errors` localization.
- `sign-in-page-error`: live `.cl-alert` is centred on one line; port aligns it to the top, uses the field radius token, and takes the copy "Email or password is incorrect. Check both and try again." for `form_password_incorrect`.
- `sign-in-submitting`: Clerk shows its own spinner in the primary button and has no busy-label hook. Port only the spinner colour (white on the dark button). The "Signing in" label is not buildable on the mounted widget.
- `sign-in-oauth`: Clerk owns the Google redirect and the `/sign-in/sso-callback` spinner. Port only the spinner colour; the "Connecting to Google" card copy is skipped.
- `sign-in-redirect`: after sign-in Clerk navigates to `/continue?next=...`, whose hold state is the live equivalent of this tick card. Skipped.
- `sign-in-invite`: "Design file only" proposal (Liam question 2). Live keeps its current behaviour (the /sign-up hasAccount branch renders SignIn with the plain helper line).

Sign up group
- `sign-up`: legal links gain 0.625rem vertical padding and `white-space: nowrap` (the disclosed 37px exception); everything else as sign-in.
- `sign-up-field-error`: copy via localization: "That email address is taken. Try another, or sign in instead." (`form_identifier_exists__email_address`), "Use at least 8 characters." (`form_password_length_too_short`).
- `sign-up-page-error`: the design's "We could not create your workspace just now" has no single Clerk error key behind it; keep Clerk's generic message.
- `sign-up-submitting`: as sign-in-submitting.
- `sign-up-invite`: "Design file only" proposal; live helper line kept.

Verify group
- `verify`: identity preview gains a 2.75rem minimum height, its Edit button and the Resend link become 2.75rem targets; OTP boxes gain a hover border. Heading copy already matches (live keeps "6-digit", which the e2e asserts).
- `verify-submitting`: spinner colour only.
- `verify-error`: OTP boxes gain the error border and ring; copy "That code is incorrect or has expired. Ask for a new one." for `form_code_incorrect`.
- `verify-resend`: the disabled Resend link uses the subtle text colour and no underline; Clerk supplies its own countdown text.

Forgot and reset group
- `forgot`, `forgot-error`, `forgot-submitting`: the design draws an email-entry screen. This Clerk instance already knows the identifier and goes straight from the password step to a reset-code step, so there is no email-entry screen to style. The shared input, error and button rules cover it.
- `reset`, `reset-error`, `reset-submitting`: Clerk splits this into a code step then a new-password step. Port the design's wording where a Clerk key exists: `signIn.forgotPassword.title` "Reset your password" (keeps the e2e's /reset/i assertion true), `signIn.forgotPassword.subtitle_email` "Enter the code we sent to your email.", `signIn.resetPassword.formButtonPrimary` "Reset password". The one-card code plus password layout is not buildable on the mounted widget.

Continue group (all Tahi-owned markup, fully portable)
- `continue-loading`: live uses Tailwind with a Loader2 spinner, correct copy, but no `role="status"`. Port adds the live region and the design's spacing.
- `continue-stranded`: live escape is a `TahiButton` link at size sm (1.75rem on desktop). Design is a bordered 2.75rem button with a trailing arrow. Port with `TahiButton variant="secondary"` plus a trailing arrow and a 2.75rem minimum height.
- `continue-pick`: live rows are 2.75rem, name plus a plain role line, no tile, no arrow. Design rows are 3.5rem with a leaf-radius initials tile, the name, a role chip and a trailing arrow; the heading matches the Clerk card heading size (1.3125rem, 1.25rem on phone). Port with the app's `Badge` for the role chip and `getInitials` for the tile.
- `continue-activating`: live disables every row and fades them all. Design keeps the busy row fully visible with a brand border and focus ring, and fades only the others. Port that, but keep the busy row `disabled` too so a second click cannot re-enter `setActive` (the design note's own reasoning).
- `continue-failed`: live is a plain red line. Design adds a warning icon and `role="alert"`. Port both.
- The zero-membership case never paints (redirect to /onboarding) in both; no work.

Differences deliberately not ported (live wins, no reason given in the review): trust avatar sizes (live 2.25rem desktop and 1.9375rem under-card, design 1.75rem and 1.5rem), the phone form's bottom padding (live 1.5rem, design 4.5rem, which only clears the prototype's page picker), and the design-file chrome (`.is-mobile`, `.ta-stage`, `.ta-note`, `.ta-pp`, the html and body rules).

## Slices

Two slices with disjoint files. Merge A before B: B relies on tokens A pins inside the card (Badge neutral colours, the focus ring, brand light). They can be built in parallel; B's dark-mode check is only valid once A is merged.

### Slice A: auth shell and Clerk card theming (about 1 day, no backend, no migration)

Owned files: `components/tahi/auth-shell.tsx`, `lib/auth-shell-config.ts`, `components/tahi/clerk-mount.tsx`, `app/layout.tsx` (the `localization` object only), `e2e/auth-path.spec.ts`.

Follow `auth.css` and `auth-kit.jsx` in the Claude Design project (page keys sign-in, sign-in-loading, sign-in-field-error, sign-in-page-error, sign-in-submitting, sign-up, sign-up-field-error, verify, verify-error, verify-resend, reset, reset-error).

1. Rewrite the `AUTH_CSS` string in `auth-shell.tsx`:
   - Convert every px length to rem (house rule), keeping the rendered sizes.
   - Extend the pinned token set on `.tahi-auth-card` to the design's list: add `--color-bg-tertiary:#EDEBE5`, `--color-brand-light:#7aab6b`, `--color-danger:#c0463d`, `--color-danger-line`, `--color-danger-bg`, `--color-danger-ring`, `--color-focus-ring:rgba(90,130,78,0.25)`, `--radius-leaf`, `--radius-leaf-sm`, `--radius-field:.5rem`, a placeholder token for `#8b8a84`, a hover-border token for `rgba(26,25,20,0.28)`, and the light values of `--badge-neutral-bg` (#F2F4F2), `--badge-neutral-text` (#525A52) and `--badge-neutral-border` (#E1E5E1) so the app's `Badge` renders light inside the card for a dark-mode visitor (slice B uses it).
   - Every rule inside the card reads those vars. Hex is allowed only in the scene rules (always-dark exemption, like the sidebar), in the pinned token declarations, and for white text on the primary button.
   - 44px targets: `.cl-formFieldAction` gets a pinned 1.375rem line box, 0.75rem vertical and 0.375rem horizontal padding, and the matching negative margin (2.875rem box, label row does not grow: this is the critic's FIX 1); `.cl-formFieldLabelRow` gets a 0.75rem gap; `.cl-formFieldInputShowPasswordButton` becomes a 2.75rem square at right 0.125rem; `.cl-identityPreview` gets min-height 2.75rem; `.cl-identityPreviewEditButton`, `.cl-formResendCodeLink` and `.cl-footerActionLink` get min-height 2.75rem with a negative inline margin; `.ta-swlink` gets a 1.375rem line box plus 0.8125rem padding and negative margin (2.75rem); `.ta-legal a` gets 0.625rem vertical padding and nowrap (the disclosed exception, do not force 44px).
   - States: hover border on inputs and OTP boxes; focus-visible outline (2px brand-dark, 0.125rem offset) on social button, show-password, forgot, edit, resend, primary, switch link and legal links; error border plus ring on inputs and OTP boxes. Keep the live error selectors `[aria-invalid="true"]` and `[data-invalid]` and add `[data-feedback="error"]` only if the Clerk DOM uses it; do not port the prototype's `.is-error` class, Clerk never sets it.
   - `.cl-alert` and `.cl-formFieldErrorText` align to flex-start with line-height 1.45 and a non-shrinking icon (style Clerk's own `.cl-alertIcon`; do not inject icons). `.cl-alert` uses the field radius.
   - Primary button: min-height 3rem instead of a fixed height; `.cl-formButtonPrimary .cl-spinner` white; disabled opacity 0.85. Radius stays 0.5rem (Liam question 1).
   - Any `.cl-spinner` outside the primary button (sso-callback, step transitions) uses the brand-dark top colour on a faint brand ring.
   - `.ta-switch`: drop `border-top`, draw the hairline with `::before` (absolute, 1px, full width).
   - Scene: `.ta-scene-content` gap 2rem; testimonial `.ta-avatar` takes the small leaf radius (0 0.625rem 0 0.625rem); `.ta-av-more` background #2A3626. Keep live trust avatar sizes.
   - Below 64rem: header title 1.25rem, OTP gap 0.375rem, centred scene mid margin-top 1.5rem, headline margin-top 1rem. Keep the live 1.5rem bottom padding. Keep one breakpoint (Liam question 4).
   - Keep the live-only Clerk rules the prototype lacks: `.cl-cardBox`, `.cl-footer{display:none}`, `overflow:visible` on the wrappers.
   - `.ta-helper` (the live invite line) reads `var(--color-text-muted)`.
2. `TrustAv`: add an `onError` fallback (state flag) that swaps a broken photo for the colour swatch. In `lib/auth-shell-config.ts` add the design's fallback tints to the four photo entries (#3D5C35, #4C6B42, #2F4A29, #587A4C). Keep the placeholder photos (Liam question 5). The file must stay values only (server-safe; see its header comment).
3. `clerk-mount.tsx` not-ready state (both widgets): keep the 12rem minimum height so nothing jumps, add `role="status"` and `aria-live="polite"`, the existing `Loader2` in `var(--color-brand)` at 1.5rem, and a title under it: "Loading your sign in" for ClerkSignIn, "Loading your sign up" for ClerkSignUp (0.9375rem, weight 600, `var(--color-text)`). No sub line.
4. `app/layout.tsx` localization, add only: `signIn.forgotPassword.title` "Reset your password", `signIn.forgotPassword.subtitle_email` "Enter the code we sent to your email.", `signIn.resetPassword.formButtonPrimary` "Reset password", and `unstable__errors` for `form_param_format_invalid__email_address` "Enter a valid email address.", `form_password_incorrect` "Email or password is incorrect. Check both and try again.", `form_identifier_exists__email_address` "That email address is taken. Try another, or sign in instead.", `form_password_length_too_short` "Use at least 8 characters.", `form_code_incorrect` "That code is incorrect or has expired. Ask for a new one." Leave every existing string alone. Type-check proves the keys exist.
5. `e2e/auth-path.spec.ts`: in the forgot-password test assert the forgot link and the show-password button each measure at least 44px tall; in the 375 dark test assert the switch link measures at least 44px and the card background stays white.

States to verify: Clerk loading, populated, field error, page error, submitting, verify with resend countdown, reset code step, new password step; the /onboarding InviteProblem card (it renders through AuthShell too). 375px: no horizontal scroll, every input and button at least 44px (legal links excepted), the forgot tap box does not cover the password input. Dark: `tahi-theme=dark` before load, card stays white and legible, scene unchanged.

Do not build: the invite callout at the top of the card, busy labels inside Clerk's button, an OAuth interstitial card, a signed-in tick card, a one-card sign-in, an email-entry forgot screen, a leaf-radius primary button, a tablet layout, real trust faces, anything under `.is-mobile`, `.ta-stage`, `.ta-note`, `.ta-pp`. Do not wrap the Clerk element passed to AuthShell: `app/(auth)/__tests__/sign-up-invite.test.ts` reads `page.props.children` and expects the Clerk component directly.

### Slice B: /continue workspace resolver restyle (about 0.5 day, no backend, no migration)

Owned files: `app/(auth)/continue/continue-content.tsx`, new `app/(auth)/__tests__/continue-content.test.tsx`.

Follow `auth-app.jsx` (Hold, WorkspacePicker) and the `/continue` block of `auth.css`, page keys continue-loading, continue-stranded, continue-pick, continue-activating, continue-failed.

1. Split the render into two exported presentational components in the same file, `WorkspaceHold({ stranded, onOnboarding })` and `WorkspacePicker({ choices, activating, failed, onPick, onNone })`, and keep `ChooseWorkspaceContent` as the stateful wrapper. Do not change any logic: `resolveWorkspaceChoice`, `safeNextPath`, the membership paging effect, the `settled` ref, `STRANDED_AFTER_MS`, `setActive` then `window.location.assign`. `app/(auth)/continue/page.tsx` stays as it is (its scene and footer already match).
2. Hold (loading and stranded): wrapper with `role="status"` and `aria-live="polite"`, centred, 2rem top and 0.5rem bottom padding; `Loader2` 1.5rem in `var(--color-brand)`; title 0.9375rem weight 600 `var(--color-text)`; sub 0.8125rem `var(--color-text-muted)`. Stranded adds, 1.25rem below, `TahiButton variant="secondary" size="md"` with a trailing lucide `ArrowRight` and `min-h-[2.75rem]`, label "Taking too long? Continue to onboarding".
3. Picker heading: h1 "Choose a workspace" at 1.25rem below `lg` and 1.3125rem from `lg` (64rem, the shell's breakpoint), weight 600, letter-spacing -0.01em; sub 0.875rem muted, line-height 1.5; 1.25rem (phone) or 1.5rem gap to the content.
4. Failed: a `<p role="alert">` above the list with a lucide `AlertCircle` at 0.875rem and the existing copy, `var(--color-danger)`, items-start, 0.375rem gap.
5. Rows: `ul` with 0.5rem gap. Each row is a full-width `button`, min-height 3.5rem, 0.75rem gap, 0.625rem by 0.875rem padding, 1px `var(--color-border)`, radius `var(--radius-md)`, background `var(--color-bg)`, hover `var(--color-bg-secondary)` and `var(--color-border-strong)`, focus-visible 2px `var(--color-brand-dark)` outline at 0.125rem offset. Contents: a 2.25rem initials tile (`getInitials` from `lib/utils`, radius `var(--radius-leaf-sm)`, gradient 140deg from `var(--color-brand-light)` to `var(--color-brand-dark)`, white 0.75rem weight 700, aria-hidden); the org name at 0.9375rem weight 600, truncating; the role through `<Badge tone="neutral" size="sm">` with the existing `roleLabel`; a 1.25rem trailing slot with `ArrowRight` 1rem in `var(--color-text-subtle)` turning `var(--color-brand-dark)` on row hover, or `Loader2` 1rem in `var(--color-brand)` on the busy row.
6. Activating: every row keeps `disabled` while `setActive` runs (no double activation). The busy row carries `aria-busy="true"`, a `var(--color-brand)` border and a 0.1875rem `var(--color-focus-ring)` shadow, and no fade. The other rows fade to 0.55 opacity with a default cursor and no hover change.
7. "None of these are mine": keep `TahiButton variant="link"`, add `min-h-[2.75rem]` so it is a real target on desktop too.
8. Test with `renderToStaticMarkup` (the pattern in `components/tahi/__tests__/onboarding-shell-signout.test.tsx`): the picker renders one row per membership with its name and role label; `failed` renders the alert; `activating` marks exactly one row `aria-busy` and every row disabled; the hold renders the escape only when stranded.

States: loading, stranded, pick with two and with three memberships, activating, failed; zero memberships stays a redirect with no UI. 375px: rows full width, long org names truncate, no horizontal scroll, every row and link at least 44px. Dark: the card stays white and the Badge chip stays light (needs slice A merged). Smoke: the hold state by visiting /continue as a signed-in session with no active org; the picker needs a test user holding two client memberships, otherwise record that it was verified through the unit test and a local render.

Do not build: any change to which workspace wins, any org other than the person's own memberships, plan or billing or health data in a row, a Tahi Studio row (the resolver never shows one), a search box, "remember my choice".

## Skipped (keeps today's live behaviour)

- The invite trust callout at the top of the sign-in and sign-up cards with the invited email ("Design file only", Liam question 2). The live plain helper line stays.
- A leaf radius on the Clerk primary button (Liam question 1).
- Terms and Privacy promoted to their own 44px row (Liam question 3).
- A distinct 768px tablet layout (Liam question 4).
- Real client faces or logos in the trust stack (Liam question 5).
- sign-in-oauth "Connecting to Google" card copy and sign-in-redirect tick card: Clerk owns both moments.
- Busy labels in Clerk's primary button ("Signing in", "Creating your workspace", "Verifying", "Sending", "Updating").
- One-card email plus password sign-in, an email-entry forgot screen, and a one-card code plus new password reset: Clerk instance flow, not a port.
- sign-up-page-error custom copy: no single Clerk key behind it.

## Questions for Liam

1. Primary CTA: leaf radius like the card, or keep the 0.5rem rounded rect so Clerk buttons stay distinct? Held at 0.5rem.
2. Invite cue: a plain line "You are accepting an invite to {company}." shipped under the /sign-up form on 2026-09-14. Upgrade it to the designed callout at the top of the card with the invited email, or keep the line? Held at the line.
3. Terms and Privacy measure about 37px as inline prose. Confirm the exception, or promote them to their own 44px row? Held inline.
4. One 1024px breakpoint for this group, or a separate 768px tablet treatment? Held at one.
5. Trust avatars: real client faces, client logos, or the line without avatars? Held at the placeholders, now with a fallback swatch.
6. /continue: the restyle is in slice B under the 2026-09-26 instruction; behaviour is unchanged. Say if you would rather hold it until a dual-membership person reports friction (slice B drops cleanly on its own).

## Risks

- Clerk DOM: clerk-js loads from Clerk's CDN and floats with `@clerk/nextjs` 6.39. The prototype is a replica, so verify every `.cl-*` selector against the dev build before styling it.
- `unstable__errors` keys are typed (a rename fails type-check) but marked unstable; a behaviour change in a Clerk upgrade would not be caught.
- The forgot link's negative margin must not let its tap box cover the password input; check at 375.
- `AuthShell` also renders /onboarding's InviteProblem card; the onboarding port may touch that page, and `onboarding-shell.tsx` and `team-welcome-content.tsx` carry a parallel copy of the `.tahi-auth` CSS that will now drift from this one.
- Slice B depends on slice A's pinned tokens; merging B first leaves a dark Badge chip on a white card for dark-mode visitors.
- The e2e specs skip without Clerk dev keys, so CI may not prove the 44px assertions.
- Out of scope but surfaced here: T1.17 (a hire who accepts a Tahi Clerk org invite gets admin through /continue with no teamMembers row) and the dead `/accept-invite` sample URL in `lib/email-previews.ts`. The port must not touch resolution logic.

## Shared files

`components/tahi/auth-shell.tsx` (also used by `app/(onboarding)/onboarding/page.tsx`), `app/layout.tsx` (root ClerkProvider, theme boot script), `lib/auth-shell-config.ts` (three auth pages), `e2e/auth-path.spec.ts`, and read-only dependencies `components/tahi/tahi-button.tsx`, `components/tahi/badge.tsx`, `app/globals.css` (button heights, token values). `components/tahi/onboarding-shell.tsx` and `components/tahi/team-welcome-content.tsx` share the `.tahi-auth` class names.
