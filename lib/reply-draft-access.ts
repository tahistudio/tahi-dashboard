import { scopedOrgIds } from '@/lib/access-scope'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg, requireAccessToOrgOrPreClient } from '@/lib/require-access'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string | null; orgId: string | null }

/** Draft access follows its source, without reading generated message content. */
export async function requireReplyDraftAccess(database: Database, auth: Auth, id: string) {
  if (auth.userId === 'api-service') return null
  const scope = await scopedOrgIds(auth)
  if (scope.kind === 'all') {
    // A scope grant alone does not bypass source feature grants.
    const { resolvePermissions } = await import('@/lib/permissions')
    const access = await resolvePermissions(database, auth)
    if (access.isAdmin) return null
  }
  const [draft] = await database.select({
    leadId: schema.aiReplyDrafts.leadId, invoiceId: schema.aiReplyDrafts.invoiceId,
  }).from(schema.aiReplyDrafts).where(eq(schema.aiReplyDrafts.id, id)).limit(1)
  if (!draft) {
    const denied = await requireFeature(auth, 'leads')
    if (denied) return denied
    return requireAccessToOrgOrPreClient(database, auth.userId, null)
  }
  if (!draft.leadId && !draft.invoiceId) {
    return NextResponse.json({ error: 'Draft has no source' }, { status: 403 })
  }
  if (draft.leadId) {
    const denied = await requireFeature(auth, 'leads')
    if (denied) return denied
    const scopeDenied = await requireAccessToOrgOrPreClient(database, auth.userId, null)
    if (scopeDenied) return scopeDenied
  }
  if (draft.invoiceId) {
    const denied = await requireFeature(auth, 'invoices')
    if (denied) return denied
    const [invoice] = await database.select({ orgId: schema.invoices.orgId })
      .from(schema.invoices).where(eq(schema.invoices.id, draft.invoiceId)).limit(1)
    const scopeDenied = await requireAccessToOrg(database, auth.userId, invoice?.orgId)
    if (scopeDenied) return scopeDenied
  }
  return null
}
