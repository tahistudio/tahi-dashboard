/**
 * Path without query, hash or trailing slash (root stays '/'). Used to match a scan
 * message to the page on screen, so a late scan from the previous page is ignored.
 */
export function comparablePath(pathOrUrl: string): string {
  let p = pathOrUrl
  try {
    p = new URL(pathOrUrl, 'https://x.invalid').pathname
  } catch {
    p = pathOrUrl.split(/[?#]/)[0]
  }
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}
