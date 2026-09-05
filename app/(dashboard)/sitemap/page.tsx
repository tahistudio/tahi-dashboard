/**
 * /sitemap — long-lived planning surface for Liam + Staci.
 * Hard gate at the server-component layer: anyone not on the
 * allowlist gets a 404 (not 403 — route shouldn't even hint at
 * existing).
 */

import { notFound } from 'next/navigation'
import { assertSitemapPageAccess } from '@/lib/sitemap-auth'
import { requirePageFeature } from '@/lib/page-guard'
import { SitemapContent } from './sitemap-content'

export const metadata = { title: 'Sitemap — Tahi Dashboard' }

export default async function SitemapPage() {
  const userId = await assertSitemapPageAccess()
  if (!userId) notFound()
  // Feature guard runs AFTER the allowlist so a caller who is not on it still
  // gets a 404 and no hint the route exists; this only adds the granular
  // feature_visibility deny on top for someone who IS allowlisted.
  await requirePageFeature('sitemap')
  return <SitemapContent />
}
