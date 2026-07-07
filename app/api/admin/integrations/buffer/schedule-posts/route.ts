/**
 * POST /api/admin/integrations/buffer/schedule-posts
 *
 * Bulk-schedule a batch of posts to a Buffer channel. Designed for
 * the "I have 31 LinkedIn posts to upload" workflow.
 *
 * Body:
 *   posts:      Array of { text, imageUrls?, firstComment? }   required
 *   channelId:  Buffer channel id                              required
 *               (omit to use the first connected channel)
 *   schedule:   one of:
 *     { mode: 'queue' }
 *         Adds each post to Buffer's queue (uses your existing
 *         posting schedule in Buffer).
 *     { mode: 'spread', startAt: ISO, intervalHours: N }
 *         Schedules at startAt, then +intervalHours for each
 *         subsequent post.
 *     { mode: 'daily', startAt: ISO, perDay: N, postsPerDay: N }
 *         Spreads across N days, postsPerDay per day, starting at
 *         the local time of startAt.
 *     { mode: 'explicit', dates: [ISO, ISO, ...] }
 *         Per-post explicit times — dates.length must equal posts.length.
 *
 * Returns:
 *   { scheduled: N, results: [{ index, postId, scheduledAt, error? }] }
 *
 * Bounded at 50 posts per call to stay under Buffer's rate limits
 * (100 mutations per 15 min). Larger batches: loop client-side.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { createPost, listChannels, listOrganizations } from '@/lib/buffer'

export const dynamic = 'force-dynamic'

const MAX_PER_CALL = 50

interface PostInput {
  text?: string
  imageUrls?: string[]
  firstComment?: string
}

type Schedule =
  | { mode: 'queue' }
  | { mode: 'spread'; startAt: string; intervalHours: number }
  | { mode: 'daily'; startAt: string; postsPerDay: number }
  | { mode: 'explicit'; dates: string[] }

interface Body {
  posts?: PostInput[]
  channelId?: string
  schedule?: Schedule
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const token = process.env.BUFFER_API_KEY
  if (!token) {
    return NextResponse.json({ error: 'BUFFER_API_KEY not configured' }, { status: 500 })
  }

  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const posts = (body.posts ?? []).filter(p => p.text?.trim())
  if (posts.length === 0) {
    return NextResponse.json({ error: 'posts[] is required (must include text)' }, { status: 400 })
  }
  if (posts.length > MAX_PER_CALL) {
    return NextResponse.json({
      error: `Too many posts (${posts.length}). Cap is ${MAX_PER_CALL} per call. Loop in batches.`,
    }, { status: 400 })
  }

  const schedule = body.schedule ?? { mode: 'queue' as const }

  // Resolve channel (default: first connected)
  let channelId = body.channelId?.trim() || ''
  if (!channelId) {
    const orgs = await listOrganizations(token)
    if (orgs.length === 0) {
      return NextResponse.json({ error: 'No Buffer organisation on this token' }, { status: 502 })
    }
    const channels = await listChannels(token, orgs[0].id)
    if (channels.length === 0) {
      return NextResponse.json({ error: 'No Buffer channels connected' }, { status: 502 })
    }
    channelId = channels[0].id
  }

  // Pre-compute the dueAt for each post based on the schedule mode
  const dueAts: Array<string | null> = []
  switch (schedule.mode) {
    case 'queue':
      for (let i = 0; i < posts.length; i++) dueAts.push(null) // addToQueue mode
      break
    case 'spread': {
      const start = new Date(schedule.startAt).getTime()
      if (!Number.isFinite(start)) {
        return NextResponse.json({ error: 'Invalid schedule.startAt' }, { status: 400 })
      }
      const intervalMs = (schedule.intervalHours || 24) * 60 * 60_000
      for (let i = 0; i < posts.length; i++) {
        dueAts.push(new Date(start + i * intervalMs).toISOString())
      }
      break
    }
    case 'daily': {
      const start = new Date(schedule.startAt)
      if (isNaN(start.getTime())) {
        return NextResponse.json({ error: 'Invalid schedule.startAt' }, { status: 400 })
      }
      const perDay = Math.max(1, schedule.postsPerDay || 1)
      const startHour = start.getUTCHours()
      const startMin = start.getUTCMinutes()
      // perDay slots per day, evenly distributed within 9am-5pm local
      // (we're given UTC startAt so we use that as the first slot of
      // each day; subsequent slots are 8h/perDay apart so they all fit
      // in a working day window).
      const dayMs = 24 * 60 * 60_000
      const slotMs = perDay > 1 ? (8 * 60 * 60_000) / (perDay - 1) : 0
      for (let i = 0; i < posts.length; i++) {
        const dayIndex = Math.floor(i / perDay)
        const slotInDay = i % perDay
        const date = new Date(start.getTime() + dayIndex * dayMs)
        date.setUTCHours(startHour, startMin, 0, 0)
        const time = date.getTime() + slotInDay * slotMs
        dueAts.push(new Date(time).toISOString())
      }
      break
    }
    case 'explicit':
      if (!Array.isArray(schedule.dates) || schedule.dates.length !== posts.length) {
        return NextResponse.json({
          error: `explicit mode requires dates[] of length ${posts.length}`,
        }, { status: 400 })
      }
      for (const d of schedule.dates) {
        const t = new Date(d)
        if (isNaN(t.getTime())) {
          return NextResponse.json({ error: `Invalid date "${d}"` }, { status: 400 })
        }
        dueAts.push(t.toISOString())
      }
      break
    default:
      return NextResponse.json({ error: 'Unknown schedule mode' }, { status: 400 })
  }

  // Fire mutations serially (Buffer rate-limit: 100 mutations / 15min).
  const results: Array<{ index: number; postId?: string; scheduledAt: string | null; error?: string }> = []
  let scheduled = 0
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i]
    const dueAt = dueAts[i]
    try {
      const out = await createPost(token, {
        text: p.text!.trim(),
        channelId,
        dueAt: dueAt ?? undefined,
        mode: dueAt ? 'customScheduled' : 'addToQueue',
        imageUrls: p.imageUrls,
        firstComment: p.firstComment,
      })
      scheduled++
      results.push({ index: i, postId: out.id, scheduledAt: dueAt })
    } catch (err) {
      results.push({
        index: i,
        scheduledAt: dueAt,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    channelId,
    scheduled,
    failed: results.filter(r => r.error).length,
    results,
  })
}
