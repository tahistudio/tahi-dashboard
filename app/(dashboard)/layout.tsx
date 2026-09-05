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
import { DisplayCurrencyProvider, resolvePinnedCurrency } from '@/lib/display-currency-context'
import { PermissionsProvider, type PermissionsValue } from '@/components/tahi/permissions-context'
import { PrivateModeProvider } from '@/components/tahi/private-mode-context'
import { SwrProvider } from '@/components/tahi/swr-provider'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray, or } from 'drizzle-orm'
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
  // Money on a client surface is stated in the currency that client is
  // actually billed in (organisations.preferred_currency), not in whatever
  // display currency this browser last chose. Before this, a USD client read
  // their own plan as "NZ$1,500/mo" and the nav chip offered to re-convert it,
  // so the portal showed two different numbers for one invoice and named
  // neither currency. Client audiences include the studio inside Client view,
  // which is resolved from the impersonation cookie (previewOrgId).
  //
  // orgId is a CLERK org id for a real client, so the lookup accepts either
  // side of the link, mirroring getPortalAuth's resolution + back-compat.
  // Fail-safe: any miss falls back to the NZD base (resolvePinnedCurrency), not
  // to "unpinned", so a client's money never floats on a studio preference this
  // browser happens to hold. The same row also names the previewed org for the
  // Client-view banner, so the preview costs no extra query.
  const currencyOrgKey = isPreviewingClient ? previewOrgId : (!isAdmin ? orgId : null)
  let preferredCurrency: string | null = null
  let previewOrgName: string | null = null
  if (currencyOrgKey) {
    try {
      const database = await db()
      const [row] = await database
        .select({
          name: schema.organisations.name,
          preferredCurrency: schema.organisations.preferredCurrency,
        })
        .from(schema.organisations)
        .where(or(
          eq(schema.organisations.clerkOrgId, currencyOrgKey),
          eq(schema.organisations.id, currencyOrgKey),
        ))
        .limit(1)
      preferredCurrency = row?.preferredCurrency ?? null
      if (isPreviewingClient) previewOrgName = row?.name ?? null
    } catch {
      preferredCurrency = null
    }
  }
  const pinnedCurrency = resolvePinnedCurrency(preferredCurrency, currencyOrgKey !== null)

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
