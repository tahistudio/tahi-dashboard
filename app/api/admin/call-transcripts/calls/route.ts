/**
 * GET /api/admin/call-transcripts/calls?q=&limit=
 *
 * The candidate list behind the Attach picker on /calls: every call a set of
 * parked notes could belong to, from BOTH tables, newest first.
 *
 * /api/admin/calls/index cannot serve this: it reads discovery_calls only, and
 * a transcript can be attached to a scheduled call (a client kickoff or
 * check-in) just as easily. Deliberately small and read-only, with a search
 * over title and a formatted date, because that is all the picker needs.
 *
 * A static segment beside [id]: Next resolves /call-transcripts/calls here and
 * never to the transcript route, which only ever sees UUIDs.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { isOrgInScope, orgColumnInScope } from '../../_scoping/org-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How far either side of today a call can sit and still be attachable. */
const WINDOW_DAYS = 180

interface PickerCall {
  kind: 'discovery' | 'scheduled'
  id: string
  title: string
  scheduledAt: string
  orgId: string | null
  orgName: string | null
}

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 25

  const database = await db() as unknown as D1

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()
  const until = new Date(Date.now() + WINDOW_DAYS * 86400_000).toISOString()

  const discoveryConditions = [
    gte(schema.discoveryCalls.scheduledAt, since),
    lte(schema.discoveryCalls.scheduledAt, until),
  ]
  // A pre-client discovery call carries no org, so it stays visible to any
  // caller with a scope (same rule as the /calls index).
  if (scope.kind === 'some') {
    discoveryConditions.push(orgColumnInScope(schema.discoveryCalls.orgId, scope.orgIds, { includeNull: true }))
  }

  const discoveryRows = await database
    .select({
      id: schema.discoveryCalls.id,
      title: schema.discoveryCalls.title,
      scheduledAt: schema.discoveryCalls.scheduledAt,
      orgId: schema.discoveryCalls.orgId,
      orgName: schema.organisations.name,
    })
    .from(schema.discoveryCalls)
    .leftJoin(schema.organisations, eq(schema.discoveryCalls.orgId, schema.organisations.id))
    .where(and(...discoveryConditions))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))
    .limit(200)

  const scheduledConditions = [
    gte(schema.scheduledCalls.scheduledAt, since),
    lte(schema.scheduledCalls.scheduledAt, until),
  ]
  if (scope.kind === 'some') {
    scheduledConditions.push(orgColumnInScope(schema.scheduledCalls.orgId, scope.orgIds))
  }

  const scheduledRows = await database
    .select({
      id: schema.scheduledCalls.id,
      title: schema.scheduledCalls.title,
      scheduledAt: schema.scheduledCalls.scheduledAt,
      orgId: schema.scheduledCalls.orgId,
      orgName: schema.organisations.name,
    })
    .from(schema.scheduledCalls)
    .leftJoin(schema.organisations, eq(schema.scheduledCalls.orgId, schema.organisations.id))
    .where(and(...scheduledConditions))
    .orderBy(desc(schema.scheduledCalls.scheduledAt))
    .limit(200)

  const items: PickerCall[] = [
    ...discoveryRows
      .filter(r => isOrgInScope(scope, r.orgId, 'allow-if-any-scope'))
      .map((r): PickerCall => ({
        kind: 'discovery',
        id: r.id,
        title: r.title,
        scheduledAt: r.scheduledAt,
        orgId: r.orgId,
        orgName: r.orgName ?? null,
      })),
    ...scheduledRows.map((r): PickerCall => ({
      kind: 'scheduled',
      id: r.id,
      title: r.title,
      scheduledAt: r.scheduledAt,
      orgId: r.orgId,
      orgName: r.orgName ?? null,
    })),
  ]

  // Search on the title and on the date as a human would type it
  // ("18 sep", "2026-09-18"), because the one thing you always remember
  // about a call you are placing notes on is roughly when it was.
  const filtered = q
    ? items.filter(c => {
        if (c.title.toLowerCase().includes(q)) return true
        if (c.orgName?.toLowerCase().includes(q)) return true
        if (c.scheduledAt.toLowerCase().includes(q)) return true
        const pretty = new Date(c.scheduledAt).toLocaleDateString('en-NZ', {
          day: 'numeric', month: 'short', year: 'numeric',
        }).toLowerCase()
        return pretty.includes(q)
      })
    : items

  filtered.sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1))

  return NextResponse.json({ items: filtered.slice(0, limit) })
}
