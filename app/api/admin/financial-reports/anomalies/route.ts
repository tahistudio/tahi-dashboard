/**
 * GET  /api/admin/financial-reports/anomalies      — list unresolved
 * POST /api/admin/financial-reports/anomalies/[id]/resolve — handled
 *      via PATCH /api/admin/notifications/[id] (mark read) by the UI
 *
 * Wraps the notifications table filtered to eventType='finance_anomaly'
 * + read=false so the UI doesn't need to know about the underlying
 * storage shape.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (denied) return denied

  const database = await db() as unknown as D1
  const rows = await database.all<{
    id: string
    title: string
    body: string | null
    entityId: string | null
    createdAt: string
  }>(sql`
    SELECT id, title, body, entity_id AS entityId, created_at AS createdAt
    FROM notifications
    WHERE event_type = 'finance_anomaly'
      AND read = 0
    ORDER BY created_at DESC
    LIMIT 20
  `)
  return NextResponse.json({ items: rows })
}
