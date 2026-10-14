# REC.0 tray server review fixes

Started clean on feat/rec0-tray-server at e961108f, after migration-only
97b0b0ae. All repair changes remain uncommitted. No push, deploy, migration
apply, secret change or production operation. The three protected migration
files and db/schema.ts have no diff. Authorisation uses the original caller.

## Findings resolved

1. Window overlap: lib/recorder-upcoming-calls.ts:77. Create revalidation at
   lib/meeting-recordings-server.ts:264 links only inside the open-now window.
   Stale, ongoing 20-minute/60-minute, exact-boundary and expired calls are
   tested in app/api/__tests__/recorder-recordings.test.ts:175 and
   lib/recorder-upcoming-calls.test.ts:28. Handoff corrected at
   docs/recorder-tray-server-handoff.md:115. External spec is read-only under
   this session's workspace permissions; corrected complete copy is
   docs/rec0-tray-spec-review-correction.md:68, ready for the main session to
   replace C:/Users/Work/.codex-briefs/rec0-tray-spec.md. Original is unchanged.
2. Member-specific calendar matching: lib/recorder-upcoming-calls.ts:72.
   Google metadata stores account email but no connecting member identity;
   account ownership therefore uses the member email. Creator matching uses
   stored Clerk/member ids. Cross-member, actor and access tests are included.
3. Stuck recordings: lib/meeting-recordings-server.ts:262 excludes open rows
   older than 13 hours. Empty stops at :518 fail terminally with a clear error;
   :498, :507 and :677 preserve that state on stop/transcribe retries.
4. Rolling microphone-only quota: lib/recorder-recordings.ts:58 and :63;
   Decision #072 at DECISIONS.md:1669. Seven two-track hours are accepted.
5. Distinct 429 codes: lib/meeting-recordings-server.ts:296 and :390.
6. callId without callKind: lib/meeting-recordings-server.ts:249 returns 400;
   docs/recorder-tray-server-handoff.md:64 documents it.
7. Not this call: docs/recorder-tray-server-handoff.md:125 and
   DECISIONS.md:1663 restrict the tray action to before create is sent.
8. Pairing limits: lib/recorder-pairing-security.ts:4 normalizes IPv6 /64;
   lib/recorder-devices.ts:116 atomically enforces fifty global failures and
   five per prefix per fifteen minutes; :74 invalidates older unused codes.
9. IP privacy/retention: lib/recorder-pairing-security.ts:24 uses HKDF-derived
   HMAC from an existing secret; lib/recorder-devices.ts:111 purges old attempts.
10. Pairing audits: lib/recorder-devices.ts:81 and :156. Creation identifies the
    member because no device exists yet; successful pairing identifies the
    device id. Neither code nor token nor hashes are in audit details.
11. Batched list chunks: lib/meeting-recordings-server.ts:340 uses one chunk
    query for all owned list rows. A query-count and cross-device test proves it.
12. Coarse scheduled_at bounds: lib/recorder-upcoming-calls.ts:94 before
    precise parsed-instant filtering in both call tables.
13. Explicit recording INSERT column list: lib/meeting-recordings-server.ts:272.
14. Recorder devices UI: components/tahi/settings/sections/recorder-devices.tsx:43
    checks status before success JSON and handles non-JSON errors; :69 and :82
    poll and hide used codes; :169 uses EmptyState with CTA; :184 uses Badge.
15. Shared ConfirmDialog restored exactly to e961108f^; local viewport portal
    and long-name wrapping stay at recorder-devices.tsx:201. No feature-specific
    changes remain in the shared component relative to its pre-feature version.
16. Commit state corrected in DECISIONS.md:1659, handoff:4, STATUS.md:10 and
    TASKS.md:1336. Original implementation is committed, this repair is not.

## Verification

Fail-closed requested chain passed:

```text
npm run type-check                              exit 0
CI=1 npm run lint                               exit 0, existing warnings
tsc --noEmit -p workers/mcp-server/tsconfig.json  exit 0
Vitest                                          16 files passed, 373 tests passed
git diff --check                                exit 0
```

Vitest uses the existing ignored .claude/vitest-sandbox.config.mjs with
--configLoader native; standard esbuild startup is blocked by spawn EPERM.
Raw logs are .wrangler/rec0-tray-review-type-check.log,
.wrangler/rec0-tray-review-lint.log, .wrangler/rec0-tray-review-worker-tsc.log
and .wrangler/rec0-tray-review-vitest.log. Independent QA and UIUX source
reviews pass. QA found a replay that could reopen an empty stopped recording;
it is fixed and covered. UIUX found long-name dialog overflow; local inherited
wrapping fixes it without changing ConfirmDialog. Browser/rendered 375/768/dark
and live QA are not claimed; shipping remains the main session's work.
