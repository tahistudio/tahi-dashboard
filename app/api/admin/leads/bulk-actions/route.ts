/**
 * POST /api/admin/leads/bulk-actions
 *
 * Bulk operations on a set of lead ids. Designed for the
 * "I selected 50 leads in the table — now what" flow.
 *
 * Body:
 *   ids:        string[]   required, max 500 per call
 *   action:     'archive' | 'rescore' | 'assign_owner' | 'set_status'
 *                          | 'delete'
 *   payload:    action-specific extras
 *
 * Actions:
 *
 *   archive             — flips status='archived' on each lead, sets
 *                          archiveReason (from payload.reason, default
 *                          'Bulk archived').
 *
 *   rescore             — bumps updatedAt > lastAiRunAt on each so the
 *                          cron picks them up next tick. Doesn't run
 *                          Haiku inline (would blow the 30s budget on
 *                          large batches). Returns immediately.
 *
 *   assign_owner        — sets ownerId for each (payload.ownerId
 *                          required).
 *
 *   set_status          — sets status for each (payload.status
 *                          required). Useful for bulk move
 *                          new → nurturing etc.
 *
 *   delete              — permanently removes the lead rows. Personid
 *                          (canonical person record) is kept.
 *                          Requires payload.confirm === 'DELETE' to
 *                          guard against accidental hits.
 *
 * Returns: { processed, errors }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const MAX_IDS = 500

type BulkAction = 'archive' | 'rescore' | 'assign_owner' | 'set_status' | 'delete'

interface BulkBody {
  ids?: string[]
  action?: BulkAction
  payload?: {
    reason?: string
    ownerId?: string
    status?: string
    confirm?: string
  }
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: BulkBody
  try {
    body = await req.json() as BulkBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const ids = body.ids ?? []
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids[] is required and must be non-empty' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Too many ids (${ids.length}). Cap is ${MAX_IDS} per request.` }, { status: 400 })
  }
  if (!body.action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()
  const payload = body.payload ?? {}
  const errors: Array<{ id: string; error: string }> = []
  let processed = 0

  switch (body.action) {
    case 'archive': {
      const reason = payload.reason?.trim() || 'Bulk archived'
      try {
        await database
          .update(schema.leads)
          .set({ status: 'archived', archiveReason: reason, updatedAt: now })
          .where(inArray(schema.leads.id, ids))
        processed = ids.length
        // Activity stamp per lead (batch insert)
        await database.insert(schema.activities).values(
          ids.map(id => ({
            id: crypto.randomUUID(),
            type: 'lead_archived',
            title: `Lead archived: ${reason}`,
            description: 'Bulk archive action',
            leadId: id,
            createdById: userId,
            createdAt: now,
            updatedAt: now,
          }))
        )
      } catch (err) {
        errors.push({ id: 'batch', error: err instanceof Error ? err.message : String(err) })
      }
      break
    }

    case 'rescore': {
      // Bump updatedAt by 1 second past now so the cron's
      // (updatedAt > lastAiRunAt) gate picks them up.
      const bumpedTimestamp = new Date(Date.now() + 1000).toISOString()
      try {
        await database
          .update(schema.leads)
          .set({ updatedAt: bumpedTimestamp })
          .where(inArray(schema.leads.id, ids))
        processed = ids.length
      } catch (err) {
        errors.push({ id: 'batch', error: err instanceof Error ? err.message : String(err) })
      }
      break
    }

    case 'assign_owner': {
      if (!payload.ownerId?.trim()) {
        return NextResponse.json({ error: 'payload.ownerId required for assign_owner' }, { status: 400 })
      }
      try {
        await database
          .update(schema.leads)
          .set({ ownerId: payload.ownerId, updatedAt: now })
          .where(inArray(schema.leads.id, ids))
        processed = ids.length
      } catch (err) {
        errors.push({ id: 'batch', error: err instanceof Error ? err.message : String(err) })
      }
      break
    }

    case 'set_status': {
      const status = payload.status?.trim()
      if (!status) {
        return NextResponse.json({ error: 'payload.status required for set_status' }, { status: 400 })
      }
      if (!['new', 'qualifying', 'nurturing', 'promoted', 'archived'].includes(status)) {
        return NextResponse.json({ error: `Invalid status "${status}"` }, { status: 400 })
      }
      try {
        await database
          .update(schema.leads)
          .set({ status, updatedAt: now })
          .where(inArray(schema.leads.id, ids))
        processed = ids.length
        await database.insert(schema.activities).values(
          ids.map(id => ({
            id: crypto.randomUUID(),
            type: 'lead_status_changed',
            title: `Status changed to ${status} (bulk)`,
            description: null,
            leadId: id,
            createdById: userId,
            createdAt: now,
            updatedAt: now,
          }))
        )
      } catch (err) {
        errors.push({ id: 'batch', error: err instanceof Error ? err.message : String(err) })
      }
      break
    }

    case 'delete': {
      if (payload.confirm !== 'DELETE') {
        return NextResponse.json({ error: 'Refusing to delete without payload.confirm === "DELETE"' }, { status: 400 })
      }
      try {
        await database.delete(schema.leads).where(inArray(schema.leads.id, ids))
        processed = ids.length
      } catch (err) {
        errors.push({ id: 'batch', error: err instanceof Error ? err.message : String(err) })
      }
      break
    }

    default:
      return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 })
  }

  return NextResponse.json({ action: body.action, processed, errors })
}
