/**
 * GET /api/portal/kickoff-slots
 *
 * Read-only bookable half-hours for the onboarding kickoff picker
 * (components/tahi/onboarding-content.tsx). Liam's feedback walking the
 * kickoff step as a dummy client: the picker offered four fixed labels
 * ('9:30 am', '11:00 am', '1:30 pm', '3:00 pm') on any of the next four
 * weekdays, computed entirely client-side, with no idea whether the studio
 * actually had that hour free.
 *
 * The window itself (lib/kickoff-availability.ts) is built from the studio's
 * business hours in Pacific/Auckland, never from the runtime clock. Google
 * Calendar's freeBusy endpoint (lib/google.ts) then removes whatever the
 * studio's primary calendar reports busy.
 *
 * The calendar lookup is best-effort in every direction: no integration, an
 * expired token, or a failed freeBusy call all fall back to the plain window
 * with nothing marked busy (`calendarSynced: false`) rather than blocking the
 * kickoff step, the same contract POST /api/portal/calls already keeps with
 * Google when IT pushes a booked event.
 *
 * `timeZone` is the visitor's own IANA zone, validated the same way the
 * booking route validates it (lib/kickoff-slot.ts `resolveTimeZone`), so each
 * slot is labelled in the clock the person looking at the picker actually
 * reads, and the payload names the studio's own zone too so the picker can
 * say whose clock the times are relative to.
 */
import { getPortalAuth, getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getGoogleAccessToken, getPrimaryCalendarFreeBusy } from '@/lib/google'
import { resolveTimeZone, formatSlotTime, STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
import { buildKickoffSlots, KICKOFF_WORKING_DAYS } from '@/lib/kickoff-availability'

export const dynamic = 'force-dynamic'

/** Long display name for an IANA zone, e.g. "New Zealand Standard Time".
 *  Falls back to the zone id itself if the runtime cannot resolve one. */
function zoneDisplayName(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' }).formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? zone
  } catch {
    return zone
  }
}

export async function GET(req: NextRequest) {
  // MCP parity branch (CLAUDE.md rule 14). The worker's service token has no
  // client org of its own (its Clerk org resolves to the Tahi org), so it
  // must NAME one in `?orgId=`, exactly like the portal_* messages tools
  // (app/api/portal/messages/_shared.ts). A human session can never take this
  // branch: 'api-service' is minted only for a verified TAHI_API_TOKEN.
  const auth = await getRequestAuth(req)
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const isService = auth.userId === 'api-service'

  let orgId: string | null
  let userId: string | null
  if (isService) {
    orgId = new URL(req.url).searchParams.get('orgId')?.trim() || null
    userId = auth.userId
  } else {
    const portal = await getPortalAuth(req)
    orgId = portal.orgId
    userId = portal.userId
  }

  if (!userId || !orgId || orgId === tahiOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const timeZone = resolveTimeZone(new URL(req.url).searchParams.get('timeZone'))

  const database = await db()

  let busy: Array<{ start: string; end: string }> = []
  let calendarSynced = false
  // Set only on the unsynced fallback, so a client can tell "we checked and
  // you're free" from "we could not check". The production Google grant
  // today holds only calendar.events.readonly, which freeBusy 403s on, so
  // this is the expected answer until that grant is widened and reconnected
  // (see app/api/admin/integrations/google/start/route.ts), never a reason
  // to fail the last screen of onboarding.
  let reason: string | null = null
  try {
    const tokens = await getGoogleAccessToken(database)
    const now = new Date()
    // Wide enough to cover KICKOFF_WORKING_DAYS working days plus the
    // weekends that fall inside that span.
    const windowEnd = new Date(now.getTime() + (KICKOFF_WORKING_DAYS + 4) * 86_400_000)
    busy = await getPrimaryCalendarFreeBusy(tokens.accessToken, now.toISOString(), windowEnd.toISOString())
    calendarSynced = true
  } catch {
    // Not connected, a stale refresh token, insufficient scope, or the
    // freeBusy call itself failing are all the same case here: offer the
    // plain window rather than fail the last screen of onboarding over a
    // calendar hiccup.
    busy = []
    calendarSynced = false
    reason = 'Reconnect Google to sync availability'
  }

  const slots = buildKickoffSlots({ busy })

  return NextResponse.json({
    calendarSynced,
    reason,
    timeZone,
    timeZoneLabel: zoneDisplayName(timeZone),
    studioTimeZone: STUDIO_TIME_ZONE,
    studioTimeZoneLabel: zoneDisplayName(STUDIO_TIME_ZONE),
    slots: slots.map(s => ({
      start: s.start,
      end: s.end,
      label: formatSlotTime(s.start, { timeZone }),
    })),
  })
}
