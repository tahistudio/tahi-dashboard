/**
 * lib/require-permission.ts — route guards for granular permissions.
 *
 * Thin wrappers over resolvePermissions for API routes:
 *   - requireManagePermissions: admin+ only (the permissions builder writes).
 *   - requireFeature: the caller must be able to see a given FEATURE_TREE key.
 *
 * Returns a NextResponse to short-circuit on denial, or the ResolvedAccess to
 * continue. Mirrors the shape of lib/require-access.ts.
 */

import { NextResponse } from 'next/server'
import { resolvePermissions, can, type ResolvedAccess } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function requireManagePermissions(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
): Promise<{ denied: NextResponse | null; access: ResolvedAccess }> {
  const access = await resolvePermissions(drizzle, auth)
  if (!access.canManagePermissions) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), access }
  }
  return { denied: null, access }
}

export async function requireFeature(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
  featureKey: string,
): Promise<{ denied: NextResponse | null; access: ResolvedAccess }> {
  const access = await resolvePermissions(drizzle, auth)
  if (!can(access, featureKey)) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), access }
  }
  return { denied: null, access }
}
