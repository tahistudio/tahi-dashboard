/**
 * Webflow CMS API helpers.
 *
 * Thin wrapper over the v2 Data API. Auth is a single static token
 * (WEBFLOW_TOKEN env, set in Webflow Cloud). No OAuth dance for now —
 * we use the site-scoped API token Liam generated in Webflow Settings.
 *
 * Scope for Slice 0 (Phase I content engine):
 *   - listCollectionItems   : pull every item in a CMS collection
 *   - getCollectionItem     : fetch a single item by id
 *   - patchCollectionItem   : update field_data on a single item
 *   - publishCollectionItems: publish staged item edits to live
 *
 * Slice 6.5 (auto-patch low-confidence blog posts) is the first real
 * caller of patch + publish. Everything else here is read-only.
 *
 * Docs: https://developers.webflow.com/data/v2.0.0/reference/rest-introduction
 */

const API = 'https://api.webflow.com/v2'

function token(): string {
  const t = process.env.WEBFLOW_TOKEN
  if (!t) throw new Error('WEBFLOW_TOKEN not configured')
  return t
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export interface WebflowCollectionItem {
  id: string
  cmsLocaleId?: string
  lastPublished?: string | null
  lastUpdated?: string | null
  createdOn?: string
  isArchived?: boolean
  isDraft?: boolean
  fieldData: Record<string, unknown>
}

interface ListResponse {
  items?: WebflowCollectionItem[]
  pagination?: {
    limit?: number
    offset?: number
    total?: number
  }
}

export interface WebflowFieldDef {
  id: string
  slug: string
  displayName: string
  type: string
  isRequired?: boolean
}

/** Fetch a collection's field DEFINITIONS (not item data). Authoritative
 *  list of every CMS field + slug + type. Used to audit pipeline field
 *  coverage. */
export async function getCollectionSchema(collectionId: string): Promise<WebflowFieldDef[]> {
  const res = await fetch(`${API}/collections/${collectionId}`, { headers: headers() })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Webflow get collection failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { fields?: Array<{ id: string; slug: string; displayName: string; type: string; isRequired?: boolean }> }
  return (data.fields ?? []).map(f => ({
    id: f.id, slug: f.slug, displayName: f.displayName, type: f.type, isRequired: f.isRequired,
  }))
}

/**
 * List items in a collection. Webflow caps pageSize at 100; for larger
 * collections the caller can paginate by calling repeatedly with
 * incrementing `offset`. Default page size = 100 (max).
 */
export async function listCollectionItems(
  collectionId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: WebflowCollectionItem[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, opts.limit ?? 100))),
    offset: String(Math.max(0, opts.offset ?? 0)),
  })
  const res = await fetch(`${API}/collections/${collectionId}/items?${params.toString()}`, {
    headers: headers(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow listCollectionItems failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json() as ListResponse
  return {
    items: data.items ?? [],
    total: data.pagination?.total ?? data.items?.length ?? 0,
  }
}

/** Fetch a single item by id. */
export async function getCollectionItem(
  collectionId: string,
  itemId: string,
): Promise<WebflowCollectionItem> {
  const res = await fetch(`${API}/collections/${collectionId}/items/${itemId}`, {
    headers: headers(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow getCollectionItem failed: ${res.status} ${body.slice(0, 300)}`)
  }
  return await res.json() as WebflowCollectionItem
}

/**
 * Patch fieldData on a single item. Webflow only updates the fields
 * passed; omitted fields are left untouched. The edit is STAGED — you
 * must call publishCollectionItems() to push it live.
 */
export async function patchCollectionItem(
  collectionId: string,
  itemId: string,
  fieldData: Record<string, unknown>,
): Promise<WebflowCollectionItem> {
  const res = await fetch(`${API}/collections/${collectionId}/items/${itemId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ fieldData }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow patchCollectionItem failed: ${res.status} ${body.slice(0, 300)}`)
  }
  return await res.json() as WebflowCollectionItem
}

/**
 * Publish one or more staged items to live. Webflow accepts up to 100
 * item ids per call. Returns the publish response unchanged.
 */
export async function publishCollectionItems(
  collectionId: string,
  itemIds: string[],
): Promise<unknown> {
  if (itemIds.length === 0) return { publishedItemIds: [] }
  if (itemIds.length > 100) {
    throw new Error(`Webflow publishCollectionItems: cap is 100 ids per call, got ${itemIds.length}`)
  }
  const res = await fetch(`${API}/collections/${collectionId}/items/publish`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ itemIds }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow publishCollectionItems failed: ${res.status} ${body.slice(0, 300)}`)
  }
  return await res.json()
}

/**
 * Create a new collection item with the given fieldData. Defaults to
 * staged (`isDraft: true`) so the caller can decide whether to publish
 * via `publishCollectionItems()` or leave the item parked for later.
 *
 * Webflow REST: `POST /collections/{id}/items` body
 *   { isArchived, isDraft, fieldData: { ... } }
 *
 * Returns the minimal shape the publish pipeline needs — full item
 * data is available via getCollectionItem() if needed.
 */
export async function createCollectionItem(
  collectionId: string,
  fieldData: Record<string, unknown>,
  options: { isDraft?: boolean } = {},
): Promise<{ id: string; slug: string; lastUpdated: string }> {
  const isDraft = options.isDraft ?? true
  const res = await fetch(`${API}/collections/${collectionId}/items`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      isArchived: false,
      isDraft,
      fieldData,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow createCollectionItem failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json() as {
    id?: string
    fieldData?: { slug?: string }
    lastUpdated?: string
  }
  if (!data.id) {
    throw new Error('Webflow createCollectionItem: response missing item id')
  }
  return {
    id: data.id,
    slug: data.fieldData?.slug ?? '',
    lastUpdated: data.lastUpdated ?? new Date().toISOString(),
  }
}

// ── Site + collection discovery ──────────────────────────────────────────────
//
// The Webflow token is site-scoped. We discover the site id + the
// Blog Posts / Authors / Categories collection ids by calling the
// public list endpoints once and caching them in module-scoped vars.
// Caches survive for the lifetime of the worker isolate, which is fine
// for our use case (publish flow) — collection ids never change in
// practice.

interface WebflowSiteSummary {
  id: string
  displayName?: string
  shortName?: string
}

interface WebflowCollectionSummary {
  id: string
  displayName?: string
  slug?: string
  singularName?: string
}

let cachedSiteId: string | null = null
let cachedCollections: Map<string, string> | null = null  // displayName(lc) -> id

async function getSiteId(): Promise<string> {
  if (cachedSiteId) return cachedSiteId
  const res = await fetch(`${API}/sites`, { headers: headers() })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow listSites failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { sites?: WebflowSiteSummary[] }
  const first = data.sites?.[0]
  if (!first?.id) throw new Error('Webflow: token has no sites')
  cachedSiteId = first.id
  return first.id
}

async function listCollectionsForSite(): Promise<WebflowCollectionSummary[]> {
  const siteId = await getSiteId()
  const res = await fetch(`${API}/sites/${siteId}/collections`, { headers: headers() })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Webflow listCollections failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { collections?: WebflowCollectionSummary[] }
  return data.collections ?? []
}

async function findCollectionId(needle: string): Promise<string> {
  if (!cachedCollections) {
    const cols = await listCollectionsForSite()
    cachedCollections = new Map()
    for (const c of cols) {
      if (!c.id) continue
      if (c.displayName) cachedCollections.set(c.displayName.toLowerCase(), c.id)
      if (c.singularName) cachedCollections.set(c.singularName.toLowerCase(), c.id)
      if (c.slug) cachedCollections.set(c.slug.toLowerCase(), c.id)
    }
  }
  const hit = cachedCollections.get(needle.toLowerCase())
  if (!hit) {
    throw new Error(`Webflow: no collection matching "${needle}" on this site`)
  }
  return hit
}

/**
 * Resolve the Blog Posts collection id. Cached.
 * Verified collection: 685941c739fa006940c9b4de (per WORKFLOWS Phase I)
 * but we still discover dynamically so a site move / clone keeps working.
 */
export async function getBlogPostsCollectionId(): Promise<string> {
  // Try the verified id first via env override, then fall back to discovery.
  const override = process.env.WEBFLOW_BLOG_COLLECTION_ID
  if (override) return override
  // Webflow's Blog Posts collection is named "Blog Posts" by default.
  return await findCollectionId('Blog Posts')
}

/**
 * Authors + Categories collection lookup. Returns Maps keyed by slug
 * (lower-case) and — for authors — by lower-case name parts so the
 * publish pipeline can match `authorSlug='liam'` to "Liam Miller" without
 * a second round of fuzzy logic at the call site.
 */
export interface WebflowReferenceLookup {
  authorsBySlug: Map<string, string>          // 'liam-miller' -> item id
  authorsByNamePart: Map<string, string>      // 'liam' / 'miller' / 'liam miller' -> item id
  categoriesBySlug: Map<string, string>       // 'enterprise-webflow' -> item id
  categoriesByName: Map<string, string>       // lower-case display name -> item id
  categoryNameById: Map<string, string>       // item id -> display name (for schema)
  categorySlugById: Map<string, string>       // item id -> slug
}

let cachedReferenceLookups: WebflowReferenceLookup | null = null

export async function loadBlogReferenceLookups(): Promise<WebflowReferenceLookup> {
  if (cachedReferenceLookups) return cachedReferenceLookups

  const authorsCollectionId = await findCollectionId('Authors').catch(
    () => findCollectionId('Author'),
  )
  const categoriesCollectionId = await findCollectionId('Categories').catch(
    () => findCollectionId('Category'),
  )

  // Authors are typically a small collection (< 10 rows) so one page is plenty.
  const authorItems = await listCollectionItems(authorsCollectionId, { limit: 100 })
  const categoryItems = await listCollectionItems(categoriesCollectionId, { limit: 100 })

  const authorsBySlug = new Map<string, string>()
  const authorsByNamePart = new Map<string, string>()
  for (const item of authorItems.items) {
    const fd = item.fieldData as { slug?: string; name?: string }
    if (fd.slug) authorsBySlug.set(fd.slug.toLowerCase(), item.id)
    if (fd.name) {
      const full = fd.name.trim().toLowerCase()
      authorsByNamePart.set(full, item.id)
      for (const part of full.split(/\s+/).filter(Boolean)) {
        // Only set the part if it isn't already taken — first author wins
        // for ambiguous single-word matches like "liam".
        if (!authorsByNamePart.has(part)) {
          authorsByNamePart.set(part, item.id)
        }
      }
    }
  }

  const categoriesBySlug = new Map<string, string>()
  const categoriesByName = new Map<string, string>()
  const categoryNameById = new Map<string, string>()
  const categorySlugById = new Map<string, string>()
  for (const item of categoryItems.items) {
    const fd = item.fieldData as { slug?: string; name?: string }
    if (fd.slug) { categoriesBySlug.set(fd.slug.toLowerCase(), item.id); categorySlugById.set(item.id, fd.slug) }
    if (fd.name) { categoriesByName.set(fd.name.trim().toLowerCase(), item.id); categoryNameById.set(item.id, fd.name.trim()) }
  }

  cachedReferenceLookups = {
    authorsBySlug,
    authorsByNamePart,
    categoriesBySlug,
    categoriesByName,
    categoryNameById,
    categorySlugById,
  }
  return cachedReferenceLookups
}

/**
 * Force a re-fetch of the cached reference lookups. Useful when an admin
 * has just added a new category / author in Webflow and wants the
 * dashboard to pick them up without redeploying.
 */
export function invalidateReferenceLookupCache(): void {
  cachedReferenceLookups = null
  cachedCollections = null
}
