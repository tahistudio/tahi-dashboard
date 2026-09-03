/**
 * POST /api/admin/requests/[id]/duplicate
 *
 * Makes a fresh top-level request from an existing one. Copies the fields a
 * studio member would otherwise retype (title, description, category, type,
 * priority, org, estimated hours) and nothing that belongs to the original's
 * history: the copy starts at `submitted`, unassigned, with no thread, no
 * files, no participants, no revisions, no due date, and no parent.
 *
 * Returns { id } of the new request, matching POST /api/admin/requests.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { dispatchDomainEvent } from '@/lib/events'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [source] = await drizzle
    .select({
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      description: schema.requests.description,
      category: schema.requests.category,
      type: schema.requests.type,
      priority: schema.requests.priority,
      estimatedHours: schema.requests.estimatedHours,
      size: schema.requests.size,
      isInternal: schema.requests.isInternal,
      maxRevisions: schema.requests.maxRevisions,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)

  if (!source) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Access scoping against the source request's own org.
  const denied = await requireAccessToOrg(drizzle, userId, source.orgId)
  if (denied) return denied

  const newId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Same atomic request-number subquery the create route uses, so two
  // concurrent duplicates cannot land on the same number, and scoped to the
  // source request's own org so the copy stays inside that client's private
  // 1, 2, 3 sequence.
  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, title, type, category, description, status, priority,
      estimated_hours, size, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${newId},
      ${source.orgId},
      ${source.title},
      ${source.type ?? 'small_task'},
      ${source.category ?? 'development'},
      ${source.description ?? null},
      'submitted',
      ${source.priority ?? 'standard'},
      ${source.estimatedHours ?? null},
      ${source.size ?? null},
      ${userId ?? null},
      ${source.isInternal ? 1 : 0},
      0,
      ${source.maxRevisions ?? 3},
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${source.orgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  await dispatchDomainEvent(drizzle, {
    type: 'request_created',
    entityId: newId,
    entityType: 'request',
    orgId: source.orgId,
    data: {
      title: source.title,
      type: source.type ?? 'small_task',
      category: source.category ?? 'development',
      priority: source.priority ?? 'standard',
      status: 'submitted',
      isInternal: source.isInternal ? 1 : 0,
      source: 'duplicate',
      duplicatedFromId: id,
    },
  })

  return NextResponse.json({ id: newId }, { status: 201 })
}
