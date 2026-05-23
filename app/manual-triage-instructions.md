# Pipeline triage — manual trigger

The pipeline → leads triage endpoint is **deployed and live**. The MCP tool that wraps it (`triage_pipeline_to_leads`) is committed but the worker MCP hasn't redeployed yet, so you can't trigger from a Claude session.

Until the MCP worker redeploys, here's how to trigger it yourself.

## What this does

Finds deals that should have been leads and moves them to the new `leads` table.

**Moves:**
- Every deal currently in stage `Lead` (always)
- Deals in stage `Stalled` AND with **no proposals AND no contracts attached**

**Preserves:**
- The deal's primary contact (sharing `person_id`)
- The org row (so the lead can re-promote to the same org later)
- Activity history (a `lead_demoted` activity stamps the migration with a human reason)

**Deletes:**
- The deal row itself (cascades `deal_contacts` + deal-scoped `activities`)

## How to trigger

### Option A — devtools (recommended)

1. Open https://your-deployed-url.com/leads in the browser while logged in as a Tahi admin
2. Open DevTools → Console
3. Paste this snippet for a **dry-run** preview (no data moved):

```js
fetch('/dashboard/api/admin/leads/triage-pipeline?dryRun=true', {
  method: 'POST',
  credentials: 'include',
}).then(r => r.json()).then(j => console.log(j))
```

4. Inspect the `candidates` array. Each entry has `dealId`, `title`, `orgName`, `stageName`, `reason` (`lead_stage` or `stalled_no_engagement`), and the deal's contacts/proposals/contracts counts.

5. When you're happy, run the **live move**:

```js
fetch('/dashboard/api/admin/leads/triage-pipeline?dryRun=false', {
  method: 'POST',
  credentials: 'include',
}).then(r => r.json()).then(j => console.log(j))
```

The response includes a `moved` array (deal id + new lead id + title) and a `failures` array. Refresh `/leads` to see the new rows.

### Option B — Claude

When the MCP worker has redeployed (look for `mcp__tahi-dashboard__triage_pipeline_to_leads` in Claude's available tools), just ask Claude:

> Run the triage dry-run, then if it looks right, run it live.

Claude will use the `triage_pipeline_to_leads` MCP tool.

### Option C — pass to a Tahi engineer

The endpoint lives at `app/api/admin/leads/triage-pipeline/route.ts`. Behaviour is fully documented in the file header.

## Safety notes

- The dry-run is idempotent. Run it as many times as you want.
- The live mode is **not idempotent** — once a deal is deleted, it's gone. Run dry first, eyeball the candidates, then run live.
- If a candidate turns out to be a real deal you forgot about, *don't* run live. Add a proposal or contract to it first to bump it out of the candidate set.
- Backups: D1 doesn't auto-snapshot. If you want a safety net, export `deals` to JSON before running live.

## Cleanup

Delete this file (`app/manual-triage-instructions.md`) once you've run triage and the MCP tool is doing the job. It's only here because the MCP worker redeploy is slow.
