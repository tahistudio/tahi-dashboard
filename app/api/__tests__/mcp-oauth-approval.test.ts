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
  DEFAULT_REDIRECT_HOSTS,
  escapeHtml,
  isAllowedRedirectUri,
  parseAllowedRedirectHosts,
  redirectHost,
  renderApprovalPage,
  timingSafeEquals,
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
