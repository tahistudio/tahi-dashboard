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

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      const heartbeat = encoder.encode(
        `data: ${JSON.stringify({ type: 'connected', userId })}\n\n`
      )
      controller.enqueue(heartbeat)

      // Poll for new notifications every 5 seconds and push them
      const interval = setInterval(async () => {
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

          // Filter to only truly new ones since last check
          const fresh = newNotifications.filter(
            n => n.createdAt > lastCheckedAt
          )

          if (fresh.length > 0) {
            lastCheckedAt = new Date().toISOString()
            for (const notification of fresh) {
              const event = encoder.encode(
                `data: ${JSON.stringify({ type: 'notification', notification })}\n\n`
              )
              controller.enqueue(event)
            }
          }

          // Send keep-alive ping
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(interval)
        }
      }, 5000)

      // Keep-alive ping every 30 seconds (backup)
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(keepAlive)
          clearInterval(interval)
        }
      }, 30000)
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
