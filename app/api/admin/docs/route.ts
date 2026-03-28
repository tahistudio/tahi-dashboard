import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, and } from 'drizzle-orm'

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

  return NextResponse.json({ pages })
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

  // Create the doc page
  await drizzle.insert(schema.docPages).values({
    id: pageId,
    parentId: body.parentId ?? null,
    category: body.category ?? 'operations',
    title: body.title.trim(),
    slug,
    contentTiptap: body.contentMd ?? '',
    contentText: body.contentMd ?? '',
    authorId: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Create initial version
  await drizzle.insert(schema.docVersions).values({
    id: crypto.randomUUID(),
    pageId,
    contentTiptap: body.contentMd ?? '',
    savedById: userId,
    savedAt: now,
  })

  return NextResponse.json({ id: pageId }, { status: 201 })
}
