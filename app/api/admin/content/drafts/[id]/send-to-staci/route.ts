/**
 * POST /api/admin/content/drafts/[id]/send-to-staci
 *
 * Posts a cover-design brief for this article to Slack (the bot DMs /
 * channels Staci). Includes:
 *   - title + one-line summary
 *   - what the article covers (key takeaways)
 *   - a tailored cover concept (from sign-off's recommendCover, with a
 *     Haiku fallback if missing — covers legacy drafts)
 *   - brand spec + the draft link
 *
 * Until the AI covers are good enough, Staci designs the cover by hand;
 * Liam uploads the finished image back via set-cover.
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
import { claudeJson } from '@/lib/anthropic-cost'
import { HAIKU_MODEL } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'

/** Strip the <ul><li> wrapper to plain bullet lines. */
function takeawaysToLines(html: string | null): string[] {
  if (!html) return []
  const matches = html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? []
  return matches
    .map(m => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim())
    .filter(t => t.length > 0)
    .slice(0, 5)
}

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
      keyTakeaways: schema.contentDrafts.keyTakeaways,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  // Pull the cover concept the sign-off stage already produced. Fall back
  // to a fresh Haiku call so this works on legacy drafts that ran before
  // we started stashing recommendCover.
  let coverConcept = ''
  try {
    const sb = JSON.parse(draft.scoreBreakdown ?? '{}') as Record<string, unknown>
    if (typeof sb.recommendCover === 'string' && sb.recommendCover.trim().length > 0) {
      coverConcept = sb.recommendCover.trim()
    }
  } catch { /* fall through to Haiku */ }

  if (!coverConcept) {
    try {
      const { result } = await claudeJson({
        database, scope: 'draft', scopeId: id, stage: 'cover_concept',
        model: HAIKU_MODEL, maxTokens: 400,
        skipCostCap: true,
        systemPrompt: 'You design cover concepts for the Tahi Studio blog. Output JSON: { "concept": "2-3 sentence visual concept for the article cover. Use abstract flat illustration with deep forest, brand-green diamond, gold + Webflow blue accents. No text in the image. Tie the visual metaphor to the article\'s central idea." }',
        userPrompt: `Article title: ${draft.title ?? ''}\n\nSummary: ${draft.summary ?? draft.metaDescription ?? ''}\n\nWrite the JSON now.`,
        parse: (raw: string) => JSON.parse(raw) as { concept: string },
      })
      coverConcept = result.concept?.trim() ?? ''
    } catch { /* leave empty, message still goes */ }
  }

  const takeaways = takeawaysToLines(draft.keyTakeaways)

  // No draft link — Staci doesn't have a dashboard account yet; the brief
  // is self-contained in Slack.
  const lines: string[] = [
    `:art: *Cover needed: ${draft.title ?? 'Untitled'}*`,
    ``,
  ]
  const summary = draft.summary || draft.metaDescription
  if (summary) {
    lines.push(`*Summary:* ${summary}`, ``)
  }
  if (takeaways.length > 0) {
    lines.push(`*What the article covers:*`)
    for (const t of takeaways) lines.push(`• ${t}`)
    lines.push(``)
  }
  if (coverConcept) {
    lines.push(`*Cover concept:* ${coverConcept}`, ``)
  }
  lines.push(
    `*Brand spec:* 864×500, deep forest #2A3626 base, brand-green diamond gradient, abstract flat illustration, gold #D2A838 + Webflow blue #146EF5 accents, no text in the image.`,
    ``,
    `Send the finished image to Liam to drop in. *React with :white_check_mark: when it's done* so Liam knows.`,
  )
  const text = lines.join('\n')

  const result = await postSlackMessage({ database, text, channelKey: 'channel_covers' })
  if (!result.sent) {
    return NextResponse.json({ sent: false, error: result.error }, { status: 502 })
  }
  return NextResponse.json({ sent: true })
}
