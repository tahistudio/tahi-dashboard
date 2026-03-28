import { schema } from '@/db/d1'
import { like } from 'drizzle-orm'

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  createdAt: string
}

interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

const WEBHOOK_KEY_PREFIX = 'webhook_endpoint_'
const MAX_RETRIES = 3
const RETRY_DELAYS = [1000, 5000, 15000] // ms

/**
 * Delivers a webhook event to all registered endpoints that subscribe to it.
 * Includes retry logic with exponential backoff.
 */
export async function deliverWebhook(
  database: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  event: string,
  data: Record<string, unknown>
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0
  let failed = 0

  // Get all webhook endpoints
  const rows = await database
    .select()
    .from(schema.settings)
    .where(like(schema.settings.key, `${WEBHOOK_KEY_PREFIX}%`))

  const endpoints: WebhookEndpoint[] = rows
    .map(row => {
      try { return JSON.parse(row.value ?? '{}') as WebhookEndpoint }
      catch { return null }
    })
    .filter((e): e is WebhookEndpoint => e !== null)

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  }

  for (const endpoint of endpoints) {
    // Check if this endpoint subscribes to this event
    if (!endpoint.events.includes(event) && !endpoint.events.includes('*')) {
      continue
    }

    const success = await deliverWithRetry(endpoint, payload)
    if (success) {
      delivered++
    } else {
      failed++
    }
  }

  return { delivered, failed }
}

async function deliverWithRetry(
  endpoint: WebhookEndpoint,
  payload: WebhookPayload
): Promise<boolean> {
  const body = JSON.stringify(payload)

  // Generate HMAC signature
  const signature = await generateSignature(body, endpoint.secret)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tahi-Signature': signature,
          'X-Tahi-Event': payload.event,
          'X-Tahi-Delivery': crypto.randomUUID(),
          'X-Tahi-Retry': String(attempt),
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (res.ok || (res.status >= 200 && res.status < 300)) {
        return true
      }

      // 4xx errors (except 429) should not be retried
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return false
      }
    } catch {
      // Network error, will retry
    }

    // Wait before retry (unless last attempt)
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]))
    }
  }

  return false
}

async function generateSignature(body: string, secret: string): Promise<string> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return ''
  }
}
