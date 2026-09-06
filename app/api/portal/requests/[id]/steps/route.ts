import { NextRequest, NextResponse } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'
import { actingIdentity, authorFor, recordActingWrite, refusePreviewWrite } from '@/lib/acting-as'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/portal/requests/[id]/steps : client reads steps on their request
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied

  const { id: requestId } = await params
  const database = await db() as unknown as D1

  // Verify the request belongs to this org
  const [request] = await database
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.orgId, orgId), eq(schema.requests.isInternal, false)))
    .limit(1)

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Explicit client-safe projection: the internal routing columns
  // (assigneeId, createdById, createdByType) are omitted so a client never
  // learns which studio member owns or authored a step.
  const steps = await database
    .select({
      id: schema.requestSteps.id,
      requestId: schema.requestSteps.requestId,
      parentStepId: schema.requestSteps.parentStepId,
      title: schema.requestSteps.title,
      description: schema.requestSteps.description,
      completed: schema.requestSteps.completed,
      completedAt: schema.requestSteps.completedAt,
      orderIndex: schema.requestSteps.orderIndex,
      createdAt: schema.requestSteps.createdAt,
      updatedAt: schema.requestSteps.updatedAt,
    })
    .from(schema.requestSteps)
    .where(eq(schema.requestSteps.requestId, requestId))
    .orderBy(asc(schema.requestSteps.orderIndex), asc(schema.requestSteps.createdAt))

  return NextResponse.json({ steps: buildTree(steps) })
}

// POST /api/portal/requests/[id]/steps : client adds a step
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getPortalAuth(req)
  const { orgId, userId, clerkOrgId } = auth
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  // OPEN in act mode. request_steps.created_by_type already carries
  // 'team_member' on the studio side, so an acting step is the ordinary studio
  // value written from the client's own surface.
  const previewDenied = refusePreviewWrite(auth, { allowActing: true })
  if (previewDenied) return previewDenied
  const acting = actingIdentity(auth)

  const { id: requestId } = await params
  const body = await req.json() as {
    title: string
    parentStepId?: string | null
    orderIndex?: number
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  // Verify org ownership
  const [request] = await database
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.orgId, orgId), eq(schema.requests.isInternal, false)))
    .limit(1)

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const creator = authorFor(acting, userId ?? '')

  const step = await database
    .insert(schema.requestSteps)
    .values({
      requestId,
      parentStepId: body.parentStepId ?? null,
      title: body.title.trim(),
      orderIndex: body.orderIndex ?? 0,
      createdById: creator.id || undefined,
      createdByType: creator.type,
    })
    .returning()

  await recordActingWrite(database as unknown as DB, acting, {
    verb: 'request_step.created',
    entityType: 'request',
    entityId: requestId,
    route: 'POST /api/portal/requests/[id]/steps',
    extra: { stepId: step[0]?.id ?? null, title: body.title.trim() },
  })

  return NextResponse.json({ step: step[0] }, { status: 201 })
}

// ── Tree builder ──────────────────────────────────────────────────────────────

// Client-safe step shape (mirrors the GET projection above, minus the
// internal routing columns).
interface StepRow {
  id: string
  requestId: string
  parentStepId: string | null
  title: string
  description: string | null
  completed: boolean | null
  completedAt: string | null
  orderIndex: number | null
  createdAt: string
  updatedAt: string
}
interface StepNode extends StepRow { children: StepNode[] }

function buildTree(flat: StepRow[]): StepNode[] {
  const map = new Map<string, StepNode>()
  for (const s of flat) map.set(s.id, { ...s, children: [] })
  const roots: StepNode[] = []
  for (const s of flat) {
    const node = map.get(s.id)!
    if (s.parentStepId && map.has(s.parentStepId)) {
      map.get(s.parentStepId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}
