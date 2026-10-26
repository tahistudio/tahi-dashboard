import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { loadRoundPage } from '@/lib/qa/server'
import { parseCommentInput, rowToComment } from '@/lib/qa/comments'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Element comments on one round page, oldest first. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = await db() as Drizzle
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await database
    .select()
    .from(schema.qaComments)
    .where(eq(schema.qaComments.roundPageId, loaded.roundPage.id))
    .orderBy(asc(schema.qaComments.createdAt), asc(schema.qaComments.id))

  return NextResponse.json({ comments: rows.map(rowToComment) })
}

/** Adds an element comment to a round page. The author is the signed-in team member. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const raw: unknown = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }
  const parsed = parseCommentInput(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const database = await db() as Drizzle
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  let authorName: string | null = null
  if (userId) {
    const [member] = await database
      .select({ name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    authorName = member?.name ?? null
  }

  const now = new Date().toISOString()
  const [created] = await database.insert(schema.qaComments).values({
    id: crypto.randomUUID(),
    roundPageId: loaded.roundPage.id,
    viewport: parsed.value.viewport,
    selector: parsed.value.selector,
    ox: parsed.value.ox,
    oy: parsed.value.oy,
    elementTag: parsed.value.elementTag,
    elementText: parsed.value.elementText,
    body: parsed.value.body,
    status: 'open',
    requestId: null,
    authorId: userId ?? null,
    authorName,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  }).returning()

  return NextResponse.json({ comment: rowToComment(created) }, { status: 201 })
}
