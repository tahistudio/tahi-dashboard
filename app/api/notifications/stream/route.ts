import { auth } from '@clerk/nextjs/server'

export const runtime = 'edge'

/**
 * Server-Sent Events (SSE) endpoint for real-time notifications.
 * Clients connect here and receive push events without polling.
 *
 * Usage: const source = new EventSource('/api/notifications/stream')
 * source.onmessage = (e) => { const data = JSON.parse(e.data); ... }
 */
export async function GET() {
  const { userId } = await auth()

  if (!userId) {
    return new Response('Unauthorised', { status: 401 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      const heartbeat = encoder.encode(
        `data: ${JSON.stringify({ type: 'connected', userId })}\n\n`
      )
      controller.enqueue(heartbeat)

      // Keep-alive ping every 30 seconds
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(interval)
        }
      }, 30000)

      // TODO: Subscribe to notification events for this user
      // When a notification is created for userId, push it here:
      // controller.enqueue(encoder.encode(`data: ${JSON.stringify(notification)}\n\n`))
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
