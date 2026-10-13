import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '@/db/d1'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'
import {
  runSuggestionSweep,
  SuggesterTimeoutError,
  type SuggestFromTranscriptInput,
  type SuggestResult,
} from '@/lib/task-suggester'

const NOW = new Date('2026-10-13T00:00:00Z')
const EMPTY: SuggestResult = {
  suggestions: [], dropped: [], usage: { model: 'fixture', inputTokens: 0, outputTokens: 0 },
}
const FAILURE_KEY = 'suggester.failures.old'
let fixture: ReturnType<typeof permissionSqlite>

function seedTranscript(id: string) {
  fixture.insert(schema.callTranscripts, {
    id, call_kind: 'scheduled', call_id: 'client-call', source: 'manual', external_id: id,
    title: id, text: `Read ${id}`, hash: id, wrap_up: null, suggested_at: null,
    received_at: id === 'old' ? '2026-10-11T00:00:00Z' : '2026-10-12T00:00:00Z',
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.stubEnv('SLACK_BOT_TOKEN', '')
  fixture = permissionSqlite([
    schema.settings, schema.callTranscripts, schema.scheduledCalls, schema.teamMembers,
    schema.tasks, schema.requests, schema.contacts, schema.taskSuggestions,
  ], ['CREATE UNIQUE INDEX settings_key ON settings (key)'])
  fixture.insert(schema.scheduledCalls, { id: 'client-call', org_id: 'org-a' })
  fixture.insert(schema.settings, { key: 'unrelated', value: 'preserved' })
  seedTranscript('old')
})

afterEach(() => {
  fixture.close()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('suggester durable retry allowance over real SQLite', () => {
  it('lets newer calls through each full timeout, then stamps and skips the fifth failed read', async () => {
    const suggest = vi.fn((input: SuggestFromTranscriptInput): Promise<SuggestResult> =>
      input.callTitle === 'old' ? new Promise(() => {}) : Promise.resolve(EMPTY),
    )
    for (let failure = 1; failure <= 5; failure++) {
      seedTranscript(`new-${failure}`)
      const pending = runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
      await vi.advanceTimersByTimeAsync(30_000)
      const summary = await pending

      expect(summary.looked).toBe(2)
      expect(summary.deferredIds).toEqual(failure < 5 ? ['old'] : [])
      expect(fixture.rows(schema.callTranscripts).find(row => row.id === `new-${failure}`)?.suggested_at).not.toBeNull()
      const counter = fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)
      const old = fixture.rows(schema.callTranscripts).find(row => row.id === 'old')
      if (failure < 5) {
        expect(counter).toMatchObject({ value: String(failure), updated_at: '2026-10-13T00:00:00Z' })
        expect(old?.suggested_at).toBeNull()
      } else {
        expect(counter).toBeUndefined()
        expect(old?.suggested_at).toBe('2026-10-13T00:00:00Z')
        expect(summary.skipped).toEqual([
          { transcriptId: 'old', reason: expect.stringMatching(/skipped after 5 deferred failures.*timed out/i) },
        ])
      }
    }
    expect(suggest.mock.calls.filter(([input]) => input.callTitle === 'old')).toHaveLength(5)
    const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
    expect(summary.looked).toBe(0)
    expect(suggest).toHaveBeenCalledTimes(10)
    expect(fixture.rows(schema.settings)).toEqual([expect.objectContaining({ key: 'unrelated', value: 'preserved' })])
    expect(fixture.rows(schema.taskSuggestions)).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('counts second-read failures once per deferred attempt and caps the fifth', async () => {
    const suggest = vi.fn(async (input: SuggestFromTranscriptInput): Promise<SuggestResult> => {
      if (input.alreadyProposed !== undefined) throw new SuggesterTimeoutError()
      return EMPTY
    })
    for (let failure = 1; failure <= 5; failure++) {
      const summary = await runSuggestionSweep(fixture.database, { suggest, now: NOW })
      expect(summary.secondPass?.failed).toHaveLength(1)
      expect(summary.deferredIds).toEqual(failure < 5 ? ['old'] : [])
      const counter = fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)
      if (failure < 5) expect(counter?.value).toBe(String(failure))
      else {
        expect(counter).toBeUndefined()
        expect(summary.skipped[0].reason).toContain('skipped after 5 deferred failures')
        expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBe('2026-10-13T00:00:00Z')
      }
    }
    expect(suggest).toHaveBeenCalledTimes(10)
    expect(fixture.rows(schema.taskSuggestions)).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('clears only the successful transcript counter', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    fixture.insert(schema.settings, { key: 'suggester.failures.other', value: '2' })
    const summary = await runSuggestionSweep(fixture.database, { suggest: async () => EMPTY, now: NOW })
    expect(summary.deferred).toBe(0)
    expect(fixture.rows(schema.settings).map(row => row.key)).toEqual(['unrelated', 'suggester.failures.other'])
    expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBe('2026-10-13T00:00:00Z')
  })

  it.each([429, 529])('still stops the batch for %s even when its failing transcript exhausts retries', async status => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = vi.fn(async () => { throw Object.assign(new Error('Provider limited'), { status }) })
    const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
    expect(suggest).toHaveBeenCalledOnce()
    expect(summary.deferredIds).toEqual(['new'])
    expect(summary.skipped[0].reason).toContain('skipped after 5 deferred failures')
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'old')?.suggested_at).not.toBeNull()
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'new')?.suggested_at).toBeNull()
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)).toBeUndefined()
  })

  it('leaves the counter intact when the sweep budget shortened the first deadline', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = vi.fn((): Promise<SuggestResult> => new Promise(() => {}))
    const pending = runSuggestionSweep(fixture.database, {
      suggest, now: NOW, beforeRead: async () => { vi.setSystemTime(Date.now() + 55_000) },
    })
    await vi.advanceTimersByTimeAsync(15_000)
    const summary = await pending
    expect(summary.deferredIds).toEqual(['old', 'new'])
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('4')
    expect(fixture.rows(schema.callTranscripts).every(row => row.suggested_at === null)).toBe(true)
    expect(suggest).toHaveBeenCalledOnce()
  })

  it('counts a connection timeout before a shortened deadline as a transcript failure', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = vi.fn(async () => {
      throw Object.assign(new Error('Connection timed out.'), { name: 'APIConnectionTimeoutError' })
    })
    const summary = await runSuggestionSweep(fixture.database, {
      suggest, secondPass: false, now: NOW,
      beforeRead: async () => { vi.setSystemTime(Date.now() + 55_000) },
    })
    expect(summary.skipped[0].reason).toContain('skipped after 5 deferred failures')
    expect(summary.deferredIds).toEqual(['new'])
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)).toBeUndefined()
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'old')?.suggested_at).not.toBeNull()
    expect(suggest).toHaveBeenCalledOnce()
  })
})
