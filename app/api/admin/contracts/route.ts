import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, count, sql, inArray } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Substitute {{variable}} placeholders in a template body using the given
 * values. Missing variables render as the literal placeholder so admins
 * notice. HTML-escape the values to prevent injection — the bodyHtml is
 * rendered via dangerouslySetInnerHTML for signers, so we trust the
 * template HTML but NOT the variable values themselves.
 */
function substituteVariables(bodyHtml: string, values: Record<string, string>): string {
  function escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
  return bodyHtml.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const v = values[key]
    return v != null ? escape(v) : match
  })
}

// GET /api/admin/contracts/documents — list, filter by orgId/dealId/status
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const filterOrg = url.searchParams.get('orgId')
  const filterDeal = url.searchParams.get('dealId')
  const filterStatus = url.searchParams.get('status')
  const database = await db() as unknown as D1
  const conditions = []
  if (filterOrg) conditions.push(eq(schema.contractDocuments.orgId, filterOrg))
  if (filterDeal) conditions.push(eq(schema.contractDocuments.dealId, filterDeal))
  if (filterStatus) conditions.push(eq(schema.contractDocuments.status, filterStatus))
  const items = await database
    .select({
      id: schema.contractDocuments.id,
      orgId: schema.contractDocuments.orgId,
      dealId: schema.contractDocuments.dealId,
      proposalId: schema.contractDocuments.proposalId,
      type: schema.contractDocuments.type,
      name: schema.contractDocuments.name,
      status: schema.contractDocuments.status,
      publicShareToken: schema.contractDocuments.publicShareToken,
      sentAt: schema.contractDocuments.sentAt,
      signedAt: schema.contractDocuments.signedAt,
      expiresAt: schema.contractDocuments.expiresAt,
      createdAt: schema.contractDocuments.createdAt,
      updatedAt: schema.contractDocuments.updatedAt,
      orgName: schema.organisations.name,
    })
    .from(schema.contractDocuments)
    .leftJoin(schema.organisations, eq(schema.contractDocuments.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.contractDocuments.updatedAt))

  // Signer progress per contract for the homepage card: one grouped count over
  // contract_signers (NOT N+1). Each contract gets signedCount + totalSigners.
  // Wrapped so a missing signers table never breaks the existing list shape.
  const signedMap = new Map<string, number>()
  const totalMap = new Map<string, number>()
  const contractIds = items.map(i => i.id)
  if (contractIds.length) {
    try {
      const counts = await database
        .select({
          contractId: schema.contractSigners.contractId,
          total: count(),
          signed: sql<number>`SUM(CASE WHEN ${schema.contractSigners.status} = 'signed' THEN 1 ELSE 0 END)`,
        })
        .from(schema.contractSigners)
        .where(inArray(schema.contractSigners.contractId, contractIds))
        .groupBy(schema.contractSigners.contractId)
      for (const row of counts) {
        totalMap.set(row.contractId, row.total)
        signedMap.set(row.contractId, Number(row.signed ?? 0))
      }
    } catch {
      // contract_signers table missing — fall through to zeroed counts.
    }
  }

  const withSigners = items.map(item => ({
    ...item,
    signedCount: signedMap.get(item.id) ?? 0,
    totalSigners: totalMap.get(item.id) ?? 0,
  }))

  return NextResponse.json({ items: withSigners })
}

// POST /api/admin/contracts/documents — create from template (or raw HTML)
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    orgId?: string | null
    dealId?: string | null
    proposalId?: string | null
    templateId?: string | null
    type?: string
    name?: string
    bodyHtml?: string
    variableValues?: Record<string, string>
    expiresAt?: string
    /** Optional initial signers to seed. */
    signers?: Array<{
      role: string
      name: string
      email: string
      position?: number
    }>
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const database = await db() as unknown as D1

  // If templateId given, load template + substitute variables to render
  // the final bodyHtml.
  let resolvedBodyHtml = body.bodyHtml ?? ''
  let resolvedType = body.type
  if (body.templateId) {
    const [tpl] = await database
      .select()
      .from(schema.contractTemplates)
      .where(eq(schema.contractTemplates.id, body.templateId))
      .limit(1)
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    resolvedType = resolvedType ?? tpl.type
    resolvedBodyHtml = substituteVariables(tpl.bodyHtml, body.variableValues ?? {})
  }

  if (!resolvedType) return NextResponse.json({ error: 'type required' }, { status: 400 })
  if (!resolvedBodyHtml) return NextResponse.json({ error: 'bodyHtml required' }, { status: 400 })

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.contractDocuments).values({
    id,
    orgId: body.orgId ?? null,
    dealId: body.dealId ?? null,
    proposalId: body.proposalId ?? null,
    templateId: body.templateId ?? null,
    type: resolvedType,
    name: body.name.trim(),
    status: 'draft',
    bodyHtml: resolvedBodyHtml,
    variableValues: body.variableValues ? JSON.stringify(body.variableValues) : null,
    expiresAt: body.expiresAt ?? null,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Seed signers if provided.
  if (body.signers?.length) {
    const seeded = body.signers.map((s, idx) => ({
      id: crypto.randomUUID(),
      contractId: id,
      role: s.role,
      name: s.name.trim(),
      email: s.email.trim(),
      position: s.position ?? idx,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }))
    // Each row has 9 columns → batch of 11 max; keep at 9 to stay safe.
    const CHUNK = 9
    for (let i = 0; i < seeded.length; i += CHUNK) {
      await database.insert(schema.contractSigners).values(seeded.slice(i, i + CHUNK))
    }
  }

  return NextResponse.json({ id }, { status: 201 })
}
