import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// DELETE /api/admin/pipeline/stages/[id]
//
// Guarded delete for a pipeline stage:
//   - core stages (default entry stage, Closed Won, Closed Lost) are refused
//   - stages with deals still in them (including archived deals, which keep
//     their stage FK) are refused with a 409 and a count so the UI can tell
//     the admin what to move first
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [stage] = await database
    .select()
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.id, id))
    .limit(1)

  if (!stage) {
    return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
  }

  if (stage.isDefault || stage.isClosedWon || stage.isClosedLost) {
    return NextResponse.json(
      { error: 'This stage is required by the pipeline and cannot be deleted.' },
      { status: 400 },
    )
  }

  const [{ count }] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.deals)
    .where(eq(schema.deals.stageId, id))

  if (count > 0) {
    return NextResponse.json(
      {
        error: count === 1
          ? '1 deal is in this stage. Move it to another stage first.'
          : `${count} deals are in this stage. Move them to another stage first.`,
        dealCount: count,
      },
      { status: 409 },
    )
  }

  await database
    .delete(schema.pipelineStages)
    .where(eq(schema.pipelineStages.id, id))

  return NextResponse.json({ success: true })
}
