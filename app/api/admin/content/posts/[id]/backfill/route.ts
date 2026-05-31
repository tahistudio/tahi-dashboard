/**
 * POST /api/admin/content/posts/[id]/backfill
 *
 * Single-post backfill: refresh schema + hreflang (always), optionally
 * rewrite body through AI-tell sanitizer.
 *
 * Body: { dryRun?: boolean, rewriteBody?: boolean }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getBlogPostsCollectionId } from '@/lib/webflow'
import { backfillPost } from '@/lib/post-backfill'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Item id required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; rewriteBody?: boolean }

  try {
    const collectionId = await getBlogPostsCollectionId()
    const result = await backfillPost(collectionId, id, {
      dryRun: !!body.dryRun,
      rewriteBody: !!body.rewriteBody,
    })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg.slice(0, 400) }, { status: 500 })
  }
}
