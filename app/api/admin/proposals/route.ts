import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Template snapshot shape — frozen on save, unpacked on create ─────
interface TemplateSection {
  type: string
  title: string | null
  subtitle: string | null
  data: unknown
  position: number
}
interface TemplateVariant {
  name: string
  tagline: string | null
  oneOffAmount: number
  monthlyAmount: number
  currency: string
  scopeHtml: string | null
  pricingNotesHtml: string | null
  ctaLabel: string | null
  isFeatured: number
  position: number
}
interface TemplateSnapshot {
  title?: string | null
  subtitle?: string | null
  sections?: TemplateSection[]
  variants?: TemplateVariant[]
}

// HTML-escape variable values to prevent injection. Template HTML itself
// is admin-authored and trusted; variable VALUES come from a form so are
// escaped before substitution (mirrors contract template variable handling).
function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
function substituteVariables(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const v = values[key]
    return v != null ? htmlEscape(v) : match
  })
}
// Recursively walk a JSON-shape and substitute in any string fields.
function substituteInTree(node: unknown, values: Record<string, string>): unknown {
  if (typeof node === 'string') return substituteVariables(node, values)
  if (Array.isArray(node)) return node.map(n => substituteInTree(n, values))
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = substituteInTree(v, values)
    return out
  }
  return node
}

// ── GET /api/admin/proposals ──────────────────────────────────────────
// List with filters: orgId, dealId, status. Joins org + deal names.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterDealId = url.searchParams.get('dealId')
  const filterStatus = url.searchParams.get('status')

  const database = await db() as unknown as D1
  const conditions = []
  if (filterOrgId) conditions.push(eq(schema.proposals.orgId, filterOrgId))
  if (filterDealId) conditions.push(eq(schema.proposals.dealId, filterDealId))
  if (filterStatus) conditions.push(eq(schema.proposals.status, filterStatus))

  const items = await database
    .select({
      id: schema.proposals.id,
      orgId: schema.proposals.orgId,
      dealId: schema.proposals.dealId,
      title: schema.proposals.title,
      subtitle: schema.proposals.subtitle,
      preparedFor: schema.proposals.preparedFor,
      preparedBy: schema.proposals.preparedBy,
      effectiveDate: schema.proposals.effectiveDate,
      expiresAt: schema.proposals.expiresAt,
      status: schema.proposals.status,
      publicShareToken: schema.proposals.publicShareToken,
      decidedAt: schema.proposals.decidedAt,
      decidedVariantId: schema.proposals.decidedVariantId,
      createdAt: schema.proposals.createdAt,
      updatedAt: schema.proposals.updatedAt,
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
    })
    .from(schema.proposals)
    .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.proposals.dealId, schema.deals.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.proposals.updatedAt))

  return NextResponse.json({ items })
}

// ── POST /api/admin/proposals ─────────────────────────────────────────
// Create a proposal. Optionally seeds a default cover section + a single
// "Standard" variant when no sections/variants are supplied.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title?: string
    subtitle?: string
    orgId?: string | null
    dealId?: string | null
    preparedFor?: string
    preparedBy?: string
    effectiveDate?: string
    expiresAt?: string
    /** If true, seed a default variant + cover section so the new proposal
     *  isn't visually empty when the user opens the editor. */
    seedDefaults?: boolean
    /** When set, snapshot from this proposal template is unpacked into
     *  fresh sections + variants. Variable values fill {{slot}} placeholders. */
    templateId?: string
    variableValues?: Record<string, string>
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Load template snapshot if requested.
  let templateSnapshot: TemplateSnapshot | null = null
  if (body.templateId) {
    const [tpl] = await database
      .select({ snapshot: schema.proposalTemplates.snapshot })
      .from(schema.proposalTemplates)
      .where(eq(schema.proposalTemplates.id, body.templateId))
      .limit(1)
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    try { templateSnapshot = JSON.parse(tpl.snapshot) as TemplateSnapshot }
    catch { return NextResponse.json({ error: 'Template snapshot is corrupt' }, { status: 500 }) }
  }

  await database.insert(schema.proposals).values({
    id,
    orgId: body.orgId ?? null,
    dealId: body.dealId ?? null,
    title: body.title.trim(),
    subtitle: body.subtitle?.trim() ?? templateSnapshot?.subtitle ?? null,
    preparedFor: body.preparedFor?.trim() ?? null,
    preparedBy: body.preparedBy?.trim() ?? null,
    effectiveDate: body.effectiveDate ?? null,
    expiresAt: body.expiresAt ?? null,
    status: 'draft',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  let defaultVariantId: string | null = null
  let defaultSectionId: string | null = null

  // ── Unpack template snapshot if provided ────────────────────────────
  if (templateSnapshot) {
    const subst = (s: string | null | undefined): string | null => {
      if (s == null) return null
      return substituteVariables(s, body.variableValues ?? {})
    }
    if (templateSnapshot.sections?.length) {
      const sectionRows = templateSnapshot.sections.map(s => ({
        id: crypto.randomUUID(),
        proposalId: id,
        type: s.type,
        title: subst(s.title),
        subtitle: subst(s.subtitle),
        data: s.data ? JSON.stringify(substituteInTree(s.data, body.variableValues ?? {})) : null,
        position: s.position ?? 0,
        createdAt: now,
        updatedAt: now,
      }))
      // D1 bind-cap: section row uses 9 columns, so 11 rows max per insert.
      // Stay at 9 to be safe.
      for (let i = 0; i < sectionRows.length; i += 9) {
        await database.insert(schema.proposalSections).values(sectionRows.slice(i, i + 9))
      }
      defaultSectionId = sectionRows[0]?.id ?? null
    }
    if (templateSnapshot.variants?.length) {
      const variantRows = templateSnapshot.variants.map((v, idx) => ({
        id: crypto.randomUUID(),
        proposalId: id,
        name: subst(v.name) ?? `Package ${idx + 1}`,
        tagline: subst(v.tagline),
        oneOffAmount: v.oneOffAmount ?? 0,
        monthlyAmount: v.monthlyAmount ?? 0,
        currency: v.currency ?? 'NZD',
        scopeHtml: subst(v.scopeHtml),
        pricingNotesHtml: subst(v.pricingNotesHtml),
        ctaLabel: subst(v.ctaLabel),
        isFeatured: v.isFeatured ?? 0,
        position: v.position ?? idx,
        createdAt: now,
        updatedAt: now,
      }))
      for (let i = 0; i < variantRows.length; i += 8) {
        await database.insert(schema.proposalVariants).values(variantRows.slice(i, i + 8))
      }
      defaultVariantId = variantRows.find(v => v.isFeatured)?.id ?? variantRows[0]?.id ?? null
    }
    return NextResponse.json({ id, defaultVariantId, defaultSectionId, fromTemplate: true }, { status: 201 })
  }

  if (body.seedDefaults !== false) {
    // Seed a single Standard variant so the editor + viewer have something
    // to render on first load.
    defaultVariantId = crypto.randomUUID()
    await database.insert(schema.proposalVariants).values({
      id: defaultVariantId,
      proposalId: id,
      name: 'Standard',
      tagline: null,
      oneOffAmount: 0,
      monthlyAmount: 0,
      currency: 'NZD',
      ctaLabel: 'Accept this package',
      isFeatured: 1,
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    // Seed an executive overview placeholder.
    defaultSectionId = crypto.randomUUID()
    await database.insert(schema.proposalSections).values({
      id: defaultSectionId,
      proposalId: id,
      type: 'overview',
      title: 'Executive overview',
      subtitle: null,
      data: JSON.stringify({ html: '' }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ id, defaultVariantId, defaultSectionId }, { status: 201 })
}
