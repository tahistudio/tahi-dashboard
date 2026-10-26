# Site QA tester (SQA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only dashboard feature that QAs client websites: sites per client, a sitemap-imported page checklist with five viewport ticks per page in named rounds, live five-viewport viewing through a sandbox proxy worker, and automatic accessibility, link, SEO, launch and performance checks.

**Architecture:** A new Cloudflare Worker (`workers/qa-view`) on its own origin proxies client pages, rewrites them with HTMLRewriter and injects a scanner (axe-core plus our collectors) that posts results to the dashboard frame via postMessage. The dashboard stores sites, pages, rounds and scan results in D1 (migration 0115), runs server-side link, site and PageSpeed checks, and renders the `/qa` workspace. Pure logic shared by both lives in `lib/qa/` and must not import Next.js, D1 or Node APIs.

**Tech Stack:** Next.js 15 App Router, Drizzle on D1, Cloudflare Workers + HTMLRewriter, axe-core 4.11, esbuild (scanner bundle), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-site-qa-tester-design.md`. Read it before any task.

---

## Rules for every task (read first)

- Read `CLAUDE.md` once. Hard rules: no `any`, no `console.log`, no commented-out code, **no em dashes or en dashes anywhere** (use commas, periods, parentheses), rem units for spacing, CSS var tokens not hex in components (except const objects for inline styles), every interactive element has hover and focus states, 44px touch targets, no single-side borders.
- Never export anything from a `route.ts` other than HTTP method handlers.
- After each task: `npx vitest run <the task's test files>` passes, then `npm run type-check` and `npm run lint` pass with zero errors. Fix before committing.
- Commit at the end of each task with the message given, ending with:
  ```
  Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
  ```
  Add `[skip ci]` to every commit until Task 16 (we deploy once at the end).
- Do not push. Do not run migrations against production. Do not set secrets.
- If something in the plan conflicts with the repo, stop and report it instead of guessing.

## File map

```
lib/qa/types.ts              shared types + viewport list (pure)
lib/qa/token.ts              HMAC sign/verify view tokens (WebCrypto, pure)
lib/qa/ssrf.ts               isSafePublicUrl (pure)
lib/qa/proxy-rules.ts        proxy URL rewrite + header scrub decisions (pure)
lib/qa/sitemap.ts            sitemap XML parse, path normalise (pure)
lib/qa/grouping.ts           template groups + sample picking (pure)
lib/qa/issue-rules.ts        ScanResult -> QaIssue[] + counts (pure)
lib/qa/link-check.ts         follow redirects with an injected fetch (pure)
lib/qa/site-checks.ts        robots/sitemap/https/www/favicon checks (pure, injected fetch)
lib/qa/__tests__/*.test.ts   unit tests for all of the above
lib/qa/server.ts             D1 helpers shared by routes (loads site/round, recompute counts)
lib/qa-migration.ts          migration 0115 statements
drizzle/migrations/0115_site_qa.sql
db/schema.ts                 + six qa_* tables
lib/feature-tree.ts          + qa_tester key
app/api/admin/db/migrate/route.ts  + 0115 entry
workers/qa-view/             the proxy worker (wrangler.jsonc, package.json, tsconfig, build-scanner.mjs, src/index.ts, src/scanner/*)
.github/workflows/qa-view-deploy.yml
app/api/admin/qa/...         API routes (see Tasks 8 to 11)
app/api/__tests__/admin-qa-*.test.ts
app/(dashboard)/qa/...       pages and client components (Tasks 12 to 14)
app/(dashboard)/clients/[id]/tabs/overview.tsx  + Sites card (Task 14)
components/tahi/nav-model.tsx + QA entry
workers/mcp-server/src/qa-tools.ts + registration in index.ts (Task 15)
app/api/__tests__/mcp-qa-tool-parity.test.ts
```

---

### Task 1: Shared types, viewports and view tokens

**Files:**
- Create: `lib/qa/types.ts`, `lib/qa/token.ts`
- Test: `lib/qa/__tests__/token.test.ts`

- [ ] **Step 1: Create `lib/qa/types.ts`**

```ts
/**
 * Shared Site QA (SQA) types. Pure: imported by the dashboard AND by
 * workers/qa-view, so nothing here may import Next.js, D1 or Node APIs.
 */

export const QA_VIEWPORTS = [
  { key: 'xl', label: 'XL', width: 1920, height: 1080 },
  { key: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { key: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { key: 'mobile_l', label: 'Mobile L', width: 425, height: 860 },
  { key: 'mobile_p', label: 'Mobile P', width: 375, height: 812 },
] as const

export type QaViewportKey = (typeof QA_VIEWPORTS)[number]['key']
export const QA_VIEWPORT_KEYS: readonly QaViewportKey[] = QA_VIEWPORTS.map(v => v.key)
/** The viewport whose scan supplies the non-layout results (SEO, links, a11y). */
export const QA_PRIMARY_VIEWPORT: QaViewportKey = 'desktop'

export type QaTarget = 'staging' | 'live'
export type QaPageStatus = 'untested' | 'pass' | 'fail'

export interface QaA11yNode { selector: string; html: string }
export interface QaA11yViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  help: string
  helpUrl: string
  nodes: QaA11yNode[]
}

export interface QaLink { url: string; text: string; selector: string }
export interface QaMissingAnchor { href: string; selector: string }

export interface QaSeo {
  title: string | null
  metaDescription: string | null
  canonical: string | null
  robotsMeta: string | null
  og: { title: string | null; description: string | null; image: string | null; url: string | null }
  h1Count: number
  headingOutline: { level: number; text: string }[]
  headingSkips: { from: number; to: number; text: string }[]
  jsonLd: { count: number; parseErrors: number }
  lang: string | null
  favicon: string | null
}

export interface QaContent {
  imagesMissingAlt: { selector: string; src: string }[]
  stagingLeftovers: { kind: 'webflow_io' | 'lorem_ipsum' | 'placeholder_image'; sample: string; selector: string }[]
  forms: { action: string | null; method: string; fieldCount: number; selector: string }[]
}

export interface QaLayout {
  horizontalOverflow: boolean
  overflowingElements: { selector: string; width: number }[]
}

export interface QaPerfImage {
  src: string
  naturalWidth: number
  naturalHeight: number
  renderedWidth: number
  renderedHeight: number
  /** natural width > 2 x rendered width x devicePixelRatio */
  oversized: boolean
  format: string
  /** bytes from the resource timing API, 0 when unknown (cross-origin without Timing-Allow-Origin) */
  transferSize: number
}

export interface QaPerf { images: QaPerfImage[]; totalTransferSize: number }

export interface QaScanResult {
  a11y: QaA11yViolation[]
  links: QaLink[]
  missingAnchors: QaMissingAnchor[]
  seo: QaSeo
  content: QaContent
  layout: QaLayout
  perf: QaPerf
}

export interface QaScanMessage {
  type: 'qa:scan'
  version: 1
  url: string
  viewportWidth: number
  result: QaScanResult
}

export interface QaHighlightMessage { type: 'qa:highlight'; selector: string }
export interface QaRescanMessage { type: 'qa:rescan' }

export type QaIssueCategory = 'a11y' | 'links' | 'seo' | 'launch' | 'perf'
export type QaIssueSeverity = 'fail' | 'warn' | 'info'

export interface QaIssue {
  category: QaIssueCategory
  code: string
  severity: QaIssueSeverity
  message: string
  selector?: string
  viewport?: QaViewportKey
  url?: string
}

export interface QaLinkResult {
  url: string
  finalUrl: string | null
  status: number | null
  hops: { url: string; status: number }[]
  broken: boolean
  redirectChain: boolean
  stagingOnLive: boolean
  error: string | null
}

export interface QaPageCounts {
  a11yCritical: number
  a11ySerious: number
  a11yModerate: number
  a11yMinor: number
  brokenLinks: number
  seoIssues: number
  launchIssues: number
  perfIssues: number
}

export interface QaViewTokenPayload {
  /** upstream origin, e.g. https://acme.webflow.io */
  o: string
  /** parent (dashboard) origin allowed to frame and receive messages */
  p: string
  /** expiry, unix seconds */
  exp: number
}

export function viewportByWidth(width: number): QaViewportKey | null {
  const hit = QA_VIEWPORTS.find(v => v.width === width)
  return hit ? hit.key : null
}
```

- [ ] **Step 2: Write the failing test `lib/qa/__tests__/token.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { signViewToken, verifyViewToken, decodeViewTokenPayload } from '@/lib/qa/token'

const SECRET = 'test-secret-that-is-long-enough-123456'
const payload = { o: 'https://acme.webflow.io', p: 'https://portal.tahi.studio', exp: 2_000_000_000 }

describe('view tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, SECRET, 1_900_000_000)).toEqual(payload)
  })
  it('rejects an expired token', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, SECRET, 2_000_000_001)).toBeNull()
  })
  it('rejects a tampered payload', async () => {
    const token = await signViewToken(payload, SECRET)
    const [, sig] = token.split('.')
    const forged = btoa(JSON.stringify({ ...payload, o: 'https://evil.com' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyViewToken(`${forged}.${sig}`, SECRET, 1_900_000_000)).toBeNull()
  })
  it('rejects the wrong secret and junk', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, 'another-secret-another-secret-xx', 1)).toBeNull()
    expect(await verifyViewToken('junk', SECRET, 1)).toBeNull()
    expect(await verifyViewToken('a.b.c', SECRET, 1)).toBeNull()
  })
  it('decodes the payload without verifying (scanner side)', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(decodeViewTokenPayload(token)).toEqual(payload)
    expect(decodeViewTokenPayload('junk')).toBeNull()
  })
})
```

- [ ] **Step 3: Run it, expect FAIL (module not found)**

Run: `npx vitest run lib/qa/__tests__/token.test.ts`

- [ ] **Step 4: Create `lib/qa/token.ts`**

```ts
/**
 * Signed view tokens for the qa-view proxy worker. Pure WebCrypto, so the
 * dashboard (signs) and the worker (verifies) share this file.
 * Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payloadPart)).
 */
import type { QaViewTokenPayload } from './types'

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function isPayload(v: unknown): v is QaViewTokenPayload {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.o === 'string' && typeof r.p === 'string' && typeof r.exp === 'number'
}

export async function signViewToken(payload: QaViewTokenPayload, secret: string): Promise<string> {
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${body}.${toB64Url(await hmac(body, secret))}`
}

export function decodeViewTokenPayload(token: string): QaViewTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const bytes = fromB64Url(parts[0])
  if (!bytes) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function verifyViewToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<QaViewTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const sig = fromB64Url(parts[1])
  if (!sig) return null
  if (!timingSafeEqual(sig, await hmac(parts[0], secret))) return null
  const payload = decodeViewTokenPayload(token)
  if (!payload || payload.exp < nowSeconds) return null
  return payload
}

export const QA_VIEW_TOKEN_TTL_SECONDS = 12 * 60 * 60
```

- [ ] **Step 5: Run the test, expect PASS.** Then `npm run type-check`.

- [ ] **Step 6: Commit** `SQA: shared types and signed view tokens [skip ci]`

---

### Task 2: SSRF guard and proxy rewrite rules

**Files:**
- Create: `lib/qa/ssrf.ts`, `lib/qa/proxy-rules.ts`
- Test: `lib/qa/__tests__/ssrf.test.ts`, `lib/qa/__tests__/proxy-rules.test.ts`

- [ ] **Step 1: Write `lib/qa/__tests__/ssrf.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isSafePublicUrl } from '@/lib/qa/ssrf'

describe('isSafePublicUrl', () => {
  it.each([
    'https://acme.webflow.io/',
    'http://example.com/a?b=1',
    'https://www.client.co.nz/blog/post',
  ])('allows %s', url => expect(isSafePublicUrl(url)).toBe(true))

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    'https://localhost/',
    'https://foo.localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'https://printer.local/',
    'https://svc.internal/',
    'https://user:pass@example.com/',
    'not a url',
  ])('rejects %s', url => expect(isSafePublicUrl(url)).toBe(false))
})
```

- [ ] **Step 2: Create `lib/qa/ssrf.ts`**

```ts
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
  const host = url.hostname.toLowerCase()
  if (!host || host.startsWith('[') || host.includes(':')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (!host.includes('.')) return false
  return true
}
```

- [ ] **Step 3: Write `lib/qa/__tests__/proxy-rules.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  baseHrefFor, rewriteHref, fromProxyUrl, upstreamUrlFor, scrubResponseHeaders, classifyRedirect,
} from '@/lib/qa/proxy-rules'

const UP = 'https://acme.webflow.io'
const PB = 'https://qa-view.example.workers.dev/v/TOKEN'

describe('baseHrefFor', () => {
  it('uses the directory of the path', () => {
    expect(baseHrefFor(UP, '/')).toBe('https://acme.webflow.io/')
    expect(baseHrefFor(UP, '/about')).toBe('https://acme.webflow.io/')
    expect(baseHrefFor(UP, '/blog/post-a')).toBe('https://acme.webflow.io/blog/')
    expect(baseHrefFor(UP, '/blog/')).toBe('https://acme.webflow.io/blog/')
  })
})

describe('rewriteHref', () => {
  const page = 'https://acme.webflow.io/blog/post-a'
  it('rewrites same-origin links to proxy URLs keeping query and hash', () => {
    expect(rewriteHref('/about', page, UP, PB)).toBe(`${PB}/about`)
    expect(rewriteHref('other?x=1#top', page, UP, PB)).toBe(`${PB}/blog/other?x=1#top`)
    expect(rewriteHref('https://acme.webflow.io/', page, UP, PB)).toBe(`${PB}/`)
  })
  it('leaves other origins and special schemes alone', () => {
    expect(rewriteHref('https://google.com', page, UP, PB)).toBeNull()
    expect(rewriteHref('#section', page, UP, PB)).toBeNull()
    expect(rewriteHref('mailto:a@b.com', page, UP, PB)).toBeNull()
    expect(rewriteHref('tel:123', page, UP, PB)).toBeNull()
    expect(rewriteHref('javascript:void(0)', page, UP, PB)).toBeNull()
  })
})

describe('fromProxyUrl', () => {
  it('maps a proxy URL back to the upstream form', () => {
    expect(fromProxyUrl(`${PB}/about?x=1#h`, PB, UP)).toBe('https://acme.webflow.io/about?x=1#h')
    expect(fromProxyUrl('https://google.com/', PB, UP)).toBe('https://google.com/')
  })
})

describe('upstreamUrlFor', () => {
  it('joins origin, path and search', () => {
    expect(upstreamUrlFor(UP, '/a/b', '?q=1')).toBe('https://acme.webflow.io/a/b?q=1')
    expect(upstreamUrlFor(UP, '', '')).toBe('https://acme.webflow.io/')
  })
})

describe('scrubResponseHeaders', () => {
  it('drops framing, cookie and HSTS headers and sets ours', () => {
    const h = new Headers({
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'set-cookie': 'a=b',
      'strict-transport-security': 'max-age=1',
      'content-length': '123',
      'content-encoding': 'gzip',
    })
    const out = scrubResponseHeaders(h, 'https://portal.tahi.studio')
    expect(out.get('content-type')).toBe('text/html')
    expect(out.get('x-frame-options')).toBeNull()
    expect(out.get('set-cookie')).toBeNull()
    expect(out.get('strict-transport-security')).toBeNull()
    expect(out.get('content-length')).toBeNull()
    expect(out.get('content-encoding')).toBeNull()
    expect(out.get('content-security-policy')).toBe('frame-ancestors https://portal.tahi.studio')
    expect(out.get('cache-control')).toBe('no-store')
    expect(out.get('x-robots-tag')).toBe('noindex')
  })
})

describe('classifyRedirect', () => {
  it('keeps same-origin redirects inside the proxy', () => {
    expect(classifyRedirect('/new', 'https://acme.webflow.io/old', UP, PB)).toEqual({ kind: 'internal', location: `${PB}/new` })
  })
  it('flags off-site redirects', () => {
    expect(classifyRedirect('https://other.com/x', 'https://acme.webflow.io/old', UP, PB)).toEqual({ kind: 'external', location: 'https://other.com/x' })
  })
})
```

- [ ] **Step 4: Create `lib/qa/proxy-rules.ts`**

```ts
/**
 * Pure rewrite decisions for workers/qa-view. The worker wires these into
 * HTMLRewriter; keeping them here makes them unit-testable from the root
 * vitest run (which excludes workers/**).
 *
 * proxyBase is `${proxyOrigin}/v/${token}` with no trailing slash.
 */

export function baseHrefFor(upstreamOrigin: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const dir = p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1)
  return `${upstreamOrigin}${dir}`
}

const SKIP_SCHEMES = /^(#|mailto:|tel:|javascript:|data:|sms:)/i

export function rewriteHref(href: string, pageUrl: string, upstreamOrigin: string, proxyBase: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || SKIP_SCHEMES.test(trimmed)) return null
  let resolved: URL
  try {
    resolved = new URL(trimmed, pageUrl)
  } catch {
    return null
  }
  if (resolved.origin !== upstreamOrigin) return null
  return `${proxyBase}${resolved.pathname}${resolved.search}${resolved.hash}`
}

export function fromProxyUrl(href: string, proxyBase: string, upstreamOrigin: string): string {
  if (!href.startsWith(`${proxyBase}/`) && href !== proxyBase) return href
  const rest = href.slice(proxyBase.length) || '/'
  return `${upstreamOrigin}${rest}`
}

export function upstreamUrlFor(upstreamOrigin: string, path: string, search: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${upstreamOrigin}${p}${search}`
}

const DROP = ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'set-cookie', 'strict-transport-security', 'content-length', 'content-encoding', 'transfer-encoding']

export function scrubResponseHeaders(upstream: Headers, parentOrigin: string): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (!DROP.includes(key.toLowerCase())) out.set(key, value)
  })
  out.set('content-security-policy', `frame-ancestors ${parentOrigin}`)
  out.set('cache-control', 'no-store')
  out.set('x-robots-tag', 'noindex')
  return out
}

export type RedirectDecision = { kind: 'internal'; location: string } | { kind: 'external'; location: string }

export function classifyRedirect(location: string, requestUrl: string, upstreamOrigin: string, proxyBase: string): RedirectDecision {
  const resolved = new URL(location, requestUrl)
  if (resolved.origin === upstreamOrigin) {
    return { kind: 'internal', location: `${proxyBase}${resolved.pathname}${resolved.search}${resolved.hash}` }
  }
  return { kind: 'external', location: resolved.toString() }
}
```

- [ ] **Step 5: Run** `npx vitest run lib/qa/__tests__/ssrf.test.ts lib/qa/__tests__/proxy-rules.test.ts` **expect PASS**, then type-check.

- [ ] **Step 6: Commit** `SQA: SSRF guard and proxy rewrite rules [skip ci]`

---

### Task 3: Sitemap parsing and template grouping

**Files:**
- Create: `lib/qa/sitemap.ts`, `lib/qa/grouping.ts`
- Test: `lib/qa/__tests__/sitemap.test.ts`, `lib/qa/__tests__/grouping.test.ts`

- [ ] **Step 1: Write the tests**

`lib/qa/__tests__/sitemap.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseSitemap, normalisePath } from '@/lib/qa/sitemap'

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://acme.com/</loc></url>
      <url><loc> https://acme.com/about </loc></url>
      <url><loc>https://acme.com/search?a=1&amp;b=2</loc></url></urlset>`
    expect(parseSitemap(xml)).toEqual({ kind: 'urlset', locs: ['https://acme.com/', 'https://acme.com/about', 'https://acme.com/search?a=1&b=2'] })
  })
  it('detects an index', () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/sitemap-1.xml</loc></sitemap></sitemapindex>`
    expect(parseSitemap(xml)).toEqual({ kind: 'index', locs: ['https://acme.com/sitemap-1.xml'] })
  })
  it('returns empty for junk', () => {
    expect(parseSitemap('<html>nope</html>')).toEqual({ kind: 'urlset', locs: [] })
  })
})

describe('normalisePath', () => {
  it('takes the pathname and strips trailing slashes except root', () => {
    expect(normalisePath('https://acme.com/')).toBe('/')
    expect(normalisePath('https://acme.com/about/')).toBe('/about')
    expect(normalisePath('https://other-host.com/blog/a')).toBe('/blog/a')
    expect(normalisePath('/team')).toBe('/team')
    expect(normalisePath('team/')).toBe('/team')
  })
  it('returns null for unusable input', () => {
    expect(normalisePath('')).toBeNull()
    expect(normalisePath('mailto:x@y.z')).toBeNull()
  })
})
```

`lib/qa/__tests__/grouping.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeGroups, pickSamples, GROUP_MIN_SIZE } from '@/lib/qa/grouping'

describe('computeGroups', () => {
  it('groups 6+ second-level pages under one first segment', () => {
    const blog = Array.from({ length: GROUP_MIN_SIZE }, (_, i) => `/blog/post-${i}`)
    const groups = computeGroups(['/', '/about', '/blog', ...blog, '/work/a', '/work/b'])
    expect(groups.get('/blog/post-0')).toBe('/blog/*')
    expect(groups.get('/blog')).toBeNull()
    expect(groups.get('/work/a')).toBeNull()
    expect(groups.get('/')).toBeNull()
  })
})

describe('pickSamples', () => {
  it('takes the first n paths of each group, sorted', () => {
    const paths = ['/blog/c', '/blog/a', '/blog/b', '/blog/d']
    expect(pickSamples(paths, 3)).toEqual(['/blog/a', '/blog/b', '/blog/c'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `lib/qa/sitemap.ts`**

```ts
/** Sitemap XML parsing for SQA page import. Pure, regex based (no DOMParser on Workers). */

export interface ParsedSitemap { kind: 'urlset' | 'index'; locs: string[] }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function parseSitemap(xml: string): ParsedSitemap {
  const kind: ParsedSitemap['kind'] = /<sitemapindex[\s>]/i.test(xml) ? 'index' : 'urlset'
  const locs: string[] = []
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) locs.push(decodeEntities(m[1]))
  return { kind, locs }
}

export function normalisePath(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let pathname: string
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname
    } catch {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null
  } else {
    pathname = raw.split(/[?#]/)[0]
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '')
  return pathname || '/'
}

export const SITEMAP_MAX_FILES = 5
export const SITEMAP_MAX_URLS = 2000
```

- [ ] **Step 4: Create `lib/qa/grouping.ts`**

```ts
/**
 * Template groups: 6 or more pages sharing a first segment with a second
 * segment (/blog/a, /blog/b, ...) become one group, keyed '/blog/*'. A round
 * includes only a few samples from each group. Pure.
 */
export const GROUP_MIN_SIZE = 6
export const GROUP_SAMPLE_SIZE = 3

export function computeGroups(paths: string[]): Map<string, string | null> {
  const bySegment = new Map<string, string[]>()
  for (const p of paths) {
    const segs = p.split('/').filter(Boolean)
    if (segs.length >= 2) {
      const list = bySegment.get(segs[0]) ?? []
      list.push(p)
      bySegment.set(segs[0], list)
    }
  }
  const out = new Map<string, string | null>()
  for (const p of paths) out.set(p, null)
  for (const [seg, list] of bySegment) {
    if (list.length >= GROUP_MIN_SIZE) for (const p of list) out.set(p, `/${seg}/*`)
  }
  return out
}

export function pickSamples(groupPaths: string[], n: number = GROUP_SAMPLE_SIZE): string[] {
  return [...groupPaths].sort().slice(0, n)
}
```

- [ ] **Step 5: Run, expect PASS. Type-check.**
- [ ] **Step 6: Commit** `SQA: sitemap parsing and template grouping [skip ci]`

---

### Task 4: Issue rules and counts

**Files:**
- Create: `lib/qa/issue-rules.ts`
- Test: `lib/qa/__tests__/issue-rules.test.ts`, fixture helper inside the test

- [ ] **Step 1: Write `lib/qa/__tests__/issue-rules.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import type { QaScanResult, QaLinkResult } from '@/lib/qa/types'
import { seoIssues, launchIssues, perfIssues, a11yIssues, linkIssues, pageIssues, countIssues, duplicateMetaIssues } from '@/lib/qa/issue-rules'

function scan(over: Partial<QaScanResult> = {}): QaScanResult {
  return {
    a11y: [],
    links: [],
    missingAnchors: [],
    seo: {
      title: 'Acme, web design for builders', metaDescription: 'A'.repeat(80), canonical: 'https://acme.webflow.io/',
      robotsMeta: null, og: { title: 'Acme', description: 'd', image: 'https://x/og.png', url: null },
      h1Count: 1, headingOutline: [], headingSkips: [], jsonLd: { count: 1, parseErrors: 0 }, lang: 'en', favicon: '/favicon.ico',
    },
    content: { imagesMissingAlt: [], stagingLeftovers: [], forms: [] },
    layout: { horizontalOverflow: false, overflowingElements: [] },
    perf: { images: [], totalTransferSize: 0 },
    ...over,
  }
}

describe('seoIssues', () => {
  it('clean page has no issues on staging except the noindex warning', () => {
    const issues = seoIssues(scan().seo, 'staging', 'acme.webflow.io')
    expect(issues.map(i => i.code)).toEqual(['staging_indexable'])
    expect(issues[0].severity).toBe('warn')
  })
  it('flags missing and badly sized fields', () => {
    const s = scan({ seo: { ...scan().seo, title: null, metaDescription: 'short', canonical: null, h1Count: 2, lang: null } }).seo
    const codes = seoIssues(s, 'live', 'acme.com').map(i => i.code)
    expect(codes).toEqual(expect.arrayContaining(['title_missing', 'description_length', 'canonical_missing', 'h1_count', 'lang_missing']))
  })
  it('flags noindex on live and canonical on another host', () => {
    const s = { ...scan().seo, robotsMeta: 'noindex, nofollow', canonical: 'https://acme.webflow.io/' }
    const codes = seoIssues(s, 'live', 'acme.com').map(i => i.code)
    expect(codes).toContain('live_noindex')
    expect(codes).toContain('canonical_host')
  })
})

describe('launchIssues', () => {
  it('counts leftovers, missing alt, overflow per viewport and forms as info', () => {
    const desktop = scan({ content: { imagesMissingAlt: [{ selector: 'img', src: 'a.png' }], stagingLeftovers: [{ kind: 'lorem_ipsum', sample: 'Lorem ipsum', selector: 'p' }], forms: [{ action: null, method: 'get', fieldCount: 2, selector: 'form' }] } })
    const mobile = scan({ layout: { horizontalOverflow: true, overflowingElements: [{ selector: '.hero', width: 500 }] } })
    const issues = launchIssues({ desktop, mobile_p: mobile })
    expect(issues.map(i => i.code).sort()).toEqual(['form_present', 'image_alt_missing', 'horizontal_overflow', 'staging_leftover'].sort())
    expect(issues.find(i => i.code === 'horizontal_overflow')?.viewport).toBe('mobile_p')
    expect(issues.find(i => i.code === 'form_present')?.severity).toBe('info')
  })
})

describe('perfIssues', () => {
  it('flags heavy, oversized and legacy-format images, ignoring svg', () => {
    const img = { src: 'a.jpg', naturalWidth: 4000, naturalHeight: 2000, renderedWidth: 400, renderedHeight: 200, oversized: true, format: 'jpg', transferSize: 600_000 }
    const svg = { ...img, src: 'b.svg', format: 'svg', oversized: false, transferSize: 0 }
    const codes = perfIssues(scan({ perf: { images: [img, svg], totalTransferSize: 600_000 } }).perf, 'desktop').map(i => i.code).sort()
    expect(codes).toEqual(['image_format', 'image_heavy', 'image_oversized'])
  })
})

describe('a11yIssues and countIssues', () => {
  it('maps impacts into counts', () => {
    const s = scan({ a11y: [
      { id: 'color-contrast', impact: 'serious', help: 'h', helpUrl: 'u', nodes: [{ selector: 'a', html: '<a>' }] },
      { id: 'image-alt', impact: 'critical', help: 'h', helpUrl: 'u', nodes: [] },
      { id: 'region', impact: 'moderate', help: 'h', helpUrl: 'u', nodes: [] },
    ] })
    const counts = countIssues([...a11yIssues(s.a11y)])
    expect(counts).toMatchObject({ a11yCritical: 1, a11ySerious: 1, a11yModerate: 1, a11yMinor: 0 })
  })
})

describe('linkIssues', () => {
  it('reports broken links, chains, staging links and missing anchors that appear on the page', () => {
    const s = scan({ links: [{ url: 'https://x.com/a', text: 'A', selector: 'a.a' }, { url: 'https://x.com/b', text: 'B', selector: 'a.b' }], missingAnchors: [{ href: '#nope', selector: 'a.c' }] })
    const results = new Map<string, QaLinkResult>([
      ['https://x.com/a', { url: 'https://x.com/a', finalUrl: null, status: 404, hops: [], broken: true, redirectChain: false, stagingOnLive: false, error: null }],
      ['https://x.com/b', { url: 'https://x.com/b', finalUrl: 'https://x.com/c', status: 200, hops: [{ url: 'https://x.com/b', status: 301 }, { url: 'https://x.com/b2', status: 301 }], broken: false, redirectChain: true, stagingOnLive: false, error: null }],
    ])
    const codes = linkIssues(s, results).map(i => i.code).sort()
    expect(codes).toEqual(['anchor_missing', 'link_broken', 'redirect_chain'])
  })
})

describe('pageIssues', () => {
  it('combines everything and counts', () => {
    const issues = pageIssues({ desktop: scan() }, 'live', 'acme.webflow.io', new Map())
    expect(countIssues(issues).seoIssues).toBe(0)
  })
})

describe('duplicateMetaIssues', () => {
  it('finds titles shared by more than one page', () => {
    const dupes = duplicateMetaIssues([
      { path: '/a', title: 'Same', description: 'x' },
      { path: '/b', title: 'Same', description: 'y' },
      { path: '/c', title: 'Other', description: 'y' },
    ])
    expect(dupes.get('/a')?.map(i => i.code)).toEqual(['title_duplicate'])
    expect(dupes.get('/b')?.map(i => i.code).sort()).toEqual(['description_duplicate', 'title_duplicate'])
    expect(dupes.get('/c')?.map(i => i.code)).toEqual(['description_duplicate'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Create `lib/qa/issue-rules.ts`**

```ts
/**
 * Turns scan and link results into QaIssue lists and the integer counts
 * stored on qa_round_pages. Pure. Rules are listed in the SQA spec.
 */
import type {
  QaContent, QaIssue, QaLinkResult, QaPageCounts, QaPerf, QaScanResult, QaSeo, QaTarget, QaViewportKey, QaA11yViolation,
} from './types'
import { QA_PRIMARY_VIEWPORT } from './types'

const LEGACY_FORMATS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp'])
const HEAVY_IMAGE_BYTES = 500_000

export function seoIssues(seo: QaSeo, target: QaTarget, targetHost: string): QaIssue[] {
  const out: QaIssue[] = []
  const add = (code: string, severity: QaIssue['severity'], message: string) => out.push({ category: 'seo', code, severity, message })

  if (!seo.title) add('title_missing', 'fail', 'Page has no <title>.')
  else if (seo.title.length > 60 || seo.title.length < 15) add('title_length', 'warn', `Title is ${seo.title.length} characters (aim for 15 to 60).`)

  if (!seo.metaDescription) add('description_missing', 'fail', 'Page has no meta description.')
  else if (seo.metaDescription.length > 160 || seo.metaDescription.length < 50) add('description_length', 'warn', `Meta description is ${seo.metaDescription.length} characters (aim for 50 to 160).`)

  if (!seo.canonical) add('canonical_missing', 'warn', 'No canonical link.')
  else {
    let host = ''
    try { host = new URL(seo.canonical).hostname } catch { host = '' }
    if (host && host !== targetHost) add('canonical_host', 'fail', `Canonical points at ${host}, not ${targetHost}.`)
  }

  const noindex = (seo.robotsMeta ?? '').toLowerCase().includes('noindex')
  if (target === 'live' && noindex) add('live_noindex', 'fail', 'Live page is set to noindex.')
  if (target === 'staging' && !noindex) add('staging_indexable', 'warn', 'Staging page is indexable (no noindex).')

  if (!seo.og.title) add('og_title_missing', 'warn', 'No og:title.')
  if (!seo.og.image) add('og_image_missing', 'warn', 'No og:image, so shared links have no preview image.')
  if (seo.h1Count !== 1) add('h1_count', 'fail', `Page has ${seo.h1Count} H1 headings (should be exactly 1).`)
  for (const skip of seo.headingSkips) add('heading_skip', 'warn', `Heading jumps from H${skip.from} to H${skip.to} at "${skip.text}".`)
  if (seo.jsonLd.parseErrors > 0) add('jsonld_invalid', 'fail', `${seo.jsonLd.parseErrors} JSON-LD block(s) fail to parse.`)
  if (!seo.lang) add('lang_missing', 'warn', 'The <html> element has no lang attribute.')
  return out
}

export function launchIssues(scans: Partial<Record<QaViewportKey, QaScanResult>>): QaIssue[] {
  const out: QaIssue[] = []
  const primary = scans[QA_PRIMARY_VIEWPORT] ?? Object.values(scans)[0]
  if (primary) {
    const c: QaContent = primary.content
    for (const l of c.stagingLeftovers) out.push({ category: 'launch', code: 'staging_leftover', severity: 'fail', message: `Leftover ${l.kind.replace('_', ' ')}: "${l.sample}"`, selector: l.selector })
    for (const img of c.imagesMissingAlt) out.push({ category: 'launch', code: 'image_alt_missing', severity: 'fail', message: `Image has no alt text (${img.src}).`, selector: img.selector })
    for (const f of c.forms) out.push({ category: 'launch', code: 'form_present', severity: 'info', message: `Form with ${f.fieldCount} fields: send a test submission and tick when it arrives.`, selector: f.selector })
  }
  for (const [vp, s] of Object.entries(scans) as [QaViewportKey, QaScanResult][]) {
    if (s.layout.horizontalOverflow) {
      const first = s.layout.overflowingElements[0]
      out.push({ category: 'launch', code: 'horizontal_overflow', severity: 'fail', message: `Page scrolls sideways${first ? ` (widest: ${first.selector}, ${first.width}px)` : ''}.`, selector: first?.selector, viewport: vp })
    }
  }
  return out
}

export function perfIssues(perf: QaPerf, viewport: QaViewportKey): QaIssue[] {
  const out: QaIssue[] = []
  for (const img of perf.images) {
    if (img.format === 'svg') continue
    if (img.transferSize > HEAVY_IMAGE_BYTES) out.push({ category: 'perf', code: 'image_heavy', severity: 'fail', message: `Image is ${Math.round(img.transferSize / 1000)} KB (${img.src}).`, viewport, url: img.src })
    if (img.oversized) out.push({ category: 'perf', code: 'image_oversized', severity: 'warn', message: `Image is ${img.naturalWidth}px wide but shown at ${img.renderedWidth}px (${img.src}).`, viewport, url: img.src })
    if (LEGACY_FORMATS.has(img.format)) out.push({ category: 'perf', code: 'image_format', severity: 'warn', message: `Image is ${img.format.toUpperCase()}, not WebP or AVIF (${img.src}).`, viewport, url: img.src })
  }
  return out
}

export function a11yIssues(violations: QaA11yViolation[]): QaIssue[] {
  return violations.map(v => ({
    category: 'a11y' as const,
    code: `axe_${v.impact ?? 'minor'}`,
    severity: v.impact === 'critical' || v.impact === 'serious' ? 'fail' as const : 'warn' as const,
    message: `${v.help} (${v.id}, ${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})`,
    selector: v.nodes[0]?.selector,
    url: v.helpUrl,
  }))
}

export function linkIssues(primary: QaScanResult, results: Map<string, QaLinkResult>): QaIssue[] {
  const out: QaIssue[] = []
  const seen = new Set<string>()
  for (const link of primary.links) {
    if (seen.has(link.url)) continue
    seen.add(link.url)
    const r = results.get(link.url)
    if (!r) continue
    if (r.broken) out.push({ category: 'links', code: 'link_broken', severity: 'fail', message: `Broken link "${link.text}" (${r.status ?? r.error ?? 'no response'}): ${link.url}`, selector: link.selector, url: link.url })
    else if (r.redirectChain) out.push({ category: 'links', code: 'redirect_chain', severity: 'warn', message: `Link redirects ${r.hops.length} times: ${link.url}`, selector: link.selector, url: link.url })
    if (r.stagingOnLive) out.push({ category: 'links', code: 'staging_link', severity: 'fail', message: `Live page links to staging: ${link.url}`, selector: link.selector, url: link.url })
  }
  for (const a of primary.missingAnchors) out.push({ category: 'links', code: 'anchor_missing', severity: 'fail', message: `In-page link ${a.href} points at an id that does not exist.`, selector: a.selector })
  return out
}

export function pageIssues(
  scans: Partial<Record<QaViewportKey, QaScanResult>>,
  target: QaTarget,
  targetHost: string,
  linkResults: Map<string, QaLinkResult>,
): QaIssue[] {
  const primary = scans[QA_PRIMARY_VIEWPORT] ?? Object.values(scans)[0]
  if (!primary) return []
  const perf = (Object.entries(scans) as [QaViewportKey, QaScanResult][]).flatMap(([vp, s]) => perfIssues(s.perf, vp))
  // An image flagged at several widths is one problem: keep the first per code + url.
  const perfSeen = new Set<string>()
  const perfDeduped = perf.filter(i => {
    const k = `${i.code}|${i.url}`
    if (perfSeen.has(k)) return false
    perfSeen.add(k)
    return true
  })
  return [
    ...a11yIssues(primary.a11y),
    ...linkIssues(primary, linkResults),
    ...seoIssues(primary.seo, target, targetHost),
    ...launchIssues(scans),
    ...perfDeduped,
  ]
}

export function countIssues(issues: QaIssue[]): QaPageCounts {
  const c: QaPageCounts = { a11yCritical: 0, a11ySerious: 0, a11yModerate: 0, a11yMinor: 0, brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0 }
  for (const i of issues) {
    if (i.category === 'a11y') {
      if (i.code === 'axe_critical') c.a11yCritical++
      else if (i.code === 'axe_serious') c.a11ySerious++
      else if (i.code === 'axe_moderate') c.a11yModerate++
      else c.a11yMinor++
    } else if (i.category === 'links') c.brokenLinks++
    else if (i.category === 'seo' && i.severity !== 'info') c.seoIssues++
    else if (i.category === 'launch' && i.severity !== 'info') c.launchIssues++
    else if (i.category === 'perf') c.perfIssues++
  }
  return c
}

export function duplicateMetaIssues(pages: { path: string; title: string | null; description: string | null }[]): Map<string, QaIssue[]> {
  const byTitle = new Map<string, string[]>()
  const byDesc = new Map<string, string[]>()
  for (const p of pages) {
    if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.path])
    if (p.description) byDesc.set(p.description, [...(byDesc.get(p.description) ?? []), p.path])
  }
  const out = new Map<string, QaIssue[]>()
  const push = (path: string, issue: QaIssue) => out.set(path, [...(out.get(path) ?? []), issue])
  for (const [title, paths] of byTitle) if (paths.length > 1) for (const p of paths) push(p, { category: 'seo', code: 'title_duplicate', severity: 'warn', message: `Title "${title}" is also used on ${paths.length - 1} other page(s).` })
  for (const [, paths] of byDesc) if (paths.length > 1) for (const p of paths) push(p, { category: 'seo', code: 'description_duplicate', severity: 'warn', message: `Meta description is also used on ${paths.length - 1} other page(s).` })
  return out
}
```

- [ ] **Step 4: Run, expect PASS. Type-check.**
- [ ] **Step 5: Commit** `SQA: issue rules and counts [skip ci]`

---

### Task 5: Link checker and site checks (pure, injected fetch)

**Files:**
- Create: `lib/qa/link-check.ts`, `lib/qa/site-checks.ts`
- Test: `lib/qa/__tests__/link-check.test.ts`, `lib/qa/__tests__/site-checks.test.ts`

- [ ] **Step 1: Write `lib/qa/__tests__/link-check.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { checkLink, checkLinks, type FetchLike } from '@/lib/qa/link-check'

function fakeFetch(routes: Record<string, { status: number; location?: string } | 'throw'>): FetchLike {
  return async (url, init) => {
    const r = routes[url]
    if (!r || r === 'throw') throw new Error('network')
    if (init.method === 'HEAD' && r.status === 405) return new Response(null, { status: 405 })
    const headers = new Headers()
    if (r.location) headers.set('location', r.location)
    return new Response(null, { status: r.status, headers })
  }
}

describe('checkLink', () => {
  it('ok on 200', async () => {
    const r = await checkLink('https://a.com/', { fetch: fakeFetch({ 'https://a.com/': { status: 200 } }), target: 'live' })
    expect(r).toMatchObject({ status: 200, broken: false, redirectChain: false, finalUrl: 'https://a.com/' })
  })
  it('broken on 404 and on network error', async () => {
    expect((await checkLink('https://a.com/x', { fetch: fakeFetch({ 'https://a.com/x': { status: 404 } }), target: 'live' })).broken).toBe(true)
    const err = await checkLink('https://a.com/y', { fetch: fakeFetch({}), target: 'live' })
    expect(err.broken).toBe(true)
    expect(err.error).toBe('network')
  })
  it('follows redirects and flags chains of 2+ hops', async () => {
    const f = fakeFetch({
      'https://a.com/1': { status: 301, location: '/2' },
      'https://a.com/2': { status: 302, location: 'https://a.com/3' },
      'https://a.com/3': { status: 200 },
    })
    const r = await checkLink('https://a.com/1', { fetch: f, target: 'live' })
    expect(r.finalUrl).toBe('https://a.com/3')
    expect(r.hops).toHaveLength(2)
    expect(r.redirectChain).toBe(true)
  })
  it('flags staging links on a live round', async () => {
    const r = await checkLink('https://acme.webflow.io/', { fetch: fakeFetch({ 'https://acme.webflow.io/': { status: 200 } }), target: 'live' })
    expect(r.stagingOnLive).toBe(true)
  })
  it('refuses unsafe URLs without fetching', async () => {
    const r = await checkLink('http://127.0.0.1/', { fetch: fakeFetch({}), target: 'live' })
    expect(r).toMatchObject({ broken: false, error: 'skipped_unsafe' })
  })
  it('skips non-http links', async () => {
    const r = await checkLink('mailto:a@b.com', { fetch: fakeFetch({}), target: 'live' })
    expect(r.error).toBe('skipped_scheme')
  })
})

describe('checkLinks', () => {
  it('dedupes and returns one result per unique URL', async () => {
    const f = fakeFetch({ 'https://a.com/': { status: 200 } })
    const out = await checkLinks(['https://a.com/', 'https://a.com/'], { fetch: f, target: 'staging' })
    expect(out).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Create `lib/qa/link-check.ts`**

```ts
/**
 * Server-side link checking with an injected fetch (testable, and the route
 * passes globalThis.fetch). HEAD first, GET on 405/501, manual redirects up
 * to 5 hops, 8s timeout per request, concurrency 6.
 */
import type { QaLinkResult, QaTarget } from './types'
import { isSafePublicUrl } from './ssrf'

export type FetchLike = (url: string, init: RequestInit & { method: string }) => Promise<Response>

export interface LinkCheckOptions { fetch: FetchLike; target: QaTarget; timeoutMs?: number; maxHops?: number }

const MAX_HOPS = 5
const TIMEOUT_MS = 8000
const CONCURRENCY = 6

async function request(f: FetchLike, url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await f(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'TahiQA/1.0 (+https://tahi.studio)' } })
  } finally {
    clearTimeout(timer)
  }
}

function isStaging(url: string): boolean {
  try { return new URL(url).hostname.endsWith('.webflow.io') } catch { return false }
}

export async function checkLink(url: string, opts: LinkCheckOptions): Promise<QaLinkResult> {
  const base: QaLinkResult = { url, finalUrl: null, status: null, hops: [], broken: false, redirectChain: false, stagingOnLive: opts.target === 'live' && isStaging(url), error: null }
  if (!/^https?:\/\//i.test(url)) return { ...base, error: 'skipped_scheme' }
  if (!isSafePublicUrl(url)) return { ...base, error: 'skipped_unsafe' }
  const maxHops = opts.maxHops ?? MAX_HOPS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  let current = url
  const hops: QaLinkResult['hops'] = []
  try {
    for (let i = 0; i <= maxHops; i++) {
      let res = await request(opts.fetch, current, 'HEAD', timeoutMs)
      if (res.status === 405 || res.status === 501) res = await request(opts.fetch, current, 'GET', timeoutMs)
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        hops.push({ url: current, status: res.status })
        current = new URL(location, current).toString()
        if (!isSafePublicUrl(current)) return { ...base, hops, error: 'skipped_unsafe' }
        continue
      }
      return { ...base, finalUrl: current, status: res.status, hops, broken: res.status >= 400, redirectChain: hops.length >= 2 }
    }
    return { ...base, hops, broken: true, error: 'too_many_redirects' }
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'error'
    return { ...base, hops, broken: true, error: message }
  }
}

export async function checkLinks(urls: string[], opts: LinkCheckOptions): Promise<QaLinkResult[]> {
  const unique = [...new Set(urls)]
  const results: QaLinkResult[] = new Array(unique.length)
  let next = 0
  async function worker() {
    while (next < unique.length) {
      const i = next++
      results[i] = await checkLink(unique[i], opts)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))
  return results
}
```

- [ ] **Step 3: Write `lib/qa/__tests__/site-checks.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { runSiteChecks } from '@/lib/qa/site-checks'
import type { FetchLike } from '@/lib/qa/link-check'

function f(map: Record<string, { status: number; body?: string; location?: string }>): FetchLike {
  return async url => {
    const r = map[url]
    if (!r) return new Response(null, { status: 404 })
    const h = new Headers()
    if (r.location) h.set('location', r.location)
    return new Response(r.body ?? null, { status: r.status, headers: h })
  }
}

describe('runSiteChecks', () => {
  it('passes a healthy live site', async () => {
    const checks = await runSiteChecks('https://www.acme.com', 'live', f({
      'https://www.acme.com/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
      'https://www.acme.com/sitemap.xml': { status: 200, body: '<urlset></urlset>' },
      'http://www.acme.com/': { status: 301, location: 'https://www.acme.com/' },
      'https://acme.com/': { status: 301, location: 'https://www.acme.com/' },
      'https://www.acme.com/favicon.ico': { status: 200 },
    }))
    expect(checks.map(c => [c.code, c.result])).toEqual([
      ['robots', 'pass'], ['sitemap', 'pass'], ['https_redirect', 'pass'], ['www_canonical', 'pass'], ['favicon', 'pass'],
    ])
  })
  it('fails robots that block everything and skips live-only checks on staging', async () => {
    const checks = await runSiteChecks('https://acme.webflow.io', 'staging', f({
      'https://acme.webflow.io/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' },
    }))
    expect(checks.find(c => c.code === 'robots')?.result).toBe('warn')
    expect(checks.find(c => c.code === 'sitemap')?.result).toBe('fail')
    expect(checks.some(c => c.code === 'https_redirect')).toBe(false)
  })
})
```

Note: on staging a robots.txt that disallows everything is expected, so it is a `warn` (shown, not failing). On live it is a `fail`.

- [ ] **Step 4: Create `lib/qa/site-checks.ts`**

```ts
/** Whole-site checks for a round. Pure with an injected fetch. */
import type { QaTarget } from './types'
import type { FetchLike } from './link-check'

export interface QaSiteCheck { code: 'robots' | 'sitemap' | 'https_redirect' | 'www_canonical' | 'favicon'; result: 'pass' | 'warn' | 'fail'; detail: string }

async function get(f: FetchLike, url: string): Promise<Response | null> {
  try { return await f(url, { method: 'GET', redirect: 'manual' }) } catch { return null }
}

export async function runSiteChecks(origin: string, target: QaTarget, f: FetchLike): Promise<QaSiteCheck[]> {
  const out: QaSiteCheck[] = []
  const u = new URL(origin)

  const robots = await get(f, `${origin}/robots.txt`)
  if (!robots || robots.status !== 200) out.push({ code: 'robots', result: 'warn', detail: 'No robots.txt.' })
  else {
    const body = await robots.text()
    const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(body)
    out.push(blocksAll
      ? { code: 'robots', result: target === 'live' ? 'fail' : 'warn', detail: 'robots.txt blocks the whole site.' }
      : { code: 'robots', result: 'pass', detail: 'robots.txt present.' })
  }

  const sitemap = await get(f, `${origin}/sitemap.xml`)
  out.push(sitemap && sitemap.status === 200
    ? { code: 'sitemap', result: 'pass', detail: 'sitemap.xml present.' }
    : { code: 'sitemap', result: 'fail', detail: 'No sitemap.xml.' })

  if (target === 'live') {
    const http = await get(f, `http://${u.host}/`)
    const loc = http?.headers.get('location') ?? ''
    out.push(http && http.status >= 300 && http.status < 400 && loc.startsWith('https://')
      ? { code: 'https_redirect', result: 'pass', detail: 'http redirects to https.' }
      : { code: 'https_redirect', result: 'fail', detail: 'http does not redirect to https.' })

    const otherHost = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
    const other = await get(f, `https://${otherHost}/`)
    const otherLoc = other?.headers.get('location') ?? ''
    let pointsHome = false
    try { pointsHome = new URL(otherLoc, `https://${otherHost}/`).hostname === u.hostname } catch { pointsHome = false }
    out.push(other && other.status >= 300 && other.status < 400 && pointsHome
      ? { code: 'www_canonical', result: 'pass', detail: `${otherHost} redirects to ${u.hostname}.` }
      : { code: 'www_canonical', result: 'warn', detail: `${otherHost} does not redirect to ${u.hostname}.` })
  }

  const fav = await get(f, `${origin}/favicon.ico`)
  out.push(fav && fav.status === 200
    ? { code: 'favicon', result: 'pass', detail: 'favicon.ico reachable.' }
    : { code: 'favicon', result: 'warn', detail: 'No /favicon.ico (fine if the page declares an icon link; check the SEO tab).' })
  return out
}
```

- [ ] **Step 5: Run both tests, expect PASS. Type-check.**
- [ ] **Step 6: Commit** `SQA: link checker and site checks [skip ci]`

---

### Task 6: Schema, migration 0115, feature key

**Files:**
- Modify: `db/schema.ts` (append at end), `lib/feature-tree.ts` (add key), `app/api/admin/db/migrate/route.ts` (add entry after `'0114'`)
- Create: `lib/qa-migration.ts`, `drizzle/migrations/0115_site_qa.sql`
- Test: `lib/__tests__/qa-migration.test.ts`

- [ ] **Step 1: Append to `db/schema.ts`** (match existing style; `index`, `uniqueIndex` are already imported):

```ts
// ── Site QA (SQA, migration 0115) ─────────────────────────────────────────
// Client-website QA: sites per client, pages imported from sitemap.xml, named
// rounds with five viewport ticks per page, stored scan results and link checks.
// See docs/superpowers/specs/2026-10-26-site-qa-tester-design.md.

export const qaSites = sqliteTable('qa_sites', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  stagingUrl: text('staging_url'),
  liveUrl: text('live_url'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  archivedAt: text('archived_at'),
}, t => [index('idx_qa_sites_org').on(t.orgId)])

export const qaPages = sqliteTable('qa_pages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id').notNull(),
  path: text('path').notNull(),
  title: text('title'),
  groupKey: text('group_key'),
  // 'sitemap' | 'manual'
  source: text('source').notNull().default('sitemap'),
  removedAt: text('removed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('idx_qa_pages_site_path').on(t.siteId, t.path)])

export const qaRounds = sqliteTable('qa_rounds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id').notNull(),
  name: text('name').notNull(),
  // 'staging' | 'live'
  target: text('target').notNull(),
  // 'open' | 'closed'
  status: text('status').notNull().default('open'),
  // JSON QaSiteCheck[]
  siteChecks: text('site_checks'),
  siteChecksAt: text('site_checks_at'),
  // JSON QaLinkResult[] for the pasted old-site URLs
  redirectMap: text('redirect_map'),
  redirectMapAt: text('redirect_map_at'),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  closedAt: text('closed_at'),
}, t => [index('idx_qa_rounds_site').on(t.siteId)])

export const qaRoundPages = sqliteTable('qa_round_pages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundId: text('round_id').notNull(),
  pageId: text('page_id').notNull(),
  path: text('path').notNull(),
  groupKey: text('group_key'),
  sortOrder: integer('sort_order').notNull().default(0),
  vpXl: integer('vp_xl').notNull().default(0),
  vpDesktop: integer('vp_desktop').notNull().default(0),
  vpTablet: integer('vp_tablet').notNull().default(0),
  vpMobileL: integer('vp_mobile_l').notNull().default(0),
  vpMobileP: integer('vp_mobile_p').notNull().default(0),
  // 'untested' | 'pass' | 'fail'
  status: text('status').notNull().default('untested'),
  note: text('note'),
  // JSON string[] of request ids created from this page's issues
  requestIds: text('request_ids'),
  a11yCritical: integer('a11y_critical'),
  a11ySerious: integer('a11y_serious'),
  a11yModerate: integer('a11y_moderate'),
  a11yMinor: integer('a11y_minor'),
  brokenLinks: integer('broken_links'),
  seoIssues: integer('seo_issues'),
  launchIssues: integer('launch_issues'),
  perfIssues: integer('perf_issues'),
  scannedAt: text('scanned_at'),
  // JSON { mobile?: PsiSummary, desktop?: PsiSummary }
  pagespeed: text('pagespeed'),
  pagespeedAt: text('pagespeed_at'),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_qa_round_pages_round_page').on(t.roundId, t.pageId),
  index('idx_qa_round_pages_page').on(t.pageId),
])

export const qaScanResults = sqliteTable('qa_scan_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundPageId: text('round_page_id').notNull(),
  // QaViewportKey
  viewport: text('viewport').notNull(),
  // JSON QaScanResult
  result: text('result').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_qa_scan_results_page_vp').on(t.roundPageId, t.viewport)])

export const qaLinkResults = sqliteTable('qa_link_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  roundId: text('round_id').notNull(),
  url: text('url').notNull(),
  finalUrl: text('final_url'),
  status: integer('status'),
  hops: text('hops'),
  broken: integer('broken').notNull().default(0),
  redirectChain: integer('redirect_chain').notNull().default(0),
  stagingOnLive: integer('staging_on_live').notNull().default(0),
  error: text('error'),
  checkedAt: text('checked_at').notNull(),
}, t => [uniqueIndex('idx_qa_link_results_round_url').on(t.roundId, t.url)])
```

Before writing this, grep `db/schema.ts` for how other tables declare their index callback (`(t) => [...]` array or `(t) => ({...})` object) and use the same form.

- [ ] **Step 2: Create `lib/qa-migration.ts`** (statements must match the schema exactly):

```ts
/** Additive SQA migration, mirrored in drizzle/migrations/0115. */
export const SITE_QA_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS qa_sites (id text PRIMARY KEY NOT NULL, org_id text NOT NULL, name text NOT NULL, staging_url text, live_url text, notes text, created_by text, created_at text NOT NULL, updated_at text NOT NULL, archived_at text)`,
  `CREATE INDEX IF NOT EXISTS idx_qa_sites_org ON qa_sites(org_id)`,
  `CREATE TABLE IF NOT EXISTS qa_pages (id text PRIMARY KEY NOT NULL, site_id text NOT NULL, path text NOT NULL, title text, group_key text, source text NOT NULL DEFAULT 'sitemap', removed_at text, created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_pages_site_path ON qa_pages(site_id, path)`,
  `CREATE TABLE IF NOT EXISTS qa_rounds (id text PRIMARY KEY NOT NULL, site_id text NOT NULL, name text NOT NULL, target text NOT NULL, status text NOT NULL DEFAULT 'open', site_checks text, site_checks_at text, redirect_map text, redirect_map_at text, created_by text, created_at text NOT NULL, closed_at text)`,
  `CREATE INDEX IF NOT EXISTS idx_qa_rounds_site ON qa_rounds(site_id)`,
  `CREATE TABLE IF NOT EXISTS qa_round_pages (id text PRIMARY KEY NOT NULL, round_id text NOT NULL, page_id text NOT NULL, path text NOT NULL, group_key text, sort_order integer NOT NULL DEFAULT 0, vp_xl integer NOT NULL DEFAULT 0, vp_desktop integer NOT NULL DEFAULT 0, vp_tablet integer NOT NULL DEFAULT 0, vp_mobile_l integer NOT NULL DEFAULT 0, vp_mobile_p integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'untested', note text, request_ids text, a11y_critical integer, a11y_serious integer, a11y_moderate integer, a11y_minor integer, broken_links integer, seo_issues integer, launch_issues integer, perf_issues integer, scanned_at text, pagespeed text, pagespeed_at text, updated_by text, updated_at text NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_round_pages_round_page ON qa_round_pages(round_id, page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qa_round_pages_page ON qa_round_pages(page_id)`,
  `CREATE TABLE IF NOT EXISTS qa_scan_results (id text PRIMARY KEY NOT NULL, round_page_id text NOT NULL, viewport text NOT NULL, result text NOT NULL, created_at text NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_scan_results_page_vp ON qa_scan_results(round_page_id, viewport)`,
  `CREATE TABLE IF NOT EXISTS qa_link_results (id text PRIMARY KEY NOT NULL, round_id text NOT NULL, url text NOT NULL, final_url text, status integer, hops text, broken integer NOT NULL DEFAULT 0, redirect_chain integer NOT NULL DEFAULT 0, staging_on_live integer NOT NULL DEFAULT 0, error text, checked_at text NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_link_results_round_url ON qa_link_results(round_id, url)`,
] as const
```

- [ ] **Step 3: Create `drizzle/migrations/0115_site_qa.sql`**: a header comment (copy the tone of `0100_feedback_comments.sql`: what SQA is, additive, IF NOT EXISTS, apply before deploy), then every statement from `SITE_QA_MIGRATION` each ending with `;`.

- [ ] **Step 4: Register in `app/api/admin/db/migrate/route.ts`**: import `SITE_QA_MIGRATION` from `@/lib/qa-migration` next to the `RECORDER_DEVICES_MIGRATION` import, and add after the `'0114'` entry:

```ts
  {
    name: '0115',
    description: 'Site QA (SQA): qa_sites, qa_pages, qa_rounds, qa_round_pages, qa_scan_results, qa_link_results. Additive, IF NOT EXISTS. Apply BEFORE deploying the /qa routes.',
    statements: [...SITE_QA_MIGRATION],
  },
```

- [ ] **Step 5: Add the feature key** in `lib/feature-tree.ts` directly after the `clients` entry, same shape:

```ts
  { key: 'qa_tester', label: 'Site QA', description: 'QA client websites: page checklist, viewports, link, accessibility and SEO checks.', parent: null, appliesTo: ['team'], route: '/qa' },
```

Then grep the repo for other lists that must name every feature key (for example `grep -rn "'sitemap'" lib/*.ts components/tahi/*.tsx | grep -v test`) and add `qa_tester` wherever a list enumerates all keys. Report what you changed.

- [ ] **Step 6: Write `lib/__tests__/qa-migration.test.ts`** (copy the shape of `lib/recorder-devices-migration.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SITE_QA_MIGRATION } from '@/lib/qa-migration'

describe('site QA migration 0115', () => {
  it('is additive and re-run safe', () => {
    for (const s of SITE_QA_MIGRATION) expect(s).toMatch(/IF NOT EXISTS/)
  })
  it('the SQL file carries every statement', () => {
    const sql = readFileSync('drizzle/migrations/0115_site_qa.sql', 'utf8').replace(/\s+/g, ' ')
    for (const s of SITE_QA_MIGRATION) expect(sql).toContain(s.replace(/\s+/g, ' '))
  })
})
```

- [ ] **Step 7: Apply locally:** read `docs/local-dev-and-qa.md` for the local D1 apply command and apply `drizzle/migrations/0115_site_qa.sql` to the local D1 only. Never `--remote`.

- [ ] **Step 8: Run** `npx vitest run lib/__tests__/qa-migration.test.ts app/api/__tests__/admin-route-guard-walk.test.ts`, type-check, lint. **Commit** `SQA: schema, migration 0115 and qa_tester feature key [skip ci]`

---

### Task 7: The qa-view proxy worker and scanner

**Files:**
- Create: `workers/qa-view/package.json`, `workers/qa-view/wrangler.jsonc`, `workers/qa-view/tsconfig.json`, `workers/qa-view/README.md`, `workers/qa-view/build-scanner.mjs`, `workers/qa-view/src/index.ts`, `workers/qa-view/src/scanner/index.ts`, `workers/qa-view/src/scanner/collect.ts`, `.github/workflows/qa-view-deploy.yml`
- Modify: `.gitignore` (add `workers/qa-view/src/generated/`)

- [ ] **Step 1: package.json** (copy `workers/mcp-server/package.json` and add axe-core and esbuild):

```json
{
  "name": "tahi-qa-view",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build:scanner": "node build-scanner.mjs",
    "dev": "npm run build:scanner && wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": { "axe-core": "4.11.1" },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250410.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.14.0"
  }
}
```

Run `npm install` inside `workers/qa-view` to create `package-lock.json` (committed).

- [ ] **Step 2: wrangler.jsonc**

```jsonc
{
  // Site QA sandbox proxy. Serves client pages on THIS origin, never the
  // dashboard's, so client-site JavaScript can never read dashboard cookies.
  //
  // Secrets (set with `wrangler secret put <NAME>` from workers/qa-view):
  //   QA_VIEW_SECRET   same value as the dashboard's QA_VIEW_SECRET; verifies view tokens
  //
  // Declared as comments on purpose: a `vars` entry with an empty value would
  // shadow the real secret at deploy time.
  "name": "tahi-qa-view",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-12",
  "observability": { "enabled": true },
  "build": { "command": "node build-scanner.mjs" },
  "rules": [{ "type": "Text", "globs": ["**/*.bundle.js"], "fallthrough": false }]
}
```

- [ ] **Step 3: tsconfig.json**: copy `workers/mcp-server/tsconfig.json` verbatim, then add `"DOM"` to `lib` (the scanner uses DOM types). Also check the root `npm run type-check` still passes, since the root tsconfig includes `workers/**`; if the scanner's DOM usage conflicts with the worker types at root, add `"workers/qa-view"` to the root `tsconfig.json` `exclude` and add a `type-check` script to the worker package (`tsc --noEmit -p .`) instead. Report which you did.

- [ ] **Step 4: build-scanner.mjs**

```js
// Bundles src/scanner/index.ts (plus axe-core) into one browser IIFE that the
// worker serves as text at /__qa/scanner.js. Runs before every wrangler deploy
// (wrangler.jsonc "build") and on `npm run dev`.
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('src/generated', { recursive: true })
await build({
  entryPoints: ['src/scanner/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  outfile: 'src/generated/scanner.bundle.js',
  legalComments: 'none',
})
```

Add `declare module '*.bundle.js' { const text: string; export default text }` in `workers/qa-view/src/env.d.ts`.

- [ ] **Step 5: `src/scanner/collect.ts`**: DOM collectors returning the `QaScanResult` pieces. Import types from `../../../../lib/qa/types` and `fromProxyUrl` from `../../../../lib/qa/proxy-rules`. Implement exactly:

```ts
import type { QaContent, QaLayout, QaLink, QaMissingAnchor, QaPerf, QaPerfImage, QaSeo } from '../../../../lib/qa/types'
import { fromProxyUrl } from '../../../../lib/qa/proxy-rules'

export function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === 1 && parts.length < 8) {
    let part = node.tagName.toLowerCase()
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift(`#${node.id}`); break }
    const parent: Element | null = node.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter(c => c.tagName === node!.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(' > ')
}

const text = (el: Element | null, max = 120) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute('content') ?? null

export function collectSeo(doc: Document): QaSeo {
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))
  const outline = headings.slice(0, 50).map(h => ({ level: Number(h.tagName[1]), text: text(h, 80) }))
  const skips: QaSeo['headingSkips'] = []
  for (let i = 1; i < outline.length; i++) {
    if (outline[i].level > outline[i - 1].level + 1) skips.push({ from: outline[i - 1].level, to: outline[i].level, text: outline[i].text })
  }
  const ld = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
  let parseErrors = 0
  for (const s of ld) { try { JSON.parse(s.textContent ?? '') } catch { parseErrors++ } }
  return {
    title: doc.title.trim() || null,
    metaDescription: meta(doc, 'meta[name="description"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    robotsMeta: meta(doc, 'meta[name="robots"]'),
    og: {
      title: meta(doc, 'meta[property="og:title"]'),
      description: meta(doc, 'meta[property="og:description"]'),
      image: meta(doc, 'meta[property="og:image"]'),
      url: meta(doc, 'meta[property="og:url"]'),
    },
    h1Count: doc.querySelectorAll('h1').length,
    headingOutline: outline,
    headingSkips: skips,
    jsonLd: { count: ld.length, parseErrors },
    lang: doc.documentElement.getAttribute('lang'),
    favicon: doc.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null,
  }
}

export function collectLinks(doc: Document, proxyBase: string, upstreamOrigin: string): { links: QaLink[]; missingAnchors: QaMissingAnchor[] } {
  const links: QaLink[] = []
  const missingAnchors: QaMissingAnchor[] = []
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const raw = a.getAttribute('href') ?? ''
    if (raw.startsWith('#')) {
      const id = decodeURIComponent(raw.slice(1))
      if (id && !doc.getElementById(id)) missingAnchors.push({ href: raw, selector: cssPath(a) })
      continue
    }
    const abs = (a as HTMLAnchorElement).href
    if (!/^https?:/i.test(abs)) continue
    links.push({ url: fromProxyUrl(abs, proxyBase, upstreamOrigin).split('#')[0], text: text(a) || (a.getAttribute('aria-label') ?? ''), selector: cssPath(a) })
  }
  return { links, missingAnchors }
}

export function collectContent(doc: Document): QaContent {
  const imagesMissingAlt = Array.from(doc.querySelectorAll('img'))
    .filter(img => !img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation')
    .slice(0, 50)
    .map(img => ({ selector: cssPath(img), src: img.getAttribute('src') ?? '' }))
  const stagingLeftovers: QaContent['stagingLeftovers'] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode()) && stagingLeftovers.length < 30) {
    const t = n.textContent ?? ''
    if (/lorem ipsum/i.test(t)) stagingLeftovers.push({ kind: 'lorem_ipsum', sample: t.trim().slice(0, 80), selector: n.parentElement ? cssPath(n.parentElement) : 'body' })
  }
  for (const el of Array.from(doc.querySelectorAll('a[href*="webflow.io"], img[src*="webflow.io"]'))) {
    stagingLeftovers.push({ kind: 'webflow_io', sample: el.getAttribute('href') ?? el.getAttribute('src') ?? '', selector: cssPath(el) })
  }
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (/placeholder/i.test(src) && /(webflow\.com|website-files\.com)/i.test(src)) stagingLeftovers.push({ kind: 'placeholder_image', sample: src, selector: cssPath(img) })
  }
  const forms = Array.from(doc.querySelectorAll('form')).map(f => ({
    action: f.getAttribute('action'),
    method: (f.getAttribute('method') ?? 'get').toLowerCase(),
    fieldCount: f.querySelectorAll('input:not([type=hidden]),select,textarea').length,
    selector: cssPath(f),
  }))
  return { imagesMissingAlt, stagingLeftovers, forms }
}

export function collectLayout(doc: Document, win: Window): QaLayout {
  const vw = win.innerWidth
  const horizontalOverflow = doc.documentElement.scrollWidth > vw + 1
  const overflowingElements: QaLayout['overflowingElements'] = []
  if (horizontalOverflow) {
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.width > 0) overflowingElements.push({ selector: cssPath(el), width: Math.round(r.right) })
    }
    overflowingElements.sort((a, b) => b.width - a.width)
  }
  return { horizontalOverflow, overflowingElements: overflowingElements.slice(0, 5) }
}

export function collectPerf(doc: Document, win: Window): QaPerf {
  const entries = new Map<string, number>()
  for (const e of win.performance.getEntriesByType('resource') as PerformanceResourceTiming[]) entries.set(e.name, e.transferSize || e.encodedBodySize || 0)
  const dpr = win.devicePixelRatio || 1
  const images: QaPerfImage[] = Array.from(doc.querySelectorAll('img'))
    .filter(img => img.complete && img.naturalWidth > 0)
    .slice(0, 100)
    .map(img => {
      const src = img.currentSrc || img.src
      const ext = (src.split('?')[0].split('.').pop() ?? '').toLowerCase()
      const r = img.getBoundingClientRect()
      return {
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: Math.round(r.width),
        renderedHeight: Math.round(r.height),
        oversized: r.width > 0 && img.naturalWidth > 2 * r.width * dpr,
        format: ext.length <= 5 ? ext : '',
        transferSize: entries.get(src) ?? 0,
      }
    })
  let total = 0
  for (const v of entries.values()) total += v
  return { images, totalTransferSize: total }
}
```

- [ ] **Step 6: `src/scanner/index.ts`**

```ts
import axe from 'axe-core'
import type { QaA11yViolation, QaScanMessage, QaScanResult } from '../../../../lib/qa/types'
import { decodeViewTokenPayload } from '../../../../lib/qa/token'
import { collectContent, collectLayout, collectLinks, collectPerf, collectSeo } from './collect'

const script = document.currentScript as HTMLScriptElement | null
const token = script ? new URL(script.src).searchParams.get('t') ?? '' : ''
const payload = decodeViewTokenPayload(token)
const proxyBase = `${location.origin}/v/${token}`

async function runAxe(): Promise<QaA11yViolation[]> {
  const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
  return res.violations.map(v => ({
    id: v.id,
    impact: (v.impact ?? null) as QaA11yViolation['impact'],
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 20).map(n => ({ selector: n.target.map(String).join(' '), html: n.html.slice(0, 300) })),
  }))
}

async function scan(): Promise<void> {
  if (!payload) return
  const { links, missingAnchors } = collectLinks(document, proxyBase, payload.o)
  const result: QaScanResult = {
    a11y: await runAxe().catch(() => []),
    links,
    missingAnchors,
    seo: collectSeo(document),
    content: collectContent(document),
    layout: collectLayout(document, window),
    perf: collectPerf(document, window),
  }
  const path = location.pathname.slice(`/v/${token}`.length) || '/'
  const msg: QaScanMessage = { type: 'qa:scan', version: 1, url: `${payload.o}${path}${location.search}`, viewportWidth: window.innerWidth, result }
  window.parent.postMessage(msg, payload.p)
}

let outlined: HTMLElement | null = null
window.addEventListener('message', (e: MessageEvent) => {
  if (!payload || e.origin !== payload.p) return
  const data = e.data as { type?: string; selector?: string }
  if (data.type === 'qa:rescan') void scan()
  if (data.type === 'qa:highlight' && data.selector) {
    if (outlined) outlined.style.outline = ''
    const el = document.querySelector<HTMLElement>(data.selector)
    if (el) {
      el.style.outline = '3px solid #f87171'
      el.style.outlineOffset = '2px'
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      outlined = el
    }
  }
})

window.addEventListener('load', () => { setTimeout(() => { void scan() }, 1500) })
```

The `#f87171` outline is inside the client page (not a dashboard component), so a literal colour is correct here.

- [ ] **Step 7: `src/index.ts`** (the worker)

```ts
import scannerJs from './generated/scanner.bundle.js'
import { verifyViewToken } from '../../../lib/qa/token'
import { isSafePublicUrl } from '../../../lib/qa/ssrf'
import { baseHrefFor, classifyRedirect, rewriteHref, scrubResponseHeaders, upstreamUrlFor } from '../../../lib/qa/proxy-rules'

interface Env { QA_VIEW_SECRET: string }

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:14px/1.5 system-ui;padding:2rem;color:#121A0F"><h1 style="font-size:1rem">${title}</h1><p>${body}</p></body>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/__qa/scanner.js') {
      return new Response(scannerJs, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } })
    }
    const m = url.pathname.match(/^\/v\/([^/]+)(\/.*)?$/)
    if (!m) return page(404, 'Not found', 'This is the Tahi QA viewer.')
    if (req.method !== 'GET' && req.method !== 'HEAD') return page(405, 'Read only', 'The QA viewer only loads pages.')

    const token = m[1]
    const payload = await verifyViewToken(token, env.QA_VIEW_SECRET)
    if (!payload) return page(403, 'Link expired', 'Reload the QA page in the dashboard to get a fresh view link.')
    if (!isSafePublicUrl(payload.o)) return page(403, 'Blocked', 'That address is not allowed.')

    const path = m[2] ?? '/'
    const proxyBase = `${url.origin}/v/${token}`
    const upstreamUrl = upstreamUrlFor(payload.o, path, url.search)

    let upstream: Response
    try {
      upstream = await fetch(upstreamUrl, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'TahiQA/1.0 (+https://tahi.studio)', accept: req.headers.get('accept') ?? 'text/html' } })
    } catch {
      return page(502, 'Could not load the page', `The site did not respond: ${escapeHtml(upstreamUrl)}`)
    }

    const location = upstream.headers.get('location')
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      const d = classifyRedirect(location, upstreamUrl, payload.o, proxyBase)
      if (d.kind === 'internal') return new Response(null, { status: 302, headers: { location: d.location, 'cache-control': 'no-store' } })
      return page(200, 'This link leaves the site', `It redirects to <a href="${escapeHtml(d.location)}" target="_blank" rel="noopener">${escapeHtml(d.location)}</a>.`)
    }

    const headers = scrubResponseHeaders(upstream.headers, payload.p)
    const type = upstream.headers.get('content-type') ?? ''
    if (!type.includes('text/html')) return new Response(upstream.body, { status: upstream.status, headers })

    const rewriter = new HTMLRewriter()
      .on('head', { element(el) { el.prepend(`<base href="${escapeHtml(baseHrefFor(payload.o, path))}">`, { html: true }) } })
      .on('head', { element(el) { el.append(`<script src="${url.origin}/__qa/scanner.js?t=${token}" defer></script>`, { html: true }) } })
      .on('meta[http-equiv]', { element(el) { if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy') el.remove() } })
      .on('a[href]', { element(el) {
        const next = rewriteHref(el.getAttribute('href') ?? '', upstreamUrl, payload.o, proxyBase)
        if (next) el.setAttribute('href', next)
      } })
    return rewriter.transform(new Response(upstream.body, { status: upstream.status, headers }))
  },
}
```

- [ ] **Step 8: README.md** for the worker: what it is, the security reason for the separate origin, the secret, `npm run dev`, deploy via the workflow. Short.

- [ ] **Step 9: `.github/workflows/qa-view-deploy.yml`**: copy `.github/workflows/mcp-worker-deploy.yml` exactly, replacing `workers/mcp-server` with `workers/qa-view` everywhere and the name with `QA view worker deploy`. Make sure the install step runs `npm ci` in `workers/qa-view` before deploy (the build command needs esbuild and axe-core).

- [ ] **Step 10: Verify locally:** `cd workers/qa-view && npm run build:scanner` (creates the bundle, no errors), then `npx wrangler deploy --dry-run --outdir /tmp/qa-view-dry` (bundles without deploying). Back at the root: `npm run type-check`, `npm run lint`.

- [ ] **Step 11: Commit** `SQA: qa-view sandbox proxy worker and scanner [skip ci]`

---

### Task 8: Server helpers and the sites, pages and view-token routes

**Files:**
- Create: `lib/qa/server.ts`, `app/api/admin/qa/sites/route.ts`, `app/api/admin/qa/sites/[id]/route.ts`, `app/api/admin/qa/sites/[id]/import-sitemap/route.ts`, `app/api/admin/qa/sites/[id]/pages/route.ts`, `app/api/admin/qa/pages/[id]/route.ts`, `app/api/admin/qa/view-token/route.ts`
- Test: `app/api/__tests__/admin-qa-sites.test.ts`

**Every route in Tasks 8 to 11 starts with exactly this guard** (it is what `app/api/__tests__/admin-route-guard-walk.test.ts` checks for):

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
// inside each handler:
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied
```

Dynamic routes type the second argument as `{ params: Promise<{ id: string }> }` and `await` it. Bodies are parsed with `await req.json().catch(() => null)` and validated by hand; bad input returns 400 `{ error: '<reason>' }`. Missing rows return 404 `{ error: 'Not found' }`. Timestamps are `new Date().toISOString()`.

- [ ] **Step 1: `lib/qa/server.ts`** (server only; imports D1 and schema):

```ts
import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { QaLinkResult, QaScanResult, QaTarget, QaViewportKey } from '@/lib/qa/types'
import { countIssues, pageIssues } from '@/lib/qa/issue-rules'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export function normaliseOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}

export function targetOrigin(site: { stagingUrl: string | null; liveUrl: string | null }, target: QaTarget): string | null {
  return target === 'live' ? site.liveUrl : site.stagingUrl
}

export async function loadSite(database: D1, id: string) {
  const [site] = await database.select().from(schema.qaSites).where(eq(schema.qaSites.id, id)).limit(1)
  return site ?? null
}

export async function loadRound(database: D1, id: string) {
  const [round] = await database.select().from(schema.qaRounds).where(eq(schema.qaRounds.id, id)).limit(1)
  if (!round) return null
  const site = await loadSite(database, round.siteId)
  return site ? { round, site } : null
}

export async function loadRoundPage(database: D1, id: string) {
  const [rp] = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.id, id)).limit(1)
  if (!rp) return null
  const loaded = await loadRound(database, rp.roundId)
  return loaded ? { roundPage: rp, ...loaded } : null
}

export function rowToLinkResult(r: typeof schema.qaLinkResults.$inferSelect): QaLinkResult {
  return {
    url: r.url, finalUrl: r.finalUrl, status: r.status,
    hops: r.hops ? (JSON.parse(r.hops) as QaLinkResult['hops']) : [],
    broken: r.broken === 1, redirectChain: r.redirectChain === 1, stagingOnLive: r.stagingOnLive === 1, error: r.error,
  }
}

/** Reads the stored scans and link results for one round page and rewrites its count columns. */
export async function recomputeCounts(database: D1, roundPageId: string): Promise<void> {
  const loaded = await loadRoundPage(database, roundPageId)
  if (!loaded) return
  const { round, site } = loaded
  const scanRows = await database.select().from(schema.qaScanResults).where(eq(schema.qaScanResults.roundPageId, roundPageId))
  if (scanRows.length === 0) return
  const scans: Partial<Record<QaViewportKey, QaScanResult>> = {}
  for (const row of scanRows) scans[row.viewport as QaViewportKey] = JSON.parse(row.result) as QaScanResult
  const urls = [...new Set(Object.values(scans).flatMap(s => s.links.map(l => l.url)))]
  const linkRows = urls.length === 0 ? [] : await database.select().from(schema.qaLinkResults)
    .where(and(eq(schema.qaLinkResults.roundId, round.id), inArray(schema.qaLinkResults.url, urls.slice(0, 500))))
  const linkMap = new Map(linkRows.map(r => [r.url, rowToLinkResult(r)]))
  const origin = targetOrigin(site, round.target as QaTarget) ?? ''
  const host = origin ? new URL(origin).hostname : ''
  const c = countIssues(pageIssues(scans, round.target as QaTarget, host, linkMap))
  await database.update(schema.qaRoundPages).set({
    a11yCritical: c.a11yCritical, a11ySerious: c.a11ySerious, a11yModerate: c.a11yModerate, a11yMinor: c.a11yMinor,
    brokenLinks: c.brokenLinks, seoIssues: c.seoIssues, launchIssues: c.launchIssues, perfIssues: c.perfIssues,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.qaRoundPages.id, roundPageId))
}

/** fetch for server-side checks: global fetch with the SSRF guard applied by the caller's helpers. */
export const serverFetch = (url: string, init: RequestInit & { method: string }) => fetch(url, init)
```

D1 caps bound parameters per statement (100). `inArray` with up to 500 values can exceed it: chunk `urls` into groups of 90 and merge the results. Implement the chunking in `recomputeCounts` (a small loop) rather than the single `inArray` above.

- [ ] **Step 2: Routes.** Implement each, with the guard above:

  - `sites/route.ts`
    - `GET`: optional `?orgId=` filter, excludes archived. Returns `{ items }` where each item is the site row plus `orgName` (left join `schema.organisations` on `id`, select `name`) plus `openRound: { id, name, target, ticksDone, ticksTotal, failing, issues } | null` for the newest open round (compute with one grouped query over `qa_round_pages`: sum of the five vp columns, count times 5, count of status 'fail', sum of the eight count columns treating null as 0).
    - `POST` `{ orgId, name, stagingUrl?, liveUrl?, notes? }`: `name` 1 to 120 chars; at least one URL; each URL through `normaliseOrigin` (store the origin only, no path) and `isSafePublicUrl`; the org must exist in `schema.organisations`. Returns `{ item }` 201.
  - `sites/[id]/route.ts`: `GET` returns `{ item, pages, rounds }` (pages not removed first, sorted by path; removed pages after with `removedAt`; rounds newest first). `PATCH` same fields as POST except orgId, all optional, same validation. `DELETE` sets `archivedAt` (archive, not delete), returns `{ ok: true }`.
  - `sites/[id]/import-sitemap/route.ts` `POST { target }`: origin = `targetOrigin(site, target)` (400 if empty). Fetch `${origin}/sitemap.xml` with `serverFetch`; if `parseSitemap` says index, fetch up to `SITEMAP_MAX_FILES` child sitemaps (each must pass `isSafePublicUrl`). Collect locs up to `SITEMAP_MAX_URLS`, `normalisePath` each, dedupe. Always include `/`. Compute `computeGroups` over all non-removed paths (existing manual ones included). Upsert: new paths insert with `source: 'sitemap'`; existing paths get `groupKey` updated and `removedAt: null`; existing `source: 'sitemap'` paths not in the new list get `removedAt = now` (manual pages are never flagged). Batch inserts in chunks of 10 rows (D1 parameter cap). Returns `{ added, updated, removed, total }`. 502 `{ error: 'Could not read sitemap.xml' }` if the fetch fails or returns non-200.
  - `sites/[id]/pages/route.ts` `POST { path }`: `normalisePath`; 409 if it exists and is not removed; if it exists and is removed, un-remove it; else insert `source: 'manual'`. Returns `{ item }`.
  - `pages/[id]/route.ts` `DELETE`: sets `removedAt`. Returns `{ ok: true }`.
  - `view-token/route.ts` `POST { siteId, target }`: origin from the site row (never the body), 400 if missing. `secret = process.env.QA_VIEW_SECRET`, `viewOrigin = process.env.QA_VIEW_ORIGIN`; if either is missing return 503 `{ error: 'QA viewer not configured' }`. Token via `signViewToken({ o: origin, p: appOrigin(), exp: now + QA_VIEW_TOKEN_TTL_SECONDS }, secret)` (`appOrigin` from `@/lib/app-url`). Returns `{ token, baseUrl: `${viewOrigin}/v/${token}`, expiresAt }`.

  Add `QA_VIEW_SECRET` and `QA_VIEW_ORIGIN` to `cloudflare-env.d.ts` if other env vars are declared there, following the existing entries.

- [ ] **Step 3: Tests `app/api/__tests__/admin-qa-sites.test.ts`.** Copy the mocking approach from `app/api/__tests__/admin-feedback-get.test.ts` (mock `@/lib/server-auth`, `@/lib/require-feature` returning null, `@/lib/require-admin` returning null, `@/lib/db` with a chainable fake). Cover at minimum:
  - every handler in this task returns 403 when `getRequestAuth` resolves a non-Tahi org;
  - `POST /sites` returns 400 with no URLs, 400 for `http://127.0.0.1`, and stores `https://acme.webflow.io` when given `https://acme.webflow.io/some/path`;
  - `POST /view-token` returns 503 when `QA_VIEW_SECRET` is unset and, when set, a `baseUrl` starting with `QA_VIEW_ORIGIN` whose token verifies with `verifyViewToken` and carries the site's origin (not anything from the body);
  - import-sitemap: with a mocked global `fetch` returning a two-URL urlset, calls insert with `/`, and both paths.

- [ ] **Step 4: Run** `npx vitest run app/api/__tests__/admin-qa-sites.test.ts app/api/__tests__/admin-route-guard-walk.test.ts lib/qa`, type-check, lint, `npm run build` (catches non-route exports). **Commit** `SQA: sites, pages and view-token routes [skip ci]`

---

### Task 9: Rounds, round pages and scan routes

**Files:**
- Create: `app/api/admin/qa/sites/[id]/rounds/route.ts`, `app/api/admin/qa/rounds/[id]/route.ts`, `app/api/admin/qa/rounds/[id]/samples/route.ts`, `app/api/admin/qa/round-pages/[id]/route.ts`, `app/api/admin/qa/round-pages/[id]/scan/route.ts`
- Test: `app/api/__tests__/admin-qa-rounds.test.ts`

Same guard and conventions as Task 8. Use helpers from `lib/qa/server.ts`.

- [ ] **Step 1: Routes**
  - `sites/[id]/rounds/route.ts`
    - `GET`: rounds for the site, newest first, each with `ticksDone`, `ticksTotal`, `pass`, `fail`, `untested` counts.
    - `POST { name, target }`: `name` 1 to 120; target `'staging' | 'live'` and that URL must be set on the site (400 otherwise). Snapshot: all non-removed pages; ungrouped pages all included; for each `groupKey`, only `pickSamples(paths)` are included. `sortOrder`: ungrouped by path first (with `/` first), then groups by key then path. Insert the round, then round pages in chunks of 10. Returns `{ item }` 201.
  - `rounds/[id]/route.ts`
    - `GET`: `{ round, site, pages, groups }`. `pages` is every round page ordered by `sortOrder`. `groups` is `[{ groupKey, totalPages, sampled }]` where `totalPages` counts non-removed `qa_pages` with that key. `round.siteChecks` and `round.redirectMap` are returned parsed (JSON) or null.
    - `PATCH { name?, status? }`: `status: 'closed'` sets `closedAt`; `'open'` clears it. Returns `{ item }`.
  - `rounds/[id]/samples/route.ts` `POST { groupKey, count? }` (count 1 to 20, default 3): adds the next not-yet-included pages of that group (sorted by path) to the round, after the group's current last sortOrder. 409 if the round is closed.
  - `round-pages/[id]/route.ts` `PATCH { vp?: { xl?, desktop?, tablet?, mobile_l?, mobile_p? }, status?, note? }`: booleans map to 0/1 on the `vp*` columns; `status` must be one of the three; `note` up to 4000 chars (null clears). 409 if the round is closed. Sets `updatedBy: userId`. Returns `{ item }`.
    Also `GET`: `{ roundPage, scans: Record<viewport, QaScanResult>, links: QaLinkResult[], issues: QaIssue[] }` where issues come from `pageIssues(...)` plus `duplicateMetaIssues(...)` for this path, computed across all scanned round pages of the round (read only the desktop scans' `seo.title` and `seo.metaDescription`). This is what the bottom panel renders.
  - `round-pages/[id]/scan/route.ts` `POST { viewport, result }`: `viewport` must be a `QaViewportKey`. Validate the shape minimally (object with array `a11y`, array `links`, object `seo`, object `content`, object `layout`, object `perf`); reject if `JSON.stringify(result).length > 512_000` (413). Upsert into `qa_scan_results` on `(round_page_id, viewport)` with `onConflictDoUpdate`. Set `scannedAt`. Call `recomputeCounts`. Returns `{ ok: true, counts }` with the updated row's counts.

- [ ] **Step 2: Tests** `app/api/__tests__/admin-qa-rounds.test.ts`: 403 for non-admin on every handler; `POST rounds` with a fake site holding 1 ungrouped page plus 8 `/blog/*` pages inserts 1 + 3 round pages; PATCH round page on a closed round returns 409; scan POST rejects an unknown viewport (400) and an oversized body (413).

- [ ] **Step 3: Run tests, type-check, lint, build. Commit** `SQA: rounds, round pages and scan routes [skip ci]`

---

### Task 10: Link check, site checks, redirect map and PageSpeed routes

**Files:**
- Create: `app/api/admin/qa/rounds/[id]/check-links/route.ts`, `app/api/admin/qa/rounds/[id]/site-checks/route.ts`, `app/api/admin/qa/rounds/[id]/redirect-map/route.ts`, `app/api/admin/qa/round-pages/[id]/pagespeed/route.ts`, `lib/qa/pagespeed.ts`
- Test: `app/api/__tests__/admin-qa-checks.test.ts`, `lib/qa/__tests__/pagespeed.test.ts`

- [ ] **Step 1: Routes**
  - `check-links` `POST { urls: string[], force?: boolean }`: 1 to 300 strings, else 400. Skip URLs already in `qa_link_results` for this round unless `force`. Run `checkLinks(remaining, { fetch: serverFetch, target: round.target })`. Upsert each result (chunks of 8 rows). Then call `recomputeCounts` for every round page of this round that has a scan (one at a time is fine). Returns `{ results: QaLinkResult[] }` for all requested URLs (cached plus new).
  - `site-checks` `POST`: `runSiteChecks(targetOrigin(site, round.target), round.target, serverFetch)`, store JSON on `qa_rounds.site_checks` and `site_checks_at`. Returns `{ checks }`.
  - `redirect-map` `POST { urls: string[] }` (1 to 500): live target only (400 otherwise, `{ error: 'Redirect maps run against the live site' }`). For each old URL, `normalisePath`, map to `${site.liveUrl}${path}`, run `checkLinks` on the mapped URLs, store `[{ oldUrl, mappedUrl, ...result }]` JSON on the round. Returns `{ results }`.
  - `pagespeed` `POST { strategy }`: live target only. Calls `runPageSpeed(url, strategy, process.env.GOOGLE_PSI_API_KEY)` from `lib/qa/pagespeed.ts`, merges into the `pagespeed` JSON under the strategy key, sets `pagespeedAt`. 502 with the error message on failure.

- [ ] **Step 2: `lib/qa/pagespeed.ts`** (pure parser plus a fetch wrapper):

```ts
export interface PsiSummary { score: number | null; lcpMs: number | null; cls: number | null; inpMs: number | null; tbtMs: number | null; source: 'field' | 'lab'; fetchedAt: string }

type Json = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})

export function parsePageSpeed(body: unknown, now = new Date().toISOString()): PsiSummary {
  const root = obj(body)
  const lh = obj(root.lighthouseResult)
  const perf = obj(obj(lh.categories).performance)
  const audits = obj(lh.audits)
  const field = obj(obj(root.loadingExperience).metrics)
  const fieldLcp = num(obj(field.LARGEST_CONTENTFUL_PAINT_MS).percentile)
  const fieldCls = num(obj(field.CUMULATIVE_LAYOUT_SHIFT_SCORE).percentile)
  const fieldInp = num(obj(field.INTERACTION_TO_NEXT_PAINT).percentile)
  const hasField = fieldLcp !== null
  const scoreRaw = num(perf.score)
  return {
    score: scoreRaw === null ? null : Math.round(scoreRaw * 100),
    lcpMs: hasField ? fieldLcp : num(obj(audits['largest-contentful-paint']).numericValue),
    cls: hasField ? (fieldCls === null ? null : fieldCls / 100) : num(obj(audits['cumulative-layout-shift']).numericValue),
    inpMs: hasField ? fieldInp : null,
    tbtMs: num(obj(audits['total-blocking-time']).numericValue),
    source: hasField ? 'field' : 'lab',
    fetchedAt: now,
  }
}

export async function runPageSpeed(url: string, strategy: 'mobile' | 'desktop', apiKey: string | undefined): Promise<PsiSummary> {
  const q = new URLSearchParams({ url, strategy, category: 'performance' })
  if (apiKey) q.set('key', apiKey)
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`)
  if (!res.ok) throw new Error(`PageSpeed returned ${res.status}`)
  return parsePageSpeed(await res.json())
}
```

Test `lib/qa/__tests__/pagespeed.test.ts`: a field-data fixture (`loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile = 2100`, `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile = 5`, `INTERACTION_TO_NEXT_PAINT.percentile = 180`, `lighthouseResult.categories.performance.score = 0.87`) yields `{ score: 87, lcpMs: 2100, cls: 0.05, inpMs: 180, source: 'field' }`; a lab-only fixture yields `source: 'lab'` from the audits; `{}` yields all nulls.

- [ ] **Step 3: Route tests** `app/api/__tests__/admin-qa-checks.test.ts`: 403s; check-links 400 on 301 URLs; redirect-map 400 on a staging round; pagespeed 400 on a staging round.

- [ ] **Step 4: Run tests, type-check, lint, build. Commit** `SQA: link, site, redirect map and PageSpeed checks [skip ci]`

---

### Task 11: Issue to request, and the round report data

**Files:**
- Create: `app/api/admin/qa/round-pages/[id]/create-request/route.ts`, `app/api/admin/qa/rounds/[id]/report/route.ts`
- Test: `app/api/__tests__/admin-qa-request.test.ts`

- [ ] **Step 1: create-request** `POST { title, description, viewport? }`: title 1 to 200, description up to 4000. Build the request through `createRequestRecord(database, input, actor)` from `lib/request-writes.ts`. Read the top of `app/api/admin/requests/route.ts` first and build `input` and `actor` exactly the way that route does (same `actorType`, `actorId`). `input = { clientOrgId: site.orgId, title, description: <description + '\n\nPage: <target origin><path>' + (viewport ? '\nViewport: <label> (<width>px)' : '') + '\nFrom QA round: <round name>'>, isInternal: true }`. Leave everything else default. On `{ ok: false }` return the failure the same way the requests route does. On success append the new request id to `request_ids` JSON and return `{ requestId }`. Requests created here are internal (`isInternal: true`) so a client is never notified by a QA finding without a person deciding to share it.

- [ ] **Step 2: report** `GET`: `{ round, site, orgName, totals: { pages, ticksDone, ticksTotal, pass, fail, untested, a11yCritical, a11ySerious, brokenLinks, seoIssues, launchIssues, perfIssues }, pages: [{ path, status, ticks: Record<QaViewportKey, boolean>, counts, note, requestIds }], siteChecks, redirectMap }`.

- [ ] **Step 3: Tests**: 403s; create-request calls `createRequestRecord` (mock the module) with `clientOrgId` from the site (not the body) and `isInternal: true`, and appends to `request_ids`.

- [ ] **Step 4: Run tests, type-check, lint, build. Commit** `SQA: issue to request and round report data [skip ci]`

---

### Task 12: `/qa` sites list, Add site dialog, nav entry

**Files:**
- Create: `app/(dashboard)/qa/page.tsx`, `app/(dashboard)/qa/qa-sites-content.tsx`, `app/(dashboard)/qa/add-site-dialog.tsx`
- Modify: `components/tahi/nav-model.tsx` (Clients group)

**Before any UI task:** read `CLAUDE.md` Design System, `DESIGN.md`, and the components in `components/tahi/` named `page-header.tsx`, `empty-state.tsx`, `data-table.tsx`, `loading-skeleton.tsx`, `data-state.tsx`, `input.tsx`, `badge.tsx`, `progress-bar.tsx`, `confirm-dialog.tsx`, plus `components/ui/`. Compose from these; do not build new primitives. Copy the list page structure from `app/(dashboard)/clients/` (page.tsx + content component). Grep `components/tahi/` for an existing dialog or sheet component and the client picker used by `new-request-dialog.tsx`, and reuse them.

- [ ] **Step 1: `page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getServerAuth } from '@/lib/server-auth'
import { requirePageFeature } from '@/lib/page-guard'
import { QaSitesContent } from './qa-sites-content'

export const metadata = { title: 'Site QA | Tahi Dashboard' }

export default async function QaPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/overview')
  await requirePageFeature('qa_tester')
  return <QaSitesContent />
}
```

(Other pages' metadata titles use an em dash. Ours must not: use the vertical bar as above.)

- [ ] **Step 2: `qa-sites-content.tsx`** (client component, the CLAUDE.md data-fetching pattern): `PageHeader` title "Site QA", subtitle "QA client websites at every screen size before they ship.", primary action "Add site" (leaf radius CTA). Fetch `GET /api/admin/qa/sites`. Loading: skeleton rows. Empty: `EmptyState` with title "No sites yet", description "Add a client's staging or live URL, import its pages and start a QA round.", CTA "Add site". Populated: `DataTable` (or the table pattern used on /clients) with columns Site (name + hostnames, muted), Client, Round (name + target badge, or "No open round"), Progress (`ProgressBar` ticksDone / ticksTotal plus "n / m"), Failing (count), Issues (count). Row click goes to `/qa/<id>`. A client filter (reuse `filter-bar.tsx` if it fits). At 375px the table becomes cards (follow how /clients does it).

- [ ] **Step 3: `add-site-dialog.tsx`**: fields Client (existing client picker), Name, Staging URL, Live URL, Notes. Client-side check that at least one URL is filled. POST, show the API's error text inline on 400, on success close and route to `/qa/<id>`. Optional prop `defaultOrgId` (used by Task 14). Labels on every field, focus trap and Escape (whatever the reused dialog gives you).

- [ ] **Step 4: Nav**: in `components/tahi/nav-model.tsx`, Clients group, after Clients: `{ label: 'Site QA', href: '/qa', icon: '<icon>', adminOnly: true }`. Find the icon map the `icon` keys resolve to and pick an existing icon that suits (a check, clipboard or monitor style icon); if none fits, add one from the icon library the map already uses. Check whether nav items need a `feature` key to hide them under granular permissions (look at how other items are hidden) and wire `qa_tester` the same way.

- [ ] **Step 5:** type-check, lint, build. Start the dev server per `docs/local-dev-and-qa.md`, open `/qa`, confirm empty state, add a site against the local D1, confirm the row. Check 375px and `.dark`. **Commit** `SQA: /qa sites list, add site dialog and nav entry [skip ci]`

---

### Task 13: Site page and the round workspace

This is the biggest UI task. Split it across files exactly as below so each file stays focused.

**Files:**
- Create: `app/(dashboard)/qa/[siteId]/page.tsx`, `app/(dashboard)/qa/[siteId]/site-content.tsx`, `app/(dashboard)/qa/[siteId]/start-round-dialog.tsx`, `app/(dashboard)/qa/[siteId]/workspace/use-round.ts`, `.../workspace/use-view-token.ts`, `.../workspace/page-rail.tsx`, `.../workspace/viewport-strip.tsx`, `.../workspace/viewport-frame.tsx`, `.../workspace/issue-panel.tsx`, `.../workspace/round-actions.tsx`, `.../workspace/scan-all.ts`, `.../workspace/round-workspace.tsx`

- [ ] **Step 1: page.tsx**: same guard as Task 12, `metadata = { title: 'Site QA | Tahi Dashboard' }`, awaits `params`, renders `<SiteContent siteId={siteId} />`.

- [ ] **Step 2: site-content.tsx**: fetch `GET /api/admin/qa/sites/<id>`. Header: site name, client name linking to `/clients/<orgId>`, staging and live links (open in a new tab, `rel="noopener"`), actions Import pages (choose target if both URLs exist; POST import-sitemap; toast/inline result "Added n, updated m, flagged k as removed"), Edit (reuse AddSiteDialog in edit mode, PATCH), Archive (ConfirmDialog, DELETE). If the site has no pages: EmptyState "No pages yet" with "Import from sitemap.xml" and "Add a page" actions. Rounds list with Start round (StartRoundDialog: name defaulting to `Pre-launch <d MMM>` or `Live check <d MMM>`, target). If `?round=<id>` is in the URL or an open round exists, render `<RoundWorkspace roundId=... />` below or instead of the rounds list (full width). Keep the selected round in the URL with `router.replace`.

- [ ] **Step 3: `use-round.ts`**: hook `useRound(roundId)` that loads `GET /api/admin/qa/rounds/<id>`, exposes `pages`, `groups`, `round`, `site`, `refresh()`, and `patchPage(id, patch)` with an optimistic update (update local state first, PATCH, roll back and surface an error on failure).

- [ ] **Step 4: `use-view-token.ts`**: hook `useViewToken(siteId, target)` POSTs `/api/admin/qa/view-token`, returns `{ baseUrl, error }`, refreshes 10 minutes before `expiresAt`. On 503 return `error: 'not_configured'` so the UI can say "The QA viewer is not set up yet (QA_VIEW_SECRET / QA_VIEW_ORIGIN)."

- [ ] **Step 5: `viewport-frame.tsx`**: props `{ viewport: (typeof QA_VIEWPORTS)[number], src: string, rowHeightRem: number, ticked: boolean, onTick(v: boolean), scanState: 'loading' | 'scanned' | 'no_scan' | 'failed', expanded: boolean, onExpand(), frameRef }`. Renders a label bar (viewport label, width, a tick checkbox with a visible label, a scan state dot with text, an expand button with aria-label) and a box whose width is `viewport.width * scale` px where `scale = (rowHeightRem * 16) / viewport.height`, containing an `<iframe>` at the real `viewport.width` x `viewport.height` with `transform: scale(scale)` and `transform-origin: 0 0`, `title={`${label} preview`}`, `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` (same-origin here is the proxy's own origin, not ours), `referrerPolicy="no-referrer"`. When `scanState` stays `loading` for 20 seconds it becomes `no_scan` (owned by the strip, see below).

- [ ] **Step 6: `viewport-strip.tsx`**: renders the five frames in a horizontally scrolling row (`overflow-x: auto`, gap from spacing tokens). `src = baseUrl + path`. Listens to `window` `message` events; accepts only `event.origin === new URL(baseUrl).origin` and `data.type === 'qa:scan' && data.version === 1`; maps `data.viewportWidth` to a viewport with `viewportByWidth`, ignores unknown widths, and calls `onScan(viewport, result)`. Holds one ref per iframe so the parent can `postMessage({ type: 'qa:highlight', selector }, viewOrigin)` or `{ type: 'qa:rescan' }`. Expanded mode shows only the expanded frame scaled to the available width. Escape exits expanded mode. Under 48rem (`matchMedia`), show one frame with a segmented viewport switcher instead of the strip.

- [ ] **Step 7: Scan flow in `round-workspace.tsx`**: on `onScan`, POST to `/api/admin/qa/round-pages/<id>/scan` `{ viewport, result }`. When the desktop scan lands, POST its unique `result.links` URLs (first 300) to `/api/admin/qa/rounds/<roundId>/check-links`, then refetch `GET /api/admin/qa/round-pages/<id>` for the issue panel and update that row's counts in `useRound` state.

- [ ] **Step 8: `page-rail.tsx`**: progress bar for the round (ticks), filter chips (All, Untested, Failing, Has issues), list grouped: ungrouped pages, then each group with a header "/blog/* · 3 of 248 sampled" and "Add 3 more" (POST samples). Each row is a button (44px min height): path (truncated with a title attribute), five mini tick dots in viewport order (filled = ticked, with an sr-only text "XL ticked" etc.), a status dot (pass/fail/untested using status tokens with a text label for screen readers), an issue badge (sum of counts) when scanned. Selected row is highlighted. Keyboard: arrow up/down moves selection when the rail has focus; `j` / `k` anywhere in the workspace (not inside inputs) go to next/previous page. Collapsible to an icon rail; under 48rem it becomes a sheet opened from the toolbar.

- [ ] **Step 9: `issue-panel.tsx`**: tabs Accessibility, Links, SEO, Launch, Performance, Notes (use an existing tabs component if one exists in `components/tahi` or `components/ui`). Each tab lists issues for that category from the GET round page response, sorted fail then warn then info, each with severity badge, message, viewport chip when set, "Show" button when it has a selector (sends highlight to the matching viewport frame, or desktop), "Learn more" link when `url` is an axe help URL, and "Create request" (small dialog prefilled with title `<path>: <message first 80 chars>` and the message as description; POST create-request; then show "Request created" with a link to `/requests/<id>`). SEO tab also shows a fields summary (title with length, description with length, canonical, robots, OG preview card with image, heading outline as an indented list). Performance tab has "Run PageSpeed (mobile)" and "(desktop)" buttons when the round target is live, showing score and LCP, CLS, INP or TBT, with "field" or "lab" label. Notes tab: Pass and Fail buttons, note textarea saving on blur (PATCH). Empty tab state: "No issues found" in muted text. Not scanned yet: "Waiting for the scan" with a spinner.

- [ ] **Step 10: `round-actions.tsx`**: a menu (reuse `components/tahi/menu.tsx`) with: Run site checks (POST, then show results in a small panel: each check pass/warn/fail with detail), Scan all pages, Check redirect map (dialog with a textarea, one URL per line, live rounds only; results table: old URL, mapped URL, final status, flag), Open report (`/qa/rounds/<id>/report`), Close round / Reopen round (PATCH; closed rounds render read-only: ticks and notes disabled with a banner "This round is closed").

- [ ] **Step 11: `scan-all.ts`**: a hook `useScanAll` that, when started, mounts two hidden iframes (desktop and mobile P widths, `aria-hidden`, positioned off-screen, `tabIndex={-1}`), walks round pages in order, sets both srcs, waits for both `qa:scan` messages or 25 seconds, POSTs each scan, runs the link check for the desktop links, and moves on. Exposes `{ running, done, total, current, cancel }`; the toolbar shows "Scanning 12 of 48" with Cancel. Warn on `beforeunload` while running.

- [ ] **Step 12: `round-workspace.tsx`** composes it all: toolbar (current path, prev/next buttons with aria-labels, target label, Rescan button which posts `qa:rescan` to all five frames, "Open page" link to the upstream URL in a new tab, Pass/Fail quick buttons, RoundActions), PageRail on the left, ViewportStrip in the middle, IssuePanel at the bottom (resizable via a drag handle with keyboard support, or a fixed 18rem height with a collapse toggle if a resizable primitive is not already in the repo). The selected page id lives in the URL (`?round=<id>&page=<roundPageId>`).

- [ ] **Step 13:** type-check, lint, build. Run locally with the worker: `cd workers/qa-view && npx wrangler dev --config wrangler.jsonc --port 8799` (secret in `workers/qa-view/.dev.vars`, gitignored) and in `.dev.vars` or `.env.local` of the dashboard set `QA_VIEW_SECRET=<same>` and `QA_VIEW_ORIGIN=http://localhost:8799`. Note: with a localhost proxy, the SSRF guard still requires a public upstream, so test against a real public Webflow staging site (for example `https://webflow.com` is fine as a smoke target). Add a site, import, start a round, confirm frames render, scans arrive (scan dots go green), ticks persist after reload, issue panel fills, highlight works. Check 375px and `.dark`. **Commit** `SQA: site page and round workspace [skip ci]`

---

### Task 14: Report page and client detail Sites card

**Files:**
- Create: `app/(dashboard)/qa/rounds/[id]/report/page.tsx`, `app/(dashboard)/qa/rounds/[id]/report/report-content.tsx`, `components/tahi/qa-sites-card.tsx`
- Modify: `app/(dashboard)/clients/[id]/tabs/overview.tsx` (add the card)

- [ ] **Step 1: Report**: same page guard, metadata `Site QA report | Tahi Dashboard`. Fetch `GET /api/admin/qa/rounds/<id>/report`. Layout: header (site, client, round name, target, date, Print button calling `window.print()`), summary KPIs (reuse `kpi-strip.tsx`): pages passed / total, ticks done / total, failing pages, accessibility serious + critical, broken links, SEO issues, launch issues, performance issues. Site checks list. Redirect map table when present. Page table: path, status, five tick marks, counts, note, request links. Print stylesheet (`@media print`): hide the sidebar, top nav, buttons and the feedback ball; full width; no background colours that waste ink; page breaks avoided inside rows.

- [ ] **Step 2: `qa-sites-card.tsx`**: props `{ orgId }`. Fetches `GET /api/admin/qa/sites?orgId=<id>`. Card titled "Sites" listing each site (name, hostnames, open round progress) linking to `/qa/<id>`, plus "Add site" opening `AddSiteDialog` with `defaultOrgId`. Empty: inline EmptyState "No sites yet". Hidden entirely when the viewer lacks the `qa_tester` feature (check how other client-detail cards read permissions, e.g. `permissions-context.tsx`).

- [ ] **Step 3:** Add `<QaSitesCard orgId={...} />` to `tabs/overview.tsx` in a spot consistent with the other cards there (read the file first; follow its grid).

- [ ] **Step 4:** type-check, lint, build, local check of both at desktop, 375px and dark. Print preview of the report. **Commit** `SQA: round report and client Sites card [skip ci]`

---

### Task 15: MCP parity tools

**Files:**
- Create: `workers/mcp-server/src/qa-tools.ts`, `app/api/__tests__/mcp-qa-tool-parity.test.ts`
- Modify: `workers/mcp-server/src/index.ts` (tool definitions + dispatch), `workers/mcp-server/src/tool-profiles.ts` (profile membership)

- [ ] **Step 1:** Read `workers/mcp-server/src/feedback-tools.ts`, how `index.ts` declares tool schemas and dispatches `feedbackToolCall`, how `list_feedback_comments` (a GET) is handled, and how `tool-profiles.ts` assigns tools to the `full` and `designer` profiles. Follow those exactly.

- [ ] **Step 2: `qa-tools.ts`**: `qaToolCall(name, args): McpApiCall | null` mapping:
  - `list_qa_sites` `{ org_id? }` -> GET `/api/admin/qa/sites?orgId=`
  - `create_qa_site` `{ org_id, name, staging_url?, live_url?, notes? }` -> POST `/api/admin/qa/sites`
  - `import_qa_sitemap` `{ site_id, target }` -> POST `/api/admin/qa/sites/<id>/import-sitemap`
  - `list_qa_rounds` `{ site_id }` -> GET `/api/admin/qa/sites/<id>/rounds`
  - `start_qa_round` `{ site_id, name, target }` -> POST `/api/admin/qa/sites/<id>/rounds`
  - `get_qa_round` `{ round_id }` -> GET `/api/admin/qa/rounds/<id>`
  - `update_qa_round_page` `{ round_page_id, status?, note?, viewports? }` -> PATCH `/api/admin/qa/round-pages/<id>` (map `viewports` object keys straight through as `vp`)
  - `check_qa_round_links` `{ round_id, urls }` -> POST `/api/admin/qa/rounds/<id>/check-links`
  - `run_qa_site_checks` `{ round_id }` -> POST `/api/admin/qa/rounds/<id>/site-checks`
  - `get_qa_round_report` `{ round_id }` -> GET `/api/admin/qa/rounds/<id>/report`
  Throw `'<field> is required'` for missing required args. Extend `McpMethod` to the methods used. Tool descriptions: one plain sentence each, no dashes.
- [ ] **Step 3:** Register the tools in `index.ts` and add them to the `full` profile only (QA is admin-only) in `tool-profiles.ts`.
- [ ] **Step 4: Parity test**: copy `app/api/__tests__/mcp-feedback-tool-parity.test.ts`; assert each tool maps to the right path and method, and that every mapped path has a matching `app/api/admin/qa/**/route.ts` exporting that method (read the file system like the feedback parity test does, if it does; otherwise assert the paths only).
- [ ] **Step 5:** tests, type-check, lint. **Commit** `SQA: worker MCP tools for site QA [skip ci]`

---

### Task 16: Docs, final verification and ship

This task is run by the orchestrator (Opus), not a Haiku worker.

- [ ] **Step 1:** Update `TASKS.md` (new SQA block marking what shipped, WQA.0 left open and pointing at this spec as its base), `STATUS.md` (current sprint line), `AGENTS.md` (the qa-view worker, its secret, the separate-origin rule, migration 0115), `DASHBOARD_MAP.md` if it lists routes.
- [ ] **Step 2:** Full run: `npx vitest run`, `npm run type-check`, `npm run lint`, `npm run build`.
- [ ] **Step 3:** opus-reviewer fresh-context review against the spec (security of the proxy and token, tenancy, guards, UI states, dashes, mobile, dark).
- [ ] **Step 4:** Hand Liam the commands: generate a secret, `wrangler secret put QA_VIEW_SECRET` in `workers/qa-view`, the same value on the dashboard, `QA_VIEW_ORIGIN` set to the worker URL, migration 0115 apply command. Push (no `[skip ci]` on the final commit) only after Liam confirms, then watch both deploys and do the live smoke on a real client staging site at 375px and dark.
