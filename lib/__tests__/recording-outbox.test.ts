import { afterEach, describe, expect, it, vi } from 'vitest'
import { listRecordingChunks, storeRecordingChunk, type RecordingOutboxChunk } from '@/lib/recording-outbox'

interface ControlledTransaction {
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
}

/** Control transaction boundaries rather than simulating a browser database. */
function storage(entries: RecordingOutboxChunk[] = []) {
  const transactions: ControlledTransaction[] = []
  const put = vi.fn()
  const close = vi.fn()
  const database = {
    close,
    transaction: vi.fn(() => {
      const transaction: ControlledTransaction & { objectStore: () => unknown } = {
        oncomplete: null, onerror: null, onabort: null,
        objectStore: () => ({
          put,
          getAll: () => {
            const request: { result: RecordingOutboxChunk[]; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: entries, onsuccess: null, onerror: null }
            queueMicrotask(() => request.onsuccess?.())
            return request
          },
        }),
      }
      transactions.push(transaction)
      return transaction
    }),
  }
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: { result: typeof database; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: database, onsuccess: null, onerror: null }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  })
  return { transactions, put, close }
}

function entry(ownerId: string, recordingId: string, sequence = 0): RecordingOutboxChunk {
  return {
    key: `${ownerId}:${recordingId}:mic:${sequence}`, ownerId, recordingId,
    track: 'mic', sequence, startMs: sequence * 30_000, durationMs: 30_000,
    mimeType: 'audio/webm', size: 5, blob: new Blob(['audio'], { type: 'audio/webm' }),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('durable recording outbox', () => {
  it('does not report audio saved until the write transaction commits', async () => {
    const fake = storage()
    const chunk = entry('liam', 'recording-one')
    let resolved = false
    const pending = storeRecordingChunk(chunk.ownerId, chunk.recordingId, chunk)
    void pending.then(() => { resolved = true })
    await vi.waitFor(() => expect(fake.put).toHaveBeenCalledOnce())
    expect(fake.put).toHaveBeenCalledWith(chunk)
    expect(resolved).toBe(false)
    expect(fake.close).not.toHaveBeenCalled()
    fake.transactions[0].oncomplete?.()
    expect(await pending).toEqual(chunk)
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it('reports transaction abort instead of treating a chunk as durably saved', async () => {
    const fake = storage()
    const chunk = entry('liam', 'recording-one')
    const pending = storeRecordingChunk(chunk.ownerId, chunk.recordingId, chunk)
    const rejected = expect(pending).rejects.toThrow('Local audio storage was interrupted')
    await vi.waitFor(() => expect(fake.transactions).toHaveLength(1))
    fake.transactions[0].onabort?.()
    await rejected
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it('offers only the signed-in owner audio and optionally only the chosen recording', async () => {
    const later = entry('liam', 'recording-one', 1)
    const first = entry('liam', 'recording-one', 0)
    const otherRecording = entry('liam', 'recording-two')
    const otherOwner = entry('staci', 'recording-one')
    storage([later, otherOwner, otherRecording, first])
    expect(await listRecordingChunks('liam', 'recording-one')).toEqual([first, later])
    expect((await listRecordingChunks('liam')).map(chunk => chunk.ownerId)).toEqual(['liam', 'liam', 'liam'])
    expect(await listRecordingChunks('unknown-owner')).toEqual([])
  })
})
