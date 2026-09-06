/**
 * A ManyRequests export parked in R2, read back by key for the importer.
 *
 * Why a key and not only a body: the snapshot is fetched read-only through the
 * ManyRequests MCP connector on the operator's machine and is most of a
 * megabyte. The dashboard page cannot reach a local file server (Chrome blocks
 * a public https page from fetching a loopback address), and pasting the file
 * through the browser is not workable, so the operator puts it in the studio
 * bucket with wrangler (`wrangler r2 object put tahi-storage/<key> --file
 * snapshot.json --remote`) and posts the key. The route reads it server-side
 * and hands it to the same validator the body path uses, so nothing about the
 * import itself changes.
 *
 * The key is constrained to one prefix and one extension so this endpoint can
 * never be turned into a reader of arbitrary client files in the bucket.
 *
 * Pure module: no D1, no Next, no Cloudflare imports. The bucket is passed in
 * structurally so a unit test can hand over a fake.
 */

export const SNAPSHOT_KEY_PREFIX = 'imports/manyrequests/'

/** `imports/manyrequests/<name>.json`, where name is a filename-safe token. */
export const SNAPSHOT_KEY_PATTERN = /^imports\/manyrequests\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/

/** The largest export this path will parse. Ten times the real portal. */
export const SNAPSHOT_MAX_BYTES = 25 * 1024 * 1024

export function isSnapshotKey(value: unknown): value is string {
  return typeof value === 'string' && SNAPSHOT_KEY_PATTERN.test(value) && !value.includes('..')
}

/** The slice of an R2 bucket this module needs, so callers can pass a fake. */
export interface SnapshotBucket {
  get(key: string): Promise<{ size?: number; text(): Promise<string> } | null>
}

export type SnapshotRead =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; status: 400 | 404 | 413 | 503; error: string }

/**
 * Read and parse one snapshot object. Every failure carries the HTTP status
 * the route should answer with and a one-line reason an operator can act on.
 */
export async function readSnapshotFromStorage(
  bucket: SnapshotBucket | null | undefined,
  key: unknown,
): Promise<SnapshotRead> {
  if (!isSnapshotKey(key)) {
    return {
      ok: false,
      status: 400,
      error: `snapshotKey must look like ${SNAPSHOT_KEY_PREFIX}<name>.json (letters, digits, dot, dash, underscore).`,
    }
  }
  if (!bucket) {
    return { ok: false, status: 503, error: 'The storage bucket is not bound on this worker, so a snapshot key cannot be read.' }
  }
  let object: { size?: number; text(): Promise<string> } | null
  try {
    object = await bucket.get(key)
  } catch (error) {
    return { ok: false, status: 503, error: `Storage read failed: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
  if (!object) {
    return { ok: false, status: 404, error: `No object at ${key}. Upload it first with wrangler r2 object put.` }
  }
  if (typeof object.size === 'number' && object.size > SNAPSHOT_MAX_BYTES) {
    return { ok: false, status: 413, error: `Snapshot at ${key} is ${object.size} bytes, above the ${SNAPSHOT_MAX_BYTES} byte limit.` }
  }
  let text: string
  try {
    text = await object.text()
  } catch (error) {
    return { ok: false, status: 503, error: `Storage read failed: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
  if (text.length > SNAPSHOT_MAX_BYTES) {
    return { ok: false, status: 413, error: `Snapshot at ${key} is ${text.length} bytes, above the ${SNAPSHOT_MAX_BYTES} byte limit.` }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown, bytes: text.length }
  } catch (error) {
    return { ok: false, status: 400, error: `Snapshot at ${key} is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}` }
  }
}
