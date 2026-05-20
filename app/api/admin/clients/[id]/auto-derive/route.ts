import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import {
  applyBillingDerivation,
  clearManualOverrides,
} from '@/lib/billing-derivation'

type AnyDb = Parameters<typeof applyBillingDerivation>[0]

/**
 * POST /api/admin/clients/[id]/auto-derive
 *
 * Re-derives billing model + retainer dates for a single client from the
 * current observable signals. Skips fields where `*_is_manual` is 1 unless
 * the request body asks to reset overrides first.
 *
 * Body (optional):
 *   { clearOverrides?: { billingModel?: boolean; retainerDates?: boolean; customMrr?: boolean } }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = (await db()) as unknown as AnyDb

  let body: { clearOverrides?: { billingModel?: boolean; retainerDates?: boolean; customMrr?: boolean } } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  if (body.clearOverrides) {
    await clearManualOverrides(database, id, body.clearOverrides)
  }

  const result = await applyBillingDerivation(database, id)
  return NextResponse.json(result)
}
