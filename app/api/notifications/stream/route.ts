import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'

/**
 * Server-Sent Events (SSE) endpoint for real-time notifications.
 * Clients connect here and receive push events without polling.
 *
 * Usage: const source = new EventSource('/api/notifications/stream')
 * source.onmessage = (e) => { const data = JSON.parse(e.data); ... }
 *
 * Load characteristics (Cloudflare Workers + D1):
 *  - The poll loop uses a self-scheduling setTimeout (not a fixed setInterval)
 *    so the interval can adapt. It runs at ~5s with +-1s jitter while there is
 *    activity, and backs off toward ~15s after consecutive empty polls. Any new
 *    notification resets it back to 5s. Jitter de-synchronises many concurrent
 *    streams so they do not all hit D1 on the same tick.
 *  - Each stream caps its own lifetime at ~5 minutes. Just before closing it
 *    emits a { type: 'reconnect' } hint and closes cleanly, so long-lived
 *    Workers connections recycle instead of accumulating as zombies.
 *  - A lightweight SSE comment heartbeat (': ping') is emitted every ~25s to
 *    stop intermediary proxies from killing an otherwise idle stream.
 */

const POLL_BASE_MS = 5000
const POLL_MAX_MS = 15000
const POLL_BACKOFF_STEP_MS = 2500
const POLL_JITTER_MS = 1000
const HEARTBEAT_MS = 25000
const MAX_LIFETIME_MS = 5 * 60 * 1000

export async function GET(req: NextRequest) {
  const { userId } = await getRequestAuth(req)

  if (!userId) {
    return new Response('Unauthorised', { status: 401 })
  }

  const encoder = new TextEncoder()
  let lastCheckedAt = new Date().toISOString()
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  // Current base delay for the poll loop. Grows toward POLL_MAX_MS on empty
  // polls, resets to POLL_BASE_MS whenever fresh notifications arrive.
  let baseDelay = POLL_BASE_MS

  const nextDelay = (foundNew: boolean): number => {
    baseDelay = foundNew
      ? POLL_BASE_MS
      : Math.min(POLL_MAX_MS, baseDelay + POLL_BACKOFF_STEP_MS)
    // +-POLL_JITTER_MS of jitter, floored so we never poll faster than 1s.
    const jitter = (Math.random() * 2 - 1) * POLL_JITTER_MS
    return Math.max(1000, Math.round(baseDelay + jitter))
  }

  // Tear the timers down the moment the client goes away (reload, navigate,
  // EventSource.close). Without this the timers LEAK: each reconnect would
  // leave an orphaned D1-polling loop running forever, and they pile up until
  // the runtime is starved. req.signal fires on client disconnect; cancel()
  // covers teardown initiated by the stream itself.
  const cleanup = () => {
    if (closed) return
    closed = true
    if (pollTimer) clearTimeout(pollTimer)
    if (keepAlive) clearInterval(keepAlive)
    if (lifetimeTimer) clearTimeout(lifetimeTimer)
  }
  req.signal.addEventListener('abort', cleanup)

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false
        try {
          controller.enqueue(chunk)
          return true
        } catch {
          cleanup()
          return false
        }
      }

      const closeCleanly = () => {
        if (closed) return
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      }

      // Initial handshake so the client knows the stream is live.
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`))

      // Self-scheduling poll loop with jitter + backoff.
      const scheduleNext = (delay: number) => {
        if (closed) return
        pollTimer = setTimeout(poll, delay)
      }

      const poll = async () => {
        if (closed) return
        let foundNew = false
        try {
          const database = await db()
          const newNotifications = await database
            .select()
            .from(schema.notifications)
            .where(
              and(
                eq(schema.notifications.userId, userId),
                eq(schema.notifications.read, false)
              )
            )
            .orderBy(desc(schema.notifications.createdAt))
            .limit(10)

          if (closed) return

          // Filter to only truly new ones since last check.
          const fresh = newNotifications.filter(n => n.createdAt > lastCheckedAt)

          if (fresh.length > 0) {
            foundNew = true
            lastCheckedAt = new Date().toISOString()
            for (const notification of fresh) {
              safeEnqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`
                )
              )
            }
          }
        } catch {
          // A transient D1 error should not kill the stream; just try again on
          // the next (backed-off) tick.
          foundNew = false
        }

        scheduleNext(nextDelay(foundNew))
      }

      // First poll uses the base cadence (with jitter) so we do not hammer D1
      // immediately on connect while still staggering concurrent streams.
      scheduleNext(nextDelay(false))

      // Heartbeat comment every ~25s so proxies do not kill an idle stream.
      keepAlive = setInterval(() => {
        safeEnqueue(encoder.encode(': ping\n\n'))
      }, HEARTBEAT_MS)

      // Cap the stream lifetime so Workers connections recycle instead of
      // lingering as zombies. Hint the client to reconnect, then close cleanly.
      lifetimeTimer = setTimeout(() => {
        if (closed) return
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'reconnect' })}\n\n`))
        closeCleanly()
      }, MAX_LIFETIME_MS)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
