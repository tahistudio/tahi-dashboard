/**
 * Resolve the deployed app's origin (no trailing slash, no /dashboard).
 *
 * `NEXT_PUBLIC_APP_URL` was historically set to include the /dashboard
 * basePath (e.g. `https://dashboard.tahistudio.com/dashboard`). When email
 * routes appended their own `/dashboard/p/...` path the URL would double
 * up to `/dashboard/dashboard/p/...` and signing links would 404. This
 * helper strips a trailing `/dashboard/?` so callers can confidently
 * append the basePath themselves.
 */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dashboard.tahistudio.com'
  return raw.replace(/\/+$/, '').replace(/\/dashboard$/, '')
}

/**
 * Build a fully-qualified URL into the public viewer / sign / portal pages.
 * Always returns an absolute URL prefixed with the basePath, regardless of
 * whether NEXT_PUBLIC_APP_URL was set with or without `/dashboard`.
 */
export function publicUrl(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`
  return `${appOrigin()}/dashboard${trimmed}`
}
