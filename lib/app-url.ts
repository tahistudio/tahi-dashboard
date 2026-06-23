/**
 * Resolve the deployed app's origin (no trailing slash, no /dashboard).
 *
 * The app now serves at the domain root. NEXT_PUBLIC_APP_URL may historically
 * have included a /dashboard basePath, so we defensively strip any trailing
 * /dashboard to give callers a clean origin to build absolute URLs from.
 */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'https://portal.tahi.studio'
  return raw.replace(/\/+$/, '').replace(/\/dashboard$/, '')
}

/**
 * Build a fully-qualified URL into the public viewer / sign / portal pages.
 * The app serves at the domain root, so no basePath is prefixed.
 */
export function publicUrl(path: string): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`
  return `${appOrigin()}${trimmed}`
}
