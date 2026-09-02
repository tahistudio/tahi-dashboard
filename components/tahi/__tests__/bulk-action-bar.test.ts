import { describe, it, expect } from 'vitest'
import { bulkResultToast } from '../bulk-action-bar'

describe('bulkResultToast', () => {
  it('reports a plural success with counted noun + verb', () => {
    expect(bulkResultToast({ ok: 3 }, { verb: 'archived', itemNoun: 'request' })).toEqual({
      message: '3 requests archived',
      type: 'success',
    })
  })

  it('uses the singular noun for a single item', () => {
    expect(bulkResultToast({ ok: 1 }, { verb: 'archived', itemNoun: 'request' })).toEqual({
      message: '1 request archived',
      type: 'success',
    })
  })

  it('flips to a warning toast on partial failure', () => {
    expect(bulkResultToast({ ok: 2, failed: 1 }, { verb: 'updated', itemNoun: 'task' })).toEqual({
      message: '2 tasks updated, 1 failed',
      type: 'warning',
    })
  })

  it('treats failed: 0 as a full success', () => {
    expect(bulkResultToast({ ok: 4, failed: 0 }, { verb: 'assigned', itemNoun: 'request' })).toEqual({
      message: '4 requests assigned',
      type: 'success',
    })
  })

  it('lets successMessage override the counted default', () => {
    expect(
      bulkResultToast({ ok: 5 }, { verb: 'updated', itemNoun: 'request', successMessage: 'All set' }),
    ).toEqual({ message: 'All set', type: 'success' })
  })

  it('falls back to sensible defaults for verb and noun', () => {
    expect(bulkResultToast({ ok: 2 }, {})).toEqual({
      message: '2 items updated',
      type: 'success',
    })
  })
})
