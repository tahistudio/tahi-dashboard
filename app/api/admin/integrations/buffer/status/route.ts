/**
 * GET /api/admin/integrations/buffer/status
 *
 * Returns:
 *   {
 *     configured: boolean,         // BUFFER_API_KEY env var present
 *     connected:  boolean,         // token works + at least one channel
 *     organizationId: string | null,
 *     organizationName: string | null,
 *     channels:   BufferChannel[], // Liam's connected social profiles
 *     errorMessage: string | null
 *   }
 *
 * Scoped to Liam Miller's personal Buffer account — NOT the Tahi
 * Studio company page. Uses Buffer's GraphQL API (api.buffer.com).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { listOrganizations, listChannels } from '@/lib/buffer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = process.env.BUFFER_API_KEY
  if (!token) {
    return NextResponse.json({
      configured: false,
      connected: false,
      organizationId: null,
      organizationName: null,
      channels: [],
      errorMessage: null,
    })
  }

  try {
    // Buffer's GraphQL requires an organizationId for everything. Pick
    // the first org on the account — single-user Personal Access
    // Tokens typically only have one. If Liam has multiple in future
    // we'd add a setting to pick the active one.
    const orgs = await listOrganizations(token)
    if (orgs.length === 0) {
      return NextResponse.json({
        configured: true,
        connected: false,
        organizationId: null,
        organizationName: null,
        channels: [],
        errorMessage: 'Buffer token works but no organisations found on this account.',
      })
    }
    const org = orgs[0]
    const channels = await listChannels(token, org.id)
    return NextResponse.json({
      configured: true,
      connected: channels.length > 0,
      organizationId: org.id,
      organizationName: org.name,
      channels,
      errorMessage: null,
    })
  } catch (err) {
    return NextResponse.json({
      configured: true,
      connected: false,
      organizationId: null,
      organizationName: null,
      channels: [],
      errorMessage: err instanceof Error ? err.message : 'Buffer API call failed',
    })
  }
}
