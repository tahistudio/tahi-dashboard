/**
 * Unit tests for the MCP worker's /authorize consent helpers.
 *
 * The worker used to mint an authorization code for anyone who knew the
 * client id, and that code exchanges for a full admin token over every
 * client's data. These helpers are what stands in front of it now: a
 * callback allowlist, length-safe comparisons, throttling and the error
 * page the consent callback shows, which never lets a value out of
 * the query string into markup unescaped.
 *
 * The worker lives outside the app's Vitest roots (workers/** is excluded
 * from collection), so the spec sits here and imports across.
 */
import { describe, it, expect } from 'vitest'
import {
  APPROVAL_ATTEMPT_LIMIT,
  APPROVAL_ATTEMPT_WINDOW_MS,
  DEFAULT_REDIRECT_URIS,
  escapeHtml,
  failedApprovalCount,
  isAllowedRedirectUri,
  isMintedBeforeEpoch,
  parseAllowedRedirectHosts,
  parseTokenEpoch,
  pruneApprovalAttempts,
  recordFailedApproval,

  renderConsentErrorPage,
  timingSafeEquals,
  type ApprovalAttempts,
  readBodyCapped,
  recordCapped,
  throttleKey,
} from '../../../workers/mcp-server/src/oauth-approval'

describe('parseAllowedRedirectHosts', () => {
  it('always includes the built-in hosts', () => {
    expect(parseAllowedRedirectHosts(undefined)).toEqual(DEFAULT_REDIRECT_URIS)
    expect(parseAllowedRedirectHosts('')).toEqual(DEFAULT_REDIRECT_URIS)
  })

  it('accepts bare hosts and full origins, comma or space separated', () => {
    const hosts = parseAllowedRedirectHosts('example.test, https://mcp.example.org/callback')
    expect(hosts).toContain('example.test')
    expect(hosts).toContain('https://mcp.example.org/callback')
  })

  it('drops junk entries instead of allowing them', () => {
    const hosts = parseAllowedRedirectHosts('https://,  , ://nope')
    expect(hosts).toEqual(DEFAULT_REDIRECT_URIS)
  })
})

describe('isAllowedRedirectUri', () => {
  const hosts = parseAllowedRedirectHosts(undefined)

  it('allows the Claude callbacks the connector uses', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('https://claude.com/api/mcp/auth_callback', hosts)).toBe(true)
    for (const bad of [
      'https://x.claude.ai/cb',
      'https://claude.ai/other',
      'https://claude.ai:444/api/mcp/auth_callback',
      'https://evil.com@claude.ai/api/mcp/auth_callback',
      'https://claude.com/anything',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai/api/mcp/auth_callback#f',
      'http://localhost:3118/cb#f',
      'http://user@localhost:3118/cb',
    ]) {
      expect(isAllowedRedirectUri(bad, hosts)).toBe(false)
    }
    expect(isAllowedRedirectUri('http://localhost:3118/callback', hosts)).toBe(true)
    expect(isAllowedRedirectUri('http://127.0.0.1:5000/callback', hosts)).toBe(true)
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
    const exact = parseAllowedRedirectHosts('https://mcp.example.org/callback')
    expect(isAllowedRedirectUri('https://mcp.example.org/callback', exact)).toBe(true)
    expect(isAllowedRedirectUri('https://mcp.example.org/other', exact)).toBe(false)
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

describe('renderConsentErrorPage', () => {
  it('shows the reason as an alert and never carries a form or a code', () => {
    const html = renderConsentErrorPage('This connection attempt has expired.')
    expect(html).toContain('This connection attempt has expired.')
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('approval_key')
  })

  it('escapes the message rather than reflecting markup', () => {
    const html = renderConsentErrorPage('<script>alert(1)</script>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('registration throttle and body helpers', () => {
  it('never tracks more than the cap under many distinct keys', () => {
    const map: ApprovalAttempts = new Map()
    for (let i = 0; i < 10000; i++) recordCapped(map, `k${i}`, 1000, 5000)
    expect(map.size).toBeLessThanOrEqual(5000)
  })

  it('keys IPv6 by /64 and leaves IPv4 alone', () => {
    expect(throttleKey('203.0.113.9')).toBe('203.0.113.9')
    expect(throttleKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(throttleKey('2001:db8:1:2::1'))
    expect(throttleKey('2001:db8:1:2::1')).not.toBe(throttleKey('2001:db8:1:3::1'))
  })

  it('stops reading a streamed body past the cap with no Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4500))
        controller.enqueue(new Uint8Array(4500))
        controller.close()
      },
    })
    const req = new Request('https://mcp.example/register', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect(req.headers.get('Content-Length')).toBeNull()
    expect(await readBodyCapped(req, 8192)).toBeNull()
    const ok = new Request('https://mcp.example/register', { method: 'POST', body: 'hello' })
    expect(await readBodyCapped(ok, 8192)).toBe('hello')
  })
})
