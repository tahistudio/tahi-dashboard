# Tahi cron trigger worker

Fires the dashboard's recurring cron endpoints on Cloudflare Cron Triggers.

Why this exists: the schedule used to live as `schedule:` entries in
`.github/workflows/dashboard-crons.yml`. GitHub Actions scheduled workflows
were measured dropping 2 to 5 runs an hour against 12 or more configured
schedules in this repo, which silently starved several dashboard crons
(the pre-call digest, transcript sync, briefing regeneration, and more).
Cloudflare Cron Triggers on a dedicated worker fire reliably, so the
schedule now lives here. That GitHub workflow keeps only its manual
`workflow_dispatch` path.

The full schedule -> target -> path mapping lives in `src/schedule.ts`
(pure, no Workers types) so it can be unit tested from
`app/api/__tests__/cron-trigger-schedule.test.ts` even though `workers/**`
is excluded from the app's Vitest run.

Deploy from this directory:

```bash
npx wrangler deploy --config wrangler.jsonc
```

## Secrets

Nothing here carries a committed credential. Set each secret once, from
this directory:

```bash
npx wrangler secret put DASHBOARD_URL
npx wrangler secret put TAHI_CRON_SECRET
```

- `DASHBOARD_URL` is the dashboard's own origin, `https://portal.tahi.studio`.
  The worker POSTs `/api/admin/...` paths onto it.
- `TAHI_CRON_SECRET` must match the `TAHI_CRON_SECRET` env var the dashboard
  checks on those endpoints (the worker sends it as the `x-cron-secret`
  header).

`wrangler secret list` shows what is set. Values are write only after that.

## Checking it's alive

```bash
curl https://tahi-cron-trigger.<your-subdomain>.workers.dev/health
```

Returns `{ "ok": true, "crons": <count> }` on success, where `<count>` is
the number of distinct cron schedules configured in `wrangler.jsonc`. Any
other path or method returns 404. This endpoint does not require the two
secrets above to be set; it only confirms the worker is deployed and
routing correctly. Use `npx wrangler tail` from this directory to watch
live cron fires (only non-2xx target responses are logged, via
`console.error`, one line per target).

## Type check

```bash
npx tsc --noEmit -p workers/cron-trigger/tsconfig.json
```
