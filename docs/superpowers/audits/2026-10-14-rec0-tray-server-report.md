# REC.0 phase 2 dashboard report

Prepared uncommitted on feat/rec0-tray-server, base 729cc282. Initial git status
was clean. No commit, push, deploy, migration apply, secret change or production
data write. No C# project was built; apps/recorder-tray contains a handoff README.

## Separable migration change

Ship only these files first:

- lib/recorder-devices-migration.ts:2, the import-free constant SQL array.
- drizzle/migrations/0114_recorder_devices.sql:1, the matching standalone SQL.
- app/api/admin/db/migrate/route.ts:2475, registration and its single import.

Exactly four tables and five explicit indexes, plus the specified token-hash
and device/client-reference uniqueness. Every statement uses CREATE IF NOT
EXISTS; no ALTER or runtime device code is introduced in those three files.
Apply 0114 BEFORE deploying the remainder. The later server change includes
matching db/schema.ts:2162 declarations. Migration tests verify re-running,
preservation of existing parent recordings and actual SQLite constraints.

## Implementation by spec section

- Device auth: lib/recorder-device-auth.ts:54 checks token hash, revocation,
  current member/Clerk identity, admin permission, 15-minute Clerk membership
  cache, retryable 503, idle expiry and five-minute last-seen throttling.
  getRequestAuth is unchanged. lib/meeting-recordings-server.ts:119 explicitly
  opts in each handler; middleware.ts:147 and lib/recorder-device-routes.ts:6
  reject recorder bearers elsewhere, even on public routes.
- Pairing: lib/recorder-devices.ts:23 authorizes the original caller before
  selecting owned rows. Code issuance at :66 requires a real Clerk session;
  exchange at :91 reserves rate-limit attempts atomically, rechecks expiry
  after Clerk, consumes the code and inserts the hashed device in one D1
  transaction. Admin routes are under app/api/admin/recorder-devices; public
  exchange is app/api/public/recorder/pair/route.ts:4. Pairing intentionally has
  no MCP tool. No plaintext code or token is persisted server-side.
- Recording APIs: lib/meeting-recordings-server.ts:244 atomically creates an
  idempotent recording with clientRef and the side row, revalidates callId,
  and enforces one open recording. lib/recorder-recordings.ts:34 fences reads
  to device and member; :41 returns only state/counts/chunk confirmation.
  Daily quota at :63 counts reserved PCM audio across both tracks per UTC day.
  Reservation at lib/meeting-recordings-server.ts:333 and upload at :395 check
  actual WAV duration/format before storage. Chunk, stop and transcribe handlers
  opt in; DELETE and link refuse devices. Busy leases retain retry semantics.
  Device duplicate is true only after storage, so unsent local audio survives.
- Upcoming calls: app/api/admin/recordings/upcoming-calls/route.ts:5 uses
  lib/recorder-upcoming-calls.ts:46 for parsed instant filtering, membership in
  attendees and platform derivation. :60 reads both call tables and preserves
  ordinary callers' client scope. No raw URL or attendee detail is returned.
- Settings and source: components/tahi/settings/sections/recorder-devices.tsx:48
  provides loading, empty, error, active, revoked, pair/expiry and confirm states.
  components/tahi/settings/settings-shell.tsx:82 adds role-gated navigation.
  app/(dashboard)/calls/record/call-recorder-content.tsx:594 shows Tray from the
  side-table source flag. ConfirmDialog received touch/overflow/loading polish;
  the new Settings instance portals outside its animated parent.
- MCP: workers/mcp-server/src/index.ts:1270 defines list_recorder_devices and
  revoke_recorder_device, dispatch at :2847. Both are explicitly blocked for
  designers in workers/mcp-server/src/tool-profiles.ts:126. deviceId is validated
  before constructing its URL. A recorded actor cannot upgrade caller authority.
- Tests: app/api/__tests__/recorder-device-routes.test.ts:29 walks every API
  route across seven HTTP methods. Auth/pairing tests start at
  app/api/__tests__/recorder-device-auth-pairing.test.ts:115; recording/create,
  slim ownership, quotas and call revalidation at recorder-recordings.test.ts:124;
  UI states/actions at components/tahi/__tests__/recorder-devices.test.tsx:69.
  New MCP, upcoming filter and migration tests cover the remaining contracts.
- Docs and hygiene: DECISIONS.md:1657 records #072, live WAV evidence, Liam's
  fixed capture/no-notice decisions, accepted exposure and MCP exception.
  STATUS.md:6 and TASKS.md:1331 retain REC.0 as open. The run log entry begins
  at docs/superpowers/plans/2026-09-13-overnight-run-log.md:1185. Next tracing,
  TypeScript, ESLint, Vitest and Tailwind exclude apps/recorder-tray; nested
  bin/obj are ignored. docs/recorder-tray-server-handoff.md gives wire contracts
  and ship order; apps/recorder-tray/README.md gives the later publish command.

## Verification

Final fail-closed chain:

```text
npm run type-check                                  exit 0
CI=1 npm run lint                                   exit 0, existing warnings
tsc --noEmit -p workers/mcp-server/tsconfig.json      exit 0
Vitest native sandbox runner                        16 files, 344 tests passed
git diff --check                                    exit 0
```

The first aggregate run caught two SSR revoke fixtures missing the newly
portaled document context. The fixture now stubs document and passes portals
through; the final combined gate passes. Existing overlay, invoice-action,
browser recorder, middleware, transcript and MCP regressions are included.
Independent backend/security and UIUX source reviews pass.

Ignored raw logs: .wrangler/rec0-tray-type-check.log, rec0-tray-lint.log,
rec0-tray-worker-tsc.log and rec0-tray-vitest.log.

## Open verification

CI=1 npm run build reached optimized compilation and stopped with spawn EPERM
(exit 1); .wrangler/rec0-tray-build.log retains output. Playwright Chromium
launch also hits spawn EPERM. A successful production build and actual signed-in
375/768/desktop light/dark render are still required outside this sandbox.
No live/browser QA is claimed for the new phase 2 code. Main session owns
security/Opus review, migration-first apply, deployment, public health probes
and signed-in smoke. The separate C# run owns real pairing, automatic call
detection, capture/outbox/restart and real-call transcript validation.
