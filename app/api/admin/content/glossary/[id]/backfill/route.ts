/**
 * POST /api/admin/content/glossary/[id]/backfill
 *
 * Refresh a single glossary item's schema (always), date-modified
 * (always), and optionally rewrites the body through the AI-tell
 * sanitizer.
 *
 * Body params:
 *   { dryRun?: boolean, rewriteBody?: boolean, authorSlug?: 'liam' | 'staci' }
 *
 * Defaults: dryRun=false, rewriteBody=false (schema-only is safe).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getGlossaryCollectionId } from '@/lib/webflow'
import { backfillGlossaryItem } from '@/lib/glossary-backfill'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface Body {
  dryRun?: boolean
  rewriteBody?: boolean
  authorSlug?: 'liam' | 'staci'
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Item id required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Body

  try {
    const collectionId = await getGlossaryCollectionId()
    const result = await backfillGlossaryItem(collectionId, id, {
      dryRun: !!body.dryRun,
      rewriteBody: !!body.rewriteBody,
      authorSlug: body.authorSlug,
    })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 })
  }
}
