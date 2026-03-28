import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
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
 * GET /api/admin/webhooks
 * List all registered webhook endpoints from the settings table.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const rows = await drizzle
    .select()
    .from(schema.settings)
    .where(like(schema.settings.key, `${WEBHOOK_KEY_PREFIX}%`))

  const endpoints: WebhookEndpoint[] = rows
    .map(row => {
      try {
        return JSON.parse(row.value ?? '{}') as WebhookEndpoint
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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const endpoint: WebhookEndpoint = { id, url, secret, events, createdAt: now }

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
 * DELETE /api/admin/webhooks
 * Remove a webhook endpoint by id (passed as query param).
 */
export async function DELETE(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const { eq } = await import('drizzle-orm')
  await drizzle
    .delete(schema.settings)
    .where(eq(schema.settings.key, `${WEBHOOK_KEY_PREFIX}${id}`))

  return NextResponse.json({ success: true })
}
