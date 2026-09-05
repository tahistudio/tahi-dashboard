import { NextRequest, NextResponse } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, isNull } from 'drizzle-orm'

// GET /api/portal/request-forms?category=design
// Returns the resolved intake form for the authenticated org and optional category.
// Resolution priority (most specific wins):
// 1. Org-specific form for this category
// 2. Org-specific global form (no category)
// 3. Category global form (no org)
// 4. Global default form (no org, no category, isDefault=1)
export async function GET(req: NextRequest) {
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied

  const url = new URL(req.url)
  const category = url.searchParams.get('category') ?? null

  const database = await db()

  // Try org-specific + category
  if (category) {
    const orgCatForms = await database
      .select()
      .from(schema.requestForms)
      .where(and(eq(schema.requestForms.orgId, orgId), eq(schema.requestForms.category, category)))
      .limit(1)
    if (orgCatForms.length > 0) {
      return NextResponse.json({ form: parseForm(orgCatForms[0]) })
    }
  }

  // Try org-specific global (no category)
  const orgGlobalForms = await database
    .select()
    .from(schema.requestForms)
    .where(and(eq(schema.requestForms.orgId, orgId), isNull(schema.requestForms.category)))
    .limit(1)
  if (orgGlobalForms.length > 0) {
    return NextResponse.json({ form: parseForm(orgGlobalForms[0]) })
  }

  // Try category global (no org)
  if (category) {
    const catForms = await database
      .select()
      .from(schema.requestForms)
      .where(and(isNull(schema.requestForms.orgId), eq(schema.requestForms.category, category)))
      .limit(1)
    if (catForms.length > 0) {
      return NextResponse.json({ form: parseForm(catForms[0]) })
    }
  }

  // Try global default
  const defaultForms = await database
    .select()
    .from(schema.requestForms)
    .where(and(isNull(schema.requestForms.orgId), isNull(schema.requestForms.category), eq(schema.requestForms.isDefault, 1)))
    .limit(1)
  if (defaultForms.length > 0) {
    return NextResponse.json({ form: parseForm(defaultForms[0]) })
  }

  // No form found
  return NextResponse.json({ form: null })
}

/**
 * The resolved form, as the caller reads it.
 *
 * `sla` and `description` used to be dropped here. `sla` is the only
 * human-authored turnaround signal in the schema ("2 business days", written
 * on the form in admin settings), so dropping it meant no surface could ever
 * read it: the client dialog could not show the agreed turnaround, and
 * predictive autofill could not let it outrank a statistical median. Both are
 * additive fields on the response; nothing that reads `questions` changes.
 */
function parseForm(row: typeof schema.requestForms.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    sla: row.sla,
    questions: JSON.parse(row.questions ?? '[]'),
  }
}
