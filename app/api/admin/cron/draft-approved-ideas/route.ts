/**
 * POST /api/admin/cron/draft-approved-ideas - DEPRECATED (410 Gone)
 *
 * This cron drove the retired single-prompt lib/blog-writer.ts pipeline.
 * Approved-idea pickup + drafting is now handled by the round-table
 * orchestrator: POST /api/admin/cron/round-table-advance seeds queued
 * drafts for approved ideas (gated by content.draftingEnabled) and then
 * advances every draft one stage.
 *
 * Kept as a loud 410 (rather than deleting the file) so any external
 * scheduler still pointed at the old URL fails visibly with a pointer
 * instead of silently 404ing. Remove once no scheduler references it.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BODY = {
  error: 'Gone',
  message: 'draft-approved-ideas has been retired. Approved-idea drafting now runs via the round-table pipeline.',
  replacement: '/api/admin/cron/round-table-advance',
}

export async function POST() {
  return NextResponse.json(BODY, { status: 410 })
}

export async function GET() {
  return NextResponse.json(BODY, { status: 410 })
}
