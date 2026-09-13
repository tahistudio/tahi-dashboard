/**
 * lib/ai-request-org-context.ts
 *
 * A compact "what we already know about this client" block for the request
 * wizard's system prompt. Without it the wizard asks a client to name their
 * own industry or restate a service they have already had built, because
 * nothing about the caller's organisation ever reached the model. With it,
 * the model is told to treat that ground as already covered and, when the
 * org carries more than one brand, to ask which one instead of guessing.
 *
 * Split into a pure formatter (unit tested, no DB) and a thin loader that
 * runs the three reads: the org row, its brands, and its last few requests.
 * All three are already scoped to the caller's own org by the caller.
 */

import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How many past requests to summarise. Enough to say "you have asked for
 *  X and Y before" without ballooning the prompt on a long-tenured client. */
const RECENT_REQUEST_LIMIT = 5

export interface OrgContextOrg {
  name: string
  industry: string | null
  website: string | null
}

export interface OrgContextBrand {
  name: string
  website: string | null
}

export interface OrgContextRequest {
  title: string
  category: string | null
}

export interface RequestOrgContextInput {
  org: OrgContextOrg | null
  brands: OrgContextBrand[]
  recentRequests: OrgContextRequest[]
}

/**
 * Pure formatter: turns already-loaded rows into the text block the system
 * prompt appends. Returns an empty string when there is nothing on file at
 * all, so a brand-new org costs the prompt nothing.
 */
export function formatRequestOrgContext(input: RequestOrgContextInput): string {
  const { org, brands, recentRequests } = input
  if (!org && brands.length === 0 && recentRequests.length === 0) return ''

  const lines: string[] = ['CLIENT ON FILE (do not ask for anything already listed here):']

  if (org) {
    lines.push(`- Name: ${org.name}`)
    if (org.industry) lines.push(`- Industry: ${org.industry}`)
    if (org.website) lines.push(`- Website: ${org.website}`)
  }

  if (brands.length > 0) {
    const named = brands.map(b => (b.website ? `${b.name} (${b.website})` : b.name))
    lines.push(`- Brands on file: ${named.join(', ')}`)
    if (brands.length > 1) {
      lines.push(
        '- This client has more than one brand or website on file. Ask which one this request is for before drafting. Never guess.',
      )
    }
  }

  if (recentRequests.length > 0) {
    const recent = recentRequests.map(r => (r.category ? `${r.title} (${r.category})` : r.title))
    lines.push(`- Recent requests: ${recent.join('; ')}`)
  }

  return lines.join('\n')
}

/**
 * Load and format the context block for one org. Every read is scoped to
 * `orgId`, which the caller has already resolved to the caller's own
 * organisation, never taken from anywhere else on the request body.
 */
export async function loadRequestOrgContext(drizzle: Drizzle, orgId: string): Promise<string> {
  const [orgRow] = await drizzle
    .select({
      name: schema.organisations.name,
      industry: schema.organisations.industry,
      website: schema.organisations.website,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  const brandRows = await drizzle
    .select({ name: schema.brands.name, website: schema.brands.website })
    .from(schema.brands)
    .where(eq(schema.brands.orgId, orgId))

  // The `brands` table is the current source (migration 0093); a client
  // onboarded before it exists may still only carry the legacy JSON array of
  // brand names on the org row. Used only when the table has nothing, so a
  // migrated client is never shown both.
  let brands: OrgContextBrand[] = brandRows.map(b => ({ name: b.name, website: b.website ?? null }))
  if (brands.length === 0 && orgRow) {
    const [legacy] = await drizzle
      .select({ brands: schema.organisations.brands })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
    try {
      const names = legacy?.brands ? JSON.parse(legacy.brands) as unknown : []
      if (Array.isArray(names)) {
        brands = names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          .map(name => ({ name, website: null }))
      }
    } catch {
      brands = []
    }
  }

  const recentRequests = await drizzle
    .select({ title: schema.requests.title, category: schema.requests.category })
    .from(schema.requests)
    .where(eq(schema.requests.orgId, orgId))
    .orderBy(desc(schema.requests.createdAt))
    .limit(RECENT_REQUEST_LIMIT)

  return formatRequestOrgContext({
    org: orgRow ? { name: orgRow.name, industry: orgRow.industry ?? null, website: orgRow.website ?? null } : null,
    brands,
    recentRequests,
  })
}
