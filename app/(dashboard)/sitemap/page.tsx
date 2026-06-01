/**
 * /sitemap — long-lived planning surface for Liam + Staci.
 * Hard gate at the server-component layer: anyone not on the
 * allowlist gets a 404 (not 403 — route shouldn't even hint at
 * existing).
 */

import { notFound } from 'next/navigation'
import { assertSitemapPageAccess } from '@/lib/sitemap-auth'
import { SitemapContent } from './sitemap-content'

export const metadata = { title: 'Sitemap — Tahi Dashboard' }

export default async function SitemapPage() {
  const userId = await assertSitemapPageAccess()
  if (!userId) notFound()
  return <SitemapContent />
}
