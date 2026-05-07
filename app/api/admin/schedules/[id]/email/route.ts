import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { render } from '@react-email/render'
import { ScheduleShareEmail } from '@/emails/schedule-share'
import { publicUrl } from '@/lib/app-url'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

interface Recipient { name: string; email: string }

/**
 * POST /api/admin/schedules/[id]/email
 * Sends the public schedule link to a list of recipients via Resend.
 * Requires the schedule to have a publicShareToken minted already.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    to?: Recipient[]
    message?: string
  }
  if (!Array.isArray(body.to) || body.to.length === 0) {
    return NextResponse.json({ error: 'to[] required with at least one recipient' }, { status: 400 })
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
  }

  const database = await db() as unknown as D1
  const [schedule] = await database
    .select({
      id: schema.projectSchedules.id,
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

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []

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
      await resend.emails.send({
        from: 'Tahi Studio <business@tahi.studio>',
        to: r.email,
        subject: `Project schedule from Tahi Studio: ${schedule.title}`,
        html,
      })
      sent.push(r.email)
    } catch (err) {
      failed.push({ email: r.email, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return NextResponse.json({ sent, failed, viewUrl })
}
