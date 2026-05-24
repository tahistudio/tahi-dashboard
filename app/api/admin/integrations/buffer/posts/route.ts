/**
 * GET /api/admin/integrations/buffer/posts
 *
 * Returns recent posts (default status='sent') from Liam's connected
 * Buffer channels, sorted newest-first by sentAt.
 *
 * IMPORTANT: Buffer's GraphQL API does NOT expose per-post engagement
 * metrics (likes, comments, shares, reach). Those live in their
 * separate Analyze product. This endpoint surfaces post text + dates
 * + channel only — i.e. "what has Liam been posting" without the
 * "how did it perform" half.
 *
 * Query:
 *   ?channelId=ID    — only this channel
 *   ?service=twitter — filter to channels of this service across all orgs
 *   ?count=N         — fetch cap (default 20, max 100)
 *   ?status=sent|scheduled|draft  — default 'sent'
 *
 * Returns:
 *   {
 *     posts: BufferPost[],
 *     channels: BufferChannel[],  // denormalised for the UI to show service + name
 *     totals: { posts: number, byService: Record<string, number> }
 *   }
 *
 * Scoped to Liam Miller's personal Buffer — see lib/buffer.ts header.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listOrganizations, listChannels, listPosts,
  type BufferPostStatus,
} from '@/lib/buffer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = process.env.BUFFER_API_KEY
  if (!token) {
    return NextResponse.json({ error: 'BUFFER_API_KEY not configured' }, { status: 500 })
  }

  const url = new URL(req.url)
  const filterChannelId = url.searchParams.get('channelId')
  const filterService = url.searchParams.get('service')
  const countRaw = parseInt(url.searchParams.get('count') ?? '', 10)
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(countRaw, 100) : 20
  const statusRaw = url.searchParams.get('status') ?? 'sent'
  const status: BufferPostStatus = (
    ['sent', 'scheduled', 'draft', 'failed', 'needs_approval'].includes(statusRaw)
      ? statusRaw
      : 'sent'
  ) as BufferPostStatus

  try {
    const orgs = await listOrganizations(token)
    if (orgs.length === 0) {
      return NextResponse.json({ posts: [], channels: [], totals: { posts: 0, byService: {} } })
    }
    const org = orgs[0]
    const channels = await listChannels(token, org.id)

    const targetChannels = channels.filter(c => {
      if (filterChannelId && c.id !== filterChannelId) return false
      if (filterService && c.service !== filterService) return false
      return true
    })

    const channelIds = targetChannels.map(c => c.id)
    if (channelIds.length === 0) {
      return NextResponse.json({ posts: [], channels: targetChannels, totals: { posts: 0, byService: {} } })
    }

    const page = await listPosts(token, org.id, {
      statuses: [status],
      channelIds,
      first: count,
    })

    // Sort newest-first. sentAt for sent posts, scheduledAt otherwise.
    const sorted = [...page.posts].sort((a, b) => {
      const aT = a.sentAt ?? a.scheduledAt ?? a.createdAt ?? ''
      const bT = b.sentAt ?? b.scheduledAt ?? b.createdAt ?? ''
      return bT.localeCompare(aT)
    })

    // Service breakdown (counts only — Buffer GraphQL doesn't expose
    // engagement metrics on this endpoint).
    const byService: Record<string, number> = {}
    const channelById = new Map(channels.map(c => [c.id, c]))
    for (const p of sorted) {
      const ch = channelById.get(p.channelId)
      const key = ch?.service ?? 'unknown'
      byService[key] = (byService[key] ?? 0) + 1
    }

    return NextResponse.json({
      posts: sorted,
      channels: targetChannels,
      totals: { posts: sorted.length, byService },
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Buffer posts fetch failed',
    }, { status: 502 })
  }
}
