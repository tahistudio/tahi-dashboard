/**
 * lib/slack/defer.ts
 *
 * Answer Slack now, do the work after.
 *
 * Slack retries any delivery it does not see a 200 for within three seconds,
 * up to three times, so a route that awaited its own work would turn one DM
 * into three replies the moment a model call or a D1 read went slow. Every
 * Slack route therefore hands its work to `ctx.waitUntil` and returns
 * immediately, which keeps the worker alive for the work without keeping Slack
 * waiting for it.
 *
 * The work is passed as a THUNK rather than a promise on purpose, and the
 * thunk is called on the next macrotask rather than immediately: the response
 * is built and returned before the first D1 read of the background job, so the
 * ack is never competing with the work it defers. waitUntil holds the worker
 * open across that hop.
 *
 * Same pattern as lib/events.ts#dispatchDomainEvent and the Xero webhook's
 * reconcile; kept separate from lib/slack/dispatch.ts so a test can mock the
 * dispatcher without losing the deferral.
 */

/** One macrotask, which is the response leaving before the work begins. */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * Run `work` after the response, under ctx.waitUntil when there is one.
 *
 * Never throws: a failure inside the work is logged, because there is nobody
 * left to return it to, and a failure setting the deferral up falls back to a
 * detached promise (which is what local dev always uses).
 */
export async function deferSlackWork(work: () => Promise<void>): Promise<void> {
  let waitUntil: ((promise: Promise<unknown>) => void) | null = null

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const cfCtx = await getCloudflareContext({ async: true })
    if (cfCtx?.ctx?.waitUntil) waitUntil = cfCtx.ctx.waitUntil.bind(cfCtx.ctx)
  } catch {
    // No execution context (local dev, or a test): run it detached.
    waitUntil = null
  }

  const promise = nextMacrotask().then(work).catch((err: unknown) => {
    console.error('[slack] deferred work failed:', err instanceof Error ? err.message : err)
  })

  if (waitUntil) waitUntil(promise)
  else void promise
}
