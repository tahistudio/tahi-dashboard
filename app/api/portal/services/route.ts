import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── GET /api/portal/services ────────────────────────────────────────────────
// The client-facing catalogue: what the studio takes on.
//
// An explicit projection rather than select(). The row also carries price,
// currency and the studio's own bookkeeping timestamps, and the client
// showcase renders none of them: services are scoped and quoted per client, so
// a catalogue price is a number nobody should read as a quote. Selecting only
// what the page draws means a column added to `services` later cannot leak to
// a client by default.
//
// KNOWN GAP, not introduced here: `services` has no orgId, so every client
// sees every catalogue row. Org scoping is CT.11 and needs a schema change.
export async function GET(req: NextRequest) {
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'services')
  if (featureDenied) return featureDenied

  const database = await db()
  const items = await database
    .select({
      id: schema.services.id,
      name: schema.services.name,
      description: schema.services.description,
      category: schema.services.category,
      isRecurring: schema.services.isRecurring,
      recurringInterval: schema.services.recurringInterval,
    })
    .from(schema.services)
    .where(eq(schema.services.showInCatalog, 1))
    // Alphabetical, not newest first: a catalogue is a list a person reads,
    // and "what we added last" is a studio fact, not a client one.
    .orderBy(asc(schema.services.name))

  return NextResponse.json({ items })
}
