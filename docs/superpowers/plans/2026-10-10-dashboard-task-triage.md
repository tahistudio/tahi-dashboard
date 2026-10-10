# Dashboard task triage, 2026-10-10

This is a recommended execution order, not approval of new product scope or
production data changes. TASKS.md keeps each task's canonical checkbox. This
document references those ids and groups work that can share a verification
pass. No feature was implemented during this triage.

## Recommendation

Start with SW.1 billing recovery and the remaining access gaps, then FU.1/FU.7
runtime hardening, contract expiry fixes and the accumulated live QA. After that,
integrate the existing CN.3 branch and port the client surfaces from the written
plans. Scope meeting audio and website QA in parallel with those repairs.

Avoid rebuilding work that is already present. The September catalogue and its
counts are historical; several open descriptions contradict later commits.
Do not use a checkbox count as a readiness percentage.

## Ready to work on, in order

Sizes are rough engineering effort before external waiting and the full live
verification gate: XS is a few hours, S about half to one day, M about one to
three days. These are planning estimates, not a delivery commitment.

| Order | Existing ids | Concrete next action and completion evidence | Size / constraint |
|---|---|---|---|
| 1 | SW.1 | Confirm the live Stripe account/customer pairing, compare existing Lingorama invoices for twins, preview the mapping/import, then recover the paid invoice through the app as Liam. Re-read the invoice/payment in both systems. Also explain why daily Stripe imports report zero new rows. | XS to M investigation. Identity and duplicate checks precede a billing write. No direct D1 edits. |
| 2 | T1.6, T1.16 | Finish a targeted permission audit, starting with global search. Its route checks Tahi org membership and then queries all entities without the organisation scope used elsewhere. Add feature and organisation guards, plus tests for denied and scoped seats. Re-check reports and nested write routes. | M. The basic roleless deny and much of the entity scoping already exist. |
| 3 | FU.1, FU.7 | Cap each Anthropic request and retries by the sweep's remaining budget. Move overview brief helpers/constants out of route.ts into lib/. Test a hung read, deferral without stamping, and the build with generated route types present. | S to M. No new provider or schema needed. |
| 4 | FU.2, FU.4 | Make expired contracts visibly lapsed for the studio, refuse emailing expired links through API/MCP, put the signing deadline in the email, and align displayed expiry dates with the date selected by the studio. | M. Reuse existing UI. Preview changed email to Liam. FU.3 stays a separate decision. |
| 5 | FU.5, FU.6, IC.9 | Fix the remaining dark colours, clipped desktop Wire, contract table overflow and small time controls. Check 375, 768 and desktop in both themes. Keep this to repairs using existing components. | S to M. Fold IC.9 into the ops port if that begins first. |
| 6 | V1-QA.2, FU.9 | Correct e2e expectations that still require a client Messages tab. Repair the local QA snapshot's missing foreign-key cascades and prove fixture cleanup with the existing deliverable specs. | S. Local data only. Protect the QA snapshot rather than replacing it blindly. |
| 7 | CT.15, T3.8, T3.9 | Correct the broken review URL and remove or disable controls that claim outreach/nudges are sent without an engine. Audit T3.9 clause by clause because OG tags, alert removal and snapshot acceptance already shipped. | M. Removing misleading affordances is ready; a new automatic outreach policy is not settled. |
| 8 | CT.17 | Verify the existing messaging adapters rather than rebuild them. Fix create_invoice's MCP schema: it still requires amountUsd/totalUsd and exposes no lineItems, while the API requires non-empty lineItems. Test the real tool-to-route contract. | S. Invoice creation testing uses QA data, not a real client invoice. |
| 9 | CN.3, GI.4 learning | Review/integrate cn3-ready against current main, apply reviewed migration 0111 before deployment, run the impacted/full gates, then verify rejection learning and the weekly digest/thread sync. | M integration. Already built, not a fresh three-day implementation. Slack proof depends on CN.2 setup. |
| 10 | CB4, MR.6, AR.5 | Port the studio invoice list/detail from finance.md, preserving rails, pay links, fields and correct totals. Prefer this bounded surface over changing all four finance routes at once. | M to L. No migration in the written finance plan. Full plan includes more than this slice. |
| 11 | LW/CT portal work, AR.5 | Port portal-home honesty/error states and queue fixes, then requests/detail, files and account surfaces. Use the nineteen per-module plans and existing primitives. Preserve member-seat billing restrictions and the disabled onboarding checklist. | M per bounded slice. Additive fields are reviewed separately where a plan names them. |
| 12 | T2.7 | Unify the home daily brief and nav briefing's source/refresh cycle, after FU.7. Verify both show the same underlying facts and distinguish unavailable data from empty data. | M. Keep changes separate from the access/navigation batch. |

## Already built: spend verification effort before build effort

| Verification group | Existing ids covered or partially covered | What the next pass must prove |
|---|---|---|
| Client home, request and account lap | LW.2 to LW.19 as applicable, LW.23, LW.27 to LW.29, LW.32, T1.3, T1.14, CT.10, CT.16, T2.9, V1-QA.1, T2.QA, A5 | Client and member views at 375 and dark; correct lead, hidden onboarding pieces, request thread identity, approval/change request, files, invoice pay link, account permissions. Read-only preview proves rendering; invites, sign-in and round trips require a controlled real client session. Share one checklist rather than repeat the lap per id. |
| Studio phone and dark pass | LW.12, LW.31, LW.40, GI.3, DPM.1, BP.1, FU.5/FU.6 repairs | Brief targets, Wire, calls slide-over, client cards, contract menus/mobile cards, marked-signed truth and settings defaults. Existing commits are evidence of implementation, not a substitute for these live observations. |
| Money truth | HA.1 to HA.9, T0.2/T0.3, LW.42, T600, LIT-BOOKS.UIUX / LIT-BOOKS.QA | Compare card/API bases; Airwallex is cash truth. Successful sync does not prove the manually maintained yield setting is current. Do not use Xero's bank ledger as cash authority. |
| Deliverable loop | CA4, C1 to C4, D3, T3.1 to T3.7, T3.QA | Existing local Playwright specs are built. One controlled live proposal accept and contract sign must reach studio notifications and stored PDF, with real approved test inboxes. No real client contract signed as a test. |
| Calls and hand-offs | CN.1c, HO.1 to HO.4, GI.3, T568, LW.6/LW.8 | Scheduled sweeps drain eligible transcripts without dropping suggestions; call link/type editing, waiting-on fields and hand-back work. Calendar read sync is live; calendar write permission is a separate check. The automatic hand-off nudge is not scheduled. |

Do not mark these done from this triage. Keep the existing checkboxes until the
relevant live observation and commit are recorded. A5 includes proof that Liam
or Staci must supply; agent preview cannot replace a real second-seat sign-in.

## Work with a specific dependency

| Work | Dependency and what can proceed now |
|---|---|
| CN.2 Slack and FU.8 | Existing app manifest, reinstall and SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET. Current user permission to apply the Stripe secret was specific to Stripe. Review event deduplication locally now; verify one voice note produces one card after Slack is connected. |
| PM.0 to PM.5 | PM.0 has nine unresolved product choices. A read-only scope review can proceed; building the PM or scheduling client nudges needs those choices. All proposed item writes remain behind the human gate. |
| HO.1 automatic nudge and automation-sweep | Neither target is in the live cron schedule. Scheduling delivery-watch would send to allowlisted clients. Resolve manual versus automatic reminders before enabling it. |
| LW.8 / LW.8b | Google reconnect granting calendar writes, then one controlled kickoff booking. A healthy calendar read sync does not prove calendar.events is granted. |
| FU.3 | Decide whether partial real signatures block manual marking or whether a real countersign flow is required. Recommendation: block the manual shortcut when signatures exist. No product decision taken here. |
| IC.8 | Review stamp-invoiced dry run and cutoff before applying historical stamps or exporting old billable time. The guard is built. |
| LW.36b, MC.10b | Liam's dummy invoice void/delete and Physitrack customer judgment. Do not delete or merge real billing identities during triage. |
| LW.45 | Webflow template change/publish for JSON-LD needs Liam's go. Dashboard-only change to report a content finding instead of a transport failure can be isolated now. |
| T1.12 | Literal removed from source in 17799931, but no evidence the exposed historical token was revoked. Keep actual rotation/revocation open. |
| T1.7 | Inspect existing noindex/robots/limiting before implementation; deployment/WAF settings require an environment check. |
| T0.4, T594b | Read production schema and compare required columns/indexes with migrations. GET /api/admin/db/migrate lists the available catalogue, not an applied-migration ledger. Do not infer apply state from that response. |

## Product bets after the repair pass

| Work | Useful next deliverable |
|---|---|
| REC.0, LP.12 | A Windows audio feasibility spike: calendar detection, system audio plus mic across Meet/Teams/Zoom, representative-call transcription comparison and ongoing cost. Transcript is primary. No video, screen recording or Loom replacement. Reuse call_transcripts and the suggestion gate. Native PC capture is a separate technical component from the web dashboard. Provider, automation and retention remain unselected. |
| WQA.0 | A short spec for comments pinned to client websites, suggested copy edits, review/resolution and conversion to a request. Reuse lessons from BP.1; the dashboard comment ball is not yet a client-site QA product. Include site identity, access, pin stability and third-party embedding constraints. |
| LP.3, LP.4, LP.1 | Best smaller intelligence slices: suggest a client for unlinked transcripts, enrich the existing pre-call digest with client context, and flag scope changes as proposals. Keep approvals and duplicate guards. |
| GI.5 | Document-to-request intake is a bounded feature once file extraction limits and scanned-PDF fallback are specified. Use the existing request approval/create flow. |
| CL.1, TP.3 | Files with folders/threads and multi-day planning are valuable but need data model scope. The port alone does not authorise inventing new schema or features. |
| GI.1, GI.2, LP.9 | Extend the deployed Slack intake later; WhatsApp and client-scoped MCP need identity/permission work. LP.9 overlaps GI.2 and must not become a second MCP architecture. |

Lower priority: income goals, transcript chapters, share links for audio/notes,
capacity prose, notification refinements, SVG blog images and the longer
analytics/content/affiliate roadmap. LP.6 overlaps the ops/time plan; avoid
building a second timesheet. CT.19 reports consolidation and CT.18 tracks
deletion need scope choices, rather than blanket deletion of current surfaces.

## Evidence checked during this triage

- main 6f47476c at the start. Read CLAUDE.md, current STATUS/TASKS, recent
  decisions/run log, QA guidance and the relevant port plans/source routes.
- Production SELECTs only, no data writes. Latest observed calendar sync on
  10 October fetched 27 events and matched 20; Drive transcript import and
  suggestion sweep succeeded. The observed sweep had zero eligible calls,
  which does not exercise FU.1's hanging-read case.
- Latest Airwallex sync succeeded on 9 October with two yield rows. Latest
  Stripe sync reported zero invoice imports despite SW.1's missing invoice.
- The 4 October schema-watchdog run still reports 0 of 50 passing with
  schema_not_in_html. This is the existing LW.45 finding.
- MCP consent hardening is in 17799931; roleless deny in 7e58adeb and
  c3db922e; entity scoping is visible on deals, conversations, calls, time and
  announcements. Global search still lacks those guards. This is a source
  finding, not a demonstrated attack using somebody else's account.
- Message API accepts body as an alias for content, and conversations accept
  the MCP participant shape. CT.17's claim that both always fail is stale.
  create_invoice's exposed schema still does not match the API's lineItems.
- cn3-ready contains d1103abe and 0111_cn3_sync.sql. It is 23 commits ahead
  and 8 behind main, with 72 changed files against the merge base. Production
  task_suggestions has no reject_reason column. Integration and migration are
  required; do not describe CN.3 as live or as unimplemented.
- All nineteen port plans exist. Liam's 26 September instruction permits
  porting them using current patterns without advance review, labelled
  "ported, unchecked" until he reviews. The review document keeps its boxes
  empty. This exception does not settle new product/schema questions.

TASKS.md was corrected for the stale blockers and implementation descriptions.
No new feature or security repair is marked complete by this document.
