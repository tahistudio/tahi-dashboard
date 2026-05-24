import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/leads/[id] ──────────────────────────────────────────────
// Returns the lead + denormalised owner + the activity timeline.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const leadRows = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  const lead = leadRows[0]

  let ownerName: string | null = null
  let ownerAvatarUrl: string | null = null
  if (lead.ownerId) {
    const tm = await database
      .select({ name: schema.teamMembers.name, avatarUrl: schema.teamMembers.avatarUrl })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, lead.ownerId))
      .limit(1)
    if (tm.length > 0) {
      ownerName = tm[0].name
      ownerAvatarUrl = tm[0].avatarUrl
    }
  }

  const activityRows = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      createdById: schema.activities.createdById,
      createdAt: schema.activities.createdAt,
      authorName: schema.teamMembers.name,
      authorAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.activities)
    .leftJoin(schema.teamMembers, eq(schema.activities.createdById, schema.teamMembers.id))
    .where(eq(schema.activities.leadId, id))
  const activities = activityRows

  // Pull the always-ask discovery questions template (3 strings) so
  // the UI can render them next to the AI-generated ones in one shot.
  const [templateRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.discoveryQuestionsTemplate'))
    .limit(1)
  let discoveryQuestionsTemplate: string[] = []
  if (templateRow?.value) {
    try {
      const parsed = JSON.parse(templateRow.value)
      if (Array.isArray(parsed)) {
        discoveryQuestionsTemplate = parsed.filter((q: unknown): q is string => typeof q === 'string')
      }
    } catch {
      // fall through — template stays empty
    }
  }

  return NextResponse.json({
    lead: { ...lead, ownerName, ownerAvatarUrl },
    activities: activities.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    discoveryQuestionsTemplate,
  })
}

// ── PATCH /api/admin/leads/[id] ─────────────────────────────────────────────
// Updates any subset of: name, email, phone, company, jobTitle,
// website, source, sourceDetail, brief, estimatedValue, currency,
// status, archiveReason, ownerId. The denormalised name/email/phone
// on the lead row stays in sync with the canonical person row.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const database = await db()

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const existingRows = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)
  if (existingRows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  const existing = existingRows[0]

  const updates: Record<string, string | number | boolean | null> = {}
  const stringFields = [
    'name', 'email', 'phone', 'company', 'jobTitle', 'website',
    'source', 'sourceDetail', 'affiliateCode', 'brief', 'currency',
    'status', 'archiveReason', 'ownerId',
  ] as const
  for (const f of stringFields) {
    if (f in body) {
      const v = body[f]
      updates[f] = typeof v === 'string' ? (v.trim() || null) : (v === null ? null : (updates[f] ?? null))
    }
  }
  if ('estimatedValue' in body) {
    const v = body.estimatedValue
    updates.estimatedValue = typeof v === 'number' ? v : (v === null ? null : null)
  }
  // "Don't ask again" for the re-enrichment prompt. Client toggles this
  // when Liam dismisses the confirm dialog with the don't-ask option.
  if ('enrichRepromptSuppressed' in body) {
    updates.enrichRepromptSuppressed = !!body.enrichRepromptSuppressed
  }

  // If status flips to 'archived' we record the time so reports can
  // show "archived 3 weeks ago". `archived_at` lives on the activity
  // stream — we don't have a column for it on leads itself.
  const becomesArchived = updates.status === 'archived' && existing.status !== 'archived'

  // If the email changes, route the lead's personId to a (possibly
  // different) canonical person row via lookup-or-create.
  let newPersonId: string | null = null
  if ('email' in body && typeof updates.email === 'string' && updates.email !== existing.email) {
    newPersonId = await lookupOrCreatePerson(database, {
      fullName: typeof updates.name === 'string' ? updates.name : existing.name,
      email: updates.email,
      phone: typeof updates.phone === 'string' ? updates.phone : existing.phone,
    })
  }

  if (Object.keys(updates).length === 0 && !newPersonId) {
    return NextResponse.json({ ok: true })
  }

  await database
    .update(schema.leads)
    .set({
      ...updates,
      ...(newPersonId ? { personId: newPersonId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.leads.id, id))

  if (becomesArchived) {
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_archived',
      title: `Lead archived${typeof updates.archiveReason === 'string' ? `: ${updates.archiveReason}` : ''}`,
      description: typeof updates.archiveReason === 'string' ? updates.archiveReason : null,
      leadId: id,
      createdById: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  // Status change activity (any transition except → archived which is
  // already covered above with the archive-specific row).
  const statusChanged = typeof updates.status === 'string' && updates.status !== existing.status
  if (statusChanged && !becomesArchived) {
    const STATUS_LABELS: Record<string, string> = {
      new: 'New',
      qualifying: 'Qualifying',
      nurturing: 'Nurturing',
      promoted: 'Promoted',
      archived: 'Archived',
    }
    const fromLabel = STATUS_LABELS[existing.status] ?? existing.status
    const toLabel = STATUS_LABELS[String(updates.status)] ?? String(updates.status)
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_status_changed',
      title: `Status changed: ${fromLabel} → ${toLabel}`,
      description: null,
      leadId: id,
      createdById: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return NextResponse.json({ ok: true })
}

// ── DELETE /api/admin/leads/[id] ───────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  await database.delete(schema.leads).where(eq(schema.leads.id, id))
  // activities.lead_id is nullable so they survive the lead delete
  // (kept for the audit trail). Person row is shared, never deleted
  // on a single role removal.
  return NextResponse.json({ ok: true })
}
