import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, and, inArray } from 'drizzle-orm'

// GET /api/admin/docs - list all doc pages
// Query: ?category=brand&search=onboarding
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const search = url.searchParams.get('search')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (category) {
    conditions.push(eq(schema.docPages.category, category))
  }
  if (search) {
    conditions.push(like(schema.docPages.title, `%${search}%`))
  }

  const pages = await drizzle
    .select({
      id: schema.docPages.id,
      parentId: schema.docPages.parentId,
      category: schema.docPages.category,
      title: schema.docPages.title,
      slug: schema.docPages.slug,
      authorId: schema.docPages.authorId,
      createdAt: schema.docPages.createdAt,
      updatedAt: schema.docPages.updatedAt,
    })
    .from(schema.docPages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.docPages.updatedAt))

  // Resolve the last editor's display name for the Docs hub card subline
  // ("Edited by <name>"). The latest doc_versions row per page carries the
  // editor (savedById); we fall back to the page author when no version
  // exists. savedById/authorId are Clerk user ids, resolved to a team member
  // name via clerkUserId. Any resolution failure degrades to null (honest:
  // the card then shows just the relative time).
  const pageIds = pages.map(p => p.id)
  const latestEditorId = new Map<string, string>()
  const latestEditedAt = new Map<string, string>()
  if (pageIds.length) {
    try {
      const versions = await drizzle
        .select({
          pageId: schema.docVersions.pageId,
          savedById: schema.docVersions.savedById,
          savedAt: schema.docVersions.savedAt,
        })
        .from(schema.docVersions)
        .where(inArray(schema.docVersions.pageId, pageIds))
        .orderBy(desc(schema.docVersions.savedAt))
      for (const v of versions) {
        if (!latestEditedAt.has(v.pageId)) {
          latestEditedAt.set(v.pageId, v.savedAt)
          if (v.savedById) latestEditorId.set(v.pageId, v.savedById)
        }
      }
    } catch {
      // Versions table missing — fall back to authorId / updatedAt.
    }
  }

  const clerkIds = new Set<string>()
  for (const p of pages) {
    const editorId = latestEditorId.get(p.id) ?? p.authorId
    if (editorId) clerkIds.add(editorId)
  }
  const nameByClerkId = new Map<string, string>()
  if (clerkIds.size) {
    try {
      const tms = await drizzle
        .select({ clerkUserId: schema.teamMembers.clerkUserId, name: schema.teamMembers.name })
        .from(schema.teamMembers)
        .where(inArray(schema.teamMembers.clerkUserId, Array.from(clerkIds)))
      for (const tm of tms) {
        if (tm.clerkUserId) nameByClerkId.set(tm.clerkUserId, tm.name)
      }
    } catch {
      // Team members table missing — leave names unresolved.
    }
  }

  const pagesWithEditor = pages.map(p => {
    const editorId = latestEditorId.get(p.id) ?? p.authorId ?? null
    return {
      ...p,
      lastEditedBy: editorId ? (nameByClerkId.get(editorId) ?? null) : null,
      lastEditedAt: latestEditedAt.get(p.id) ?? p.updatedAt,
    }
  })

  return NextResponse.json({ pages: pagesWithEditor })
}

// POST /api/admin/docs - create a new doc page
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string
    category?: string
    contentMd?: string
    parentId?: string
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const pageId = crypto.randomUUID()
  const slug = body.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Create the doc page.
  //
  // contentTiptap is intentionally null here. The renderer treats a
  // null contentTiptap as the signal to fall back to parsing the
  // markdown in contentText — which is the correct behaviour for
  // docs created via the markdown-only API surface (MCP, scripts,
  // bulk imports). Stuffing raw markdown into contentTiptap was a
  // bug: the renderer expects Tiptap rich-text JSON in that field
  // and renders the markdown literally when it can't parse it.
  // Mirrors the import endpoint's shape for consistency.
  await drizzle.insert(schema.docPages).values({
    id: pageId,
    parentId: body.parentId ?? null,
    category: body.category ?? 'operations',
    title: body.title.trim(),
    slug,
    contentTiptap: null,
    contentText: body.contentMd ?? '',
    authorId: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Create initial version. Same reasoning: contentTiptap is null
  // because the version record only carries Tiptap JSON when the UI
  // editor saves a version. Markdown-only saves leave it null.
  await drizzle.insert(schema.docVersions).values({
    id: crypto.randomUUID(),
    pageId,
    contentTiptap: null,
    savedById: userId,
    savedAt: now,
  })

  return NextResponse.json({ id: pageId }, { status: 201 })
}
