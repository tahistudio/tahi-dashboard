import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/requests/[id]/steps — list all steps as a nested tree
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: requestId } = await params
  const database = await db() as unknown as D1

  const steps = await database
    .select()
    .from(schema.requestSteps)
    .where(eq(schema.requestSteps.requestId, requestId))
    .orderBy(asc(schema.requestSteps.orderIndex), asc(schema.requestSteps.createdAt))

  return NextResponse.json({ steps: buildTree(steps) })
}

// POST /api/admin/requests/[id]/steps — create a step
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: requestId } = await params
  const body = await req.json() as {
    title: string
    parentStepId?: string | null
    description?: string | null
    orderIndex?: number
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  const step = await database
    .insert(schema.requestSteps)
    .values({
      requestId,
      parentStepId: body.parentStepId ?? null,
      title: body.title.trim(),
      description: body.description ?? null,
      orderIndex: body.orderIndex ?? 0,
      createdById: userId ?? undefined,
      createdByType: 'team_member',
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
