/**
 * POST /api/admin/content/drafts/[id]/repair-schema
 *
 * Auto-fix endpoint for the publish-time schema validation gate.
 * Re-runs finalizeWebflowFields() which rebuilds the JSON-LD from the
 * draft's current title/body/faqs/category state and re-validates.
 *
 * Most validation errors come from stale schema markup left over from
 * an earlier revision (e.g. orphaned faqs, mismatched URL after a
 * title rename, missing fields the generator now requires). Re-running
 * the deterministic generator fixes those without touching the body.
 *
 * If errors remain after rebuild, returns them so the UI can show what
 * couldn't be fixed automatically — that means the generator itself is
 * producing invalid output and we need a code-side fix, not a per-draft
 * patch.
 *
 * Contract:
 *   POST { } (id from URL)
 *   200: { ok: true, errorsBefore, errorsAfter, fixed, remaining }
 *   422: { ok: false, remaining: [...] } when errors persist
 *   404: { error } when draft missing
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { finalizeWebflowFields } from '@/lib/blog-finalize'
import { validateJsonLd } from '@/lib/schema-validate'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(_req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const [before] = await database
    .select({ schemaJsonLd: schema.contentDrafts.schemaJsonLd })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!before) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  const before422 = validateJsonLd(before.schemaJsonLd ?? '')
  const errorsBefore = before422.errors.length

  let finalizeError: string | null = null
  try {
    await finalizeWebflowFields(database, id)
  } catch (err) {
    finalizeError = err instanceof Error ? err.message : String(err)
  }

  const [after] = await database
    .select({ schemaJsonLd: schema.contentDrafts.schemaJsonLd })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  const after422 = validateJsonLd(after?.schemaJsonLd ?? '')
  const errorsAfter = after422.errors.length
  const fixed = Math.max(0, errorsBefore - errorsAfter)

  // Filter out the missing-image error since cover gets backfilled at
  // publish — same logic as the publish gate uses for draft mode.
  const remaining = after422.errors.filter(e => !/image/i.test(e.field) && !/image/i.test(e.message))

  if (remaining.length === 0) {
    return NextResponse.json({
      ok: true,
      errorsBefore,
      errorsAfter,
      fixed,
      remaining: [],
      finalizeError,
    })
  }

  return NextResponse.json({
    ok: false,
    errorsBefore,
    errorsAfter,
    fixed,
    remaining,
    finalizeError,
    message: `Auto-fix resolved ${fixed} of ${errorsBefore} errors. ${remaining.length} need a code-side fix.`,
  }, { status: 422 })
}
