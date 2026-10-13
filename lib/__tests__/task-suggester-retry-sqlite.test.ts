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
const FIRST_DRAFT: SuggestResult = {
  ...EMPTY,
  suggestions: [{
    kind: 'create_task', targetTaskId: null, targetRequestId: null,
    proposal: { title: 'Send the pricing page plan', type: 'internal_client' },
    quote: 'Send the pricing page plan', rationale: null, confidence: 0.9,
  }],
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

  it('keeps the first draft exactly once when the fifth second-read timeout exhausts retries', async () => {
    const suggest = vi.fn(async (input: SuggestFromTranscriptInput): Promise<SuggestResult> => {
      if (input.alreadyProposed !== undefined) throw new SuggesterTimeoutError()
      return FIRST_DRAFT
    })
    for (let failure = 1; failure <= 5; failure++) {
      const summary = await runSuggestionSweep(fixture.database, { suggest, now: NOW })
      expect(summary.secondPass?.failed).toHaveLength(1)
      expect(summary.deferredIds).toEqual(failure < 5 ? ['old'] : [])
      const counter = fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)
      if (failure < 5) {
        expect(counter?.value).toBe(String(failure))
        expect(fixture.rows(schema.taskSuggestions)).toEqual([])
        expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBeNull()
      }
      else {
        expect(counter).toBeUndefined()
        expect(summary.skipped[0].reason).toContain('skipped after 5 deferred failures')
        expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBe('2026-10-13T00:00:00Z')
        expect(summary.inserted).toBe(1)
      }
    }
    expect(suggest).toHaveBeenCalledTimes(10)
    expect(fixture.rows(schema.taskSuggestions)).toEqual([
      expect.objectContaining({ transcript_id: 'old', proposal: JSON.stringify(FIRST_DRAFT.suggestions[0].proposal) }),
    ])
    const summary = await runSuggestionSweep(fixture.database, { suggest, now: NOW })
    expect(summary.looked).toBe(0)
    expect(suggest).toHaveBeenCalledTimes(10)
    expect(fixture.rows(schema.taskSuggestions)).toHaveLength(1)
    expect(fixture.errors).toEqual([])
  })

  it('leaves an exhausted second read unstamped if writing its first draft fails', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    fixture.sqlite.exec("CREATE TRIGGER reject_suggestion BEFORE INSERT ON task_suggestions BEGIN SELECT RAISE(ABORT, 'Fixture write failed'); END")
    const suggest = async (input: SuggestFromTranscriptInput): Promise<SuggestResult> => {
      if (input.alreadyProposed !== undefined) throw new SuggesterTimeoutError()
      return FIRST_DRAFT
    }
    await expect(runSuggestionSweep(fixture.database, { suggest, now: NOW })).rejects.toThrow('Fixture write failed')
    expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBeNull()
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('5')
    expect(fixture.rows(schema.taskSuggestions)).toEqual([])
  })

  it('clears only the successful transcript counter', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    fixture.insert(schema.settings, { key: 'suggester.failures.other', value: '2' })
    const summary = await runSuggestionSweep(fixture.database, { suggest: async () => EMPTY, now: NOW })
    expect(summary.deferred).toBe(0)
    expect(fixture.rows(schema.settings).map(row => row.key)).toEqual(['unrelated', 'suggester.failures.other'])
    expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBe('2026-10-13T00:00:00Z')
  })

  it.each([429, 529])('stops the batch for %s without consuming an existing retry allowance', async status => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = vi.fn(async () => { throw Object.assign(new Error('Provider limited'), { status }) })
    const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
    expect(suggest).toHaveBeenCalledOnce()
    expect(summary.deferredIds).toEqual(['old', 'new'])
    expect(summary.skipped[0].reason).toBe('suggester_failed: Provider limited')
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'old')?.suggested_at).toBeNull()
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'new')?.suggested_at).toBeNull()
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('4')
  })

  it.each([429, 529, 503, 520])('leaves no counter after five runs whose reads all return %s', async status => {
    seedTranscript('new')
    const suggest = vi.fn(async () => { throw Object.assign(new Error('Provider unavailable'), { status }) })
    for (let run = 0; run < 5; run++) {
      const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
      expect(summary.deferredIds).toEqual(['old', 'new'])
      expect(summary.skipped.every(row => row.reason.startsWith('suggester_failed:'))).toBe(true)
      expect(fixture.rows(schema.settings)).toEqual([expect.objectContaining({ key: 'unrelated', value: 'preserved' })])
      expect(fixture.rows(schema.callTranscripts).every(row => row.suggested_at === null)).toBe(true)
    }
    expect(suggest).toHaveBeenCalledTimes(status === 429 || status === 529 ? 5 : 10)
    expect(fixture.rows(schema.taskSuggestions)).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each([503, 'connection', 'connection_timeout'])('preserves the existing counter through five all-read %s outages', async failure => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const error = failure === 'connection'
      ? Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })
      : failure === 'connection_timeout'
        ? Object.assign(new Error('Connection timed out.'), { name: 'APIConnectionTimeoutError' })
        : Object.assign(new Error('Provider unavailable'), { status: failure })
    const suggest = vi.fn(async () => { throw error })
    for (let run = 0; run < 5; run++) {
      const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
      expect(summary.deferredIds).toEqual(['old', 'new'])
      expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('4')
      expect(fixture.rows(schema.settings).some(row => row.key === 'suggester.failures.new')).toBe(false)
      expect(fixture.rows(schema.callTranscripts).every(row => row.suggested_at === null)).toBe(true)
    }
    expect(suggest).toHaveBeenCalledTimes(10)
    expect(fixture.errors).toEqual([])
  })

  it.each([
    { failure: 503, failedId: 'old' },
    { failure: 503, failedId: 'new' },
    { failure: 'connection', failedId: 'old' },
    { failure: 'connection', failedId: 'new' },
  ])('counts $failure for $failedId when another read succeeds in the sweep', async ({ failure, failedId }) => {
    seedTranscript('new')
    fixture.insert(schema.settings, { key: `suggester.failures.${failedId}`, value: '3' })
    const error = failure === 'connection'
      ? Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })
      : Object.assign(new Error('Provider unavailable'), { status: failure })
    const suggest = vi.fn(async (input: SuggestFromTranscriptInput) => {
      if (input.callTitle === failedId) throw error
      return EMPTY
    })
    const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
    expect(summary.deferredIds).toEqual([failedId])
    expect(fixture.rows(schema.settings).find(row => row.key === `suggester.failures.${failedId}`)?.value).toBe('4')
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === failedId)?.suggested_at).toBeNull()
    expect(fixture.rows(schema.callTranscripts).find(row => row.id !== failedId)?.suggested_at).toBe('2026-10-13T00:00:00Z')
    expect(suggest).toHaveBeenCalledTimes(2)
    expect(fixture.errors).toEqual([])
  })

  it('exhausts a first-read provider failure only after a later read succeeds', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = async (input: SuggestFromTranscriptInput) => {
      if (input.callTitle === 'old') throw Object.assign(new Error('Provider unavailable'), { status: 503 })
      return EMPTY
    }
    const summary = await runSuggestionSweep(fixture.database, { suggest, secondPass: false, now: NOW })
    expect(summary.deferredIds).toEqual([])
    expect(summary.deferred).toBe(0)
    expect(summary.skipped[0].reason).toContain('skipped after 5 deferred failures')
    expect(fixture.rows(schema.callTranscripts).every(row => row.suggested_at === '2026-10-13T00:00:00Z')).toBe(true)
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)).toBeUndefined()
  })

  it.each([429, 529])('does not count second-read %s limits even when the first read succeeded', async status => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    const suggest = vi.fn(async (input: SuggestFromTranscriptInput): Promise<SuggestResult> => {
      if (input.alreadyProposed !== undefined) throw Object.assign(new Error('Provider limited'), { status })
      return FIRST_DRAFT
    })
    for (let run = 0; run < 5; run++) {
      const summary = await runSuggestionSweep(fixture.database, { suggest, now: NOW })
      expect(summary.deferredIds).toEqual(['old'])
      expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('4')
      expect(fixture.rows(schema.callTranscripts)[0].suggested_at).toBeNull()
      expect(fixture.rows(schema.taskSuggestions)).toEqual([])
    }
    expect(suggest).toHaveBeenCalledTimes(10)
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

  it('preserves the allowance when a connection timeout is the only read before the budget runs out', async () => {
    fixture.insert(schema.settings, { key: FAILURE_KEY, value: '4' })
    seedTranscript('new')
    const suggest = vi.fn(async () => {
      throw Object.assign(new Error('Connection timed out.'), { name: 'APIConnectionTimeoutError' })
    })
    const summary = await runSuggestionSweep(fixture.database, {
      suggest, secondPass: false, now: NOW,
      beforeRead: async () => { vi.setSystemTime(Date.now() + 55_000) },
    })
    expect(summary.skipped[0].reason).toBe('suggester_failed: Connection timed out.')
    expect(summary.deferredIds).toEqual(['old', 'new'])
    expect(fixture.rows(schema.settings).find(row => row.key === FAILURE_KEY)?.value).toBe('4')
    expect(fixture.rows(schema.callTranscripts).find(row => row.id === 'old')?.suggested_at).toBeNull()
    expect(suggest).toHaveBeenCalledOnce()
  })
})
