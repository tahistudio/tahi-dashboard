import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/integrations/hubspot
 * Stub: accepts contact data and logs the intent.
 * Full HubSpot API integration pending API key configuration.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    contactName?: string
    contactEmail?: string
    orgName?: string
  }

  const { contactName, contactEmail, orgName } = body

  if (!contactName || !contactEmail) {
    return NextResponse.json(
      { error: 'contactName and contactEmail are required' },
      { status: 400 },
    )
  }

  // Stub: in production this would call the HubSpot API to create/update a contact
  const apiKey = process.env.HUBSPOT_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      success: true,
      message: 'HubSpot integration pending API key configuration',
      data: { contactName, contactEmail, orgName: orgName ?? null },
    })
  }

  // Future: POST to HubSpot Contacts API
  return NextResponse.json({
    success: true,
    message: 'HubSpot contact sync queued',
    data: { contactName, contactEmail, orgName: orgName ?? null },
  })
}
