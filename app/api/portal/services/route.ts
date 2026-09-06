import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, eq, isNull, or } from 'drizzle-orm'

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
// Three conditions, and a row has to pass all of them (migration 0097). The
// old gap here was that there was only ever one: every client read every
// catalogue row, which stops being survivable the moment the ManyRequests
// import lands 18 services named for the clients they were priced for.
//
//   showInCatalog = 1     the studio has published it at all. The ManyRequests
//                         importer writes 0 for every source row on purpose.
//   visibility = 'public' the studio has not pulled it. Hidden beats global.
//   org_id IS NULL        a global row, or this client's own private row.
//     OR org_id = theirs   Another client's private row can never match.
//
// The org filter is on the caller's own orgId, resolved by getPortalAuth and
// never read off the request, so there is no parameter here to tamper with.
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
    .where(and(
      eq(schema.services.showInCatalog, 1),
      eq(schema.services.visibility, 'public'),
      or(isNull(schema.services.orgId), eq(schema.services.orgId, orgId)),
    ))
    // Alphabetical, not newest first: a catalogue is a list a person reads,
    // and "what we added last" is a studio fact, not a client one.
    .orderBy(asc(schema.services.name))

  return NextResponse.json({ items })
}
