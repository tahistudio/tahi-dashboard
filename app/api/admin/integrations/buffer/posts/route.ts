/**
 * GET /api/admin/integrations/buffer/posts
 *
 * Returns recent sent posts across all of Liam's connected Buffer
 * profiles, sorted newest-first. Each post carries the per-service
 * engagement statistics (Twitter favorites/retweets, LinkedIn
 * likes/comments/shares, etc.) — surfaced verbatim from Buffer.
 *
 * Query:
 *   ?profileId=ID    — only this profile
 *   ?service=twitter — filter to one service across all matching profiles
 *   ?count=N         — per-profile fetch cap (default 20, max 50)
 *   ?status=sent|pending — default 'sent'
 *
 * Returns:
 *   {
 *     posts: BufferUpdate[],
 *     totals: { posts: number, byService: Record<string, number>,
 *               engagement: Record<string, number> }
 *   }
 *
 * Scoped to Liam Miller's personal Buffer — see lib/buffer.ts header.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  listProfiles, listSentUpdates, listPendingUpdates,
  aggregateStats, type BufferUpdate,
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
  const filterProfileId = url.searchParams.get('profileId')
  const filterService = url.searchParams.get('service')
  const countRaw = parseInt(url.searchParams.get('count') ?? '', 10)
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(countRaw, 50) : 20
  const status = url.searchParams.get('status') === 'pending' ? 'pending' : 'sent'
  const fetcher = status === 'pending' ? listPendingUpdates : listSentUpdates

  try {
    const profiles = await listProfiles(token)
    const targetProfiles = profiles.filter(p => {
      if (filterProfileId && p.id !== filterProfileId) return false
      if (filterService && p.service !== filterService) return false
      return true
    })

    // Parallel fetch posts for each target profile. One fetch per profile —
    // a typical Buffer account has 3-5 connected, so this is bounded.
    const fetched = await Promise.all(
      targetProfiles.map(p => fetcher(token, p.id, count).catch(() => [] as BufferUpdate[]))
    )
    const flat = fetched.flat()

    // Sort by sentAt (sent posts) or scheduledAt (pending), newest first.
    flat.sort((a, b) => {
      const aT = a.sentAt ?? a.scheduledAt ?? ''
      const bT = b.sentAt ?? b.scheduledAt ?? ''
      return bT.localeCompare(aT)
    })

    const byService: Record<string, number> = {}
    for (const p of flat) {
      byService[p.profileService] = (byService[p.profileService] ?? 0) + 1
    }
    const engagement = aggregateStats(flat)

    return NextResponse.json({
      posts: flat,
      totals: {
        posts: flat.length,
        byService,
        engagement,
      },
      profilesUsed: targetProfiles.map(p => ({
        id: p.id, service: p.service, formattedUsername: p.formattedUsername,
      })),
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Buffer posts fetch failed',
    }, { status: 502 })
  }
}
