import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/portal/requests/[id]/steps : client reads steps on their request
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params
  const database = await db() as unknown as D1

  // Verify the request belongs to this org
  const [request] = await database
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.orgId, orgId), eq(schema.requests.isInternal, false)))
    .limit(1)

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await database
    .select()
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
  const { orgId, userId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const step = await database
    .insert(schema.requestSteps)
    .values({
      requestId,
      parentStepId: body.parentStepId ?? null,
      title: body.title.trim(),
      orderIndex: body.orderIndex ?? 0,
      createdById: userId ?? undefined,
      createdByType: 'contact',
    })
    .returning()

  return NextResponse.json({ step: step[0] }, { status: 201 })
}

// ── Tree builder ──────────────────────────────────────────────────────────────

type StepRow = typeof schema.requestSteps.$inferSelect
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
