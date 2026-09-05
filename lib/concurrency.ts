/**
 * Bounded parallelism for the browser.
 *
 * A serial `for` loop over a selection is one round trip per row, and a bare
 * `Promise.all` over the same selection is fifty at once. Both are wrong for a
 * bulk action against D1: the first leaves an operator watching a spinner for
 * a minute, the second opens more sockets than the browser will grant and
 * hands the worker a thundering herd.
 */

/**
 * Maps `items` through `fn`, never running more than `limit` at a time, and
 * resolves with the results in the input's order.
 *
 * `fn` is expected to settle: it is handed the item and its index, and any
 * rejection rejects the whole call, exactly as `Promise.all` does. Callers
 * that want per-item failure counts should catch inside `fn` and return a
 * result shape.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const width = Math.max(1, Math.floor(limit))
  const out = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      out[index] = await fn(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, () => worker()),
  )
  return out
}
