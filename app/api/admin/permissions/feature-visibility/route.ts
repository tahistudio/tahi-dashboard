import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'
import { isFeatureKey } from '@/lib/feature-tree'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const SUBJECT_TYPES = new Set(['role', 'team_member', 'organisation', 'contact'])

// GET /api/admin/permissions/feature-visibility?subjectType=&subjectId=
// List the overrides for one subject. Admin+ only.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied

  const url = new URL(req.url)
  const subjectType = url.searchParams.get('subjectType')
  const subjectId = url.searchParams.get('subjectId')
  if (!subjectType || !subjectId || !SUBJECT_TYPES.has(subjectType)) {
    return NextResponse.json({ error: 'subjectType + subjectId required' }, { status: 400 })
  }

  const rows = await drizzle
    .select({
      id: schema.featureVisibility.id,
      featureKey: schema.featureVisibility.featureKey,
      effect: schema.featureVisibility.effect,
      reason: schema.featureVisibility.reason,
      updatedAt: schema.featureVisibility.updatedAt,
    })
    .from(schema.featureVisibility)
    .where(and(
      eq(schema.featureVisibility.subjectType, subjectType),
      eq(schema.featureVisibility.subjectId, subjectId),
    ))

  return NextResponse.json({ overrides: rows })
}

// PUT /api/admin/permissions/feature-visibility
// Upsert one override { subjectType, subjectId, featureKey, effect, reason }.
// Admin+ only. effect 'inherit' (or omitted) clears the override (back to default).
export async function PUT(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const drizzle = (await db()) as unknown as D1
  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  // Feature-gate: only super-admins (un-lockable) or a subject explicitly granted
  // the permissions builder may mutate feature-visibility overrides.
  const featureDenied = await requireFeature(auth, 'settings.permissions')
  if (featureDenied) return featureDenied

  const body = await req.json() as {
    subjectType?: string; subjectId?: string; featureKey?: string
    effect?: 'allow' | 'deny' | 'inherit'; reason?: string | null
  }
  const { subjectType, subjectId, featureKey, effect, reason } = body
  if (!subjectType || !subjectId || !featureKey || !SUBJECT_TYPES.has(subjectType)) {
    return NextResponse.json({ error: 'subjectType, subjectId, featureKey required' }, { status: 400 })
  }
  if (!isFeatureKey(featureKey)) {
    return NextResponse.json({ error: 'Unknown featureKey' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Capture the current (before) override for the audit trail.
  const [prev] = await drizzle
    .select({
      effect: schema.featureVisibility.effect,
      reason: schema.featureVisibility.reason,
    })
    .from(schema.featureVisibility)
    .where(and(
      eq(schema.featureVisibility.subjectType, subjectType),
      eq(schema.featureVisibility.subjectId, subjectId),
      eq(schema.featureVisibility.featureKey, featureKey),
    ))
    .limit(1)
  const before = {
    effect: prev?.effect ?? 'inherit',
    reason: prev?.reason ?? null,
  }

  // 'inherit' (or no effect) = clear the override -> back to the default.
  if (!effect || effect === 'inherit') {
    await drizzle.delete(schema.featureVisibility).where(and(
      eq(schema.featureVisibility.subjectType, subjectType),
      eq(schema.featureVisibility.subjectId, subjectId),
      eq(schema.featureVisibility.featureKey, featureKey),
    ))
    await logAudit(drizzle as unknown as DB, {
      action: 'permission.feature_override_cleared',
      userId: auth.userId,
      entityType: subjectType,
      entityId: subjectId,
      metadata: {
        featureKey,
        before,
        after: { effect: 'inherit', reason: null },
      },
    })
    return NextResponse.json({ ok: true, effect: 'inherit' })
  }

  if (effect !== 'allow' && effect !== 'deny') {
    return NextResponse.json({ error: 'effect must be allow | deny | inherit' }, { status: 400 })
  }

  const nextReason = reason?.trim() || null

  // Upsert: delete-then-insert (the unique index guarantees one row per subject+feature).
  await drizzle.delete(schema.featureVisibility).where(and(
    eq(schema.featureVisibility.subjectType, subjectType),
    eq(schema.featureVisibility.subjectId, subjectId),
    eq(schema.featureVisibility.featureKey, featureKey),
  ))
  await drizzle.insert(schema.featureVisibility).values({
    id: crypto.randomUUID(),
    subjectType, subjectId, featureKey, effect,
    reason: nextReason,
    createdById: auth.userId,
    createdAt: now,
    updatedAt: now,
  })

  await logAudit(drizzle as unknown as DB, {
    action: 'permission.feature_override_set',
    userId: auth.userId,
    entityType: subjectType,
    entityId: subjectId,
    metadata: {
      featureKey,
      before,
      after: { effect, reason: nextReason },
    },
  })

  return NextResponse.json({ ok: true, effect })
}
