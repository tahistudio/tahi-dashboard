# Port plan: onboarding (/onboarding, /welcome)

Status once built: ported, unchecked. Liam has not reviewed these designs (instruction of 2026-09-26). Existing primitives and patterns win over the prototype wherever they differ.

## Sources read

- Review: `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, section "onboarding" (34 pages, first verdict REDO on the pay pages, final verdict SHIP, seven questions).
- Requirement: `docs/superpowers/design/requirements/client-onboarding.md`; brief: `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`.
- Design (Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66, fetched through the MCP): `onboarding-app.jsx` (29 client page keys), `team-onboarding-app.jsx` (5 team page keys), `onboarding-states.css` (the states layer), `onboarding.css` (the base layer, including the dead mock-card rules), `auth.css` (to compare the theme pin), `previews/onboarding-preview.html` (query keys `?page=`, `?device=phone`, `?theme=dark`, `?audience=teammate`).
- Live code: `app/(onboarding)/onboarding/page.tsx`, `app/(onboarding)/welcome/page.tsx`, `components/tahi/onboarding-content.tsx`, `components/tahi/onboarding-payment.tsx`, `components/tahi/onboarding-shell.tsx`, `components/tahi/team-welcome-content.tsx`, `app/(auth)/continue/*`, `lib/onboarding-steps.ts`, `lib/kickoff-slot.ts`, `lib/stripe-plans.ts`, `lib/invoice-billing.ts`, `e2e/onboarding-personas.spec.ts`, the two existing onboarding tests, and (for data only) `app/api/portal/kickoff-slots`, `app/api/portal/calls` (POST answers `{ emailed, meetingUrl, calendarPushed }`), `app/api/portal/profile` (PATCH name, role, phone), `app/api/portal/organisation` (PATCH name, admin gated), `lib/onboarding-invites.ts` (acceptance refuses a mismatched verified email with 403).
- The parallel auth port plan (`port-plans/auth.md`) owns `/continue`, `auth-shell.tsx` and the InviteProblem card's look, and keeps the auth card theme pinned light. This plan is consistent with it.

## Routes and audience

- `/onboarding`: client (self-serve new retainer, invited new project, existing client, plus an admin previewing as a client).
- `/welcome`: new Tahi teammate.
- `/continue`: listed in the design as the `continue` key, but owned by the auth module. No work here.

## Ground rules for every slice

1. This is a bespoke scene, not a dashboard page. Do not bring in PageHeader, the headline band, the left rail, DataTable, SlideOver or the dashboard Stepper. The primitives are the ones in `components/tahi/onboarding-shell.tsx`: `SceneShell` (with the newer "Sign out and return to sign in" line, keep it), `ScenePill`, `Ledger`, `Stepper`, `useGrow`, `TimezoneField`, `PhotoField`, `Check`, `ONBOARDING_CSS`, plus the new `ObAlert` from slice S1.
2. Theme pinned light, the same contract as `AuthShell`: with `.dark` on `<html>` the onboarding page looks exactly as it does in light. The design's dark canvas is not ported (question 1). No onboarding rule may read a dashboard `--color-*` token, because those flip in dark; read the `--ob-*` tokens pinned on `.tahi-auth-card`.
3. Hex only in the pinned `--ob-*` token declarations and in the always-dark forest scene (the sidebar-style exemption). Every new or edited rule reads `var(--ob-*)`. No inline `style` hex in JSX (today's `#b3261e` and `#9b9a94` spans go).
4. rem for every new or edited rule. Leave untouched px rules alone in this port so the diff stays reviewable.
5. 44px touch targets on every standalone control; focus-visible outline on every interactive element; nothing hover only.
6. Motion: every onboarding animation stops under `prefers-reduced-motion` and under the app's own `html.reduce-motion` class (set by `lib/theme-boot-script.ts`).
7. Copy: no em or en dashes; honest surfaces only (section 5 of the requirement). Where live copy is newer than the design (pronoun-free lead lines, quick-call enquiry language, the email follow-up promise on kickoff), live copy wins. Where the two differ only by contractions, keep live.
8. Do not change: `buildSteps`, `ONBOARDING_VIDEO_ENABLED`, `CLIENT_HOME_ONBOARDING_CHECKLIST_ENABLED`, the VideoModal and `VIDEO_CSS`, provisioning, checkout, invite acceptance, completion gating, the redirect-outside-try pattern in the pages.

## What the live code already matches (no work)

- The persona and step table: existing clients see only welcome and kickoff, never plan or pay; new project gets welcome, details, invite, kickoff; new retainer gets welcome, plan, pay, details, invite.
- The chooser with its two options, the project enquiry form (same fields, POST `/api/portal/enquiry`) and the sent confirmation.
- The scene: forest panel, neon leaf, pill, headline, ledger, lead card; the lead is resolved server side; the always-dark scene exemption.
- welcome-selfserve and welcome-invited bodies (lead card and quote); the hello video stays hidden.
- Plan cards, the Recommended pill, the parallel-track add-on, the anchor line and billing cycle line.
- A real Stripe PaymentElement (no app-drawn card fields), a currency choice, the amount summary, "Secured by Stripe.", the invoice-me path with its distinct 402 copy, the Stripe-unavailable fallback.
- Details: identity chip, workspace name only when not known, role, detected timezone.
- Invite: add by email, empty state, "Will be invited" list with Remove, skip link, non-fatal POST `/api/portal/invites`.
- Kickoff: real slots from `/api/portal/kickoff-slots` grouped by the visitor's own day, the zone line wording, the two quiet fallback sentences, disabled chips with the exact "Read only while viewing as a client" copy, booking through POST `/api/portal/calls`, the MCP twin `portal_kickoff_slots`.
- /welcome: two steps (welcome summary, profile with photo, preferred name, pronouns, timezone), token acceptance on mount, the join error copy.
- 375px stacking through the shared 64rem breakpoint; slot chips already 2.75rem tall.

## Page key by page key

Client flow (`onboarding-app.jsx`):

- `chooser`: matches. Port only focus-visible states. Keep live copy ("Projects start with a quick call", "we'll set up a call to scope it"); the design reverts to older proposal language.
- `enquiry`: layout matches. Port: labels tied to inputs (`htmlFor`/`id`), required markers as a "Required" tag in brand-dark (both company and brief, which live validates) instead of red asterisks in inline hex, the error as `ObAlert` above the heading, a spinner in the primary while sending. Keep live copy and validation.
- `enquiry-sent`: matches (live copy wins: a quick call, not an emailed proposal).
- `welcome-selfserve`, `welcome-invited`: match. Port the alert slot position only.
- `welcome-masked`: new state. Today a token holder on a different verified email sees "Everything's ready" with "your company's studio" and then a 403 banner. Port the design's layout (title "Welcome to Tahi.", identity chip of the signed-in person tagged "Signed in", a quiet note) with honest copy (see FIX 1).
- `welcome-existing`, `welcome-existing-retainer`: live shows no body. Port the summary card: Workspace, Billing, New engagement. Billing comes from the org's `paymentTerms` and `invoiceChannel` and is omitted when unknown (see slice S2). Keep live title, sub and "Get started".
- `welcome-error`: port `ObAlert` above the heading, title "We could not open your workspace."; the text is the API's own sentence or "Please contact the studio and we will sort it." Drop the design's "You can keep going in the meantime" (FIX 2).
- `plan`: port the plan name label on each card (MAINTAIN, SCALE), US$ on prices and the anchor line, the leaf radius on the recommended card, a spinner while the workspace is provisioned.
- `pay`: port the order (currency segmented control, summary, Stripe frame, trust line, invoice link), the "Payment details" header with the Stripe lock lockup, the one-line hint under the element, `.ob-linkish` for the invoice link (removes the inline style object), "Pay US$5,500 a month" wording. All six presentment currencies, not the design's three.
- `pay-processing`: port the locked currency note, the status line, the disabled spinner primary with no Back, the hidden invoice link. The PaymentElement stays mounted (FIX 3).
- `pay-declined`: port `ObAlert` above the heading, title "Your bank declined this card.", text is Stripe's message plus "Nothing has been charged."
- `pay-invoice-refused`: port `ObAlert`, title "We could not switch this workspace to invoicing.", keep the live 402 sentence (it names business@tahi.studio).
- `details`, `details-invited`: port label association, the `.ob-confirm` company row tagged "Set up by the studio" when the company is known, and the closing note. Wire role and workspace name to existing routes, best effort (FIX 4).
- `invite`, `invite-added`: match. Port the visually hidden label, 44px Add and Remove, long-email wrapping, an inline "Enter a full email address." line when Add is pressed with an invalid address (today it silently does nothing), and dedupe.
- `kickoff`: port the zone line above the grid, the leaf-free lead card, a five-column grid on desktop and tablet, stacked days with wrapping chips under 40rem. Keep live skip and trust copy (FIX 5).
- `kickoff-loading`: port the `.ob-sk` sheen skeleton (spans, not disabled buttons), `aria-busy`.
- `kickoff-empty`, `kickoff-unavailable`: port the `.ob-quiet` box in place of the zone line and grid; hide the trust line.
- `kickoff-readonly`: port the dashed disabled chips and the `.ob-note` pill with the eye icon below the grid; remove the amber banner above; hide the skip link and trust line.
- `kickoff-error`: port `ObAlert`, title "We could not book that time.", text from `kickoffBookingErrorMessage`.
- `kickoff-booked`: new state (live routes straight to /overview). Port the booked card and confirmation, with copy driven by the POST response (FIX 6).
- `continue`: not ported here; the auth plan owns /continue and its five states.
- `cut-brief`, `cut-payoff`, `cut-video`: design file only, skipped.

Team flow (`team-onboarding-app.jsx`):

- `team-welcome`: port the design sub, the "Starting" row label, the seat card in place of the gear preview (the MacBook shipping claim is fabricated), and the pronoun-free scene line "Say hello any time, in here or in person." (live says "He'll meet you at 9:30 on day one"). Role, start and buddy placeholders stay (question 4).
- `team-profile`: port label association, "they/them" placeholder, keyboard-reachable photo upload. Do not add the design's "You can change any of this later" note: none of these fields is stored (question 9).
- `team-error`: port `ObAlert` and a real "Try again" that re-runs acceptance (live only resets a ref, so nothing retries).
- `team-seat`: port as the short landing after the final button, before the dashboard loads. Drop "Liam has been told you are here" (nothing notifies).
- `team-cut-payoff`: design file only, skipped.

Shared scene and card:

- Desktop shows "Step N of M" under the ledger (`.ob-context`); the card's dot stepper shows below 64rem only (hidden by CSS at 64rem and up, kept in the DOM because the e2e reads its text).
- Focus-visible outlines, 44px corrections, the leaf radius on the primary CTA, the white spinner on the green button (today's spinner is green on green and invisible), and the dead mock-card CSS removed from `ONBOARDING_CSS` (the review's left-out item, resolved in the app).

## FIX items resolved inside the slices

The critic's final verdict is SHIP with no open FIX list. The review's one left-out item (dead mock-card rules) is resolved in S1 for the app. Porting surfaced these honesty problems in the design, each resolved in a slice:

1. welcome-masked says "Nothing is blocked: continue, and the studio confirms the match." Acceptance refuses a mismatched verified email (403), so that is false. The port says the invite went to a different address and to sign in with that address, and suppresses the duplicate 403 alert on this path (S2).
2. welcome-error says "You can keep going in the meantime." Without a joined org, the invited path cannot complete. Dropped (S2).
3. pay-processing replaces the Stripe element with a status line. Unmounting the PaymentElement during `confirmPayment` breaks confirmation and 3DS. The port keeps it mounted and adds the status line above it (S2).
4. The details note "You can change these any time from your account" implies the fields are saved; today every details input is discarded. The port wires role (PATCH `/api/portal/profile`) and workspace name (PATCH `/api/portal/organisation`) best effort, and the note names only what is saved. Timezone has no column and stays as today (S2, question 9).
5. Kickoff "Reschedule any time from your studio" and "I will book from my studio": no client booking or reschedule surface exists. Live copy kept (S2).
6. kickoff-booked promises a confirmation email and a calendar invite. The port shows each sentence only when the POST response says `emailed` or `calendarPushed` (S2).
7. The design's currency control draws three currencies; the backend presents six. The port renders `PRESENTMENT_CURRENCIES` (S2).
8. team-welcome's seat card says "Continue and your seat is claimed"; the seat is claimed on mount. The card reflects the real acceptance state (S3).
9. team-seat says Liam has been told; nothing notifies. Dropped (S3).
10. The Identity chip shows the literal "there" when a visitor has no name (live `contact.name` fallback). The port shows the email instead (S2).

## Skipped (keeps today's live behaviour)

- `cut-brief`, the "Your brief" step: design file only; question 2.
- `cut-payoff`, the cream first-run checklist payoff: design file only; question 3. Finish still routes to /overview.
- `cut-video`, the hello video modal: design file only; `ONBOARDING_VIDEO_ENABLED` stays false (LW.2).
- `team-cut-payoff`, "Ready for day one": design file only.
- The dark canvas and any dark card (the `.dark` rules in `onboarding-states.css`): question 1. The port stays theme pinned light like sign-in.
- The long in-frame Stripe caption and the hatched placeholder (`.ob-pe-frame`, `.ob-pe-note`): question 2 of the pay step. The real element mounts in the frame.
- `continue` (the `.ob-hold` card): superseded by the auth module's continue states.
- Real per-hire role, start date, gear and buddy on /welcome (`resolveToken`): question 4. Placeholders stay.
- The design's proposal-language copy on the chooser, enquiry and sent screens: live copy is newer.
- Prototype chrome: the Pages picker, the "Design file only" ribbon, the Stage wrapper.

## Questions for Liam

1. Dark mode: the port keeps the whole onboarding surface light for a dark-mode visitor, the same as sign-in. Do you want the design's dark canvas around the card, or a dark card, later?
2. Pay step framing: the port mounts the real Stripe element inside a "Payment details / Stripe" frame with one hint line underneath, and leaves out the design's longer explanation. Enough?
3. Currency is locked while Stripe confirms (switching would recreate the subscription mid-payment). Confirm that is the behaviour you want.
4. "Your brief" step: build it for the project path, or cut it and remove the unused `work` label from the step table?
5. Finish: keep routing straight to /overview (the client-home checklist returns later, LW.9), or revive the cream payoff inside /onboarding?
6. /welcome: build `resolveToken` against a real teammate invite (role, start date, gear, buddy), or strip the placeholders until T1.17 lands?
7. A first-contact invite opened on the wrong account walks steps that cannot complete, because acceptance refuses the email. The port says so honestly and still lets them continue. Should that screen instead offer only "sign out and use the invited address"?
8. Kickoff has no client reschedule or book-later page, so the port keeps "Not now, email me about a time". Do you want a client booking surface in the portal later?
9. Timezone (both flows) and preferred name, pronouns and photo on /welcome are collected but nothing stores them (no column). Keep them as today, drop them, or add columns (a migration you would apply)?

## Slices

Build order: S1 first. S2 and S3 in parallel once S1 is merged (both import `ObAlert` and use S1's classes). After S2 and S3 merge, the merger makes one closing commit on `onboarding-shell.tsx` deleting the legacy classes S1 had to keep (listed in S1).

### S1: onboarding shell, states CSS and shared primitives (1 day, no backend, no migration)

Owned files: `components/tahi/onboarding-shell.tsx`, new `components/tahi/__tests__/onboarding-shell-primitives.test.tsx`.

Follow `onboarding-states.css` (every section except the dark canvas block, the page picker, the `.ob-cut` ribbon and `.ob-hold`) and the stepper rules of `onboarding.css`; render the preview at `?page=chooser`, `pay`, `kickoff`, `kickoff-loading`, `kickoff-readonly`, `kickoff-booked`, `team-welcome`, `team-seat`, each with and without `?device=phone`.

1. Tokens: add to the pinned block on `.tahi-auth-card` (never `:root`): `--ob-alert:#b42318`, `--ob-alert-bg:#fef2f2`, `--ob-alert-bd:rgba(180,35,24,0.26)`, `--ob-quiet-bg:#F4F3EF`, `--ob-sk-a:#EFECE4`, `--ob-sk-b:#F8F6F1`, `--ob-tap:2.75rem`, `--ob-leaf:0 1.5rem 0 1.5rem`, `--ob-leaf-btn:0 0.75rem 0 0.75rem`, `--ob-leaf-card:0 1rem 0 1rem`, `--ob-placeholder:#9b9a94`, `--ob-info:#1d4ed8`, `--ob-info-bg:rgba(96,165,250,0.16)`, `--ob-ok:#15803d`, `--ob-ok-bg:rgba(74,222,128,0.18)`, `--ob-hover:#F4F3EF`. Point existing literal uses you touch at these.
2. New classes, names exactly as the design (S2 and S3 rely on them): `.ob-alert` (flex, icon, bold title line, `--ob-alert*` colours), `.ob-quiet`, `.ob-note` (pill with icon), `.ob-linkish` (inline-flex, min-height `var(--ob-tap)`, brand-dark, underline on hover, focus ring), `.ob-req` (brand-dark, the "Required" tag) and `.ob-opt` (subtle, "(optional)"), `.ob-field-err` (0.8125rem, `--ob-alert`), `.ob-vh` (visually hidden), `.ob-context` (scene step count, colour `#DCE8D9` as the scene exemption), `.ob-plan-name`, `.ob-confirm` (from `onboarding.css`), `.ob-cal-zone`, `.ob-sk` and `.ob-sk.head` with the `ob-sheen` keyframes, `.ob-booked`, `.ob-booked-ic`, `.ob-booked-t`, `.ob-cur`, `.ob-cur-l`, `.ob-cur-seg`, `.ob-cur button` (on, hover, disabled, focus), `.ob-cur-lock`, `.ob-stripe`, `.ob-stripe-h`, `.ob-stripe-by`, `.ob-stripe-hint`, `.ob-pe` (keep as the element wrapper, `min-height:11.5rem` so the card does not jump while Stripe loads), `.ob-seat`, `.ob-seat-ic`, `.ob-seat-t`.
3. Corrections from the design: focus-visible outline (0.125rem `var(--ob-brand-dark)`, 0.125rem offset) on `.ob-next`, `.ob-back`, `.ob-skip`, `.ob-slot-chip`, `.ob-plan`, `.ob-addon`, `.ob-fd-opt`, `.ob-invite-add button`, `.ob-drop`, `.ob-linkish`, `.ob-invites .act`, `.ob-cur button`; touch targets (`.ob-skip`, `.ob-back`, `.ob-drop`, `.ob-invites .act`, `.ob-slot-chip` at `var(--ob-tap)`; `.ob-next` and `.ob-invite-add button` at 3rem); long identities and emails wrap (`.ob-identity`, `.ob-invites li` flex-wrap, `overflow-wrap:anywhere`); `.ob-next.leaf` and `.ob-plan.rec` leaf radii; `.ob-next[disabled]` opacity 0.62, not-allowed; `.ob-next .ob-spin` white on the green button (keep the green standalone `.ob-spin`); disabled slot chips dashed on the quiet background; `.ob-cal` five columns with a 0.5rem gap; replace the live "two columns under 64rem" rule with the design's under-40rem rule (days stacked, day label inline, chips wrap three to a row at `flex:1 1 5.5rem`), plus `.ob-cur` stacking and six currency buttons wrapping three to a row under 40rem.
4. Stepper: `@media (min-width:64rem){ .ob-stepper{ display:none } }`, keep the element rendered. Hide `.ob-context` under 64rem.
5. `Ledger`: when not `staticList`, render `<p className="ob-context">Step {idx+1} of {steps.length}</p>` after the list. No call site changes.
6. Export `ObAlert({ title, text }: { title: string; text?: string })`: `div.ob-alert role="alert"`, warning icon, `<b>` title, optional text. Export a type `OnboardingAlert = { title: string; text?: string }`.
7. `TimezoneField`: optional `id` prop (default `ob-tz`) tied to its label.
8. `PhotoField`: the file input becomes `.ob-vh` (not `hidden`) so it is keyboard reachable; `.ob-drop:focus-within` shows the focus ring.
9. Motion: add `html.reduce-motion` selectors next to every existing `prefers-reduced-motion` block, and include `.ob-sk` and the spinners.
10. Delete the never-referenced mock-card rules: `.ob-pe-field`, `.ob-pe-tab` (and its media rule), `.ob-pe input`, `.ob-pe .card-icon`, `.ob-pe input.ob-cardno`, `.ob-pe .ob-row2 input`. Keep, until S2 and S3 merge, these legacy classes still in use: `.ob-decline`, `.ob-tz-note`, `.ob-readonly-note`, `.ob-ccy`, `.ob-slot-chip.skel`, `.ob-gear*`, `.ob-fallback a`; list them in the commit body for the closing cleanup.
11. Do not touch `NeonLeaf`, `ReturnToSignIn`, `useGrow`, the wordmark, the scene rules, or the 42/58 split. Do not add any `.dark` rule.
12. Test (`renderToStaticMarkup`, the pattern in `onboarding-shell-signout.test.tsx`): `ObAlert` renders `role="alert"` with title and text; `Ledger` renders "Step 2 of 4" when `idx=1` and nothing when `staticList`; `Stepper` still renders `.ob-count`; `TimezoneField` label `for` matches the select `id`.

States to check: every existing screen renders unchanged apart from the corrections (legacy classes still styled). 375px: no horizontal scroll in the pay and kickoff layouts. Dark: `.dark` on `<html>`, the page is pixel-identical to light. Do not build any flow logic here.

### S2: client flow and payment (2.5 days, needs a server read, no migration)

Owned files: `components/tahi/onboarding-content.tsx`, `components/tahi/onboarding-payment.tsx`, `app/(onboarding)/onboarding/page.tsx`, new `lib/onboarding-welcome-summary.ts`, new `lib/__tests__/onboarding-welcome-summary.test.ts`, new `lib/onboarding-welcome-summary-server.ts`, `app/(onboarding)/onboarding/__tests__/onboarding-seat-landing.test.tsx`, `e2e/onboarding-personas.spec.ts`.

Follow `onboarding-app.jsx` page keys chooser through kickoff-booked. Needs S1 merged.

1. One alert slot: `const [alert, setAlert] = useState<OnboardingAlert | null>(null)` rendered as `<ObAlert>` at the top of `.ob-body`, above the heading, for the join, enquiry, pay, invoice and kickoff errors. Clear it on every step change and every retry. Replace every `.ob-decline`, `.ob-tz-note` and `.ob-readonly-note` use.
2. Identity chip helper: bold line is the contact name when a real one exists, else the email; the small line is the email only under a name; initials from the name or the email's first letter. Greetings keep the "there" fallback.
3. Chooser, enquiry, enquiry-sent: keep live copy and validation. Enquiry labels get `htmlFor`/`id`; company and brief carry `<span className="ob-req">Required</span>`, website `<span className="ob-opt">(if you have one)</span>`; validation messages go to the alert slot as the title; the primary shows `.ob-spin` plus "Sending" while submitting.
4. Welcome: the join error becomes the alert with title "We could not open your workspace." and text = the API's `error` string when present (they are human sentences from `acceptClientInvite`), else "Please contact the studio and we will sort it."
5. Masked welcome: `page.tsx` computes `inviteMasked = !!invite && invite.flow === 'client' && !!invite.persona && !invite.expired && !matches` and passes it. When true (and not existing): title "Welcome to Tahi.", sub "Your invite link works, but it was sent to a different email address, so the workspace details on it stay private.", the identity chip of the signed-in visitor tagged "Signed in", then `.ob-quiet`: "To join that workspace, sign out and sign back in with the address the invite was sent to. Use Sign out and return to sign in." Suppress the join alert when acceptance answered 403 on this path (same fact). Primary stays "Step inside". Never pass any invite PII to the client.
6. Existing welcome summary: new pure `existingBillingLabel({ paymentTerms, invoiceChannel })` in `lib/onboarding-welcome-summary.ts`: invoiced terms (`isInvoicedTerms`) give "Invoiced, net N" (from `paymentTermDays`); `paymentTerms === 'card'` gives "Card on file"; else `invoiceChannel === 'xero'` gives "Invoiced through Xero"; anything else gives null. Unit test every branch. `lib/onboarding-welcome-summary-server.ts` exports `loadExistingBillingLabel(d1OrgId)`: one select of those two columns, try/catch to null. `page.tsx` calls it only when the resolved entry is existing, the invite named `invite.orgId`, and the verified email matched; pass `billingLabel` down. Body: `.ob-summary` with Workspace (companyName, row omitted if absent), Billing (omitted if null), then a total row "New engagement" with "Project" or "Retainer". Keep the live title, sub and "Get started". Do not export anything but the page and `metadata` from `page.tsx`. Mock the new server module in the seat-landing test and add one case: an existing persona with a mismatched email renders the wizard with `inviteMasked` true and no company.
7. Plan: add `<div className="ob-plan-name">{p.name}</div>` above the outcome; prices "US$1,500"; "Plus tax where it applies"; the anchor in US$; the primary shows the spinner with "Setting up your workspace" while provisioning. Clean the `&apos;` replace hacks.
8. Pay (`onboarding-payment.tsx`): new optional props `onAlert(a: OnboardingAlert | null)` and nothing else. Order: `.ob-cur` row ("Billed in", `role="group"` `aria-labelledby`, one button per `PRESENTMENT_CURRENCIES` entry, label upper case, `aria-pressed`), `.ob-summary` (live logic, add-on row only when chosen), `.ob-stripe` (header "Payment details" plus the lock icon and "Stripe"; inside `.ob-pe` the real `PaymentElement`; `.ob-stripe-hint` "Card details go straight to Stripe. Tahi never sees or stores them."), `.ob-trust` "Secured by Stripe.", `.ob-fallback` "Prefer to be invoiced? " plus `<button className="ob-linkish">Set up net terms</button>`. Money: a symbol map `{ usd:'US$', nzd:'NZ$', aud:'A$', gbp:'£', eur:'€', cad:'CA$' }` with en-US grouping; primary "Pay {amount} a month".
   - Loading the client secret: inside `.ob-pe` show the live spinner and "Getting your retainer ready."; currency buttons and Pay disabled.
   - Confirming: lift `busy` out of `PayForm`. Keep `PaymentElement` mounted. Currency buttons disabled with `.ob-cur-lock` "Locked while Stripe confirms"; `.ob-quiet role="status"` "Setting up your retainer with Stripe. Please do not close this page." above the frame; invoice link hidden; footer is only the disabled primary with a spinner and "Setting up your retainer".
   - Stripe error: `card_error` gives title "Your bank declined this card." with text "{message} Nothing has been charged."; `validation_error` gives no alert (Stripe marks the fields); anything else gives title "The payment did not go through." with Stripe's message. Send through `onAlert`; clear on currency change, Back and a new attempt.
   - Invoice me: while it runs, lock currency and disable Pay; 402 gives title "We could not switch this workspace to invoicing." with the live 402 sentence; other failures give title "We could not set up net terms." with the live sentence.
   - Stripe unavailable: summary, then `.ob-quiet` "Card payment is not available right now. We will set up net terms and email your first invoice.", footer Back and "Continue, invoice me".
9. Details: controlled inputs with `htmlFor`/`id`. Known company shows `.ob-confirm` with the company in bold and an `.ob-identity-tag` "Set up by the studio"; unknown shows the workspace name input. On Continue, unless `isPreviewingClient`, best effort and in parallel: PATCH `/api/portal/profile` `{ role }` when role is not empty; PATCH `/api/portal/organisation` `{ name }` when the name was asked and is not empty. Show the spinner with "Saving" while they run; advance regardless of the result; never surface a failure. Note line: "You can change your role and workspace name any time from your account." when the name was asked, else "You can change your role any time from your account." `TimezoneField` unchanged (not stored).
10. Invite: `<label className="ob-vh" htmlFor="ob-inv">Colleague email</label>`; invalid Add sets `aria-invalid` and shows `<p className="ob-field-err">Enter a full email address.</p>` until the input changes; ignore duplicates; while posting, the primary shows the spinner and "Sending invites". Keep live copy.
11. Kickoff: keep the live lead card copy, sub, skip "Not now, email me about a time" and trust lines. The `SlotPicker` gains a `readOnly` note and returns its zone labels to the parent through a callback.
   - Ready: `.ob-cal-zone` above the grid, "Times shown in <b>{visitor}</b> (your time). {lead} is in <b>{studio}</b>."; grid; trust line under it.
   - Loading: five `.ob-cal-day` columns of `.ob-sk.head` plus four `.ob-sk` spans, `aria-busy="true"`, no buttons; trust line hidden.
   - Unavailable and empty: `.ob-quiet` with the two live sentences in place of the zone line and grid; trust line hidden.
   - Read only (`isPreviewingClient`): chips disabled; under the grid `<span className="ob-note">` with an eye icon and "Read only while viewing as a client"; no amber banner, no skip link, no trust line. Primary "Enter your studio" still completes.
   - Booking: primary spinner and "Booking your call". Failure: alert title "We could not book that time." with `kickoffBookingErrorMessage(status, error)` as the text; the chosen chip stays selected.
   - Booked (new sub-state on 201; keep the response): title "Your kickoff is booked.", sub "That is everything. Your studio is open whenever you are.", `.ob-booked` with a calendar icon, bold `formatSlotSummary(slot, { timeZone: visitorTimeZone() })` plus the visitor's city (last segment of the IANA id, underscores to spaces), small line `{formatSlotTime(slot, { timeZone: STUDIO_TIME_ZONE })} in Auckland, 30 minutes with {lead.first}.` (drop the Auckland clause when the visitor is in the studio zone). Then `.ob-quiet`: "A confirmation is on its way to {email}." when `emailed`, else "The studio has your time and will follow up by email."; append "It is in {lead.first}'s calendar." only when `calendarPushed`. Footer: only "Enter your studio", which calls `onComplete`. No Back, no skip, no reschedule claim.
12. Leave the `<Stepper>` rendered on every step (S1 hides it on desktop).
13. e2e: in persona 5 replace `toHaveCount(4)` on `.ob-cal .ob-cal-day` with an at-least-one check (availability varies and there are five working days); keep the `.ob-stepper .ob-count` text assertions (the element stays in the DOM).

States to cover per step: loading, empty, error, populated as above, plus read-only kickoff and the masked, existing and error welcomes. 375px: no horizontal scroll; every footer button, skip link, invoice link, currency button, plan card, add-on, chooser option, invite Add and Remove, and slot chip at least 44px; currency buttons wrap three to a row. Dark: `.dark` set, pixel-identical to light. Do not build: the brief step, the cream payoff, the video, a dark variant, the in-frame Stripe caption, any new API route, any migration.

### S3: team welcome (0.75 day, no backend, no migration)

Owned files: `components/tahi/team-welcome-content.tsx`, `app/(onboarding)/welcome/page.tsx`.

Follow `team-onboarding-app.jsx` page keys team-welcome, team-profile, team-error, team-seat. Needs S1 merged.

1. Join state: `'none' | 'pending' | 'joined' | 'error'` (`none` when there is no token). Extract the accept call into a callback used on mount and by "Try again".
2. team-welcome: sub "We're so glad you're here. Everything's sorted, so this is a warm hello and one light step." Summary rows Role, Starting (`hire.start`), Your buddy (placeholders stay). Replace `GearPreview` and the `Laptop` icon with the `.ob-seat` card: pending shows bold "A seat in the Tahi Studio workspace" and small "Switching it on for this session. Nothing else to sign."; joined shows bold "Your seat in the Tahi Studio workspace is on" and small "Switched on for this session. Nothing else to sign."; no card when `none`.
3. team-error: `ObAlert` above the heading, title "We could not add you to the Tahi workspace.", text is the API's `error` or "Please contact the studio and we will sort the invite out."; the primary reads "Try again" and re-runs acceptance (spinner while pending); once joined it returns to "Say hello back".
4. Scene: keep `SceneShell` and the ledger; the lead line becomes "{buddy.first} is your buddy." with "Say hello any time, in here or in person."
5. team-profile: labels tied to inputs (`tw-name`, `tw-pronouns`, `TimezoneField id="tw-tz"`), pronouns placeholder "they/them", keep "That's me". No "change it later" note (nothing is stored).
6. team-seat: after the final primary, before `router.push`, render `.ob-success` (ring, "You are in the Tahi workspace.", and "Your seat is active on this device." only when joined), then an `.ob-seat` card with the visitor's own email and "Tahi Studio workspace"; footer is a disabled primary with the white spinner and "Opening your dashboard". `onComplete` still fires `/api/onboarding/complete`.
7. `page.tsx`: pass the viewer's own primary email as `email`; nothing else changes (hire and buddy placeholders stay).

States: pending, joined, error, no token; profile populated and empty; landing. 375px: seat card wraps, footer 44px, photo upload reachable by keyboard. Dark: pixel-identical to light. Do not build: real hire data, a first-week schedule, a buddy notification, the cream payoff.

## Shared files (schedule around other modules)

- `components/tahi/onboarding-shell.tsx`: shared by both flows here; owned by S1, then the closing cleanup.
- `components/tahi/auth-shell.tsx`: owned by the auth port. It defines the same `.tahi-auth`, `.tahi-auth-card` and `.ta-*` class names in its own CSS string and renders /onboarding's InviteProblem card. This port does not touch it or InviteProblem's markup.
- `app/(auth)/continue/*`: owned by the auth port.
- `app/(onboarding)/onboarding/page.tsx`: S2 here; the auth plan lists it as a consumer of AuthShell only.
- Read-only dependencies other modules may edit: `lib/kickoff-slot.ts`, `lib/stripe-plans.ts`, `lib/invoice-billing.ts`, `app/api/portal/profile/route.ts`, `app/api/portal/organisation/route.ts` (portal-account), `app/api/portal/calls/route.ts` (ops or calls), `components/tahi/feedback-ball.tsx`, `lib/theme-boot-script.ts`, `app/globals.css` (not touched).

## Risks

- Unmounting the PaymentElement during confirmation breaks payment and 3DS; the processing state must overlay, not replace.
- The details writes are new behaviour: the organisation PATCH is admin gated (T1.14 means a first owner may be refused) and both routes refuse Client view. Best effort only, never blocking.
- The masked copy must not leak invite PII; the billing row must stay behind the verified-email match.
- The e2e reads the card stepper text; hide it with CSS only. The personas spec needs Clerk keys and is skipped without them, so a green CI run proves nothing about it.
- Live smoke touches real systems: booking a kickoff writes a call, notifies the studio, sends an email and may create a calendar event; invites send email; invoice-me raises a real draft invoice; pay would charge. Smoke only with the dummy client and tahi.studio or liammiller.dev addresses (client email allowlist), stop short of Pay, and clean up any call or draft created.
- Legacy classes stay in `ONBOARDING_CSS` until the closing cleanup; if it is forgotten they remain dead.
- Class drift with the auth shell: both define the same scene classes in separate strings; neither port should start depending on the other's CSS.
- Everything here ships as ported, unchecked; Liam's answers to questions 1 to 9 may reopen parts of it.

## Definition of done per slice

type-check and lint at zero, `npm run build` passes, tests green, pushed and deployed, live smoke on the deployed URL (chooser and enquiry as a fresh self-serve test account; the invited and existing paths with a minted test invite; /welcome with a team test invite), 375px pass, dark pass with `tahi-theme=dark`, screenshot or note in the commit body. Tasks stay open until all of those pass.
