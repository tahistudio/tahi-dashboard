# T1.6 admin route access audit, 2026-10-14

Batch D on chore/next20-n20d, baseline main 749b56b4. The first git status was clean. The original audit and repairs were committed as 67594c29. Both the regression and security reviews FAILED that commit. The follow-up repairs below are committed as 9b3a862b. The security re-review PASSED. The final Low repairs in this audit started with a clean worktree at a0273a34 and remain uncommitted. No migration, push, deployment, production data operation, TASKS.md edit or STATUS.md edit was performed.

## Review repairs after FAILED 67594c29

Started clean at 67594c29 on chore/next20-n20d; follow-up repairs committed as 9b3a862b. No push, deploy, migration, production-data write, TASKS.md or STATUS.md edit in that follow-up. Both current seats are super_admin; these repairs prevent scoped-seat access failures and do not claim an exploit today.

| Brief item | Current file:line | Change |
| --- | --- | --- |
| 1 | [lib/cron-runs.ts:118](../../../lib/cron-runs.ts#L118), [lib/cron-admin-access.ts:7](../../../lib/cron-admin-access.ts#L7) | Removed admin from shared cron auth. Manual workspace jobs alone retain admin checks. Scheduler secrets, transcript sweep guards and scoped counts-only digest behavior remain. |
| 2 | [lib/messages-store.ts:289](../../../lib/messages-store.ts#L289), [lib/messages-store.ts:494](../../../lib/messages-store.ts#L494) | Removed new client-audience message-row organisation filters; studio scoping remains. |
| 3 | [app/api/admin/requests/[id]/participants/route.ts:83](../../../app/api/admin/requests/[id]/participants/route.ts#L83), [app/api/admin/requests/[id]/route.ts:103](../../../app/api/admin/requests/[id]/route.ts#L103), [app/api/admin/requests/[id]/reads/route.ts:117](../../../app/api/admin/requests/[id]/reads/route.ts#L117), [lib/request-handoff.ts:116](../../../lib/request-handoff.ts#L116), [app/api/admin/requests/bulk-assign/route.ts:134](../../../app/api/admin/requests/bulk-assign/route.ts#L134) | Existing attached contact names, read receipts and handoff pointers remain visible. New foreign contacts remain rejected. Missing bulk contacts skip only that item with a reason. |
| 4 | [app/api/admin/conversations/_access.ts:71](../../../app/api/admin/conversations/_access.ts#L71) | Orphaned request parents skip the request check. Existing org fences remain, and unrestricted scope passes. |
| 5 | [app/api/admin/leads/triage-pipeline/route.ts:254](../../../app/api/admin/leads/triage-pipeline/route.ts#L254) | Fixed both visible triage messages, affected route/helper comments and brief labels with full stops or parentheses. No malformed comma spacing remains in app/api/admin or lib. |
| 6 | [lib/internal-route-access.ts:21](../../../lib/internal-route-access.ts#L21), [lib/require-feature.ts:60](../../../lib/require-feature.ts#L60), [lib/require-admin.ts:9](../../../lib/require-admin.ts#L9) | Studio feature and admin checks share one access object. Time, clients, retainer reports, permission mutations and artifact deal scope reuse resolved access. Intentional boundary rechecks are noted below. |
| 7 | [app/api/admin/webhooks/route.ts:24](../../../app/api/admin/webhooks/route.ts#L24) | H1: named integration/configuration handlers require settings.integrations and studio admin. Webhook secrets appear only at creation, never GET/PATCH. Airwallex debug deleted. Every handler anchor follows this table. |
| 8 | [app/api/admin/onboarding-invites/route.ts:72](../../../app/api/admin/onboarding-invites/route.ts#L72), [app/api/admin/onboarding-invites/route.ts:83](../../../app/api/admin/onboarding-invites/route.ts#L83) | H2: POST requires admin; GET explicitly projects safe fields without token/link. |
| 9 | [lib/meeting-recordings-server.ts:116](../../../lib/meeting-recordings-server.ts#L116), [lib/meeting-recordings-server.ts:373](../../../lib/meeting-recordings-server.ts#L373), [app/api/admin/call-transcripts/[id]/route.ts:97](../../../app/api/admin/call-transcripts/[id]/route.ts#L97), [app/api/admin/call-transcripts/[id]/route.ts:122](../../../app/api/admin/call-transcripts/[id]/route.ts#L122) | M1: discovery recordings check every parent, including reads, creation, linking and leases. List EXISTS scope precedes LIMIT. Recorder transcript GET/PATCH no longer bypass guardTranscript. |
| 10 | [app/api/admin/deals/[id]/convert-to-client/route.ts:117](../../../app/api/admin/deals/[id]/convert-to-client/route.ts#L117), [app/api/admin/deals/[id]/convert-to-client/route.ts:142](../../../app/api/admin/deals/[id]/convert-to-client/route.ts#L142) | M2: contact-org relink checks actual org access before mutation; create-new-org requires admin. |
| 11 | [app/api/admin/leads/[id]/route.ts:85](../../../app/api/admin/leads/[id]/route.ts#L85) | M3: lead detail uses the authenticated parent-call list, matching its calls sibling. |
| 12 | [lib/overview-brief.ts:163](../../../lib/overview-brief.ts#L163), [lib/overview-brief.ts:339](../../../lib/overview-brief.ts#L339) | M4: discovery calls apply parent fences and denyAll; overnight replies fence both stored message org and request parent. |
| 13 | [app/api/admin/_sales-access/artifact-scope.ts:168](../../../app/api/admin/_sales-access/artifact-scope.ts#L168) | M5: restricted artifacts check deal access and matching org parents. Earned unrestricted admin/service behavior remains, including legacy mixed links. |
| 14 | [app/api/admin/messages/_shared.ts:57](../../../app/api/admin/messages/_shared.ts#L57), [app/api/admin/conversations/_access.ts:72](../../../app/api/admin/conversations/_access.ts#L72), [app/api/admin/conversations/route.ts:64](../../../app/api/admin/conversations/route.ts#L64), [app/api/admin/conversations/route.ts:320](../../../app/api/admin/conversations/route.ts#L320) | M6: request-source threads and request-linked conversations require requests. Inbox/list SQL, conversation creation and legacy request-linked org channels also enforce it. |
| 15 | [app/api/admin/requests/[id]/files/route.ts:123](../../../app/api/admin/requests/[id]/files/route.ts#L123) | M7: storage-key prefix must equal request.orgId, matching uploads/confirm. Existing keys return 409 before insertion. |
| 16 | [app/api/admin/requests/[id]/messages/route.ts:212](../../../app/api/admin/requests/[id]/messages/route.ts#L212) | M8: accepts the same request thread, or matching org plus conversation access. Private direct/group conversations with neither are refused. |
| 17 | [app/api/admin/time/route.ts:179](../../../app/api/admin/time/route.ts#L179), [app/api/admin/time-entries/route.ts:233](../../../app/api/admin/time-entries/route.ts#L233), [app/api/admin/requests/[id]/time-entries/route.ts:59](../../../app/api/admin/requests/[id]/time-entries/route.ts#L59) | M9: derive request org and reject mismatches. Non-admin logger is the authenticated member, ignoring supplied member, attributed actor and hourly rate. Request time GET/POST require requests and time. Privileged body and actor behavior remains. |
| 18 | [app/api/admin/pipeline/stages/route.ts:150](../../../app/api/admin/pipeline/stages/route.ts#L150), [app/api/admin/pipeline/stages/[id]/route.ts:23](../../../app/api/admin/pipeline/stages/[id]/route.ts#L23), [app/api/admin/pipeline/seed/route.ts:22](../../../app/api/admin/pipeline/seed/route.ts#L22) | M10: stage POST/PUT/DELETE and seed POST require studio admin plus deals. |
| 19 | [lib/client-billing-access.ts:11](../../../lib/client-billing-access.ts#L11), [app/api/admin/clients/[id]/route.ts:69](../../../app/api/admin/clients/[id]/route.ts#L69), [app/api/admin/clients/[id]/route.ts:313](../../../app/api/admin/clients/[id]/route.ts#L313), [app/api/admin/reports/retainer-health/route.ts:223](../../../app/api/admin/reports/retainer-health/route.ts#L223), [app/api/admin/reports/retainer-alerts/route.ts:188](../../../app/api/admin/reports/retainer-alerts/route.ts#L188) | M11: clients list/detail and subscription projection redact billing/processor/internal fields without clients.billing_card; PATCH refuses protected writes and GET skips billing auto-derivation without that feature. Retainer responses omit mrrNzd without financial_reports. |
| 20 | [app/api/admin/email-suppressions/route.ts:42](../../../app/api/admin/email-suppressions/route.ts#L42) | M12: email suppressions GET requires admin. |
| 21 | [lib/super-admin-safety.ts:28](../../../lib/super-admin-safety.ts#L28), [lib/super-admin-safety.ts:57](../../../lib/super-admin-safety.ts#L57), [app/api/admin/permissions/assign-role/route.ts:54](../../../app/api/admin/permissions/assign-role/route.ts#L54), [app/api/admin/permissions/copy-access/route.ts:87](../../../app/api/admin/permissions/copy-access/route.ts#L87), [app/api/admin/team/[id]/route.ts:73](../../../app/api/admin/team/[id]/route.ts#L73) | M13: super-only owner grants, privileged copies, login/legacy-role edits and owner deletion. Protect last role and last usable login. Serialise mutations, refresh authority after lock, atomically batch replacements and test rollback. |
| 22 | [app/api/__tests__/admin-route-guard-walk.test.ts:1044](../../../app/api/__tests__/admin-route-guard-walk.test.ts#L1044), [lib/sitemap-auth.ts:40](../../../lib/sitemap-auth.ts#L40), [lib/require-permission.ts:18](../../../lib/require-permission.ts#L18) | Require real studio identity or verified alternate credentials, reject allow-by-default-only gates and prove getRequestAuth provenance. Permission management and sitemap API helpers now check studio identity. Exact mixed-source and alternate-identity proofs inspect their real guard bodies. |
| 23 | [app/api/__tests__/privileged-route-access-sqlite.test.ts:56](../../../app/api/__tests__/privileged-route-access-sqlite.test.ts#L56), [app/api/__tests__/sales-review-sqlite.test.ts:94](../../../app/api/__tests__/sales-review-sqlite.test.ts#L94), [app/api/__tests__/nested-client-scope-sqlite.test.ts:124](../../../app/api/__tests__/nested-client-scope-sqlite.test.ts#L124) | Real viewer view grants and project_manager fixtures cover every named privileged handler and foreign conversion/relink/artifact parent scenarios. Admin/super_admin/api-service controls preserve permitted operations; service remains admin, not super_admin. |
| 24 | [lib/recorder-devices.ts:43](../../../lib/recorder-devices.ts#L43), [app/api/admin/forms/resolve/route.ts:21](../../../app/api/admin/forms/resolve/route.ts#L21), [app/api/admin/deals/[id]/route.ts:528](../../../app/api/admin/deals/[id]/route.ts#L528) | Only requested Low fixes: authenticated device owner with explicit verified-service branch; requests-gated intake; parameterised deal stage-dwell SQL. |

### H1 handler anchors

- GET [app/api/admin/webhooks/route.ts:29](../../../app/api/admin/webhooks/route.ts#L29); POST [app/api/admin/webhooks/route.ts:67](../../../app/api/admin/webhooks/route.ts#L67); PATCH [app/api/admin/webhooks/route.ts:124](../../../app/api/admin/webhooks/route.ts#L124); DELETE [app/api/admin/webhooks/route.ts:196](../../../app/api/admin/webhooks/route.ts#L196)
- GET [app/api/admin/integrations/google/start/route.ts:62](../../../app/api/admin/integrations/google/start/route.ts#L62)
- GET [app/api/admin/integrations/xero/connect/route.ts:24](../../../app/api/admin/integrations/xero/connect/route.ts#L24)
- PUT [app/api/admin/integrations/slack/route.ts:58](../../../app/api/admin/integrations/slack/route.ts#L58); POST [app/api/admin/integrations/slack/route.ts:120](../../../app/api/admin/integrations/slack/route.ts#L120)
- POST [app/api/admin/integrations/stripe/provision/route.ts:35](../../../app/api/admin/integrations/stripe/provision/route.ts#L35); GET [app/api/admin/integrations/stripe/provision/route.ts:121](../../../app/api/admin/integrations/stripe/provision/route.ts#L121)
- POST [app/api/admin/integrations/stripe/setup-plans/route.ts:65](../../../app/api/admin/integrations/stripe/setup-plans/route.ts#L65); GET [app/api/admin/integrations/stripe/setup-plans/route.ts:81](../../../app/api/admin/integrations/stripe/setup-plans/route.ts#L81)
- GET [app/api/admin/integrations/zapier/route.ts:19](../../../app/api/admin/integrations/zapier/route.ts#L19); POST [app/api/admin/integrations/zapier/route.ts:67](../../../app/api/admin/integrations/zapier/route.ts#L67)
- GET [app/api/admin/integrations/mailerlite/route.ts:17](../../../app/api/admin/integrations/mailerlite/route.ts#L17); PUT [app/api/admin/integrations/mailerlite/route.ts:48](../../../app/api/admin/integrations/mailerlite/route.ts#L48); POST [app/api/admin/integrations/mailerlite/route.ts:73](../../../app/api/admin/integrations/mailerlite/route.ts#L73)
- GET [app/api/admin/integrations/rewardful/route.ts:15](../../../app/api/admin/integrations/rewardful/route.ts#L15); POST [app/api/admin/integrations/rewardful/route.ts:44](../../../app/api/admin/integrations/rewardful/route.ts#L44)
- POST [app/api/admin/integrations/buffer/schedule-posts/route.ts:63](../../../app/api/admin/integrations/buffer/schedule-posts/route.ts#L63)
- GET [app/api/admin/integrations/xero/profit-loss/route.ts:10](../../../app/api/admin/integrations/xero/profit-loss/route.ts#L10)
- GET [app/api/admin/integrations/xero/balance-sheet/route.ts:10](../../../app/api/admin/integrations/xero/balance-sheet/route.ts#L10)
- GET [app/api/admin/integrations/xero/bank-summary/route.ts:34](../../../app/api/admin/integrations/xero/bank-summary/route.ts#L34)

Deleted app/api/admin/integrations/airwallex/debug/route.ts (former GET at 67594c29). Webhook PATCH/DELETE also require the same admin gate; GET/PATCH explicitly project fields without the signing secret.

### Performance and compatibility notes

requireStudioAdmin resolves once and shares access with feature/role checks. Time, client and retainer report handlers share resolved feature access; retainer scope receives the same access. Conversation parent checks reuse resolved org scope; artifacts pass prepared scope to the deal guard. The new guards have admin, super_admin and verified api-service controls. API-service never becomes super_admin through recorded attribution.

Owner mutation permission checks intentionally repeat after the shared lock: another worker may revoke the caller while it waits. Recording leases deliberately recheck current parent access. Existing transcript/recording helper boundaries and conversion's independent feature/admin boundary still resolve separately. Modern request messages combine messages/requests in one resolution. Mixed inbox, conversation list and legacy request-linked channels separately check requests because denial selectively hides those rows; lazy checks are cached per handler. These retained reads are documented P3 follow-ups.

The owner lock uses the existing settings table, with an atomic upsert, value-matched release in finally and five-minute expiry for an aborted worker. Replacement roles and legacy synchronisation use D1 batches. The SQLite harness now models batch transaction/rollback and the production settings unique key locally. No migration was added or applied.

### Open review items

H3, the systemic action-level permission model, remains OPEN as a separate planned batch. A viewer's seeded view grants must eventually be distinct from create/edit/delete privileges across the dashboard. This batch blocks the explicitly named privileged operations and parent escapes, without claiming that a scoped viewer can no longer perform every unrelated mutation.

Low findings outside item 24 and the final Low repairs recorded below stay OPEN. Existing MCP audit/copy author attribution in permissions/team writes still records api-service in places; it is documented for that remaining batch. Invoice channel/payment-term action permissions also remain part of H3. Earned unrestricted artifact access and established counts-only cron behavior are deliberate compatibility conventions.

## Final Low repairs after PASSED security re-review

Started clean on chore/next20-n20d at a0273a34. These are the requested Low follow-ups only; the owner permission behavior is retained. No commit, push, deploy, migration, production-data operation, TASKS.md or STATUS.md edit in this pass.

| Item | Current file:line | Change and regression evidence |
| --- | --- | --- |
| L1 | [workers/mcp-server/src/index.ts:846](../../../workers/mcp-server/src/index.ts#L846), :851, :882, :890; [app/api/__tests__/mcp-owner-settings-parity.test.ts:13](../../../app/api/__tests__/mcp-owner-settings-parity.test.ts#L13) | Descriptions explain browser-only super_admin owner grants, demotions, removals, role/login changes and copying from admin sources, with the service-token 403 by design. Clearing roles is deny by default. Description parity tests cover every named tool. Settings descriptions also explain the reserved lock and secret redaction. |
| L2 | [lib/super-admin-safety.ts:39](../../../lib/super-admin-safety.ts#L39), [app/api/admin/settings/route.ts:112](../../../app/api/admin/settings/route.ts#L112), :173; [app/api/admin/team/[id]/route.ts:61](../../../app/api/admin/team/[id]/route.ts#L61); [app/api/__tests__/privileged-route-access-sqlite.test.ts:282](../../../app/api/__tests__/privileged-route-access-sqlite.test.ts#L282) | Invalid JSON, null or missing lock expiry can be reclaimed. Settings GET omits the reserved lock; PATCH and actual MCP update_settings refuse it with 403, including null. Assign-role still succeeds after refusal and recovers pre-existing corrupt locks. Team PUT locks only for actual role/login changes, rereads under lock and omits unchanged access fields so profile edits cannot overwrite concurrent access changes. |
| L3 | [app/api/admin/settings/route.ts:48](../../../app/api/admin/settings/route.ts#L48), [components/tahi/settings/sections/webhooks.tsx:67](../../../components/tahi/settings/sections/webhooks.tsx#L67); [app/api/__tests__/privileged-route-access-sqlite.test.ts:186](../../../app/api/__tests__/privileged-route-access-sqlite.test.ts#L186), :264; [components/tahi/__tests__/webhooks-secret.test.tsx:183](../../../components/tahi/__tests__/webhooks-secret.test.tsx#L183) | Settings and actual MCP get_settings omit webhook_endpoint_* secret fields and return hasSecret metadata; corrupt endpoint values fail closed. The create dialog retains the accepted signing secret once, offers clipboard/manual copy, explains that closing hides it permanently and clears it on close. Duplicate/in-flight submissions, errors and successful creation with unreadable response or failed refresh are covered. |
| L4 | [lib/messages-store.ts:173](../../../lib/messages-store.ts#L173); [app/api/__tests__/route-review-messaging-sqlite.test.ts:138](../../../app/api/__tests__/route-review-messaging-sqlite.test.ts#L138) | Reverted by the main session. Dropping the contact-org filter conflicted with the security test that keeps foreign contact names off allowed messages and inbox previews. Name lookups stay limited to the reader's scope (admins and unrestricted readers see every name). Trade-off accepted: after a contact or client merge, a scoped reader or client sees the moved contact's messages without the author name. The test now asserts that. |
| Copy | [app/api/admin/calculator/draft/route.ts:60](../../../app/api/admin/calculator/draft/route.ts#L60), [app/api/admin/leads/[id]/calls/route.ts:12](../../../app/api/admin/leads/[id]/calls/route.ts#L12); [lib/overview-brief.ts:255](../../../lib/overview-brief.ts#L255), :317, :452; [lib/overview-brief.test.ts:230](../../../lib/overview-brief.test.ts#L230) | Comments use grammatical sentences and commas. Client/title labels use colons, with overdue copy reading "Acme: Title, 3 days overdue". Tests also cover delivered and unsigned-contract labels. No em or en dashes added. |

Final fail-closed gate passed, exit 0: npm run type-check, MCP worker tsc, then the 32 touched/related Vitest files listed below through the existing scripts/run-vitest-sandbox.mjs. The normal Vitest startup was blocked before collection by esbuild spawn EPERM; the existing runner executes the same assertions with worker threads and TypeScript transforms.

| Check | Final Low repair result |
| --- | --- |
| npm run type-check | tsc --noEmit, zero errors, exit 0 |
| MCP worker tsc | node node_modules/typescript/bin/tsc --noEmit -p workers/mcp-server/tsconfig.json, zero errors, exit 0 |
| Sandbox Vitest | Test Files 32 passed (32); Tests 1154 passed (1154); 14.92 seconds; exit 0 |
| Rule scan | Zero added any types, console.log, em or en dashes, including untracked new tests |
| git diff --check | Passed |
| Independent QA | Passed after reviewing actual MCP dispatch, scoped SQLite and dialog keyboard tests |
| Independent UIUX | Source review passed after fixing focus containment when create controls are disabled |
| Protected files and HEAD | TASKS.md and STATUS.md unchanged; HEAD remains a0273a34 |
| Lint and build | Not run locally, blocked on a Wrangler login |

The dialog focuses an enabled input or its own focusable container when controls become disabled. Tab and Shift+Tab stay inside during creation; success focuses the signing secret, and Escape closes only after creation finishes. Eight component tests cover those transitions, copying, failures and once-only reveal/cleanup. QA/UIUX reviewed the final repair without further findings. Their mobile/dark checks were source-only; no live or browser-rendered visual verification is claimed.

Raw combined gate output: .claude/t1-6-review/lows-final-gate.log (gitignored). No commit, push or deployment was performed.

<details>
<summary>Final 32 touched and related Vitest files</summary>

- app/api/__tests__/admin-route-guard-walk.test.ts
- app/api/__tests__/privileged-route-access-sqlite.test.ts
- app/api/__tests__/route-review-messaging-sqlite.test.ts
- app/api/__tests__/admin-settings-default-pm.test.ts
- app/api/__tests__/admin-settings-email-delivery.test.ts
- app/api/__tests__/admin-settings-invoice-channel.test.ts
- app/api/__tests__/admin-settings-studio-pm.test.ts
- app/api/__tests__/permission-write-guards.test.ts
- app/api/__tests__/permissions-copy-access.test.ts
- app/api/__tests__/permissions-route-guards.test.ts
- app/api/__tests__/permissions-matrix.test.ts
- app/api/__tests__/mcp-owner-settings-parity.test.ts
- app/api/__tests__/mcp-tool-profiles.test.ts
- app/api/__tests__/mcp-coerce.test.ts
- app/api/__tests__/mcp-designer-routes.test.ts
- app/api/__tests__/messages-routes.test.ts
- app/api/__tests__/admin-request-message-gates.test.ts
- app/api/__tests__/admin-request-thread.test.ts
- app/api/__tests__/admin-conversation-message-mentions.test.ts
- app/api/__tests__/overview-replies-waiting.test.ts
- app/api/__tests__/t1-6-internal-routes.test.ts
- lib/__tests__/messages-store.test.ts
- lib/__tests__/messages-inbox.test.ts
- lib/__tests__/messages-composer.test.ts
- lib/__tests__/tahi-bot.test.ts
- lib/permissions.test.ts
- lib/__tests__/permissions-contact-overrides.test.ts
- lib/__tests__/require-feature-guards.test.ts
- lib/__tests__/invoice-pay-settings.test.ts
- lib/__tests__/email-allowlist-settings.test.ts
- lib/overview-brief.test.ts
- components/tahi/__tests__/webhooks-secret.test.tsx

</details>

### 9b3a862b follow-up test and gate evidence

The recorded type-check, MCP worker tsc, cron-trigger worker tsc and touched/related sandbox Vitest checks passed. Lint and build were not run locally, blocked on a Wrangler login. No push, deploy or live QA is claimed.

| Check | Final follow-up result |
| --- | --- |
| npm run type-check | tsc --noEmit, zero errors |
| npm run lint | Not run locally, blocked on a Wrangler login |
| npm run build | Not run locally, blocked on a Wrangler login |
| MCP worker tsc | tsc --noEmit -p workers/mcp-server/tsconfig.json, zero errors |
| Cron-trigger worker tsc | tsc --noEmit -p workers/cron-trigger/tsconfig.json, zero errors |
| Sandbox Vitest | Test Files 163 passed (163); Tests 3591 passed (3591), 61.24 seconds |
| Added-code rule scan | Zero any types, console.log, em or en dash additions, including new files |
| git diff --check | Passed |
| Protected files and commit | TASKS.md and STATUS.md unchanged; follow-up repairs committed as 9b3a862b |
| Current handler walk | 418 route files, 592 HTTP exports (one debug GET deleted), all visited |

New files: privileged-route-access-sqlite.test.ts (197 tests), route-review-messaging-sqlite.test.ts (22), sales-review-sqlite.test.ts (17), t1-6-time-billing-sqlite.test.ts (33), lib/__tests__/sitemap-auth.test.ts (4). The guard walker now has 20 tests, including actual auth provenance, lexical shadowing, auth/access mutation, forged prepared permissions, early success exits, consumed OAuth nonce/expiry and OR-tautology scope. Its 22 feature exceptions remain exact; 19 mixed-source and 10 alternate-identity methods have checked AST proofs. A separate reviewer reproduced all six reported false passes and verified their rejection.

Expanded existing tests cover missing bulk contacts, request message feature denials, forged recorder attribution and one-resolution studio guards. Business mocks now explicitly state authorized admin roles. Permission-only test handles permit exactly the resolver opening and throw on business queries. Original contact visibility assertions were corrected per the regression review while independent studio-row fences remain tested. Last-owner tests cover unusable login links, concurrent demotions, contention/expiry, batch failure rollback and caller revocation while waiting for a claim.

The three named cron suites pass with their original assertions: 17 digest, 14 transcript wiring and 25 transcript SQLite tests. Independent owner-safety and guard-walker rechecks passed. Full final test selection and raw local outputs are retained in .claude/t1-6-review/ (gitignored); the selected files are listed below for reproduction.

<details>
<summary>Final 163 touched and related Vitest files</summary>

- app/api/__tests__/admin-audit-prefix.test.ts
- app/api/__tests__/admin-client-invoice-channel.test.ts
- app/api/__tests__/admin-client-lifecycle.test.ts
- app/api/__tests__/admin-client-plan-type.test.ts
- app/api/__tests__/admin-clients-default-pm.test.ts
- app/api/__tests__/admin-clients-invite.test.ts
- app/api/__tests__/admin-clients-plan-default.test.ts
- app/api/__tests__/admin-clients.test.ts
- app/api/__tests__/admin-contacts-manage.test.ts
- app/api/__tests__/admin-conversation-message-mentions.test.ts
- app/api/__tests__/admin-crons-list.test.ts
- app/api/__tests__/admin-deal-convert-plan.test.ts
- app/api/__tests__/admin-email-suppressions.test.ts
- app/api/__tests__/admin-feedback-delete.test.ts
- app/api/__tests__/admin-feedback-get.test.ts
- app/api/__tests__/admin-import-cleanup.test.ts
- app/api/__tests__/admin-import-manyrequests-snapshot-key.test.ts
- app/api/__tests__/admin-import-manyrequests-snapshot.test.ts
- app/api/__tests__/admin-import-manyrequests.test.ts
- app/api/__tests__/admin-invoice-dedupe-manyrequests.test.ts
- app/api/__tests__/admin-invoice-dedupe-stripe.test.ts
- app/api/__tests__/admin-invoice-detail.test.ts
- app/api/__tests__/admin-invoice-numbers.test.ts
- app/api/__tests__/admin-invoice-xero-email-mode.test.ts
- app/api/__tests__/admin-invoice-xero-push.test.ts
- app/api/__tests__/admin-recording-chunks.test.ts
- app/api/__tests__/admin-request-message-gates.test.ts
- app/api/__tests__/admin-request-thread.test.ts
- app/api/__tests__/admin-requests-create-status.test.ts
- app/api/__tests__/admin-requests-scoping.test.ts
- app/api/__tests__/admin-requests.test.ts
- app/api/__tests__/admin-route-guard-walk.test.ts
- app/api/__tests__/admin-scoping-routes.test.ts
- app/api/__tests__/admin-settings-default-pm.test.ts
- app/api/__tests__/admin-settings-email-delivery.test.ts
- app/api/__tests__/admin-settings-invoice-channel.test.ts
- app/api/__tests__/admin-settings-studio-pm.test.ts
- app/api/__tests__/admin-stripe-link-customer.test.ts
- app/api/__tests__/admin-stripe-recover-invoice.test.ts
- app/api/__tests__/admin-subscription-delete.test.ts
- app/api/__tests__/admin-time-entries.test.ts
- app/api/__tests__/admin-time-entry-owner.test.ts
- app/api/__tests__/admin-time-rate.test.ts
- app/api/__tests__/admin-timers.test.ts
- app/api/__tests__/admin-welcome-invite.test.ts
- app/api/__tests__/ai-predict-fields.test.ts
- app/api/__tests__/ai-request-wizard-routes.test.ts
- app/api/__tests__/airwallex-sync-yield-marker.test.ts
- app/api/__tests__/billing-hourly-export.test.ts
- app/api/__tests__/billing-invoice-flow.test.ts
- app/api/__tests__/bulk-assign-assignee.test.ts
- app/api/__tests__/clerk-invite-allowlist.test.ts
- app/api/__tests__/contract-body-lock.test.ts
- app/api/__tests__/contract-expiry-admin.test.ts
- app/api/__tests__/contract-marked-signed.test.ts
- app/api/__tests__/contract-revoke-reset.test.ts
- app/api/__tests__/contract-signed-pdf-routes.test.ts
- app/api/__tests__/cron-suggest-from-transcripts-sqlite.test.ts
- app/api/__tests__/dashboard-guide.test.ts
- app/api/__tests__/developer-handoff-route.test.ts
- app/api/__tests__/docs-proposal-permissions.test.ts
- app/api/__tests__/invoice-aging-buckets.test.ts
- app/api/__tests__/invoice-drafts-not-owed.test.ts
- app/api/__tests__/invoice-email-allowlist.test.ts
- app/api/__tests__/invoice-ledger-routes.test.ts
- app/api/__tests__/mcp-actor-attribution-routes.test.ts
- app/api/__tests__/mcp-calls-meeting-type-parity.test.ts
- app/api/__tests__/messages-routes.test.ts
- app/api/__tests__/nested-client-scope-sqlite.test.ts
- app/api/__tests__/onboarding-invites-mint.test.ts
- app/api/__tests__/overview-replies-waiting.test.ts
- app/api/__tests__/permission-write-guards.test.ts
- app/api/__tests__/permissions-copy-access.test.ts
- app/api/__tests__/permissions-matrix.test.ts
- app/api/__tests__/permissions-route-guards.test.ts
- app/api/__tests__/pipeline-capacity.test.ts
- app/api/__tests__/pipeline-stages-put.test.ts
- app/api/__tests__/portal-acting-as.test.ts
- app/api/__tests__/portal-invoice-denials.test.ts
- app/api/__tests__/portal-invoice-drafts-hidden.test.ts
- app/api/__tests__/portal-invoice-pay-path.test.ts
- app/api/__tests__/portal-plan-truth.test.ts
- app/api/__tests__/portal-project-published-schedule.test.ts
- app/api/__tests__/portal-request-acting-submit.test.ts
- app/api/__tests__/portal-request-created-notify.test.ts
- app/api/__tests__/portal-request-numbering.test.ts
- app/api/__tests__/portal-request-patch.test.ts
- app/api/__tests__/portal-request-projection.test.ts
- app/api/__tests__/portal-request-reads.test.ts
- app/api/__tests__/portal-request-team-fanout.test.ts
- app/api/__tests__/portal-tracks-reorder-synthetic.test.ts
- app/api/__tests__/privileged-route-access-sqlite.test.ts
- app/api/__tests__/proposal-share-snapshot.test.ts
- app/api/__tests__/public-lead-secret.test.ts
- app/api/__tests__/recorder-device-auth-pairing.test.ts
- app/api/__tests__/recorder-recordings.test.ts
- app/api/__tests__/request-assignment-ping.test.ts
- app/api/__tests__/request-auto-handback.test.ts
- app/api/__tests__/request-status-fanout.test.ts
- app/api/__tests__/route-review-messaging-sqlite.test.ts
- app/api/__tests__/sales-artifact-feature-guards.test.ts
- app/api/__tests__/sales-artifact-scope.test.ts
- app/api/__tests__/sales-email-publish-guard.test.ts
- app/api/__tests__/sales-review-sqlite.test.ts
- app/api/__tests__/schedule-section-boundaries.test.ts
- app/api/__tests__/schedule-share-snapshot.test.ts
- app/api/__tests__/scoped-reports-permissions.test.ts
- app/api/__tests__/services-org-scope.test.ts
- app/api/__tests__/share-suppression-reporting.test.ts
- app/api/__tests__/snapshot-metrics-route.test.ts
- app/api/__tests__/stripe-create-allowlist.test.ts
- app/api/__tests__/t1-6-internal-routes.test.ts
- app/api/__tests__/t1-6-org-routes.test.ts
- app/api/__tests__/t1-6-support-routes.test.ts
- app/api/__tests__/t1-6-time-billing-sqlite.test.ts
- app/api/__tests__/time-stamp-invoiced.test.ts
- app/api/__tests__/xero-contact-identity-sqlite.test.ts
- app/api/__tests__/xero-import-sync-routes.test.ts
- app/api/admin/call-transcripts/__tests__/list-scope.test.ts
- app/api/admin/call-transcripts/__tests__/patch-link.test.ts
- app/api/admin/calls/__tests__/patch-link-fields.test.ts
- app/api/admin/calls/__tests__/prep-note.test.ts
- app/api/admin/calls/__tests__/reminder-window.test.ts
- app/api/admin/db/migrate/__tests__/migrate-authorization-sqlite.test.ts
- app/api/admin/discovery-calls/__tests__/patch-link-fields.test.ts
- app/api/admin/discovery-calls/__tests__/prep-note.test.ts
- app/api/admin/integrations/google/__tests__/sync-calendar-meeting-type.test.ts
- app/api/admin/integrations/google/__tests__/sync-drive-transcripts.test.ts
- app/api/admin/requests/[id]/__tests__/handoff.test.ts
- app/api/admin/requests/[id]/__tests__/participants.test.ts
- app/api/admin/requests/__tests__/waiting-on.test.ts
- app/api/admin/task-suggestions/__tests__/rebuild-route.test.ts
- app/api/admin/task-suggestions/__tests__/suggestion-edited-proposal-sqlite.test.ts
- app/api/admin/task-suggestions/__tests__/suggestion-feature-guards.test.ts
- app/api/admin/task-suggestions/__tests__/suggestion-release-guards-sqlite.test.ts
- app/api/admin/task-suggestions/__tests__/suggestion-zero-scope-sqlite.test.ts
- app/api/admin/task-suggestions/__tests__/task-suggestions-routes.test.ts
- app/api/admin/tasks/__tests__/tasks-bulk.test.ts
- app/api/admin/tasks/__tests__/tasks-comments.test.ts
- app/api/admin/tasks/__tests__/tasks-create.test.ts
- app/api/admin/tasks/__tests__/tasks-enrichment.test.ts
- app/api/admin/tasks/__tests__/tasks-from-template.test.ts
- app/api/admin/tasks/__tests__/tasks-patch.test.ts
- app/api/admin/tasks/__tests__/tasks-promote.test.ts
- app/api/portal/requests/[id]/__tests__/handback.test.ts
- app/api/portal/requests/__tests__/waiting-on.test.ts
- lib/__tests__/calls-meeting-type.test.ts
- lib/__tests__/cron-secret.test.ts
- lib/__tests__/messages-store.test.ts
- lib/__tests__/request-handoff-nudge.test.ts
- lib/__tests__/request-handoff.test.ts
- lib/__tests__/require-feature-guards.test.ts
- lib/__tests__/route-org-filter.test.ts
- lib/__tests__/sitemap-auth.test.ts
- lib/__tests__/tahi-bot.test.ts
- lib/__tests__/task-suggester-retry-sqlite.test.ts
- lib/__tests__/xero-import-identity-sqlite.test.ts
- lib/calls.test.ts
- lib/overview-brief.test.ts
- lib/recording-transcript-client.test.ts
- lib/slack/__tests__/client-dm-safety.test.ts
- lib/slack/__tests__/recipient-permissions-sqlite.test.ts
- lib/task-suggester.test.ts

</details>

## Original inventory and classification at 67594c29

The inventory covers every explicit HTTP export in all 419 app/api/admin route.ts files: 593 handlers. Each method has its own classification. Framework-generated unsupported-method/OPTIONS responses carry no application data and are not separate exports.

- A: owning feature gate plus client scope for org-owned reads/writes. Minimal owner/link metadata may be looked up to decide access; business content is guarded or SQL-filtered before pagination.
- B: intentional studio-global, admin, service or personal-account surface, with an owning feature/role/verified-service guard. Exact intentional self-service and callback exceptions are documented below.
- C: a feature/role or client-scope gap at the baseline. The original inventory classified all baseline C handlers as repaired. The failed reviews showed that this was insufficient proof; H3 remains a separate planned batch.

| Method class | Baseline | After repairs |
| --- | ---: | ---: |
| A, scoped correctly | 148 | 303 |
| B, intentional internal/admin | 164 | 290 |
| C, gap | 281 | 0 |
| Total | 593 | 593 |

| Route-file classification | Baseline | After repairs |
| --- | ---: | ---: |
| A methods only | 91 | 194 |
| B methods only | 113 | 221 |
| Mixed A/B methods | 0 | 4 |
| Any C method | 215 | 0 |
| Total | 419 | 419 |

There are 309 repaired or additionally tightened methods. Existing stronger guards remain. Admin, super_admin and verified api-service access is preserved, including orphan-timer disposal and unrestricted legacy studio-message reads. Authorisation uses the authenticated userId/orgId, never mcpActor, attributedUserId or recordedActorId. Decision #070 attribution and worker profile enforcement are unchanged.

## Repairs

P3-7: clients/[id]/pm PUT retains its clients feature and target-org checks, then requires canManagePermissions before reading or changing linked project_manager rules. Both granting and clearing require that capability. Tests prove a scoped client seat cannot mutate grants, while admin/super_admin/service callers retain access.

Lists and aggregates use SQL fences before LIMIT, including nested/polymorphic links, message/file row ownership and timer current parents. Writes validate the source/current owner and every destination client link before mutation. Full-workspace jobs and finance maintenance require an actual admin role plus their existing feature gate. Repeated SQL fences use validated org literals so composing them cannot exhaust D1's 100-bind budget; unsafe IDs narrow to denial.

Every repaired handler is listed here. Locations anchor the handler containing the guard; shared-helper repairs follow this table.

| Handler and file:line | Repair |
| --- | --- |
| PATCH [app/api/admin/ai-reply-drafts/[id]/route.ts:23](../../../app/api/admin/ai-reply-drafts/[id]/route.ts#L23) | Checks source feature and invoice ownership before generated content or mutation; preserves true admin/service bypass. |
| DELETE [app/api/admin/ai-reply-drafts/[id]/route.ts:53](../../../app/api/admin/ai-reply-drafts/[id]/route.ts#L53) | Checks source feature and invoice ownership before generated content or mutation; preserves true admin/service bypass. |
| POST [app/api/admin/ai-reply-drafts/[id]/send/route.ts:34](../../../app/api/admin/ai-reply-drafts/[id]/send/route.ts#L34) | Checks source feature and invoice ownership before generated content or mutation; preserves true admin/service bypass. |
| GET [app/api/admin/ai/briefing/route.ts:14](../../../app/api/admin/ai/briefing/route.ts#L14) | Enforces the subject feature and target client; prediction cohorts, billed hours and participant queries are scoped before LIMIT. Whole-studio briefing additionally requires admin. |
| POST [app/api/admin/ai/briefing/route.ts:48](../../../app/api/admin/ai/briefing/route.ts#L48) | Enforces the subject feature and target client; prediction cohorts, billed hours and participant queries are scoped before LIMIT. Whole-studio briefing additionally requires admin. |
| POST [app/api/admin/ai/predict-fields/route.ts:619](../../../app/api/admin/ai/predict-fields/route.ts#L619) | Enforces the subject feature and target client; prediction cohorts, billed hours and participant queries are scoped before LIMIT. Whole-studio briefing additionally requires admin. |
| POST [app/api/admin/ai/task-wizard/route.ts:644](../../../app/api/admin/ai/task-wizard/route.ts#L644) | Enforces the subject feature and target client; prediction cohorts, billed hours and participant queries are scoped before LIMIT. Whole-studio briefing additionally requires admin. |
| PATCH [app/api/admin/announcements/[id]/route.ts:20](../../../app/api/admin/announcements/[id]/route.ts#L20) | Adds the announcements feature gate while retaining existing broadcast target checks. |
| DELETE [app/api/admin/announcements/[id]/route.ts:158](../../../app/api/admin/announcements/[id]/route.ts#L158) | Adds the announcements feature gate while retaining existing broadcast target checks. |
| POST [app/api/admin/announcements/[id]/send/route.ts:21](../../../app/api/admin/announcements/[id]/send/route.ts#L21) | Adds the announcements feature gate while retaining existing broadcast target checks. |
| GET [app/api/admin/announcements/route.ts:19](../../../app/api/admin/announcements/route.ts#L19) | Adds the announcements feature gate while retaining existing broadcast target checks. |
| POST [app/api/admin/announcements/route.ts:63](../../../app/api/admin/announcements/route.ts#L63) | Adds the announcements feature gate while retaining existing broadcast target checks. |
| PATCH [app/api/admin/automations/[id]/route.ts:12](../../../app/api/admin/automations/[id]/route.ts#L12) | Requires settings plus an admin role for full-workspace automation rules and logs. |
| DELETE [app/api/admin/automations/[id]/route.ts:61](../../../app/api/admin/automations/[id]/route.ts#L61) | Requires settings plus an admin role for full-workspace automation rules and logs. |
| GET [app/api/admin/automations/log/route.ts:11](../../../app/api/admin/automations/log/route.ts#L11) | Requires settings plus an admin role for full-workspace automation rules and logs. |
| GET [app/api/admin/automations/route.ts:10](../../../app/api/admin/automations/route.ts#L10) | Requires settings plus an admin role for full-workspace automation rules and logs. |
| POST [app/api/admin/automations/route.ts:31](../../../app/api/admin/automations/route.ts#L31) | Requires settings plus an admin role for full-workspace automation rules and logs. |
| GET [app/api/admin/billing/financial-health/route.ts:23](../../../app/api/admin/billing/financial-health/route.ts#L23) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/billing/monthly-email/route.ts:24](../../../app/api/admin/billing/monthly-email/route.ts#L24) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/billing/xero-export/route.ts:50](../../../app/api/admin/billing/xero-export/route.ts#L50) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/blockers/search/route.ts:12](../../../app/api/admin/blockers/search/route.ts#L12) | Requires either owning feature and queries only feature-permitted candidates within org scope before LIMIT |
| GET [app/api/admin/brands/route.ts:12](../../../app/api/admin/brands/route.ts#L12) | Adds owning feature guard before business data |
| POST [app/api/admin/calculator/draft/route.ts:21](../../../app/api/admin/calculator/draft/route.ts#L21) | Scopes calculations and live estimators before LIMIT; validates current/source and target org/deal links, including artifact feature when drafting. |
| GET [app/api/admin/calculator/route.ts:22](../../../app/api/admin/calculator/route.ts#L22) | Scopes calculations and live estimators before LIMIT; validates current/source and target org/deal links, including artifact feature when drafting. |
| POST [app/api/admin/calculator/route.ts:51](../../../app/api/admin/calculator/route.ts#L51) | Scopes calculations and live estimators before LIMIT; validates current/source and target org/deal links, including artifact feature when drafting. |
| PATCH [app/api/admin/calculator/route.ts:203](../../../app/api/admin/calculator/route.ts#L203) | Scopes calculations and live estimators before LIMIT; validates current/source and target org/deal links, including artifact feature when drafting. |
| DELETE [app/api/admin/calculator/route.ts:244](../../../app/api/admin/calculator/route.ts#L244) | Scopes calculations and live estimators before LIMIT; validates current/source and target org/deal links, including artifact feature when drafting. |
| GET [app/api/admin/call-transcripts/[id]/route.ts:97](../../../app/api/admin/call-transcripts/[id]/route.ts#L97) | Adds owning feature guard before business data; Checks all discovery parents and filters stored call/recording owners before LIMIT |
| PATCH [app/api/admin/call-transcripts/[id]/route.ts:122](../../../app/api/admin/call-transcripts/[id]/route.ts#L122) | Adds owning feature guard before business data; Checks all discovery parents and filters stored call/recording owners before LIMIT |
| GET [app/api/admin/call-transcripts/calls/route.ts:40](../../../app/api/admin/call-transcripts/calls/route.ts#L40) | Adds owning feature guard before business data; Checks all discovery parents and filters stored call/recording owners before LIMIT |
| GET [app/api/admin/call-transcripts/route.ts:38](../../../app/api/admin/call-transcripts/route.ts#L38) | Adds calls feature guard and stored call and recording parent SQL filters before LIMIT |
| PATCH [app/api/admin/calls/[id]/route.ts:29](../../../app/api/admin/calls/[id]/route.ts#L29) | Adds owning feature guard before business data |
| GET [app/api/admin/calls/index/route.ts:25](../../../app/api/admin/calls/index/route.ts#L25) | Adds owning feature guard before business data |
| POST [app/api/admin/calls/normalize-times/route.ts:52](../../../app/api/admin/calls/normalize-times/route.ts#L52) | Adds calls feature and real admin-role guard before workspace-wide scan or mutation |
| GET [app/api/admin/calls/route.ts:14](../../../app/api/admin/calls/route.ts#L14) | Adds owning feature guard before business data |
| POST [app/api/admin/calls/route.ts:90](../../../app/api/admin/calls/route.ts#L90) | Adds owning feature guard before business data |
| GET [app/api/admin/capacity/forecast/route.ts:13](../../../app/api/admin/capacity/forecast/route.ts#L13) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/capacity/route.ts:22](../../../app/api/admin/capacity/route.ts#L22) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| PATCH [app/api/admin/capacity/route.ts:152](../../../app/api/admin/capacity/route.ts#L152) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/capacity/start-date/route.ts:27](../../../app/api/admin/capacity/start-date/route.ts#L27) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/case-studies/draft/route.ts:12](../../../app/api/admin/case-studies/draft/route.ts#L12) | Requires reviews and submission-owner access before reading the testimonial or writing a draft. |
| GET [app/api/admin/clients/[id]/calls/route.ts:20](../../../app/api/admin/clients/[id]/calls/route.ts#L20) | Checks all stored call parents through scoped listCallsForParent |
| PUT [app/api/admin/clients/[id]/pm/route.ts:61](../../../app/api/admin/clients/[id]/pm/route.ts#L61) | Requires canManagePermissions before permission rule reads or writes |
| GET [app/api/admin/clients/route.ts:21](../../../app/api/admin/clients/route.ts#L21) | Adds owning feature guard before business data |
| POST [app/api/admin/content/audits/[id]/improve/route.ts:53](../../../app/api/admin/content/audits/[id]/improve/route.ts#L53) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/audits/route.ts:94](../../../app/api/admin/content/audits/route.ts#L94) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/audits/route.ts:120](../../../app/api/admin/content/audits/route.ts#L120) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/backfill-settings/route.ts:71](../../../app/api/admin/content/backfill-settings/route.ts#L71) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/backfill-settings/route.ts:80](../../../app/api/admin/content/backfill-settings/route.ts#L80) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/backfill/process/route.ts:227](../../../app/api/admin/content/backfill/process/route.ts#L227) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/backfill/runs/[runId]/route.ts:42](../../../app/api/admin/content/backfill/runs/[runId]/route.ts#L42) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/backfill/runs/route.ts:43](../../../app/api/admin/content/backfill/runs/route.ts#L43) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/backfill/start/route.ts:70](../../../app/api/admin/content/backfill/start/route.ts#L70) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/bulk-backfill/route.ts:53](../../../app/api/admin/content/bulk-backfill/route.ts#L53) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/clusters/route.ts:23](../../../app/api/admin/content/clusters/route.ts#L23) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/clusters/seed/route.ts:22](../../../app/api/admin/content/clusters/seed/route.ts#L22) | Added content_studio feature guard before any data reads or mutations. |
| PATCH [app/api/admin/content/conflicts/[id]/route.ts:32](../../../app/api/admin/content/conflicts/[id]/route.ts#L32) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/cover/generate/route.ts:55](../../../app/api/admin/content/cover/generate/route.ts#L55) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/cover/preview/route.ts:48](../../../app/api/admin/content/cover/preview/route.ts#L48) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/coverage-audit/route.ts:145](../../../app/api/admin/content/coverage-audit/route.ts#L145) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/advance/route.ts:27](../../../app/api/admin/content/drafts/[id]/advance/route.ts#L27) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/approve-brief/route.ts:22](../../../app/api/admin/content/drafts/[id]/approve-brief/route.ts#L22) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/force-approve/route.ts:31](../../../app/api/admin/content/drafts/[id]/force-approve/route.ts#L31) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/pause/route.ts:30](../../../app/api/admin/content/drafts/[id]/pause/route.ts#L30) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/drafts/[id]/pipeline/route.ts:43](../../../app/api/admin/content/drafts/[id]/pipeline/route.ts#L43) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/publish/route.ts:72](../../../app/api/admin/content/drafts/[id]/publish/route.ts#L72) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/regenerate-cover/route.ts:30](../../../app/api/admin/content/drafts/[id]/regenerate-cover/route.ts#L30) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/reject-brief/route.ts:22](../../../app/api/admin/content/drafts/[id]/reject-brief/route.ts#L22) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/repair-schema/route.ts:38](../../../app/api/admin/content/drafts/[id]/repair-schema/route.ts#L38) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/restart/route.ts:27](../../../app/api/admin/content/drafts/[id]/restart/route.ts#L27) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/restructure/route.ts:36](../../../app/api/admin/content/drafts/[id]/restructure/route.ts#L36) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/resume/route.ts:22](../../../app/api/admin/content/drafts/[id]/resume/route.ts#L22) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/retry/route.ts:31](../../../app/api/admin/content/drafts/[id]/retry/route.ts#L31) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/drafts/[id]/route.ts:29](../../../app/api/admin/content/drafts/[id]/route.ts#L29) | Added content_studio feature guard before any data reads or mutations. |
| DELETE [app/api/admin/content/drafts/[id]/route.ts:80](../../../app/api/admin/content/drafts/[id]/route.ts#L80) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/send-to-staci/route.ts:41](../../../app/api/admin/content/drafts/[id]/send-to-staci/route.ts#L41) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/set-cover/route.ts:22](../../../app/api/admin/content/drafts/[id]/set-cover/route.ts#L22) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/[id]/suggest-edits/route.ts:31](../../../app/api/admin/content/drafts/[id]/suggest-edits/route.ts#L31) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/drafts/recompute-bucket-scores/route.ts:45](../../../app/api/admin/content/drafts/recompute-bucket-scores/route.ts#L45) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/drafts/route.ts:27](../../../app/api/admin/content/drafts/route.ts#L27) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/field-audit/route.ts:56](../../../app/api/admin/content/field-audit/route.ts#L56) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/glossary/[id]/audit/route.ts:32](../../../app/api/admin/content/glossary/[id]/audit/route.ts#L32) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/glossary/[id]/backfill/route.ts:30](../../../app/api/admin/content/glossary/[id]/backfill/route.ts#L30) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/glossary/boost-underperformers/route.ts:28](../../../app/api/admin/content/glossary/boost-underperformers/route.ts#L28) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/glossary/boost-underperformers/route.ts:56](../../../app/api/admin/content/glossary/boost-underperformers/route.ts#L56) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/glossary/generate/route.ts:33](../../../app/api/admin/content/glossary/generate/route.ts#L33) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/glossary/index-schema/route.ts:32](../../../app/api/admin/content/glossary/index-schema/route.ts#L32) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/glossary/inspect/route.ts:23](../../../app/api/admin/content/glossary/inspect/route.ts#L23) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/glossary/publish/route.ts:83](../../../app/api/admin/content/glossary/publish/route.ts#L83) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/health/indexnow/route.ts:32](../../../app/api/admin/content/health/indexnow/route.ts#L32) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/health/route.ts:47](../../../app/api/admin/content/health/route.ts#L47) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/health/scan/route.ts:71](../../../app/api/admin/content/health/scan/route.ts#L71) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/health/sitemap/route.ts:76](../../../app/api/admin/content/health/sitemap/route.ts#L76) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/ideas/[id]/round-table/route.ts:31](../../../app/api/admin/content/ideas/[id]/round-table/route.ts#L31) | Added content_studio feature guard before any data reads or mutations. |
| PATCH [app/api/admin/content/ideas/[id]/route.ts:35](../../../app/api/admin/content/ideas/[id]/route.ts#L35) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/ideas/manual/route.ts:59](../../../app/api/admin/content/ideas/manual/route.ts#L59) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/ideas/route.ts:32](../../../app/api/admin/content/ideas/route.ts#L32) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/links/[id]/apply/route.ts:42](../../../app/api/admin/content/links/[id]/apply/route.ts#L42) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/links/[id]/reject/route.ts:26](../../../app/api/admin/content/links/[id]/reject/route.ts#L26) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/links/scan/route.ts:118](../../../app/api/admin/content/links/scan/route.ts#L118) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/links/suggestions/route.ts:58](../../../app/api/admin/content/links/suggestions/route.ts#L58) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/posts/[id]/backfill/route.ts:20](../../../app/api/admin/content/posts/[id]/backfill/route.ts#L20) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/posts/[id]/schema/rebuild/route.ts:39](../../../app/api/admin/content/posts/[id]/schema/rebuild/route.ts#L39) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/posts/schema/rebuild-all/route.ts:143](../../../app/api/admin/content/posts/schema/rebuild-all/route.ts#L143) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/schedule/route.ts:35](../../../app/api/admin/content/schedule/route.ts#L35) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/schema/unwrap-existing/route.ts:123](../../../app/api/admin/content/schema/unwrap-existing/route.ts#L123) | Added content_studio feature guard before any data reads or mutations. |
| POST [app/api/admin/content/scorecards/refresh/route.ts:51](../../../app/api/admin/content/scorecards/refresh/route.ts#L51) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/site-index/route.ts:19](../../../app/api/admin/content/site-index/route.ts#L19) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/spend/route.ts:30](../../../app/api/admin/content/spend/route.ts#L30) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/content/webflow-status/route.ts:21](../../../app/api/admin/content/webflow-status/route.ts#L21) | Added content_studio feature guard before any data reads or mutations. |
| GET [app/api/admin/conversations/[id]/messages/route.ts:21](../../../app/api/admin/conversations/[id]/messages/route.ts#L21) | Adds messages feature guard; validates conversation/request parents and scopes individual message and author-contact rows before pagination; preserves internal Tahi-org message convention |
| POST [app/api/admin/conversations/[id]/messages/route.ts:164](../../../app/api/admin/conversations/[id]/messages/route.ts#L164) | Adds messages feature guard; validates linked request and the actual message org inherited from conversation/contact before insertion |
| PATCH [app/api/admin/conversations/[id]/messages/route.ts:377](../../../app/api/admin/conversations/[id]/messages/route.ts#L377) | Adds messages feature guard; checks participant, conversation/request parent scope and individual message org before soft-delete mutation |
| GET [app/api/admin/conversations/route.ts:19](../../../app/api/admin/conversations/route.ts#L19) | Adds messages feature guard; SQL filters conversation org and request parent, then independently scopes message previews/counts and participant-contact names |
| POST [app/api/admin/conversations/route.ts:254](../../../app/api/admin/conversations/route.ts#L254) | Adds owning feature guard before business data; Checks linked request/contact client scope and filters list SQL before metadata reads |
| POST [app/api/admin/cron/affiliate-reactivation/route.ts:39](../../../app/api/admin/cron/affiliate-reactivation/route.ts#L39) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/auto-promote-calls/route.ts:39](../../../app/api/admin/cron/auto-promote-calls/route.ts#L39) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/backlink-process/route.ts:25](../../../app/api/admin/cron/backlink-process/route.ts#L25) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/content-auto-backfill/route.ts:51](../../../app/api/admin/cron/content-auto-backfill/route.ts#L51) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/content-gap-hunt/route.ts:20](../../../app/api/admin/cron/content-gap-hunt/route.ts#L20) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/daily-summary/route.ts:37](../../../app/api/admin/cron/daily-summary/route.ts#L37) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/delivery-watch/route.ts:21](../../../app/api/admin/cron/delivery-watch/route.ts#L21) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/finance-anomaly-scan/route.ts:37](../../../app/api/admin/cron/finance-anomaly-scan/route.ts#L37) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/ideation/route.ts:334](../../../app/api/admin/cron/ideation/route.ts#L334) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/indexing-reverser/route.ts:38](../../../app/api/admin/cron/indexing-reverser/route.ts#L38) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/leads-ai/route.ts:111](../../../app/api/admin/cron/leads-ai/route.ts#L111) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/link-engine-scan/route.ts:97](../../../app/api/admin/cron/link-engine-scan/route.ts#L97) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/post-scorecard-sync/route.ts:55](../../../app/api/admin/cron/post-scorecard-sync/route.ts#L55) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/pre-call-digest/route.ts:52](../../../app/api/admin/cron/pre-call-digest/route.ts#L52) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/publish-scheduled/route.ts:43](../../../app/api/admin/cron/publish-scheduled/route.ts#L43) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/round-table-advance/route.ts:111](../../../app/api/admin/cron/round-table-advance/route.ts#L111) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/schema-watchdog/route.ts:22](../../../app/api/admin/cron/schema-watchdog/route.ts#L22) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/site-index-sync/route.ts:24](../../../app/api/admin/cron/site-index-sync/route.ts#L24) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/snapshot-metrics/route.ts:85](../../../app/api/admin/cron/snapshot-metrics/route.ts#L85) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/suggestion-digest/route.ts:53](../../../app/api/admin/cron/suggestion-digest/route.ts#L53) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/cron/sync-stripe/route.ts:41](../../../app/api/admin/cron/sync-stripe/route.ts#L41) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/cron/sync-xero/route.ts:60](../../../app/api/admin/cron/sync-xero/route.ts#L60) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/crons/route.ts:148](../../../app/api/admin/crons/route.ts#L148) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/crons/suggest-from-transcripts/route.ts:76](../../../app/api/admin/crons/suggest-from-transcripts/route.ts#L76) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| POST [app/api/admin/crons/sweep/route.ts:34](../../../app/api/admin/crons/sweep/route.ts#L34) | Shared assertCronAuth now requires settings plus resolved admin role for manual execution; scheduler-secret path retained. |
| GET [app/api/admin/deals/[id]/calls/route.ts:20](../../../app/api/admin/deals/[id]/calls/route.ts#L20) | Filters linked contacts and polymorphic calls, and checks a contact target before attachment/removal. |
| GET [app/api/admin/deals/[id]/contacts/route.ts:18](../../../app/api/admin/deals/[id]/contacts/route.ts#L18) | Filters linked contacts and polymorphic calls, and checks a contact target before attachment/removal. |
| POST [app/api/admin/deals/[id]/contacts/route.ts:52](../../../app/api/admin/deals/[id]/contacts/route.ts#L52) | Filters linked contacts and polymorphic calls, and checks a contact target before attachment/removal. |
| DELETE [app/api/admin/deals/[id]/contacts/route.ts:89](../../../app/api/admin/deals/[id]/contacts/route.ts#L89) | Filters linked contacts and polymorphic calls, and checks a contact target before attachment/removal. |
| GET [app/api/admin/deals/[id]/route.ts:19](../../../app/api/admin/deals/[id]/route.ts#L19) | Filters linked contacts and polymorphic calls, and checks a contact target before attachment/removal. |
| POST [app/api/admin/derive-billing/route.ts:20](../../../app/api/admin/derive-billing/route.ts#L20) | Requires an admin role in addition to clients and finance for the full-workspace backfill. |
| POST [app/api/admin/discovery-calls/[id]/extract/route.ts:117](../../../app/api/admin/discovery-calls/[id]/extract/route.ts#L117) | Requires calls, checks all current org/deal/request/task links, and filters every parent before LIMIT and enrichment. |
| PATCH [app/api/admin/discovery-calls/[id]/route.ts:59](../../../app/api/admin/discovery-calls/[id]/route.ts#L59) | Requires calls, checks all current org/deal/request/task links, and filters every parent before LIMIT and enrichment. |
| DELETE [app/api/admin/discovery-calls/[id]/route.ts:302](../../../app/api/admin/discovery-calls/[id]/route.ts#L302) | Requires calls, checks all current org/deal/request/task links, and filters every parent before LIMIT and enrichment. |
| GET [app/api/admin/discovery-calls/upcoming/route.ts:46](../../../app/api/admin/discovery-calls/upcoming/route.ts#L46) | Requires calls, checks all current org/deal/request/task links, and filters every parent before LIMIT and enrichment. |
| GET [app/api/admin/exchange-rates/route.ts:8](../../../app/api/admin/exchange-rates/route.ts#L8) | Added missing feature/admin check or organisation SQL fence. |
| POST [app/api/admin/exchange-rates/route.ts:32](../../../app/api/admin/exchange-rates/route.ts#L32) | Added missing feature/admin check or organisation SQL fence. |
| DELETE [app/api/admin/feedback/[id]/route.ts:22](../../../app/api/admin/feedback/[id]/route.ts#L22) | Requires settings and an admin role before feedback rows, screenshots or deletion. |
| GET [app/api/admin/feedback/[id]/screenshot/route.ts:22](../../../app/api/admin/feedback/[id]/screenshot/route.ts#L22) | Requires settings and an admin role before feedback rows, screenshots or deletion. |
| GET [app/api/admin/feedback/route.ts:28](../../../app/api/admin/feedback/route.ts#L28) | Requires settings and an admin role before feedback rows, screenshots or deletion. |
| GET [app/api/admin/financial-reports/anomalies/route.ts:20](../../../app/api/admin/financial-reports/anomalies/route.ts#L20) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/financial-reports/backfill-mrr/route.ts:24](../../../app/api/admin/financial-reports/backfill-mrr/route.ts#L24) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/financial-reports/subscriptions-audit/route.ts:23](../../../app/api/admin/financial-reports/subscriptions-audit/route.ts#L23) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/financial-reports/summary/route.ts:31](../../../app/api/admin/financial-reports/summary/route.ts#L31) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| PATCH [app/api/admin/forms/[id]/route.ts:10](../../../app/api/admin/forms/[id]/route.ts#L10) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| DELETE [app/api/admin/forms/[id]/route.ts:74](../../../app/api/admin/forms/[id]/route.ts#L74) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/forms/resolve/route.ts:16](../../../app/api/admin/forms/resolve/route.ts#L16) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/forms/route.ts:17](../../../app/api/admin/forms/route.ts#L17) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| POST [app/api/admin/forms/route.ts:73](../../../app/api/admin/forms/route.ts#L73) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/guide/route.ts:8](../../../app/api/admin/guide/route.ts#L8) | Added missing feature/admin check or organisation SQL fence. |
| GET [app/api/admin/health/route.ts:18](../../../app/api/admin/health/route.ts#L18) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/health/route.ts:81](../../../app/api/admin/health/route.ts#L81) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/integrations/airwallex/sync/route.ts:32](../../../app/api/admin/integrations/airwallex/sync/route.ts#L32) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/google/sync-calendar/route.ts:35](../../../app/api/admin/integrations/google/sync-calendar/route.ts#L35) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/google/sync-drive-transcripts/route.ts:69](../../../app/api/admin/integrations/google/sync-drive-transcripts/route.ts#L69) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/rewardful/sync/route.ts:14](../../../app/api/admin/integrations/rewardful/sync/route.ts#L14) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/stripe/import-invoices/route.ts:18](../../../app/api/admin/integrations/stripe/import-invoices/route.ts#L18) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/stripe/import-payments/route.ts:18](../../../app/api/admin/integrations/stripe/import-payments/route.ts#L18) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/integrations/stripe/provision/route.ts:116](../../../app/api/admin/integrations/stripe/provision/route.ts#L116) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/integrations/stripe/provision/route.ts:30](../../../app/api/admin/integrations/stripe/provision/route.ts#L30) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/integrations/xero/import-invoices/route.ts:17](../../../app/api/admin/integrations/xero/import-invoices/route.ts#L17) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/integrations/xero/match-contacts/route.ts:21](../../../app/api/admin/integrations/xero/match-contacts/route.ts#L21) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| PATCH [app/api/admin/integrations/xero/match-contacts/route.ts:80](../../../app/api/admin/integrations/xero/match-contacts/route.ts#L80) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/xero/sync-balances/route.ts:19](../../../app/api/admin/integrations/xero/sync-balances/route.ts#L19) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/xero/sync-payments/route.ts:17](../../../app/api/admin/integrations/xero/sync-payments/route.ts#L17) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/xero/sync-pnl/route.ts:22](../../../app/api/admin/integrations/xero/sync-pnl/route.ts#L22) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| POST [app/api/admin/integrations/zapier/route.ts:62](../../../app/api/admin/integrations/zapier/route.ts#L62) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/invoices/backfill-numbers/route.ts:45](../../../app/api/admin/invoices/backfill-numbers/route.ts#L45) | Adds admin checks to full-workspace maintenance, validates every Xero target before payload/external calls, and checks linked subscriptions at creation. |
| POST [app/api/admin/invoices/dedupe-manyrequests-twins/route.ts:48](../../../app/api/admin/invoices/dedupe-manyrequests-twins/route.ts#L48) | Adds admin checks to full-workspace maintenance, validates every Xero target before payload/external calls, and checks linked subscriptions at creation. |
| POST [app/api/admin/invoices/dedupe-stripe-charges/route.ts:42](../../../app/api/admin/invoices/dedupe-stripe-charges/route.ts#L42) | Adds admin checks to full-workspace maintenance, validates every Xero target before payload/external calls, and checks linked subscriptions at creation. |
| POST [app/api/admin/invoices/route.ts:94](../../../app/api/admin/invoices/route.ts#L94) | Adds admin checks to full-workspace maintenance, validates every Xero target before payload/external calls, and checks linked subscriptions at creation. |
| POST [app/api/admin/invoices/xero-sync/route.ts:34](../../../app/api/admin/invoices/xero-sync/route.ts#L34) | Adds admin checks to full-workspace maintenance, validates every Xero target before payload/external calls, and checks linked subscriptions at creation. |
| PATCH [app/api/admin/kanban-columns/[id]/route.ts:11](../../../app/api/admin/kanban-columns/[id]/route.ts#L11) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| DELETE [app/api/admin/kanban-columns/[id]/route.ts:60](../../../app/api/admin/kanban-columns/[id]/route.ts#L60) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/kanban-columns/route.ts:52](../../../app/api/admin/kanban-columns/route.ts#L52) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| POST [app/api/admin/kanban-columns/route.ts:92](../../../app/api/admin/kanban-columns/route.ts#L92) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| PATCH [app/api/admin/kanban-columns/route.ts:190](../../../app/api/admin/kanban-columns/route.ts#L190) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/leads/[id]/calls/route.ts:32](../../../app/api/admin/leads/[id]/calls/route.ts#L32) | Scopes linked calls, promotion target/source and already-promoted deal; org creation and global pipeline triage require admin. |
| POST [app/api/admin/leads/[id]/promote/route.ts:41](../../../app/api/admin/leads/[id]/promote/route.ts#L41) | Scopes linked calls, promotion target/source and already-promoted deal; org creation and global pipeline triage require admin. |
| POST [app/api/admin/leads/triage-pipeline/route.ts:34](../../../app/api/admin/leads/triage-pipeline/route.ts#L34) | Scopes linked calls, promotion target/source and already-promoted deal; org creation and global pipeline triage require admin. |
| GET [app/api/admin/messages/[source]/[id]/route.ts:163](../../../app/api/admin/messages/[source]/[id]/route.ts#L163) | Passes authenticated studio OrgScope to shared thread reader; filters row orgs before LIMIT and author-contact metadata while preserving studio-all and existing file-org guard |
| GET [app/api/admin/messages/route.ts:31](../../../app/api/admin/messages/route.ts#L31) | Passes authenticated studio OrgScope to shared inbox reader; filters message row orgs and contact metadata before preview, with earned studio-all bypass |
| GET [app/api/admin/nudge-templates/route.ts:11](../../../app/api/admin/nudge-templates/route.ts#L11) | Requires deals before reading or changing studio templates. |
| POST [app/api/admin/nudge-templates/route.ts:28](../../../app/api/admin/nudge-templates/route.ts#L28) | Requires deals before reading or changing studio templates. |
| PATCH [app/api/admin/nudge-templates/route.ts:66](../../../app/api/admin/nudge-templates/route.ts#L66) | Requires deals before reading or changing studio templates. |
| POST [app/api/admin/onboarding-invites/route.ts:74](../../../app/api/admin/onboarding-invites/route.ts#L74) | Team grants require permission management; client artifact links are independently scoped before invitation creation. |
| POST [app/api/admin/overview/brief/refresh/route.ts:46](../../../app/api/admin/overview/brief/refresh/route.ts#L46) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/overview/brief/route.ts:12](../../../app/api/admin/overview/brief/route.ts#L12) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/overview/me/route.ts:47](../../../app/api/admin/overview/me/route.ts#L47) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/overview/replies-waiting/route.ts:64](../../../app/api/admin/overview/replies-waiting/route.ts#L64) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/overview/route.ts:35](../../../app/api/admin/overview/route.ts#L35) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/overview/wire/route.ts:34](../../../app/api/admin/overview/wire/route.ts#L34) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/pipeline/capacity/route.ts:35](../../../app/api/admin/pipeline/capacity/route.ts#L35) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| POST [app/api/admin/pipeline/seed/route.ts:17](../../../app/api/admin/pipeline/seed/route.ts#L17) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| DELETE [app/api/admin/pipeline/stages/[id]/route.ts:18](../../../app/api/admin/pipeline/stages/[id]/route.ts#L18) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| GET [app/api/admin/pipeline/stages/route.ts:43](../../../app/api/admin/pipeline/stages/route.ts#L43) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| POST [app/api/admin/pipeline/stages/route.ts:144](../../../app/api/admin/pipeline/stages/route.ts#L144) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| PUT [app/api/admin/pipeline/stages/route.ts:211](../../../app/api/admin/pipeline/stages/route.ts#L211) | Requires deals; capacity work and historical stage statistics follow caller scope before aggregation. |
| PATCH [app/api/admin/planned-roles/[id]/route.ts:15](../../../app/api/admin/planned-roles/[id]/route.ts#L15) | Added missing feature/admin check or organisation SQL fence. |
| DELETE [app/api/admin/planned-roles/[id]/route.ts:57](../../../app/api/admin/planned-roles/[id]/route.ts#L57) | Added missing feature/admin check or organisation SQL fence. |
| GET [app/api/admin/planned-roles/route.ts:11](../../../app/api/admin/planned-roles/route.ts#L11) | Added missing feature/admin check or organisation SQL fence. |
| POST [app/api/admin/planned-roles/route.ts:30](../../../app/api/admin/planned-roles/route.ts#L30) | Added missing feature/admin check or organisation SQL fence. |
| GET [app/api/admin/reports/ai-cost/route.ts:40](../../../app/api/admin/reports/ai-cost/route.ts#L40) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/reports/billing-summary/route.ts:11](../../../app/api/admin/reports/billing-summary/route.ts#L11) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/reports/cash-flow-forecast/route.ts:41](../../../app/api/admin/reports/cash-flow-forecast/route.ts#L41) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| GET [app/api/admin/reports/client-profitability/route.ts:28](../../../app/api/admin/reports/client-profitability/route.ts#L28) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/reports/invoice-aging/route.ts:39](../../../app/api/admin/reports/invoice-aging/route.ts#L39) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/reports/response-time/route.ts:10](../../../app/api/admin/reports/response-time/route.ts#L10) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| POST [app/api/admin/reports/retainer-alerts/route.ts:30](../../../app/api/admin/reports/retainer-alerts/route.ts#L30) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/reports/retainer-health/route.ts:31](../../../app/api/admin/reports/retainer-health/route.ts#L31) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/reports/sales/route.ts:14](../../../app/api/admin/reports/sales/route.ts#L14) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| GET [app/api/admin/reports/utilization/route.ts:36](../../../app/api/admin/reports/utilization/route.ts#L36) | Added owning feature/target-org guard and SQL organisation filters before reads, aggregates and LIMIT. |
| DELETE [app/api/admin/requests/[id]/blockers/[linkId]/route.ts:8](../../../app/api/admin/requests/[id]/blockers/[linkId]/route.ts#L8) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/blockers/route.ts:17](../../../app/api/admin/requests/[id]/blockers/route.ts#L17) | Adds owning feature gate and redacts far-end metadata denied by the tasks feature or client scope |
| POST [app/api/admin/requests/[id]/blockers/route.ts:35](../../../app/api/admin/requests/[id]/blockers/route.ts#L35) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/calls/route.ts:38](../../../app/api/admin/requests/[id]/calls/route.ts#L38) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/calls/route.ts:55](../../../app/api/admin/requests/[id]/calls/route.ts#L55) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/draft-reply/route.ts:84](../../../app/api/admin/requests/[id]/draft-reply/route.ts#L84) | Adds requests feature guard and filters message row org before LIMIT and before AI context reads |
| POST [app/api/admin/requests/[id]/duplicate/route.ts:25](../../../app/api/admin/requests/[id]/duplicate/route.ts#L25) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/files/route.ts:34](../../../app/api/admin/requests/[id]/files/route.ts#L34) | Adds requests feature guard and SQL row-org filter independently of stored request parent before reading filenames or storage keys |
| POST [app/api/admin/requests/[id]/files/route.ts:82](../../../app/api/admin/requests/[id]/files/route.ts#L82) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/handoff/route.ts:93](../../../app/api/admin/requests/[id]/handoff/route.ts#L93) | Adds owning feature guard before business data |
| DELETE [app/api/admin/requests/[id]/handoff/route.ts:128](../../../app/api/admin/requests/[id]/handoff/route.ts#L128) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/messages/route.ts:23](../../../app/api/admin/requests/[id]/messages/route.ts#L23) | Adds owning requests feature and independent SQL org filters on message rows, attached file rows and linked conversations before metadata reads |
| POST [app/api/admin/requests/[id]/messages/route.ts:135](../../../app/api/admin/requests/[id]/messages/route.ts#L135) | Adds requests feature guard and checks supplied conversation exists, is permitted and matches the authorized request/client before insertion |
| POST [app/api/admin/requests/[id]/nest/route.ts:32](../../../app/api/admin/requests/[id]/nest/route.ts#L32) | Adds owning feature guard before business data |
| DELETE [app/api/admin/requests/[id]/participants/[participantId]/route.ts:22](../../../app/api/admin/requests/[id]/participants/[participantId]/route.ts#L22) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/participants/route.ts:50](../../../app/api/admin/requests/[id]/participants/route.ts#L50) | Adds requests feature guard and reads contact metadata only from the request client |
| POST [app/api/admin/requests/[id]/participants/route.ts:105](../../../app/api/admin/requests/[id]/participants/route.ts#L105) | Adds requests feature guard and validates contact target scope and matching request client before any mutation |
| GET [app/api/admin/requests/[id]/reads/route.ts:83](../../../app/api/admin/requests/[id]/reads/route.ts#L83) | Adds requests feature guard and restricts contact-name lookup to the authorized request client |
| POST [app/api/admin/requests/[id]/reads/route.ts:30](../../../app/api/admin/requests/[id]/reads/route.ts#L30) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/route.ts:21](../../../app/api/admin/requests/[id]/route.ts#L21) | Adds requests feature guard and filters participant contacts, parent/child requests and handoff contact metadata to the owning client |
| PATCH [app/api/admin/requests/[id]/route.ts:221](../../../app/api/admin/requests/[id]/route.ts#L221) | Adds owning feature guard before business data |
| DELETE [app/api/admin/requests/[id]/route.ts:249](../../../app/api/admin/requests/[id]/route.ts#L249) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/scope-flag/route.ts:22](../../../app/api/admin/requests/[id]/scope-flag/route.ts#L22) | Adds owning feature guard before business data |
| DELETE [app/api/admin/requests/[id]/scope-flag/route.ts:55](../../../app/api/admin/requests/[id]/scope-flag/route.ts#L55) | Adds owning feature guard before business data |
| PATCH [app/api/admin/requests/[id]/steps/[stepId]/route.ts:32](../../../app/api/admin/requests/[id]/steps/[stepId]/route.ts#L32) | Adds requests feature guard and refuses parentStepId outside the authorized request before update |
| DELETE [app/api/admin/requests/[id]/steps/[stepId]/route.ts:83](../../../app/api/admin/requests/[id]/steps/[stepId]/route.ts#L83) | Adds requests feature guard and keeps every recursive child read/delete inside the authorized request |
| GET [app/api/admin/requests/[id]/steps/route.ts:34](../../../app/api/admin/requests/[id]/steps/route.ts#L34) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/steps/route.ts:59](../../../app/api/admin/requests/[id]/steps/route.ts#L59) | Adds requests feature guard and refuses parentStepId outside the authorized request before insertion |
| PATCH [app/api/admin/requests/[id]/sub-requests/reorder/route.ts:22](../../../app/api/admin/requests/[id]/sub-requests/reorder/route.ts#L22) | Adds requests feature guard and requires both stored parent id and owning client on child updates |
| GET [app/api/admin/requests/[id]/sub-requests/route.ts:26](../../../app/api/admin/requests/[id]/sub-requests/route.ts#L26) | Adds requests feature guard and filters child request orgs as well as parent id before returning titles |
| POST [app/api/admin/requests/[id]/sub-requests/route.ts:69](../../../app/api/admin/requests/[id]/sub-requests/route.ts#L69) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/time-entries/route.ts:53](../../../app/api/admin/requests/[id]/time-entries/route.ts#L53) | Adds requests feature guard and scopedOrgIds SQL row-org filter after parent authorization |
| POST [app/api/admin/requests/[id]/time-entries/route.ts:92](../../../app/api/admin/requests/[id]/time-entries/route.ts#L92) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/[id]/triage/route.ts:115](../../../app/api/admin/requests/[id]/triage/route.ts#L115) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/[id]/voice-notes/route.ts:31](../../../app/api/admin/requests/[id]/voice-notes/route.ts#L31) | Adds requests feature guard and filters owning message org before reading inherited voice-note data |
| POST [app/api/admin/requests/[id]/voice-notes/route.ts:73](../../../app/api/admin/requests/[id]/voice-notes/route.ts#L73) | Adds requests feature guard and checks both request id and scoped message row org before adding a voice note |
| POST [app/api/admin/requests/bulk-assign/route.ts:43](../../../app/api/admin/requests/bulk-assign/route.ts#L43) | Adds requests feature guard, validates every contact scope before mutations and skips cross-client contact attachments |
| POST [app/api/admin/requests/bulk/route.ts:110](../../../app/api/admin/requests/bulk/route.ts#L110) | Adds owning feature guard before business data |
| PATCH [app/api/admin/requests/bulk/route.ts:237](../../../app/api/admin/requests/bulk/route.ts#L237) | Adds owning feature guard before business data |
| GET [app/api/admin/requests/route.ts:14](../../../app/api/admin/requests/route.ts#L14) | Adds owning feature guard before business data |
| POST [app/api/admin/requests/route.ts:180](../../../app/api/admin/requests/route.ts#L180) | Adds owning feature guard before business data |
| POST [app/api/admin/reviews/outreach/route.ts:13](../../../app/api/admin/reviews/outreach/route.ts#L13) | Requires reviews, scopes lists/outreach SQL, and checks the write target org. |
| GET [app/api/admin/reviews/route.ts:14](../../../app/api/admin/reviews/route.ts#L14) | Requires reviews, scopes lists/outreach SQL, and checks the write target org. |
| POST [app/api/admin/reviews/route.ts:87](../../../app/api/admin/reviews/route.ts#L87) | Requires reviews, scopes lists/outreach SQL, and checks the write target org. |
| POST [app/api/admin/seed/route.ts:14](../../../app/api/admin/seed/route.ts#L14) | Added resolved admin role for full-workspace operation; existing feature and stronger guards retained. |
| PATCH [app/api/admin/services/[id]/route.ts:26](../../../app/api/admin/services/[id]/route.ts#L26) | Requires the billing feature and retains both current/destination client ownership checks. |
| GET [app/api/admin/services/coupons/route.ts:31](../../../app/api/admin/services/coupons/route.ts#L31) | Requires the billing feature and retains both current/destination client ownership checks. |
| POST [app/api/admin/services/coupons/route.ts:56](../../../app/api/admin/services/coupons/route.ts#L56) | Requires the billing feature and retains both current/destination client ownership checks. |
| DELETE [app/api/admin/services/coupons/route.ts:116](../../../app/api/admin/services/coupons/route.ts#L116) | Requires the billing feature and retains both current/destination client ownership checks. |
| GET [app/api/admin/services/route.ts:27](../../../app/api/admin/services/route.ts#L27) | Requires the billing feature and retains both current/destination client ownership checks. |
| POST [app/api/admin/services/route.ts:83](../../../app/api/admin/services/route.ts#L83) | Requires the billing feature and retains both current/destination client ownership checks. |
| GET [app/api/admin/settings/route.ts:81](../../../app/api/admin/settings/route.ts#L81) | Added settings feature and resolved admin role before reading or writing workspace settings; super-admin email-widening guard retained. |
| PATCH [app/api/admin/settings/route.ts:137](../../../app/api/admin/settings/route.ts#L137) | Added settings feature and resolved admin role before reading or writing workspace settings; super-admin email-widening guard retained. |
| POST [app/api/admin/subscriptions/[id]/change-cycle/route.ts:19](../../../app/api/admin/subscriptions/[id]/change-cycle/route.ts#L19) | Filters index by client scope or checks stored subscription client before return or mutation |
| GET [app/api/admin/subscriptions/[id]/route.ts:24](../../../app/api/admin/subscriptions/[id]/route.ts#L24) | Filters index by client scope or checks stored subscription client before return or mutation |
| PUT [app/api/admin/subscriptions/[id]/route.ts:90](../../../app/api/admin/subscriptions/[id]/route.ts#L90) | Filters index by client scope or checks stored subscription client before return or mutation |
| DELETE [app/api/admin/subscriptions/[id]/route.ts:202](../../../app/api/admin/subscriptions/[id]/route.ts#L202) | Filters index by client scope or checks stored subscription client before return or mutation |
| GET [app/api/admin/subscriptions/route.ts:15](../../../app/api/admin/subscriptions/route.ts#L15) | Filters index by client scope or checks stored subscription client before return or mutation |
| PATCH [app/api/admin/task-templates/[id]/route.ts:10](../../../app/api/admin/task-templates/[id]/route.ts#L10) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| DELETE [app/api/admin/task-templates/[id]/route.ts:94](../../../app/api/admin/task-templates/[id]/route.ts#L94) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/task-templates/route.ts:19](../../../app/api/admin/task-templates/route.ts#L19) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| POST [app/api/admin/task-templates/route.ts:71](../../../app/api/admin/task-templates/route.ts#L71) | Adds owning feature guard before business data; Checks every per-client query, stored target and destination before reads or writes |
| GET [app/api/admin/tasks/[id]/blockers/route.ts:13](../../../app/api/admin/tasks/[id]/blockers/route.ts#L13) | Redacts denied-feature far-end title, request reference and client name without reading forbidden detail columns |
| GET [app/api/admin/tasks/[id]/calls/route.ts:19](../../../app/api/admin/tasks/[id]/calls/route.ts#L19) | Checks all stored call parents through scoped listCallsForParent |
| GET [app/api/admin/tasks/[id]/dependencies/route.ts:35](../../../app/api/admin/tasks/[id]/dependencies/route.ts#L35) | Redacts denied-feature far-end title, request reference and client name through listBlockers |
| POST [app/api/admin/tasks/from-template/route.ts:24](../../../app/api/admin/tasks/from-template/route.ts#L24) | Checks the source template client as well as the destination client |
| GET [app/api/admin/team/[id]/access/route.ts:13](../../../app/api/admin/team/[id]/access/route.ts#L13) | Added canManagePermissions guard to read and replace permission rules; existing settings.permissions write feature retained. |
| PUT [app/api/admin/team/[id]/access/route.ts:57](../../../app/api/admin/team/[id]/access/route.ts#L57) | Added canManagePermissions guard to read and replace permission rules; existing settings.permissions write feature retained. |
| GET [app/api/admin/team/org-chart/route.ts:9](../../../app/api/admin/team/org-chart/route.ts#L9) | Added missing feature/admin check or organisation SQL fence. |
| GET [app/api/admin/time-entries/route.ts:61](../../../app/api/admin/time-entries/route.ts#L61) | Adds time feature guard and SQL row-org filter after target authorization, including internal-task hours convention |
| POST [app/api/admin/time-entries/route.ts:132](../../../app/api/admin/time-entries/route.ts#L132) | Adds owning feature guard before business data |
| DELETE [app/api/admin/time/[id]/route.ts:11](../../../app/api/admin/time/[id]/route.ts#L11) | Adds owning feature guard before business data |
| GET [app/api/admin/time/route.ts:22](../../../app/api/admin/time/route.ts#L22) | Adds owning feature guard before business data |
| POST [app/api/admin/time/route.ts:154](../../../app/api/admin/time/route.ts#L154) | Adds owning feature guard before business data |
| POST [app/api/admin/time/stamp-invoiced/route.ts:76](../../../app/api/admin/time/stamp-invoiced/route.ts#L76) | Checks explicit org and filters stamp candidates in SQL before returning or updating |
| PATCH [app/api/admin/timers/[id]/route.ts:27](../../../app/api/admin/timers/[id]/route.ts#L27) | Checks authenticated caller client scope independently of timer owner attribution; preserves service and real-admin orphan timer access |
| DELETE [app/api/admin/timers/[id]/route.ts:97](../../../app/api/admin/timers/[id]/route.ts#L97) | Checks authenticated caller client scope independently of timer owner attribution; preserves service and real-admin orphan timer access |
| POST [app/api/admin/timers/ping/route.ts:22](../../../app/api/admin/timers/ping/route.ts#L22) | Checks authenticated caller client scope independently of timer owner attribution; preserves service and real-admin orphan timer access |
| GET [app/api/admin/timers/route.ts:34](../../../app/api/admin/timers/route.ts#L34) | Checks authenticated caller client scope independently of timer owner attribution; preserves service and real-admin orphan timer access |
| POST [app/api/admin/timers/route.ts:99](../../../app/api/admin/timers/route.ts#L99) | Checks authenticated caller client scope independently of timer owner attribution; preserves service and real-admin orphan timer access |
| GET [app/api/admin/views/route.ts:15](../../../app/api/admin/views/route.ts#L15) | Checks owning artifact feature and stored org before analytics query; refuses unknown kinds |
| GET [app/api/admin/views/sections/route.ts:19](../../../app/api/admin/views/sections/route.ts#L19) | Checks owning artifact feature and stored org before analytics query; refuses unknown kinds |

| Shared helper | Purpose |
| --- | --- |
| [lib/require-admin.ts:1](../../../lib/require-admin.ts#L1) | Full-workspace role guard, verified service first. |
| [lib/internal-route-access.ts:1](../../../lib/internal-route-access.ts#L1) | Mixed-source feature/owner SQL fences, including messages and current timer parents. |
| [lib/cron-runs.ts:1](../../../lib/cron-runs.ts#L1) | Shared auth accepts authenticated studio sessions and verified scheduler secrets. Manual workspace routes retain admin guards; scoped counts-only digest runs remain allowed. |
| [lib/require-admin-resource.ts:1](../../../lib/require-admin-resource.ts#L1) | View analytics inherit contract/proposal/schedule feature and owner. |
| [lib/timer-access.ts:1](../../../lib/timer-access.ts#L1) | Current timer targets checked independently of recorded ownership; admins/service keep orphan disposal. |
| [lib/discovery-call-access.ts:1](../../../lib/discovery-call-access.ts#L1) | All polymorphic call parents checked before LIMIT and content. |
| [lib/contact-access.ts:1](../../../lib/contact-access.ts#L1) | Linked contact owner guard and list predicate. |
| [lib/calculation-access.ts:1](../../../lib/calculation-access.ts#L1) | Calculation source/target ownership and scoped estimators. |
| [lib/reply-draft-access.ts:1](../../../lib/reply-draft-access.ts#L1) | Reply source feature and invoice ownership, with privileged preservation. |
| [lib/route-org-filter.ts:1](../../../lib/route-org-filter.ts#L1) | Validated literal scopes avoid accumulated binds and SQL input injection. |
| [lib/calls.ts:1](../../../lib/calls.ts#L1) | Nested call listing takes authenticated scope. |
| [lib/blockers-server.ts:1](../../../lib/blockers-server.ts#L1) | Far-end blockers redact denied features and foreign owners. |
| [lib/request-handoff.ts:1](../../../lib/request-handoff.ts#L1) | New contact attachments must match the request org. Existing attached contact names and handoff pointers remain visible. |
| [lib/messages-store.ts:1](../../../lib/messages-store.ts#L1) | Studio row scoping remains. The client-audience message-row filters were reverted, preserving established thread visibility. |

## Original tests and gate evidence at 67594c29 (reviews failed)

- admin-route-guard-walk.test.ts: AST-based walk of every explicit admin HTTP method, checked denial propagation, delegated handlers, valid feature keys, wrapper configuration and resolved role checks. Imports/comments/unchecked guards do not count. New sibling handlers cannot borrow a gate. Exact exceptions must not become stale.
- t1-6-org-routes.test.ts: every repaired org handler is invoked as a denied-feature scoped seat.
- nested-client-scope-sqlite.test.ts: actual Drizzle/D1 SQL and roles prove client filters, permission-management refusal, source/destination links, malformed nested rows, feature redaction, inherited task scope and privileged behavior.
- t1-6-internal-routes.test.ts: real permissions plus per-method denials, manual-job role checks, report/overview SQL, scope withdrawal, malformed messages/timers, scheduler bypass and recorded-actor refusal.
- t1-6-support-routes.test.ts: support/sales feature denials, foreign writes without mutation, all-parent filters before LIMIT, calculation/contact/prediction scope, permission grants and admin/super/service preservation.
- route-org-filter.test.ts: combined large scopes have no scope binds, unsafe SQL/quote IDs fail closed, and org-less work requires an explicit convention.
- Related existing tests retain their business and denial assertions. Legacy membership-only fixtures now specify the intended feature/admin/service permissions; projection queues account for minimal owner reads. Real SQLite security suites use real guards.

Final fail-closed gate passed with exit 0 for every stage:

| Check | Result |
| --- | --- |
| npm run type-check | tsc --noEmit, zero errors |
| CI=1 npm run lint | Zero errors, 79 non-blocking warnings |
| ESLint on scripts/run-vitest-sandbox.mjs | Zero errors or warnings |
| Related Vitest run | Test Files 83 passed (83); Tests 1715 passed (1715), 38.31 seconds |
| Inventory/export reconciliation | 593 exports, no missing or duplicate method rows |
| git diff --check | Passed |

The related run includes all touched test files and tests importing affected routes/helpers. It is not the repository-wide suite or a build/deploy claim. The subsequent regression and security reviews both failed 67594c29. Their repairs are recorded above.

Reproduce the local checks with CI=1 for npm run lint and node scripts/run-vitest-sandbox.mjs followed by the test files listed below. Type-check runs before lint, and a failure stops the remaining stages. The normal esbuild runner and non-CI Next lint attempted child processes blocked by sandbox EPERM. The tracked scripts/run-vitest-sandbox.mjs runs the same Vitest assertions through worker threads and TypeScript transforms; CI=1 skips the Cloudflare dev proxy for npm run lint. No test assertion or production guard is disabled to make the gate pass.

## Intentional exceptions and unchanged behavior

The static guard walk retains 22 exact method/path exceptions. They are not directory allowlists.

| Method/path | Reason |
| --- | --- |
| GET /api/admin/permissions/me | Returns only the authenticated caller's resolved permissions so denied seats can render their navigation. |
| GET /api/admin/mcp/identity | Requires the verified api-service identity; this is the worker's refresh-time profile check. |
| GET /api/admin/activities | activityListWhere applies the clients, deals and leads feature grants and org scope in SQL before LIMIT. |
| GET /api/admin/ai/briefing/cron | Scheduler diagnostics require a constant-time validated cron secret; no browser seat bypass exists. |
| POST /api/admin/ai/briefing/cron | Scheduled briefing generation requires a constant-time validated cron secret; no browser seat bypass exists. |
| GET /api/admin/cron/draft-approved-ideas | Retired endpoint returns a constant HTTP 410 response without reading or writing data. |
| POST /api/admin/cron/draft-approved-ideas | Retired endpoint returns a constant HTTP 410 response without reading or writing data. |
| POST /api/admin/docs/seed | A server-only CLI seed secret is the alternate identity; browser callers must pass the docs feature gate. |
| GET /api/admin/impersonate/exit | Clears only this browser's preview cookies; an exit hatch must always remain available. |
| POST /api/admin/impersonate/exit | Clears only this browser's preview cookies; an exit hatch must always remain available. |
| GET /api/admin/impersonate/mode | Reads this browser's mode and recomputes its super-admin acting eligibility; no client data is returned. |
| POST /api/admin/impersonate/mode | Disarming is always allowed; entering act mode requires resolveActEligibility to prove the super-admin role. |
| GET /api/admin/integrations/google/callback | Public OAuth return consumes a single-use state nonce minted by the guarded integration start endpoint. |
| GET /api/admin/integrations/xero/callback | Public OAuth return consumes a single-use state nonce minted by the guarded integration connect endpoint. |
| GET /api/admin/notifications | Authenticated studio callers read only their own notification preferences, scoped by auth.userId. |
| PATCH /api/admin/notifications | Authenticated studio callers update only their own notification preferences, scoped by auth.userId. |
| GET /api/admin/profile | Authenticated studio callers read only their own roster profile, resolved from their authenticated identity. |
| PATCH /api/admin/profile | Authenticated studio callers edit only their own permitted profile fields; role and access fields are not writable. |
| GET /api/admin/search | Every result group checks its own feature grant and org fence; a single feature would hide otherwise allowed groups. |
| POST /api/admin/team/accept-invite | Joining a seat requires a verified email bound to an expiring invite token claimed atomically once. |
| GET /api/admin/team | The team feature gates employment details; other studio seats receive only the intentional lite picker projection. |
| GET /api/admin/team-members | Intentional lite roster projection for assignment and mention pickers, authenticated studio seats only. |

Three conditional helper modules are explicitly reviewed in the test: activity-access (per linked source feature), reply-draft-access (per draft source) and recorder-devices (actual admin context). Sitemap keeps its stronger founder-email allowlist and verified service bypass. Existing sales artifact templates remain studio-global; snapshots copied from client artifacts stay behind the source-owner guard. Org-less studio tasks/pre-client links retain their established access conventions rather than acquiring a fictitious client owner.

No UI, schema, worker tool catalog, email policy, consent profile or production record was changed. This is an uncommitted access repair with local proof. Live scoped-seat/browser proof and merge/deploy gates remain for the integrating batch; this document does not claim production completion.

## Full method inventory

| Handler | Before | After | Feature/role gate | Org or intentional internal scope |
| --- | --- | --- | --- | --- |
| PATCH [app/api/admin/activities/[id]/route.ts:15](../../../app/api/admin/activities/[id]/route.ts#L15) | A | A | requireActivityLinks and activityListWhere | requireActivityLinks |
| DELETE [app/api/admin/activities/[id]/route.ts:72](../../../app/api/admin/activities/[id]/route.ts#L72) | A | A | requireActivityLinks and activityListWhere | requireActivityLinks |
| GET [app/api/admin/activities/route.ts:11](../../../app/api/admin/activities/route.ts#L11) | A | A | requireActivityLinks and activityListWhere | requireActivityLinks, activityListWhere |
| POST [app/api/admin/activities/route.ts:65](../../../app/api/admin/activities/route.ts#L65) | A | A | requireActivityLinks and activityListWhere | requireActivityLinks |
| PATCH [app/api/admin/ai-reply-drafts/[id]/route.ts:23](../../../app/api/admin/ai-reply-drafts/[id]/route.ts#L23) | C | A | requireReplyDraftAccess (per-source feature + scope, true admin/service bypass) | requireReplyDraftAccess |
| DELETE [app/api/admin/ai-reply-drafts/[id]/route.ts:53](../../../app/api/admin/ai-reply-drafts/[id]/route.ts#L53) | C | A | requireReplyDraftAccess (per-source feature + scope, true admin/service bypass) | requireReplyDraftAccess |
| POST [app/api/admin/ai-reply-drafts/[id]/send/route.ts:34](../../../app/api/admin/ai-reply-drafts/[id]/send/route.ts#L34) | C | A | requireReplyDraftAccess (per-source feature + scope, true admin/service bypass) | requireReplyDraftAccess |
| GET [app/api/admin/ai/briefing/cron/route.ts:150](../../../app/api/admin/ai/briefing/cron/route.ts#L150) | B | B | hasCronSecretAuth (verified scheduler only) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/ai/briefing/cron/route.ts:56](../../../app/api/admin/ai/briefing/cron/route.ts#L56) | B | B | hasCronSecretAuth (verified scheduler only) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/ai/briefing/route.ts:14](../../../app/api/admin/ai/briefing/route.ts#L14) | C | B | requireFeature: overview; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/ai/briefing/route.ts:48](../../../app/api/admin/ai/briefing/route.ts#L48) | C | B | requireFeature: overview; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/ai/predict-fields/route.ts:619](../../../app/api/admin/ai/predict-fields/route.ts#L619) | C | A | requireFeature: subject tasks/requests | requireAccessToOrg, scopedOrgIds |
| POST [app/api/admin/ai/request-wizard/route.ts:381](../../../app/api/admin/ai/request-wizard/route.ts#L381) | A | A | requireFeature: requests; tasks context independently gated | requireAccessToOrg |
| POST [app/api/admin/ai/task-wizard/route.ts:644](../../../app/api/admin/ai/task-wizard/route.ts#L644) | C | A | requireFeature: tasks | requireAccessToOrg |
| PATCH [app/api/admin/announcements/[id]/route.ts:20](../../../app/api/admin/announcements/[id]/route.ts#L20) | C | A | requireFeature: announcements | scopedOrgIds |
| DELETE [app/api/admin/announcements/[id]/route.ts:158](../../../app/api/admin/announcements/[id]/route.ts#L158) | C | A | requireFeature: announcements | scopedOrgIds |
| POST [app/api/admin/announcements/[id]/send/route.ts:21](../../../app/api/admin/announcements/[id]/send/route.ts#L21) | C | A | requireFeature: announcements | scopedOrgIds |
| GET [app/api/admin/announcements/route.ts:19](../../../app/api/admin/announcements/route.ts#L19) | C | A | requireFeature: announcements | scopedOrgIds |
| POST [app/api/admin/announcements/route.ts:63](../../../app/api/admin/announcements/route.ts#L63) | C | A | requireFeature: announcements | scopedOrgIds |
| GET [app/api/admin/audit/route.ts:18](../../../app/api/admin/audit/route.ts#L18) | B | B | canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PATCH [app/api/admin/automations/[id]/route.ts:12](../../../app/api/admin/automations/[id]/route.ts#L12) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/automations/[id]/route.ts:61](../../../app/api/admin/automations/[id]/route.ts#L61) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/automations/log/route.ts:11](../../../app/api/admin/automations/log/route.ts#L11) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/automations/route.ts:10](../../../app/api/admin/automations/route.ts#L10) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/automations/route.ts:31](../../../app/api/admin/automations/route.ts#L31) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/billing/financial-health/route.ts:23](../../../app/api/admin/billing/financial-health/route.ts#L23) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/billing/monthly-email/route.ts:24](../../../app/api/admin/billing/monthly-email/route.ts#L24) | B | B | requireFeature: billing; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/billing/xero-export/route.ts:50](../../../app/api/admin/billing/xero-export/route.ts#L50) | B | B | requireFeature: billing; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/blockers/search/route.ts:12](../../../app/api/admin/blockers/search/route.ts#L12) | C | A | requireFeature tasks OR requests, denied types filtered by can(resolvePermissions) | Shared write library validates destination org; no existing client for client creation; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| GET [app/api/admin/brands/[id]/route.ts:12](../../../app/api/admin/brands/[id]/route.ts#L12) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| PATCH [app/api/admin/brands/[id]/route.ts:74](../../../app/api/admin/brands/[id]/route.ts#L74) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| DELETE [app/api/admin/brands/[id]/route.ts:137](../../../app/api/admin/brands/[id]/route.ts#L137) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/brands/route.ts:12](../../../app/api/admin/brands/route.ts#L12) | C | A | requireFeature({ userId, orgId }, 'clients') | scopedOrgIds, resolveAccessScoping |
| POST [app/api/admin/brands/route.ts:76](../../../app/api/admin/brands/route.ts#L76) | A | A | requireFeature(auth, 'clients') | requireAccessToOrg |
| POST [app/api/admin/calculator/draft/route.ts:21](../../../app/api/admin/calculator/draft/route.ts#L21) | C | A | requireFeature: calculator | requireCalculationAccess |
| GET [app/api/admin/calculator/route.ts:22](../../../app/api/admin/calculator/route.ts#L22) | C | A | requireFeature: calculator | scopedOrgIds, calculationScopeCondition |
| POST [app/api/admin/calculator/route.ts:51](../../../app/api/admin/calculator/route.ts#L51) | C | A | requireFeature: calculator | requireCalculationTarget, scopedOrgIds |
| PATCH [app/api/admin/calculator/route.ts:203](../../../app/api/admin/calculator/route.ts#L203) | C | A | requireFeature: calculator | requireCalculationAccess, scopedOrgIds |
| DELETE [app/api/admin/calculator/route.ts:244](../../../app/api/admin/calculator/route.ts#L244) | C | A | requireFeature: calculator | requireCalculationAccess |
| GET [app/api/admin/call-transcripts/[id]/route.ts:97](../../../app/api/admin/call-transcripts/[id]/route.ts#L97) | C | A | requireFeature({ userId, orgId }, 'calls') | Stored source and target call/recording org scopes; discoveryCallScopeCondition before list LIMIT |
| PATCH [app/api/admin/call-transcripts/[id]/route.ts:122](../../../app/api/admin/call-transcripts/[id]/route.ts#L122) | C | A | requireFeature({ userId, orgId }, 'calls') | Stored source and target call/recording org scopes; discoveryCallScopeCondition before list LIMIT |
| GET [app/api/admin/call-transcripts/calls/route.ts:40](../../../app/api/admin/call-transcripts/calls/route.ts#L40) | C | A | requireFeature({ userId, orgId }, 'calls') | Stored source and target call/recording org scopes; discoveryCallScopeCondition before list LIMIT |
| GET [app/api/admin/call-transcripts/route.ts:38](../../../app/api/admin/call-transcripts/route.ts#L38) | C | A | requireFeature({ userId, orgId }, 'calls'); requireFeature({ userId, orgId }, 'calls') | Stored source and target call/recording org scopes; discoveryCallScopeCondition before list LIMIT |
| PATCH [app/api/admin/calls/[id]/route.ts:29](../../../app/api/admin/calls/[id]/route.ts#L29) | C | A | requireFeature({ userId, orgId }, 'calls') | requireAccessToOrg |
| GET [app/api/admin/calls/index/route.ts:25](../../../app/api/admin/calls/index/route.ts#L25) | C | A | requireFeature({ userId, orgId }, 'calls') | scopedOrgIds |
| POST [app/api/admin/calls/normalize-times/route.ts:52](../../../app/api/admin/calls/normalize-times/route.ts#L52) | C | B | requireFeature({ userId, orgId }, 'calls'); requireStudioAdmin({ userId, orgId }, 'calls') | Workspace-wide internal data; no client owner |
| GET [app/api/admin/calls/route.ts:14](../../../app/api/admin/calls/route.ts#L14) | C | A | requireFeature({ userId, orgId }, 'calls') | scopedOrgIds |
| POST [app/api/admin/calls/route.ts:90](../../../app/api/admin/calls/route.ts#L90) | C | A | requireFeature({ userId, orgId }, 'calls') | requireAccessToOrg |
| GET [app/api/admin/capacity/forecast/route.ts:13](../../../app/api/admin/capacity/forecast/route.ts#L13) | C | A | requireFeature: capacity | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/capacity/route.ts:22](../../../app/api/admin/capacity/route.ts#L22) | C | A | requireFeature: capacity | Target organisation checked with requireAccessToOrg before business reads or writes. |
| PATCH [app/api/admin/capacity/route.ts:152](../../../app/api/admin/capacity/route.ts#L152) | C | A | requireFeature: capacity | Target organisation checked with requireAccessToOrg before business reads or writes. |
| POST [app/api/admin/capacity/start-date/route.ts:27](../../../app/api/admin/capacity/start-date/route.ts#L27) | C | A | requireFeature: capacity | Org SQL filters before reads, aggregations and LIMIT. |
| POST [app/api/admin/case-studies/draft/route.ts:12](../../../app/api/admin/case-studies/draft/route.ts#L12) | C | A | requireFeature: reviews | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/auto-derive/route.ts:23](../../../app/api/admin/clients/[id]/auto-derive/route.ts#L23) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/clients/[id]/calls/route.ts:20](../../../app/api/admin/clients/[id]/calls/route.ts#L20) | C | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg, listCallsForParent |
| POST [app/api/admin/clients/[id]/calls/route.ts:35](../../../app/api/admin/clients/[id]/calls/route.ts#L35) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/clients/[id]/contacts/route.ts:13](../../../app/api/admin/clients/[id]/contacts/route.ts#L13) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/contacts/route.ts:38](../../../app/api/admin/clients/[id]/contacts/route.ts#L38) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| PATCH [app/api/admin/clients/[id]/costs/[costId]/route.ts:20](../../../app/api/admin/clients/[id]/costs/[costId]/route.ts#L20) | A | A | requireFeature({ userId, orgId: authOrgId }, 'clients.billing_card') | requireAccessToOrg |
| DELETE [app/api/admin/clients/[id]/costs/[costId]/route.ts:58](../../../app/api/admin/clients/[id]/costs/[costId]/route.ts#L58) | A | A | requireFeature({ userId, orgId: authOrgId }, 'clients.billing_card') | requireAccessToOrg |
| GET [app/api/admin/clients/[id]/costs/route.ts:20](../../../app/api/admin/clients/[id]/costs/route.ts#L20) | A | A | requireFeature({ userId, orgId: authOrgId }, 'clients.billing_card') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/costs/route.ts:42](../../../app/api/admin/clients/[id]/costs/route.ts#L42) | A | A | requireFeature({ userId, orgId: authOrgId }, 'clients.billing_card') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/health-summary/route.ts:141](../../../app/api/admin/clients/[id]/health-summary/route.ts#L141) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/merge/route.ts:50](../../../app/api/admin/clients/[id]/merge/route.ts#L50) | A | A | requireFeature(auth, 'clients') | Shared write library validates destination org; no existing client for client creation |
| GET [app/api/admin/clients/[id]/pm/route.ts:14](../../../app/api/admin/clients/[id]/pm/route.ts#L14) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| PUT [app/api/admin/clients/[id]/pm/route.ts:61](../../../app/api/admin/clients/[id]/pm/route.ts#L61) | C | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/clients/[id]/profitability/route.ts:29](../../../app/api/admin/clients/[id]/profitability/route.ts#L29) | A | A | requireFeature({ userId, orgId: authOrgId }, 'clients.billing_card') | requireAccessToOrg |
| GET [app/api/admin/clients/[id]/route.ts:38](../../../app/api/admin/clients/[id]/route.ts#L38) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| PATCH [app/api/admin/clients/[id]/route.ts:271](../../../app/api/admin/clients/[id]/route.ts#L271) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| DELETE [app/api/admin/clients/[id]/route.ts:463](../../../app/api/admin/clients/[id]/route.ts#L463) | A | A | requireFeature(auth, 'clients') | Shared write library validates destination org; no existing client for client creation |
| GET [app/api/admin/clients/[id]/tracks/route.ts:14](../../../app/api/admin/clients/[id]/tracks/route.ts#L14) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/tracks/route.ts:85](../../../app/api/admin/clients/[id]/tracks/route.ts#L85) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| POST [app/api/admin/clients/[id]/welcome-email/route.ts:53](../../../app/api/admin/clients/[id]/welcome-email/route.ts#L53) | A | A | requireFeature(auth, 'clients') | requireAccessToOrg |
| GET [app/api/admin/clients/route.ts:21](../../../app/api/admin/clients/route.ts#L21) | C | A | requireFeature({ userId, orgId }, 'clients') | scopedOrgIds, resolveAccessScoping |
| POST [app/api/admin/clients/route.ts:129](../../../app/api/admin/clients/route.ts#L129) | A | A | requireFeature(auth, 'clients') | Shared write library validates destination org; no existing client for client creation |
| PATCH [app/api/admin/commitments/[id]/route.ts:13](../../../app/api/admin/commitments/[id]/route.ts#L13) | B | B | requireFeature({ userId, orgId }, 'financial_reports') | Workspace-wide internal data; no client owner |
| DELETE [app/api/admin/commitments/[id]/route.ts:59](../../../app/api/admin/commitments/[id]/route.ts#L59) | B | B | requireFeature({ userId, orgId }, 'financial_reports') | Workspace-wide internal data; no client owner |
| POST [app/api/admin/commitments/auto-detect-cadence/route.ts:101](../../../app/api/admin/commitments/auto-detect-cadence/route.ts#L101) | B | B | requireFeature({ userId, orgId }, 'financial_reports') | Workspace-wide internal data; no client owner |
| GET [app/api/admin/commitments/route.ts:20](../../../app/api/admin/commitments/route.ts#L20) | B | B | requireFeature({ userId, orgId }, 'financial_reports') | Workspace-wide internal data; no client owner |
| POST [app/api/admin/commitments/route.ts:41](../../../app/api/admin/commitments/route.ts#L41) | B | B | requireFeature({ userId, orgId }, 'financial_reports') | Workspace-wide internal data; no client owner |
| POST [app/api/admin/contacts/[id]/merge/route.ts:32](../../../app/api/admin/contacts/[id]/merge/route.ts#L32) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/contacts/[id]/references/route.ts:22](../../../app/api/admin/contacts/[id]/references/route.ts#L22) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| GET [app/api/admin/contacts/[id]/route.ts:29](../../../app/api/admin/contacts/[id]/route.ts#L29) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| PATCH [app/api/admin/contacts/[id]/route.ts:169](../../../app/api/admin/contacts/[id]/route.ts#L169) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| DELETE [app/api/admin/contacts/[id]/route.ts:343](../../../app/api/admin/contacts/[id]/route.ts#L343) | A | A | requireFeature({ userId, orgId }, 'clients') | requireAccessToOrg |
| POST [app/api/admin/content/audits/[id]/improve/route.ts:53](../../../app/api/admin/content/audits/[id]/improve/route.ts#L53) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/audits/route.ts:94](../../../app/api/admin/content/audits/route.ts#L94) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/audits/route.ts:120](../../../app/api/admin/content/audits/route.ts#L120) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/backfill-settings/route.ts:71](../../../app/api/admin/content/backfill-settings/route.ts#L71) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/backfill-settings/route.ts:80](../../../app/api/admin/content/backfill-settings/route.ts#L80) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/backfill/process/route.ts:227](../../../app/api/admin/content/backfill/process/route.ts#L227) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/backfill/runs/[runId]/route.ts:42](../../../app/api/admin/content/backfill/runs/[runId]/route.ts#L42) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/backfill/runs/route.ts:43](../../../app/api/admin/content/backfill/runs/route.ts#L43) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/backfill/start/route.ts:70](../../../app/api/admin/content/backfill/start/route.ts#L70) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/bulk-backfill/route.ts:53](../../../app/api/admin/content/bulk-backfill/route.ts#L53) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/clusters/route.ts:23](../../../app/api/admin/content/clusters/route.ts#L23) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/clusters/seed/route.ts:22](../../../app/api/admin/content/clusters/seed/route.ts#L22) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| PATCH [app/api/admin/content/conflicts/[id]/route.ts:32](../../../app/api/admin/content/conflicts/[id]/route.ts#L32) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/cover/generate/route.ts:55](../../../app/api/admin/content/cover/generate/route.ts#L55) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/cover/preview/route.ts:48](../../../app/api/admin/content/cover/preview/route.ts#L48) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/coverage-audit/route.ts:145](../../../app/api/admin/content/coverage-audit/route.ts#L145) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/advance/route.ts:27](../../../app/api/admin/content/drafts/[id]/advance/route.ts#L27) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/approve-brief/route.ts:22](../../../app/api/admin/content/drafts/[id]/approve-brief/route.ts#L22) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/force-approve/route.ts:31](../../../app/api/admin/content/drafts/[id]/force-approve/route.ts#L31) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/pause/route.ts:30](../../../app/api/admin/content/drafts/[id]/pause/route.ts#L30) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/drafts/[id]/pipeline/route.ts:43](../../../app/api/admin/content/drafts/[id]/pipeline/route.ts#L43) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/publish/route.ts:72](../../../app/api/admin/content/drafts/[id]/publish/route.ts#L72) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/regenerate-cover/route.ts:30](../../../app/api/admin/content/drafts/[id]/regenerate-cover/route.ts#L30) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/reject-brief/route.ts:22](../../../app/api/admin/content/drafts/[id]/reject-brief/route.ts#L22) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/repair-schema/route.ts:38](../../../app/api/admin/content/drafts/[id]/repair-schema/route.ts#L38) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/restart/route.ts:27](../../../app/api/admin/content/drafts/[id]/restart/route.ts#L27) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/restructure/route.ts:36](../../../app/api/admin/content/drafts/[id]/restructure/route.ts#L36) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/resume/route.ts:22](../../../app/api/admin/content/drafts/[id]/resume/route.ts#L22) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/retry/route.ts:31](../../../app/api/admin/content/drafts/[id]/retry/route.ts#L31) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/drafts/[id]/route.ts:29](../../../app/api/admin/content/drafts/[id]/route.ts#L29) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| DELETE [app/api/admin/content/drafts/[id]/route.ts:80](../../../app/api/admin/content/drafts/[id]/route.ts#L80) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/send-to-staci/route.ts:41](../../../app/api/admin/content/drafts/[id]/send-to-staci/route.ts#L41) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/set-cover/route.ts:22](../../../app/api/admin/content/drafts/[id]/set-cover/route.ts#L22) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/[id]/suggest-edits/route.ts:31](../../../app/api/admin/content/drafts/[id]/suggest-edits/route.ts#L31) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/drafts/recompute-bucket-scores/route.ts:45](../../../app/api/admin/content/drafts/recompute-bucket-scores/route.ts#L45) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/drafts/route.ts:27](../../../app/api/admin/content/drafts/route.ts#L27) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/field-audit/route.ts:56](../../../app/api/admin/content/field-audit/route.ts#L56) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/glossary/[id]/audit/route.ts:32](../../../app/api/admin/content/glossary/[id]/audit/route.ts#L32) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/glossary/[id]/backfill/route.ts:30](../../../app/api/admin/content/glossary/[id]/backfill/route.ts#L30) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/glossary/boost-underperformers/route.ts:28](../../../app/api/admin/content/glossary/boost-underperformers/route.ts#L28) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/glossary/boost-underperformers/route.ts:56](../../../app/api/admin/content/glossary/boost-underperformers/route.ts#L56) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/glossary/generate/route.ts:33](../../../app/api/admin/content/glossary/generate/route.ts#L33) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/glossary/index-schema/route.ts:32](../../../app/api/admin/content/glossary/index-schema/route.ts#L32) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/glossary/inspect/route.ts:23](../../../app/api/admin/content/glossary/inspect/route.ts#L23) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/glossary/publish/route.ts:83](../../../app/api/admin/content/glossary/publish/route.ts#L83) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/health/indexnow/route.ts:32](../../../app/api/admin/content/health/indexnow/route.ts#L32) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/health/route.ts:47](../../../app/api/admin/content/health/route.ts#L47) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/health/scan/route.ts:71](../../../app/api/admin/content/health/scan/route.ts#L71) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/health/sitemap/route.ts:76](../../../app/api/admin/content/health/sitemap/route.ts#L76) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/ideas/[id]/round-table/route.ts:31](../../../app/api/admin/content/ideas/[id]/round-table/route.ts#L31) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| PATCH [app/api/admin/content/ideas/[id]/route.ts:35](../../../app/api/admin/content/ideas/[id]/route.ts#L35) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/ideas/manual/route.ts:59](../../../app/api/admin/content/ideas/manual/route.ts#L59) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/ideas/route.ts:32](../../../app/api/admin/content/ideas/route.ts#L32) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/links/[id]/apply/route.ts:42](../../../app/api/admin/content/links/[id]/apply/route.ts#L42) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/links/[id]/reject/route.ts:26](../../../app/api/admin/content/links/[id]/reject/route.ts#L26) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/links/scan/route.ts:118](../../../app/api/admin/content/links/scan/route.ts#L118) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/links/suggestions/route.ts:58](../../../app/api/admin/content/links/suggestions/route.ts#L58) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/posts/[id]/backfill/route.ts:20](../../../app/api/admin/content/posts/[id]/backfill/route.ts#L20) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/posts/[id]/schema/rebuild/route.ts:39](../../../app/api/admin/content/posts/[id]/schema/rebuild/route.ts#L39) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/posts/schema/rebuild-all/route.ts:143](../../../app/api/admin/content/posts/schema/rebuild-all/route.ts#L143) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/schedule/route.ts:35](../../../app/api/admin/content/schedule/route.ts#L35) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/schema/unwrap-existing/route.ts:123](../../../app/api/admin/content/schema/unwrap-existing/route.ts#L123) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/content/scorecards/refresh/route.ts:51](../../../app/api/admin/content/scorecards/refresh/route.ts#L51) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/site-index/route.ts:19](../../../app/api/admin/content/site-index/route.ts#L19) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/spend/route.ts:30](../../../app/api/admin/content/spend/route.ts#L30) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/content/webflow-status/route.ts:21](../../../app/api/admin/content/webflow-status/route.ts#L21) | C | B | requireFeature: content_studio | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/contracts/[id]/email/route.ts:46](../../../app/api/admin/contracts/[id]/email/route.ts#L46) | A | A | requireFeature: contracts | requireContractAccess |
| GET [app/api/admin/contracts/[id]/preview-data/route.ts:19](../../../app/api/admin/contracts/[id]/preview-data/route.ts#L19) | A | A | requireFeature: contracts | requireContractAccess |
| GET [app/api/admin/contracts/[id]/route.ts:14](../../../app/api/admin/contracts/[id]/route.ts#L14) | A | A | requireFeature: contracts | requireArtifactAccess |
| PATCH [app/api/admin/contracts/[id]/route.ts:48](../../../app/api/admin/contracts/[id]/route.ts#L48) | A | A | requireFeature: contracts | requireArtifactAccess |
| DELETE [app/api/admin/contracts/[id]/route.ts:163](../../../app/api/admin/contracts/[id]/route.ts#L163) | A | A | requireFeature: contracts | requireContractAccess |
| POST [app/api/admin/contracts/[id]/send/route.ts:27](../../../app/api/admin/contracts/[id]/send/route.ts#L27) | A | A | requireFeature: contracts | requireContractAccess |
| DELETE [app/api/admin/contracts/[id]/send/route.ts:87](../../../app/api/admin/contracts/[id]/send/route.ts#L87) | A | A | requireFeature: contracts | requireContractAccess |
| GET [app/api/admin/contracts/[id]/signed-pdf/route.ts:58](../../../app/api/admin/contracts/[id]/signed-pdf/route.ts#L58) | A | A | requireFeature: contracts | requireContractAccess |
| POST [app/api/admin/contracts/[id]/signed-pdf/route.ts:91](../../../app/api/admin/contracts/[id]/signed-pdf/route.ts#L91) | A | A | requireFeature: contracts | requireContractAccess |
| PATCH [app/api/admin/contracts/[id]/signers/[signerId]/route.ts:12](../../../app/api/admin/contracts/[id]/signers/[signerId]/route.ts#L12) | A | A | requireFeature: contracts | requireContractAccess |
| DELETE [app/api/admin/contracts/[id]/signers/[signerId]/route.ts:41](../../../app/api/admin/contracts/[id]/signers/[signerId]/route.ts#L41) | A | A | requireFeature: contracts | requireContractAccess |
| POST [app/api/admin/contracts/[id]/signers/route.ts:13](../../../app/api/admin/contracts/[id]/signers/route.ts#L13) | A | A | requireFeature: contracts | requireContractAccess |
| GET [app/api/admin/contracts/route.ts:36](../../../app/api/admin/contracts/route.ts#L36) | A | A | requireFeature: contracts | scopedOrgIds |
| POST [app/api/admin/contracts/route.ts:127](../../../app/api/admin/contracts/route.ts#L127) | A | A | requireFeature: contracts | requireArtifactAccess |
| GET [app/api/admin/contracts/templates/[id]/route.ts:11](../../../app/api/admin/contracts/templates/[id]/route.ts#L11) | B | B | requireFeature: contracts | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/contracts/templates/[id]/route.ts:23](../../../app/api/admin/contracts/templates/[id]/route.ts#L23) | B | B | requireFeature: contracts | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/contracts/templates/[id]/route.ts:49](../../../app/api/admin/contracts/templates/[id]/route.ts#L49) | B | B | requireFeature: contracts | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/contracts/templates/route.ts:11](../../../app/api/admin/contracts/templates/route.ts#L11) | B | B | requireFeature: contracts | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/contracts/templates/route.ts:25](../../../app/api/admin/contracts/templates/route.ts#L25) | B | B | requireFeature: contracts | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/conversations/[id]/messages/route.ts:21](../../../app/api/admin/conversations/[id]/messages/route.ts#L21) | C | A | requireFeature({ userId, orgId }, 'messages') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/conversations/[id]/messages/route.ts:164](../../../app/api/admin/conversations/[id]/messages/route.ts#L164) | C | A | requireFeature({ userId, orgId }, 'messages') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| PATCH [app/api/admin/conversations/[id]/messages/route.ts:377](../../../app/api/admin/conversations/[id]/messages/route.ts#L377) | C | A | requireFeature({ userId, orgId }, 'messages') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| GET [app/api/admin/conversations/route.ts:19](../../../app/api/admin/conversations/route.ts#L19) | C | A | requireFeature({ userId, orgId }, 'messages') | scopedOrgIds; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/conversations/route.ts:254](../../../app/api/admin/conversations/route.ts#L254) | C | A | requireFeature({ userId, orgId }, 'messages') | scopedOrgIds, requireAccessToOrg |
| POST [app/api/admin/cron/affiliate-reactivation/route.ts:39](../../../app/api/admin/cron/affiliate-reactivation/route.ts#L39) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/auto-promote-calls/route.ts:39](../../../app/api/admin/cron/auto-promote-calls/route.ts#L39) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/backlink-process/route.ts:25](../../../app/api/admin/cron/backlink-process/route.ts#L25) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/content-auto-backfill/route.ts:51](../../../app/api/admin/cron/content-auto-backfill/route.ts#L51) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/content-gap-hunt/route.ts:20](../../../app/api/admin/cron/content-gap-hunt/route.ts#L20) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/daily-summary/route.ts:37](../../../app/api/admin/cron/daily-summary/route.ts#L37) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/delivery-watch/route.ts:21](../../../app/api/admin/cron/delivery-watch/route.ts#L21) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/cron/draft-approved-ideas/route.ts:29](../../../app/api/admin/cron/draft-approved-ideas/route.ts#L29) | B | B | Retired route returns static410 and no data or side effects. | Retired route returns static410 and no data or side effects. |
| POST [app/api/admin/cron/draft-approved-ideas/route.ts:25](../../../app/api/admin/cron/draft-approved-ideas/route.ts#L25) | B | B | Retired route returns static410 and no data or side effects. | Retired route returns static410 and no data or side effects. |
| POST [app/api/admin/cron/finance-anomaly-scan/route.ts:37](../../../app/api/admin/cron/finance-anomaly-scan/route.ts#L37) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/ideation/route.ts:334](../../../app/api/admin/cron/ideation/route.ts#L334) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/indexing-reverser/route.ts:38](../../../app/api/admin/cron/indexing-reverser/route.ts#L38) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/leads-ai/route.ts:111](../../../app/api/admin/cron/leads-ai/route.ts#L111) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/link-engine-scan/route.ts:97](../../../app/api/admin/cron/link-engine-scan/route.ts#L97) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/post-scorecard-sync/route.ts:55](../../../app/api/admin/cron/post-scorecard-sync/route.ts#L55) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/pre-call-digest/route.ts:52](../../../app/api/admin/cron/pre-call-digest/route.ts#L52) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/publish-scheduled/route.ts:43](../../../app/api/admin/cron/publish-scheduled/route.ts#L43) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/round-table-advance/route.ts:111](../../../app/api/admin/cron/round-table-advance/route.ts#L111) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/schema-watchdog/route.ts:22](../../../app/api/admin/cron/schema-watchdog/route.ts#L22) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/site-index-sync/route.ts:24](../../../app/api/admin/cron/site-index-sync/route.ts#L24) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/snapshot-metrics/route.ts:85](../../../app/api/admin/cron/snapshot-metrics/route.ts#L85) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/suggestion-digest/route.ts:53](../../../app/api/admin/cron/suggestion-digest/route.ts#L53) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/sync-stripe/route.ts:41](../../../app/api/admin/cron/sync-stripe/route.ts#L41) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/cron/sync-xero/route.ts:60](../../../app/api/admin/cron/sync-xero/route.ts#L60) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/crons/route.ts:148](../../../app/api/admin/crons/route.ts#L148) | B | B | requireFeature: settings; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/crons/suggest-from-transcripts/route.ts:76](../../../app/api/admin/crons/suggest-from-transcripts/route.ts#L76) | A | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/crons/sweep/route.ts:34](../../../app/api/admin/crons/sweep/route.ts#L34) | C | B | assertCronAuth: verified scheduler secret, or settings feature and resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/danger/export/route.ts:30](../../../app/api/admin/danger/export/route.ts#L30) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/db/migrate/route.ts:2544](../../../app/api/admin/db/migrate/route.ts#L2544) | B | B | requireMigrationAccess (settings feature and admin role) | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/db/migrate/route.ts:2481](../../../app/api/admin/db/migrate/route.ts#L2481) | B | B | requireMigrationAccess (settings feature and admin role) | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/deals/[id]/activities/route.ts:17](../../../app/api/admin/deals/[id]/activities/route.ts#L17) | A | A | requireFeature: deals | requireDealAccess |
| GET [app/api/admin/deals/[id]/calls/route.ts:20](../../../app/api/admin/deals/[id]/calls/route.ts#L20) | C | A | requireFeature: deals | requireDealAccess |
| POST [app/api/admin/deals/[id]/calls/route.ts:38](../../../app/api/admin/deals/[id]/calls/route.ts#L38) | A | A | requireFeature: deals | requireDealAccess |
| GET [app/api/admin/deals/[id]/contacts/route.ts:18](../../../app/api/admin/deals/[id]/contacts/route.ts#L18) | C | A | requireFeature: deals | requireDealAccess, contactScopeCondition |
| POST [app/api/admin/deals/[id]/contacts/route.ts:52](../../../app/api/admin/deals/[id]/contacts/route.ts#L52) | C | A | requireFeature: deals | requireDealAccess, requireContactAccess |
| DELETE [app/api/admin/deals/[id]/contacts/route.ts:89](../../../app/api/admin/deals/[id]/contacts/route.ts#L89) | C | A | requireFeature: deals | requireDealAccess, requireContactAccess |
| POST [app/api/admin/deals/[id]/convert-to-client/route.ts:18](../../../app/api/admin/deals/[id]/convert-to-client/route.ts#L18) | A | A | requireFeature: deals | denyIfDealOrgOutOfScope |
| GET [app/api/admin/deals/[id]/nudges/route.ts:16](../../../app/api/admin/deals/[id]/nudges/route.ts#L16) | A | A | requireFeature: deals | requireDealAccess |
| POST [app/api/admin/deals/[id]/nudges/route.ts:38](../../../app/api/admin/deals/[id]/nudges/route.ts#L38) | A | A | requireFeature: deals | requireDealAccess |
| GET [app/api/admin/deals/[id]/route.ts:19](../../../app/api/admin/deals/[id]/route.ts#L19) | C | A | requireFeature: deals | denyIfDealOrgOutOfScope, contactScopeCondition |
| PATCH [app/api/admin/deals/[id]/route.ts:229](../../../app/api/admin/deals/[id]/route.ts#L229) | A | A | requireFeature: deals | denyIfDealOrgOutOfScope |
| DELETE [app/api/admin/deals/[id]/route.ts:764](../../../app/api/admin/deals/[id]/route.ts#L764) | A | A | requireFeature: deals | denyIfDealOrgOutOfScope |
| GET [app/api/admin/deals/route.ts:16](../../../app/api/admin/deals/route.ts#L16) | A | A | requireFeature: deals | scopedOrgIds, orgColumnInScope |
| POST [app/api/admin/deals/route.ts:159](../../../app/api/admin/deals/route.ts#L159) | A | A | requireFeature: deals | scopedOrgIds |
| POST [app/api/admin/derive-billing/route.ts:20](../../../app/api/admin/derive-billing/route.ts#L20) | C | B | requireFeature: clients + financial_reports; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/developer-handoff/route.ts:33](../../../app/api/admin/developer-handoff/route.ts#L33) | A | A | requireFeature: subject requests/tasks | requireAccessToOrg |
| POST [app/api/admin/discovery-calls/[id]/extract/route.ts:117](../../../app/api/admin/discovery-calls/[id]/extract/route.ts#L117) | C | A | requireFeature: calls | requireDiscoveryCallAccess |
| PATCH [app/api/admin/discovery-calls/[id]/route.ts:59](../../../app/api/admin/discovery-calls/[id]/route.ts#L59) | C | A | requireFeature: calls | requireDiscoveryCallAccess, requireAccessToOrgOrPreClient |
| DELETE [app/api/admin/discovery-calls/[id]/route.ts:302](../../../app/api/admin/discovery-calls/[id]/route.ts#L302) | C | A | requireFeature: calls | requireDiscoveryCallAccess |
| GET [app/api/admin/discovery-calls/upcoming/route.ts:46](../../../app/api/admin/discovery-calls/upcoming/route.ts#L46) | C | A | requireFeature: calls | scopedOrgIds, discoveryCallScopeCondition, orgColumnInScope |
| GET [app/api/admin/docs/[id]/route.ts:9](../../../app/api/admin/docs/[id]/route.ts#L9) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/docs/[id]/route.ts:44](../../../app/api/admin/docs/[id]/route.ts#L44) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/docs/[id]/route.ts:128](../../../app/api/admin/docs/[id]/route.ts#L128) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/docs/import/route.ts:17](../../../app/api/admin/docs/import/route.ts#L17) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/docs/route.ts:10](../../../app/api/admin/docs/route.ts#L10) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/docs/route.ts:112](../../../app/api/admin/docs/route.ts#L112) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/docs/seed/route.ts:38](../../../app/api/admin/docs/seed/route.ts#L38) | B | B | requireFeature: docs | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/email-suppressions/route.ts:36](../../../app/api/admin/email-suppressions/route.ts#L36) | B | B | requireFeature: settings | Studio-owned data, no client organisation ownership. |
| DELETE [app/api/admin/email-suppressions/route.ts:55](../../../app/api/admin/email-suppressions/route.ts#L55) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/emails/preview/route.ts:202](../../../app/api/admin/emails/preview/route.ts#L202) | B | B | super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/engagements/delivery-status/route.ts:18](../../../app/api/admin/engagements/delivery-status/route.ts#L18) | A | A | requireFeature({ userId, orgId }, 'schedules') | requireAccessToOrg, scopedOrgIds |
| GET [app/api/admin/engagements/off-track/route.ts:14](../../../app/api/admin/engagements/off-track/route.ts#L14) | A | A | requireFeature({ userId, orgId }, 'schedules') | scopedOrgIds |
| GET [app/api/admin/exchange-rates/route.ts:8](../../../app/api/admin/exchange-rates/route.ts#L8) | C | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/exchange-rates/route.ts:32](../../../app/api/admin/exchange-rates/route.ts#L32) | C | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/export/invoices/route.ts:13](../../../app/api/admin/export/invoices/route.ts#L13) | A | A | requireFeature({ userId, orgId }, 'invoices') | getOrgScope |
| GET [app/api/admin/export/leads/route.ts:27](../../../app/api/admin/export/leads/route.ts#L27) | B | B | requireFeature({ userId, orgId }, 'leads') | Workspace-wide internal data; no client owner |
| GET [app/api/admin/export/requests/route.ts:12](../../../app/api/admin/export/requests/route.ts#L12) | A | A | requireFeature({ userId, orgId }, 'requests') | resolveAccessScoping |
| GET [app/api/admin/export/time/route.ts:14](../../../app/api/admin/export/time/route.ts#L14) | A | A | requireFeature({ userId, orgId }, 'time') | scopedOrgIds |
| DELETE [app/api/admin/feedback/[id]/route.ts:22](../../../app/api/admin/feedback/[id]/route.ts#L22) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/feedback/[id]/screenshot/route.ts:22](../../../app/api/admin/feedback/[id]/screenshot/route.ts#L22) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/feedback/route.ts:28](../../../app/api/admin/feedback/route.ts#L28) | C | B | requireFeature: settings; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/financial-reports/anomalies/route.ts:20](../../../app/api/admin/financial-reports/anomalies/route.ts#L20) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/financial-reports/backfill-mrr/route.ts:24](../../../app/api/admin/financial-reports/backfill-mrr/route.ts#L24) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/financial-reports/subscriptions-audit/route.ts:23](../../../app/api/admin/financial-reports/subscriptions-audit/route.ts#L23) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/financial-reports/summary/route.ts:31](../../../app/api/admin/financial-reports/summary/route.ts#L31) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PATCH [app/api/admin/forms/[id]/route.ts:10](../../../app/api/admin/forms/[id]/route.ts#L10) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| DELETE [app/api/admin/forms/[id]/route.ts:74](../../../app/api/admin/forms/[id]/route.ts#L74) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/forms/resolve/route.ts:16](../../../app/api/admin/forms/resolve/route.ts#L16) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/forms/route.ts:17](../../../app/api/admin/forms/route.ts#L17) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| POST [app/api/admin/forms/route.ts:73](../../../app/api/admin/forms/route.ts#L73) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/guide/route.ts:8](../../../app/api/admin/guide/route.ts#L8) | C | B | requireFeature: help | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/health/route.ts:18](../../../app/api/admin/health/route.ts#L18) | C | B | resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/health/route.ts:81](../../../app/api/admin/health/route.ts#L81) | C | A | requireFeature: clients | Target organisation checked with requireAccessToOrg before business reads or writes. |
| GET [app/api/admin/impersonate/exit/route.ts:43](../../../app/api/admin/impersonate/exit/route.ts#L43) | B | B | Clears only the caller preview cookies; the exit hatch is always allowed. | Clears only the caller preview cookies; the exit hatch is always allowed. |
| POST [app/api/admin/impersonate/exit/route.ts:54](../../../app/api/admin/impersonate/exit/route.ts#L54) | B | B | Clears only the caller preview cookies; the exit hatch is always allowed. | Clears only the caller preview cookies; the exit hatch is always allowed. |
| GET [app/api/admin/impersonate/mode/route.ts:96](../../../app/api/admin/impersonate/mode/route.ts#L96) | B | B | Reads caller eligibility; arms only after resolveActEligibility proves super admin; disarming remains available. | Reads caller eligibility; arms only after resolveActEligibility proves super admin; disarming remains available. |
| POST [app/api/admin/impersonate/mode/route.ts:128](../../../app/api/admin/impersonate/mode/route.ts#L128) | B | B | Reads caller eligibility; arms only after resolveActEligibility proves super admin; disarming remains available. | Reads caller eligibility; arms only after resolveActEligibility proves super admin; disarming remains available. |
| GET [app/api/admin/import/cleanup/route.ts:134](../../../app/api/admin/import/cleanup/route.ts#L134) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/import/cleanup/route.ts:65](../../../app/api/admin/import/cleanup/route.ts#L65) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/import/manyrequests/route.ts:334](../../../app/api/admin/import/manyrequests/route.ts#L334) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/import/manyrequests/route.ts:186](../../../app/api/admin/import/manyrequests/route.ts#L186) | B | B | requireFeature: settings; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/airwallex/debug/route.ts:18](../../../app/api/admin/integrations/airwallex/debug/route.ts#L18) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/airwallex/sync/route.ts:32](../../../app/api/admin/integrations/airwallex/sync/route.ts#L32) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/buffer/debug/route.ts:78](../../../app/api/admin/integrations/buffer/debug/route.ts#L78) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/buffer/posts/route.ts:39](../../../app/api/admin/integrations/buffer/posts/route.ts#L39) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/buffer/schedule-posts/route.ts:58](../../../app/api/admin/integrations/buffer/schedule-posts/route.ts#L58) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/buffer/status/route.ts:25](../../../app/api/admin/integrations/buffer/status/route.ts#L25) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/google/callback/route.ts:48](../../../app/api/admin/integrations/google/callback/route.ts#L48) | B | B | Public callback verifies and consumes an expiring one-use OAuth state nonce minted by feature-gated start. | Public callback verifies and consumes an expiring one-use OAuth state nonce minted by feature-gated start. |
| POST [app/api/admin/integrations/google/discover-ga4/route.ts:52](../../../app/api/admin/integrations/google/discover-ga4/route.ts#L52) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/google/start/route.ts:57](../../../app/api/admin/integrations/google/start/route.ts#L57) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/google/status/route.ts:28](../../../app/api/admin/integrations/google/status/route.ts#L28) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| DELETE [app/api/admin/integrations/google/status/route.ts:71](../../../app/api/admin/integrations/google/status/route.ts#L71) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/google/sync-calendar/route.ts:35](../../../app/api/admin/integrations/google/sync-calendar/route.ts#L35) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/integrations/google/sync-drive-transcripts/route.ts:69](../../../app/api/admin/integrations/google/sync-drive-transcripts/route.ts#L69) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/mailerlite/route.ts:12](../../../app/api/admin/integrations/mailerlite/route.ts#L12) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/mailerlite/route.ts:68](../../../app/api/admin/integrations/mailerlite/route.ts#L68) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| PUT [app/api/admin/integrations/mailerlite/route.ts:43](../../../app/api/admin/integrations/mailerlite/route.ts#L43) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/rewardful/route.ts:10](../../../app/api/admin/integrations/rewardful/route.ts#L10) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/rewardful/route.ts:39](../../../app/api/admin/integrations/rewardful/route.ts#L39) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/rewardful/sync/route.ts:14](../../../app/api/admin/integrations/rewardful/sync/route.ts#L14) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/slack/route.ts:12](../../../app/api/admin/integrations/slack/route.ts#L12) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/slack/route.ts:114](../../../app/api/admin/integrations/slack/route.ts#L114) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| PUT [app/api/admin/integrations/slack/route.ts:52](../../../app/api/admin/integrations/slack/route.ts#L52) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/status/route.ts:12](../../../app/api/admin/integrations/status/route.ts#L12) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/stripe/import-invoices/route.ts:18](../../../app/api/admin/integrations/stripe/import-invoices/route.ts#L18) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/integrations/stripe/import-payments/route.ts:18](../../../app/api/admin/integrations/stripe/import-payments/route.ts#L18) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/integrations/stripe/link-customer/route.ts:20](../../../app/api/admin/integrations/stripe/link-customer/route.ts#L20) | B | B | super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/stripe/provision/route.ts:116](../../../app/api/admin/integrations/stripe/provision/route.ts#L116) | C | A | requireFeature: settings.integrations | Target organisation checked with requireAccessToOrg before business reads or writes. |
| POST [app/api/admin/integrations/stripe/provision/route.ts:30](../../../app/api/admin/integrations/stripe/provision/route.ts#L30) | C | A | requireFeature: settings.integrations | Target organisation checked with requireAccessToOrg before business reads or writes. |
| POST [app/api/admin/integrations/stripe/recover-invoice/route.ts:13](../../../app/api/admin/integrations/stripe/recover-invoice/route.ts#L13) | B | B | super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/stripe/setup-plans/route.ts:78](../../../app/api/admin/integrations/stripe/setup-plans/route.ts#L78) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/stripe/setup-plans/route.ts:62](../../../app/api/admin/integrations/stripe/setup-plans/route.ts#L62) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/xero/balance-sheet/route.ts:7](../../../app/api/admin/integrations/xero/balance-sheet/route.ts#L7) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/xero/bank-summary/route.ts:31](../../../app/api/admin/integrations/xero/bank-summary/route.ts#L31) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/xero/branding-themes/route.ts:14](../../../app/api/admin/integrations/xero/branding-themes/route.ts#L14) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/integrations/xero/callback/route.ts:14](../../../app/api/admin/integrations/xero/callback/route.ts#L14) | B | B | Public callback verifies and consumes an expiring one-use OAuth state nonce minted by feature-gated connect. | Public callback verifies and consumes an expiring one-use OAuth state nonce minted by feature-gated connect. |
| GET [app/api/admin/integrations/xero/connect/route.ts:19](../../../app/api/admin/integrations/xero/connect/route.ts#L19) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/xero/import-invoices/route.ts:17](../../../app/api/admin/integrations/xero/import-invoices/route.ts#L17) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/xero/match-contacts/route.ts:21](../../../app/api/admin/integrations/xero/match-contacts/route.ts#L21) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PATCH [app/api/admin/integrations/xero/match-contacts/route.ts:80](../../../app/api/admin/integrations/xero/match-contacts/route.ts#L80) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/xero/profit-loss/route.ts:7](../../../app/api/admin/integrations/xero/profit-loss/route.ts#L7) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/xero/sync-balances/route.ts:19](../../../app/api/admin/integrations/xero/sync-balances/route.ts#L19) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/integrations/xero/sync-payments/route.ts:17](../../../app/api/admin/integrations/xero/sync-payments/route.ts#L17) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/integrations/xero/sync-pnl/route.ts:22](../../../app/api/admin/integrations/xero/sync-pnl/route.ts#L22) | B | B | requireFeature: settings.integrations; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/integrations/zapier/route.ts:14](../../../app/api/admin/integrations/zapier/route.ts#L14) | B | B | requireFeature: settings.integrations | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/integrations/zapier/route.ts:62](../../../app/api/admin/integrations/zapier/route.ts#L62) | C | A | requireFeature: settings.integrations | Target organisation checked with requireAccessToOrg before business reads or writes. |
| GET [app/api/admin/invoices/[id]/draft-chase/route.ts:97](../../../app/api/admin/invoices/[id]/draft-chase/route.ts#L97) | A | A | requireFeature: invoices | requireAccessToOrg |
| POST [app/api/admin/invoices/[id]/draft-chase/route.ts:131](../../../app/api/admin/invoices/[id]/draft-chase/route.ts#L131) | A | A | requireFeature: invoices | requireAccessToOrg |
| GET [app/api/admin/invoices/[id]/route.ts:309](../../../app/api/admin/invoices/[id]/route.ts#L309) | A | A | requireFeature: invoices | requireAccessToOrg |
| PATCH [app/api/admin/invoices/[id]/route.ts:383](../../../app/api/admin/invoices/[id]/route.ts#L383) | A | A | requireFeature: invoices | requireAccessToOrg |
| DELETE [app/api/admin/invoices/[id]/route.ts:594](../../../app/api/admin/invoices/[id]/route.ts#L594) | A | A | requireFeature: invoices | requireAccessToOrg |
| POST [app/api/admin/invoices/[id]/send-email/route.ts:114](../../../app/api/admin/invoices/[id]/send-email/route.ts#L114) | A | A | requireFeature: invoices | requireAccessToOrg |
| POST [app/api/admin/invoices/backfill-numbers/route.ts:45](../../../app/api/admin/invoices/backfill-numbers/route.ts#L45) | C | B | requireFeature: invoices; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/invoices/dedupe-manyrequests-twins/route.ts:48](../../../app/api/admin/invoices/dedupe-manyrequests-twins/route.ts#L48) | C | B | requireFeature: invoices; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/invoices/dedupe-stripe-charges/route.ts:42](../../../app/api/admin/invoices/dedupe-stripe-charges/route.ts#L42) | C | B | requireFeature: invoices; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/invoices/route.ts:14](../../../app/api/admin/invoices/route.ts#L14) | A | A | requireFeature: invoices | getOrgScope |
| POST [app/api/admin/invoices/route.ts:94](../../../app/api/admin/invoices/route.ts#L94) | C | A | requireFeature: invoices | requireAccessToOrg |
| POST [app/api/admin/invoices/stripe-create/route.ts:40](../../../app/api/admin/invoices/stripe-create/route.ts#L40) | A | A | requireFeature: invoices | requireAccessToOrg |
| POST [app/api/admin/invoices/xero-sync/route.ts:34](../../../app/api/admin/invoices/xero-sync/route.ts#L34) | C | A | requireFeature: invoices | requireAccessToOrg |
| PATCH [app/api/admin/kanban-columns/[id]/route.ts:11](../../../app/api/admin/kanban-columns/[id]/route.ts#L11) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| DELETE [app/api/admin/kanban-columns/[id]/route.ts:60](../../../app/api/admin/kanban-columns/[id]/route.ts#L60) | C | A | requireFeature({ userId, orgId }, 'settings'); requireStudioAdmin({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/kanban-columns/route.ts:52](../../../app/api/admin/kanban-columns/route.ts#L52) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| POST [app/api/admin/kanban-columns/route.ts:92](../../../app/api/admin/kanban-columns/route.ts#L92) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| PATCH [app/api/admin/kanban-columns/route.ts:190](../../../app/api/admin/kanban-columns/route.ts#L190) | C | A | requireFeature({ userId, orgId }, 'settings') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/leads/[id]/calls/route.ts:32](../../../app/api/admin/leads/[id]/calls/route.ts#L32) | C | A | requireFeature: leads | Delegated target scope helper in the route-owned library |
| POST [app/api/admin/leads/[id]/calls/route.ts:46](../../../app/api/admin/leads/[id]/calls/route.ts#L46) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/leads/[id]/draft-reply/route.ts:322](../../../app/api/admin/leads/[id]/draft-reply/route.ts#L322) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/[id]/draft-reply/route.ts:80](../../../app/api/admin/leads/[id]/draft-reply/route.ts#L80) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/[id]/enrich/route.ts:465](../../../app/api/admin/leads/[id]/enrich/route.ts#L465) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/[id]/promote/route.ts:41](../../../app/api/admin/leads/[id]/promote/route.ts#L41) | C | A | requireFeature: leads; requireAdmin | requireDealAccess, requireDiscoveryCallAccess, requireAccessToOrg, requireAdmin |
| GET [app/api/admin/leads/[id]/route.ts:13](../../../app/api/admin/leads/[id]/route.ts#L13) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/leads/[id]/route.ts:115](../../../app/api/admin/leads/[id]/route.ts#L115) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/leads/[id]/route.ts:277](../../../app/api/admin/leads/[id]/route.ts#L277) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/backfill-fields/route.ts:182](../../../app/api/admin/leads/backfill-fields/route.ts#L182) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/bulk-actions/route.ts:63](../../../app/api/admin/leads/bulk-actions/route.ts#L63) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/bulk-import/route.ts:87](../../../app/api/admin/leads/bulk-import/route.ts#L87) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/rescore-all/route.ts:65](../../../app/api/admin/leads/rescore-all/route.ts#L65) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/leads/route.ts:19](../../../app/api/admin/leads/route.ts#L19) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/route.ts:112](../../../app/api/admin/leads/route.ts#L112) | B | B | requireFeature: leads | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/leads/triage-pipeline/route.ts:34](../../../app/api/admin/leads/triage-pipeline/route.ts#L34) | C | B | requireFeature: leads; requireAdmin | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/mcp/identity/route.ts:14](../../../app/api/admin/mcp/identity/route.ts#L14) | B | B | Verified api-service identity only; checks active membership and MCP profile. | Verified api-service identity only; checks active membership and MCP profile. |
| POST [app/api/admin/messages/[source]/[id]/read/route.ts:23](../../../app/api/admin/messages/[source]/[id]/read/route.ts#L23) | A | A | studioInboxGate | studioInboxGate and resolveThread/refuseOutOfScope on stored target |
| GET [app/api/admin/messages/[source]/[id]/route.ts:163](../../../app/api/admin/messages/[source]/[id]/route.ts#L163) | C | A | studioInboxGate | studioInboxGate and resolveThread/refuseOutOfScope on stored target; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/messages/[source]/[id]/route.ts:225](../../../app/api/admin/messages/[source]/[id]/route.ts#L225) | A | A | studioInboxGate | studioInboxGate and resolveThread/refuseOutOfScope on stored target |
| GET [app/api/admin/messages/route.ts:31](../../../app/api/admin/messages/route.ts#L31) | C | A | studioInboxGate | studioInboxGate and resolveThread/refuseOutOfScope on stored target; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| GET [app/api/admin/notifications/route.ts:45](../../../app/api/admin/notifications/route.ts#L45) | B | B | Caller-only notification preferences by userId and team_member userType. | Caller-only notification preferences by userId and team_member userType. |
| PATCH [app/api/admin/notifications/route.ts:76](../../../app/api/admin/notifications/route.ts#L76) | B | B | Caller-only notification preferences by userId and team_member userType. | Caller-only notification preferences by userId and team_member userType. |
| GET [app/api/admin/nudge-templates/route.ts:11](../../../app/api/admin/nudge-templates/route.ts#L11) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/nudge-templates/route.ts:28](../../../app/api/admin/nudge-templates/route.ts#L28) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/nudge-templates/route.ts:66](../../../app/api/admin/nudge-templates/route.ts#L66) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/onboarding-invites/route.ts:50](../../../app/api/admin/onboarding-invites/route.ts#L50) | A | A | requireFeature: flow clients/team | requireAccessToOrg |
| POST [app/api/admin/onboarding-invites/route.ts:74](../../../app/api/admin/onboarding-invites/route.ts#L74) | C | A | requireFeature: flow clients/team; team flow requireManagePermissions | requireManagePermissions, requireAccessToOrg |
| POST [app/api/admin/overview/brief/refresh/route.ts:46](../../../app/api/admin/overview/brief/refresh/route.ts#L46) | C | A | requireFeature: overview | Scope and per-source features fingerprint cached briefs; computeBrief filters org sources before caps. |
| GET [app/api/admin/overview/brief/route.ts:12](../../../app/api/admin/overview/brief/route.ts#L12) | C | A | requireFeature: overview | Scope and per-source features fingerprint cached briefs; computeBrief filters org sources before caps. |
| GET [app/api/admin/overview/me/route.ts:47](../../../app/api/admin/overview/me/route.ts#L47) | C | A | requireFeature: overview | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/overview/replies-waiting/route.ts:64](../../../app/api/admin/overview/replies-waiting/route.ts#L64) | C | A | requireFeature: overview | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/overview/route.ts:35](../../../app/api/admin/overview/route.ts#L35) | C | A | requireFeature: overview | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/overview/wire/route.ts:34](../../../app/api/admin/overview/wire/route.ts#L34) | C | A | requireFeature: overview | Org SQL filters before reads, aggregations and LIMIT. |
| POST [app/api/admin/permissions/assign-role/route.ts:19](../../../app/api/admin/permissions/assign-role/route.ts#L19) | B | B | requireFeature: settings.permissions; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/permissions/contact-role/route.ts:20](../../../app/api/admin/permissions/contact-role/route.ts#L20) | B | B | requireFeature: settings.permissions; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/permissions/copy-access/route.ts:24](../../../app/api/admin/permissions/copy-access/route.ts#L24) | B | B | requireFeature: settings.permissions; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/permissions/feature-visibility/route.ts:18](../../../app/api/admin/permissions/feature-visibility/route.ts#L18) | B | B | canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PUT [app/api/admin/permissions/feature-visibility/route.ts:51](../../../app/api/admin/permissions/feature-visibility/route.ts#L51) | B | B | requireFeature: settings.permissions; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/permissions/matrix/route.ts:30](../../../app/api/admin/permissions/matrix/route.ts#L30) | B | B | canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/permissions/me/route.ts:10](../../../app/api/admin/permissions/me/route.ts#L10) | B | B | Caller-only permissions are necessary to render denied navigation. | Caller-only permissions are necessary to render denied navigation. |
| GET [app/api/admin/permissions/subjects/route.ts:13](../../../app/api/admin/permissions/subjects/route.ts#L13) | B | B | canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/pipeline/capacity/route.ts:35](../../../app/api/admin/pipeline/capacity/route.ts#L35) | C | A | requireFeature: deals | scopedOrgIds, orgColumnInScope |
| POST [app/api/admin/pipeline/seed/route.ts:17](../../../app/api/admin/pipeline/seed/route.ts#L17) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/pipeline/stages/[id]/route.ts:18](../../../app/api/admin/pipeline/stages/[id]/route.ts#L18) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/pipeline/stages/route.ts:43](../../../app/api/admin/pipeline/stages/route.ts#L43) | C | A | requireFeature: deals | scopedOrgIds, orgColumnInScope |
| POST [app/api/admin/pipeline/stages/route.ts:144](../../../app/api/admin/pipeline/stages/route.ts#L144) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PUT [app/api/admin/pipeline/stages/route.ts:211](../../../app/api/admin/pipeline/stages/route.ts#L211) | C | B | requireFeature: deals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/planned-roles/[id]/route.ts:15](../../../app/api/admin/planned-roles/[id]/route.ts#L15) | C | B | requireFeature: team | Studio-owned data, no client organisation ownership. |
| DELETE [app/api/admin/planned-roles/[id]/route.ts:57](../../../app/api/admin/planned-roles/[id]/route.ts#L57) | C | B | requireFeature: team | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/planned-roles/route.ts:11](../../../app/api/admin/planned-roles/route.ts#L11) | C | B | requireFeature: team | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/planned-roles/route.ts:30](../../../app/api/admin/planned-roles/route.ts#L30) | C | B | requireFeature: team | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/profile/route.ts:16](../../../app/api/admin/profile/route.ts#L16) | B | B | Caller-only roster row by clerkUserId; cannot read or mutate another seat. | Caller-only roster row by clerkUserId; cannot read or mutate another seat. |
| PATCH [app/api/admin/profile/route.ts:48](../../../app/api/admin/profile/route.ts#L48) | B | B | Caller-only roster row by clerkUserId; cannot read or mutate another seat. | Caller-only roster row by clerkUserId; cannot read or mutate another seat. |
| POST [app/api/admin/proposals/[id]/email/route.ts:38](../../../app/api/admin/proposals/[id]/email/route.ts#L38) | A | A | requireFeature: proposals | requireProposalAccess |
| GET [app/api/admin/proposals/[id]/preview-data/route.ts:23](../../../app/api/admin/proposals/[id]/preview-data/route.ts#L23) | A | A | requireFeature: proposals | requireProposalAccess |
| POST [app/api/admin/proposals/[id]/publish/route.ts:22](../../../app/api/admin/proposals/[id]/publish/route.ts#L22) | A | A | requireFeature: proposals | requireProposalAccess |
| GET [app/api/admin/proposals/[id]/route.ts:14](../../../app/api/admin/proposals/[id]/route.ts#L14) | A | A | requireFeature: proposals | requireArtifactAccess |
| PATCH [app/api/admin/proposals/[id]/route.ts:76](../../../app/api/admin/proposals/[id]/route.ts#L76) | A | A | requireFeature: proposals | requireArtifactAccess |
| DELETE [app/api/admin/proposals/[id]/route.ts:178](../../../app/api/admin/proposals/[id]/route.ts#L178) | A | A | requireFeature: proposals | requireProposalAccess |
| PATCH [app/api/admin/proposals/[id]/sections/[sectionId]/route.ts:12](../../../app/api/admin/proposals/[id]/sections/[sectionId]/route.ts#L12) | A | A | requireFeature: proposals | requireProposalAccess |
| DELETE [app/api/admin/proposals/[id]/sections/[sectionId]/route.ts:52](../../../app/api/admin/proposals/[id]/sections/[sectionId]/route.ts#L52) | A | A | requireFeature: proposals | requireProposalAccess |
| POST [app/api/admin/proposals/[id]/sections/route.ts:25](../../../app/api/admin/proposals/[id]/sections/route.ts#L25) | A | A | requireFeature: proposals | requireProposalAccess |
| POST [app/api/admin/proposals/[id]/share/route.ts:22](../../../app/api/admin/proposals/[id]/share/route.ts#L22) | A | A | requireFeature: proposals | requireProposalAccess |
| DELETE [app/api/admin/proposals/[id]/share/route.ts:93](../../../app/api/admin/proposals/[id]/share/route.ts#L93) | A | A | requireFeature: proposals | requireProposalAccess |
| PATCH [app/api/admin/proposals/[id]/variants/[variantId]/route.ts:12](../../../app/api/admin/proposals/[id]/variants/[variantId]/route.ts#L12) | A | A | requireFeature: proposals | requireProposalAccess |
| DELETE [app/api/admin/proposals/[id]/variants/[variantId]/route.ts:56](../../../app/api/admin/proposals/[id]/variants/[variantId]/route.ts#L56) | A | A | requireFeature: proposals | requireProposalAccess |
| POST [app/api/admin/proposals/[id]/variants/route.ts:13](../../../app/api/admin/proposals/[id]/variants/route.ts#L13) | A | A | requireFeature: proposals | requireProposalAccess |
| GET [app/api/admin/proposals/route.ts:69](../../../app/api/admin/proposals/route.ts#L69) | A | A | requireFeature: proposals | scopedOrgIds |
| POST [app/api/admin/proposals/route.ts:132](../../../app/api/admin/proposals/route.ts#L132) | A | A | requireFeature: proposals | requireArtifactAccess |
| GET [app/api/admin/proposals/templates/[id]/route.ts:11](../../../app/api/admin/proposals/templates/[id]/route.ts#L11) | B | B | requireFeature: proposals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/proposals/templates/[id]/route.ts:27](../../../app/api/admin/proposals/templates/[id]/route.ts#L27) | B | B | requireFeature: proposals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/proposals/templates/[id]/route.ts:44](../../../app/api/admin/proposals/templates/[id]/route.ts#L44) | B | B | requireFeature: proposals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/proposals/templates/route.ts:12](../../../app/api/admin/proposals/templates/route.ts#L12) | B | B | requireFeature: proposals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/proposals/templates/route.ts:36](../../../app/api/admin/proposals/templates/route.ts#L36) | B | B | requireFeature: proposals | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/recorder-devices/[id]/revoke/route.ts:4](../../../app/api/admin/recorder-devices/[id]/revoke/route.ts#L4) | B | B | withRecorderDevicesContext | Authenticated admin role and personal device ownership |
| POST [app/api/admin/recorder-devices/pairing-code/route.ts:4](../../../app/api/admin/recorder-devices/pairing-code/route.ts#L4) | B | B | withRecorderDevicesContext | Authenticated admin role and personal device ownership |
| GET [app/api/admin/recorder-devices/route.ts:4](../../../app/api/admin/recorder-devices/route.ts#L4) | B | B | withRecorderDevicesContext | Authenticated admin role and personal device ownership |
| POST [app/api/admin/recordings/[id]/chunks/route.ts:6](../../../app/api/admin/recordings/[id]/chunks/route.ts#L6) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| PUT [app/api/admin/recordings/[id]/chunks/route.ts:11](../../../app/api/admin/recordings/[id]/chunks/route.ts#L11) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| PATCH [app/api/admin/recordings/[id]/link/route.ts:4](../../../app/api/admin/recordings/[id]/link/route.ts#L4) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| GET [app/api/admin/recordings/[id]/route.ts:6](../../../app/api/admin/recordings/[id]/route.ts#L6) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| DELETE [app/api/admin/recordings/[id]/route.ts:11](../../../app/api/admin/recordings/[id]/route.ts#L11) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| POST [app/api/admin/recordings/[id]/stop/route.ts:4](../../../app/api/admin/recordings/[id]/stop/route.ts#L4) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| POST [app/api/admin/recordings/[id]/transcribe/route.ts:5](../../../app/api/admin/recordings/[id]/transcribe/route.ts#L5) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| GET [app/api/admin/recordings/route.ts:4](../../../app/api/admin/recordings/route.ts#L4) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| POST [app/api/admin/recordings/route.ts:8](../../../app/api/admin/recordings/route.ts#L8) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| GET [app/api/admin/recordings/upcoming-calls/route.ts:5](../../../app/api/admin/recordings/upcoming-calls/route.ts#L5) | A | A | withRecordingContext | withRecordingContext plus create/list/link recording org scopes and device ownership |
| GET [app/api/admin/reports/ai-cost/route.ts:40](../../../app/api/admin/reports/ai-cost/route.ts#L40) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/reports/bank-balances/route.ts:39](../../../app/api/admin/reports/bank-balances/route.ts#L39) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/reports/billing-summary/route.ts:11](../../../app/api/admin/reports/billing-summary/route.ts#L11) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/reports/cash-flow-forecast/route.ts:41](../../../app/api/admin/reports/cash-flow-forecast/route.ts#L41) | B | B | requireFeature: financial_reports; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/reports/client-profitability/route.ts:28](../../../app/api/admin/reports/client-profitability/route.ts#L28) | C | A | requireFeature: financial_reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/close-rates/route.ts:13](../../../app/api/admin/reports/close-rates/route.ts#L13) | A | A | requireFeature: sales_analytics | Existing scopedOrgIds/resolveAccessScoping filters before SQL aggregation and LIMIT. |
| PATCH [app/api/admin/reports/expenses/category/route.ts:28](../../../app/api/admin/reports/expenses/category/route.ts#L28) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/reports/expenses/route.ts:27](../../../app/api/admin/reports/expenses/route.ts#L27) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/reports/financial-trends/route.ts:28](../../../app/api/admin/reports/financial-trends/route.ts#L28) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/reports/invoice-aging/route.ts:39](../../../app/api/admin/reports/invoice-aging/route.ts#L39) | C | A | requireFeature: financial_reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/overview/route.ts:13](../../../app/api/admin/reports/overview/route.ts#L13) | A | A | requireFeature: 'reports', 'invoices' | Existing scopedOrgIds/resolveAccessScoping filters before SQL aggregation and LIMIT. |
| GET [app/api/admin/reports/pipeline-forecast/route.ts:36](../../../app/api/admin/reports/pipeline-forecast/route.ts#L36) | A | A | requireFeature: sales_analytics | Existing scopedOrgIds/resolveAccessScoping filters before SQL aggregation and LIMIT. |
| GET [app/api/admin/reports/response-time/route.ts:10](../../../app/api/admin/reports/response-time/route.ts#L10) | C | A | requireFeature: reports | Org SQL filters before reads, aggregations and LIMIT. |
| POST [app/api/admin/reports/retainer-alerts/route.ts:30](../../../app/api/admin/reports/retainer-alerts/route.ts#L30) | C | A | requireFeature: reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/retainer-health/route.ts:31](../../../app/api/admin/reports/retainer-health/route.ts#L31) | C | A | requireFeature: reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/sales/route.ts:14](../../../app/api/admin/reports/sales/route.ts#L14) | C | A | requireFeature: financial_reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/utilization/route.ts:36](../../../app/api/admin/reports/utilization/route.ts#L36) | C | A | requireFeature: reports | Org SQL filters before reads, aggregations and LIMIT. |
| GET [app/api/admin/reports/worklog/route.ts:41](../../../app/api/admin/reports/worklog/route.ts#L41) | A | A | requireFeature: reports | Existing scopedOrgIds/resolveAccessScoping filters before SQL aggregation and LIMIT. |
| DELETE [app/api/admin/requests/[id]/blockers/[linkId]/route.ts:8](../../../app/api/admin/requests/[id]/blockers/[linkId]/route.ts#L8) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| GET [app/api/admin/requests/[id]/blockers/route.ts:17](../../../app/api/admin/requests/[id]/blockers/route.ts#L17) | C | A | requireFeature({ userId, orgId }, 'requests') | guardSubject; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/requests/[id]/blockers/route.ts:35](../../../app/api/admin/requests/[id]/blockers/route.ts#L35) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| GET [app/api/admin/requests/[id]/calls/route.ts:38](../../../app/api/admin/requests/[id]/calls/route.ts#L38) | C | A | requireFeature({ userId, orgId }, 'requests') | listCallsForParent |
| POST [app/api/admin/requests/[id]/calls/route.ts:55](../../../app/api/admin/requests/[id]/calls/route.ts#L55) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| POST [app/api/admin/requests/[id]/draft-reply/route.ts:84](../../../app/api/admin/requests/[id]/draft-reply/route.ts#L84) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/duplicate/route.ts:25](../../../app/api/admin/requests/[id]/duplicate/route.ts#L25) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/files/route.ts:34](../../../app/api/admin/requests/[id]/files/route.ts#L34) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/files/route.ts:82](../../../app/api/admin/requests/[id]/files/route.ts#L82) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| POST [app/api/admin/requests/[id]/handoff/route.ts:93](../../../app/api/admin/requests/[id]/handoff/route.ts#L93) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| DELETE [app/api/admin/requests/[id]/handoff/route.ts:128](../../../app/api/admin/requests/[id]/handoff/route.ts#L128) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/messages/route.ts:23](../../../app/api/admin/requests/[id]/messages/route.ts#L23) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/messages/route.ts:135](../../../app/api/admin/requests/[id]/messages/route.ts#L135) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/nest/route.ts:32](../../../app/api/admin/requests/[id]/nest/route.ts#L32) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| DELETE [app/api/admin/requests/[id]/participants/[participantId]/route.ts:22](../../../app/api/admin/requests/[id]/participants/[participantId]/route.ts#L22) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/participants/route.ts:50](../../../app/api/admin/requests/[id]/participants/route.ts#L50) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/requests/[id]/participants/route.ts:105](../../../app/api/admin/requests/[id]/participants/route.ts#L105) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| GET [app/api/admin/requests/[id]/reads/route.ts:83](../../../app/api/admin/requests/[id]/reads/route.ts#L83) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/reads/route.ts:30](../../../app/api/admin/requests/[id]/reads/route.ts#L30) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/route.ts:21](../../../app/api/admin/requests/[id]/route.ts#L21) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| PATCH [app/api/admin/requests/[id]/route.ts:221](../../../app/api/admin/requests/[id]/route.ts#L221) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| DELETE [app/api/admin/requests/[id]/route.ts:249](../../../app/api/admin/requests/[id]/route.ts#L249) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| POST [app/api/admin/requests/[id]/scope-flag/route.ts:22](../../../app/api/admin/requests/[id]/scope-flag/route.ts#L22) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| DELETE [app/api/admin/requests/[id]/scope-flag/route.ts:55](../../../app/api/admin/requests/[id]/scope-flag/route.ts#L55) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| PATCH [app/api/admin/requests/[id]/steps/[stepId]/route.ts:32](../../../app/api/admin/requests/[id]/steps/[stepId]/route.ts#L32) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| DELETE [app/api/admin/requests/[id]/steps/[stepId]/route.ts:83](../../../app/api/admin/requests/[id]/steps/[stepId]/route.ts#L83) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| GET [app/api/admin/requests/[id]/steps/route.ts:34](../../../app/api/admin/requests/[id]/steps/route.ts#L34) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| POST [app/api/admin/requests/[id]/steps/route.ts:59](../../../app/api/admin/requests/[id]/steps/route.ts#L59) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| PATCH [app/api/admin/requests/[id]/sub-requests/reorder/route.ts:22](../../../app/api/admin/requests/[id]/sub-requests/reorder/route.ts#L22) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| GET [app/api/admin/requests/[id]/sub-requests/route.ts:26](../../../app/api/admin/requests/[id]/sub-requests/route.ts#L26) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/requests/[id]/sub-requests/route.ts:69](../../../app/api/admin/requests/[id]/sub-requests/route.ts#L69) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/time-entries/route.ts:53](../../../app/api/admin/requests/[id]/time-entries/route.ts#L53) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg on request plus scopedOrgIds on each returned time-entry org before reading notes/hours |
| POST [app/api/admin/requests/[id]/time-entries/route.ts:92](../../../app/api/admin/requests/[id]/time-entries/route.ts#L92) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| POST [app/api/admin/requests/[id]/triage/route.ts:115](../../../app/api/admin/requests/[id]/triage/route.ts#L115) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/requests/[id]/voice-notes/route.ts:31](../../../app/api/admin/requests/[id]/voice-notes/route.ts#L31) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/[id]/voice-notes/route.ts:73](../../../app/api/admin/requests/[id]/voice-notes/route.ts#L73) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation; independent row org predicates before metadata reads, authenticated service/admin bypass preserved |
| POST [app/api/admin/requests/bulk-assign/route.ts:43](../../../app/api/admin/requests/bulk-assign/route.ts#L43) | C | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/requests/bulk/route.ts:110](../../../app/api/admin/requests/bulk/route.ts#L110) | C | A | requireFeature({ userId, orgId }, 'requests') | getOrgScope |
| PATCH [app/api/admin/requests/bulk/route.ts:237](../../../app/api/admin/requests/bulk/route.ts#L237) | C | A | requireFeature({ userId, orgId }, 'requests') | getOrgScope |
| GET [app/api/admin/requests/route.ts:14](../../../app/api/admin/requests/route.ts#L14) | C | A | requireFeature({ userId, orgId }, 'requests') | scopedOrgIds, resolveAccessScoping |
| POST [app/api/admin/requests/route.ts:180](../../../app/api/admin/requests/route.ts#L180) | C | A | requireFeature({ userId, orgId }, 'requests') | Shared write library validates destination org; no existing client for client creation |
| PATCH [app/api/admin/reserves/[id]/route.ts:21](../../../app/api/admin/reserves/[id]/route.ts#L21) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| DELETE [app/api/admin/reserves/[id]/route.ts:55](../../../app/api/admin/reserves/[id]/route.ts#L55) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/reserves/route.ts:32](../../../app/api/admin/reserves/route.ts#L32) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/reserves/route.ts:49](../../../app/api/admin/reserves/route.ts#L49) | B | B | requireFeature: financial_reports | Studio-owned data, no client organisation ownership. |
| POST [app/api/admin/reviews/outreach/route.ts:13](../../../app/api/admin/reviews/outreach/route.ts#L13) | C | A | requireFeature: reviews | scopedOrgIds, orgColumnInScope |
| GET [app/api/admin/reviews/route.ts:14](../../../app/api/admin/reviews/route.ts#L14) | C | A | requireFeature: reviews | scopedOrgIds, orgColumnInScope |
| POST [app/api/admin/reviews/route.ts:87](../../../app/api/admin/reviews/route.ts#L87) | C | A | requireFeature: reviews | requireAccessToOrg |
| GET [app/api/admin/schedules/[id]/delivery-status/route.ts:19](../../../app/api/admin/schedules/[id]/delivery-status/route.ts#L19) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/email/route.ts:32](../../../app/api/admin/schedules/[id]/email/route.ts#L32) | A | A | requireFeature: schedules | requireScheduleAccess |
| GET [app/api/admin/schedules/[id]/linked-work/route.ts:17](../../../app/api/admin/schedules/[id]/linked-work/route.ts#L17) | A | A | requireFeature: schedules | requireArtifactAccess |
| GET [app/api/admin/schedules/[id]/preview-data/route.ts:19](../../../app/api/admin/schedules/[id]/preview-data/route.ts#L19) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/publish/route.ts:22](../../../app/api/admin/schedules/[id]/publish/route.ts#L22) | A | A | requireFeature: schedules | requireScheduleAccess |
| GET [app/api/admin/schedules/[id]/route.ts:14](../../../app/api/admin/schedules/[id]/route.ts#L14) | A | A | requireFeature: schedules | requireArtifactAccess |
| PATCH [app/api/admin/schedules/[id]/route.ts:103](../../../app/api/admin/schedules/[id]/route.ts#L103) | A | A | requireFeature: schedules | requireArtifactAccess |
| DELETE [app/api/admin/schedules/[id]/route.ts:209](../../../app/api/admin/schedules/[id]/route.ts#L209) | A | A | requireFeature: schedules | requireScheduleAccess |
| PATCH [app/api/admin/schedules/[id]/rows/[rowId]/route.ts:14](../../../app/api/admin/schedules/[id]/rows/[rowId]/route.ts#L14) | A | A | requireFeature: schedules | requireScheduleAccess |
| DELETE [app/api/admin/schedules/[id]/rows/[rowId]/route.ts:80](../../../app/api/admin/schedules/[id]/rows/[rowId]/route.ts#L80) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/rows/reorder/route.ts:16](../../../app/api/admin/schedules/[id]/rows/reorder/route.ts#L16) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/rows/route.ts:16](../../../app/api/admin/schedules/[id]/rows/route.ts#L16) | A | A | requireFeature: schedules | requireScheduleAccess |
| PATCH [app/api/admin/schedules/[id]/sections/[sectionId]/route.ts:13](../../../app/api/admin/schedules/[id]/sections/[sectionId]/route.ts#L13) | A | A | requireFeature: schedules | requireScheduleAccess |
| DELETE [app/api/admin/schedules/[id]/sections/[sectionId]/route.ts:74](../../../app/api/admin/schedules/[id]/sections/[sectionId]/route.ts#L74) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/sections/reorder/route.ts:15](../../../app/api/admin/schedules/[id]/sections/reorder/route.ts#L15) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/sections/route.ts:41](../../../app/api/admin/schedules/[id]/sections/route.ts#L41) | A | A | requireFeature: schedules | requireScheduleAccess |
| POST [app/api/admin/schedules/[id]/share/route.ts:29](../../../app/api/admin/schedules/[id]/share/route.ts#L29) | A | A | requireFeature: schedules | requireScheduleAccess |
| DELETE [app/api/admin/schedules/[id]/share/route.ts:168](../../../app/api/admin/schedules/[id]/share/route.ts#L168) | A | A | requireFeature: schedules | requireScheduleAccess |
| GET [app/api/admin/schedules/route.ts:20](../../../app/api/admin/schedules/route.ts#L20) | A | A | requireFeature: schedules | scopedOrgIds |
| POST [app/api/admin/schedules/route.ts:185](../../../app/api/admin/schedules/route.ts#L185) | A | A | requireFeature: schedules | requireArtifactAccess |
| GET [app/api/admin/schedules/templates/[id]/route.ts:11](../../../app/api/admin/schedules/templates/[id]/route.ts#L11) | B | B | requireFeature: schedules | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/schedules/templates/[id]/route.ts:27](../../../app/api/admin/schedules/templates/[id]/route.ts#L27) | B | B | requireFeature: schedules | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/schedules/templates/[id]/route.ts:49](../../../app/api/admin/schedules/templates/[id]/route.ts#L49) | B | B | requireFeature: schedules | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/schedules/templates/route.ts:12](../../../app/api/admin/schedules/templates/route.ts#L12) | B | B | requireFeature: schedules | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/schedules/templates/route.ts:37](../../../app/api/admin/schedules/templates/route.ts#L37) | B | B | requireFeature: schedules | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/search/route.ts:57](../../../app/api/admin/search/route.ts#L57) | A | A | resolvePermissions and per-group can checks | scopedOrgIds SQL predicate before each group LIMIT |
| POST [app/api/admin/seed/route.ts:14](../../../app/api/admin/seed/route.ts#L14) | C | B | requireFeature: settings; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PATCH [app/api/admin/services/[id]/route.ts:26](../../../app/api/admin/services/[id]/route.ts#L26) | C | A | requireFeature: billing | requireAccessToOrg |
| GET [app/api/admin/services/coupons/route.ts:31](../../../app/api/admin/services/coupons/route.ts#L31) | C | B | requireFeature: billing | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/services/coupons/route.ts:56](../../../app/api/admin/services/coupons/route.ts#L56) | C | B | requireFeature: billing | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/services/coupons/route.ts:116](../../../app/api/admin/services/coupons/route.ts#L116) | C | B | requireFeature: billing | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/services/route.ts:27](../../../app/api/admin/services/route.ts#L27) | C | A | requireFeature: billing | requireAccessToOrg |
| POST [app/api/admin/services/route.ts:83](../../../app/api/admin/services/route.ts#L83) | C | A | requireFeature: billing | requireAccessToOrg |
| GET [app/api/admin/settings/route.ts:81](../../../app/api/admin/settings/route.ts#L81) | C | B | requireFeature: settings; resolved admin role | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PATCH [app/api/admin/settings/route.ts:137](../../../app/api/admin/settings/route.ts#L137) | B | B | requireFeature: settings; resolved admin role; super_admin | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/sitemap/export/route.ts:62](../../../app/api/admin/sitemap/export/route.ts#L62) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/nodes/[id]/duplicate/route.ts:21](../../../app/api/admin/sitemap/nodes/[id]/duplicate/route.ts#L21) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/nodes/[id]/review-all/route.ts:39](../../../app/api/admin/sitemap/nodes/[id]/review-all/route.ts#L39) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/nodes/[id]/review/route.ts:33](../../../app/api/admin/sitemap/nodes/[id]/review/route.ts#L33) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/sitemap/nodes/[id]/route.ts:30](../../../app/api/admin/sitemap/nodes/[id]/route.ts#L30) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/sitemap/nodes/[id]/route.ts:50](../../../app/api/admin/sitemap/nodes/[id]/route.ts#L50) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/sitemap/nodes/[id]/route.ts:78](../../../app/api/admin/sitemap/nodes/[id]/route.ts#L78) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/sitemap/nodes/route.ts:17](../../../app/api/admin/sitemap/nodes/route.ts#L17) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/nodes/route.ts:39](../../../app/api/admin/sitemap/nodes/route.ts#L39) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| GET [app/api/admin/sitemap/review-site/route.ts:129](../../../app/api/admin/sitemap/review-site/route.ts#L129) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/review-site/route.ts:40](../../../app/api/admin/sitemap/review-site/route.ts#L40) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/sitemap/seed-current/route.ts:268](../../../app/api/admin/sitemap/seed-current/route.ts#L268) | B | B | assertSitemapApiAccess (founder emails or api-service) | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/subscriptions/[id]/change-cycle/route.ts:19](../../../app/api/admin/subscriptions/[id]/change-cycle/route.ts#L19) | C | A | requireFeature({ userId, orgId }, 'billing') | requireAccessToOrg |
| GET [app/api/admin/subscriptions/[id]/route.ts:24](../../../app/api/admin/subscriptions/[id]/route.ts#L24) | C | A | requireFeature({ userId, orgId }, 'billing') | requireAccessToOrg |
| PUT [app/api/admin/subscriptions/[id]/route.ts:90](../../../app/api/admin/subscriptions/[id]/route.ts#L90) | C | A | requireFeature({ userId, orgId }, 'billing') | requireAccessToOrg |
| DELETE [app/api/admin/subscriptions/[id]/route.ts:202](../../../app/api/admin/subscriptions/[id]/route.ts#L202) | C | A | requireFeature({ userId, orgId }, 'billing') | requireAccessToOrg |
| GET [app/api/admin/subscriptions/route.ts:15](../../../app/api/admin/subscriptions/route.ts#L15) | C | A | requireFeature({ userId, orgId }, 'billing') | scopedOrgIds |
| POST [app/api/admin/task-suggestions/[id]/decide/route.ts:61](../../../app/api/admin/task-suggestions/[id]/decide/route.ts#L61) | A | A | requireFeature({ userId, orgId }, ['tasks', 'requests']) | guardSuggestion |
| POST [app/api/admin/task-suggestions/decide-bulk/route.ts:36](../../../app/api/admin/task-suggestions/decide-bulk/route.ts#L36) | A | A | requireFeature({ userId, orgId }, ['tasks', 'requests']) | guardSuggestion |
| POST [app/api/admin/task-suggestions/rebuild/route.ts:221](../../../app/api/admin/task-suggestions/rebuild/route.ts#L221) | A | A | requireFeature({ userId, orgId }, ['tasks', 'requests']) | resolveAccessScoping |
| GET [app/api/admin/task-suggestions/route.ts:23](../../../app/api/admin/task-suggestions/route.ts#L23) | A | A | requireFeature({ userId, orgId }, ['tasks', 'requests']) | resolveAccessScoping |
| PATCH [app/api/admin/task-templates/[id]/route.ts:10](../../../app/api/admin/task-templates/[id]/route.ts#L10) | C | A | requireFeature({ userId, orgId }, 'tasks') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| DELETE [app/api/admin/task-templates/[id]/route.ts:94](../../../app/api/admin/task-templates/[id]/route.ts#L94) | C | A | requireFeature({ userId, orgId }, 'tasks') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| GET [app/api/admin/task-templates/route.ts:19](../../../app/api/admin/task-templates/route.ts#L19) | C | A | requireFeature({ userId, orgId }, 'tasks') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| POST [app/api/admin/task-templates/route.ts:71](../../../app/api/admin/task-templates/route.ts#L71) | C | A | requireFeature({ userId, orgId }, 'tasks') | requireAccessToOrg on query/body/stored-row org; global configuration has no client owner |
| DELETE [app/api/admin/tasks/[id]/blockers/[linkId]/route.ts:7](../../../app/api/admin/tasks/[id]/blockers/[linkId]/route.ts#L7) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, task write library and blocker guards |
| GET [app/api/admin/tasks/[id]/blockers/route.ts:13](../../../app/api/admin/tasks/[id]/blockers/route.ts#L13) | C | A | requireFeature({ userId, orgId }, 'tasks') | guardSubject; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/tasks/[id]/blockers/route.ts:31](../../../app/api/admin/tasks/[id]/blockers/route.ts#L31) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, task write library and blocker guards |
| GET [app/api/admin/tasks/[id]/calls/route.ts:19](../../../app/api/admin/tasks/[id]/calls/route.ts#L19) | C | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, listCallsForParent |
| POST [app/api/admin/tasks/[id]/calls/route.ts:36](../../../app/api/admin/tasks/[id]/calls/route.ts#L36) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| GET [app/api/admin/tasks/[id]/comments/route.ts:62](../../../app/api/admin/tasks/[id]/comments/route.ts#L62) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| POST [app/api/admin/tasks/[id]/comments/route.ts:103](../../../app/api/admin/tasks/[id]/comments/route.ts#L103) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| DELETE [app/api/admin/tasks/[id]/dependencies/[depId]/route.ts:12](../../../app/api/admin/tasks/[id]/dependencies/[depId]/route.ts#L12) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, task write library and blocker guards |
| GET [app/api/admin/tasks/[id]/dependencies/route.ts:35](../../../app/api/admin/tasks/[id]/dependencies/route.ts#L35) | C | A | requireFeature({ userId, orgId }, 'tasks') | guardSubject; every linked org-owned row restricted and cross-feature blocker metadata redacted |
| POST [app/api/admin/tasks/[id]/dependencies/route.ts:56](../../../app/api/admin/tasks/[id]/dependencies/route.ts#L56) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, task write library and blocker guards |
| POST [app/api/admin/tasks/[id]/promote/route.ts:37](../../../app/api/admin/tasks/[id]/promote/route.ts#L37) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| GET [app/api/admin/tasks/[id]/route.ts:16](../../../app/api/admin/tasks/[id]/route.ts#L16) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| PATCH [app/api/admin/tasks/[id]/route.ts:78](../../../app/api/admin/tasks/[id]/route.ts#L78) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| DELETE [app/api/admin/tasks/[id]/route.ts:114](../../../app/api/admin/tasks/[id]/route.ts#L114) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| PATCH [app/api/admin/tasks/[id]/subtasks/[subId]/route.ts:10](../../../app/api/admin/tasks/[id]/subtasks/[subId]/route.ts#L10) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| DELETE [app/api/admin/tasks/[id]/subtasks/[subId]/route.ts:60](../../../app/api/admin/tasks/[id]/subtasks/[subId]/route.ts#L60) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| GET [app/api/admin/tasks/[id]/subtasks/route.ts:10](../../../app/api/admin/tasks/[id]/subtasks/route.ts#L10) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| POST [app/api/admin/tasks/[id]/subtasks/route.ts:47](../../../app/api/admin/tasks/[id]/subtasks/route.ts#L47) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask |
| PATCH [app/api/admin/tasks/bulk/route.ts:50](../../../app/api/admin/tasks/bulk/route.ts#L50) | A | A | requireFeature({ userId, orgId }, 'tasks') | scopedOrgIds, resolveAccessScoping |
| POST [app/api/admin/tasks/from-template/route.ts:24](../../../app/api/admin/tasks/from-template/route.ts#L24) | C | A | requireFeature({ userId, orgId }, 'tasks') | requireAccessToOrg |
| GET [app/api/admin/tasks/route.ts:13](../../../app/api/admin/tasks/route.ts#L13) | A | A | requireFeature({ userId, orgId }, 'tasks') | scopedOrgIds, resolveAccessScoping |
| POST [app/api/admin/tasks/route.ts:181](../../../app/api/admin/tasks/route.ts#L181) | A | A | requireFeature({ userId, orgId }, 'tasks') | guardTask, task write library and blocker guards |
| GET [app/api/admin/team-members/route.ts:8](../../../app/api/admin/team-members/route.ts#L8) | B | B | Studio-authenticated lite collaboration roster for mentions and assignment pickers, no employment, compensation, capacity or Clerk identity fields. | Studio-authenticated lite collaboration roster for mentions and assignment pickers, no employment, compensation, capacity or Clerk identity fields. |
| GET [app/api/admin/team/[id]/access/route.ts:13](../../../app/api/admin/team/[id]/access/route.ts#L13) | C | B | canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PUT [app/api/admin/team/[id]/access/route.ts:57](../../../app/api/admin/team/[id]/access/route.ts#L57) | C | B | requireFeature: settings.permissions; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/team/[id]/invite/route.ts:48](../../../app/api/admin/team/[id]/invite/route.ts#L48) | B | B | requireFeature: team; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| PUT [app/api/admin/team/[id]/route.ts:20](../../../app/api/admin/team/[id]/route.ts#L20) | B | B | requireFeature: team; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| DELETE [app/api/admin/team/[id]/route.ts:100](../../../app/api/admin/team/[id]/route.ts#L100) | B | B | requireFeature: team; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| POST [app/api/admin/team/accept-invite/route.ts:35](../../../app/api/admin/team/accept-invite/route.ts#L35) | B | B | Signed-in verified email-bound, expiring single-use invite, atomically claimed before membership. | Signed-in verified email-bound, expiring single-use invite, atomically claimed before membership. |
| GET [app/api/admin/team/org-chart/route.ts:9](../../../app/api/admin/team/org-chart/route.ts#L9) | C | B | requireFeature: team | Studio-owned data, no client organisation ownership. |
| GET [app/api/admin/team/route.ts:22](../../../app/api/admin/team/route.ts#L22) | B | B | requireFeature: team | Team feature gates full roster; studio-authenticated denied seats retain the deliberate lite collaboration projection. |
| POST [app/api/admin/team/route.ts:60](../../../app/api/admin/team/route.ts#L60) | B | B | requireFeature: team; canManagePermissions | Full-workspace operation restricted by existing feature and resolved admin/super-admin permission, or verified scheduler secret. |
| GET [app/api/admin/time-entries/route.ts:61](../../../app/api/admin/time-entries/route.ts#L61) | C | A | requireFeature({ userId, orgId }, 'time') | requireAccessToOrg on requested parent plus scopedOrgIds row-org SQL fence; internal org admitted for studio tasks |
| POST [app/api/admin/time-entries/route.ts:132](../../../app/api/admin/time-entries/route.ts#L132) | C | A | requireFeature({ userId, orgId }, 'time') | requireAccessToOrg |
| DELETE [app/api/admin/time/[id]/route.ts:11](../../../app/api/admin/time/[id]/route.ts#L11) | C | A | requireFeature({ userId, orgId }, 'time') | requireAccessToOrg |
| GET [app/api/admin/time/route.ts:22](../../../app/api/admin/time/route.ts#L22) | C | A | requireFeature({ userId, orgId }, 'time') | scopedOrgIds |
| POST [app/api/admin/time/route.ts:154](../../../app/api/admin/time/route.ts#L154) | C | A | requireFeature({ userId, orgId: authOrgId }, 'time') | requireAccessToOrg |
| POST [app/api/admin/time/stamp-invoiced/route.ts:76](../../../app/api/admin/time/stamp-invoiced/route.ts#L76) | C | A | requireFeature({ orgId, userId }, 'billing') | requireAccessToOrg, scopedOrgIds |
| PATCH [app/api/admin/timers/[id]/route.ts:27](../../../app/api/admin/timers/[id]/route.ts#L27) | C | A | requireFeature({ userId, orgId }, 'time') | requireTimerAccess; verified service/admin bypass before target lookup, POST retains existence validation |
| DELETE [app/api/admin/timers/[id]/route.ts:97](../../../app/api/admin/timers/[id]/route.ts#L97) | C | A | requireFeature({ userId, orgId }, 'time') | requireTimerAccess; verified service/admin bypass before target lookup, POST retains existence validation |
| POST [app/api/admin/timers/ping/route.ts:22](../../../app/api/admin/timers/ping/route.ts#L22) | C | A | requireFeature({ userId, orgId }, 'time') | requireTimerAccess; verified service/admin bypass before target lookup, POST retains existence validation |
| GET [app/api/admin/timers/route.ts:34](../../../app/api/admin/timers/route.ts#L34) | C | A | requireFeature({ userId, orgId }, 'time') | requireTimerAccess; verified service/admin bypass before target lookup, POST retains existence validation |
| POST [app/api/admin/timers/route.ts:99](../../../app/api/admin/timers/route.ts#L99) | C | A | requireFeature({ userId, orgId }, 'time') | requireTimerAccess; verified service/admin bypass before target lookup, POST retains existence validation |
| PUT [app/api/admin/tracks/[trackId]/reorder/route.ts:11](../../../app/api/admin/tracks/[trackId]/reorder/route.ts#L11) | A | A | requireFeature({ userId, orgId }, 'requests') | requireAccessToOrg |
| GET [app/api/admin/views/route.ts:15](../../../app/api/admin/views/route.ts#L15) | C | A | requireAdminResource: owning schedules, proposals or contracts feature | requireAdminResource |
| GET [app/api/admin/views/sections/route.ts:19](../../../app/api/admin/views/sections/route.ts#L19) | C | A | requireAdminResource: owning schedules, proposals or contracts feature | requireAdminResource |
| GET [app/api/admin/webhooks/route.ts:24](../../../app/api/admin/webhooks/route.ts#L24) | B | B | requireFeature: settings.integrations | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| POST [app/api/admin/webhooks/route.ts:59](../../../app/api/admin/webhooks/route.ts#L59) | B | B | requireFeature: settings.integrations | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| PATCH [app/api/admin/webhooks/route.ts:116](../../../app/api/admin/webhooks/route.ts#L116) | B | B | requireFeature: settings.integrations | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |
| DELETE [app/api/admin/webhooks/route.ts:185](../../../app/api/admin/webhooks/route.ts#L185) | B | B | requireFeature: settings.integrations | Studio-global configuration, templates, pre-client lead data, or explicit full-workspace admin/service operation. |

## Verified test files

- [app/api/__tests__/admin-clients-default-pm.test.ts](../../../app/api/__tests__/admin-clients-default-pm.test.ts)
- [app/api/__tests__/admin-clients-invite.test.ts](../../../app/api/__tests__/admin-clients-invite.test.ts)
- [app/api/__tests__/admin-clients-plan-default.test.ts](../../../app/api/__tests__/admin-clients-plan-default.test.ts)
- [app/api/__tests__/admin-clients.test.ts](../../../app/api/__tests__/admin-clients.test.ts)
- [app/api/__tests__/admin-conversation-message-mentions.test.ts](../../../app/api/__tests__/admin-conversation-message-mentions.test.ts)
- [app/api/__tests__/admin-crons-list.test.ts](../../../app/api/__tests__/admin-crons-list.test.ts)
- [app/api/__tests__/admin-feedback-delete.test.ts](../../../app/api/__tests__/admin-feedback-delete.test.ts)
- [app/api/__tests__/admin-feedback-get.test.ts](../../../app/api/__tests__/admin-feedback-get.test.ts)
- [app/api/__tests__/admin-invoice-dedupe-manyrequests.test.ts](../../../app/api/__tests__/admin-invoice-dedupe-manyrequests.test.ts)
- [app/api/__tests__/admin-invoice-dedupe-stripe.test.ts](../../../app/api/__tests__/admin-invoice-dedupe-stripe.test.ts)
- [app/api/__tests__/admin-invoice-numbers.test.ts](../../../app/api/__tests__/admin-invoice-numbers.test.ts)
- [app/api/__tests__/admin-invoice-xero-push.test.ts](../../../app/api/__tests__/admin-invoice-xero-push.test.ts)
- [app/api/__tests__/admin-recording-chunks.test.ts](../../../app/api/__tests__/admin-recording-chunks.test.ts)
- [app/api/__tests__/admin-request-message-gates.test.ts](../../../app/api/__tests__/admin-request-message-gates.test.ts)
- [app/api/__tests__/admin-request-thread.test.ts](../../../app/api/__tests__/admin-request-thread.test.ts)
- [app/api/__tests__/admin-requests-create-status.test.ts](../../../app/api/__tests__/admin-requests-create-status.test.ts)
- [app/api/__tests__/admin-requests-scoping.test.ts](../../../app/api/__tests__/admin-requests-scoping.test.ts)
- [app/api/__tests__/admin-requests.test.ts](../../../app/api/__tests__/admin-requests.test.ts)
- [app/api/__tests__/admin-route-guard-walk.test.ts](../../../app/api/__tests__/admin-route-guard-walk.test.ts)
- [app/api/__tests__/admin-scoping-routes.test.ts](../../../app/api/__tests__/admin-scoping-routes.test.ts)
- [app/api/__tests__/admin-settings-default-pm.test.ts](../../../app/api/__tests__/admin-settings-default-pm.test.ts)
- [app/api/__tests__/admin-settings-email-delivery.test.ts](../../../app/api/__tests__/admin-settings-email-delivery.test.ts)
- [app/api/__tests__/admin-settings-invoice-channel.test.ts](../../../app/api/__tests__/admin-settings-invoice-channel.test.ts)
- [app/api/__tests__/admin-settings-studio-pm.test.ts](../../../app/api/__tests__/admin-settings-studio-pm.test.ts)
- [app/api/__tests__/admin-subscription-delete.test.ts](../../../app/api/__tests__/admin-subscription-delete.test.ts)
- [app/api/__tests__/admin-time-entries.test.ts](../../../app/api/__tests__/admin-time-entries.test.ts)
- [app/api/__tests__/admin-time-entry-owner.test.ts](../../../app/api/__tests__/admin-time-entry-owner.test.ts)
- [app/api/__tests__/admin-time-rate.test.ts](../../../app/api/__tests__/admin-time-rate.test.ts)
- [app/api/__tests__/admin-timers.test.ts](../../../app/api/__tests__/admin-timers.test.ts)
- [app/api/__tests__/ai-predict-fields.test.ts](../../../app/api/__tests__/ai-predict-fields.test.ts)
- [app/api/__tests__/airwallex-sync-yield-marker.test.ts](../../../app/api/__tests__/airwallex-sync-yield-marker.test.ts)
- [app/api/__tests__/billing-hourly-export.test.ts](../../../app/api/__tests__/billing-hourly-export.test.ts)
- [app/api/__tests__/billing-invoice-flow.test.ts](../../../app/api/__tests__/billing-invoice-flow.test.ts)
- [app/api/__tests__/bulk-assign-assignee.test.ts](../../../app/api/__tests__/bulk-assign-assignee.test.ts)
- [app/api/__tests__/dashboard-guide.test.ts](../../../app/api/__tests__/dashboard-guide.test.ts)
- [app/api/__tests__/invoice-aging-buckets.test.ts](../../../app/api/__tests__/invoice-aging-buckets.test.ts)
- [app/api/__tests__/invoice-drafts-not-owed.test.ts](../../../app/api/__tests__/invoice-drafts-not-owed.test.ts)
- [app/api/__tests__/invoice-ledger-routes.test.ts](../../../app/api/__tests__/invoice-ledger-routes.test.ts)
- [app/api/__tests__/mcp-actor-attribution-routes.test.ts](../../../app/api/__tests__/mcp-actor-attribution-routes.test.ts)
- [app/api/__tests__/mcp-calls-meeting-type-parity.test.ts](../../../app/api/__tests__/mcp-calls-meeting-type-parity.test.ts)
- [app/api/__tests__/messages-routes.test.ts](../../../app/api/__tests__/messages-routes.test.ts)
- [app/api/__tests__/nested-client-scope-sqlite.test.ts](../../../app/api/__tests__/nested-client-scope-sqlite.test.ts)
- [app/api/__tests__/onboarding-invites-mint.test.ts](../../../app/api/__tests__/onboarding-invites-mint.test.ts)
- [app/api/__tests__/overview-replies-waiting.test.ts](../../../app/api/__tests__/overview-replies-waiting.test.ts)
- [app/api/__tests__/permission-write-guards.test.ts](../../../app/api/__tests__/permission-write-guards.test.ts)
- [app/api/__tests__/permissions-route-guards.test.ts](../../../app/api/__tests__/permissions-route-guards.test.ts)
- [app/api/__tests__/pipeline-capacity.test.ts](../../../app/api/__tests__/pipeline-capacity.test.ts)
- [app/api/__tests__/pipeline-stages-put.test.ts](../../../app/api/__tests__/pipeline-stages-put.test.ts)
- [app/api/__tests__/public-lead-secret.test.ts](../../../app/api/__tests__/public-lead-secret.test.ts)
- [app/api/__tests__/request-assignment-ping.test.ts](../../../app/api/__tests__/request-assignment-ping.test.ts)
- [app/api/__tests__/request-auto-handback.test.ts](../../../app/api/__tests__/request-auto-handback.test.ts)
- [app/api/__tests__/request-status-fanout.test.ts](../../../app/api/__tests__/request-status-fanout.test.ts)
- [app/api/__tests__/services-org-scope.test.ts](../../../app/api/__tests__/services-org-scope.test.ts)
- [app/api/__tests__/snapshot-metrics-route.test.ts](../../../app/api/__tests__/snapshot-metrics-route.test.ts)
- [app/api/__tests__/t1-6-internal-routes.test.ts](../../../app/api/__tests__/t1-6-internal-routes.test.ts)
- [app/api/__tests__/t1-6-org-routes.test.ts](../../../app/api/__tests__/t1-6-org-routes.test.ts)
- [app/api/__tests__/t1-6-support-routes.test.ts](../../../app/api/__tests__/t1-6-support-routes.test.ts)
- [app/api/__tests__/time-stamp-invoiced.test.ts](../../../app/api/__tests__/time-stamp-invoiced.test.ts)
- [app/api/__tests__/xero-contact-identity-sqlite.test.ts](../../../app/api/__tests__/xero-contact-identity-sqlite.test.ts)
- [app/api/__tests__/xero-import-sync-routes.test.ts](../../../app/api/__tests__/xero-import-sync-routes.test.ts)
- [app/api/admin/call-transcripts/__tests__/list-scope.test.ts](../../../app/api/admin/call-transcripts/__tests__/list-scope.test.ts)
- [app/api/admin/call-transcripts/__tests__/patch-link.test.ts](../../../app/api/admin/call-transcripts/__tests__/patch-link.test.ts)
- [app/api/admin/calls/__tests__/patch-link-fields.test.ts](../../../app/api/admin/calls/__tests__/patch-link-fields.test.ts)
- [app/api/admin/calls/__tests__/prep-note.test.ts](../../../app/api/admin/calls/__tests__/prep-note.test.ts)
- [app/api/admin/calls/__tests__/reminder-window.test.ts](../../../app/api/admin/calls/__tests__/reminder-window.test.ts)
- [app/api/admin/discovery-calls/__tests__/patch-link-fields.test.ts](../../../app/api/admin/discovery-calls/__tests__/patch-link-fields.test.ts)
- [app/api/admin/discovery-calls/__tests__/prep-note.test.ts](../../../app/api/admin/discovery-calls/__tests__/prep-note.test.ts)
- [app/api/admin/integrations/google/__tests__/sync-calendar-meeting-type.test.ts](../../../app/api/admin/integrations/google/__tests__/sync-calendar-meeting-type.test.ts)
- [app/api/admin/integrations/google/__tests__/sync-drive-transcripts.test.ts](../../../app/api/admin/integrations/google/__tests__/sync-drive-transcripts.test.ts)
- [app/api/admin/requests/[id]/__tests__/handoff.test.ts](../../../app/api/admin/requests/[id]/__tests__/handoff.test.ts)
- [app/api/admin/requests/[id]/__tests__/participants.test.ts](../../../app/api/admin/requests/[id]/__tests__/participants.test.ts)
- [app/api/admin/requests/__tests__/waiting-on.test.ts](../../../app/api/admin/requests/__tests__/waiting-on.test.ts)
- [app/api/admin/task-suggestions/__tests__/suggestion-release-guards-sqlite.test.ts](../../../app/api/admin/task-suggestions/__tests__/suggestion-release-guards-sqlite.test.ts)
- [app/api/admin/tasks/__tests__/tasks-from-template.test.ts](../../../app/api/admin/tasks/__tests__/tasks-from-template.test.ts)
- [app/api/portal/requests/__tests__/waiting-on.test.ts](../../../app/api/portal/requests/__tests__/waiting-on.test.ts)
- [lib/__tests__/calls-meeting-type.test.ts](../../../lib/__tests__/calls-meeting-type.test.ts)
- [lib/__tests__/cron-secret.test.ts](../../../lib/__tests__/cron-secret.test.ts)
- [lib/__tests__/messages-store.test.ts](../../../lib/__tests__/messages-store.test.ts)
- [lib/__tests__/request-handoff.test.ts](../../../lib/__tests__/request-handoff.test.ts)
- [lib/__tests__/route-org-filter.test.ts](../../../lib/__tests__/route-org-filter.test.ts)
- [lib/__tests__/tahi-bot.test.ts](../../../lib/__tests__/tahi-bot.test.ts)
- [lib/calls.test.ts](../../../lib/calls.test.ts)
- [lib/overview-brief.test.ts](../../../lib/overview-brief.test.ts)
