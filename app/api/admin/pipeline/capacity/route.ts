import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lte, ne, sql, inArray } from 'drizzle-orm'
import {
  INACTIVE_MEMBER_EMAILS_SETTING_KEY,
  isActiveTeamMember,
  resolveInactiveMemberEmails,
} from '@/lib/capacity-active-members'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/pipeline/capacity
 *
 * "Booked" is work assigned FOR THIS WEEK, not hours already logged (beta
 * audit, 2026-09-19: the card read allocated hours off timeEntries logged
 * this week, which reads 0% booked every Monday morning no matter how full
 * the week ahead is). Booked hours are the sum of:
 *   - open tasks (status != 'done') assigned to the member, due this week or
 *     already overdue, by estimatedHours
 *   - open requests (status not delivered/archived) assigned to the member
 *     with an estimatedHours set
 * Hours already logged this week stay a separate figure, `loggedHours`,
 * rather than being folded into "booked".
 *
 * teamMembers carries no active/status column, so a member only counts here
 * when they are not on the `team.inactiveMemberEmails` setting and carry a
 * positive weeklyCapacityHours. See lib/capacity-active-members.ts.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db() as unknown as D1

  const [allMembers, inactiveRows] = await Promise.all([
    database
      .select({
        id: schema.teamMembers.id,
        name: schema.teamMembers.name,
        avatarUrl: schema.teamMembers.avatarUrl,
        title: schema.teamMembers.title,
        email: schema.teamMembers.email,
        weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours,
      })
      .from(schema.teamMembers),
    database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, INACTIVE_MEMBER_EMAILS_SETTING_KEY))
      .limit(1),
  ])

  const inactiveAddresses = resolveInactiveMemberEmails(inactiveRows[0]?.value ?? null)
  const activeMembers = allMembers.filter(m => isActiveTeamMember(m, inactiveAddresses))

  // Current week range (Monday to Sunday), same window as timeEntries logged.
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]

  if (activeMembers.length === 0) {
    return NextResponse.json({
      teamMembers: [],
      totalCapacity: 0,
      totalAssignedHours: 0,
      totalLoggedHours: 0,
      availableCapacity: 0,
      weekRange: { start: weekStart, end: weekEnd },
    })
  }

  const memberIds = activeMembers.map(m => m.id)

  const [loggedRows, taskRows, requestRows] = await Promise.all([
    // Hours already logged this week - kept as its own figure, never folded
    // into "booked".
    database
      .select({
        teamMemberId: schema.timeEntries.teamMemberId,
        totalHours: sql<number>`sum(${schema.timeEntries.hours})`.as('total_hours'),
      })
      .from(schema.timeEntries)
      .where(and(
        inArray(schema.timeEntries.teamMemberId, memberIds),
        gte(schema.timeEntries.date, weekStart),
        lte(schema.timeEntries.date, weekEnd),
      ))
      .groupBy(schema.timeEntries.teamMemberId),
    // Open tasks assigned to an active member, due this week or overdue.
    database
      .select({
        assigneeId: schema.tasks.assigneeId,
        totalHours: sql<number>`sum(${schema.tasks.estimatedHours})`.as('total_hours'),
      })
      .from(schema.tasks)
      .where(and(
        inArray(schema.tasks.assigneeId, memberIds),
        ne(schema.tasks.status, 'done'),
        sql`${schema.tasks.dueDate} IS NOT NULL AND ${schema.tasks.dueDate} <= ${weekEnd}`,
      ))
      .groupBy(schema.tasks.assigneeId),
    // Open requests assigned to an active member with an estimate.
    database
      .select({
        assigneeId: schema.requests.assigneeId,
        totalHours: sql<number>`sum(${schema.requests.estimatedHours})`.as('total_hours'),
      })
      .from(schema.requests)
      .where(and(
        inArray(schema.requests.assigneeId, memberIds),
        sql`${schema.requests.status} NOT IN ('delivered', 'archived')`,
        sql`${schema.requests.estimatedHours} IS NOT NULL AND ${schema.requests.estimatedHours} > 0`,
      ))
      .groupBy(schema.requests.assigneeId),
  ])

  const loggedMap = new Map<string, number>(
    loggedRows.map(r => [r.teamMemberId, r.totalHours ?? 0]),
  )
  const taskHoursMap = new Map<string, number>(
    taskRows.filter(r => r.assigneeId).map(r => [r.assigneeId as string, r.totalHours ?? 0]),
  )
  const requestHoursMap = new Map<string, number>(
    requestRows.filter(r => r.assigneeId).map(r => [r.assigneeId as string, r.totalHours ?? 0]),
  )

  const teamMembers = activeMembers.map(m => {
    const capacity = m.weeklyCapacityHours ?? 0
    const assignedHours = (taskHoursMap.get(m.id) ?? 0) + (requestHoursMap.get(m.id) ?? 0)
    const loggedHours = loggedMap.get(m.id) ?? 0
    const utilization = capacity > 0 ? Math.round((assignedHours / capacity) * 100) : 0

    return {
      id: m.id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      title: m.title,
      weeklyCapacityHours: capacity,
      assignedHours,
      loggedHours,
      utilization,
    }
  })

  const totalCapacity = teamMembers.reduce((sum, m) => sum + m.weeklyCapacityHours, 0)
  const totalAssignedHours = teamMembers.reduce((sum, m) => sum + m.assignedHours, 0)
  const totalLoggedHours = teamMembers.reduce((sum, m) => sum + m.loggedHours, 0)
  const availableCapacity = Math.max(0, totalCapacity - totalAssignedHours)

  return NextResponse.json({
    teamMembers,
    totalCapacity,
    totalAssignedHours,
    totalLoggedHours,
    availableCapacity,
    weekRange: { start: weekStart, end: weekEnd },
  })
}
