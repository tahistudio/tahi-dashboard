/**
 * POST /api/admin/content/glossary/generate
 *
 * Tier 3: full glossary entry generation. Runs the Perplexity research
 * → Sonnet writer → 5-Haiku reviewer panel → optional Sonnet editor
 * pipeline.
 *
 * DOES NOT publish — returns the generated content for review. Liam
 * picks publish (separate POST to /api/admin/content/glossary/publish-draft).
 *
 * Body:
 *   { term: string, authorSlug?: 'liam' | 'staci', research?: boolean }
 *
 * ~$0.30 / call. Use when:
 *   - Adding a brand-new glossary term
 *   - Upgrading an underperforming existing term (Tier 3 rewrite)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateGlossaryEntry } from '@/lib/glossary-pipeline'

export const dynamic = 'force-dynamic'

interface Body {
  term: string
  authorSlug?: 'liam' | 'staci'
  research?: boolean
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Partial<Body>
  if (!body.term || body.term.trim().length === 0) {
    return NextResponse.json({ error: 'term is required' }, { status: 400 })
  }

  try {
    const database = await db()
    const result = await generateGlossaryEntry(body.term.trim(), {
      database,
      authorSlug: body.authorSlug,
      research: body.research,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message.slice(0, 400) : 'unknown',
    }, { status: 500 })
  }
}
