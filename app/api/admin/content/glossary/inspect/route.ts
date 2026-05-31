/**
 * GET /api/admin/content/glossary/inspect
 *
 * Diagnostic. Returns the full field-definition list for the Glossaries
 * Webflow collection plus 3 sample items (with all their fieldData) so
 * we can see exactly what's available before adapting the publish +
 * backfill + schema-gen code.
 *
 * Also surfaces Webflow's built-in item-level timestamps (lastPublished,
 * lastUpdated, createdOn) so we know whether to use those vs. custom
 * date fields.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  getGlossaryCollectionId, getCollectionSchema, listCollectionItems,
} from '@/lib/webflow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const collectionId = await getGlossaryCollectionId()
    const [fields, page] = await Promise.all([
      getCollectionSchema(collectionId),
      listCollectionItems(collectionId, { limit: 3 }),
    ])
    const sampleItems = page.items.map(it => ({
      id: it.id,
      lastPublished: it.lastPublished ?? null,
      lastUpdated: it.lastUpdated ?? null,
      createdOn: it.createdOn ?? null,
      isDraft: it.isDraft ?? false,
      isArchived: it.isArchived ?? false,
      fieldDataKeys: Object.keys(it.fieldData).sort(),
      fieldDataSample: Object.fromEntries(
        Object.entries(it.fieldData).map(([k, v]) => {
          const display = typeof v === 'string'
            ? (v.length > 200 ? v.slice(0, 200) + '... (truncated)' : v)
            : v
          return [k, display]
        }),
      ),
    }))
    return NextResponse.json({
      collectionId,
      itemCount: page.total,
      fieldCount: fields.length,
      fields: fields.map(f => ({
        slug: f.slug,
        displayName: f.displayName,
        type: f.type,
        required: f.isRequired ?? false,
      })),
      sampleItems,
      builtInTimestamps: {
        note: 'Webflow gives lastPublished, lastUpdated, createdOn as item-level metadata on every item. Use these for dateModified / datePublished in schema instead of custom Date fields.',
      },
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message.slice(0, 400) : 'unknown',
    }, { status: 500 })
  }
}
