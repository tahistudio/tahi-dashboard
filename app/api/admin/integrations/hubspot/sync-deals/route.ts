import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// POST /api/admin/integrations/hubspot/sync-deals
// One-time endpoint to import deals from HubSpot and clear existing test deals
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!process.env.HUBSPOT_API_KEY) {
    return NextResponse.json(
      { error: 'HubSpot API key not configured' },
      { status: 500 }
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  try {
    // Step 1: Fetch all deals from HubSpot
    const hubspotDeals = await fetch('https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,hubspot_owner_id,closedate,notes', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    if (!hubspotDeals.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch deals from HubSpot', status: hubspotDeals.status },
        { status: 500 }
      )
    }

    const hubspotData = await hubspotDeals.json() as any

    // Step 2: Get default lead stage for new deals
    const [leadStage] = await drizzle
      .select()
      .from(schema.pipelineStages)
      .limit(1)

    if (!leadStage) {
      return NextResponse.json(
        { error: 'No pipeline stages found' },
        { status: 500 }
      )
    }

    // Step 3: Clear all existing deals
    const allDeals = await drizzle.select().from(schema.deals)
    const deletedCount = allDeals.length

    for (const deal of allDeals) {
      await drizzle
        .delete(schema.deals)
        .where(eq(schema.deals.id, deal.id))
    }

    // Step 4: Import deals from HubSpot
    let importedCount = 0
    const failedDeals: string[] = []

    for (const hsDeal of hubspotData.results || []) {
      try {
        const properties = hsDeal.properties
        const dealValue = parseInt(properties.amount?.value || '0') / 100

        await drizzle
          .insert(schema.deals)
          .values({
            id: crypto.randomUUID(),
            title: properties.dealname?.value || 'Unnamed Deal',
            stageId: leadStage.id,
            value: dealValue,
            currency: 'USD',
            valueNzd: dealValue,
            source: 'hubspot',
            notes: properties.notes?.value || null,
            expectedCloseDate: properties.closedate?.value
              ? new Date(properties.closedate.value).toISOString()
              : null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })

        importedCount++
      } catch (err) {
        failedDeals.push(hsDeal?.properties?.dealname?.value || 'Unknown')
      }
    }

    return NextResponse.json({
      success: true,
      clearedCount: deletedCount,
      importedCount,
      failedDeals,
      message: `Cleared ${deletedCount} test deals and imported ${importedCount} deals from HubSpot`,
    })
  } catch (err) {
    console.error('HubSpot sync failed:', err)
    return NextResponse.json(
      { error: 'Sync failed', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
