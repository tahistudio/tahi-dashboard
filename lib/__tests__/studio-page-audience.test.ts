/**
 * Client view must take the WHOLE studio surface away, not the top level of it.
 *
 * `getServerAuth()` keeps orgId = the Tahi org while a Tahi operator previews
 * the portal, so any page that gates on the raw
 * `orgId === NEXT_PUBLIC_TAHI_ORG_ID` still renders the studio inside the
 * client shell. The first sweep only converted top-level `page.tsx` files and
 * left thirteen nested routes behind, including the /clients tree, which is one
 * Back press from entering the preview and names every client's plan and MRR.
 *
 * A prose claim that "the sweep covered everything" is not checkable, so the
 * enumeration itself is the test: every dashboard page that still mentions the
 * Tahi org id has to be named here, with the reason it is allowed to.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const DASHBOARD = join(REPO_ROOT, 'app', '(dashboard)')

function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...pageFiles(full))
    } else if (entry === 'page.tsx') {
      out.push(full)
    }
  }
  return out
}

/** Every .ts/.tsx under a directory, skipping this test folder. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Repo-relative, forward slashes, so the allowlists read the same on any OS. */
function rel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/')
}

const PAGES = pageFiles(DASHBOARD).map((file) => ({
  path: rel(file),
  source: readFileSync(file, 'utf8'),
}))

/**
 * Pages a client is MEANT to reach. They branch on the audience rather than
 * redirecting, so the raw org comparison stays and the client half renders.
 */
const DUAL_AUDIENCE = new Set([
  'app/(dashboard)/overview/page.tsx',
  'app/(dashboard)/requests/page.tsx',
  'app/(dashboard)/requests/[id]/page.tsx',
  'app/(dashboard)/invoices/page.tsx',
  'app/(dashboard)/invoices/[id]/page.tsx',
  'app/(dashboard)/files/page.tsx',
  'app/(dashboard)/services/page.tsx',
])

/**
 * Studio-only pages whose preview gate lives in middleware.ts instead, via
 * `isAdminOnlyRoute` + the tahi-impersonate-org cookie. One matcher covers the
 * whole /clients subtree, which is the widest thing a preview could show.
 */
const GUARDED_IN_MIDDLEWARE = new Set([
  'app/(dashboard)/clients/page.tsx',
  'app/(dashboard)/clients/[id]/page.tsx',
  'app/(dashboard)/clients/brands/[id]/page.tsx',
  'app/(dashboard)/clients/contacts/[id]/page.tsx',
])

/**
 * Pages whose audience is Tahi-org MEMBERSHIP rather than the preview, stated
 * so the exception is a decision and not an oversight.
 */
const AUDIENCE_BY_MEMBERSHIP = new Set([
  // The bell and its history belong to the signed-in operator, not to the org
  // they are previewing: an admin in Client view still owns their own team
  // notifications with team deep links, so flipping the route map under them
  // would point real rows at pages the client map cannot reach. The preview
  // does get the read-only lens. See the page's own comment.
  'app/(dashboard)/notifications/page.tsx',
])

/**
 * Pages that still read the preview cookie by hand instead of calling
 * getViewAudience(). Subset assertion, so removing one keeps this green.
 *
 * The three under /invoices and /notifications are behaviourally identical to
 * getViewAudience (`isAdmin && cookie present`); they are being reworked on
 * another branch, so converting them here would collide. Convert them with
 * that rework, not by widening this list.
 */
const HAND_ROLLED_COOKIE_READ = new Set([
  'app/(dashboard)/services/page.tsx',
  'app/(dashboard)/invoices/page.tsx',
  'app/(dashboard)/invoices/[id]/page.tsx',
  'app/(dashboard)/notifications/page.tsx',
])

describe('dashboard pages resolve the audience, not just the Clerk org', () => {
  it('finds the dashboard page tree', () => {
    expect(PAGES.length).toBeGreaterThan(20)
  })

  it('every page mentioning the Tahi org id is accounted for', () => {
    const unexplained = PAGES
      .filter((p) => p.source.includes('NEXT_PUBLIC_TAHI_ORG_ID'))
      .map((p) => p.path)
      .filter((p) => !DUAL_AUDIENCE.has(p)
        && !GUARDED_IN_MIDDLEWARE.has(p)
        && !AUDIENCE_BY_MEMBERSHIP.has(p))
    expect(unexplained).toEqual([])
  })

  it('every page that redirects a non-admin also redirects a preview', () => {
    const leaky = PAGES
      .filter((p) => /if \(!isAdmin[^)]*\) redirect\(/.test(p.source))
      .filter((p) => !/if \(!isAdmin \|\| isPreviewingClient\) redirect\(/.test(p.source))
      .map((p) => p.path)
    expect(leaky).toEqual([])
  })

  it('every page using getViewAudience actually branches on the preview', () => {
    const unused = PAGES
      .filter((p) => p.source.includes('getViewAudience'))
      .filter((p) => !p.source.includes('isPreviewingClient'))
      .map((p) => p.path)
    expect(unused).toEqual([])
  })

  it('no new page hand-rolls the preview cookie read', () => {
    const handRolled = PAGES
      .filter((p) => /\.get\('tahi-impersonate-org'\)/.test(p.source))
      .map((p) => p.path)
      .filter((p) => !HAND_ROLLED_COOKIE_READ.has(p))
    expect(handRolled).toEqual([])
  })

  it('no module under lib/ or app/api/ hand-rolls it either', () => {
    // The page scan above cannot see the reader that actually SCOPES data.
    // getPortalAuth kept its own copy of the rule, honoured on any truthy
    // value, so a junk cookie was "not previewing" to the middleware and to
    // getViewAudience (studio shell, /clients reachable) while every portal
    // API underneath answered for a non-existent org.
    const handRolled = [
      ...sourceFiles(join(REPO_ROOT, 'lib')),
      ...sourceFiles(join(REPO_ROOT, 'app', 'api')),
    ]
      .filter((file) => /\.get\(('|")tahi-impersonate-org\1\)/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(handRolled).toEqual([])
  })

  it('nor the mode cookie Act as client rides on', () => {
    // The mode decides whether a preview may WRITE into a client's workspace,
    // so a second reader with its own idea of what counts is worse here than it
    // was for the org cookie: two answers to "are writes real" means a write
    // landing from a surface that believed it could not make one.
    const handRolled = [
      ...sourceFiles(join(REPO_ROOT, 'lib')),
      ...sourceFiles(join(REPO_ROOT, 'app')),
      ...sourceFiles(join(REPO_ROOT, 'components')),
    ]
      .filter((file) => /\.get\(('|")tahi-impersonate-mode\1\)/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(handRolled).toEqual([])
  })

  it('every reader of the mode goes through lib/preview-cookie.ts', () => {
    // Three readers now: the write path, the edge, and the shell that paints
    // the strip. All three ask the same function what 'act' means.
    for (const file of [
      join(REPO_ROOT, 'lib', 'server-auth.ts'),
      join(REPO_ROOT, 'middleware.ts'),
      join(REPO_ROOT, 'app', '(dashboard)', 'layout.tsx'),
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain('readPreviewMode')
      expect(source).toContain("from '@/lib/preview-cookie'")
    }
  })
})

describe('middleware treats Client view as a client audience', () => {
  const middleware = readFileSync(join(REPO_ROOT, 'middleware.ts'), 'utf8')

  it('bounces an admin-only route while the preview cookie is set', () => {
    expect(middleware).toContain(
      'if (isAdminOnlyRoute(req) && (!isAdmin || previewingClient))',
    )
  })

  it('still covers the whole /clients subtree', () => {
    expect(middleware).toContain("'/clients(.*)'")
  })

  it('shares one definition of previewing with the server components', () => {
    // Not its own cookie read. lib/preview-cookie.ts is the single rule, so
    // the middleware and getViewAudience() cannot drift into disagreeing about
    // who is previewing (they did: the middleware honoured the cookie on any
    // session, validated nothing, and locked admins out of /clients).
    expect(middleware).toContain("from '@/lib/preview-cookie'")
    expect(middleware).toContain('resolvePreviewOrgId(')
    expect(middleware).not.toMatch(/cookies\.get\('tahi-impersonate-org'\)/)
  })

  it('and so does the portal API reader', () => {
    // Four readers, one rule: middleware.ts, lib/view-audience.ts, the shell
    // layout through it, and lib/server-auth.ts here.
    const serverAuth = readFileSync(join(REPO_ROOT, 'lib', 'server-auth.ts'), 'utf8')
    expect(serverAuth).toContain("from '@/lib/preview-cookie'")
    expect(serverAuth).toContain('resolvePreviewOrgId(')
  })

  it('clears BOTH preview cookies on the way out', () => {
    // Three places end a preview: this hatch, /api/admin/impersonate/exit, and
    // the banner's Exit button. If any one of them dropped only the org cookie,
    // the operator would return to the studio still armed, and the next client
    // they previewed would be a writing session they never agreed to.
    expect(middleware).toContain('IMPERSONATE_MODE_COOKIE')
    const exitRoute = readFileSync(
      join(REPO_ROOT, 'app', 'api', 'admin', 'impersonate', 'exit', 'route.ts'),
      'utf8',
    )
    expect(exitRoute).toContain('IMPERSONATE_MODE_COOKIE')
    const banner = readFileSync(
      join(REPO_ROOT, 'components', 'tahi', 'impersonation-banner.tsx'),
      'utf8',
    )
    expect(banner).toContain('clearImpersonateModeCookie')
  })

  it('keeps an escape hatch that needs no shell to render', () => {
    // The Exit preview button lives in the dashboard layout. When that layout
    // is the broken thing, ?exit-preview=1 still clears the cookie here, ahead
    // of every gate below it.
    expect(middleware).toContain('EXIT_PREVIEW_PARAM')
    const hatchAt = middleware.indexOf('EXIT_PREVIEW_PARAM) === ')
    const gateAt = middleware.indexOf('if (isAdminOnlyRoute(req)')
    expect(hatchAt).toBeGreaterThan(-1)
    expect(hatchAt).toBeLessThan(gateAt)
  })
})
