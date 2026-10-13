import type { RecordedAudioChunk } from '@/lib/browser-call-recorder'

export interface RecordingOutboxChunk extends RecordedAudioChunk {
  key: string
  ownerId: string
  recordingId: string
}

const DATABASE = 'tahi-call-audio'
const STORE = 'chunks'

async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('This browser cannot save audio locally. Enable browser storage and retry.')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Local audio storage could not be opened. Enable browser storage and retry.'))
    request.onblocked = () => reject(new Error('Local audio storage is blocked by another dashboard tab. Close that tab and retry.'))
  })
}

async function change(operation: (store: IDBObjectStore) => void): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      operation(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('Audio could not be saved locally. Check available disk space.'))
      transaction.onabort = () => reject(new Error('Local audio storage was interrupted.'))
    })
  } finally { db.close() }
}

export async function storeRecordingChunk(ownerId: string, recordingId: string, chunk: RecordedAudioChunk): Promise<RecordingOutboxChunk> {
  const entry = { ...chunk, ownerId, recordingId, key: `${ownerId}:${recordingId}:${chunk.track}:${chunk.sequence}` }
  await change(store => { store.put(entry) })
  return entry
}

export async function removeRecordingChunk(key: string): Promise<void> {
  await change(store => { store.delete(key) })
}

export async function listRecordingChunks(ownerId: string, recordingId?: string): Promise<RecordingOutboxChunk[]> {
  const db = await database()
  try {
    const entries = await new Promise<RecordingOutboxChunk[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as RecordingOutboxChunk[])
      request.onerror = () => reject(new Error('Saved audio could not be read. Retry recovery.'))
    })
    return entries.filter(entry => entry.ownerId === ownerId && (!recordingId || entry.recordingId === recordingId))
      .sort((a, b) => a.startMs - b.startMs || a.sequence - b.sequence)
  } finally { db.close() }
}
