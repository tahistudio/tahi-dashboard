import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

// GET /api/admin/docs/[id] - return doc page with content and version history
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const pages = await drizzle
    .select()
    .from(schema.docPages)
    .where(eq(schema.docPages.id, id))
    .limit(1)

  if (pages.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const versions = await drizzle
    .select()
    .from(schema.docVersions)
    .where(eq(schema.docVersions.pageId, id))
    .orderBy(desc(schema.docVersions.savedAt))

  return NextResponse.json({ page: pages[0], versions })
}

// PATCH /api/admin/docs/[id] - update doc page content
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    title?: string
    contentMd?: string
    category?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Check page exists
  const existing = await drizzle
    .select()
    .from(schema.docPages)
    .where(eq(schema.docPages.id, id))
    .limit(1)

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.title?.trim()) {
    updates.title = body.title.trim()
    updates.slug = body.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
  if (body.category) {
    updates.category = body.category
  }
  if (body.contentMd !== undefined) {
    // contentTiptap is intentionally null on markdown-only updates.
    // The renderer treats a null contentTiptap as the signal to fall
    // back to parsing the markdown in contentText. Stuffing raw
    // markdown into contentTiptap was a bug: the renderer expects
    // Tiptap rich-text JSON in that field and renders the markdown
    // literally when it can't parse it. Mirrors the import endpoint
    // and the POST /api/admin/docs (create) shape for consistency.
    //
    // Side effect: any existing Tiptap JSON in contentTiptap is wiped
    // when a markdown update lands. That's the correct semantics —
    // contentMd is the new source of truth.
    updates.contentTiptap = null
    updates.contentText = body.contentMd
  }

  await drizzle
    .update(schema.docPages)
    .set(updates)
    .where(eq(schema.docPages.id, id))

  // Create a new version if content was updated. contentTiptap is
  // null because the version record only carries Tiptap JSON when
  // the UI editor saves a version; markdown-only saves leave it null.
  if (body.contentMd !== undefined) {
    await drizzle.insert(schema.docVersions).values({
      id: crypto.randomUUID(),
      pageId: id,
      contentTiptap: null,
      savedById: userId,
      savedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/docs/[id] - delete a doc page
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.delete(schema.docPages).where(eq(schema.docPages.id, id))

  return NextResponse.json({ success: true })
}
