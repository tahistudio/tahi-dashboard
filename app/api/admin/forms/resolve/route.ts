import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// GET /api/admin/forms/resolve?category=design&orgId=xxx
// Resolves the most specific form for a category + org combination.
// Priority (most specific wins):
//   1. org-specific form for this category
//   2. org-specific global form (no category)
//   3. category global form (no orgId)
//   4. global default form (isDefault=1, no category, no orgId)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Fetch all forms (the table should not be huge)
  const allForms = await drizzle
    .select()
    .from(schema.requestForms)

  type FormRow = typeof allForms[number]
  let resolved: FormRow | null = null

  // Priority 1: org + category match
  if (filterOrgId && category) {
    resolved = allForms.find(f => f.orgId === filterOrgId && f.category === category) ?? null
  }

  // Priority 2: org global (no category)
  if (!resolved && filterOrgId) {
    resolved = allForms.find(f => f.orgId === filterOrgId && !f.category) ?? null
  }

  // Priority 3: category global (no orgId)
  if (!resolved && category) {
    resolved = allForms.find(f => !f.orgId && f.category === category) ?? null
  }

  // Priority 4: global default
  if (!resolved) {
    resolved = allForms.find(f => !f.orgId && !f.category && f.isDefault === 1) ?? null
  }

  if (!resolved) {
    return NextResponse.json({ form: null })
  }

  let questions: unknown = []
  try {
    questions = JSON.parse(resolved.questions)
  } catch {
    questions = []
  }

  return NextResponse.json({
    form: {
      id: resolved.id,
      name: resolved.name,
      category: resolved.category,
      orgId: resolved.orgId,
      questions,
    },
  })
}
