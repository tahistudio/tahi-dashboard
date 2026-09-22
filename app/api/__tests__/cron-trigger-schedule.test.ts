/**
 * Coverage check for the cron trigger worker's schedule.
 *
 * workers/** is excluded from the app's Vitest run (see vitest.config.ts),
 * so this spec imports the pure mapping tables directly, the same pattern
 * as app/api/__tests__/mcp-oauth-approval.test.ts for workers/mcp-server.
 *
 * The thing this guards against: wrangler.jsonc's triggers.crons list and
 * src/schedule.ts's cronToTargets map drifting apart. If a cron string is
 * added to one and not the other, the Worker either fires nothing on a
 * schedule Cloudflare is invoking, or configures a schedule that never
 * hits a target.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { cronToTargets, targetToPath } from '../../../workers/cron-trigger/src/schedule'

function readWranglerCrons(): string[] {
  const raw = readFileSync(
    join(__dirname, '../../../workers/cron-trigger/wrangler.jsonc'),
    'utf8',
  )
  // Strip // line comments before parsing. wrangler.jsonc allows them;
  // JSON.parse does not. None of the string values in this file contain
  // "//", so a naive strip is safe here.
  const withoutComments = raw
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//')
      return index === -1 ? line : line.slice(0, index)
    })
    .join('\n')
  const parsed: { triggers: { crons: string[] } } = JSON.parse(withoutComments)
  return parsed.triggers.crons
}

describe('wrangler.jsonc crons vs cronToTargets', () => {
  const wranglerCrons = readWranglerCrons()

  it('has at least one cron configured', () => {
    expect(wranglerCrons.length).toBeGreaterThan(0)
  })

  it('maps every cron string in wrangler.jsonc to at least one target', () => {
    for (const cron of wranglerCrons) {
      const targets = cronToTargets[cron]
      expect(targets, `cronToTargets is missing an entry for "${cron}"`).toBeDefined()
      expect(targets.length, `cronToTargets["${cron}"] has no targets`).toBeGreaterThan(0)
    }
  })

  it('has no cronToTargets entry that is missing from wrangler.jsonc', () => {
    for (const cron of Object.keys(cronToTargets)) {
      expect(wranglerCrons, `"${cron}" is in cronToTargets but not wrangler.jsonc`).toContain(cron)
    }
  })
})

describe('targetToPath', () => {
  it('maps every target reachable from cronToTargets to a path', () => {
    const targets = new Set<string>()
    for (const values of Object.values(cronToTargets)) {
      for (const target of values) targets.add(target)
    }
    for (const target of targets) {
      expect(targetToPath[target], `targetToPath is missing an entry for "${target}"`).toBeTruthy()
    }
  })

  it('routes the three special-cased targets exactly as the retired workflow did', () => {
    expect(targetToPath['sync-calendar']).toBe('integrations/google/sync-calendar')
    expect(targetToPath['sync-drive-transcripts']).toBe('integrations/google/sync-drive-transcripts')
    expect(targetToPath['suggest-from-transcripts']).toBe('crons/suggest-from-transcripts')
    expect(targetToPath['sync-airwallex']).toBe('integrations/airwallex/sync')
    expect(targetToPath['ai-briefing']).toBe('ai/briefing/cron')
    expect(targetToPath['overview-brief']).toBe('overview/brief/refresh')
  })

  it('falls back to cron/<target> for everything else', () => {
    expect(targetToPath['pre-call-digest']).toBe('cron/pre-call-digest')
    expect(targetToPath['leads-ai']).toBe('cron/leads-ai')
    expect(targetToPath['sync-xero']).toBe('cron/sync-xero')
    expect(targetToPath['finance-anomaly-scan']).toBe('cron/finance-anomaly-scan')
  })
})
