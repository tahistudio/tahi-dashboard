import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/portal/profile
 * Returns the contact record for the current user within their org.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [contact] = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      role: schema.contacts.role,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(and(
      eq(schema.contacts.orgId, orgId),
      eq(schema.contacts.clerkUserId, userId),
    ))
    .limit(1)

  if (!contact) {
    // Return basic info from Clerk user id
    return NextResponse.json({
      contact: null,
      orgId,
    })
  }

  return NextResponse.json({ contact, orgId })
}

/**
 * PATCH /api/portal/profile
 * Update the current user's contact info (name, role).
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    role?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(
      eq(schema.contacts.orgId, orgId),
      eq(schema.contacts.clerkUserId, userId),
    ))
    .limit(1)

  if (!contact) {
    return NextResponse.json({ error: 'Contact record not found' }, { status: 404 })
  }

  const updates: Record<string, string> = {}
  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.role !== undefined) updates.role = body.role?.trim() ?? ''

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await drizzle
    .update(schema.contacts)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.contacts.id, contact.id))

  return NextResponse.json({ success: true })
}
