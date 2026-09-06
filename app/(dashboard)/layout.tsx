import { getViewAudience } from '@/lib/view-audience'
import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'
import { ImpersonationBanner } from '@/components/tahi/impersonation-banner'
import { AnnouncementBanner } from '@/components/tahi/announcement-banner'
import { MobileBottomNav } from '@/components/tahi/mobile-bottom-nav'
import { ProductTour } from '@/components/tahi/product-tour'
import { ToastProvider } from '@/components/tahi/toast'
import { KeyboardShortcuts } from '@/components/tahi/keyboard-shortcuts'
import { SidebarProvider } from '@/components/tahi/sidebar-context'
import { SkipToContent } from '@/components/tahi/skip-to-content'
// Two imports on purpose, and they must stay apart. This file is a SERVER
// component: a component may cross the client boundary, a plain function may
// not. Next replaces every export of a 'use client' module with a stub that
// throws when the server calls it, so folding resolvePinnedCurrency back into
// the display-currency-context import is a production outage with a green
// type-check, a green lint and a green build. See lib/currency.ts and
// lib/__tests__/server-client-boundary.test.ts.
import { DisplayCurrencyProvider } from '@/lib/display-currency-context'
import { resolvePinnedCurrency, type PinnedCurrencyEvidence } from '@/lib/currency'
import { PermissionsProvider, type PermissionsValue } from '@/components/tahi/permissions-context'
import { PrivateModeProvider } from '@/components/tahi/private-mode-context'
import { SwrProvider } from '@/components/tahi/swr-provider'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray, sql } from 'drizzle-orm'
import { resolvePermissions, featureMap, applyModuleGates, MODULE_SETTING_KEYS } from '@/lib/permissions'
import { linkTeamMemberOnSignIn } from '@/lib/team-link-server'
import { linkContactOnSignIn } from '@/lib/contact-link-server'
import './app-shell.css'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Client-portal branding helpers. Admin sessions never touch any of this, so
// the Tahi team's shell is byte-for-byte unchanged.
const HEX6 = /^#[0-9a-fA-F]{6}$/
function normalizeHex(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  return HEX6.test(s) ? s.toLowerCase() : null
}
// Derive a darker shade for hover / "strong" accents so a tinted portal still
// has a two-step brand ramp. Pure function, no deps.
function darkenHex(hex: string, factor = 0.82): string {
  const n = parseInt(hex.slice(1), 16)
  const to2 = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')
  return `#${to2(((n >> 16) & 255) * factor)}${to2(((n >> 8) & 255) * factor)}${to2((n & 255) * factor)}`
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId, isAdmin, isPreviewingClient, previewOrgId } = await getViewAudience()
  if (!userId) redirect('/sign-in')

  // Onboarding-completion gate (the durable lock behind the middleware's no-org
  // redirect). A client may reach the dashboard ONLY once their onboarding is
  // finished - so a client who already holds an org but has not finished (Clerk
  // minted one at sign-up, or self-serve provisioned one before paying) is sent
  // back to /onboarding instead of slipping into /overview. Admins bypass.
  // redirect() is called OUTSIDE the try so its NEXT_REDIRECT is not swallowed;
  // we fail-open (treat as complete) on a Clerk hiccup so a transient error
  // never locks a real client out.
  let onboardingComplete = true
  if (!isAdmin) {
    try {
      const clerk = await clerkClient()
      const user = await clerk.users.getUser(userId)
      onboardingComplete = !!user.publicMetadata?.onboardingComplete
    } catch {
      onboardingComplete = true
    }
  }

  // Client-login backfill. A second seat arriving by a Clerk organization
  // invitation has a valid session and no contacts row pointing at them, so
  // they resolve to no identity in the portal: no portal role, no
  // notifications, messages stamped with a raw Clerk id. Claim their waiting
  // row by VERIFIED email, scoped to their own org. It never creates a row and
  // never overwrites an existing link (see lib/contact-link-server.ts).
  //
  // ORDER MATTERS: this runs BEFORE the onboarding redirect below. A colleague
  // invited through Clerk has no publicMetadata.onboardingComplete (only POST
  // /api/onboarding/complete ever writes it, and only the onboarding scenes
  // call that), so gating the claim behind the redirect meant the audience it
  // was written for never reached it. An already-linked user still costs one
  // indexed lookup and nothing more, so running it first is free.
  if (!isAdmin) await linkContactOnSignIn(userId, orgId)

  if (!onboardingComplete) redirect('/onboarding')

  // Team-login backfill. A hire's Clerk account and their team_members row are
  // only joined by teamMembers.clerkUserId, and nothing used to write it, so a
  // new hire resolved to no row at all: no role, no scope, no notifications.
  // Claim their waiting row here, by VERIFIED email, before permissions resolve
  // so their real role applies on the very first render. It never creates a row
  // and never overwrites an existing link (see lib/team-link.ts), and an
  // already-linked user costs one indexed lookup and nothing more.
  if (isAdmin) await linkTeamMemberOnSignIn(userId, orgId)

  // Granular permissions: resolve the caller's capabilities once, server-side,
  // and feed them to the sidebar + <Gate>. Fail-open (full access) if the
  // resolver errors so a permissions hiccup never locks the user out.
  let perms: PermissionsValue = {
    level: 'admin',
    isAdmin, isSuperAdmin: false, canManagePermissions: isAdmin,
    features: {},
  }
  // The client's seat at their own org, resolved from the SAME contacts row the
  // permission resolver already reads, so the nav costs no extra query. Stays
  // null for team sessions and for anyone we could not resolve, which the nav
  // treats as "unknown, show it" (see filterNav's clientPortalRole).
  let clientPortalRole: 'admin' | 'member' | null = null
  try {
    const drizzle = (await db()) as unknown as D1
    const access = await resolvePermissions(drizzle, { userId, orgId })
    clientPortalRole = access.portalRole ?? null

    // Workspace module toggles (settings Modules tab) fold into the nav feature
    // map here, server-side, so a disabled module hides its feature for EVERYONE
    // except super-admins. Read fails open (no gating) so a settings hiccup can
    // never hide a module the user should see.
    let moduleSettings: Record<string, string | null> = {}
    try {
      const rows = await drizzle
        .select({ key: schema.settings.key, value: schema.settings.value })
        .from(schema.settings)
        .where(inArray(schema.settings.key, [...MODULE_SETTING_KEYS]))
      for (const row of rows) moduleSettings[row.key] = row.value
    } catch {
      moduleSettings = {}
    }

    perms = {
      level: access.level,
      isAdmin: access.isAdmin,
      isSuperAdmin: access.isSuperAdmin,
      canManagePermissions: access.canManagePermissions,
      features: applyModuleGates(featureMap(access), moduleSettings, access.isSuperAdmin),
    }
  } catch {
    // fail-open
  }

  // ── Client-portal brand tint ────────────────────────────────────────────
  // Admin Branding settings (portal_name / portal_primary_color /
  // portal_logo_url) are consumed ONLY for client portal viewers. Admins skip
  // this entirely, so nothing below can alter the Tahi team's shell. Fail-safe:
  // any read error or a bad/missing value simply leaves the defaults in place.
  let portalBrand: { color: string | null; name: string | null; logoUrl: string | null } = {
    color: null, name: null, logoUrl: null,
  }
  if (!isAdmin) {
    try {
      const database = await db()
      const rows = await database
        .select()
        .from(schema.settings)
        .where(inArray(schema.settings.key, ['portal_primary_color', 'portal_name', 'portal_logo_url']))
      const map: Record<string, string | null> = {}
      for (const row of rows) map[row.key] = row.value
      portalBrand = {
        color: normalizeHex(map['portal_primary_color']),
        name: map['portal_name']?.trim() || null,
        logoUrl: map['portal_logo_url']?.trim() || null,
      }
    } catch {
      // fail-safe: no branding, defaults stand
    }
  }

  // CSS custom-property override, applied inline on the shell wrapper for client
  // sessions with a valid saved colour only. For admins (or a bad hex) brandVars
  // is empty, so the style is identical to before. --color-brand / --brand feed
  // the portal's accents; --color-brand-dark / --brand-strong feed hovers.
  const brandVars: Record<`--${string}`, string> = {}
  if (!isAdmin && portalBrand.color) {
    const strong = darkenHex(portalBrand.color)
    brandVars['--color-brand'] = portalBrand.color
    brandVars['--color-brand-dark'] = strong
    brandVars['--brand'] = portalBrand.color
    brandVars['--brand-strong'] = strong
  }

  // ── Client billing currency ─────────────────────────────────────────────
  // A client surface is fixed, not steerable: the nav switcher is gone, because
  // a client re-converting their own invoice only ever produces a number nobody
  // will bill or pay. What the pin names is the currency this client is BILLED
  // in, which is what their invoice totals are rendered in; NZD-base figures
  // stay in the base (see formatPinnedBaseAmount in lib/currency.ts). Client
  // audiences include the studio inside Client view, resolved from the
  // impersonation cookie (previewOrgId).
  //
  // Two columns, because neither one alone is a decision.
  // `organisations.preferred_currency` is `DEFAULT 'USD'` in the schema, so a
  // row that nobody edited claims US dollars for a NZ client;
  // `custom_mrr_currency` defaults to the NZD base, so a non-base value there
  // is something a person typed into the client's Money card. The rule that
  // weighs them is resolvePinnedCurrency, in lib/currency.ts, with the test.
  //
  // custom_mrr_currency rides along as a raw column: it was added by the ad-hoc
  // migrate route rather than a Drizzle migration, so it is absent from
  // db/schema.ts and every other reader reaches it through raw SQL too
  // (app/api/admin/financial-reports/summary). Selecting it here keeps this to
  // ONE round trip instead of two.
  //
  // This is the only read this layout adds, and it runs for client audiences
  // only, so the studio's shell keeps the query count it had. One indexed
  // equality: the preview key is an organisations.id (primary key), and a real
  // client's is a CLERK org id (idx_orgs_clerk_org, unique). Deliberately NOT
  // one OR across both columns, which would ask SQLite to consider two indexes
  // for a value that can only ever match one of them. The legacy shape (a row
  // whose primary key IS the Clerk org id) is a second query behind a miss,
  // mirroring getPortalAuth, so it costs nothing once a client is linked.
  //
  // Fail-safe: any miss, and any D1 error, falls back to the NZD base
  // (resolvePinnedCurrency), not to "unpinned", so a client's money never
  // floats on a studio preference this browser happens to hold, and a database
  // wobble degrades the shell rather than throwing it. The retry without the
  // raw column is there so an environment that never ran the ad-hoc migration
  // still names the previewed org in the Client-view banner.
  const currencyOrgKey = isPreviewingClient ? previewOrgId : (!isAdmin ? orgId : null)
  let currencyEvidence: PinnedCurrencyEvidence = {}
  let previewOrgName: string | null = null
  if (currencyOrgKey) {
    const whereOrg = isPreviewingClient
      ? eq(schema.organisations.id, currencyOrgKey)
      : eq(schema.organisations.clerkOrgId, currencyOrgKey)
    // `withMrrCurrency: false` selects the literal NULL in that column's place,
    // so the retry is the same query and the same row shape, minus the one
    // reference that could fail to resolve.
    const readOrg = async (withMrrCurrency: boolean) => {
      const database = await db()
      const columns = {
        name: schema.organisations.name,
        preferredCurrency: schema.organisations.preferredCurrency,
        customMrrCurrency: withMrrCurrency
          ? sql<string | null>`custom_mrr_currency`.as('custom_mrr_currency')
          : sql<string | null>`NULL`.as('custom_mrr_currency'),
      }
      let [row] = await database.select(columns).from(schema.organisations).where(whereOrg).limit(1)
      if (!row && !isPreviewingClient) {
        ;[row] = await database
          .select(columns)
          .from(schema.organisations)
          .where(eq(schema.organisations.id, currencyOrgKey))
          .limit(1)
      }
      return row
    }
    // With the raw column first, then without it. Two passes, not two copies
    // of the query.
    for (const withMrrCurrency of [true, false]) {
      try {
        const row = await readOrg(withMrrCurrency)
        currencyEvidence = {
          preferredCurrency: row?.preferredCurrency ?? null,
          customMrrCurrency: row?.customMrrCurrency ?? null,
        }
        if (isPreviewingClient) previewOrgName = row?.name ?? null
        break
      } catch {
        currencyEvidence = {}
      }
    }
  }
  const pinnedCurrency = resolvePinnedCurrency(currencyEvidence, currencyOrgKey !== null)

  // Favicon (favicon_light_url / favicon_dark_url) is a platform-level Tahi
  // asset (super-admin only, same for every org) rather than per-client
  // branding, and our dark mode is class-based (not prefers-color-scheme), so a
  // media-swapped <link rel="icon"> would be unreliable. Left unwired on
  // purpose. TODO: when per-org favicons exist, emit client-only <link
  // rel="icon"> tags here from the settings values.

  return (
    <SwrProvider>
    <ToastProvider>
    <DisplayCurrencyProvider pinned={pinnedCurrency}>
      <PermissionsProvider value={perms}>
      <PrivateModeProvider>
      <SidebarProvider>
        {/* Sidebar collapsed-state persistence script lives in the
            root layout <head> so it runs before body parses. See
            app/layout.tsx. */}
        <SkipToContent />
        <div className="tahi-shell flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-cream)', ...brandVars }}>
          {/* AppSidebar handles its own responsive visibility:
              desktop persistent, mobile drawer triggered from top-nav hamburger. */}
          <AppSidebar
            isAdmin={isAdmin}
            features={perms.features}
            clientPortalRole={clientPortalRole}
            brandName={portalBrand.name}
            brandLogoUrl={portalBrand.logoUrl}
          />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* The preview signal is a browser-wide cookie; the banner's own
                state is per-tab sessionStorage. Hand the server's reading to
                every tab so a second tab opened while Client view is on still
                shows the strip and its Exit preview, instead of silently
                rendering redirects and a client's currency with no way out. */}
            {isAdmin && (
              <ImpersonationBanner
                serverPreviewOrgId={previewOrgId}
                serverPreviewOrgName={previewOrgName}
              />
            )}
            <AnnouncementBanner />
            <AppTopNav
              isAdmin={isAdmin}
              brandName={portalBrand.name}
              brandLogoUrl={portalBrand.logoUrl}
            />
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto dashboard-main">
              <div className="max-w-[90rem] mx-auto w-full dashboard-page-inner">
                {children}
              </div>
            </main>
          </div>
          <MobileBottomNav isAdmin={isAdmin} features={perms.features} clientPortalRole={clientPortalRole} />
          <ProductTour isAdmin={isAdmin} />
          <KeyboardShortcuts />
        </div>
      </SidebarProvider>
      </PrivateModeProvider>
      </PermissionsProvider>
    </DisplayCurrencyProvider>
    </ToastProvider>
    </SwrProvider>
  )
}
