import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/admin/integrations/zapier
 * T155: List available Zap trigger endpoints.
 * Returns the trigger URLs that Zapier can poll for new data.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dashboard.tahi.studio'

  return NextResponse.json({
    triggers: [
      {
        event: 'request_created',
        label: 'New request created',
        pollUrl: `${baseUrl}/api/admin/integrations/zapier/triggers/request-created`,
      },
      {
        event: 'request_completed',
        label: 'Request completed',
        pollUrl: `${baseUrl}/api/admin/integrations/zapier/triggers/request-completed`,
      },
      {
        event: 'new_client',
        label: 'New client onboarded',
        pollUrl: `${baseUrl}/api/admin/integrations/zapier/triggers/new-client`,
      },
    ],
    actions: [
      {
        event: 'create_request',
        label: 'Create a request',
        actionUrl: `${baseUrl}/api/admin/integrations/zapier/actions/create-request`,
      },
      {
        event: 'update_request_status',
        label: 'Update request status',
        actionUrl: `${baseUrl}/api/admin/integrations/zapier/actions/update-status`,
      },
    ],
  })
}

/**
 * POST /api/admin/integrations/zapier
 * T156: Zap action endpoints.
 * Body: { action: 'create_request'|'update_status', ...data }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    action?: string
    orgId?: string
    title?: string
    category?: string
    requestId?: string
    status?: string
  }

  const database = await db()
  const now = new Date().toISOString()

  if (body.action === 'create_request') {
    if (!body.orgId || !body.title) {
      return NextResponse.json({ error: 'orgId and title are required' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    await database.insert(schema.requests).values({
      id,
      orgId: body.orgId,
      title: body.title,
      category: body.category ?? 'development',
      type: 'small_task',
      status: 'submitted',
      priority: 'standard',
      createdAt: now,
      updatedAt: now,
    })

    return NextResponse.json({ success: true, id })
  }

  if (body.action === 'update_status') {
    if (!body.requestId || !body.status) {
      return NextResponse.json({ error: 'requestId and status are required' }, { status: 400 })
    }

    await database
      .update(schema.requests)
      .set({ status: body.status, updatedAt: now })
      .where(eq(schema.requests.id, body.requestId))

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
