import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

// ── GET /api/portal/announcements ───────────────────────────────────────────
// Return active announcements for the current client org.
// Filters by targetType: if 'all' show it, if 'plan_type' check org's
// subscription, if 'org' check if orgId is in targetIds JSON array.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()
  const now = new Date().toISOString()

  // Get the org's plan type for plan_type filtering
  const orgRows = await database
    .select({ planType: schema.organisations.planType })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  const orgPlanType = orgRows.length > 0 ? orgRows[0].planType : null

  // Get all published, non-expired announcements
  let allAnnouncements = await database
    .select()
    .from(schema.announcements)
    .orderBy(desc(schema.announcements.createdAt))

  // Filter to active (published and not expired)
  allAnnouncements = allAnnouncements.filter(a => {
    if (!a.publishedAt) return false
    if (a.expiresAt && a.expiresAt < now) return false
    return true
  })

  // Filter by target type
  const relevant = allAnnouncements.filter(a => {
    if (a.targetType === 'all') return true

    if (a.targetType === 'plan_type') {
      return a.targetValue === orgPlanType
    }

    if (a.targetType === 'org') {
      // Check targetIds JSON array
      if (!a.targetIds) return false
      try {
        const ids: string[] = JSON.parse(a.targetIds)
        return ids.includes(orgId)
      } catch {
        // Also check targetValue as a single org ID
        return a.targetValue === orgId
      }
    }

    return false
  })

  // Check which ones the user has dismissed
  const dismissals = await database
    .select({ announcementId: schema.announcementDismissals.announcementId })
    .from(schema.announcementDismissals)
    .where(eq(schema.announcementDismissals.userId, userId))

  const dismissedIds = new Set(dismissals.map(d => d.announcementId))

  const announcements = relevant
    .filter(a => !dismissedIds.has(a.id))
    .map(a => ({
      id: a.id,
      title: a.title,
      body: a.body,
      type: a.type,
      publishedAt: a.publishedAt,
      expiresAt: a.expiresAt,
    }))

  return NextResponse.json({ announcements })
}
