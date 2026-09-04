/**
 * Unit tests for the MCP worker's /authorize consent helpers.
 *
 * The worker used to mint an authorization code for anyone who knew the
 * client id, and that code exchanges for a full admin token over every
 * client's data. These helpers are what stands in front of it now: a
 * callback allowlist, a length-safe key comparison, and an HTML consent
 * page that carries the request forward without letting a value out of
 * the query string into markup unescaped.
 *
 * The worker lives outside the app's Vitest roots (workers/** is excluded
 * from collection), so the spec sits here and imports across.
 */
import { describe, it, expect } from 'vitest'
import {
  APPROVAL_ATTEMPT_LIMIT,
  APPROVAL_ATTEMPT_WINDOW_MS,
  DEFAULT_REDIRECT_HOSTS,
  escapeHtml,
  failedApprovalCount,
  isAllowedRedirectUri,
  isMintedBeforeEpoch,
  parseAllowedRedirectHosts,
  parseTokenEpoch,
  pruneApprovalAttempts,
  recordFailedApproval,
  redirectHost,
  renderApprovalPage,
  timingSafeEquals,
  type ApprovalAttempts,
} from '../../../workers/mcp-server/src/oauth-approval'

describe('parseAllowedRedirectHosts', () => {
  it('always includes the built-in hosts', () => {
    expect(parseAllowedRedirectHosts(undefined)).toEqual(DEFAULT_REDIRECT_HOSTS)
    expect(parseAllowedRedirectHosts('')).toEqual(DEFAULT_REDIRECT_HOSTS)
  })

  it('accepts bare hosts and full origins, comma or space separated', () => {
    const hosts = parseAllowedRedirectHosts('example.test, https://mcp.example.org/callback')
    expect(hosts).toContain('example.test')
    expect(hosts).toContain('mcp.example.org')
  })

  it('drops junk entries instead of allowing them', () => {
    const hosts = parseAllowedRedirectHosts('https://,  , ://nope')
    expect(hosts).toEqual(DEFAULT_REDIRECT_HOSTS)
  })
})

describe('isAllowedRedirectUri', () => {
  const hosts = parseAllowedRedirectHosts(undefined)

  it('allows the Claude callbacks the connector uses', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('https://claude.com/api/mcp/auth_callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('https://api.claude.ai/callback', hosts)).toBe(true)
  })

  it('allows http only on loopback', () => {
    expect(isAllowedRedirectUri('http://localhost:6274/callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('http://127.0.0.1:6274/callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('http://claude.ai/api/mcp/auth_callback', hosts)).toBe(false)
  })

  it('refuses a callback that would ship the code somewhere else', () => {
    expect(isAllowedRedirectUri('https://evil.test/steal', hosts)).toBe(false)
    // Suffix lookalikes must not pass as subdomains.
    expect(isAllowedRedirectUri('https://notclaude.ai/steal', hosts)).toBe(false)
    expect(isAllowedRedirectUri('https://claude.ai.evil.test/steal', hosts)).toBe(false)
    expect(isAllowedRedirectUri('not a url', hosts)).toBe(false)
  })

  it('honours an extra host from the secret', () => {
    const extended = parseAllowedRedirectHosts('mcp.example.org')
    expect(isAllowedRedirectUri('https://mcp.example.org/cb', extended)).toBe(true)
    expect(isAllowedRedirectUri('https://mcp.example.org/cb', hosts)).toBe(false)
  })
})

describe('timingSafeEquals', () => {
  it('matches identical strings only', () => {
    expect(timingSafeEquals('sup3r-secret', 'sup3r-secret')).toBe(true)
    expect(timingSafeEquals('sup3r-secret', 'sup3r-secrey')).toBe(false)
    expect(timingSafeEquals('sup3r-secret', 'sup3r-secret ')).toBe(false)
    expect(timingSafeEquals('', 'sup3r-secret')).toBe(false)
    expect(timingSafeEquals('', '')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Revocation. Closing /authorize does not retire the tokens the old
// auto-approving endpoint already handed out: they are self contained signed
// blobs, and the refresh grant re-issues a 30 day refresh token on every use.
// OAUTH_TOKEN_EPOCH is the lever that kills them.
// ---------------------------------------------------------------------------

describe('parseTokenEpoch', () => {
  it('reads a unix seconds value', () => {
    expect(parseTokenEpoch('1757030400')).toBe(1757030400)
    expect(parseTokenEpoch('  1757030400  ')).toBe(1757030400)
    expect(parseTokenEpoch('1757030400.9')).toBe(1757030400)
  })

  it('treats unset, blank, junk and non-positive values as no epoch', () => {
    expect(parseTokenEpoch(undefined)).toBe(0)
    expect(parseTokenEpoch(null)).toBe(0)
    expect(parseTokenEpoch('')).toBe(0)
    expect(parseTokenEpoch('yesterday')).toBe(0)
    expect(parseTokenEpoch('-5')).toBe(0)
    expect(parseTokenEpoch('0')).toBe(0)
  })
})

describe('isMintedBeforeEpoch', () => {
  const epoch = 1_757_030_400

  it('refuses tokens minted before the epoch and keeps the rest', () => {
    expect(isMintedBeforeEpoch({ iat: epoch - 1 }, epoch)).toBe(true)
    expect(isMintedBeforeEpoch({ iat: epoch }, epoch)).toBe(false)
    expect(isMintedBeforeEpoch({ iat: epoch + 1 }, epoch)).toBe(false)
  })

  it('refuses a token with no iat, which is what revokes the old ones', () => {
    expect(isMintedBeforeEpoch({}, epoch)).toBe(true)
    expect(isMintedBeforeEpoch({ iat: 'soon' }, epoch)).toBe(true)
    expect(isMintedBeforeEpoch({ iat: Number.NaN }, epoch)).toBe(true)
  })

  it('changes nothing while the epoch is unset', () => {
    expect(isMintedBeforeEpoch({}, 0)).toBe(false)
    expect(isMintedBeforeEpoch({ iat: 1 }, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// POST /authorize is public, so a single shared key can be ground at request
// rate. The counter is a speed bump, not a lock, and it must never lock out
// the admin permanently.
// ---------------------------------------------------------------------------

describe('approval attempt throttling', () => {
  const now = 1_757_030_400_000

  function buckets(): ApprovalAttempts {
    return new Map()
  }

  it('counts failures per source inside the window', () => {
    const b = buckets()
    expect(failedApprovalCount(b, '203.0.113.7', now)).toBe(0)
    expect(recordFailedApproval(b, '203.0.113.7', now)).toBe(1)
    expect(recordFailedApproval(b, '203.0.113.7', now + 1000)).toBe(2)
    expect(failedApprovalCount(b, '203.0.113.7', now + 1000)).toBe(2)
    // A different source is untouched by someone else's failures.
    expect(failedApprovalCount(b, '198.51.100.4', now)).toBe(0)
  })

  it('lets the window lapse instead of locking the admin out forever', () => {
    const b = buckets()
    for (let i = 0; i < APPROVAL_ATTEMPT_LIMIT; i++) recordFailedApproval(b, 'ip', now)
    expect(failedApprovalCount(b, 'ip', now)).toBeGreaterThanOrEqual(APPROVAL_ATTEMPT_LIMIT)
    const after = now + APPROVAL_ATTEMPT_WINDOW_MS + 1
    expect(failedApprovalCount(b, 'ip', after)).toBe(0)
    expect(recordFailedApproval(b, 'ip', after)).toBe(1)
  })

  it('prunes lapsed windows so a spray of addresses cannot grow the map', () => {
    const b = buckets()
    recordFailedApproval(b, 'old', now)
    recordFailedApproval(b, 'fresh', now + APPROVAL_ATTEMPT_WINDOW_MS)
    pruneApprovalAttempts(b, now + APPROVAL_ATTEMPT_WINDOW_MS + 1)
    expect(b.has('old')).toBe(false)
    expect(b.has('fresh')).toBe(true)
  })
})

describe('escapeHtml', () => {
  it('neutralises markup characters', () => {
    expect(escapeHtml('<script>"x"&\'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    )
  })
})

describe('redirectHost', () => {
  it('shows the host the code would be sent to', () => {
    expect(redirectHost('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai')
  })
  it('falls back to the raw value when it will not parse', () => {
    expect(redirectHost('not a url')).toBe('not a url')
  })
})

describe('renderApprovalPage', () => {
  const params = {
    clientId: 'client-123',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    state: 'st4te',
    codeChallenge: 'chall3nge',
    codeChallengeMethod: 'S256',
  }

  it('posts the request back with every parameter preserved', () => {
    const html = renderApprovalPage(params)
    expect(html).toContain('method="POST" action="/authorize"')
    expect(html).toContain('name="client_id" value="client-123"')
    expect(html).toContain('name="state" value="st4te"')
    expect(html).toContain('name="code_challenge" value="chall3nge"')
    expect(html).toContain('name="code_challenge_method" value="S256"')
    expect(html).toContain('name="approval_key"')
  })

  it('omits state entirely when the client sent none', () => {
    const html = renderApprovalPage({ ...params, state: null })
    expect(html).not.toContain('name="state"')
  })

  it('never mints or shows a code', () => {
    expect(renderApprovalPage(params)).not.toContain('name="code"')
  })

  it('shows the whole callback, not just the host', () => {
    // https://claude.ai/<anything-else> renders identically to the real
    // callback when only the host is printed, so the human check the page
    // asks for is impossible without the path.
    const html = renderApprovalPage(params)
    expect(html).toContain('https://claude.ai/api/mcp/auth_callback')
    const forged = renderApprovalPage({ ...params, redirectUri: 'https://claude.ai/not-the-real-callback' })
    expect(forged).toContain('https://claude.ai/not-the-real-callback')
    expect(forged).not.toBe(html)
  })

  it('escapes the callback rather than reflecting markup from it', () => {
    const html = renderApprovalPage({ ...params, redirectUri: 'https://claude.ai/"><script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('escapes hostile parameters instead of reflecting them', () => {
    const html = renderApprovalPage({ ...params, state: '"><script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('shows the rejection when a key did not match', () => {
    const html = renderApprovalPage({ ...params, error: 'That approval key was not recognised.' })
    expect(html).toContain('That approval key was not recognised.')
    expect(html).toContain('role="alert"')
  })
})
