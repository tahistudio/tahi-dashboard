/**
 * GET /api/admin/integrations/buffer/status
 *
 * Lightweight status for the Settings card. Returns:
 *   {
 *     configured: boolean,         // BUFFER_API_KEY env var present
 *     connected:  boolean,         // token works + at least one profile
 *     profiles:   BufferProfile[], // Liam's connected social profiles
 *     errorMessage: string | null
 *   }
 *
 * IMPORTANT: this surface is intentionally scoped to Liam Miller's
 * PERSONAL Buffer account. The Tahi Studio company page (if separately
 * scheduled) is not represented here.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { listProfiles } from '@/lib/buffer'

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
      profiles: [],
      errorMessage: null,
    })
  }

  try {
    const profiles = await listProfiles(token)
    return NextResponse.json({
      configured: true,
      connected: profiles.length > 0,
      profiles,
      errorMessage: null,
    })
  } catch (err) {
    return NextResponse.json({
      configured: true,
      connected: false,
      profiles: [],
      errorMessage: err instanceof Error ? err.message : 'Buffer API call failed',
    })
  }
}
