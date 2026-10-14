import { requireAdmin } from '@/lib/require-admin'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, sql } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface XeroContact {
  ContactID: string
  Name: string
  EmailAddress?: string
  ContactStatus: string
}

// GET /api/admin/integrations/xero/match-contacts
// Returns Xero contacts with suggested dashboard org matches
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const database = await db() as unknown as D1

  const xeroData = await callXeroAPI<{ Contacts: XeroContact[] }>(
    'GET',
    '/Contacts?where=ContactStatus%3D%3D%22ACTIVE%22&order=Name',
  )

  if (!xeroData?.Contacts) {
    return NextResponse.json({ error: 'Failed to fetch contacts from Xero' }, { status: 502 })
  }

  const allOrgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name, xeroContactId: schema.organisations.xeroContactId })
    .from(schema.organisations)

  const matches = xeroData.Contacts.map(xc => {
    // Already linked?
    const linked = allOrgs.find(o => o.xeroContactId?.trim().toLowerCase() === xc.ContactID.trim().toLowerCase())
    if (linked) {
      return {
        xeroContactId: xc.ContactID,
        xeroName: xc.Name,
        xeroEmail: xc.EmailAddress ?? null,
        matchedOrgId: linked.id,
        matchedOrgName: linked.name,
        confidence: 'linked' as const,
      }
    }

    // Fuzzy name match
    const xName = xc.Name.toLowerCase()
    const nameMatch = allOrgs.find(o => {
      const oName = o.name.toLowerCase()
      return oName === xName || xName.includes(oName) || oName.includes(xName)
    })

    return {
      xeroContactId: xc.ContactID,
      xeroName: xc.Name,
      xeroEmail: xc.EmailAddress ?? null,
      matchedOrgId: nameMatch?.id ?? null,
      matchedOrgName: nameMatch?.name ?? null,
      confidence: nameMatch ? ('suggested' as const) : ('unmatched' as const),
    }
  })

  return NextResponse.json({ matches })
}

// PATCH /api/admin/integrations/xero/match-contacts
// Confirm a match: link Xero contact to dashboard org
export async function PATCH(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const body = await req.json() as { orgId?: unknown; xeroContactId?: unknown; replace?: unknown } | null
  if (typeof body?.orgId !== 'string' || !body.orgId || typeof body.xeroContactId !== 'string') {
    return NextResponse.json({ error: 'orgId and xeroContactId required' }, { status: 400 })
  }
  const xeroContactId = body.xeroContactId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(xeroContactId)) {
    return NextResponse.json({ error: 'xeroContactId must be a valid UUID.' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const [org] = await database.select({ id: schema.organisations.id, xeroContactId: schema.organisations.xeroContactId })
    .from(schema.organisations).where(eq(schema.organisations.id, body.orgId)).limit(1)
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  if (org.xeroContactId && org.xeroContactId.trim().toLowerCase() !== xeroContactId && body.replace !== true) {
    return NextResponse.json({ error: 'This client already has a different Xero contact. Confirm replacing the current link and send replace: true.' }, { status: 409 })
  }

  // Claim the contact in one statement so concurrent confirmations cannot
  // link the same Xero identity to different clients or replace a changed link.
  const linked = await database.update(schema.organisations).set({
    xeroContactId,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(schema.organisations.id, body.orgId),
    org.xeroContactId === null ? sql`${schema.organisations.xeroContactId} IS NULL` : eq(schema.organisations.xeroContactId, org.xeroContactId),
    sql`NOT EXISTS (SELECT 1 FROM organisations AS linked WHERE lower(linked.xero_contact_id) = ${xeroContactId} AND linked.id <> ${body.orgId})`,
  )).returning({ id: schema.organisations.id })
  if (!linked.length) {
    const [current] = await database.select({ xeroContactId: schema.organisations.xeroContactId })
      .from(schema.organisations).where(eq(schema.organisations.id, body.orgId)).limit(1)
    const error = !current || current.xeroContactId !== org.xeroContactId
      ? 'The current Xero contact link changed. Reload the client and confirm the link again.'
      : 'This Xero contact is already linked to another client.'
    return NextResponse.json({ error }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
