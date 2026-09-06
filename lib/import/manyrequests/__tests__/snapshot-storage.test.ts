/**
 * The R2 side door for the snapshot import: only keys under one prefix, one
 * extension, no traversal; every failure carries the status the route answers
 * with; a good object parses to the value the validator will see.
 */
import { describe, it, expect } from 'vitest'
import {
  isSnapshotKey,
  readSnapshotFromStorage,
  SNAPSHOT_MAX_BYTES,
  type SnapshotBucket,
} from '@/lib/import/manyrequests/snapshot-storage'

function bucketWith(objects: Record<string, string>): SnapshotBucket {
  return {
    async get(key: string) {
      const text = objects[key]
      if (text === undefined) return null
      return { size: text.length, text: async () => text }
    },
  }
}

describe('isSnapshotKey', () => {
  it('accepts a filename-safe key under the import prefix', () => {
    expect(isSnapshotKey('imports/manyrequests/snapshot-2026-09-07.json')).toBe(true)
    expect(isSnapshotKey('imports/manyrequests/a.json')).toBe(true)
  })

  it('refuses every other shape', () => {
    for (const bad of [
      'snapshot.json',
      'imports/manyrequests/snapshot.txt',
      'imports/manyrequests/../secrets.json',
      'imports/manyrequests/sub/dir.json',
      'uploads/client/file.json',
      'imports/manyrequests/.json',
      '',
      null,
      42,
      'imports/manyrequests/' + 'x'.repeat(200) + '.json',
    ]) {
      expect(isSnapshotKey(bad)).toBe(false)
    }
  })
})

describe('readSnapshotFromStorage', () => {
  it('parses a stored export and reports its size', async () => {
    const bucket = bucketWith({ 'imports/manyrequests/s.json': '{"organizations":[{"id":1}]}' })
    const read = await readSnapshotFromStorage(bucket, 'imports/manyrequests/s.json')
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.value).toEqual({ organizations: [{ id: 1 }] })
      expect(read.bytes).toBe(28)
    }
  })

  it('answers 400 for a key outside the allowed shape before touching the bucket', async () => {
    let touched = false
    const bucket: SnapshotBucket = {
      async get() {
        touched = true
        return null
      },
    }
    const read = await readSnapshotFromStorage(bucket, 'uploads/anything.json')
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.status).toBe(400)
    expect(touched).toBe(false)
  })

  it('answers 404 when the object is missing', async () => {
    const read = await readSnapshotFromStorage(bucketWith({}), 'imports/manyrequests/missing.json')
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.status).toBe(404)
  })

  it('answers 503 when the bucket is not bound or the read throws', async () => {
    const unbound = await readSnapshotFromStorage(null, 'imports/manyrequests/s.json')
    expect(unbound.ok).toBe(false)
    if (!unbound.ok) expect(unbound.status).toBe(503)
    const throwing: SnapshotBucket = {
      async get() {
        throw new Error('bucket offline')
      },
    }
    const failed = await readSnapshotFromStorage(throwing, 'imports/manyrequests/s.json')
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.status).toBe(503)
      expect(failed.error).toContain('bucket offline')
    }
  })

  it('answers 413 for an object above the size limit', async () => {
    const bucket: SnapshotBucket = {
      async get() {
        return { size: SNAPSHOT_MAX_BYTES + 1, text: async () => '{}' }
      },
    }
    const read = await readSnapshotFromStorage(bucket, 'imports/manyrequests/big.json')
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.status).toBe(413)
  })

  it('answers 400 for an object that is not JSON', async () => {
    const read = await readSnapshotFromStorage(
      bucketWith({ 'imports/manyrequests/bad.json': '{not json' }),
      'imports/manyrequests/bad.json',
    )
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.status).toBe(400)
      expect(read.error).toContain('not valid JSON')
    }
  })
})
