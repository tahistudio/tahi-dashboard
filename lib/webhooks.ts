import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { like } from 'drizzle-orm'

const WEBHOOK_KEY_PREFIX = 'webhook_endpoint_'

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  createdAt: string
}

/**
 * Generate an HMAC-SHA256 signature for webhook payload verification.
 */
async function hmacSign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Fire webhooks for a given event.
 * Looks up all registered webhook endpoints that subscribe to this event,
 * and POSTs the payload to each URL with an HMAC-SHA256 signature header.
 *
 * This is fire-and-forget; failures are logged but do not throw.
 */
export async function fireWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  let endpoints: WebhookEndpoint[] = []

  try {
    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    const rows = await drizzle
      .select()
      .from(schema.settings)
      .where(like(schema.settings.key, `${WEBHOOK_KEY_PREFIX}%`))

    endpoints = rows
      .map(row => {
        try {
          return JSON.parse(row.value ?? '{}') as WebhookEndpoint
        } catch {
          return null
        }
      })
      .filter((e): e is WebhookEndpoint => e !== null)
      .filter(e => e.events.includes(event) || e.events.includes('*'))
  } catch {
    console.error('Failed to load webhook endpoints')
    return
  }

  if (endpoints.length === 0) return

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  const deliveries = endpoints.map(async (endpoint) => {
    try {
      const signature = await hmacSign(endpoint.secret, body)

      await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tahi-Event': event,
          'X-Tahi-Signature': signature,
          'X-Tahi-Delivery': crypto.randomUUID(),
        },
        body,
      })
    } catch {
      console.error(`Webhook delivery failed for endpoint ${endpoint.id}`)
    }
  })

  await Promise.allSettled(deliveries)
}
