import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { like } from 'drizzle-orm'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
 * Best-effort insert of one delivery-log row. Never throws - a logging failure
 * must not affect whether the webhook itself fired.
 */
async function logDelivery(
  database: Database,
  row: {
    endpointId: string
    event: string
    url: string
    status: 'delivered' | 'failed'
    statusCode: number | null
    errorMessage: string | null
  },
): Promise<void> {
  try {
    await database.insert(schema.webhookDeliveries).values({
      id: crypto.randomUUID(),
      endpointId: row.endpointId,
      event: row.event,
      url: row.url,
      status: row.status,
      statusCode: row.statusCode,
      errorMessage: row.errorMessage,
      attemptedAt: new Date().toISOString(),
    })
  } catch {
    console.error('Failed to write webhook delivery log row')
  }
}

/**
 * Fire webhooks for a given event.
 * Looks up all registered webhook endpoints that subscribe to this event,
 * and POSTs the payload to each URL with an HMAC-SHA256 signature header.
 *
 * Writes one webhook_deliveries row per endpoint attempt (delivered | failed)
 * so the settings > integrations UI can show a delivery history.
 *
 * This is fire-and-forget; failures are logged but do not throw. Pass the
 * caller's `database` so the delivery log is written on the same connection;
 * omitting it falls back to a fresh db() handle.
 */
export async function fireWebhook(
  event: string,
  payload: Record<string, unknown>,
  database?: Database,
): Promise<void> {
  let endpoints: WebhookEndpoint[] = []
  let drizzle: Database

  try {
    drizzle = database ?? ((await db()) as Database)

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

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tahi-Event': event,
          'X-Tahi-Signature': signature,
          'X-Tahi-Delivery': crypto.randomUUID(),
        },
        body,
        signal: AbortSignal.timeout(10000),
      })

      await logDelivery(drizzle, {
        endpointId: endpoint.id,
        event,
        url: endpoint.url,
        status: res.ok ? 'delivered' : 'failed',
        statusCode: res.status,
        errorMessage: res.ok ? null : `HTTP ${res.status}`,
      })
    } catch (err) {
      console.error(`Webhook delivery failed for endpoint ${endpoint.id}`)
      await logDelivery(drizzle, {
        endpointId: endpoint.id,
        event,
        url: endpoint.url,
        status: 'failed',
        statusCode: null,
        errorMessage: err instanceof Error ? err.message : 'Delivery error',
      })
    }
  })

  await Promise.allSettled(deliveries)
}
