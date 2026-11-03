# Site QA viewport set: a viewport registry, per-round viewport sets and the Overview subset (SQA.8, provisional id)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Revision 2, 2026-11-03, Opus (planning only; no application code was changed to write it).

> **Correction, 2026-11-03 (supersedes every "deployed by Liam" statement below).** `workers/mcp-server` and `workers/qa-view` auto-deploy through GitHub Actions on any push to main that touches their path filters (`.github/workflows/mcp-worker-deploy.yml` filters `workers/mcp-server/**`; `qa-view-deploy.yml` filters `workers/qa-view/**` and `lib/qa/**`). There is no manual worker deploy step. Consequences for this plan: (1) the push that carries T12 deploys the MCP worker at the same time as the dashboard, in parallel workflows, so the stale-worker window in the rollout matrix is minutes, not "until Liam deploys"; keep the dashboard-first ordering by making the backwards-compatible readers (push 1) ship well before the writers and the MCP change (push 2). (2) If the MCP worker imports `lib/qa/viewports.ts`, add that path to the `mcp-worker-deploy.yml` filter so a registry change redeploys the worker; the earlier "deliberately not done" note is withdrawn. (3) Verify each worker deploy with `gh run list --workflow "MCP worker deploy"` and `"QA view worker deploy"`, and check the real conclusion (do not rely on the exit code of a piped command). Claude sessions started before the deploy do not see changed tool descriptions until a fresh session.

**Goal:** replace the fixed five Site QA viewports with a registry of named devices. A new round gets the 11 core devices by default and can opt in to 5 niche ones; the Overview shows a 4-frame subset scaled side by side; Inspect mode (built on another branch) steps 1:1 through every viewport of the round. Every existing round, scan, comment and tick made with the legacy five keys keeps working untouched.

**Architecture:** one pure, zero-import module `lib/qa/viewports.ts` holds the registry (legacy, core, niche) and every rule derived from it (round set parsing, primary viewport, scan-all frames, Overview frames, Webflow breakpoint text, where a tick is stored). `qa_rounds` gains one nullable text column `viewports` (migration 0121): NULL means a legacy round with the five legacy keys, a JSON array means the round's chosen keys. Ticks reuse the existing generic row table `qa_browser_ticks` (round page, browser, viewport) for everything except Chromium ticks on the five legacy keys, which stay in the `qa_round_pages.vp_*` columns exactly as today. No data is moved, rewritten or deleted.

**Tech stack:** Next.js 15 App Router, Drizzle on D1, the qa-view proxy worker (unchanged), the MCP worker, Vitest, Playwright.

**Read first:** CLAUDE.md, AGENTS.md (Site QA bullets at lines 57 to 59, MCP profile rule at line 54, migration rules at lines 46 and 50), docs/superpowers/plans/2026-10-26-site-qa-tester.md, docs/superpowers/plans/2026-10-27-site-qa-wide-pages-comments.md, docs/superpowers/plans/2026-10-27-site-qa-local-engine.md (sections 1.8, 7.1, 7.2), TASKS.md SQA entries (lines 1406 to 1454).

Line numbers below are from main at e0001ad0. Inspect mode will move the lines in round-workspace.tsx, viewport-strip.tsx and viewport-frame.tsx; re-grep before editing those three files.

---

## 0. Goal, constraints, definition of done, risks

Goal: as above.

Constraints:
- Legacy keys `xl`, `desktop`, `tablet`, `mobile_l`, `mobile_p` keep their exact dimensions (1920x1080, 1440x900, 768x1024, 425x860, 375x812), their labels and their storage. A legacy round renders, ticks, scans, comments and reports exactly as it does today.
- Production never breaks during rollout: the migration lands first, readers that understand both shapes ship before any writer creates a new-shape round, and the default for a new round flips to core only in the same push as the UI that can show it.
- MCP parity (CLAUDE.md rule 14): every dashboard capability added here (choose a round's viewports, change them, tick, comment and file requests on the new keys) is reachable through the worker MCP. The MCP worker deploys through its own GitHub Actions workflow on the push to main that touches its path filter (see the correction at the top).
- No `any`, no console.log, no em dashes, en dashes or double hyphens anywhere (code, comments, copy, SQL comments), rem units, CSS vars, 44px touch targets, no single-side borders, guard order getRequestAuth > isTahiAdmin > requireFeature('qa_tester') > requireAdmin on every route, at most 100 bound parameters per D1 statement, never export non-route symbols from route.ts.

Definition of done:
1. Every task below checked, with its tests.
2. `npm run type-check`, `npm run lint`, the full vitest suite and `npm run build` pass.
3. Migration 0121 applied on production BEFORE push 1 and on the seeded local D1, verified with `PRAGMA table_info(qa_rounds)`, recorded in the run log.
4. Push 1 and push 2 deployed ("Deploy dashboard" and, because lib/qa changes, "qa-view deploy" both green), the post-deploy health probe passes (AGENTS.md line 51).
5. Live smoke on portal.tahi.studio: an existing legacy round unchanged; a new core round; a round with niche devices; Inspect steps through all of a round's viewports; report correct (section 14).
6. 375px (no sideways scroll, 44px targets) and dark mode checked on the workspace, the start round dialog, the edit viewports dialog and the report.
7. "MCP worker deploy" workflow green for the push that carries T12 (checked with gh run list, real conclusion), MCP smoke passed.
8. security-reviewer passed the write paths; opus-reviewer passed each push and the whole against this request; AGENTS.md, STATUS.md, TASKS.md, DECISIONS.md and the run log updated.

Irreversible: only migration 0121 (an additive nullable column). Everything else is a code change and reverts cleanly (section 8.4).

Risks, highest first (details and mitigations in section 8 and section 10):
1. Width collisions between legacy and new keys (1920, 1440, 768 and 375 appear in both tiers). Anything that maps a width to a key would file data against the wrong key. Mitigation: nothing maps by width any more; scan-all maps a scan to its hidden frame by window, as the visible strip already does.
2. Stale MCP worker: today's `viewportTicks` (workers/mcp-server/src/qa-tools.ts lines 76 to 85) silently drops every key that is not one of the five, so ticking a new round through a stale worker loses the tick (it fails loudly only when nothing else was in the call). Mitigation in section 8.3.
3. D1 bound parameter cap: a tick PATCH can now carry up to 16 viewport keys; at 7 binds per qa_browser_ticks row (8 after SQA.5's `via`) plus 2 in the SET clause, one insert would exceed 100. Mitigation: chunk the upsert at 10 rows, with a test.
4. Deploy before migration: db/schema.ts naming `qa_rounds.viewports` makes every full-row `select().from(qaRounds)` fail with "no such column" until 0121 is applied. Mitigation: apply before the push, verify with PRAGMA, T0 and G1 gates.
5. Merge conflicts with Inspect mode (another branch, same three workspace files) and with SQA.5 (local engine, 0120 `via`, same tick upsert and tick readers). Mitigation: section 9 sequencing.
6. Tick volume: 11 viewports x up to 3 browsers is 33 ticks per page. This is Liam's decision; the UI needs a compact tick control and rail indicator, designed first (T6).

---

## 1. Decided by Liam (do not re-litigate)

- A registry replaces lib/qa/types.ts QA_VIEWPORTS.
- CORE (11, the default for every new round): Phone S 360x800 dpr 3; Phone M 393x852 dpr 3; Phone L 430x932 dpr 3; Phone landscape 852x393 dpr 3; Small tablet 600x960 dpr 2; Tablet portrait 768x1024 dpr 2; Tablet landscape 1024x768 dpr 2; Laptop S 1366x650 dpr 1; Laptop M 1440x780 dpr 2; Laptop L 1536x730 dpr 1.25; Desktop 1920x950 dpr 1.
- NICHE (opt in): Small phone 375x667 dpr 2; Narrow foldable 344x882 dpr 2.625; iPad Pro tall 1032x1376 dpr 2; QHD 2560x1300 dpr 1; Ultrawide 3440x1300 dpr 1.
- Heights are realistic viewport heights (screen minus browser chrome).
- The Overview shows only a subset of 4 to 5 frames, as a registry flag (which frames is a plan choice, section 2.1). Inspect steps through all of a round's viewports.
- Existing rounds, scans, comments and ticks keep the legacy five keys and keep working; legacy keys are frozen, flagged legacy, and shown for old rounds only.

---

## 2. The registry

### 2.1 Machine keys (proposed and decided here)

Key rules, recorded in AGENTS.md by T14: lower case snake case matching `^[a-z][a-z0-9_]{0,23}$`; a key is never renamed, reused or removed; a key's width and height never change once shipped (a different size is a new key), because comments store element boxes and ticks mean "checked at this size".

| key | label | short | width x height | dpr | tier | kind | overview |
|---|---|---|---|---|---|---|---|
| xl | XL | XL | 1920 x 1080 | 1 | legacy | desktop | yes |
| desktop | Desktop | Desk | 1440 x 900 | 1 | legacy | desktop | yes |
| tablet | Tablet | Tab | 768 x 1024 | 1 | legacy | tablet | yes |
| mobile_l | Mobile L | ML | 425 x 860 | 1 | legacy | phone | yes |
| mobile_p | Mobile P | MP | 375 x 812 | 1 | legacy | phone | yes |
| phone_s | Phone S | PS | 360 x 800 | 3 | core | phone | no |
| phone_m | Phone M | PM | 393 x 852 | 3 | core | phone | yes |
| phone_l | Phone L | PL | 430 x 932 | 3 | core | phone | no |
| phone_landscape | Phone landscape | PLand | 852 x 393 | 3 | core | phone | no |
| tablet_s | Small tablet | TS | 600 x 960 | 2 | core | tablet | no |
| tablet_portrait | Tablet portrait | TP | 768 x 1024 | 2 | core | tablet | yes |
| tablet_landscape | Tablet landscape | TL | 1024 x 768 | 2 | core | tablet | no |
| laptop_s | Laptop S | LS | 1366 x 650 | 1 | core | laptop | no |
| laptop_m | Laptop M | LM | 1440 x 780 | 2 | core | laptop | yes |
| laptop_l | Laptop L | LL | 1536 x 730 | 1.25 | core | laptop | no |
| desktop_fhd | Desktop | D | 1920 x 950 | 1 | core | desktop | yes |
| phone_compact | Small phone | PC | 375 x 667 | 2 | niche | phone | no |
| fold_narrow | Narrow foldable | F | 344 x 882 | 2.625 | niche | phone | no |
| tablet_pro | iPad Pro tall | TPro | 1032 x 1376 | 2 | niche | tablet | no |
| desktop_qhd | QHD | QHD | 2560 x 1300 | 1 | niche | desktop | no |
| desktop_ultrawide | Ultrawide | UW | 3440 x 1300 | 1 | niche | desktop | no |

Notes:
- The new 1920 device cannot be `desktop`: that key is the frozen legacy 1440x900. Its label is "Desktop" as Liam named it; the legacy `desktop` keeps the label "Desktop" too. Labels are unique inside each selectable set (legacy; core plus niche) and never across tiers, so code looks viewports up by key only, never by label. A test pins this.
- The new 768x1024 device is `tablet_portrait`, not a reuse of legacy `tablet`, so legacy stays frozen and no key ever belongs to two tiers.
- Legacy rows carry dpr 1 because the old list recorded none. In the iframe transport dpr is metadata only (an iframe cannot emulate devicePixelRatio): it is shown in Inspect, returned by MCP, and available to the SQA.5 engine helper as `deviceScaleFactor`. Consequence worth knowing: the oversized-image rule uses the host monitor's devicePixelRatio (workers/qa-view/src/scanner/collect.ts:122), not the device's.
- Array order is display order: legacy in today's order (largest first, so legacy rounds look the same), then core and niche in Liam's listed order (smallest first). Whether the new Overview reads phone to desktop or desktop to phone is a design point for T6; the default is Liam's listing order.
- The Overview subset is phone_m, tablet_portrait, laptop_m, desktop_fhd: one per kind, laptop_m is also the primary scan viewport, and the four frames need about the same strip width at a shared row height as today's five (sum of width/height ratios 5.08 versus 5.08), so Fit width and Wide mode behave the same. Adding a fifth is a one-word flag change.

### 2.2 Module contract: `lib/qa/viewports.ts` (new, pure, ZERO imports)

Zero imports because the MCP worker imports it by relative path (it already does this with lib/mcp-identity, workers/mcp-server/src/index.ts line 49). lib/qa/types.ts re-exports everything below.

```ts
export type QaViewportTier = 'core' | 'niche' | 'legacy'
export type QaViewportKind = 'phone' | 'tablet' | 'laptop' | 'desktop'

/** Shape check for the literal below; key is a plain string here because QaViewportKey derives from it. */
interface QaViewportDefInput {
  key: string; label: string; shortLabel: string
  width: number; height: number; dpr: number
  tier: QaViewportTier; kind: QaViewportKind; overview: boolean
}

export const QA_VIEWPORT_REGISTRY = [
  { key: 'xl', label: 'XL', shortLabel: 'XL', width: 1920, height: 1080, dpr: 1, tier: 'legacy', kind: 'desktop', overview: true },
  // ... every row of the table in 2.1, in that order
] as const satisfies readonly QaViewportDefInput[]

export type QaViewportKey = (typeof QA_VIEWPORT_REGISTRY)[number]['key']
export interface QaViewportDef {
  key: QaViewportKey; label: string; shortLabel: string
  width: number; height: number; dpr: number
  tier: QaViewportTier; kind: QaViewportKind; overview: boolean
}

export const QA_LEGACY_VIEWPORT_KEYS: readonly QaViewportKey[]      // xl, desktop, tablet, mobile_l, mobile_p
export const QA_CORE_VIEWPORT_KEYS: readonly QaViewportKey[]        // the 11, registry order
export const QA_NICHE_VIEWPORT_KEYS: readonly QaViewportKey[]       // the 5, registry order
export const QA_SELECTABLE_VIEWPORT_KEYS: readonly QaViewportKey[]  // core then niche (16)
export const QA_VIEWPORT_KEY_PATTERN: RegExp                        // /^[a-z][a-z0-9_]{0,23}$/

export function isQaViewportKey(value: unknown): value is QaViewportKey
export function isLegacyViewportKey(key: string): boolean
export function viewportDef(key: string): QaViewportDef | null
/** Registry label, or the key itself for an unknown key (never throws). */
export function viewportLabel(key: string): string
export function viewportDefsFor(keys: readonly string[]): QaViewportDef[]   // registry order, unknown dropped

/** qa_rounds.viewports. NULL or undefined: the legacy five. A JSON array: its known non-legacy keys in
 *  registry order, de-duplicated. Non-null but unreadable, not an array, or no usable key: the core set
 *  (only new code writes non-null values, and it only writes non-legacy keys). Never throws. */
export function parseRoundViewports(raw: string | null | undefined): QaViewportKey[]
export function isLegacyRoundViewports(raw: string | null | undefined): boolean   // raw === null || raw === undefined
export function serialiseRoundViewports(keys: readonly QaViewportKey[]): string  // JSON, registry order

/** A viewports value from a request body. Non-empty array of selectable keys; an array longer than 50 items is refused.
 *  Errors: not an array or empty; a legacy key ("xl is a legacy viewport: only rounds made before the
 *  viewport set use it"); an unknown key (echoed sliced to 40 characters). Returns registry order, de-duplicated. */
export function parseViewportInput(value: unknown): { ok: true; keys: QaViewportKey[] } | { ok: false; error: string }

/** Preference for the scan that supplies SEO, links, a11y and duplicate meta. */
export const QA_PRIMARY_PREFERENCE: readonly QaViewportKey[] =
  ['desktop', 'laptop_m', 'laptop_l', 'laptop_s', 'desktop_fhd', 'xl', 'tablet_landscape', 'tablet_pro', 'desktop_qhd', 'desktop_ultrawide']
/** First key of the preference list present in keys, else the first present key in registry order, else null. */
export function primaryViewportFor(keys: Iterable<string>): QaViewportKey | null
/** The hidden Scan all frames: [primary, narrowest key by width] de-duplicated. Legacy gives
 *  ['desktop', 'mobile_p'] (today's SCAN_ALL_VIEWPORTS), core gives ['laptop_m', 'phone_s']. */
export function scanAllViewportsFor(keys: readonly QaViewportKey[]): QaViewportKey[]
/** Overview frames: the keys flagged overview, registry order. When fewer than 2 are flagged, the
 *  set's own keys in registry order, at most 4. Legacy gives all five. */
export function overviewViewportsFor(keys: readonly QaViewportKey[]): QaViewportKey[]
/** Webflow breakpoint guidance. Legacy keys return today's exact strings (lib/qa/comments.ts lines 274
 *  to 280). Other keys: by width (>= 1920, >= 1440, >= 1280, >= 992 Desktop (base), >= 768 Tablet
 *  (991px and below), >= 480 Mobile landscape (767px and below), else Mobile portrait (479px and below))
 *  plus "; this frame is <width>px wide". */
export function webflowBreakpointFor(key: QaViewportKey): string
/** Where a tick lives: 'column' (qa_round_pages.vp_*) only for chromium on a legacy key, else 'row'. */
export function tickStoreFor(browser: string, key: string): 'column' | 'row'
/** The vp_* column of a legacy key (xl: vpXl, desktop: vpDesktop, tablet: vpTablet, mobile_l: vpMobileL,
 *  mobile_p: vpMobileP), null for any other key. */
export function legacyTickColumn(key: string): 'vpXl' | 'vpDesktop' | 'vpTablet' | 'vpMobileL' | 'vpMobileP' | null
```

Counts: legacy 5, core 11, niche 5, 21 keys in all; 16 selectable.

---

## 3. Inventory: everything that depends on the five keys

Every row says what changes and which task owns it. "Registry lookup" means `viewportDef(key)` or `viewportLabel(key)`; "round set" means `parseRoundViewports(round.viewports)`.

### 3.1 Shared types and pure logic

| File:lines | Today | Change | Task |
|---|---|---|---|
| lib/qa/types.ts:6-12 | QA_VIEWPORTS, five entries | Removed; registry lives in lib/qa/viewports.ts and is re-exported. A deprecated alias `QA_VIEWPORTS = legacy five defs` stays until T13 | T1, T13 |
| lib/qa/types.ts:14-15 | QaViewportKey union of five, QA_VIEWPORT_KEYS | QaViewportKey becomes all 21 keys (re-export). QA_VIEWPORT_KEYS kept as deprecated alias of the legacy five until T13 | T1, T13 |
| lib/qa/types.ts:16-17 | QA_PRIMARY_VIEWPORT = 'desktop' | Replaced by primaryViewportFor(keys); alias kept until T13 | T1, T3, T13 |
| lib/qa/types.ts:220, 246-252, 262, 282 | QaComment.viewport, QaViewportInfo, QaIssue.viewport | Types widen automatically. QaViewportInfo gains additive `dpr: number`, `tier: QaViewportTier`, `kind: QaViewportKind` | T1, T5b |
| lib/qa/types.ts:321-324 | viewportByWidth | Deleted in T13 (its only caller, scan-all.ts:80, stops using it in T7). Width is ambiguous across tiers | T7, T13 |
| lib/qa/browsers.ts:69-73 | QaBrowserTickMap = Record of five, emptyTickMap literal | `Partial<Record<QaViewportKey, boolean>>`; missing means false; emptyTickMap(keys) fills the given keys with false | T1, T3 |
| lib/qa/browsers.ts:75-92 | ChromiumTickColumns, chromiumTicks | Kept for legacy rounds only | T3 |
| lib/qa/browsers.ts:109-127 | mergeBrowserTicks skips chromium rows and unknown viewports | Takes the round set; reads chromium rows for non-legacy keys; skips rows whose viewport is outside the set; still skips chromium rows on legacy keys (the column wins) | T3 |
| lib/qa/browsers.ts:130-140 | countTicks over five | Takes the round set | T3 |
| lib/qa/issue-rules.ts:8, 44-46, 100-107 | primary = scans.desktop ?? first | primary = scans[primaryViewportFor(Object.keys(scans))] | T3 |
| lib/qa/server.ts:64-77 | scansByBrowser(rows, browsers) | Optional third parameter: the round set; rows outside it hidden like a removed browser | T3 |
| lib/qa/server.ts:93-120 | recomputeCounts | Passes the round set to scansByBrowser | T3 |
| lib/qa/comments.ts:274-285 | WEBFLOW_BREAKPOINTS record of five; viewportInfoFor with QA_VIEWPORTS[1] fallback | webflowBreakpointFor from the registry; viewportInfoFor returns dpr, tier, kind; unknown stored key keeps today's fallback (legacy desktop def) | T5b |
| lib/qa/comments.ts:332-334 | parseCommentInput accepts the five | Accepts any registry key (syntax); the route checks the round set | T5b |
| lib/qa/category-summary.ts, lib/qa/pagespeed.ts | PageSpeed `mobile` and `desktop` | No change: these are Google PSI strategies, not viewport keys. Never map them to viewport keys | none |
| workers/qa-view/src/scanner/index.ts:58, collect.ts:106 and 122, context.ts:73-74 | scanner reports window.innerWidth and uses the real devicePixelRatio | No change. The scanner never knows a key. The qa-view worker redeploys anyway because its workflow watches lib/qa/** (.github/workflows/qa-view-deploy.yml lines 21 to 24); watch it go green | none |

### 3.2 Database and migrations

| File:lines | Today | Change | Task |
|---|---|---|---|
| db/schema.ts:4347-4366 qaRounds | browsers JSON column (0118) | Add `viewports: text('viewports')`, nullable, NO `.default()` (drizzle binds JS defaults on insert, so a default would stamp old-shape inserts; NULL must mean legacy) | T2 |
| db/schema.ts:4375-4379 qaRoundPages vp_* | Chromium ticks for the five | Unchanged. Comment updated: "Chromium ticks on the five legacy viewports only" | T2 |
| db/schema.ts:4416-4428 qaBrowserTicks | Firefox and WebKit ticks, one row per (round page, browser, viewport), unique index | Unchanged schema. Comment updated: "every tick except Chromium ticks on legacy viewports" | T2 |
| db/schema.ts:4404-4414 qaScanResults, 4444-4450 qaComments | viewport text | Unchanged (text already holds any key) | none |
| drizzle/migrations/0115 (line 9), 0118, lib/qa-migration.ts | vp_* columns, qa_browser_ticks | Untouched | none |
| drizzle/migrations/0121_qa_round_viewports.sql (new), lib/qa-migration.ts, app/api/admin/db/migrate/route.ts:2500-2505 | runner entries up to 0119 | New 0121 (section 4.4). 0120 stays reserved for SQA.5 qa_via | T2 |
| lib/__tests__/qa-migration.test.ts:35-36 | the 0119 block uses `/s+/g` (strips the letter s) instead of `/\s+/g` | Fix to `/\s+/g` while adding the 0121 block | T2 |

### 3.3 API routes

| File:lines | Today | Change | Task |
|---|---|---|---|
| app/api/admin/qa/sites/[id]/rounds/route.ts:22, 53-65, 90-104 | counts: vp_* sum for chromium, grouped tick rows per browser, total = pages x 5 x browsers | Group tick rows by (round, browser, viewport); count only rows in the round's browsers and set, excluding chromium rows on legacy keys; column sum only for legacy rounds; total = pages x set size x browsers | T4a |
| same file:122-139, 189-202 | POST body name, target, browsers | Accepts optional `viewports` (parseViewportInput). Push 1: omitted means NULL (legacy, today's behaviour). Push 2 (T9): omitted means the core set. Response item carries resolved `viewports` | T4a, T9 |
| app/api/admin/qa/rounds/[id]/route.ts:57-74, 92-102 | tick rows queried only when a non-chromium browser exists | Always query tick rows (one bound parameter); merge with the round set; return `round.viewports` (resolved keys), `round.legacyViewports` (boolean) and top-level `viewportDefs` (registry defs of the set plus webflowBreakpoint) | T4a |
| same file:113-179 | PATCH name, status, browsers | Accepts `viewports` (full list). 400 bad input; 404; 409 closed; 400 on a legacy round ("This round keeps the five viewports it was made with. Start a new round to use the new set."); stores canonical JSON; recounts pages with scans in a changed viewport (same MAX_RECOMPUTE 40 pattern, recomputeSkipped) | T4a |
| app/api/admin/qa/sites/route.ts:10, 65-68, 75, 85-104, 114 | site list tick progress from vp_* plus grouped rows | Same counting rule as T4a, per open round | T4b |
| app/api/admin/qa/rounds/[id]/report/route.ts:12, 74-97, 112, 117, 155 | ticks literal of five, total x 5, tick rows only with non-chromium | Always query rows; pages[].ticks = legacy: today's column map; new: browserTicks.chromium ?? {}; ticksTotal by set size; round.viewports, viewportDefs; comment entries add `viewportLabel` | T4b |
| app/api/admin/qa/round-pages/[id]/route.ts:13, 34, 49-57 | VP_COLUMNS map and docs | Docs updated; VP_COLUMNS replaced by legacyTickColumn | T5a |
| same file:84-108 | GET: ticks merge; duplicate meta reads viewport = QA_PRIMARY_VIEWPORT | Merge with the round set; duplicate meta reads `eq(viewport, primaryViewportFor(roundSet))`; returns `viewports` | T5a |
| same file:174-181, 208-231 | PATCH vp keys must be one of five; chromium to columns, others upsert rows | Syntax check: every key isQaViewportKey (400 "Unknown viewport k") and boolean; after 404, 409 closed and the browser-not-in-round 400, a set check (400 "viewport k is not part of this round (it uses: ...)"); split by tickStoreFor; row upsert chunked at 10 rows; response `{ item: { ...row, ...update, browserTicks } }` with this page's merged ticks | T5a |
| app/api/admin/qa/round-pages/[id]/scan/route.ts:3, 19, 39-42, 72-78 | viewport must be one of five | isQaViewportKey at validation; set check after the browser check; upsert unchanged (still targets all three columns of the unique index) | T5b |
| app/api/admin/qa/round-pages/[id]/comments/route.ts:96-120 | browser check after parse | Add the set check after the browser check | T5b |
| app/api/admin/qa/round-pages/[id]/create-request/route.ts:10, 49-54, 79 | viewport must be one of five; label from QA_VIEWPORTS | Any registry key accepted (a request can come from an old comment on a viewport later removed from the round); label and size from the registry | T5b |
| app/api/admin/qa/round-pages/[id]/pagespeed/route.ts | strategy mobile or desktop | No change | none |
| app/api/admin/qa/rounds/[id]/comments/route.ts, comments/[id] routes, notes routes | read and edit comments | No change: comments on a viewport removed from the round still list (same as a removed browser) | none |

### 3.4 Workspace and report UI

| File:lines | Today | Change | Task |
|---|---|---|---|
| workspace/qa-types.ts:1, 12-16, 32, 35-49, 80-88, 126-171 | QaTickMap of five, emptyTicks literal, ticksFor reads vp_* for chromium, tickCount, browserBreakdown total 5 | QaRoundRow gains `viewports`, `legacyViewports`; QaRoundResponse gains `viewportDefs`; QaTickMap Partial; ticksFor/tickCount/browserBreakdown/pageRowTitle take the round set; chromium column fallback only for legacy keys | T1 (types compile), T7 |
| workspace/use-round.ts:22-52, 59-76, 240-251 | applyPagePatch writes vp_* for chromium; submitScan runs the link check when viewport is 'desktop' | vp_* only where tickStoreFor says column; rollback normalises undefined to false; link check when viewport === primaryViewportFor(round set) | T7 |
| workspace/scan-all.ts:4, 8-9, 51-53, 67-96, 141-142 | SCAN_ALL_VIEWPORTS desktop and mobile_p; maps scans with viewportByWidth | Frames from scanAllViewportsFor(round set) (an option of useScanAll); a scan is mapped to its hidden frame by `contentWindow === event.source` only; frameSrc a Partial record | T7 |
| workspace/comments-helpers.ts:82-93, 193-201, 297, 316 | grouping, viewportForSource and saved view parse iterate QA_VIEWPORTS | Grouping in registry order over all keys; viewportForSource iterates the frames record; saved hiddenViewports accept any registry key | T7 |
| workspace/scroll-helpers.ts:34-39 | relayTargets filters QA_VIEWPORTS order | Iterates `visible` in its own order | T7 |
| workspace/use-comments.ts:10, 46, 244 | QaViewportKey types | Types only | T1 |
| workspace/round-workspace.tsx:15, 27, 76, 94-95, 225, 255-258, 314, 320, 342-347, 371, 409-415, 606, 846, 1074, 1081-1094, 1156, 1179-1185 | QA_VIEWPORTS everywhere, MOBILE_DEFAULT 'desktop', emptyStates literal, issue default 'desktop', totals x 5, tick group of five, composer label, hidden scan frames | Round set drives everything: Overview frames = overviewViewportsFor(set); Inspect list = set; single-frame default = primaryViewportFor(set); scan states keyed by the set; showIssue without a viewport targets the primary (opening Inspect on it when it is not in the Overview); showComment opens Inspect when its viewport is not in the Overview; totals by set size; tick control per T6 design; composer label from the registry; hidden frames from scanAllViewportsFor | T1 (compile only), T8b |
| workspace/viewport-strip.tsx:6, 54-87, 102, 140, 264-267, 287, 310, 407, 414-424, 433, 495 | zoom math over QA_VIEWPORTS, SHORT_LABEL record, switcher of five | Zoom math takes the frames to fit as a parameter (rowRemForZoom(zoom, width, ceiling, frames), actualSizeWidthPx(frames), actualSizeFits(width, frames)); a `frames` prop (the Overview defs) and an `allViewports` prop (the round set, for the single-frame switcher); short labels from the registry; switcher per T6 (a select when more than 5) | T1 (compile only), T8a |
| workspace/viewport-frame.tsx:4-8, 39, 140 | QaViewportDef = typeof QA_VIEWPORTS item; COMPACT_LABEL record | QaViewportDef from the registry; compact label = def.shortLabel; shows dpr in the label bar tooltip | T1 (compile only), T8a |
| workspace/page-rail.tsx:8, 58, 80, 168, 194-210 | five dots per row, totals x 5 | Dots when the set has at most 5 viewports (legacy looks the same); otherwise the T6 design (for example a done/total count or a per-kind mini bar); totals by set | T8b |
| workspace/comment-view-control.tsx:7, 42, 137-143 | filter lists QA_VIEWPORTS that are visible | Lists the round set in registry order, plus hidden keys of the same tier only (the saved view key 'tahi-qa-comment-view' is global, comments-helpers.ts:282, so a hidden legacy `desktop` must not show next to `desktop_fhd`, both labelled Desktop); labels from the registry; wraps at 375px | T8b |
| workspace/issue-panel.tsx:9, 38-46, 110, 277 | viewportLabel via QA_VIEWPORTS; seoScan = scans.desktop ?? first | Registry label; seoScan = scans[primaryViewportFor(keys)] | T8b |
| workspace/issue-panel-detail.tsx:180 | run('desktop') | PageSpeed strategy, no change | none |
| workspace/comments-tab.tsx:70, 245 | renders groups from comments-helpers | No change beyond what T7 feeds it | none |
| qa/[siteId]/start-round-dialog.tsx:9, 44-82, 131-160 | name, target, browsers | Viewport picker per T6 (core checked, niche unchecked under "More devices"), sends `viewports` | T9 |
| workspace/round-actions.tsx | round menu | "Viewports" action for open non-legacy rounds: the same picker, PATCH round viewports | T9 |
| qa/rounds/[id]/report/report-content.tsx:16, 22, 49-55, 85-87, 108, 209-210, 346, 472-525, 580, 592 | TICK_LABELS record, ticksOf literal, columns = QA_VIEWPORTS x browsers | Columns from round.viewports and viewportDefs; layout per T6 (33 columns do not fit); labels from the registry | T1 (compile only), T10 |
| qa/qa-sites-content.tsx, qa/[siteId]/site-content.tsx | show ticksDone / ticksTotal numbers | No code change; numbers come from T4 | none |

### 3.5 MCP worker

| File:lines | Today | Change | Task |
|---|---|---|---|
| workers/mcp-server/src/qa-tools.ts:31-32 | own VIEWPORT_KEYS copy of the five | Import QA_SELECTABLE_VIEWPORT_KEYS, QA_LEGACY_VIEWPORT_KEYS, QA_VIEWPORT_KEY_PATTERN from '../../../lib/qa/viewports' | T12 |
| same:76-85 viewportTicks | reads only the five, silently drops the rest | Passes every key matching the pattern; throws on a key that does not match ("viewports keys must be viewport keys such as phone_m"); the dashboard validates membership | T12 |
| same:139-146 start_qa_round, 215-226 update_qa_round | browsers only | Optional `viewports` array (non-empty, pattern-checked, de-duplicated) mapped to body.viewports; update error "name, status, browsers or viewports is required" | T12 |
| same:240-249 create_qa_request, 300-306 add_qa_comment | add_qa_comment refuses anything but the five | Pattern check only; dashboard decides | T12 |
| workers/mcp-server/src/index.ts:1725-1730, 1731-1733, 1734-1740, 1748-1750, 1768-1773, 1779-1781, 1782-1788, 1816-1826 | viewport enums of five, descriptions naming five | No JSON schema `enum` on any viewport argument (a stale tool schema must never refuse a newer key); descriptions list the core and niche keys and the legacy five, built from the imported constants; round tools gain `viewports`; read tools mention round.viewports and viewportDefs | T12 |
| workers/mcp-server/src/tool-profiles.ts:138-143 | every QA tool in DESIGNER_BLOCKED_TOOLS | No new tool, so no new classification. Any tool an implementer adds must be added there in the same commit (AGENTS.md line 54) | T12 |
| app/api/__tests__/mcp-qa-tool-parity.test.ts:168-210, 285-330 | five-key cases | Updated and extended (section 11) | T12 |
| mcp-server/index.ts (local stdio) | dormant | Do not touch (memory feedback_mcp_worker_only) | none |

### 3.6 Tests, fixtures, e2e and docs that name the five

lib/qa/__tests__/browsers.test.ts, comments.test.ts, issue-rules.test.ts, scanner-scroll-sync.test.ts (text only); workspace __tests__ comment-view.test.ts, comments-helpers.test.ts, qa-types.test.ts, scroll-helpers.test.ts, viewport-strip.test.ts; app/api/__tests__/admin-qa-request.test.ts, admin-qa-rounds.test.ts, admin-qa-sites.test.ts, mcp-qa-tool-parity.test.ts; lib/__tests__/qa-migration.test.ts; e2e/site-qa.spec.ts: every test creates its round through the Start round dialog (lines 75 to 77, 144 to 145, 184 to 194), so after T9's default flip every e2e round is core. Legacy keys are hard coded in lines 81 to 106 (Desktop frame, XL tick), 120 to 170 (375px single frame), 206 to 266 (five frame titles, "Comment on Desktop"), 307 to 380 (synced scroll: Tablet and Mobile P previews, titles list at 352) and 383 to 448 (browsers per round, XL checkbox at 401 to 444); line 111 opens the report. Docs: AGENTS.md lines 57 to 59, STATUS.md line 11, the earlier SQA plans (history, not edited).

---

## 4. Data model for ticks (decision)

### 4.1 What exists today

Ticks already have two homes: Chromium in five integer columns on qa_round_pages (migration 0115), Firefox and WebKit in qa_browser_ticks, which is already a generic one-row-per-tick table: (round_page_id, browser, viewport, ticked, updated_by, updated_at) with a unique index on (round_page_id, browser, viewport) (migration 0118, db/schema.ts lines 4418 to 4428). The brief's description of per-viewport columns on qa_browser_ticks does not match the code: only qa_round_pages has columns.

### 4.2 Options

A. More per-viewport columns (16 new integer columns on qa_round_pages for Chromium).
- A migration for every registry change, MCP and route maps per column, the site list sums columns in SQL.
- Drizzle binds JS defaults on insert, so the round page insert grows from 13 to 29 binds per row (app/api/admin/qa/sites/[id]/rounds/route.ts line 28 chunk would drop from 7 to 3 rows).
- Firefox and WebKit already use rows, so A leaves two models anyway. Rejected.

B. Rows for everything new, in the existing qa_browser_ticks table, legacy Chromium columns kept in place. Recommended.
- No tick migration at all: the table, its unique index and its upsert exist and are proven on production.
- Storage is a pure function: `tickStoreFor(browser, key)` is 'column' only for chromium plus a legacy key. A legacy round only contains legacy keys, so its Chromium ticks stay exactly where they are; a new round only contains new keys, so all of its ticks are rows.
- No backfill: nothing is copied out of the vp_* columns. Zero data movement means zero data risk, old deployed code keeps reading and writing legacy rounds the same way during the rollout, and every rollback is lossless. The cost is that two read paths live on (columns for legacy Chromium, rows for the rest); both are tiny and already tested. A one-way backfill can be done later if the legacy path ever becomes a burden; it is not needed for anything here.
- MCP parity is unchanged in shape: the tick API stays `vp: { <key>: boolean }` (MCP `viewports` object), only the allowed keys widen to the round's set, so no tool argument is renamed.
- Reporting: counts are `count(*)` grouped by (round, browser, viewport) on an indexed join, filtered in code by the round's browsers and set. Bounded: at most 90 rounds per chunk x 3 browsers x 16 viewports.
- SQA.5 compatibility: its `via` column (0120) lands on qa_browser_ticks and applies to the new Chromium rows unchanged (they are always native).

C. A JSON text column of ticks on qa_round_pages.
- Read-modify-write on every tick: two people ticking the same page (Liam and Staci) lose updates without a transaction or compare-and-swap; D1 has no row lock.
- No SQL counting without json_each; the 0120 `via` provenance would need nested JSON. Rejected.

Not chosen either: a brand new `qa_viewport_ticks` table. It would split ticks across three places (columns, qa_browser_ticks, the new table) or require moving the existing Firefox and WebKit rows. Reusing qa_browser_ticks gives the same shape with no migration. Its name now undersells it; the schema comment and AGENTS.md say what it holds.

### 4.3 Read and write rules (normative)

- Write (round-pages/[id] PATCH): for each `{ key: ticked }`: column store sets `update[legacyTickColumn(key)]`; row store upserts qa_browser_ticks `onConflictDoUpdate` on (roundPageId, browser, viewport) setting ticked, updatedBy, updatedAt, in chunks of 10 rows.
- Read (mergeBrowserTicks, renamed in place with an extra parameter): for each page and each round browser, a map with every key of the round set false; for a legacy round, Chromium legacy keys from the columns; then every row whose browser is in the round, whose viewport is in the set, and which is not a chromium row on a legacy key.
- Counting (countTicks, site list, site rounds): the same filter.
- Old deployed code during the rollout: mergeBrowserTicks today ignores chromium rows and unknown viewports (browsers.ts lines 121 and 122), so new-shape rows are invisible to it and never crash it.

### 4.4 Migration 0121 (Opus writes it, T2)

Next free number: 0119 is the last file in drizzle/migrations and the last runner entry (app/api/admin/db/migrate/route.ts lines 2500 to 2504); 0120 is reserved by SQA.5 for qa_via and not yet in the repo. This plan takes 0121 whether or not 0120 has shipped (runner entries are keyed by name; a gap is harmless).

drizzle/migrations/0121_qa_round_viewports.sql:

```sql
/* Migration 0121: Site QA viewport set per round.
   qa_rounds.viewports holds the JSON list of viewport keys a round covers (lib/qa/viewports.ts).
   NULL means a round made before the viewport set: it keeps the five legacy viewports, and its
   Chromium ticks stay in the qa_round_pages.vp_* columns. Every other tick lives in qa_browser_ticks.
   Nullable with no default on purpose, so rows written by older code read as legacy.
   SQLite has no ADD COLUMN IF NOT EXISTS. Re-run safe through the migrate runner's duplicate
   column catch (as 0117 and 0118 are): use the runner's '0121' for a re-run.
   Apply BEFORE deploying: db/schema.ts names the column, so full-row selects read it. */

ALTER TABLE qa_rounds ADD COLUMN viewports text;
```

lib/qa-migration.ts: `export const QA_ROUND_VIEWPORTS_MIGRATION = ['ALTER TABLE qa_rounds ADD COLUMN viewports text'] as const` with a doc comment like QA_COMMENT_CONTEXT_MIGRATION.

Runner entry after '0119': name '0121', description "Site QA viewport set: qa_rounds.viewports (nullable JSON list of viewport keys; NULL is a legacy round). ALTER ADD COLUMN; the runner treats "duplicate column name" as already applied. Apply BEFORE deploying: db/schema.ts names the column.", statements `[...QA_ROUND_VIEWPORTS_MIGRATION]`.

Production apply (Opus, before push 1, with Liam's go in the session; AGENTS.md line 46 says he wants the agent to run additive applies itself): `wrangler d1 execute tahi-db` with the remote flag and the command flag set to `ALTER TABLE qa_rounds ADD COLUMN viewports text`, run from the repo root (the dashboard's wrangler.json, never workers/qa-view's config). Verify with `PRAGMA table_info(qa_rounds)` showing `viewports`. Apply to the seeded local D1 the same way without the remote flag. Record both in docs/superpowers/plans/2026-09-13-overnight-run-log.md. A second run of the same command errors with "duplicate column name", which means it is already applied.

---

## 5. The round's viewport set

- Column: qa_rounds.viewports, NULL = legacy five, JSON array = chosen keys (registry order, only core and niche keys).
- A round's set is legacy for life. A legacy round never gains new keys; a new round never contains a legacy key (parseViewportInput refuses them). So a round is always entirely one shape, and width collisions inside a round cannot happen (widths are unique within legacy and within core plus niche; a test pins it).
- Choosing (new rounds): any non-empty subset of the 16 selectable keys. Default: the 11 core. Niche are opt in. Deselecting core devices is allowed (a quick live check on three devices is a real use); the tick totals follow the set.
- Changing (open new rounds only): PATCH /api/admin/qa/rounds/[id] `{ viewports }` with the full list. Removing a viewport keeps its ticks, scans and comments and only hides ticks and scans (exactly like removing a browser); adding it back restores them. Comments on a removed viewport still list and still open in Inspect when the round has that key; otherwise their pins are simply not drawn.
- Start round dialog (T9): a "Devices" fieldset under Browsers: the 11 core as checkboxes grouped by kind, checked; "More devices" disclosure with the 5 niche, unchecked; each option shows label and width x height; "Pick at least one device." validation; sends `viewports` always (explicit, so a future default change never surprises an open tab).
- Round menu (T9): "Devices" for an open non-legacy round, same picker prefilled, PATCH, toast with `recomputeSkipped` when not zero. Hidden for legacy and closed rounds.
- MCP: start_qa_round `viewports` (optional array; omitted is the core 11 after push 2), update_qa_round `viewports` (full list), get_qa_round returns `round.viewports`, `round.legacyViewports` and `viewportDefs`.

---

## 6. Primary viewport, Scan all, issues, PageSpeed

- New primary: `laptop_m` (1440x780) for core rounds. Same width as the legacy primary (`desktop`, 1440x900), so SEO, links, accessibility and duplicate-meta results stay comparable between old and new rounds of the same site; it is a core device and an Overview frame, so it scans on every page view. Legacy rounds keep `desktop`, because the preference list starts with it and a legacy round only has legacy keys. A custom round without laptop_m falls back along QA_PRIMARY_PREFERENCE, then to its first key.
- Migration story for old rounds: none needed. Their stored scans are keyed `desktop` and primaryViewportFor(legacy keys) is `desktop`, so issues, counts, duplicate meta and the link check read exactly what they read today. No stored scan is rewritten.
- Where the primary is used: issue-rules pageIssues and launchIssues (via the scans' own keys), round-pages GET duplicate meta (via the round set), use-round submitScan link check (via the round set), issue-panel seoScan, round-workspace showIssue default. All call primaryViewportFor; nothing names a key literally.
- Scan all: still two hidden frames per page, primary plus the narrowest viewport of the set (legacy: desktop and mobile_p, unchanged; core: laptop_m and phone_s; with niche: laptop_m and fold_narrow). Mapped by frame window, never by width (1440 and 375 exist in two tiers). The other viewports scan when they are shown (Overview frames on load, Inspect frame on load), as today. Whether Scan all should cover every viewport is open question 1.
- PageSpeed: unchanged. `mobile` and `desktop` are Google strategies on the live URL and are not viewport keys.

---

## 7. MCP parity and the designer profile

Changed tools (all stay in DESIGNER_BLOCKED_TOOLS; no new tool is added, so tool-profiles.ts and lib/mcp-designer-routes.ts do not change):

| Tool | Change |
|---|---|
| start_qa_round | + `viewports` array, optional. Description: core keys (default), niche keys (opt in), legacy keys are not allowed |
| update_qa_round | + `viewports` array (full list, open non-legacy rounds only; removing one hides its ticks and scans) |
| get_qa_round | description: `round.viewports` is the round's keys, `round.legacyViewports` marks rounds made before the set, `viewportDefs` gives label, size, dpr, kind and Webflow breakpoint; browserTicks are keyed by those keys |
| update_qa_round_page | `viewports` ticks object accepts the round's keys; description lists the keys and says legacy rounds use xl, desktop, tablet, mobile_l, mobile_p; worker passes every pattern-valid key, throws on a malformed one |
| get_qa_round_page, get_qa_round_report | description: scans and ticks are keyed by the round's viewport keys |
| create_qa_request, add_qa_comment | `viewport` loses its `enum`; description lists the keys and says it must be one of the round's |
| list_qa_comments, list_qa_round_comments, get_qa_comment | description: viewportInfo also carries dpr, tier and kind |

Descriptions are built once at module load from the imported constants (one helper, for example `qaViewportHelp()` in qa-tools.ts, exported for the parity test), so they can never list a stale key set at source level. The deployed worker's text only changes when its workflow redeploys it (and a Claude session sees new descriptions only after a fresh session); since validation is server-side and no enum is published, an outdated description is cosmetic.

Withdrawn by the correction at the top: T12 adds lib/qa/viewports.ts to the mcp-worker-deploy.yml path filter, so a registry change redeploys the worker that imports it.

---

## 8. Rollout order and compatibility

### 8.1 Pushes

| Step | Contents | Visible change |
|---|---|---|
| 0 | T0 preflight (read-only production checks, Inspect merged) | none |
| M | Migration 0121 applied on production and local D1 (Opus) | none |
| Push 1 | T1 to T5: registry, readers, validators, writers. POST round without `viewports` still stores NULL (legacy). Explicit `viewports` accepted from the API only | none for any existing flow; a legacy round reads and writes exactly as before |
| Push 2 | T7 to T11 plus T9's default flip: UI driven by the round set, start round picker, edit devices, report, e2e; POST round without `viewports` now means core | new rounds are core by default |
| Worker | T12, committed separately; the "MCP worker deploy" workflow deploys it automatically on the push to main that carries it, after push 2 | MCP can read and write the new keys |
| Cleanup | T13 (aliases removed), T14 docs | none |

T12 can be built in parallel with push 2; it deploys after push 2 because its descriptions say "omit for the core 11", which is only true once push 2 is live. Deploying it earlier is safe (the dashboard validates every key) but describes the default wrongly for a while.

### 8.2 A new key reaching old code

| Old component | New input | What happens |
|---|---|---|
| Old dashboard Worker (during a rollback) reading a core round | viewports column set, chromium rows in qa_browser_ticks, new keys in scans and comments | Ignores the column; mergeBrowserTicks skips chromium rows and unknown keys; shows the legacy five frames with no ticks; comment groups drop unknown keys; viewportInfoFor falls back to the desktop def (a phone_m comment reads as Desktop 1440 to MCP). No crash and no data lost. Caveats: old code lets people tick the legacy five on a core round (Chromium to vp_* columns, Firefox and WebKit rows on legacy keys), which roll-forward hides again; the old site list counts Firefox and WebKit rows on any key over pages x 5, so progress can show above 100% |
| Old browser tab (JS from before push 2) after push 2 | Start round posts without `viewports`, so the round is core | The old workspace shows five legacy frames; their ticks, scans and comments get 400 "viewport xl is not part of this round" toasts. A reload fixes it. Mention it in the push 2 note to Liam |
| Stale MCP worker after push 2 | start_qa_round without viewports | Creates a core round (fine) |
| Stale MCP worker, update_qa_round_page with new keys | its viewportTicks drops them | Ticks only: body becomes `{}` and the route answers 400 "Nothing to update" (loud). Ticks plus status or note: the tick is silently lost while the status saves. This is the one silent failure; it ends when the push carrying T12 redeploys the worker. Until then, tell assistants (in the push 2 note) to tick through the dashboard |
| Stale MCP worker, add_qa_comment with a new key | its own check refuses anything but the five | Loud error; no write |
| Stale MCP worker, create_qa_request | passes the string; stale schema enum may make the client refuse first | Either a client-side refusal or a correct write |
| New MCP worker against a dashboard without push 1 (wrong order) | new keys | Dashboard 400s every one (loud); legacy keys keep working |
| SQA.5 engine helper (if it ships first, five contexts from QA_VIEWPORTS) | a core round | It must read the round's Overview and Inspect frames instead; see section 9 |

### 8.3 Stale tool schemas

Removing `enum` from every viewport argument is the long-term fix: after this worker deploy, no future registry change can be refused by a cached schema, and the error text from the dashboard ("viewport k is not part of this round (it uses: ...)") tells an assistant which keys to use. The parity test fails if an `enum` naming viewport keys reappears in index.ts.

### 8.4 Rollback

- Revert push 2: the UI is back to the legacy five while push 1 readers stay. Core rounds made in between keep their data; their workspace shows legacy frames and refuses ticks (400) until push 2 is re-applied. Nothing is lost.
- Revert push 1 as well: the code ignores the column entirely (8.2, first row). No stored data is lost, with the caveats in that row: ticks made on legacy keys of a core round during the rollback are hidden after rolling forward, and old progress numbers can be wrong for core rounds.
- The column itself is never dropped (dropping is not additive and buys nothing).
- Roll back by reverting the merge and pushing, then the health probe (AGENTS.md line 51).

---

## 9. Cross-plan sequencing

Inspect mode (another branch, touching workspace/viewport-strip.tsx, viewport-frame.tsx, round-workspace.tsx):
- T1 is the first task that edits those three files (compile fixes after widening QaViewportKey), so T1 and everything after it start only once Inspect is merged to main and this branch is rebased (T0 checks it). T2 (migration) and T6 (design) do not touch those files and can start at once.
- What this plan needs from Inspect, to be confirmed by reading the merged code in T0: Inspect takes its device list from a prop or a single list it iterates (T8b feeds it the round set); the Overview is today's strip (T8a feeds it overviewViewportsFor); there is a way to open Inspect on a given viewport (T8b uses it for showIssue and showComment). If Inspect has no "open on viewport" entry point, T8b adds a minimal one in round-workspace.tsx (state plus a setter) and says so in its report.
- If Inspect is not merged when this plan starts, run T0, T2 and T6 only, and wait.

SQA.5 local engine (docs/superpowers/plans/2026-10-27-site-qa-local-engine.md, not started in code; no apps/qa-engine yet):
- Migration numbers: 0120 is its qa_via; this plan is 0121. Either can ship first.
- Shared files: app/api/admin/qa/round-pages/[id]/route.ts (tick upsert), lib/qa/browsers.ts (tick readers), the round and report readers. Whichever lands second rebases. Merge rules: the via conditional upsert clause (its 7.1) applies to every qa_browser_ticks row including the new chromium rows; its `QaBrowserTickViaMap` becomes `Partial<Record<QaViewportKey, QaVia | null>>`; its statement "Chromium ticks stay in the vp_* columns and are always native" becomes "Chromium ticks on legacy keys stay in the vp_* columns; on registry keys they are qa_browser_ticks rows, always via native"; the tick chunk of 10 rows keeps an 8-bind row under the cap.
- Tick PATCH response: this plan returns `item.browserTicks`; SQA.5 (its 1.8 and 7.1) adds a top-level `ticks` with ticked and via per viewport. Both can coexist: keep `item.browserTicks` and let SQA.5 add `ticks` keyed by the round's keys. SQA.5's site-list `ticksNative` counts the new Chromium rows (always via native) as native, by the same filter as section 4.3.
- Engine contexts: SQA.5 section 1.1 opens five contexts from QA_VIEWPORTS. After this plan it should open contexts for the frames actually shown (the Overview subset, or the one Inspect frame) with `deviceScaleFactor` from the registry dpr where it wants device fidelity, and its Scan all driver should use scanAllViewportsFor. T14 adds a dated note to that plan's changelog saying so; the SQA.5 owner amends its phases.

---

## 10. Security review points (security-reviewer, gates G1 and G3)

1. Every new write path keeps the guard order getRequestAuth > isTahiAdmin > requireFeature('qa_tester') > requireAdmin: rounds POST and PATCH (viewports), round-pages PATCH (ticks), scan POST, comments POST, create-request.
2. Viewport keys are allow-listed against the registry before any database work, and against the round set after the round loads; nothing user supplied reaches SQL except as a bound parameter (drizzle); the JSON column is written only by serialiseRoundViewports from validated keys.
3. Error messages echo at most 40 characters of an unknown key, never the whole body.
4. parseRoundViewports and parseCommentView never throw on hostile or corrupt stored JSON; a corrupt non-null column falls back to core, never to an unbounded list.
5. Input sizes are bounded: viewports arrays longer than 50 items are refused; tick objects at most 21 keys (registry size), each value boolean.
6. D1 bound parameter cap: tick upsert chunked at 10 rows; the round page insert is unchanged (13 binds, 7 rows); the round insert gains at most one bind (drizzle emits a NULL literal for an unset column with no default).
7. The closed-round 409 still comes before the not-in-round 400s; a legacy round cannot be switched to new keys (400).
8. MCP worker: keys pass through only when they match `^[a-z][a-z0-9_]{0,23}$`; ids still go through assertSafeIdArgs; keys go in bodies, never paths; every QA tool remains designer-blocked.
9. localStorage view state (comments-helpers parseCommentView) accepts only registry keys.

---

## 11. Test plan

Vitest (root run; workers are excluded, so worker specs live under app/api/__tests__):

1. lib/qa/__tests__/viewports.test.ts (new, T1):
   - 21 keys, unique, each matching the pattern; tiers 5 legacy, 11 core, 5 niche, in the table's order.
   - Legacy five pinned exactly: keys, labels, 1920x1080, 1440x900, 768x1024, 425x860, 375x812 (the freeze).
   - Core and niche pinned exactly: every label, width, height and dpr from section 1.
   - Widths unique within legacy and within core plus niche; labels unique within the same two sets.
   - Overview: phone_m, tablet_portrait, laptop_m, desktop_fhd among core and niche; all five legacy.
   - parseRoundViewports: null and undefined give legacy five; '[]', 'nope', '{}', '["xl"]' and '["unknown"]' give core; '["laptop_m","phone_s","phone_s"]' gives phone_s, laptop_m (registry order, de-duplicated).
   - parseViewportInput: refuses non-array, empty, a legacy key (message names it as legacy), an unknown key (echo at most 40 characters), an array of 51 items; returns registry order.
   - primaryViewportFor: legacy gives desktop; core gives laptop_m; [phone_s] gives phone_s; [desktop_fhd, phone_s] gives desktop_fhd; [] gives null.
   - scanAllViewportsFor: legacy gives desktop, mobile_p; core gives laptop_m, phone_s; core plus niche gives laptop_m, fold_narrow; a one-key set gives that key once.
   - overviewViewportsFor: legacy gives five; core gives four; [phone_s, laptop_s] (none flagged) gives both; a set with 8 unflagged keys gives the first 4.
   - webflowBreakpointFor: legacy strings byte-identical to lib/qa/comments.ts lines 275 to 279; phone_landscape says Tablet and "852px wide"; tablet_s says Mobile landscape; tablet_landscape says Desktop (base); laptop_s names 1280; desktop_ultrawide names 1920.
   - tickStoreFor: column only for chromium plus each legacy key; row for firefox plus legacy, chromium plus phone_m, webkit plus laptop_m.
   - The module source has no import statement (read the file as text).
2. lib/qa/__tests__/browsers.test.ts (T3): legacy round chromium from columns, a chromium row on a legacy key ignored, firefox rows read; core round chromium rows read, vp_* columns ignored, a row outside the set ignored, a row for a browser outside the round ignored; countTicks by set.
3. lib/qa/__tests__/issue-rules.test.ts (T3): primary from laptop_m for core scans, from desktop for legacy, fallback when the primary is missing; launch overflow issues keyed by new keys.
4. lib/qa/__tests__/comments.test.ts (T5b): viewportInfoFor new keys with dpr, tier, kind and breakpoint; legacy unchanged; parseCommentInput accepts phone_m and refuses "Phone M".
5. app/api/__tests__/admin-qa-rounds.test.ts (T4a, T5a, T5b, T9):
   - POST round: push 1 omitted gives NULL; explicit core plus niche stored canonical; legacy key 400; unknown 400; empty 400; still within the 100 bind cap; push 2 (T9) omitted gives the core JSON.
   - PATCH round viewports: open core round ok; closed 409; legacy round 400; recount of pages with scans in changed viewports, capped, recomputeSkipped reported; name-only change does not recount.
   - GET round: legacy round returns the five, legacyViewports true, browserTicks from columns; core round returns rows-based ticks with chromium rows; the tick query runs for a chromium-only core round.
   - PATCH round page: legacy chromium legacy key writes the column and no row; legacy firefox writes a row; core chromium writes a row and no column; key outside the set 400 after the 409; unknown key 400 before any read; 16 keys keep every insert under 100 bound values; response item.browserTicks is the settled state.
   - Round page GET: duplicate meta reads the round primary (laptop_m rows for core, desktop for legacy).
   - Scan POST: key outside the set 400; legacy unchanged; comments POST: key outside the set 400; create-request: a registry key outside the set accepted, an unknown key 400.
6. Site list, site rounds and report counts: app/api/__tests__/admin-qa-sites.test.ts (T4b) for the site list ticks over a mix of legacy and core rounds and three browsers; app/api/__tests__/admin-qa-rounds.test.ts (T4a) for GET sites/[id]/rounds counts and resolved viewports; app/api/__tests__/admin-qa-request.test.ts (T4b, its own describe block, before T5b) for report ticksTotal, pages[].ticks and viewportDefs.
7. Workspace tests (T7, T8a): qa-types ticksFor, tickCount, browserBreakdown, pageRowTitle with a set; use-round applyPagePatch (core round writes no vp_* field; legacy writes the column) and rollbackTickPatch with missing keys; scan-all maps a scan to its hidden frame by window and ignores a frame-less message; comments-helpers grouping in registry order and saved view with new keys; scroll-helpers relayTargets order; viewport-strip zoom math with the legacy five yields exactly today's numbers (regression pin) and with the core Overview yields a fit.
8. app/api/__tests__/mcp-qa-tool-parity.test.ts (T12): start_qa_round and update_qa_round pass `viewports`, refuse an empty list and a malformed key; update_qa_round_page passes phone_m and xl, throws on "Phone M"; add_qa_comment accepts laptop_m, refuses "Laptop M"; create_qa_request passes the viewport; qaViewportHelp() contains every selectable and legacy key; workers/mcp-server/src/index.ts read as text contains no `enum: ['xl'`; every QA tool is still in DESIGNER_BLOCKED_TOOLS.
9. lib/__tests__/qa-migration.test.ts (T2): QA_ROUND_VIEWPORTS_MIGRATION equals exactly `['ALTER TABLE qa_rounds ADD COLUMN viewports text']`; the SQL file carries it with a trailing semicolon, says "Apply BEFORE deploying" and has no double hyphens; the runner has name '0121' and the constant; the 0119 block's `/s+/` fixed to `/\s+/`.

Playwright (T11, e2e/site-qa.spec.ts): a new round shows the 4 Overview frames ("Phone M preview", "Tablet portrait preview", "Laptop M preview", "Desktop preview"); the wide-mode fit test with 4 frames; Inspect steps through 11 devices and a niche device appears when opted in; the comment test pinned on Laptop M; the 375px single-frame test with the new switcher; ticking a device not in the Overview from the tick control. A legacy round cannot be created through the API any more, so legacy coverage is the route tests plus the live smoke on an existing production round.

---

## 12. Rules for every task (read first)

- CLAUDE.md hard rules apply (no `any`, no console.log, no commented-out code, no em dashes, en dashes or double hyphens anywhere, rem units, CSS var tokens, hover and focus states, 44px targets, no single-side borders). Never export non-route symbols from route.ts. lib/qa/viewports.ts imports nothing.
- One owner per file per task. If a task needs a file another open task owns, stop and report.
- After each task: `npx vitest run <the task's test files>`, then `npm run type-check` and `npm run lint` with zero errors; `npm run build` when a page or route changed. Fail closed in one && chain.
- Commit at the end of each task with the message given, ending with your session's attribution lines. Add `[skip ci]` until the push the task belongs to.
- Do not push, do not run migrations against production, do not deploy the MCP worker. Pushes and the production migration are Opus steps with Liam's go in the session.
- Line numbers in this plan are from e0001ad0; after Inspect merges, re-grep the three workspace files.
- If the plan conflicts with the repo, stop and report instead of guessing.

---

## 13. Tasks

Sizes: S about an hour, M a session, L a long session. Tier: who builds; every task is reviewed (section 14).

Dependency summary: T0 first. T2 and T6 can start at once. T1 needs T0 (Inspect merged). T3 needs T1 and T2 (recomputeCounts reads round.viewports, typed from db/schema.ts). T4a, T4b, T5a and T5b need T3. Because they share test files, T4a then T5a then T5b run in that order (all edit admin-qa-rounds.test.ts); T4b runs in parallel with T4a but must commit its report block in admin-qa-request.test.ts before T5b starts. Push 1 after G1. T7 needs T3. T8a needs T7 and T6 approved. T8b needs T8a. T9 needs T6 approved and T4a. T10 needs T6 approved and T4b. T11 needs T8b, T9 and T10 (the full-flow e2e opens the report). Push 2 after G2. T12 needs T1 and T4a to T5b (API shape), can run alongside push 2 work, deploys after push 2. T13 needs push 2 and T12 merged. T14 last.

### Task T0: Preflight (Opus, S)

- [ ] Confirm Inspect mode is merged on main; rebase this branch; read the merged round-workspace.tsx, viewport-strip.tsx, viewport-frame.tsx and note the device switcher's input, the Overview component and any "open Inspect on viewport" entry point. Write the findings at the top of this plan's changelog.
- [ ] Confirm whether SQA.5's 0120 exists in drizzle/migrations; note it.
- [ ] Read-only on production (wrangler d1 execute tahi-db with the remote and command flags, SELECT and PRAGMA only): `PRAGMA table_info(qa_rounds)` has no `viewports`; `SELECT count(*) FROM qa_rounds`; `SELECT count(*) FROM qa_browser_ticks WHERE browser = 'chromium'` is 0 (old code never writes chromium rows; if it is not 0, stop and report, because the new reader ignores chromium rows on legacy keys by design). Record in the run log.
Done: findings recorded; go or stop.

### Task T1: Registry module and type widening, no behaviour change (sonnet-worker, M)

Files: create lib/qa/viewports.ts, lib/qa/__tests__/viewports.test.ts; modify lib/qa/types.ts, plus only the compile fixes tsc reports (expected: lib/qa/browsers.ts:69-73, lib/qa/comments.ts:274, app/api/admin/qa/rounds/[id]/report/route.ts:91, workspace/qa-types.ts:126-130, workspace/round-workspace.tsx:94-95, workspace/viewport-strip.tsx:140, workspace/viewport-frame.tsx:8 and 39, report-content.tsx:49-55 and 209-210).
- [ ] Write lib/qa/viewports.ts exactly per section 2 (zero imports; rows of the 2.1 table in order).
- [ ] lib/qa/types.ts: delete the QA_VIEWPORTS literal and QaViewportKey definition; re-export everything from './viewports'; keep deprecated aliases with a `@deprecated removed in T13` doc comment: `QA_VIEWPORTS` (the five legacy defs), `QA_VIEWPORT_KEYS` (legacy five), `QA_PRIMARY_VIEWPORT = 'desktop'`, `viewportByWidth` (searching legacy only). QaViewportInfo gains `dpr`, `tier`, `kind` (fill them in viewportInfoFor in this task with the registry values so it compiles).
- [ ] Compile fixes only: Records keyed by QaViewportKey become Partial records or registry lookups (labels via viewportLabel, short labels via viewportDef(key)?.shortLabel). Every caller that iterates QA_VIEWPORTS keeps iterating the legacy alias, so the screen is identical.
- [ ] Tests: section 11 item 1 in full.
Done: tests green, type-check, lint, build; a manual diff read shows no behaviour change. Commit `SQA.8: viewport registry and wider viewport key, no behaviour change [skip ci]`.

### Task T2: Migration 0121 and schema column (Opus, S)

Files: drizzle/migrations/0121_qa_round_viewports.sql (new), lib/qa-migration.ts, app/api/admin/db/migrate/route.ts, db/schema.ts (qaRounds `viewports`, comments on qaRoundPages vp_* and qaBrowserTicks), lib/__tests__/qa-migration.test.ts.
- [ ] Exactly section 4.4. No `.default()` on the drizzle column.
- [ ] Tests: section 11 item 9, including the `/\s+/` fix.
Done: tests green, type-check, lint. Commit `SQA.8: migration 0121, qa_rounds.viewports [skip ci]`. Applying it on production happens at G1, before push 1.

### Task T3: Tick storage rules, readers and primary (sonnet-worker, M)

Files: lib/qa/browsers.ts, lib/qa/server.ts, lib/qa/issue-rules.ts, lib/qa/__tests__/browsers.test.ts, lib/qa/__tests__/issue-rules.test.ts.
- [ ] browsers.ts: `mergeBrowserTicks(pages, tickRows, browsers, viewports)` and `countTicks(perBrowser, browsers, viewports)` per section 4.3; `emptyTickMap(keys)`; `chromiumTicks` only for legacy keys. Update the file's header comment (lines 1 to 9).
- [ ] server.ts: scansByBrowser optional `viewports` filter; recomputeCounts passes parseRoundViewports(round.viewports).
- [ ] issue-rules.ts: replace QA_PRIMARY_VIEWPORT with primaryViewportFor(Object.keys(scans)) at lines 46 and 106.
- [ ] Update every existing caller of the changed signatures in lib only (routes are T4 and T5; give the new parameter at call sites in T4/T5, so make it optional here with the legacy five as default to keep the routes compiling until then).
- [ ] Tests: section 11 items 2 and 3.
Done: green. Commit `SQA.8: tick readers and primary viewport from the round set [skip ci]`.

### Task T4a: Round routes (sonnet-worker, M)

Files: app/api/admin/qa/sites/[id]/rounds/route.ts, app/api/admin/qa/rounds/[id]/route.ts, app/api/__tests__/admin-qa-rounds.test.ts (the round POST, PATCH and GET cases only; coordinate test file ownership with T5a and T5b by putting this task's cases in a new `describe('viewport sets: rounds')` block and committing first; T5a and T5b append their own blocks after rebasing).
- [ ] POST: optional `viewports` (parseViewportInput), omitted stores NULL (push 1 behaviour), response `viewports` resolved.
- [ ] GET site rounds: counts per section 4.3, grouped by viewport; each item returns resolved `viewports` and `legacyViewports`, never the raw column (today the route spreads the raw row at line 109, which after T2 would leak the JSON string or null to list_qa_rounds).
- [ ] GET round: always query tick rows; `round.viewports`, `round.legacyViewports`, `viewportDefs` (each def plus webflowBreakpoint).
- [ ] PATCH round: `viewports` rules per section 5 and the 3.3 row. Recount once per PATCH: the union of pages with scans in a changed browser or a changed viewport, using a reloaded round carrying both new values (browsers and viewports), under the single MAX_RECOMPUTE cap of 40, recomputeSkipped as today. Changed keys stay within the bind cap.
- [ ] Doc comments at the top of both routes updated.
- [ ] Tests: the round items of section 11 item 5.
Done: green, build. Commit `SQA.8: rounds choose and change their viewport set [skip ci]`.

### Task T4b: Site list and report readers (sonnet-worker, S)

Files: app/api/admin/qa/sites/route.ts, app/api/admin/qa/rounds/[id]/report/route.ts, app/api/__tests__/admin-qa-sites.test.ts (site list cases), app/api/__tests__/admin-qa-request.test.ts (a new `describe('viewport sets: report')` block only; commit before T5b, which also edits this file).
- [ ] Site list per section 4.3 (column sum only for legacy rounds; grouped rows by round, browser and viewport; totals by set).
- [ ] Report: always query rows; pages[].ticks rule from the 3.3 row; ticksTotal by set; round.viewports, viewportDefs; comment entries add viewportLabel.
- [ ] Tests: section 11 item 6.
Done: green, build. Commit `SQA.8: site list and report count the round's viewports [skip ci]`.

### Task T5a: Round page route, ticks (sonnet-worker, M)

Files: app/api/admin/qa/round-pages/[id]/route.ts, app/api/__tests__/admin-qa-rounds.test.ts (own describe block, after T4a).
- [ ] PATCH per the 3.3 rows and section 4.3: syntax check before reads, set check after the 409 and the browser 400, tickStoreFor split, chunk 10, and the page update plus every tick chunk sent in one `database.batch([...])` (as the round POST does, sites/[id]/rounds/route.ts:200) so a failure never leaves a partial tick set; response with browserTicks.
- [ ] GET: merge with the set, duplicate meta by the round primary, `viewports` in the response.
- [ ] Doc comment at the top rewritten (no five-key list).
- [ ] Tests: the round page items of section 11 item 5, including the 16-key bind cap case.
Done: green, build. Commit `SQA.8: round page ticks on any viewport of the round [skip ci]`.

### Task T5b: Scan, comments and create-request routes (sonnet-worker, M)

Files: app/api/admin/qa/round-pages/[id]/scan/route.ts, app/api/admin/qa/round-pages/[id]/comments/route.ts, app/api/admin/qa/round-pages/[id]/create-request/route.ts, lib/qa/comments.ts, lib/qa/__tests__/comments.test.ts, app/api/__tests__/admin-qa-request.test.ts (own describe block, after T4b's), app/api/__tests__/admin-qa-rounds.test.ts (own describe block, after T5a).
- [ ] Scan: isQaViewportKey, set check after the browser check, error lists the round keys.
- [ ] Comments POST: set check after the browser check. lib/qa/comments.ts: parseCommentInput by registry; viewportInfoFor with webflowBreakpointFor, dpr, tier, kind; keep the desktop fallback for an unknown stored key.
- [ ] Create-request: any registry key; label and size from the registry.
- [ ] Tests: section 11 item 4 and the scan, comment and create-request items of item 5.
Done: green, build. Commit `SQA.8: scans, comments and requests on the round's viewports [skip ci]`.

### Gate G1 and push 1 (Opus)

- [ ] security-reviewer on T2 to T5b (section 10 points 1 to 7 and 9); fix and re-review until it passes.
- [ ] opus-reviewer fresh context: push 1 changes nothing visible for legacy rounds and accepts new keys only for rounds that have them.
- [ ] Full vitest, type-check, lint, build.
- [ ] With Liam's go: apply 0121 on production and local D1 (section 4.4), verify, log. Then drop `[skip ci]`, push, watch "Deploy dashboard" and "qa-view deploy" to green, health probe.
- [ ] Live smoke on one existing legacy round: five frames, tick and untick in Chrome, scan stored, a comment and its pin, report unchanged, site list tick counts unchanged. Note in the run log.

### Task T6: Design in Claude Design, Liam reviews (Opus, M; Liam's review)

Per AGENTS.md line 41 (design first, then port). Project "Tahi dashboard". Draft:
1. Start round "Devices" picker (core grouped by kind, More devices for niche, sizes shown, 375px layout).
2. Edit devices dialog for an open round (same picker, removal note "hides its ticks and scans").
3. Tick control for up to 16 devices in the workspace toolbar (grouped by kind; today's five checkboxes at round-workspace.tsx lines 1079 to 1094 do not scale).
4. Page rail progress for more than five devices (page-rail.tsx lines 194 to 210 show five dots).
5. Report tick table for up to 16 devices x 3 browsers (report-content.tsx lines 472 to 525 render one column per viewport per browser).
6. Single-frame switcher at 375px with up to 16 devices (viewport-strip.tsx lines 414 to 424), consistent with Inspect's device switcher.
7. Overview order: phone first (Liam's listing) or desktop first (today's habit).
Done: Liam has reviewed and approved in Claude Design; decisions written into this plan's changelog. T8a, T8b, T9 and T10 wait on this gate.

### Task T7: Workspace data layer (sonnet-worker, M)

Files: workspace/qa-types.ts, workspace/use-round.ts, workspace/scan-all.ts, workspace/comments-helpers.ts, workspace/scroll-helpers.ts, workspace/use-comments.ts (types only), and their __tests__ (qa-types, comments-helpers, comment-view, scroll-helpers).
- [ ] The 3.4 rows for these files. New parameters are optional with the legacy five as default so round-workspace.tsx compiles unchanged until T8b.
- [ ] scan-all: `viewports` option; frames from scanAllViewportsFor; map by window only; stop using viewportByWidth.
- [ ] Tests: section 11 item 7 (data layer parts).
Done: green, no visible change yet. Commit `SQA.8: workspace data layer follows the round's viewports [skip ci]`.

### Task T8a: Strip, frame and zoom math (frontend-developer, M)

Files: workspace/viewport-strip.tsx, workspace/viewport-frame.tsx, workspace/__tests__/viewport-strip.test.ts.
- [ ] Zoom math parameterised by frames; `frames` and `allViewports` props; short labels and the switcher per T6 (a select when more than five); dpr in the frame label tooltip; whatever Inspect needs from these files per T0's findings.
- [ ] Tests: the legacy five give today's numbers exactly; the core Overview fits.
Done: green, build. Commit `SQA.8: Overview strip and frames from the viewport set [skip ci]`.

### Task T8b: Workspace wiring (frontend-developer, L)

Files: workspace/round-workspace.tsx, workspace/page-rail.tsx, workspace/comment-view-control.tsx, workspace/issue-panel.tsx.
- [ ] The 3.4 rows for these files: round set everywhere, Overview subset, Inspect device list, primary defaults, Inspect on demand for issues and comments, scan states and totals by set, tick control and rail per T6, registry labels, hidden scan frames from T7.
- [ ] Manual check in local Chromium (QA worktree recipe, port 3179): a legacy round looks identical to before; a core round shows four Overview frames, Inspect steps through 11, ticks on a device outside the Overview save and survive a refresh, comments and pins on phone_landscape, synced scroll across the Overview, Wide mode, Scan all on laptop_m and phone_s; 375px and dark mode.
Done: green, build, the manual check written in the commit body. Commit `SQA.8: workspace runs on the round's viewport set [skip ci]`.

### Task T9: Start round picker, edit devices, default flip (frontend-developer, M)

Files: qa/[siteId]/start-round-dialog.tsx, workspace/round-actions.tsx, app/api/admin/qa/sites/[id]/rounds/route.ts (the omitted default only), app/api/__tests__/admin-qa-rounds.test.ts (the default case only).
- [ ] Picker per T6 and section 5; always sends `viewports`.
- [ ] Devices action for open non-legacy rounds; toast for recomputeSkipped.
- [ ] Route: omitted `viewports` now stores the core JSON; update its doc comment and the test.
Done: green, build; 375px and dark checked. Commit `SQA.8: choose devices when starting a round, core by default [skip ci]`.

### Task T10: Report page (frontend-developer, M)

Files: qa/rounds/[id]/report/report-content.tsx.
- [ ] Columns from round.viewports and viewportDefs, layout per T6, labels from the registry; legacy rounds render as today.
Done: build; a legacy report and a core report with three browsers checked at 1440px, 375px and dark, and in print preview. Commit `SQA.8: report shows the round's devices [skip ci]`.

### Task T11: End to end (qa-tester, M)

Files: e2e/site-qa.spec.ts.
- [ ] Section 11 Playwright cases, and rewrite every legacy-key test for a core round: the full flow (lines 81 to 111) waits on the Laptop M frame and ticks Laptop M; the 375px test expects one frame and the T6 switcher; the wide fit test expects the 4 Overview titles; the comment test uses "Comment on Laptop M" and the Laptop M iframe; the synced scroll test relays across Phone M, Tablet portrait and Laptop M; the browsers per round test ticks Laptop M. Keep the tenancy cases passing.
Done: the spec passes locally against the QA worktree. Commit `SQA.8: e2e for the viewport set [skip ci]`.

### Gate G2 and push 2 (Opus)

- [ ] ui-ux-auditor light pass: the workspace at 1920 wide and in Wide mode on a core round, Inspect stepping, the start round picker, the edit devices dialog, the report; 375px and dark.
- [ ] opus-reviewer fresh context against this plan and Liam's original request.
- [ ] Full vitest, type-check, lint, build, e2e.
- [ ] With Liam's go: push, both workflows green, health probe, then the live smoke in section 14. Tell Liam: reload any open QA tab; until the MCP worker is deployed, tick new rounds in the dashboard, not through an assistant.

### Task T12: MCP worker (sonnet-worker, M; its workflow deploys it on the push to main)

Files: workers/mcp-server/src/qa-tools.ts, workers/mcp-server/src/index.ts (the Site QA block, lines 1706 to 1844 only), app/api/__tests__/mcp-qa-tool-parity.test.ts.
- [ ] Section 7 and the 3.5 rows. No new tool. No enum on viewport arguments. Descriptions from `qaViewportHelp()`.
- [ ] TypeScript in workers/mcp-server (npx tsc with the no-emit flag, run in that folder) passes with the new relative import (it already imports ../../../lib/mcp-identity at runtime).
- [ ] Tests: section 11 item 8.
Done: green. Commit on its own branch `SQA.8: MCP tools read and write the round's viewports`. Opus reviews (G3), then, with Liam's go, merges and pushes it; the "MCP worker deploy" workflow deploys the worker from that push (verify its real conclusion with gh run list).

### Gate G3: MCP (Opus, then Liam)

- [ ] security-reviewer quick pass on the passthrough (section 10 point 8); opus-reviewer.
- [ ] With Liam's go: merge and push; the "MCP worker deploy" workflow deploys the worker; check its real conclusion with gh run list.
- [ ] MCP smoke as Liam: get_qa_round on a core round shows viewports and viewportDefs; update_qa_round_page ticks phone_m and the dashboard shows it; add_qa_comment on laptop_m draws a pin; start_qa_round with phone_m and desktop_qhd creates that set; update_qa_round on a legacy round is refused with the legacy message; a malformed key gives the worker error.

### Task T13: Remove the deprecated aliases and the legacy defaults (sonnet-worker, S; opus-reviewer checks)

Files: lib/qa/types.ts, lib/qa/browsers.ts, lib/qa/server.ts, workspace/qa-types.ts, workspace/scan-all.ts, every caller tsc lists once the defaults are gone (routes under app/api/admin/qa/**, workspace components), and the tests that call these functions without a set (lib/qa/__tests__/browsers.test.ts, workspace/__tests__/qa-types.test.ts, possibly the admin-qa route tests), which get the set passed explicitly. Run T13 alone: it touches files owned earlier by T3 to T10, all merged by then.
- [ ] Remove the legacy-five defaults from the optional viewport parameters added in T3 and T7 (mergeBrowserTicks, countTicks, scansByBrowser, emptyTickMap, ticksFor, tickCount, browserBreakdown, pageRowTitle, useScanAll) so any missed caller fails type-check instead of reading a core round as legacy; fix each caller tsc lists by passing the round set.
- [ ] Delete QA_VIEWPORTS, QA_VIEWPORT_KEYS, QA_PRIMARY_VIEWPORT and viewportByWidth; `grep -rn "QA_VIEWPORTS\b\|QA_VIEWPORT_KEYS\|QA_PRIMARY_VIEWPORT\|viewportByWidth" app lib workers` returns nothing outside docs.
Done: type-check, lint, full vitest green. Commit `SQA.8: drop the five-viewport aliases`.

### Task T14: Docs (Opus, S)

- [ ] AGENTS.md Site QA bullets: the registry rule (lib/qa/viewports.ts, key rules from 2.1, never map width to key), the tick storage rule (vp_* columns only for Chromium on legacy keys, everything else in qa_browser_ticks), qa_rounds.viewports (NULL is legacy, apply 0121 before deploying), the primary and Scan all rule, the MCP no-enum rule.
- [ ] STATUS.md Site QA section; TASKS.md a new SQA entry (take the next free SQA number; 8 is provisional) with the open items; DECISIONS.md the next decision number (076 if still free): "Viewport registry, per-round viewport sets, ticks in qa_browser_ticks without backfill"; the run log; a dated changelog note in docs/superpowers/plans/2026-10-27-site-qa-local-engine.md per section 9.
- [ ] Final opus-reviewer against Liam's original request (section 1) with this plan.
Done: docs committed and pushed with the last push.

---

## 14. Live smoke (push 2, signed in as Liam on portal.tahi.studio)

1. An existing legacy round: five frames as before (XL, Desktop, Tablet, Mobile L, Mobile P), tick and untick in Chrome and, if the round covers it, Firefox; comments and pins as before; Scan all uses Desktop and Mobile P; report columns unchanged; site list progress unchanged. No Devices action in its menu.
2. New round with the default: 11 devices; Overview shows Phone M, Tablet portrait, Laptop M, Desktop; Inspect steps through all 11 in order; tick Phone landscape from the tick control, refresh, still ticked; comment on Tablet landscape, pin drawn in Inspect; Scan all stores Laptop M and Phone S scans; link check runs; report shows 11 per browser.
3. Edit devices: add QHD and Ultrawide; Inspect now steps through 13; remove Laptop S after ticking it, its tick disappears from totals; add it back, the tick returns.
4. A round started with three browsers: totals are pages x devices x 3; rail and report readable.
5. 375px: start round picker, edit devices, workspace single frame and switcher, report: no sideways scroll, 44px targets. Dark mode on the same screens.
6. Record what was seen in the push commit body and the run log.

---

## 15. Liam's actions

- Say go for the production migration apply and each push (his standing rule covers them; confirm in the session).
- Review and approve the T6 designs in Claude Design.
- Say go for merging the MCP worker branch after push 2 (its push deploys the worker through GitHub Actions; there is no manual deploy step).
- Reload open QA tabs after push 2.

---

## 16. Open questions for Liam

1. Scan all coverage. Today and in this plan, Scan all loads each page in two hidden frames (the primary, Laptop M, and the narrowest device, Phone S); the other devices are scanned only when you view them, so sideways scroll at, say, Phone landscape or Small tablet is caught only when you look at it in Inspect. Option A (recommended, built by this plan): keep two frames. A full pass is about five times slower per page and loads every page eleven times through the proxy. Option B: an extra "Full layout pass" button that runs every device of the round for horizontal overflow only. Option C: make Scan all cover every device. Say if you want B or C; it is a follow-up task, not part of this plan.

Everything else here was a technical call decided above: the keys, the Overview four, Laptop M as the primary scan, allowing core devices to be unticked when starting a round, legacy rounds never upgrading, and no backfill.

---

## Changelog

- 2026-11-03, backend phase T1 to T5b built on branch worktree-agent-ad7426429e58f6362 (not pushed; push 1 waits on G1's production steps). Deviations: T2 committed before T1 (independent files); T5b's scan and comments route cases live in app/api/__tests__/admin-qa-viewport-routes.test.ts so T5a and T5b could run in parallel; T5b removed the T1 test that read lib/qa/comments.ts as text, because T5b deleted that file's breakpoint record by design (viewports.test.ts and comments.test.ts still pin the strings); GET /api/admin/qa/sites/[id] (missing from 3.3) now returns resolved viewports and legacyViewports instead of the raw column, found by the G1 reviews; the scan route's unknown key error reads "viewport must be a QA viewport key". Note for the push 1 message: on a legacy page with no desktop scan, the primary scan now follows QA_PRIMARY_PREFERENCE then registry order (xl first) instead of the first stored row, so its counts can shift at its next recompute. G1 status: security-reviewer PASS; opus-reviewer FAIL on the raw column leak only, fixed and re-reviewed (see the fix commit). Still open at G1: the T0 production read-only checks, applying 0121 on production and the seeded local D1, push 1 itself and its live smoke.
- 2026-11-03, T0 preflight (Opus, code side only). Inspect mode is merged (this branch starts at fdd06683, on top of the SQA.7 merge 1cc72df2). Entry points for T8a and T8b: the Inspect device list is `inspectDeviceOptions(availableWidthPx)` in workspace/inspect-helpers.ts, which iterates QA_VIEWPORTS (feed it the round set); the default single frame device is `defaultSingleFrameDevice(narrowLayout, mode)` in the same file ('mobile_p' in the narrow Inspect layout, else 'desktop'; T8b swaps these for the round's narrowest key and primaryViewportFor); the Overview is the non-inspect branch of ViewportStrip (viewport-strip.tsx), which iterates QA_VIEWPORTS for the frames, the zoom math and the expanded frame; "open Inspect on a viewport" already exists as `changeMobileViewport(key)` in round-workspace.tsx (sets `deviceChoice`), used by showIssue and showComment when one frame is mounted, with pendingHighlights and pendingFocus queued until the frame loads, so T8b needs no new entry point. inspect-helpers.ts is not in the 3.4 inventory: its VIEWPORT_SHORT_LABEL record, allViewportsScanned and showInspectScanNote also take the five keys (T1 made them Partial; T8a should drop VIEWPORT_SHORT_LABEL for the registry shortLabel). viewport-frame.tsx line 188 reads VIEWPORT_SHORT_LABEL with no fallback (empty label for a non-legacy key until T8a). SQA.5's 0120 is not in drizzle/migrations. The production read-only checks (PRAGMA table_info(qa_rounds), round count, chromium rows in qa_browser_ticks) were NOT run: remote wrangler is out of bounds for this phase and is left to Liam's session before 0121 is applied.
- 2026-11-03, revision 2 (Opus), after a fresh opus-reviewer FAIL on doc issues: T3 depends on T2; test-file ownership chain T4a, T5a, T5b with T4b's report block in admin-qa-request.test.ts; full e2e inventory and T11 rewrites; one combined recount for browsers and viewports; tick writes in one batch; comment filter shows same-tier hidden keys only; round list returns resolved viewports; SQA.5 response and ticksNative notes; T13 removes the optional defaults; T11 needs T10; rollback caveats; niche count 5; Overview split moved to a plan choice; 50-item rule refuses.
- 2026-11-03, revision 1 (Opus): written from main at e0001ad0. Found that qa_browser_ticks is already a generic row table, so the recommended model needs no tick migration; only qa_rounds.viewports (0121). Found the silent tick drop in the stale MCP worker's viewportTicks, the bind cap risk at 16 keys, the width collisions between tiers, and the `/s+/` regex slip in the 0119 migration test.
