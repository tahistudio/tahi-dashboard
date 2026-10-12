import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import { db } from '@/lib/db'
import { isClerkUserInTahiOrg, readMcpMemberById } from '@/lib/mcp-profile-server'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * The worker's refresh check: is this team member still allowed to use the
 * connector, and with the same profile. Service bearer only (a verified
 * TAHI_API_TOKEN); no session, however privileged, may call it.
 */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (auth.userId !== SERVICE_USER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }
  const teamMemberId = req.nextUrl.searchParams.get('teamMemberId')
  if (!teamMemberId) {
    return NextResponse.json({ error: 'teamMemberId is required' }, { status: 400, headers: NO_STORE })
  }

  let member: Awaited<ReturnType<typeof readMcpMemberById>>
  try {
    member = await readMcpMemberById(await db(), teamMemberId)
  } catch {
    return NextResponse.json({ error: 'member_lookup_unavailable' }, { status: 503, headers: NO_STORE })
  }

  let active = false
  if (member && member.clerkUserId && member.profile) {
    try {
      active = await isClerkUserInTahiOrg(member.clerkUserId)
    } catch {
      // 5xx tells the worker to retry; an outage must never read as revocation.
      return NextResponse.json({ error: 'membership_check_unavailable' }, { status: 503, headers: NO_STORE })
    }
  }
  return NextResponse.json(
    {
      active,
      profile: member?.profile ?? null,
      clerkUserId: member?.clerkUserId ?? null,
      name: member?.name ?? null,
    },
    { headers: NO_STORE },
  )
}
