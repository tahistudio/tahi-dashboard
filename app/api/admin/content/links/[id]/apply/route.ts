/**
 * POST /api/admin/content/links/[id]/apply
 *
 * Phase I · Slice 6 — Applies a single link suggestion.
 *
 * Flow:
 *   1. Load the suggestion row. Reject unless status='pending'.
 *   2. Fetch the source post from Webflow.
 *   3. Verify the matchPhrase + contextBefore + contextAfter still
 *      match the live source body. If the body has drifted, return 409
 *      so the UI can prompt Liam to re-scan.
 *   4. Splice in `<a href="${targetUrl}">${proposedAnchorText}</a>` at
 *      the match position.
 *   5. PATCH the source post body via the Webflow Data API. The edit
 *      lands as a STAGED change — we do NOT publish. Liam batch-
 *      publishes from the Webflow Editor (or via the publish route in
 *      Slice 5 once that lands).
 *   6. Mark the suggestion as `status='applied'` with appliedAt = now.
 *
 * Contract:
 *   POST /api/admin/content/links/{id}/apply
 *   200: { success: true, id, appliedAt }
 *   404: { error: 'Suggestion not found' }
 *   409: { error: 'Source body has drifted...', detail }
 *   422: { error: 'Suggestion already <status>' }
 *   502: { error: 'Webflow request failed', detail }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getCollectionItem, patchCollectionItem } from '@/lib/webflow'
import { locateSuggestionInBody, spliceAnchor } from '@/lib/link-analyzer'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const database = await db()
  const [row] = await database
    .select()
    .from(schema.linkSuggestions)
    .where(eq(schema.linkSuggestions.id, id))
    .limit(1)
  if (!row) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }
  if (row.status !== 'pending' && row.status !== 'approved') {
    return NextResponse.json({
      error: `Suggestion already ${row.status}`,
    }, { status: 422 })
  }

  // Fetch the source post.
  let item
  try {
    item = await getCollectionItem(BLOG_POSTS_COLLECTION_ID, row.sourceWebflowId)
  } catch (err) {
    console.error('Webflow getCollectionItem failed in apply', err)
    return NextResponse.json({
      error: 'Webflow request failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  const bodyHtml = (item.fieldData['post-body'] as string | undefined) ?? ''
  if (!bodyHtml) {
    return NextResponse.json({
      error: 'Source body has drifted',
      detail: 'Source post returned an empty body — re-run scan to refresh.',
    }, { status: 409 })
  }

  // Verify context.
  const located = locateSuggestionInBody(
    bodyHtml,
    row.matchPhrase,
    row.contextBefore,
    row.contextAfter,
  )
  if (!located) {
    return NextResponse.json({
      error: 'Source body has drifted',
      detail: 'The match phrase or surrounding context no longer exists in the source post. Re-run scan to refresh.',
    }, { status: 409 })
  }

  // Splice + patch.
  const patched = spliceAnchor(
    bodyHtml,
    located.htmlIndex,
    located.matchedText,
    row.targetUrl,
    row.proposedAnchorText,
  )

  try {
    await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, row.sourceWebflowId, {
      'post-body': patched,
    })
  } catch (err) {
    console.error('Webflow patchCollectionItem failed in apply', err)
    return NextResponse.json({
      error: 'Webflow request failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  const appliedAt = new Date().toISOString()
  await database.update(schema.linkSuggestions)
    .set({ status: 'applied', appliedAt, updatedAt: appliedAt })
    .where(eq(schema.linkSuggestions.id, id))

  // Best-effort: bump the target's inbound count in blog_health so
  // subsequent scans correctly see the new edge.
  try {
    const [health] = await database
      .select({
        url: schema.blogHealth.url,
        inbound: schema.blogHealth.inboundInternalLinks,
      })
      .from(schema.blogHealth)
      .where(eq(schema.blogHealth.url, row.targetUrl))
      .limit(1)
    if (health) {
      await database.update(schema.blogHealth)
        .set({
          inboundInternalLinks: (health.inbound ?? 0) + 1,
          updatedAt: appliedAt,
        })
        .where(eq(schema.blogHealth.url, row.targetUrl))
    }
  } catch {
    // best-effort
  }

  return NextResponse.json({ success: true, id, appliedAt })
}
