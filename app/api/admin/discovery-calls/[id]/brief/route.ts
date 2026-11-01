/**
 * GET /api/admin/discovery-calls/[id]/brief
 *
 * LP.4: the pre-call brief for a call with an existing client. Read only, and
 * it sends nothing: no email, no Slack, no message to anyone. The discovery
 * pre-call digest cron (/api/admin/cron/pre-call-digest) is unchanged and
 * stays the only thing that mails, to the studio mailbox, on its own timer.
 *
 * Gates, in order: Tahi admin, the 'calls' feature, then the same per-call
 * scope check the call's PATCH uses (so a scoped teammate gets a 403 for a
 * client outside their rules). Requests, tasks and invoices each need their
 * own feature on top; a section the viewer cannot see is never read.
 *
 * The rules live in lib/client-call-brief.ts and the reads in
 * lib/client-call-brief-data.ts. Nothing but HTTP handlers is exported here.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireFeature } from '@/lib/require-feature'
import { requireDiscoveryCallAccess } from '@/lib/discovery-call-access'
import { loadClientCallBrief, resolveBriefSections } from '@/lib/client-call-brief-data'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'calls')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const scopeDenied = await requireDiscoveryCallAccess(database, { userId, orgId }, id)
  if (scopeDenied) return scopeDenied

  const sections = await resolveBriefSections(database, { userId, orgId })
  const result = await loadClientCallBrief(database, id, sections)
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }
  return NextResponse.json({ brief: result.brief })
}
