/**
 * wrangler.json carries the Workers AI binding the voice path reads
 * (CN.2 section 4).
 *
 * Why this is a test rather than a line in a doc: lib/slack/voice.ts is
 * written to survive a missing binding, which is the right behaviour on a
 * worker deployed before this slice and the reason a DROPPED binding would be
 * invisible. Voice notes would simply answer "not enabled yet" forever and
 * nobody would get an error to chase. The binding is named in two places in
 * one file, and a merge that keeps one and loses the other is exactly the
 * mistake this catches.
 *
 * Reads the config off disk in the manner of
 * app/api/__tests__/cron-trigger-schedule.test.ts.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { WHISPER_MODEL } from '../voice'

interface AiBinding {
  binding?: string
}

interface WranglerConfig {
  ai?: AiBinding
  env?: Record<string, { ai?: AiBinding }>
}

const config: WranglerConfig = JSON.parse(
  readFileSync(join(__dirname, '../../../wrangler.json'), 'utf8'),
)

describe('the AI binding in wrangler.json', () => {
  it('is on the production worker', () => {
    expect(config.ai?.binding).toBe('AI')
  })

  it('is on every named environment too', () => {
    const envs = Object.entries(config.env ?? {})
    expect(envs.length).toBeGreaterThan(0)
    for (const [name, env] of envs) {
      expect(env.ai?.binding, `env.${name} is missing the AI binding`).toBe('AI')
    }
  })

  it('names the model the voice path asks for in one place only', () => {
    expect(WHISPER_MODEL).toBe('@cf/openai/whisper')
  })
})
