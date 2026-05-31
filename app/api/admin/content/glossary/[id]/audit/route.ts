/**
 * POST /api/admin/content/glossary/[id]/audit
 *
 * Tier 2: Haiku-scored audit of an existing Webflow glossary term.
 * Returns a 5-dimension scorecard + 3-5 actionable improvements.
 * Read-only — does NOT touch Webflow.
 *
 * ~$0.01 / call. Used by the Backfill tab's "Audit" button + the
 * weekly scorecard cron.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCollectionItem, getGlossaryCollectionId } from '@/lib/webflow'
import { auditGlossaryTerm } from '@/lib/glossary-pipeline'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Item id required' }, { status: 400 })

  try {
    const collectionId = await getGlossaryCollectionId()
    const item = await getCollectionItem(collectionId, id)
    const f = item.fieldData as Record<string, unknown>
    const term = (f.name as string | undefined) ?? '(untitled)'
    const bodyHtml = (f['post-body'] as string | undefined)
      ?? (f.definition as string | undefined)
      ?? (f.body as string | undefined)
      ?? ''
    const bodyMarkdown = htmlToMarkdown(bodyHtml)
    const definition = bodyMarkdown.split('\n').filter(l => l.trim() && !l.startsWith('#'))[0]?.slice(0, 600) ?? ''

    const database = await db()
    const result = await auditGlossaryTerm(database, id, {
      term, definition, bodyMarkdown, bodyHtml,
    })
    return NextResponse.json({ ok: true, term, ...result })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message.slice(0, 400) : 'unknown',
    }, { status: 500 })
  }
}
