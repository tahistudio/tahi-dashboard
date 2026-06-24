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
 */
export async function GET(req: NextRequest) {
  const { userId } = await getRequestAuth(req)

  if (!userId) {
    return new Response('Unauthorised', { status: 401 })
  }

  const encoder = new TextEncoder()
  let lastCheckedAt = new Date().toISOString()
  let interval: ReturnType<typeof setInterval> | undefined
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let closed = false

  // Tear the polling timers down the moment the client goes away (reload,
  // navigate, EventSource.close). Without this the intervals LEAK: each
  // reconnect leaves an orphaned 5s D1-polling loop running forever, and they
  // pile up across reloads until the dev server is starved. req.signal fires on
  // client disconnect; cancel() covers teardown initiated by the stream itself.
  const cleanup = () => {
    if (closed) return
    closed = true
    if (interval) clearInterval(interval)
    if (keepAlive) clearInterval(keepAlive)
  }
  req.signal.addEventListener('abort', cleanup)

  const stream = new ReadableStream({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          cleanup()
        }
      }

      // Initial heartbeat
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`))

      // Poll for new notifications every 5 seconds and push them
      interval = setInterval(async () => {
        if (closed) return
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

          // Filter to only truly new ones since last check
          const fresh = newNotifications.filter(
            n => n.createdAt > lastCheckedAt
          )

          if (fresh.length > 0) {
            lastCheckedAt = new Date().toISOString()
            for (const notification of fresh) {
              safeEnqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`
                )
              )
            }
          }

          // Send keep-alive ping
          safeEnqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }, 5000)

      // Keep-alive ping every 30 seconds (backup)
      keepAlive = setInterval(() => {
        safeEnqueue(encoder.encode(': ping\n\n'))
      }, 30000)
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
