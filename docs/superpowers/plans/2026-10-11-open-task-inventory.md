# Open task inventory, 2026-10-11

Triage inventory of every open TASKS.md item (checkbox `[ ]` or `[~]`) that is not historical or superseded. Built from TASKS.md (all 1640 lines), STATUS.md, docs/superpowers/plans/2026-10-10-dashboard-task-triage.md and the commits from 1171d9e5 to HEAD (bc7412e9). A few spot checks were made against source (2f81243f diff for the reviews page and the deal nudges route). Nothing was built or changed; this is a read-only inventory.

How to read the columns:

- St: `[ ]` open, `[~]` merged or deployed but not proved live.
- Blocked by: `nothing` (an agent can start now), `Liam (decision)`, `Liam (action)` (a secret, a review, a sign-in, a real client or scoped seat, a Webflow publish), another task id, or `external`.
- Size: XS a few hours, S half to one day, M one to three days, L more than three days. Taken from the TASKS.md text where it gives one, else my read. For verify-only rows the size is the size of the check.
- Verify only: `yes` when the Codex triage, STATUS.md or a later commit says it is already built and only needs a live observation (or an operator apply). Rows marked `partly` have built parts and real remaining work, named in the notes.
- Area: billing, permissions, Slack and suggestions, contracts (also covers proposals and schedules, the sales deliverables), portal, design ports, PM AI, crons and ops, content and blog, e2e and QA, other.
- Client: client-facing yes or no (does a client see or feel the result).
- Line: line number in TASKS.md where the checkbox sits.

Evidence rule from TASKS.md still applies: nothing flips to `[x]` without a commit and a live observation. Signed-in production QA as Liam works in the Codex browser (STATUS.md 2026-10-11), but Giant Group home was only seen in the read-only lens, so client write paths, second seats and scoped seats still need a real or controlled session.

## Counts

Totals are in the summary at the end of this file (section "Totals").

## A. Giant Group beta and operator steps

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| A5 | Real-session lap: Liam or Staci in incognito for 20 minutes (greeting, bell, invite path, second seat); closes the LW.2 to LW.19 block | [ ] | Liam (action) | S | portal | yes | yes | 144 |
| SW.1 | Reconcile missed Stripe invoices. Lingorama (WEBL8VAA-0002, USD 1,000) recovered 2026-10-11; broader historical invoice and subscription reconciliation remains, plus why daily Stripe imports report zero new rows | [ ] | nothing (identity and duplicate checks first, writes through the app as Liam) | M | billing | no | partly | 164 |
| LW.8 | Calendar write scope: reconnect Google (LW.8b), book a kickoff, confirm the event and Join link | [~] | Liam (action) | XS | portal | yes | yes | 197 |
| LW.36b | Void the "test manual" Stripe invoice in_1TGQaE2MOtshRPkATn4r8ByV and delete the "test manual" org on /clients | [ ] | Liam (action) | XS | billing | no | no | 203 |
| LIAM.inbox | Work the Suggestions inbox on /tasks as calls come in (first similarity warnings) | [ ] | Liam (action) | XS | Slack and suggestions | no | no | 215 |
| LIAM.design-review | Mark docs/superpowers/plans/2026-09-14-design-review-for-liam.md (19 modules); does not block ports | [ ] | Liam (action) | M | design ports | no | no | 217 |
| LIAM.PM0-go | Say go on PM.0 (nine product choices) and set up CN.2 Slack (manifest, reinstall, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, DM once) | [ ] | Liam (decision) | XS | PM AI | no | no | 221 |
| LIAM.live-pass | Live 375 and dark pass of ed2d4385 (brief buttons 44px, Wire indent, contract mobile cards, contract truth fixes, dark status pill) plus the August fill probe (expect 422 nothing_derivable) | [ ] | nothing (signed-in Codex browser now works) | S | e2e and QA | no | yes | 224 |

## B. Follow-ups from the 2026-09-26 batch (FU family)

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| FU.1 | Suggester: each Anthropic read capped at the time left in the sweep budget (2f81243f, deployed); live evidence pending, the observed sweep had zero eligible calls so the hanging read case is unexercised | [~] | nothing | XS | Slack and suggestions | no | yes | 239 |
| FU.2 | Contracts past expiry: Lapsed pill, API and MCP refuse to email expired links, signing deadline in the email (2f81243f, deployed). Changed signing email preview still owed (endpoint has no UI; Liam has the console command) | [~] | Liam (action) for the email preview; rest nothing | XS | contracts | yes | yes | 245 |
| FU.3 | Decide: block hand-marking a partly signed contract as signed, or build a real countersign (recommendation: block) | [ ] | Liam (decision) | S | contracts | yes | no | 252 |
| FU.4 | Expiry date shown in the viewer's zone vs the studio's pick (2f81243f, deployed) | [~] | nothing | XS | contracts | yes | yes | 255 |
| FU.5 | Dark leftovers: schedule STATUS_PALETTE, contract audit accents, hand-rolled danger menus, Wire and News label contrast (2f81243f, deployed; the danger ink token) | [~] | nothing | XS | other | no | yes | 259 |
| FU.6 | Desktop: Wire item ellipsis, contracts table fit at 1280 (2f81243f, deployed). TASKS.md execution update says 1280 table fits | [~] | nothing | XS | other | no | yes | 267 |
| FU.8 | Slack: a DM voice note arrives twice (message.im plus file_shared), confirm one card; send channel pointer and stranger refusal via chat.postEphemeral before channels go live | [ ] | CN.2 (Liam action: Slack setup) | S | Slack and suggestions | no | no | 279 |
| FU.9 | QA sqlite lost FK cascades; local repair done 2f81243f (backups, 8 edges proved in rollback fixtures); deliverable browser cleanup with the D3 specs still to be exercised | [ ] | nothing | XS | e2e and QA | no | partly | 283 |

## C. Liam's dummy-client walk-through (LW family, all merged, live check owed)

All are `[~]`. TASKS.md says the A5 lap closes the block as a group; the triage groups them into one "client home, request and account lap" so they share a single checklist at 375 and dark. Items marked nothing can be seen in the read-only Client view of Giant Group; anything needing a client write or a second seat needs A5.

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| LW.2 | Onboarding video hidden (ONBOARDING_VIDEO_ENABLED false) | [~] | A5 (Liam action, needs a new client in onboarding) | XS | portal | yes | yes | 304 |
| LW.3 | Liam is PM and lead for every client (studio.projectManagerId, applied on production) | [~] | nothing (read-only lens) | XS | portal | yes | yes | 307 |
| LW.4 | "Staci is your lead" copy becomes Liam, pronoun free | [~] | nothing (read-only lens) | XS | portal | yes | yes | 314 |
| LW.5 | "30 min with" and "Grab a time with" name Liam | [~] | nothing (read-only lens) | XS | portal | yes | yes | 317 |
| LW.6 | Kickoff slots from Liam's calendar with the client's timezone named; free/busy needs LW.8b; the MCP twin of the kickoff-slots route appears to exist already as portal_kickoff_slots, so only the free/busy check is left | [~] | LW.8 (Liam action) | S | portal | yes | partly | 319 |
| LW.9 | Onboarding checklist card hidden on client home. Seen hidden live in the Giant Group read-only lens 2026-10-11 (STATUS.md) | [~] | nothing | XS | portal | yes | yes | 325 |
| LW.10 | One New request CTA on client home | [~] | nothing (read-only lens) | XS | portal | yes | yes | 328 |
| LW.11 | Engagement-aware presentation (custom-priced retainer sees tracks or "being set up") | [~] | nothing (read-only lens) | XS | portal | yes | yes | 331 |
| LW.12 | Admin request detail side cards at mid widths (split moves to 1024px) | [~] | nothing | XS | other | no | yes | 335 |
| LW.13 | AI request wizard renders markdown (bold, lists) | [~] | nothing | XS | portal | yes | yes | 338 |
| LW.14 | AI wizard composer auto-grows, shared focus ring, 44px send | [~] | nothing | XS | portal | yes | yes | 341 |
| LW.15 | AI wizard creates every draft (parent plus sub-requests, or siblings) | [~] | nothing for studio; Liam (action) for the portal write | XS | portal | yes | yes | 343 |
| LW.16 | AI wizard timelines from one canonical hours table | [~] | nothing | XS | portal | yes | yes | 346 |
| LW.17 | AI wizard gets client context (org, brands, last five requests); which-brand question | [~] | nothing | XS | portal | yes | yes | 349 |
| LW.18 | Seat invites in Tahi's own email, Clerk invitations removed | [~] | A5 (Liam action) | XS | portal | yes | yes | 353 |
| LW.19 | Seat of an onboarded org lands in the portal, not the wizard | [~] | A5 (Liam action, second seat) | XS | portal | yes | yes | 358 |
| LW.21 | Requests kanban one vertical scrollbar | [~] | nothing | XS | other | no | yes | 441 |
| LW.22 | Delete a file from client Files, request Files panel, admin list; MCP delete_file | [~] | A5 (Liam action) for the client side; rest nothing | XS | portal | yes | yes | 442 |
| LW.23 | Services hidden for clients by default | [~] | nothing | XS | portal | yes | yes | 443 |
| LW.24 | AI wizard composer shows one focus ring | [~] | nothing | XS | portal | yes | yes | 444 |
| LW.26 | Seat invite flow: signed-out plus token goes to sign-up with email prefilled; Liam re-tests the link signed out | [~] | Liam (action) | XS | portal | yes | yes | 458 |
| LW.27 | Client home empty state keeps dark header, no fern badge | [~] | nothing (read-only lens; seen at 375 light/dark per STATUS.md) | XS | portal | yes | yes | 453 |
| LW.28 | Onboarding "Sign out and return to sign in" on every step and /welcome | [~] | A5 (Liam action) | XS | portal | yes | yes | 454 |
| LW.29 | Settings > People delete tolerant of a missing Clerk membership | [~] | nothing (needs a test teammate row) | XS | other | no | yes | 455 |
| LW.31 | Prep notes on calls (migration 0102) | [~] | nothing | XS | other | no | yes | 446 |
| LW.32 | Member seat never sees plan or billing on client home | [~] | A5 (Liam action, member seat) | XS | portal | yes | yes | 447 |
| LW.36 | Stripe importer never demotes written_off or paid (f8a6a2b4); Liam still voids the Stripe invoice (see LW.36b) | [~] | LW.36b (Liam action) | XS | billing | no | yes | 449 |

## D. Call notes to tasks, product manager AI, hand-offs, home accuracy

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| CN.1c | Suggestion rebuild as a union of passes, two reads per call, 75 s sweep budget (deployed ed2d4385); live drain and union checks remain (watch cron_runs durations and deferred counts) | [~] | nothing | XS | Slack and suggestions | no | yes | 375 |
| CN.2 | Slack app, DM first (deployed, migration 0110); waits on manifest, reinstall, two secrets, then live DM checks | [~] | Liam (action) | S | Slack and suggestions | no | yes | 377 |
| CN.3 | Keeping in sync: Slack thread lines, reject reasons as negative examples, wizard learning, Monday digest. Merged a14d0dea, deployed 511c7d5f, migration 0111 applied and verified. Needs verification of rejection learning and the digest; Slack proof needs CN.2 | [~] | CN.2 (Liam action) | S | Slack and suggestions | no | yes | 378 |
| PM.0 | Product manager AI scope (docs/superpowers/plans/2026-09-26-pm-ai-scope.md); nine decisions for Liam | [~] | Liam (decision) | S | PM AI | no | no | 397 |
| PM.1 | The check: cron scoring slip risk into pm_findings, home cards, MCP list_pm_findings | [ ] | PM.0 (Liam decision) | M | PM AI | no | no | 398 |
| PM.2 | The nudge: Tahi bot line plus Slack DM with buttons, escalation to owner | [ ] | PM.1, CN.2 | M | PM AI | no | no | 399 |
| PM.3 | Plain-words replies turned into proposed changes through the suggestion gate | [ ] | PM.2 | M | PM AI | no | no | 400 |
| PM.4 | Planning ahead: milestone subtasks against booked capacity, weekly at-risk line | [ ] | PM.1 | L | PM AI | no | no | 401 |
| PM.5 | Client accountability: waiting-on-client chasers, retainer clients quiet for 30 days | [ ] | PM.1 | M | PM AI | no | no | 402 |
| HA.1 | Receivables aging buckets (b30a95ae, c554076d) | [~] | nothing | XS | billing | no | yes | 408 |
| HA.2 | Daily brief currency prefix | [~] | nothing | XS | billing | no | yes | 409 |
| HA.3 | MRR delta basis month label; September row now exists since 1 October, so the label should read against September | [~] | nothing | XS | billing | no | yes | 410 |
| HA.4 | Pipeline ahead on the forecast's basis | [~] | nothing | XS | other | no | yes | 411 |
| HA.5 | Capacity by assigned work and active members (team.inactiveMemberEmails) | [~] | nothing | XS | other | no | yes | 412 |
| HA.6 | Retainer health bucket follows the API; test org excluded | [~] | nothing | XS | other | no | yes | 413 |
| HA.7 | Proposals live excludes drafts | [~] | nothing | XS | contracts | no | yes | 414 |
| HA.8 | One cash position (lib/cash-position.ts), tax owed as IRD balance | [~] | nothing | XS | billing | no | yes | 415 |
| HA.9 | Cash-flow ribbon full picture | [~] | nothing | XS | billing | no | yes | 416 |
| HO.1 | Client hand-offs on requests (migration 0104, live). The three-day nudge email has never run (delivery-watch is not scheduled); a real hand-off with a client is Liam's first use | [~] | Liam (decision) on reminder policy; Liam (action) for a real hand-off | S | portal | yes | partly | 422 |
| HO.2 | MCP hand-off tools, get_dashboard_guide, /help for both audiences | [~] | nothing | XS | portal | yes | yes | 437 |
| HO.3 | Tidy: hand-off types import (merged) | [~] | nothing | XS | other | no | yes | 423 |
| HO.4 | Participants route accepts approver, contributor and other contact roles (merged) | [~] | nothing | XS | other | no | yes | 424 |
| HO.5 | request_waiting_on_you notification preference toggle (deliberately deferred until a client asks) | [ ] | Liam (decision) | XS | portal | yes | no | 436 |
| DPM.1 | Default project manager for new clients by engagement type (live; Liam confirms from Settings) | [~] | Liam (action) | XS | other | no | yes | 463 |
| BP.1 | Beta comment ball. Stripped-back version live (ball, click-to-pick, context stored, MCP list_feedback_comments); the studio inbox and one-click convert-to-task from the original brief are not built | [~] | nothing for the remainder; WQA.0 must stay separate | M | other | no | partly | 471 |
| GI.4 | Request wizard learns the client. Step one merged (ff9939bd); step two, the advisor ("what are we not doing on the site"), open (about a week) | [~] | Liam (decision) design first | L | portal | yes | no | 481 |

## E. Ops, finance and content loose ends from the 2026-09 sections

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| LW.45 | schema-watchdog 0 of 50 pages pass: no JSON-LD renders on live tahi.studio posts; needs a Webflow Embed bound to the schema field and a publish. Dashboard-only part: report a finding instead of a failed cron | [ ] | Liam (action): Webflow publish needs his go (dashboard-only part: nothing) | S | content and blog | no | no | 427 |
| BL.SVG | Blog creation with SVG images; needs a scoping chat (style reference, images per post) | [ ] | Liam (decision) | M | content and blog | no | no | 428 |
| LW.42 | Yield balances drift: read Xero AWX_Yield accounts as yield source on each Airwallex sync, warn when setting older than 30 days; overlaps T0.3 | [ ] | Liam (action) to confirm figures; build otherwise nothing | S | billing | no | no | 429 |

## F. Client integrations (GI family)

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| GI.1 | Chat bot into Tahi: client Slack or WhatsApp messages become requests, voice notes transcribed; Slack first, WhatsApp needs Meta Business verification | [ ] | Liam (decision) design first; CN.2 live; WhatsApp is external | L | Slack and suggestions | yes | no | 499 |
| GI.2 | Client-scoped MCP with Clerk OAuth, then role-scoped internal MCP (about two weeks); LP.9 overlaps and must not become a second MCP architecture | [ ] | Liam (decision) design first | L | permissions | yes | no | 507 |
| GI.3 | Calls page link and purpose editable (merged ef2feca0, live); 375px and dark never eyeballed | [~] | nothing | XS | other | no | yes | 517 |
| GI.5 | Request from a document (PDF or doc in the New request dialog), about 3 days; needs extraction limits and scanned-PDF fallback specified | [ ] | nothing (small spec first) | M | portal | yes | no | 528 |

## G. Design ports and design write-back

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| DL.4 | Re-render and re-critique in the real shell after write-back. Gated on DL.3, which is marked `[x]` but its own text says UNRESOLVED (see Contradictions) | [ ] | DL.3 status check (design project file list) | S | design ports | no | no | 571 |
| AR.4 | Proposals editor needs a lot more design work first (every list row opens the same hardcoded document: wiring bug) | [ ] | nothing (design step before any port) | L | design ports | no | no | 580 |
| AR.5 | Two rules everywhere: filters in a left rail; consistent headline feature cards; rail withheld on wide-table pages | [ ] | AR.4 and the per-module ports | L | design ports | yes | no | 583 |
| MR.6 | Studio invoices design revision (SHIP); CB4 owns the implementation | [~] | CB4 | M | design ports | no | no | 589 |
| MR.7 | Services showcase: CB1 half live; remaining bounded slices of portal-money.md as "ported, unchecked"; do not settle the CT.11 order path by porting speculative checkout controls | [~] | Liam (decision) on the CT.11 order path | M | design ports | yes | partly | 595 |
| CB4 | Studio invoices port from finance.md. List port is live (511c7d5f; 120-row export, 375/768/1280, dark); detail and the rest of finance.md remain; FU.10 follow-up shipped | [ ] | nothing | M | billing | no | partly | 601 |
| T2.6 | Messages module port from messages.md using existing primitives; standalone Messages stays hidden for clients (Decision #061) | [ ] | nothing | M | design ports | no | no | 988 |
| T2.7 | Unify home daily brief and nav briefing source and refresh cycle. FU.7 (its dependency) is now `[x]`, so nothing blocks it | [ ] | nothing | M | other | no | no | 994 |
| TP.3 | My week: real week dates and multi-day allocation; needs design and probably a per-day allocation schema | [ ] | Liam (decision) design and schema | L | other | no | no | 1002 |
| TP.4 | Notifications history page; probably already covered by AR.1 and PP.4 (/notifications for both audiences); re-scope first | [ ] | Liam (decision) | XS | other | yes | partly | 1008 |
| CL.1 | Files as a small Google Drive with threads (design first). Id collides with the shipped Clerk "deletes verify with Clerk first" item | [ ] | Liam (decision) design first and id naming | L | portal | yes | no | 1017 |
| T3.11 | Deals v3 lap (internal, 2 to 3 days, can slide) | [ ] | nothing | M | other | no | no | 1091 |
| MC.6 | Deals: Stalled becomes a flag on any stage; rework staged in the design project under .claude/qa/stall, part of DL.3 | [ ] | DL.3 status | M | other | no | no | 1097 |

## H. Catalogue Batches A to D (proof and loop-closing)

Area for the sales deliverables (proposals, contracts, schedules) is `contracts`.

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| CA4 | Tenancy proof in CI (e2e-tenancy.yml). It skipped for missing dev Clerk keys, so the green workflow is not isolation proof. Add CLERK_PUBLISHABLE_KEY_DEV and CLERK_SECRET_KEY_DEV, run again, expect 3 of 3. Follow-ups: widen the path filter, mask or drop dev-server.log artifact | [~] | Liam (action): repository secrets | XS | e2e and QA | no | yes | 635 |
| C1 | Publish before share (3ecafbba); live lap owed (share, edit, verify pinned, publish, revoke 404, re-share) | [~] | nothing for the lap on a test proposal | S | contracts | yes | yes | 653 |
| C2 | Public viewer integrity (bad0d7ef); live lap owed; two minors: dark strip flash, RiskRegisterSection border hex | [~] | nothing | S | contracts | yes | yes | 660 |
| C3 | Accept, decline, question close the loop (97e51af0); migration 0098 on production, staging apply was refused earlier (retry now that Cloudflare access is restored) | [~] | Liam (action) for a real accept with an inbox | S | contracts | yes | yes | 666 |
| C4 | Contract signature artefacts (32c78bee); live lap owed; follow-up retire C3's duplicate contract-signature email template (also in T3.9) | [~] | Liam (action) for real signing inboxes | S | contracts | yes | yes | 671 |
| D3 | Playwright specs sales-publish and public-viewers green on the harness; live rehearsal with real inboxes owed (overlaps T3.QA) | [~] | Liam (action): approved test inboxes | S | e2e and QA | yes | yes | 685 |

## I. Tier 1, Trust

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| T1.3 | Auth flow robustness; remaining: one live forgot-password click-through and branded error states at 375 | [~] | Liam (action) | XS | permissions | yes | yes | 819 |
| T1.6 | Permissions invariant: feature guards shipped; 65 sales-artifact handlers guarded with 205 tests (2f81243f, deployed). Remaining: prove denied deep links return 403 for real scoped or client seats; audit new routes | [~] | Liam (action): controlled scoped and denied seats | M | permissions | no | partly | 827 |
| T1.7 | Portal noindex and robots; WAF rate rules (60/min portal, 20/min uploads) or KV limiter. Inspect existing state first | [ ] | Liam (action): Cloudflare WAF and environment check | S | crons and ops | no | no | 838 |
| T1.11 | Worker MCP /authorize hardening built (17799931); verify deployed consent, reject, approve and token revocation | [~] | Liam (action): admin approval key | XS | permissions | no | yes | 840 |
| T1.12 | Confirm the historically committed ManyRequests token was rotated or revoked (literal removed from source in 17799931) | [ ] | Liam (action) | XS | permissions | no | no | 847 |
| T1.13 | Cron scheduling live (eb89d21d); remaining: review UTC and local-hour windows; delivery-watch and automation-sweep deliberately unscheduled | [~] | Liam (decision) on reminder policy | S | crons and ops | no | partly | 853 |
| T1.14 | Portal write-path portalRole rule (c6c4870f live); needs a real client session confirming People and Organisation are editable | [~] | Liam (action) | XS | portal | yes | yes | 861 |
| T1.15 | Deny by default built (7e58adeb, c3db922e); prove deployed roleless, revoked-role and scoped-seat behaviour | [~] | Liam (action): controlled seat | S | permissions | no | yes | 882 |
| T1.16 | Per-org scoping rollout: search and nested guards deployed (2f81243f, a14d0dea); remaining live lap with controlled scoped and denied seats | [~] | Liam (action): controlled seats | M | permissions | no | partly | 889 |
| T1.17 | Hire onboarding core built (45ec6d2a, LW.18); remaining: trace invite to roster to role path with a controlled non-founder seat | [~] | Liam (action): controlled seat | S | permissions | no | partly | 899 |
| T1.19 | Teammate home: calls feed fixed; `?asMember` preview-as parameter not built (grep zero hits); needs a look and "why is this empty" copy | [~] | nothing | S | permissions | no | no | 907 |
| T1.20 | Teammate invite link dead (resolveToken is a stub; /welcome hardcodes role, gear, buddy) | [ ] | T1.17 | M | permissions | no | no | 915 |

## J. Tier 2, The working platform

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| CT.10 | One full live client lap at 375 and dark: submit, reply both ways with email, approve, pay link, files (shares one checklist with A5 and T2.QA) | [ ] | Liam (action): real or controlled client session | S | e2e and QA | yes | yes | 927 |
| CT.11 | /services catalogue scoping live (f109a969); remaining: the order path | [~] | Liam (decision) mint a request vs Stripe checkout | M | portal | yes | no | 929 |
| CT.15 | /reviews: broken review link fixed and Send replaced by Mark as asked (2f81243f, deployed). Remaining: verify live, remove or fix orphaned outreach routes (app/api/admin/reviews/outreach still exists); real testimonial pipeline is catalogue I2 | [ ] | nothing; Liam (decision) for any new automatic outreach policy | S | other | no | partly | 942 |
| CT.16 | /billing in or out of client nav (out by default, c1e8c24e); Manage Billing only for Stripe rail; client smoke owed | [~] | nothing (read-only lens) | XS | billing | yes | yes | 946 |
| CT.17 | MCP create_invoice schema now matches the API's lineItems and tool-to-route tests pass (2f81243f); messaging adapters exist. Remaining: signed-in invoice creation and messaging round trips on QA data | [ ] | nothing | S | other | no | yes | 952 |
| CT.18 | Delete /tracks (linked from nowhere) | [ ] | Liam (decision) | XS | other | no | no | 962 |
| CT.19 | /reports triage by deletion (duplicates of /sales-analytics and /financial-reports), plus the access scoping /reports never calls | [ ] | Liam (decision) on scope | L | other | no | no | 965 |
| IC.8 | Stamp-invoiced route built (c1e8c24e): run the dry run, read the count, then apply; xero-export refuses old periods until applied | [~] | Liam (action) | XS | billing | no | yes | 972 |
| IC.9 | /time at 375 controls under 44px. 2f81243f and TASKS.md state the search and filter controls measure at least 44px at 375 dark; the page redesign (LP.6 overlap) is separate | [ ] | nothing | XS | other | no | yes | 982 |
| T2.9 | /billing v3 lap merged as the CB2 half of CT.16; live smoke owed | [~] | nothing (read-only lens) | XS | billing | yes | yes | 999 |
| V1-QA.1 | Live-verify the client request detail as a client (scope pill absent, own names, Approve and Request-change banner on a client_review request) | [ ] | Liam (action): real client session or Act as client in write mode | XS | e2e and QA | yes | yes | 1031 |
| V1-QA.2 | e2e specs mobile.spec.ts and portal-flow.spec.ts still assert a client Messages tab; update for the hide | [ ] | nothing | S | e2e and QA | no | no | 1037 |
| T2.QA | Full live client-session lap on production at 375 and dark, every nav item, file download, invoice pay, thread round trip (overlaps CT.10 and A5) | [ ] | Liam (action) | M | e2e and QA | yes | yes | 1040 |

## K. Tier 3, Sales artifacts, and ops steps

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| T3.1 | Publish-before-share for proposals and schedules (merged as C1); live lap owed | [~] | nothing | XS | contracts | yes | yes | 1050 |
| T3.2 | Proposal Publish button re-arms after edits (C1); live lap owed | [~] | nothing | XS | contracts | yes | yes | 1053 |
| T3.3 | Accept and sign loop notifies the studio (C3, C4); live lap owed | [~] | Liam (action): real inbox | XS | contracts | yes | yes | 1056 |
| T3.4 | Deliverable kit theme integrity (C2); minor flash left | [~] | nothing | XS | contracts | yes | yes | 1060 |
| T3.5 | Mobile money path: tab strip and gantt done (C2); contract canvas rotation is T3.10 | [~] | T3.10 | XS | contracts | yes | partly | 1066 |
| T3.6 | Signed PDF stored in R2 plus download plus resend (C4, migration 0099); live lap owed | [~] | Liam (action): real inbox | XS | contracts | yes | yes | 1070 |
| T3.7 | Contract tamper anchor, body PATCH blocked after draft (C4); live lap owed | [~] | nothing | XS | contracts | yes | yes | 1074 |
| T3.8 | Deals honesty. 2f81243f refuses scheduled nudges, replaces the auto-nudge toggle with an honest note and shows held recipients; remaining: verify live, dialog error surfacing, decide whether to build a nudge engine | [ ] | nothing; Liam (decision) for a real engine | S | other | no | partly | 1077 |
| T3.9 | Small-fix batch. Already shipped: alert() to toast and OG tags (C2), accept against snapshot (C3), expiry enforcement (2f81243f). Needs a clause-by-clause audit of the rest (EmailShareModal preselect, founders image, tab titles, /pipeline hrefs, ContractsTab data shape, save-as-template 400, search reads contract_documents) and retiring the dead emails/contract-signature.tsx | [ ] | nothing | S | contracts | yes | partly | 1080 |
| T3.10 | /p/contract viewer onto the deliverable kit plus a rotation-safe signature pad | [ ] | nothing (C2 and C4 merged) | M | contracts | yes | no | 1088 |
| T3.QA | Playwright plus one live round trip with a personal email before the first real client send (overlaps D3) | [ ] | Liam (action): approved test inboxes | S | e2e and QA | yes | yes | 1093 |
| T0.2 | Fire sync-airwallex and compare get_bank_balances with the Airwallex UI. Airwallex sync already ran successfully on 9 October with two yield rows; the UI comparison remains | [ ] | nothing | XS | crons and ops | no | yes | 1103 |
| T0.3 | Refresh finance.yieldHoldings against the Airwallex UI (figures in the text are stale: LW.42 says USD 25,100 vs 20,014 on 2026-09-22) | [ ] | Liam (action) | XS | billing | no | no | 1106 |
| T0.4 | Verify migration apply state on production D1 (0081/0082 onward) and 0098 on staging. GET /api/admin/db/migrate lists the catalogue, not the applied ledger; read the real schema. 0111 is verified applied | [ ] | nothing (Cloudflare access restored 2026-10-11) | S | crons and ops | no | yes | 1109 |
| MC.10b | Physitrack carries two Stripe customers after the Evan Kwan merges; do not merge real billing identities without Liam | [ ] | Liam (decision) | XS | billing | no | no | 1112 |

## L. Carry-overs (T5xx to T7xx pool)

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| T568 | Google Calendar booking links for scheduled calls (likely close; recheck against LW.6 and LW.8) | [ ] | LW.8 (Liam action) | XS | portal | yes | yes | 1133 |
| T570 | Zapier outgoing webhooks: engine shipped, needs a config surface (catalogue J3) | [ ] | nothing (parked behind Batch J) | M | crons and ops | no | no | 1136 |
| T594b | Verify migration 0012 applied on production (do with T0.4) | [ ] | T0.4 | XS | crons and ops | no | yes | 1139 |
| T600 | Cash flow runway indicator (largely shipped; verify then close) | [ ] | nothing | XS | billing | no | yes | 1140 |
| T618 | Worker MCP finance tools coverage | [ ] | nothing | XS | other | no | yes | 1141 |
| T667 | Xero category overrides (needs S25 schema batch) | [ ] | S25 (schema batch, prose only) | M | billing | no | no | 1142 |
| T716 | Email-to-Request intake: verify whether wired, then finish or park (treated as NOT wired; email copy softened in 42b331c3) | [ ] | Liam (decision) finish or park | S | portal | yes | yes | 1143 |
| W-QA | Live smoke of Wave 1 to 4 (automation fire, webhook delivery, announcement fan-out, portal Org/Brand/People, AI weaves) | [ ] | nothing for the studio side; email goes only to allowlisted addresses | M | e2e and QA | yes | yes | 1147 |
| LIT-BOOKS.UIUX / LIT-BOOKS.QA | Overview BOOKS cards review plus live smoke (one line, two ids) | [ ] | nothing | S | e2e and QA | no | yes | 1149 |

## M. Ideas pool 2026-10-09 (each needs a scope before building)

| ID | What | St | Blocked by | Size | Area | Client | Verify only | Line |
|-|-|-|-|-|-|-|-|-|
| WQA.0 | Website QA comments pinned to client sites with suggested copy edits; spec in SPECS/website-qa-comments.md. No delivery mechanism, guest policy or schema chosen | [ ] | Liam (decision) | M | other | yes | no | 1193 |
| REC.0 | Calendar-aware meeting audio capture and transcription (Windows, Meet/Teams/Zoom); spike on accuracy and cost, spec in SPECS/meeting-audio-capture.md. No provider chosen | [ ] | Liam (decision) provider and retention | L | other | no | no | 1202 |
| LP.1 | Scope changes caught on a call become change-request suggestions | [ ] | Liam (decision) to schedule | M | Slack and suggestions | no | no | 1214 |
| LP.2 | Ask the dashboard: question box over calls, requests, projects with source links | [ ] | Liam (decision) to schedule | L | other | no | no | 1217 |
| LP.3 | Suggest the client for an unlinked call note | [ ] | nothing (triage calls it a best smaller slice) | S | Slack and suggestions | no | no | 1219 |
| LP.4 | Pre-call brief for client calls (past calls, open requests, hand-offs); enrich existing pre-call digest | [ ] | nothing (triage calls it a best smaller slice) | S | other | no | no | 1221 |
| LP.5 | "Client owes us" checklist per project, visible in the portal | [ ] | Liam (decision) | M | portal | yes | no | 1223 |
| LP.6 | Weekly timesheet grid and PDF time report; overlaps the ops/time port, avoid a second timesheet | [ ] | Liam (decision) | M | other | no | no | 1225 |
| LP.7 | Income goal bar (paid, invoiced, unbilled, pipeline, gap to take-home) | [ ] | Liam (decision) | S | billing | no | no | 1226 |
| LP.8 | Share links for notes, transcripts, audio, files with share view analytics | [ ] | Liam (decision) | M | other | yes | no | 1228 |
| LP.9 | Client-scoped MCP on the Loopsii model; overlaps GI.2 | [ ] | GI.2 | L | permissions | yes | no | 1230 |
| LP.10 | Plain-words capacity line on the capacity card | [ ] | nothing | XS | other | no | no | 1233 |
| LP.11 | Chapters on call transcripts written by the summariser | [ ] | Liam (decision) to schedule | M | Slack and suggestions | no | no | 1235 |
| LP.12 | Per-meeting audio controls once REC.0 lands | [ ] | REC.0 | L | other | no | no | 1236 |

## Totals

| Measure | Count |
|-|-|
| Open items in the table (one row per checkbox line) | 158 |
| Status [ ] | 76 |
| Status [~] | 82 |
| Verify only (yes) | 85 |
| Partly built, partly real work (partly) | 16 |
| Blocked first on Liam (decision or action is the primary blocker) | 60 |
| Liam involved anywhere in the blocker column | 76 |
| Client-facing yes | 68 |
| Size XS / S / M / L | 79 / 35 / 31 / 13 |

By area: portal 35, other 34, billing 18, contracts 17, e2e and QA 11, permissions 11, Slack and suggestions 10, design ports 7, PM AI 7, crons and ops 6, content and blog 2.

The 158 rows are all 159 checkbox lines in TASKS.md except T571 (see appendix). Rows were machine-checked against TASKS.md: every row points at a checkbox line that contains its id and carries the same status.

## Contradictions

Open items whose text is contradicted, fully or partly, by STATUS.md, the Codex triage or a later commit. "Fix the text" means TASKS.md or STATUS.md should be updated, not that code is wrong.

| ID | What the text says | What contradicts it |
|-|-|-|
| CT.15 (line 942) | `[ ]`: Send button sends nothing, Copy review link 404s | 2f81243f (deployed 511c7d5f) replaced Send with "Mark as asked" and the copied link is now /review/<token>, which matches app/review/[token]. Open only for the orphaned outreach routes and live verification |
| T3.8 (line 1077) | `[ ]`: deals still have fake scheduled and auto nudges | 2f81243f: the nudges route returns 409 for scheduledAt, the deal sidebar says automatic follow-ups are not available, held recipients are shown. STATUS.md "Stubs / not functional" still lists the auto-nudge engine as a stub with C1.8 "removes or builds"; that is now removed |
| CT.17 (line 952) | `[ ]` | Its own text says the MCP schema and mapping were repaired in 2f81243f with tool-to-route tests passing; only the signed-in round trip is open. Checkbox understates it |
| IC.9 (line 982) | `[ ]`: /time controls 37px, 30px, 18px, 19px | 2f81243f and TASKS.md execution update: time search and filter controls measure at least 44px at 375 dark; the signed-in check of time on production was done (bc7412e9). The triage also folded IC.9 into FU.5/FU.6 |
| T3.9 (line 1080) | `[ ]`: alert() to toast, accept against snapshot, expiresAt enforcement open | C2 shipped OG tags and alert() removal, C3 froze accepted amounts, 2f81243f enforced expiry for the studio email path (the item's own note already admits OG and alert()) |
| SW.1 (line 164) | `[ ]` | Lingorama's invoice was recovered and mapped through the app on 2026-10-11 and a post-deploy preview still matches. Only broader historical reconciliation and the zero-import explanation remain. STATUS.md "Known live bugs" matches this; the checkbox is the stale part |
| CB4 / MR.6 (lines 601, 589) | `[ ]` / `[~]` | The invoice list port is deployed and live-checked (120 rows, CSV, 375/768/1280 dark). Detail and the rest of finance.md remain. TASKS.md already says "partial", but the checkbox implies nothing shipped |
| DL.3 (line 554) | `[x]` done | The same entry says "UNRESOLVED: two documents disagree", the reorganisation notes say "DL.3 stays [~]", Batch G says "DL.3 unresolved ahead of G5", and DL.4 is "gated on DL.3". The checkbox and the body disagree. Resolve by listing the design project files |
| HO.1 (line 422) | Describes a nudge email after three days as part of what is live | STATUS.md "Known live bugs" item 4 and the triage: delivery-watch and automation-sweep are not in the cron schedule, so the nudge has never run |
| CT.11 (line 929) | Known gap: global admin search returns private service names to scoped team members | Global search scoping shipped in 2f81243f (admin-search-permissions tests), deployed |
| T1.6 / T1.16 (lines 827, 889) | Fine as written (`[~]`), but STATUS.md "Known live bugs" still has older wording | STATUS.md "Verification before adding a scoped teammate (T1.16)" is the current statement; consistent with TASKS.md. No action beyond the live lap |
| FU.1 (line 239) vs STATUS.md | STATUS.md "Known live bugs" item 3 (P2 - FU.1) says a hanging read can still pass the 120 s cut | 2f81243f caps each read; that STATUS item is stale |
| FU.2, FU.5, FU.6 (lines 245, 259, 267) | "signed-in live evidence is pending" | bc7412e9 says signed-in production checks covered contracts and time; contract cards at 375 light/dark and 768 dark and the populated 1280 table were checked (TASKS.md 2026-10-11 update, locally for the first gate). Likely closable on a short recorded live pass; the signing email preview is the real gap |
| FU.9 (line 283) | `[ ]` | Local QA snapshot repaired in 2f81243f (eight cascade edges proved in rollback fixtures); only the browser cleanup proof remains |
| CN.3 (line 378) vs STATUS.md "Since the last update (2026-09-21 to 2026-09-26)" | Older STATUS section says CN.3 is NOT deployed and migration 0111 must be applied first | Superseded by the 2026-10-11 section: 0111 applied, deployed at 511c7d5f. Fix the text; the TASKS.md entry is correct |
| LW.9 (line 325) | `[~]` live check owed | STATUS.md 2026-10-11: Giant Group home in the read-only lens keeps the onboarding checklist hidden (375 light/dark, 768 dark). Partial live evidence exists |
| LW.27 (line 453) | `[~]` live check owed | Same STATUS.md client home passes at 375 and 768 including the empty header state; partial live evidence |
| HA.1 to HA.9 (lines 408 to 416) | `[~]` | STATUS.md "Since the last update (2026-09-13 to 2026-09-20)" says all nine were traced to their routes and "fixed and verified live". `[x]` is likely justified apart from HA.3, whose label text now should read against September |
| T0.2 (line 1103) | `[ ]` "after deploy lands: fire sync-airwallex" | Triage: the Airwallex sync succeeded on 9 October with two yield rows. The UI comparison is the only open piece |
| T0.3 (line 1106) and LW.42 (line 429) | T0.3 cites Xero Yield USD 33,956.89 vs the setting 20,014.13 | LW.42 (2026-09-22) puts the setting at USD 20,014 against 25,100 in Airwallex and says it was updated by hand; the T0.3 figures are stale and the two items duplicate each other |
| T0.4 (line 1109) | 0098 on staging refused the wrangler token | Cloudflare access was restored on 2026-10-11 and 0111 was applied through wrangler; the staging apply can now be retried |
| T3.5 (line 1066) | Contract canvas rotation is "catalogue D1, still open" | D1 is the same work as T3.10 (line 1088); one open item, two names |
| TP.4 (line 1008) | Notifications history page not built | AR.1 and PP.4 shipped /notifications for both audiences; the item itself says re-scope first. Probably closable on Liam's look |
| STATUS.md (Triage snapshot section) | Proposals "accepting a proposal notifies NOBODY", contracts "signed PDF is never stored", portal blockers B1 to B5 | All closed by C3/C4 and the 2026-09-05 Tier 1 cutover (the section itself says B3 to B5 shipped). Heading dated 2026-08-18; stale, not a TASKS.md item |

## Appendix: skipped ids and why

Checkbox lines in TASKS.md that were left out of the table, and non-checkbox open work that has no checkbox.

Skipped checkbox items:

| ID | Line | Reason |
|-|-|-|
| T571 | 1138 | Marked "fold into T711 to T713", which only exist as a parked prose group (Intelligence and analytics), so it is merged elsewhere rather than a standalone open task |

Not counted because they are `[x]` (done) in TASKS.md, even though several are referenced above: SW.0, FU.7, FU.10, MC.4, the pay-rise decision, CN.0, CN.0b, CN.1, CN.1b, CN.1d, HA.10, LW.20, LW.25, LW.30, LW.33, LW.34, LW.35, LW.37 to LW.41, LW.43, LW.44, LW.1, LW.7, DL.1, DL.2, DL.3 (see Contradictions), T0.1, T0.5, MC.0 to MC.3, MC.5, MC.7 to MC.11, CB1 to CB3, CL.3, T2.8, T1.1, T1.2, T1.4, T1.5, T1.8 to T1.10, T1.18, T1.19 calls half, and the rest of section (g) Done.

Not counted because they have no checkbox (prose in TASKS.md, parked until Batch J or later):

- North-star phases N1 to N9 (queued, unchanged).
- Catalogue lines with no id: E1 (New-conversation participant shape), E2 (org_channel provisioning plus polling or SSE), H1 (ops.jsx Time, Team, Tracks port), H3 (sales-artifacts list ports), H4 (/capacity port), H5 (contact and brand detail pages), I4 (wire or delete the client health scorer), I5 (build or delete messageReactions, request steps, revision counter), J2 and J3 groupings. J1 = CL.1, J4 = T1.16, J5 = T1.13, F2 = GI.3, F3 = T1.15, F4 = T1.11, F5 = T1.7, I1 = CT.19, I2 = CT.15, I3 = T3.8 and MC.6 are all aliases of rows above.
- Post-launch groups: notifications overhaul (T682 to T699, W-PUSH, S23), retainer and billing model (T668 to T676), comments and messages polish (T677 to T681, S24), revenue features (T700 to T705), intelligence and analytics (T707 to T715 including T711 to T713), schema batch (S23 to S25), content engine ops residue (verify migrations 0060 to 0063, PI-S1/S2/S5/S6.5 QA, Slice 7 and 8).
- "Not yet" list from the 2026-09-06 sweep (standalone /messages, testimonial pipeline, automated health scoring, Slack digests, request steps and checklists, ratings and NPS, per-request activity log).
- Lower-priority triage notes with no id: transcript chapters (LP.11 is the id), capacity prose (LP.10), notification refinements.
- Older STATUS.md "Stubs / not functional" bullets with no id: Web Push (no service worker handler), Email-to-Request intake (T716) and scheduled deal nudges (T3.8).

Notes on groupings the triage prefers (one pass instead of many): the client home, request and account lap covers LW.2 to LW.19, LW.23, LW.27 to LW.29, LW.32, T1.3, T1.14, CT.10, CT.16, T2.9, V1-QA.1, T2.QA and A5; the studio phone and dark pass covers LW.12, LW.31, GI.3, DPM.1, BP.1, FU.5, FU.6; money truth covers HA.1 to HA.9, T0.2, T0.3, LW.42, T600, LIT-BOOKS; the deliverable loop covers CA4, C1 to C4, D3, T3.1 to T3.7, T3.QA; calls and hand-offs cover CN.1c, HO.1 to HO.4, GI.3, T568, LW.6, LW.8.
