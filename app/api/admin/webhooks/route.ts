import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, like } from 'drizzle-orm'

const WEBHOOK_KEY_PREFIX = 'webhook_endpoint_'

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  /** Paused endpoints keep their record + secret but should not receive deliveries. */
  active: boolean
  createdAt: string
}

/**
 * GET /api/admin/webhooks
 * List all registered webhook endpoints from the settings table.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const rows = await drizzle
    .select()
    .from(schema.settings)
    .where(like(schema.settings.key, `${WEBHOOK_KEY_PREFIX}%`))

  const endpoints: WebhookEndpoint[] = rows
    .map(row => {
      try {
        const parsed = JSON.parse(row.value ?? '{}') as WebhookEndpoint
        // Records written before the active flag existed count as active.
        return { ...parsed, active: parsed.active !== false }
      } catch {
        return null
      }
    })
    .filter((e): e is WebhookEndpoint => e !== null)

  return NextResponse.json({ endpoints })
}

/**
 * POST /api/admin/webhooks
 * Register a new webhook endpoint.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const body = await req.json() as {
    url?: string
    secret?: string
    events?: string[]
  }

  const { url, secret, events } = body

  if (!url || !secret || !events || events.length === 0) {
    return NextResponse.json(
      { error: 'url, secret, and events are required' },
      { status: 400 },
    )
  }

  // Validate URL
  try {
    new URL(url)
  } catch {
    return NextResponse.json(
      { error: 'url must be a valid URL' },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const endpoint: WebhookEndpoint = { id, url, secret, events, active: true, createdAt: now }

  await drizzle
    .insert(schema.settings)
    .values({
      key: `${WEBHOOK_KEY_PREFIX}${id}`,
      value: JSON.stringify(endpoint),
      updatedAt: now,
    })

  return NextResponse.json({ success: true, endpoint }, { status: 201 })
}

/**
 * PATCH /api/admin/webhooks
 * Update an endpoint in place (url, events, active), preserving its id, signing
 * secret, createdAt and delivery history correlation.
 */
export async function PATCH(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const body = await req.json() as {
    id?: string
    url?: string
    events?: string[]
    active?: boolean
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  if (body.url !== undefined) {
    try {
      new URL(body.url)
    } catch {
      return NextResponse.json({ error: 'url must be a valid URL' }, { status: 400 })
    }
  }
  if (body.events !== undefined && (!Array.isArray(body.events) || body.events.length === 0)) {
    return NextResponse.json({ error: 'events must be a non-empty array' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const key = `${WEBHOOK_KEY_PREFIX}${body.id}`

  const [row] = await drizzle
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
  }

  let existing: WebhookEndpoint
  try {
    existing = JSON.parse(row.value ?? '{}') as WebhookEndpoint
  } catch {
    return NextResponse.json({ error: 'Stored endpoint record is corrupt' }, { status: 500 })
  }

  const endpoint: WebhookEndpoint = {
    ...existing,
    url: body.url ?? existing.url,
    events: body.events ?? existing.events,
    active: body.active ?? existing.active !== false,
  }

  await drizzle
    .update(schema.settings)
    .set({ value: JSON.stringify(endpoint), updatedAt: new Date().toISOString() })
    .where(eq(schema.settings.key, key))

  return NextResponse.json({ success: true, endpoint })
}

/**
 * DELETE /api/admin/webhooks
 * Remove a webhook endpoint by id (passed as query param).
 */
export async function DELETE(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle
    .delete(schema.settings)
    .where(eq(schema.settings.key, `${WEBHOOK_KEY_PREFIX}${id}`))

  return NextResponse.json({ success: true })
}
