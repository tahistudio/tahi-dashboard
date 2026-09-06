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
