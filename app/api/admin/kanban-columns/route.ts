import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, isNull, inArray } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// The CLAUDE.md default board. statusValue matches requests.status vocabulary
// (underscored) so the board maps without translation.
const DEFAULT_COLUMNS: Array<{ label: string; statusValue: string; colour: string }> = [
  { label: 'Submitted', statusValue: 'submitted', colour: '#9A988F' },
  { label: 'In Review', statusValue: 'in_review', colour: '#2A6FDB' },
  { label: 'In Progress', statusValue: 'in_progress', colour: '#5A824E' },
  { label: 'Client Review', statusValue: 'client_review', colour: '#6D4FA3' },
  { label: 'On Hold', statusValue: 'on_hold', colour: '#B4531F' },
  { label: 'Delivered', statusValue: 'delivered', colour: '#1F8A5B' },
  { label: 'Cancelled', statusValue: 'cancelled', colour: '#C0392E' },
]

function slugStatus(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'new_column'
  )
}

async function listGlobal(drizzle: Drizzle) {
  return drizzle
    .select()
    .from(schema.kanbanColumns)
    .where(isNull(schema.kanbanColumns.orgId))
    .orderBy(asc(schema.kanbanColumns.position))
}

async function listForOrg(drizzle: Drizzle, orgId: string) {
  return drizzle
    .select()
    .from(schema.kanbanColumns)
    .where(eq(schema.kanbanColumns.orgId, orgId))
    .orderBy(asc(schema.kanbanColumns.position))
}

// GET /api/admin/kanban-columns
// Query: ?orgId=xxx - org-specific columns; falls back to the global set with
// inherited:true so the settings UI can render inheritance honestly.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as Drizzle

  if (filterOrgId) {
    const orgColumns = await listForOrg(drizzle, filterOrgId)
    if (orgColumns.length > 0) {
      return NextResponse.json({ columns: orgColumns, inherited: false })
    }
    const globalColumns = await listGlobal(drizzle)
    return NextResponse.json({ columns: globalColumns, inherited: true })
  }

  const globalColumns = await listGlobal(drizzle)
  return NextResponse.json({ columns: globalColumns, inherited: false })
}

// POST /api/admin/kanban-columns
// Three modes:
//   { cloneFromGlobal: true, orgId }  - copy-on-write: clone the global set for
//                                       one client (no-op if the org already
//                                       has columns). Returns the org set.
//   { seedDefaults: true }            - install the default global board when
//                                       the table is empty. Returns the set.
//   { label, ... }                    - create a single column.
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    cloneFromGlobal?: boolean
    seedDefaults?: boolean
    orgId?: string
    label?: string
    statusValue?: string
    colour?: string
    position?: number
  }

  const database = await db()
  const drizzle = database as Drizzle
  const now = new Date().toISOString()

  if (body.cloneFromGlobal) {
    if (!body.orgId) {
      return NextResponse.json({ error: 'orgId is required to clone' }, { status: 400 })
    }
    const existing = await listForOrg(drizzle, body.orgId)
    if (existing.length > 0) {
      return NextResponse.json({ columns: existing })
    }
    const globalColumns = await listGlobal(drizzle)
    if (globalColumns.length === 0) {
      return NextResponse.json({ columns: [] })
    }
    const clones = globalColumns.map(c => ({
      id: crypto.randomUUID(),
      orgId: body.orgId as string,
      label: c.label,
      statusValue: c.statusValue,
      colour: c.colour,
      position: c.position,
      isDefault: 0,
      createdAt: now,
      updatedAt: now,
    }))
    await drizzle.insert(schema.kanbanColumns).values(clones)
    const columns = await listForOrg(drizzle, body.orgId)
    return NextResponse.json({ columns }, { status: 201 })
  }

  if (body.seedDefaults) {
    const existing = await listGlobal(drizzle)
    if (existing.length > 0) {
      return NextResponse.json({ columns: existing })
    }
    const seeds = DEFAULT_COLUMNS.map((c, i) => ({
      id: crypto.randomUUID(),
      orgId: null,
      label: c.label,
      statusValue: c.statusValue,
      colour: c.colour,
      position: i,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    }))
    await drizzle.insert(schema.kanbanColumns).values(seeds)
    const columns = await listGlobal(drizzle)
    return NextResponse.json({ columns }, { status: 201 })
  }

  if (!body.label?.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  await drizzle.insert(schema.kanbanColumns).values({
    id,
    orgId: body.orgId ?? null,
    label: body.label.trim(),
    statusValue: body.statusValue?.trim() || slugStatus(body.label),
    colour: body.colour ?? null,
    position: body.position ?? 0,
    isDefault: 0,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

// PATCH /api/admin/kanban-columns - bulk reorder
// Body: { positions: [{ id, position }] }
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    positions?: Array<{ id?: string; position?: number }>
  }

  const pairs = (body.positions ?? []).filter(
    (p): p is { id: string; position: number } =>
      typeof p.id === 'string' && typeof p.position === 'number',
  )
  if (pairs.length === 0) {
    return NextResponse.json({ error: 'positions is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle
  const now = new Date().toISOString()

  // Only touch rows that actually exist; ignore stale ids from a racing edit.
  const existing = await drizzle
    .select({ id: schema.kanbanColumns.id })
    .from(schema.kanbanColumns)
    .where(inArray(schema.kanbanColumns.id, pairs.map(p => p.id)))
  const known = new Set(existing.map(r => r.id))

  for (const p of pairs) {
    if (!known.has(p.id)) continue
    await drizzle
      .update(schema.kanbanColumns)
      .set({ position: p.position, updatedAt: now })
      .where(eq(schema.kanbanColumns.id, p.id))
  }

  return NextResponse.json({ success: true })
}
