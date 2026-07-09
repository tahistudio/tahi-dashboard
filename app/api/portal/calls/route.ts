import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface AttendeeLite {
  id?: string
  type?: string
  name?: string
  email?: string
  role?: string
}

interface CallItem {
  id: string
  title: string
  whenISO: string
  durationMin: number
  meetingUrl: string | null
  withName: string | null
  avatar: string | null
}

function parseAttendees(raw: string | null): AttendeeLite[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AttendeeLite[]) : []
  } catch {
    return []
  }
}

// Choose the person to show as "with" — the host / team member if we can tell,
// else the first named attendee.
function pickWith(attendees: AttendeeLite[]): AttendeeLite | null {
  const host = attendees.find(
    (a) => a.role === 'host' || a.type === 'team_member',
  )
  if (host?.name) return host
  const named = attendees.find((a) => !!a.name)
  return named ?? null
}

// ── GET /api/portal/calls ────────────────────────────────────────────────────
// Upcoming scheduled + discovery calls for the caller's org, next first, with a
// join link where one exists. Backs the client "Next call" card and the calls
// NeedsYou item. Scoped to the org; the Tahi admin org is rejected. Honest empty
// [] when nothing is booked (the UI falls back to the booking CTA). Read-only.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 5

  const database = await db()
  const drizzle = database as D1

  // A call currently in its first 30 minutes still counts as "upcoming" so the
  // Join button surfaces while a meeting is live. Org calls are low-volume, so
  // we filter with real Date numerics in JS (Google returns local-tz offsets,
  // which makes lexicographic comparison unreliable near boundaries).
  const cutoffMs = Date.now() - 30 * 60_000

  type RawCall = {
    id: string
    title: string
    scheduledAt: string
    durationMinutes: number
    meetingUrl: string | null
    attendees: string | null
  }

  let scheduled: RawCall[] = []
  try {
    scheduled = await drizzle
      .select({
        id: schema.scheduledCalls.id,
        title: schema.scheduledCalls.title,
        scheduledAt: schema.scheduledCalls.scheduledAt,
        durationMinutes: schema.scheduledCalls.durationMinutes,
        meetingUrl: schema.scheduledCalls.meetingUrl,
        attendees: schema.scheduledCalls.attendees,
      })
      .from(schema.scheduledCalls)
      .where(and(
        eq(schema.scheduledCalls.orgId, orgId),
        eq(schema.scheduledCalls.status, 'scheduled'),
      ))
      .orderBy(asc(schema.scheduledCalls.scheduledAt))
      .limit(limit * 6)
  } catch {
    scheduled = []
  }

  let discovery: RawCall[] = []
  try {
    discovery = await drizzle
      .select({
        id: schema.discoveryCalls.id,
        title: schema.discoveryCalls.title,
        scheduledAt: schema.discoveryCalls.scheduledAt,
        durationMinutes: schema.discoveryCalls.durationMinutes,
        meetingUrl: schema.discoveryCalls.googleMeetUrl,
        attendees: schema.discoveryCalls.attendees,
      })
      .from(schema.discoveryCalls)
      .where(and(
        eq(schema.discoveryCalls.orgId, orgId),
        eq(schema.discoveryCalls.status, 'scheduled'),
      ))
      .orderBy(asc(schema.discoveryCalls.scheduledAt))
      .limit(limit * 6)
  } catch {
    discovery = []
  }

  const merged = [
    ...scheduled.map((c) => ({ ...c, source: 'scheduled' as const })),
    ...discovery.map((c) => ({ ...c, source: 'discovery' as const })),
  ]
    .filter((c) => {
      const ms = new Date(c.scheduledAt).getTime()
      return Number.isFinite(ms) && ms >= cutoffMs
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, limit)

  // Resolve avatars by matching attendee emails to Tahi team members.
  const emails = new Set<string>()
  for (const c of merged) {
    for (const a of parseAttendees(c.attendees)) {
      if (a.email) emails.add(a.email.toLowerCase())
    }
  }
  const avatarByEmail = new Map<string, string>()
  if (emails.size > 0) {
    try {
      const members = await drizzle
        .select({ email: schema.teamMembers.email, avatarUrl: schema.teamMembers.avatarUrl })
        .from(schema.teamMembers)
      for (const m of members) {
        const key = m.email?.toLowerCase()
        if (key && emails.has(key) && m.avatarUrl) avatarByEmail.set(key, m.avatarUrl)
      }
    } catch {
      // team_members unreadable — leave avatars null.
    }
  }

  const items: CallItem[] = merged.map((c) => {
    const attendee = pickWith(parseAttendees(c.attendees))
    const avatar = attendee?.email ? avatarByEmail.get(attendee.email.toLowerCase()) ?? null : null
    return {
      id: `${c.source}:${c.id}`,
      title: c.title.trim() || 'Call',
      whenISO: c.scheduledAt,
      durationMin: c.durationMinutes ?? 30,
      meetingUrl: c.meetingUrl ?? null,
      withName: attendee?.name ?? null,
      avatar,
    }
  })

  return NextResponse.json({ items })
}
