# Local dev, QA harness, migrations and deploys

Recipes that used to live only in Claude's session memory. Written 2026-09-21 from notes dated 2026-06-24 to 2026-09-19; verify a path or a hash before relying on it. Paths use forward slashes on purpose (a backslash path in a markdown file once broke the production build through Tailwind's class scanner).

## Running the app locally

- `npm run dev` (Turbopack) on the main tree; `next.config.ts` calls initOpenNextCloudflareForDev() so D1 and R2 bindings exist in dev (without it every db() call throws and pages render empty).
- Local data is a snapshot of staging D1 under `.wrangler/state/v3/d1/` (gitignored; it holds real data, never commit it). To re-pull, stop the dev server first (the sqlite file locks on Windows), then:

  ```
  export CLOUDFLARE_ACCOUNT_ID=ccd4c7a3b9f7abdf566f0628579d3f4b
  npx wrangler d1 export tahi-db-staging --remote --output snap.sql
  rm -rf .wrangler/state/v3/d1
  npx wrangler d1 execute tahi-db --local --file snap.sql --yes
  ```

  R2 objects are not in the export, so file and image features stay blank locally.
- Double-file gotcha: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` can hold two sqlite files, the seeded snapshot and an empty one that wrangler actually opens ("no such table" 500s). Copy the seeded file over the empty-hash file.
- New migrations never reach the seeded snapshot by themselves. Replay each file under `drizzle/migrations/` against every `*.sqlite` shard with a small sqlite script: CREATE TABLE and INDEX IF NOT EXISTS as-is, every ALTER TABLE ADD COLUMN wrapped so "duplicate column name" is swallowed. On 2026-09-13 the snapshot was missing whole tables from 0081, 0082 and 0085, so scan all migrations when an unexplained 500 hits a route that reads a recent table. Restart the dev server afterwards.
- Admin on localhost: `isTahiAdmin` compares the Clerk org id with NEXT_PUBLIC_TAHI_ORG_ID. On the dev Clerk instance the Tahi org is org_3BUxNgQp84hxb5UYQbOsMtlvJm2 (business@tahi.studio is org:admin there); `.env.local` must carry that value (NEXT_PUBLIC_ vars are inlined at build time, restart after changing). The fallback in next.config.ts still names a stale org; it only matters when the env var is unset.
- Ship Studio wrapper auto-login (dev only, dead code in production builds): requests with `Edg/` or `HeadlessChrome` in the user agent, `?shipstudio=1` or the `tahi-ship-studio` cookie are treated as the Tahi admin (middleware.ts and lib/server-auth.ts, gated on NODE_ENV !== 'production'). Real Clerk login testing happens in a browser without that user agent (Liam uses Vivaldi).

## The QA worktree for Playwright (port 3179)

- Create: `git worktree add --detach ../tahi-qa main`, then in PowerShell `New-Item -ItemType Junction -Path ../tahi-qa/node_modules -Target (Resolve-Path ./node_modules)`, copy `.env.local` and `.wrangler` into it, start `npx next dev --port 3179` (webpack, NOT `--turbopack`: Turbopack refuses the junction with "Symlink node_modules is invalid"). Update with `git -C ../tahi-qa checkout --detach main`. The 3179 server goes stale after about 18 hours and serves old code even after a checkout; restart it.
- `playwright.local.config.ts` (gitignored) points baseURL at 3179, runs the mobile project on chromium with the iPhone 13 descriptor (no webkit download), workers 2. Run `npx playwright test -c playwright.local.config.ts e2e/<spec>`. The `tahi-ship-studio=1` bypass cookie resolves to Liam's dev user (super_admin in the seeded D1), so gated UI is on.
- Every spec calls `primePage(page)` from `e2e/helpers.ts` in a beforeEach (marks the product tour complete) and never waits on networkidle (the notification stream keeps a connection open).
- Tenancy proof: `npm run test:e2e:tenancy` runs e2e/tenancy-isolation.spec.ts (two seeded client orgs, every portal read and write tried across the boundary). Re-run it after any change to lib/portal-access.ts, lib/permissions.ts or a portal route. Not in CI (needs a seeded D1 and Clerk dev keys on the runner).
- Flake under load: 45 cases across three spec files in parallel produced "Target page, context or browser has been closed" failures that pass serially. Run per file, or `--last-failed --workers=1` before believing a red.
- Render-check every merged UI slice before pushing: browser-free builders and reviewers once reasoned a table column into a 1,000,000px width and every check passed; only a screenshot caught it. Headless chromium screenshots work even when the shared Chrome window is backgrounded. Probe scripts, when present, live gitignored under `.claude/` (tasks-probe.mjs, detail-probe.mjs, rail-probe.mjs, parity-shots.mjs).

## Parallel builder worktrees

- Agent and workflow worktrees live under `.claude/worktrees/` with no node_modules; each creates the junction itself (PowerShell New-Item Junction; `cmd /c mklink /J` under Git Bash mangles the path). tsconfig excludes `.claude`, `.design-sync` and `ds-bundle` so they never leak into type-check.
- Remove a worktree with `git worktree remove --force` only after its agent has reported; skip anything `git worktree list` shows as locked; never delete a worktree-agent-* branch without checking its tip differs from main (a prune loop once deleted a just-finished agent's branch; the commit was recovered from a dangling object).
- Files in this repo are CRLF; exact-string edit tools that assume LF fail on them. Normalise for matching, restore CRLF on write.

## Vitest and the gate

- Full suite: `npx vitest run`; read the summary line (about 350 files and 5,100 tests on 2026-09-19). Known flaky under a full parallel run, green alone: middleware.test.ts, lib/__tests__/utils.test.ts formatDate, lib/__tests__/server-client-boundary.test.ts (LW.34). Re-run a failed file in isolation before calling the suite red; the gate grep must fail on the word "failed", not on the exit code of a pipe.
- vitest excludes workers/**; worker logic is tested from app/api/__tests__ (mcp-coerce.test.ts, mcp-request-tool-parity.test.ts).
- Gate chain, in this order, fail closed: `set -o pipefail`, `npm run type-check`, `npm run lint`, the touched vitest files (full suite before a merge), `npm run build` under `timeout 900` when a route.ts or a page changed (a build once hung silently for 40 minutes; grep the output for "Compiled successfully"), commit with the message from a file, `git push origin main`. Never `;` between stages. `git rev-list --left-right --count origin/main...HEAD` must read `0 0` before saying "pushed".
- route.ts files may export only HTTP handlers and Next config fields; `next build` rejects anything else even though tsc passes.

## Migrations on production

- D1 migrations live in `drizzle/migrations/*.sql` and in the runner's list. Apply on production either with `npx wrangler d1 execute tahi-db --remote --file drizzle/migrations/NNNN_name.sql` (pin `CLOUDFLARE_ACCOUNT_ID=ccd4c7a3b9f7abdf566f0628579d3f4b`; wrangler also sees another account) or through the admin runner `POST /api/admin/db/migrate` with `{"name":"NNNN"}` as Liam in his browser session (`GET /api/admin/db/migrate` lists applied names; older notes used `?run=NNNN`). Without a browser session on a deployed environment, authenticate with `Authorization: Bearer <TAHI_API_TOKEN>` (the value in `.env.migration` matches the deployed one).
- Rule (Decision #062): a migration shipped in a commit is applied before the push or immediately after the deploy, checked in the migrate list, and recorded in the run log. Always IF NOT EXISTS; review generated SQL against production (`npx wrangler d1 execute tahi-db --remote --command "PRAGMA table_info(<table>)"` when in doubt). A multi-statement file may need to be applied statement by statement through the runner.
- Direct UPDATE or DELETE on production D1 for data surgery is not done (the tool classifier blocks it too); go through the app's endpoints as Liam, dry run first, with the audit trail that gives. SELECTs are fine.

## Deploys and the health probe

- Push to main runs the GitHub Actions workflow "Deploy dashboard" (type-check and lint gates, then opennextjs-cloudflare build and wrangler deploy); production is live about seven minutes later with no approval click (the environment protection gate was removed before 2026-09-10; if a run ever sits on "waiting", it is back). The MCP worker deploys through "MCP worker deploy" on changes under workers/mcp-server. Watch by run id: `gh run list --workflow "Deploy dashboard" --limit 3`, then `gh run watch <id>`; filter by workflow name, not only by sha.
- Environments: prod worker tahi-dashboard (portal.tahi.studio, D1 tahi-db 3bfa4848-9d46-4d30-9118-269d04293657, R2 tahi-storage, production Clerk, live Stripe); staging worker tahi-dashboard-staging (staging.tahi.studio, D1 tahi-db-staging b91cd27f-5d20-40ff-951a-85fec248522a, R2 tahi-storage-staging, dev Clerk). NEXT_PUBLIC_* values are baked at build time from per-environment GitHub vars.
- After every deploy: curl https://portal.tahi.studio/sign-in (200) and /overview (307 to sign-in when signed out), never 404 or 500; then open one signed-in page in a browser. A change that passed type-check, lint, the full suite and the build once made every signed-in page throw on Workers. Roll back by reverting the merge commit and pushing (about ten minutes).
- Production smoke as Liam: through his browser session (the Chrome extension or the Ship Studio preview when they are connected), a dedicated tab created right before the check, and location.href verified in every probe result (design previews can take over a shared tab). Client view (impersonation) on a client's page is the read-only lens for that client's portal; Act as client is the audited write mode.
- Secrets are operator steps: `npx wrangler secret put <NAME>` (with `--env staging` for staging) is Liam's, never worked around.

## Emails

- lib/email-delivery.ts is the one choke point with the allowlist policy (email.deliveryMode, allowedAddresses, allowedDomains, allowedOrgIds, blockedAddresses); suppressed mail is listed under Settings > Studio details > Email delivery.
- Preview every template with realistic sample data: `POST /api/admin/emails/preview {}` as Liam sends the set to the caller with [PREVIEW] subjects; only tahi.studio recipients are allowed. Run it whenever a template changes. The footer is "Tahi Studio, Whanganui, New Zealand", never a street address.
