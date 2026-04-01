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

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// POST /api/admin/docs/seed
// Seed endpoint that accepts x-seed-key header (TAHI_ORG_ID) for CLI auth.
// Accepts same payload as /api/admin/docs/import.
export async function POST(req: NextRequest) {
  // Auth: accept either Clerk admin or x-seed-key header
  const seedKey = req.headers.get('x-seed-key')
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID

  if (!tahiOrgId || seedKey !== tahiOrgId) {
    // Fall back to Clerk auth
    try {
      const { getRequestAuth, isTahiAdmin } = await import('@/lib/server-auth')
      const { orgId } = await getRequestAuth(req)
      if (!isTahiAdmin(orgId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const now = new Date().toISOString()

  // Track parent pages
  const parentCache = new Map<string, string>()

  const parentTitles = [
    ...new Set(
      body.pages
        .map((p) => p.parentTitle?.trim())
        .filter((t): t is string => Boolean(t)),
    ),
  ]

  for (const parentTitle of parentTitles) {
    const slug = toSlug(parentTitle)

    const existing = await drizzle
      .select({ id: schema.docPages.id })
      .from(schema.docPages)
      .where(eq(schema.docPages.slug, slug))
      .limit(1)

    if (existing.length > 0) {
      parentCache.set(parentTitle, existing[0].id)
    } else {
      const parentId = crypto.randomUUID()
      await drizzle.insert(schema.docPages).values({
        id: parentId,
        parentId: null,
        category: 'operations',
        title: parentTitle,
        slug,
        contentTiptap: null,
        contentText: null,
        authorId: 'system',
        createdAt: now,
        updatedAt: now,
      })
      parentCache.set(parentTitle, parentId)
    }
  }

  let created = 0
  const createdIds: string[] = []

  for (const page of body.pages) {
    const title = page.title.trim()
    const slug = toSlug(title)
    const category = page.category?.trim()?.toLowerCase() || 'operations'
    const parentId = page.parentTitle?.trim()
      ? parentCache.get(page.parentTitle.trim()) ?? null
      : null

    // Skip duplicates
    const existingSlug = await drizzle
      .select({ id: schema.docPages.id })
      .from(schema.docPages)
      .where(
        parentId
          ? and(eq(schema.docPages.slug, slug), eq(schema.docPages.parentId, parentId))
          : eq(schema.docPages.slug, slug),
      )
      .limit(1)

    if (existingSlug.length > 0) continue

    const pageId = crypto.randomUUID()

    await drizzle.insert(schema.docPages).values({
      id: pageId,
      parentId,
      category,
      title,
      slug,
      contentTiptap: null,
      contentText: page.content,
      authorId: 'system',
      createdAt: now,
      updatedAt: now,
    })

    await drizzle.insert(schema.docVersions).values({
      id: crypto.randomUUID(),
      pageId,
      contentTiptap: null,
      savedById: 'system',
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
