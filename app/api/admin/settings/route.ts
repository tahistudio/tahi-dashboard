import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// -- GET /api/admin/settings --
// Returns all settings as key-value pairs.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const rows = await database
    .select()
    .from(schema.settings)

  const settings: Record<string, string | null> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }

  return NextResponse.json({ settings })
}

// -- PATCH /api/admin/settings --
// Upsert a single setting key-value pair.
// Body: { key, value }
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    key?: string
    value?: string
  }

  if (!body.key?.trim()) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()

  // Check if key exists
  const existing = await database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, body.key))
    .limit(1)

  if (existing.length > 0) {
    await database
      .update(schema.settings)
      .set({ value: body.value ?? null, updatedAt: now })
      .where(eq(schema.settings.key, body.key))
  } else {
    await database.insert(schema.settings).values({
      key: body.key,
      value: body.value ?? null,
      updatedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}
