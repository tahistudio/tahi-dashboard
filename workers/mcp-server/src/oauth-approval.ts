/**
 * Pure helpers for the /authorize consent step on the MCP worker.
 *
 * Before this module existed, GET /authorize minted an authorization code
 * for anyone who knew the (semi public) client id, and that code exchanged
 * for a full admin access token over every client's data. The endpoint now
 * renders a consent page that requires a pre shared approval key, and the
 * callback target is checked against an allowlist so a forged authorize
 * link cannot ship the code to somebody else's server.
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

export type ApprovalPageParams = {
  clientId: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  codeChallengeMethod: string
  /** Set when re-rendering after a rejected key. */
  error?: string
}

function hiddenField(name: string, value: string | null): string {
  if (value === null) return ''
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
}

/** Human readable host for the "this code will be sent to" line. */
export function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host
  } catch {
    return redirectUri
  }
}

/**
 * The consent screen. A Tahi admin has to paste the approval key here
 * before any authorization code is minted.
 */
export function renderApprovalPage(params: ApprovalPageParams): string {
  const errorBlock = params.error
    ? `<p class="error" role="alert">${escapeHtml(params.error)}</p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Approve MCP access</title>
<style>
  :root {
    --surface: #ffffff;
    --surface-sunk: #f7f9f6;
    --ink: #121a0f;
    --ink-muted: #5a6657;
    --line: #d4e0d0;
    --brand: #5a824e;
    --brand-dark: #425f39;
    --danger: #b3261e;
    --danger-bg: #fef2f2;
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
  p { margin: 0 0 1rem; color: var(--ink-muted); font-size: 0.875rem; }
  dl { margin: 0 0 1.25rem; font-size: 0.8125rem; }
  dt { color: var(--ink-muted); }
  dd { margin: 0 0 0.5rem; word-break: break-all; }
  label { display: block; font-size: 0.8125rem; font-weight: 600; margin-bottom: 0.375rem; }
  input[type="password"] {
    width: 100%;
    min-height: 2.75rem;
    padding: 0 0.75rem;
    font-size: 1rem;
    color: var(--ink);
    background: var(--surface);
    border: 0.0625rem solid var(--line);
    border-radius: 0.5rem;
  }
  button {
    width: 100%;
    min-height: 2.75rem;
    margin-top: 1rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--surface);
    background: var(--brand);
    border: 0.0625rem solid var(--brand);
    border-radius: 0 0.625rem 0 0.625rem;
    cursor: pointer;
  }
  button:hover { background: var(--brand-dark); border-color: var(--brand-dark); }
  input:focus-visible, button:focus-visible {
    outline: 0.125rem solid var(--brand-dark);
    outline-offset: 0.125rem;
  }
  .error {
    color: var(--danger);
    background: var(--danger-bg);
    border: 0.0625rem solid var(--danger);
    border-radius: 0.5rem;
    padding: 0.625rem 0.75rem;
    font-size: 0.8125rem;
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Approve MCP access</h1>
    <p>
      This grants the Tahi Dashboard MCP connector full admin access to every
      client's data for 24 hours, with refresh. Only approve a request you
      started yourself, and check the callback below before you do.
    </p>
    ${errorBlock}
    <dl>
      <dt>Callback</dt>
      <dd>${escapeHtml(redirectHost(params.redirectUri))}</dd>
      <dt>Client</dt>
      <dd>${escapeHtml(params.clientId)}</dd>
    </dl>
    <form method="POST" action="/authorize" autocomplete="off">
      ${hiddenField('client_id', params.clientId)}
      ${hiddenField('redirect_uri', params.redirectUri)}
      ${hiddenField('response_type', 'code')}
      ${hiddenField('state', params.state)}
      ${hiddenField('code_challenge', params.codeChallenge)}
      ${hiddenField('code_challenge_method', params.codeChallengeMethod)}
      <label for="approval_key">Approval key</label>
      <input id="approval_key" name="approval_key" type="password" required autofocus />
      <button type="submit">Approve access</button>
    </form>
  </main>
</body>
</html>`
}
