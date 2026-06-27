import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/invites
 * Invite colleagues to the authenticated client's org. Body: { emails: string[] }.
 * Each becomes a Clerk organization invitation (role org:member); they get an
 * email immediately. Returns a per-email result so the UI can report failures.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { emails?: string[] }
  const emails = (body.emails ?? [])
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  if (emails.length === 0) {
    return NextResponse.json({ error: 'No valid emails' }, { status: 400 })
  }

  const clerk = await clerkClient()
  const results = await Promise.all(
    emails.map(async emailAddress => {
      try {
        await clerk.organizations.createOrganizationInvitation({
          organizationId: orgId,
          inviterUserId: userId,
          emailAddress,
          role: 'org:member',
        })
        return { email: emailAddress, invited: true }
      } catch (err) {
        return { email: emailAddress, invited: false, error: err instanceof Error ? err.message : 'Failed' }
      }
    }),
  )

  return NextResponse.json({ results, invited: results.filter(r => r.invited).length })
}
