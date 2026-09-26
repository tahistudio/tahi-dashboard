/**
 * The monthly financial snapshot tools, as a pure map from tool call to
 * dashboard API call. Same shape as ./task-suggestion-tools: covered by a
 * spec in app/api/__tests__/mcp-snapshot-tools.test.ts (vitest excludes
 * workers/**, so the spec lives inside app/ where the root run already
 * sweeps it). This module knows nothing about fetch, tokens or the Workers
 * runtime.
 *
 * Backs GET /api/admin/reports/financial-trends (the stored month rows) and
 * POST /api/admin/cron/snapshot-metrics?fill=YYYY-MM (write one missing past
 * month, insert only).
 */

export type McpMethod = 'GET' | 'POST'

export interface McpApiCall {
  path: string
  method: McpMethod
  /** Present on writes only. */
  body?: Record<string, unknown>
}

/** Same shape the route accepts: a year from 2000 on and a real month. */
const MONTH_KEY_RE = /^20\d{2}-(0[1-9]|1[0-2])$/

/**
 * The dashboard call one snapshot tool maps to, or null when the name
 * belongs to another block of the switch.
 */
export function snapshotToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  switch (name) {
    case 'get_financial_snapshots':
      return { path: '/api/admin/reports/financial-trends', method: 'GET' }
    case 'snapshot_fill_month': {
      const month = typeof args.month === 'string' ? args.month.trim() : ''
      if (!month) throw new Error('month is required, as YYYY-MM')
      // Checked here too so a typo never reaches the route as a write call.
      if (!MONTH_KEY_RE.test(month)) throw new Error('month must be YYYY-MM, for example 2026-08')
      return {
        path: `/api/admin/cron/snapshot-metrics?fill=${encodeURIComponent(month)}`,
        method: 'POST',
        body: {},
      }
    }
    default:
      return null
  }
}
