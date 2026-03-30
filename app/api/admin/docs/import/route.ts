import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

interface ImportPage {
  title: string
  category: string
  content: string
  parentTitle?: string | null
  position?: number
}

// POST /api/admin/docs/import - bulk import doc pages from markdown
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { pages?: ImportPage[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.pages || !Array.isArray(body.pages) || body.pages.length === 0) {
    return NextResponse.json(
      { error: 'pages array is required and must not be empty' },
      { status: 400 },
    )
  }

  // Validate each page has at least a title and content
  for (let i = 0; i < body.pages.length; i++) {
    const p = body.pages[i]
    if (!p.title?.trim()) {
      return NextResponse.json(
        { error: `Page at index ${i} is missing a title` },
        { status: 400 },
      )
    }
    if (typeof p.content !== 'string') {
      return NextResponse.json(
        { error: `Page at index ${i} is missing content` },
        { status: 400 },
      )
    }
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const now = new Date().toISOString()

  // Track parent pages we create so we don't duplicate them
  const parentCache = new Map<string, string>() // parentTitle -> id

  // First pass: collect all unique parentTitles and check if they already exist
  const parentTitles = [
    ...new Set(
      body.pages
        .map((p) => p.parentTitle?.trim())
        .filter((t): t is string => Boolean(t)),
    ),
  ]

  for (const parentTitle of parentTitles) {
    const slug = toSlug(parentTitle)

    // Check if a page with this slug already exists as a category parent
    const existing = await drizzle
      .select({ id: schema.docPages.id })
      .from(schema.docPages)
      .where(eq(schema.docPages.slug, slug))
      .limit(1)

    if (existing.length > 0) {
      parentCache.set(parentTitle, existing[0].id)
    } else {
      // Create the parent folder page
      const parentId = crypto.randomUUID()
      await drizzle.insert(schema.docPages).values({
        id: parentId,
        parentId: null,
        category: 'operations',
        title: parentTitle,
        slug,
        contentTiptap: null,
        contentText: null,
        authorId: userId ?? 'system',
        createdAt: now,
        updatedAt: now,
      })
      parentCache.set(parentTitle, parentId)
    }
  }

  // Second pass: insert all pages
  let created = 0
  const createdIds: string[] = []

  for (const page of body.pages) {
    const title = page.title.trim()
    const slug = toSlug(title)
    const category = page.category?.trim() || 'operations'
    const parentId = page.parentTitle?.trim()
      ? parentCache.get(page.parentTitle.trim()) ?? null
      : null

    // Check for duplicate slug to avoid constraint errors
    const existingSlug = await drizzle
      .select({ id: schema.docPages.id })
      .from(schema.docPages)
      .where(
        parentId
          ? and(eq(schema.docPages.slug, slug), eq(schema.docPages.parentId, parentId))
          : eq(schema.docPages.slug, slug),
      )
      .limit(1)

    if (existingSlug.length > 0) {
      // Skip duplicates silently
      continue
    }

    const pageId = crypto.randomUUID()

    await drizzle.insert(schema.docPages).values({
      id: pageId,
      parentId,
      category,
      title,
      slug,
      contentTiptap: null,
      contentText: page.content,
      authorId: userId ?? 'system',
      createdAt: now,
      updatedAt: now,
    })

    // Create initial version
    await drizzle.insert(schema.docVersions).values({
      id: crypto.randomUUID(),
      pageId,
      contentTiptap: null,
      savedById: userId ?? 'system',
      savedAt: now,
    })

    created++
    createdIds.push(pageId)
  }

  return NextResponse.json({
    success: true,
    created,
    parentPagesCreated: parentCache.size,
    ids: createdIds,
  })
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
