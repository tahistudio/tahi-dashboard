/**
 * GET /api/admin/content/webflow-status
 *
 * Diagnostic for the Webflow token + API connectivity. Run this when
 * publish/save-as-draft fails with "Failed to resolve Webflow
 * collections" — surfaces the real underlying error (401, 403, 429,
 * network) so we can tell whether the token is missing, expired,
 * rate-limited, or scoped wrong.
 *
 * Does NOT echo the token itself. Returns length + prefix only so we
 * can verify the right one is loaded without leaking.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getBlogPostsCollectionId, loadBlogReferenceLookups } from '@/lib/webflow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = process.env.WEBFLOW_TOKEN
  const collectionOverride = process.env.WEBFLOW_BLOG_COLLECTION_ID
  const siteOverride = process.env.WEBFLOW_SITE_ID
  const tokenPresent = typeof token === 'string' && token.length > 0
  const tokenInfo = tokenPresent
    ? { present: true, length: token.length, prefix: token.slice(0, 6), suffix: token.slice(-4) }
    : { present: false }

  // 1) Lowest-level: ping the sites endpoint with the token + dump
  //    every site we have access to. Helps when the token has multiple
  //    sites and Blog Posts only lives on one of them.
  let sitesPing: {
    ok: boolean
    status: number | null
    body?: string
    siteCount?: number
    sites?: Array<{ id: string; displayName: string; shortName: string }>
    error?: string
  }
  try {
    const res = await fetch('https://api.webflow.com/v2/sites', {
      headers: {
        Authorization: `Bearer ${token ?? ''}`,
        Accept: 'application/json',
      },
    })
    const bodyText = await res.text()
    if (res.ok) {
      let parsed: { sites?: Array<{ id: string; displayName?: string; shortName?: string }> } = {}
      try { parsed = JSON.parse(bodyText) } catch { /* keep empty */ }
      sitesPing = {
        ok: true,
        status: res.status,
        siteCount: parsed.sites?.length ?? 0,
        sites: (parsed.sites ?? []).map(s => ({
          id: s.id,
          displayName: s.displayName ?? '',
          shortName: s.shortName ?? '',
        })),
      }
    } else {
      sitesPing = { ok: false, status: res.status, body: bodyText.slice(0, 400) }
    }
  } catch (err) {
    sitesPing = { ok: false, status: null, error: err instanceof Error ? err.message : String(err) }
  }

  // 1b) For each site (cap 50, parallel), probe collections so we can
  //     see which site actually has Blog Posts. Heuristic-only: we
  //     short-circuit and only report sites whose name contains "tahi"
  //     OR sites where probing succeeds and Blog Posts exists. The
  //     full per-site collection probe ran sequentially before, which
  //     timed the route out at 47 sites.
  type SiteCollection = { id: string; displayName: string; slug: string; singularName: string }
  type SiteCollectionResult = {
    siteId: string
    siteName: string
    ok: boolean
    matchesTahi: boolean
    hasBlogPosts: boolean
    collections?: SiteCollection[]
    error?: string
  }
  let collectionsPerSite: SiteCollectionResult[] = []
  if (sitesPing.ok && sitesPing.sites) {
    const candidateSites = sitesPing.sites.filter(s => {
      const name = `${s.displayName} ${s.shortName}`.toLowerCase()
      return name.includes('tahi') || name.includes('blog')
    })
    // If nothing matches by name, fall back to probing first 10 sites
    // so we still get useful output.
    const targets = candidateSites.length > 0 ? candidateSites : sitesPing.sites.slice(0, 10)

    collectionsPerSite = await Promise.all(targets.map(async (site): Promise<SiteCollectionResult> => {
      try {
        const res = await fetch(`https://api.webflow.com/v2/sites/${site.id}/collections`, {
          headers: {
            Authorization: `Bearer ${token ?? ''}`,
            Accept: 'application/json',
          },
        })
        const txt = await res.text()
        if (res.ok) {
          let parsed: { collections?: Array<{ id: string; displayName?: string; slug?: string; singularName?: string }> } = {}
          try { parsed = JSON.parse(txt) } catch { /* keep empty */ }
          const collections: SiteCollection[] = (parsed.collections ?? []).map(c => ({
            id: c.id,
            displayName: c.displayName ?? '',
            slug: c.slug ?? '',
            singularName: c.singularName ?? '',
          }))
          const name = `${site.displayName} ${site.shortName}`.toLowerCase()
          return {
            siteId: site.id,
            siteName: site.displayName || site.shortName,
            ok: true,
            matchesTahi: name.includes('tahi'),
            hasBlogPosts: collections.some(c =>
              ['blog posts', 'blog post', 'posts', 'articles', 'blog'].includes(c.displayName.toLowerCase())
            ),
            collections,
          }
        }
        return {
          siteId: site.id,
          siteName: site.displayName || site.shortName,
          ok: false,
          matchesTahi: false,
          hasBlogPosts: false,
          error: `${res.status} ${txt.slice(0, 200)}`,
        }
      } catch (err) {
        return {
          siteId: site.id,
          siteName: site.displayName || site.shortName,
          ok: false,
          matchesTahi: false,
          hasBlogPosts: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }))
  }

  // 2) Higher-level: try resolving the Blog Posts collection id.
  let collectionPing: { ok: boolean; id?: string; error?: string }
  try {
    const id = await getBlogPostsCollectionId()
    collectionPing = { ok: true, id }
  } catch (err) {
    collectionPing = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // 3) Highest-level: load the full reference lookups (authors + categories).
  let lookupPing: { ok: boolean; authorCount?: number; categoryCount?: number; error?: string }
  try {
    const refs = await loadBlogReferenceLookups()
    lookupPing = {
      ok: true,
      authorCount: refs.authorsBySlug.size,
      categoryCount: refs.categoriesBySlug.size,
    }
  } catch (err) {
    lookupPing = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const allOk = sitesPing.ok && collectionPing.ok && lookupPing.ok

  return NextResponse.json({
    ok: allOk,
    token: tokenInfo,
    siteOverride: siteOverride ? { present: true, value: siteOverride } : { present: false },
    collectionOverride: collectionOverride ? { present: true, value: collectionOverride } : { present: false },
    sitesPing,
    collectionsPerSite,
    collectionPing,
    lookupPing,
    diagnostic: allOk
      ? 'Webflow token + API connectivity look healthy.'
      : !tokenPresent
        ? 'WEBFLOW_TOKEN env var is not set on this Worker.'
        : sitesPing.status === 401
          ? 'Token is set but Webflow returned 401 — token is invalid or expired. Regenerate at https://webflow.com/dashboard/account/integrations.'
          : sitesPing.status === 403
            ? 'Token is valid but lacks scope. Regenerate with CMS read/write scopes ticked.'
            : sitesPing.status === 429
              ? 'Webflow is rate-limiting (429). Wait 60s and try again.'
              : sitesPing.ok && !collectionPing.ok
                ? 'Token works but the Blog Posts collection lookup failed — see collectionPing.error.'
                : sitesPing.ok && collectionPing.ok && !lookupPing.ok
                  ? 'Collection found but reference lookups failed — see lookupPing.error.'
                  : 'See sitesPing.body for the raw Webflow response.',
  })
}
