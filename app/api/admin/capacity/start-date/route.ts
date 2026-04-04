/**
 * POST /api/admin/capacity/start-date
 *
 * Calculates the earliest start date for a new engagement based on team
 * capacity over the next 12 weeks.
 *
 * Body: { estimatedHoursPerWeek: number }
 * Returns: { earliestDate, availableHoursPerWeek, totalTeamCapacity, committedHours, weeksOut }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Rough weekly hour estimates per plan type */
const PLAN_HOURS: Record<string, number> = {
  maintain: 8,
  scale: 16,
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { estimatedHoursPerWeek?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const estimatedHoursPerWeek = Number(body.estimatedHoursPerWeek)
  if (!estimatedHoursPerWeek || estimatedHoursPerWeek <= 0) {
    return NextResponse.json(
      { error: 'estimatedHoursPerWeek must be a positive number' },
      { status: 400 },
    )
  }

  const database = await db() as unknown as D1

  // 1. Total team capacity = sum of all team members' weeklyCapacityHours
  const members = await database
    .select({ weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours })
    .from(schema.teamMembers)

  const totalTeamCapacity = members.reduce(
    (sum, m) => sum + (m.weeklyCapacityHours ?? 40),
    0,
  )

  // 2. Committed hours = sum of hours for all active subscriptions
  const activeSubs = await database
    .select({ planType: schema.subscriptions.planType })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, 'active'))

  const committedHours = activeSubs.reduce(
    (sum, s) => sum + (PLAN_HOURS[s.planType] ?? 0),
    0,
  )

  // 3. Available hours per week (constant across the 12 week window since
  //    we don't have future subscription start/end dates to vary it)
  const availableHoursPerWeek = totalTeamCapacity - committedHours

  // 4. Find the first week (out of next 12) where available >= requested
  const now = new Date()
  // Start of next Monday
  const startOfNextWeek = new Date(now)
  const dayOfWeek = startOfNextWeek.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  startOfNextWeek.setDate(startOfNextWeek.getDate() + daysUntilMonday)
  startOfNextWeek.setHours(0, 0, 0, 0)

  let earliestDate: string | null = null
  let weeksOut = 0

  for (let week = 0; week < 12; week++) {
    if (availableHoursPerWeek >= estimatedHoursPerWeek) {
      const weekStart = new Date(startOfNextWeek)
      weekStart.setDate(weekStart.getDate() + week * 7)
      earliestDate = weekStart.toISOString()
      weeksOut = week + 1
      break
    }
  }

  // If no week has enough capacity, return the data with null date
  if (!earliestDate) {
    return NextResponse.json({
      earliestDate: null,
      availableHoursPerWeek,
      totalTeamCapacity,
      committedHours,
      weeksOut: 0,
    })
  }

  return NextResponse.json({
    earliestDate,
    availableHoursPerWeek,
    totalTeamCapacity,
    committedHours,
    weeksOut,
  })
}
