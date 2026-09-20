# Cutover Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cutover blockers from the ship readiness audit so the studio can move a real client from ManyRequests onto the dashboard: invite and log in, onboard, submit and receive work, open and pay invoices, and get the emails and notifications that hold it together.

**Architecture:** The audit at `docs/superpowers/audits/2026-09-03-ship-readiness-audit.md` (section 2 matrix, section 5 Tier 1) is the spec. Nineteen items are grouped into five slices with disjoint file ownership so they can build in parallel git worktrees, each followed by a spec and a quality review and a fix pass, then merged by the lead in the order below. Shared helpers (`lib/require-feature.ts`, `lib/page-guard.ts`, `lib/permissions.ts`, `lib/notification-links.ts`) each have exactly one owning slice; other slices consume their existing contracts.

**Tech Stack:** Next.js 15 App Router on Cloudflare Workers, Drizzle on D1, Clerk, Stripe, Resend with React Email, the worker MCP server.

---

## Slices (branches)

| Slice | Branch | Items | Owns |
|---|---|---|---|
| Client entry | `cut/client-entry` | 1, 2, 7, 8 | onboarding invites mint and email, client create and welcome routes, client detail invite action, contact link on sign-in (`lib/contact-link-server.ts`), portal invites, provision and accept-invite portal role, MCP `invite_client_contact` |
| Billing | `cut/billing` | 3, 4, 5, 6 | invoices schema and migration (hosted pay URL), portal invoice detail route, send-email route and template, draft-notify fix, invoice pages, invoice-me onboarding path |
| Client surfaces and comms | `cut/client-surfaces-comms` | 9, 10, 11, 13, 19 | Files page, nav model and middleware matcher, cron workflow URLs, audience-aware notification links, portal message and review fan-out, first-run checklist and kickoff call |
| Security | `cut/security` | 12, 14, 15 | worker MCP authorize flow and ManyRequests token to a secret, timer org derivation and honest logging |
| Permissions | `cut/permissions` | 16, 17, 18 | role enforcement on money and client-data admin routes, page guards, roleless deny, portal feature visibility helper |

Merge order: security, permissions, client entry, billing, client surfaces and comms. Routes owned by entry and billing that need the role check from the permissions slice are guarded by the lead after the merge, using the shared helper.

## Decisions (lead, 2026-09-05)

1. Invites are the only way a client gets a login; the welcome email is an invite with a tokened link, never a bare portal root link.
2. The Stripe hosted invoice URL is persisted on the invoice row and is the client's Pay now. No client-side Stripe session creation in this pass.
3. Draft invoices never notify clients; sending does.
4. Dead client nav items are removed rather than built this pass (contracts, proposals and schedules are Tier 3).
5. The MCP authorize endpoint must not approve on client id alone; the ManyRequests token moves to a worker secret and Liam rotates it in ManyRequests.
6. Roleless team members are denied everywhere; super admins are never affected.
7. Operator steps (secrets, token rotation, migration apply) are collected from each slice's report and handed to Liam in one list.

## Definition of Done per slice

- [x] Type-check, lint zero errors, full Vitest green in the worktree.
- [x] Spec review and quality review passed, fix pass applied.
- [x] Merged to main by the lead (b5d589b8 plus the lead's guard commits f73a74a5, 9030d881, 4c955671); type-check, lint, 1455 unit tests, build green; pushed 2026-09-05.
- [x] Live smoke on production 2026-09-05: invoice opened from the portal (pay link present only on Stripe-backed invoices), Files page listed (empty state and upload CTA) in client preview after 35f95ac1, notification links resolve per audience, cron hits 200 (pre-call-digest, run 33932573058) and 403 without the secret, invite action rendered per contact. Not exercised live: sending a real invite email (Liam's call, it emails a client), timer honesty and roleless refusal (unit-tested only).
- [ ] Operator steps done or handed to Liam with exact commands.

## After Tier 1

- Tasks page rebuilt in the repo from the prototype's `tasks.jsx`, `tasks.css`, `tasks-data.jsx` (local copies under `.claude/design-drafts/tasks-final/`).
- Tier 2 from the audit, starting with client creation capturing customMrr, currency and a Stripe customer.
- Delete the dead legacy Requests branches.

## Integration notes (lead, 2026-09-05)

- Migration 0086 (invoices.stripe_hosted_invoice_url, organisations.payment_terms) applied to production D1 with wrangler BEFORE the deploy, as the billing slice required.
- Lead guarded after merge: timers (list, start, patch, delete, ping) with requireFeature 'time'; portal invoices list and detail, files, request messages and review with requirePortalFeature.
- Operator steps handed to Liam: rotate the ManyRequests token then set MANYREQUESTS_API_TOKEN, OAUTH_CLIENT_SECRET, OAUTH_APPROVAL_KEY and OAUTH_TOKEN_EPOCH on the worker and redeploy; confirm RESEND_API_KEY, RESEND_FROM_EMAIL, NEXT_PUBLIC_APP_URL and the GitHub variable TAHI_DASHBOARD_URL; re-run the Stripe invoice import to backfill pay links; designate a billing contact per migrated org; give every team member a role.
- Open follow-ups from the slices: paymentTerms in the client PATCH allowlist and client detail; contacts email case-folding and a unique index; portal invites step surfacing a refusal for members; the client-visible feature keys on the remaining portal routes.
- Live smoke 2026-09-05 (production, as Liam): portal invoices list and detail open for an impersonated client with no 403 (Pay now appears only once an invoice has a Stripe hosted URL; legacy Xero-era rows have none, new Stripe invoices and the send-email path store it); portal files and requests routes answer for the previewed org; the client detail page shows the per-contact "Email a portal invite link" action; notification items resolve per audience. Two preview-only defects fixed in 0dfc06df (Files page redirect, client nav hiding Files and Services under the team feature map).
- Cron: the base URL fix alone was not enough. Clerk's middleware only listed the AI briefing cron as public, so every scheduled POST 404ed before the handler saw x-cron-secret. b8b3f366 lists the scheduled targets in the public matcher (each fails closed at the route). Repo variable TAHI_DASHBOARD_URL set to https://portal.tahi.studio.
