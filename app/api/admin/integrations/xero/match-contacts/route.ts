import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    const linked = allOrgs.find(o => o.xeroContactId === xc.ContactID)
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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { orgId: string; xeroContactId: string }
  if (!body.orgId || !body.xeroContactId) {
    return NextResponse.json({ error: 'orgId and xeroContactId required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  await database.update(schema.organisations).set({
    xeroContactId: body.xeroContactId,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.organisations.id, body.orgId))

  return NextResponse.json({ ok: true })
}
