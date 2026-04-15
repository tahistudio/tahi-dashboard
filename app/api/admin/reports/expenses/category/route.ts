import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * PATCH /api/admin/reports/expenses/category
 *
 * Edit metadata for an expense category across ALL months.
 * Body: { accountName: string, isRecurring?: boolean, newAccountName?: string }
 *
 * Why all months? Because the category aggregation in the FE groups by
 * accountName. Setting recurring on one month and not another would be
 * inconsistent. The user is saying "this category is/isn't recurring",
 * which is a per-category fact, not per-month.
 *
 * If newAccountName is provided, all rows with the matching accountName
 * are renamed (useful for cleaning up Xero category names).
 *
 * Note: the next sync-pnl will re-run the auto-recurring detection,
 * which may overwrite the manual flag. To prevent that, we'd need a
 * separate `category_overrides` table — logged as follow-up T630.
 */
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    accountName?: string
    isRecurring?: boolean
    newAccountName?: string
  }

  if (!body.accountName) {
    return NextResponse.json({ error: 'accountName is required' }, { status: 400 })
  }

  if (body.isRecurring === undefined && body.newAccountName === undefined) {
    return NextResponse.json({ error: 'At least one of isRecurring or newAccountName must be set' }, { status: 400 })
  }

  const drizzle = (await db()) as D1

  const updates: Record<string, unknown> = {}
  if (body.isRecurring !== undefined) updates.isRecurring = body.isRecurring
  if (body.newAccountName !== undefined && body.newAccountName.trim()) {
    updates.accountName = body.newAccountName.trim()
  }

  await drizzle
    .update(schema.xeroExpenseCategories)
    .set(updates)
    .where(eq(schema.xeroExpenseCategories.accountName, body.accountName))

  return NextResponse.json({ success: true })
}
