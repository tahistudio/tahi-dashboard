import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { isNotNull } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface ResponseTimeItem {
  teamMemberId: string
  name: string
  messageCount: number
  avgResponseMinutes: number
}

// GET /api/admin/reports/response-time
// For each team member, calculate average time between a request being assigned
// to them and their first message on that request.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Get all team members
  const teamMembers = await database
    .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
    .from(schema.teamMembers)

  // Get all requests with assignees
  const assignedRequests = await database
    .select({
      id: schema.requests.id,
      assigneeId: schema.requests.assigneeId,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(isNotNull(schema.requests.assigneeId))

  // Get all messages
  const messages = await database
    .select({
      requestId: schema.messages.requestId,
      authorId: schema.messages.authorId,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .where(isNotNull(schema.messages.requestId))

  // Build a map of requestId -> messages by author
  const msgByRequest = new Map<string, Array<{ authorId: string; createdAt: string }>>()
  for (const msg of messages) {
    if (!msg.requestId) continue
    const arr = msgByRequest.get(msg.requestId) ?? []
    arr.push({ authorId: msg.authorId, createdAt: msg.createdAt })
    msgByRequest.set(msg.requestId, arr)
  }

  // Calculate per team member
  const items: ResponseTimeItem[] = []

  for (const tm of teamMembers) {
    const myRequests = assignedRequests.filter(r => r.assigneeId === tm.id)
    let totalMinutes = 0
    let count = 0

    for (const req of myRequests) {
      const reqMessages = msgByRequest.get(req.id) ?? []
      // Find the first message from this team member after request creation
      const firstResponse = reqMessages
        .filter(m => m.authorId === tm.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

      if (firstResponse) {
        const assignedAt = new Date(req.createdAt).getTime()
        const respondedAt = new Date(firstResponse.createdAt).getTime()
        const diffMinutes = Math.max(0, (respondedAt - assignedAt) / 60000)
        totalMinutes += diffMinutes
        count++
      }
    }

    items.push({
      teamMemberId: tm.id,
      name: tm.name,
      messageCount: count,
      avgResponseMinutes: count > 0 ? Math.round(totalMinutes / count) : 0,
    })
  }

  // Sort by avg response time ascending (fastest first)
  items.sort((a, b) => {
    if (a.messageCount === 0 && b.messageCount === 0) return 0
    if (a.messageCount === 0) return 1
    if (b.messageCount === 0) return -1
    return a.avgResponseMinutes - b.avgResponseMinutes
  })

  return NextResponse.json({ items })
}
