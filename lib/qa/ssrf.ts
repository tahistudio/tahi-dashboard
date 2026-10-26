/**
 * SSRF guard for every server-side fetch SQA makes (proxy worker, link
 * checker, sitemap import, site checks). Pure. Rejects non-http(s), any IP
 * literal (v4 or v6), localhost, .local, .internal and credentials in the URL.
 * DNS rebinding is out of scope: Workers fetch() cannot reach private
 * networks, and the dashboard also runs on Workers.
 */
export function isSafePublicUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  // Trailing dots are a valid absolute-DNS spelling ("localhost.") that would
  // slip past the suffix checks below, so strip them before comparing.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (!host || host.startsWith('[') || host.includes(':')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (!host.includes('.')) return false
  return true
}
