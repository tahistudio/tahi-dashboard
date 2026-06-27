# Team onboarding ("Welcome to Tahi") - design brief and as built

> A warm, on-brand hello for a new teammate. Deliberately NOT an HR / payroll /
> e-sign / IT system. Contract is signed and payroll is set up off-platform
> (Xero) before this link is ever sent. This screen's only job is to make a new
> teammate feel expected and cared for on day one.

## Page purpose

One short Studio Ledger moment that says "you're expected, you're in good hands," captures the few non-sensitive profile bits that help the team welcome the person, and previews what day one feels like. It is the warm shell, nothing more.

## Principle: build the warm shell, rent every regulated engine

This is the load-bearing decision (carried over from the team-onboarding audit, now retired). Tahi builds the orchestration and the feeling; Tahi delegates the data capture, the legal effect, and the execution. For ~3-8 hires a year, building the compliance layer is pure liability with no differentiation, and it duplicates tools already paid for.

**What this flow deliberately does NOT do** (each was a real liability in the earlier design):
- No passwords, ever. The app is not the identity provider.
- No bank account, IRD number, tax code, or KiwiSaver. That is identity-theft-grade PII and a Privacy Act 2020 liability; it lives in Xero Payroll (Xero Me self-onboarding), never in D1.
- No tick-box + typed-name "signing." A tick-box is not a defensible signature under the ERA; agreements are signed via a real e-sign tool before the start date (which also protects the 90-day trial).
- No employee / contractor self-selection. Classification is the employer's legal call (NZ Gateway Test), decided before the invite is sent.
- No "Provisioned" account badges or in-app account creation. Status is shown only when it is genuinely true.
- No gear selection / procurement. Gear is ordered by a founder; the flow at most previews "your MacBook is on the way."

What stays in-house is exactly the part worth owning: the welcome, the buddy, the day-one feeling, the cultural checklist.

## Flow

Two light steps, then routes into the dashboard:

1. **Welcome** - name, role, first day, "your buddy is Liam," and a gear preview ("Your MacBook Pro 16 is on the way"). The premium hello.
2. **About you** - the only real capture, all non-sensitive: photo, preferred name, pronouns, timezone (auto-detected, editable as a preference).

The final cream "Ready for day one" screen (first-week timeline + before-you-start cultural checklist: add a photo, say hi in #team, read the handbook) is **not built here**; it folds into the first home/tour feature. On finish the flow routes to `/overview`.

## Component spec

Reuses the Studio Ledger scene from auth/onboarding: forest panel (neon leaf, grain, bloom, wordmark) with the step ledger and a buddy card, and a floating white card carrying the stepped form. Height animates between steps (`useGrow`); inner content staggers in; all motion yields to `prefers-reduced-motion`. Scene split 42% / 58%. Mobile collapses the scene to a top band and stacks the card.

## Entry routing

Reached via a teammate invite link. The link carries the hire's context (name, role, start date, gear, buddy) and passes through sign-in (`/sign-in?redirect_url=/welcome?...`) so it survives auth. See `01-auth.md` "entry routing" and `lib/onboarding-entry.ts` (`resolveTeamEntry`).

## As built (2026-06-27)

- `components/tahi/team-welcome-content.tsx` - the two-step flow (welcome + profile), gear preview surfaced on the welcome step.
- `components/tahi/onboarding-shell.tsx` - shared scene, `useGrow`, `TimezoneField`, `PhotoField`, `ONBOARDING_CSS`.
- `app/(onboarding)/welcome/page.tsx` - server entry; resolves the teammate link + Clerk identity, renders the flow, routes to `/overview` on finish.

**Seams.** Role / start date / gear / buddy come from the teammate invite record (defaults render a complete welcome until that lookup is wired). Photo and preferred name are captured locally; persist to the Clerk user / team member profile when wired.

## Removed

`03-team-onboarding-research.md` (the founder's audit) has been removed; its load-bearing conclusions are folded into the "Principle" section above and into the build.
