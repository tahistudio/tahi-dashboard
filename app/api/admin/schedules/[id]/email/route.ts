import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { render } from '@react-email/render'
import { ScheduleShareEmail } from '@/emails/schedule-share'
import { publicUrl } from '@/lib/app-url'
import { emailFromAddress } from '@/lib/email'
import {
  deliverEmail,
  partitionRecipients,
  recordEmailSuppressions,
  resolveDeliveryPolicy,
  resolveOrgRecipientScope,
} from '@/lib/email-delivery'
import { requireScheduleAccess } from '@/app/api/admin/_sales-access/artifact-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

interface Recipient { name: string; email: string }

/**
 * POST /api/admin/schedules/[id]/email
 * Sends the public schedule link to a list of recipients, through the one
 * delivery gate in lib/email-delivery.ts. Recipients the tahi.studio allowlist
 * holds back come back in `suppressed` rather than being silently dropped.
 * Requires the schedule to have a publicShareToken minted already.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    to?: Recipient[]
    cc?: Recipient[]
    bcc?: Recipient[]
    subject?: string
    message?: string
  }
  if (!Array.isArray(body.to) || body.to.length === 0) {
    return NextResponse.json({ error: 'to[] required with at least one recipient' }, { status: 400 })
  }
  const ccList = (Array.isArray(body.cc) ? body.cc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const bccList = (Array.isArray(body.bcc) ? body.bcc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const customSubject = body.subject?.trim() || null

  // No RESEND_API_KEY check here on purpose. deliverEmail filters and logs
  // before it looks at the key, so a key-less environment still leaves an
  // evidence trail for every address it would have withheld.

  const database = await db() as unknown as D1

  const denied = await requireScheduleAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const [schedule] = await database
    .select({
      id: schema.projectSchedules.id,
      // Carried into the delivery gate so a client whose org is on
      // `email.allowedOrgIds` can be mailed even from an outside domain.
      orgId: schema.projectSchedules.orgId,
      title: schema.projectSchedules.title,
      subtitle: schema.projectSchedules.subtitle,
      targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      token: schema.projectSchedules.publicShareToken,
    })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!schedule.token) {
    return NextResponse.json({ error: 'Share the schedule first to mint a public link.' }, { status: 400 })
  }

  const fromName = 'Liam Miller'
  const customMessage = body.message?.trim() || null
  const viewUrl = publicUrl(`/p/schedule/${schedule.token}`)

  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []

  // cc and bcc are filtered ONCE, not once per recipient: they do not change
  // between iterations, so partitioning them inside the loop logged one
  // withheld cc address as many times as there were recipients and reported it
  // as many withheld sends. Recipients the allowlist held back are reported
  // rather than hidden.
  const policy = await resolveDeliveryPolicy()
  const scope = await resolveOrgRecipientScope(schedule.orgId, policy)
  const ccPart = partitionRecipients(ccList, policy, scope)
  const bccPart = partitionRecipients(bccList, policy, scope)
  const suppressed: string[] = [...ccPart.suppressed, ...bccPart.suppressed]
  await recordEmailSuppressions(
    suppressed,
    {
      template: 'schedule-share',
      subject: customSubject ?? `Project schedule from Tahi Studio: ${schedule.title}`,
      orgId: schedule.orgId,
    },
    policy,
  )

  for (const r of body.to) {
    if (!r.email?.trim()) continue
    try {
      const html = await render(ScheduleShareEmail({
        recipientName: r.name?.trim() || r.email.split('@')[0],
        scheduleTitle: schedule.title,
        scheduleSubtitle: schedule.subtitle,
        viewUrl,
        fromName,
        customMessage,
        targetLaunchDate: schedule.targetLaunchDate,
      }))
      const outcome = await deliverEmail({
        from: emailFromAddress(),
        to: r.email,
        cc: ccPart.allowed,
        bcc: bccPart.allowed,
        subject: customSubject ?? `Project schedule from Tahi Studio: ${schedule.title}`,
        html,
        template: 'schedule-share',
        orgId: schedule.orgId,
        policy,
      })
      suppressed.push(...outcome.suppressed)
      if (outcome.success) sent.push(r.email)
      else failed.push({ email: r.email, error: outcome.error ?? 'Unknown error' })
    } catch (err) {
      failed.push({ email: r.email, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return NextResponse.json({ sent, failed, suppressed, viewUrl })
}
