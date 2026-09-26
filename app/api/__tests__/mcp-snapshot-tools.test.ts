/**
 * MCP parity for the monthly financial snapshots (CLAUDE.md rule 14).
 *
 * The dashboard can now fill one missing past month
 * (POST /api/admin/cron/snapshot-metrics?fill=YYYY-MM) and the stored months
 * are read at GET /api/admin/reports/financial-trends, so the worker carries
 * snapshot_fill_month and get_financial_snapshots. The mapping is a pure
 * function (workers/mcp-server/src/snapshot-tools.ts); the relative import is
 * deliberate, as in mcp-plan-tools.test.ts, because vitest excludes
 * `workers/**` from collection while still resolving an import into it.
 */
import { describe, it, expect } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'
import { snapshotToolCall } from '../../../workers/mcp-server/src/snapshot-tools'

function toolNamed(name: string) {
  const found = TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} is not registered`)
  return found
}

describe('snapshot_fill_month', () => {
  it('is registered and requires only the month', () => {
    const tool = toolNamed('snapshot_fill_month')
    expect(tool.inputSchema.required).toEqual(['month'])
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['month'])
  })

  it('says it only inserts, and names every refusal', () => {
    const description = toolNamed('snapshot_fill_month').description
    expect(description).toContain('insert only')
    expect(description).toContain('never an overwrite')
    expect(description).toContain('409')
    expect(description).toContain('current month')
    expect(description).toContain('422')
    expect(description).toContain('before_data')
    expect(description).toContain('balances_stale')
    expect(description).toContain('nothing_derivable')
    expect(description).toContain('MRR and active clients are always null')
  })

  it('says cash is null while yield is held, and owed is never a made-up 0', () => {
    const description = toolNamed('snapshot_fill_month').description
    expect(description).toContain('null while any Airwallex yield is held')
    expect(description).toContain('never a made-up 0')
  })

  it('posts the fill for that month and nothing else', () => {
    expect(snapshotToolCall('snapshot_fill_month', { month: '2026-08' })).toEqual({
      path: '/api/admin/cron/snapshot-metrics?fill=2026-08',
      method: 'POST',
      body: {},
    })
    expect(snapshotToolCall('snapshot_fill_month', { month: ' 2026-08 ' })?.path).toBe('/api/admin/cron/snapshot-metrics?fill=2026-08')
  })

  it('refuses a missing or malformed month before any call is made', () => {
    expect(() => snapshotToolCall('snapshot_fill_month', {})).toThrow('month is required')
    for (const month of ['2026-8', '2026-13', 'August', '2026-08&backfill=1', '0050-01']) {
      expect(() => snapshotToolCall('snapshot_fill_month', { month })).toThrow('YYYY-MM')
    }
  })
})

describe('get_financial_snapshots', () => {
  it('is registered and reads the stored months', () => {
    expect(toolNamed('get_financial_snapshots').inputSchema.required ?? []).toEqual([])
    expect(snapshotToolCall('get_financial_snapshots', {})).toEqual({
      path: '/api/admin/reports/financial-trends',
      method: 'GET',
    })
  })
})

describe('list_crons', () => {
  it('names the monthly financial snapshot', () => {
    expect(toolNamed('list_crons').description).toContain('monthly financial snapshot')
  })
})

it('leaves every other tool name to the rest of the switch', () => {
  expect(snapshotToolCall('list_crons', {})).toBeNull()
  expect(snapshotToolCall('get_overview', {})).toBeNull()
})
