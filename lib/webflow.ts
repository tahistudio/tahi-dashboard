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
