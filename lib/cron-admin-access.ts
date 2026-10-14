import { NextRequest } from 'next/server'
import { hasCronSecretAuth } from '@/lib/cron-runs'
import { getRequestAuth } from '@/lib/server-auth'
import { requireStudioAdmin } from '@/lib/internal-route-access'

/** Route-specific guard for manual workspace jobs. Scheduler identity stays unchanged. */
export async function requireManualCronAdmin(req: NextRequest, feature: string) {
  if (hasCronSecretAuth(req)) return null
  return requireStudioAdmin(await getRequestAuth(req), feature)
}
