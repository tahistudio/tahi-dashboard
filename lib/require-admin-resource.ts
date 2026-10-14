import { NextResponse } from 'next/server'
import { requireFeature } from '@/lib/require-feature'
import { requireContractAccess, requireProposalAccess, requireScheduleAccess } from '@/app/api/admin/_sales-access/artifact-scope'
import type { RequestAuthResult } from '@/lib/server-auth'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Shared-resource analytics inherit the owning artifact's feature and client scope. */
export async function requireAdminResource(
  database: D1,
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  resourceType: string,
  resourceId: string,
): Promise<NextResponse | null> {
  const resource = resourceType === 'schedule' ? { feature: 'schedules', guard: requireScheduleAccess }
    : resourceType === 'proposal' ? { feature: 'proposals', guard: requireProposalAccess }
      : resourceType === 'contract' ? { feature: 'contracts', guard: requireContractAccess }
        : null
  if (!resource) return NextResponse.json({ error: 'Unsupported resource type' }, { status: 400 })
  const denied = await requireFeature(auth, resource.feature)
  if (denied) return denied
  return resource.guard(database, auth, resourceId)
}
