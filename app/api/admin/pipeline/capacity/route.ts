import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lte, ne, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/pipeline/capacity
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db() as unknown as D1

  // Get all team members
  const members = await database
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      avatarUrl: schema.teamMembers.avatarUrl,
      title: schema.teamMembers.title,
      weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours,
    })
    .from(schema.teamMembers)

  // Get time entries for the current week
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]

  const timeEntries = await database
    .select({
      teamMemberId: schema.timeEntries.teamMemberId,
      totalHours: sql<number>`sum(${schema.timeEntries.hours})`.as('total_hours'),
    })
    .from(schema.timeEntries)
    .where(and(
      gte(schema.timeEntries.date, weekStart),
      lte(schema.timeEntries.date, weekEnd),
    ))
    .groupBy(schema.timeEntries.teamMemberId)

  const hoursMap: Record<string, number> = {}
  for (const entry of timeEntries) {
    hoursMap[entry.teamMemberId] = entry.totalHours ?? 0
  }

  // Get open deals with estimated hours and stage probability
  const openDeals = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      estimatedHoursPerWeek: schema.deals.estimatedHoursPerWeek,
      probability: schema.pipelineStages.probability,
    })
    .from(schema.deals)
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(and(
      ne(schema.pipelineStages.isClosedWon, 1),
      ne(schema.pipelineStages.isClosedLost, 1),
    ))

  // Calculate per-member capacity
  const teamMembers = members.map(m => {
    const capacity = m.weeklyCapacityHours ?? 40
    const allocated = hoursMap[m.id] ?? 0
    const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0

    return {
      id: m.id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      title: m.title,
      weeklyCapacityHours: capacity,
      currentHoursAllocated: allocated,
      utilization,
    }
  })

  // Calculate totals
  const totalCapacity = teamMembers.reduce((sum, m) => sum + m.weeklyCapacityHours, 0)
  const totalAllocated = teamMembers.reduce((sum, m) => sum + m.currentHoursAllocated, 0)

  // Pipeline impact: weighted hours from deals
  const pipelineImpact = openDeals.reduce((sum, d) => {
    const hours = d.estimatedHoursPerWeek ?? 0
    const prob = d.probability ?? 0
    return sum + (hours * prob / 100)
  }, 0)

  const availableCapacity = totalCapacity - totalAllocated
  const forecastedCapacity = availableCapacity - pipelineImpact

  return NextResponse.json({
    teamMembers,
    totalCapacity,
    totalAllocated,
    pipelineImpact: Math.round(pipelineImpact * 10) / 10,
    availableCapacity,
    forecastedCapacity: Math.round(forecastedCapacity * 10) / 10,
    weekRange: { start: weekStart, end: weekEnd },
  })
}
