/**
 * Pure helpers for the /authorize consent step on the MCP worker.
 *
 * Before this module existed, GET /authorize minted an authorization code
 * for anyone who knew the (semi public) client id, and that code exchanged
 * for a full admin access token over every client's data. Consent is now a
 * Clerk sign-in on the dashboard naming one team member and their MCP
 * profile (Decision #070), and the callback target is checked against an
 * allowlist so a forged authorize link cannot ship the code to somebody
 * else's server.
 *
 * Everything here is string in, string out so it can be unit tested from
 * the app's Vitest run (workers/** is excluded from test collection, so the
 * spec lives in app/api/__tests__/mcp-oauth-approval.test.ts).
 */

/** Hosts allowed as OAuth callback targets without any extra config. */
export const DEFAULT_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'localhost', '127.0.0.1']

/** Hosts that may use http instead of https (local MCP inspector work). */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

/**
 * Parse the OAUTH_REDIRECT_HOSTS secret (comma or space separated) and
 * merge it with the defaults. Entries may be bare hosts ('claude.ai') or
 * full origins ('https://claude.ai'); both reduce to a hostname.
 */
export function parseAllowedRedirectHosts(raw: string | undefined | null): string[] {
  const extra = (raw ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      if (!entry.includes('://')) return entry.replace(/\/.*$/, '')
      try {
        return new URL(entry).hostname
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  return Array.from(new Set([...DEFAULT_REDIRECT_HOSTS, ...extra]))
}

/**
 * Is this redirect_uri one we are willing to hand an authorization code to?
 * Exact host match or a subdomain of an allowed host. https only, except on
 * loopback where the OAuth spec allows http.
 */
export function isAllowedRedirectUri(redirectUri: string, allowedHosts: string[]): boolean {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  const isLoopback = LOOPBACK_HOSTS.includes(host)
  if (url.protocol !== 'https:' && !(isLoopback && url.protocol === 'http:')) return false
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * Every token minted before this epoch (unix seconds) is refused, whatever
 * its expiry says. The tokens this worker issues are self contained HMAC
 * blobs with no server side store, and the refresh grant mints a fresh 30
 * day refresh token on every use, so a refresh token grabbed while
 * /authorize still auto-approved would otherwise live forever. Bumping
 * OAUTH_TOKEN_EPOCH past the moment of the fix cuts every one of them off
 * without touching OAUTH_CLIENT_SECRET.
 *
 * Junk, negative and missing values parse to 0, which disables the check.
 */
export function parseTokenEpoch(raw: string | undefined | null): number {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

/**
 * Was this token minted before the epoch? A payload with no `iat` at all
 * predates the claim, so it counts as older than any epoch: that is what
 * revokes the tokens issued by the auto-approving endpoint.
 */
export function isMintedBeforeEpoch(payload: { iat?: unknown }, epoch: number): boolean {
  if (epoch <= 0) return false
  const iat = typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? payload.iat : 0
  return iat < epoch
}

// ---------------------------------------------------------------------------
// Approval attempt throttling
// ---------------------------------------------------------------------------
// POST /authorize is public by design (the key in the form body is what
// authorises it), so without a counter a single host can grind the key at
// request rate with no signal to anyone. The buckets live in the worker
// isolate rather than KV: it is a speed bump, not a lock, and it pairs with
// logging every rejection so the attempt is visible in worker logs.

export const APPROVAL_ATTEMPT_LIMIT = 8
export const APPROVAL_ATTEMPT_WINDOW_MS = 10 * 60 * 1000

export type ApprovalAttemptBucket = { count: number; resetAt: number }
export type ApprovalAttempts = Map<string, ApprovalAttemptBucket>

/** Failures recorded against this key inside the live window (0 once it lapses). */
export function failedApprovalCount(buckets: ApprovalAttempts, key: string, now: number): number {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) return 0
  return bucket.count
}

/** Record one rejected approval; returns the running count for the window. */
export function recordFailedApproval(
  buckets: ApprovalAttempts,
  key: string,
  now: number,
  windowMs: number = APPROVAL_ATTEMPT_WINDOW_MS,
): number {
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return 1
  }
  bucket.count += 1
  return bucket.count
}

/** Drop lapsed windows so a spray of source addresses cannot grow the map. */
export function pruneApprovalAttempts(buckets: ApprovalAttempts, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/**
 * Compare two secrets without leaking their length or first difference
 * through timing. Not constant time in the cryptographic sense (JS strings
 * are not), but it removes the trivial early exit.
 */
export function timingSafeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** Escape a value for interpolation into HTML attributes or text. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The page the worker shows when a consent callback cannot be honoured
 * (expired request, bad assertion, throttled). Consent itself happens on the
 * dashboard's /mcp/authorize page behind a Clerk sign-in (Decision #070);
 * the shared approval key form that used to live here is retired.
 */
export function renderConsentErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Connect Claude</title>
<style>
  :root {
    --surface: #ffffff;
    --surface-sunk: #f7f9f6;
    --ink: #121a0f;
    --ink-muted: #5a6657;
    --line: #d4e0d0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: #1b1a18;
      --surface-sunk: #131211;
      --ink: #f2f0ea;
      --ink-muted: #b4b0a6;
      --line: #34322e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--surface-sunk);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    font-size: 1rem;
    line-height: 1.5;
  }
  .card {
    width: 100%;
    max-width: 26rem;
    background: var(--surface);
    border: 0.0625rem solid var(--line);
    border-radius: 0 1rem 0 1rem;
    padding: 1.75rem;
  }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0; color: var(--ink-muted); font-size: 0.875rem; }
</style>
</head>
<body>
  <main class="card">
    <h1>Could not connect Claude</h1>
    <p role="alert">${escapeHtml(message)}</p>
  </main>
</body>
</html>`
}
