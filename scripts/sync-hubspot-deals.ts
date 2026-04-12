import { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { schema } from '../db/d1'
import { eq } from 'drizzle-orm'

/**
 * One-time HubSpot deal import script
 * Run with: npx tsx scripts/sync-hubspot-deals.ts
 * Requires: HUBSPOT_API_KEY and DATABASE_URL env vars
 */

async function syncHubSpotDeals() {
  const hubspotKey = process.env.HUBSPOT_API_KEY
  const databaseUrl = process.env.DATABASE_URL

  if (!hubspotKey) {
    console.error('❌ HUBSPOT_API_KEY env var not set')
    process.exit(1)
  }

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL env var not set')
    process.exit(1)
  }

  console.log('🔄 Starting HubSpot deal import...\n')

  try {
    // Fetch deals from HubSpot
    console.log('📥 Fetching deals from HubSpot...')
    const hubspotResponse = await fetch('https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,hubspot_owner_id,closedate,notes', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${hubspotKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!hubspotResponse.ok) {
      console.error(`❌ HubSpot API error: ${hubspotResponse.status}`)
      process.exit(1)
    }

    const hubspotData = await hubspotResponse.json() as any
    console.log(`✅ Fetched ${hubspotData.results?.length || 0} deals from HubSpot\n`)

    // Note: We're outputting this data for manual review
    console.log('📋 Deal data to import:')
    console.log(JSON.stringify(hubspotData.results || [], null, 2))
    console.log('\n⚠️  To complete the import:')
    console.log('1. Copy the above deal data')
    console.log('2. Use the dashboard MCP tools to create deals manually')
    console.log('3. Or deploy the sync endpoint at /api/admin/integrations/hubspot/sync-deals')
  } catch (err) {
    console.error('❌ Sync failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

syncHubSpotDeals()
