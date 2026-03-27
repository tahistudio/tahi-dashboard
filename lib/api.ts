/**
 * lib/api.ts
 * Client-side API path helper.
 *
 * Next.js automatically prepends basePath (/dashboard) to next/link and
 * next/navigation calls, but NOT to native fetch(). Client Components must
 * manually prefix API paths.
 *
 * Usage:
 *   import { apiPath } from '@/lib/api'
 *   const res = await fetch(apiPath('/api/admin/requests'))
 */

const base = process.env.NEXT_PUBLIC_BASEPATH ?? ''

export function apiPath(path: string): string {
  return `${base}${path}`
}
