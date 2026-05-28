/**
 * POST /api/admin/content/drafts/[id]/send-to-staci
 *
 * Posts a cover-design brief for this article to Slack (the bot DMs /
 * channels Staci). Until the AI covers are good enough, Staci designs the
 * cover by hand; Liam uploads the finished image back via set-cover.
 *
 * Contract:
 *   POST -> { sent, error? }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { postSlackMessage } from '@/lib/slack-notify'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const database = await db()
  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      title: schema.contentDrafts.title,
      summary: schema.contentDrafts.summary,
      metaDescription: schema.contentDrafts.metaDescription,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const origin = new URL(req.url).origin
  const draftUrl = `${origin}/dashboard/content-studio/drafts/${id}/round-table`

  const text = [
    `:art: *Cover needed for a new blog post*`,
    ``,
    `*${draft.title ?? 'Untitled'}*`,
    draft.summary || draft.metaDescription || '',
    ``,
    `*Brief:* 864×500 cover, on-brand (deep forest #2A3626 base, brand-green diamond gradient, abstract flat illustration, gold #D2A838 + Webflow blue #146EF5 accents, no text). Match the existing blog cover set.`,
    ``,
    `Draft: ${draftUrl}`,
    `When it's ready, send it to Liam to drop into the draft.`,
  ].filter(l => l !== undefined).join('\n')

  const result = await postSlackMessage({ database, text, channelKey: 'channel_covers' })
  if (!result.sent) {
    return NextResponse.json({ sent: false, error: result.error }, { status: 502 })
  }
  return NextResponse.json({ sent: true })
}
