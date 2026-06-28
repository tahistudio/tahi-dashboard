import { getServerAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'
import { ImpersonationBanner } from '@/components/tahi/impersonation-banner'
import { MobileBottomNav } from '@/components/tahi/mobile-bottom-nav'
import { ProductTour } from '@/components/tahi/product-tour'
import { ToastProvider } from '@/components/tahi/toast'
import { KeyboardShortcuts } from '@/components/tahi/keyboard-shortcuts'
import { SidebarProvider } from '@/components/tahi/sidebar-context'
import { SkipToContent } from '@/components/tahi/skip-to-content'
import { DisplayCurrencyProvider } from '@/lib/display-currency-context'
import { PermissionsProvider, type PermissionsValue } from '@/components/tahi/permissions-context'
import { PrivateModeProvider } from '@/components/tahi/private-mode-context'
import { db } from '@/lib/db'
import { resolvePermissions, featureMap } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

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
  if (!onboardingComplete) redirect('/onboarding')

  // Granular permissions: resolve the caller's capabilities once, server-side,
  // and feed them to the sidebar + <Gate>. Fail-open (full access) if the
  // resolver errors so a permissions hiccup never locks the user out.
  let perms: PermissionsValue = {
    level: 'admin',
    isAdmin, isSuperAdmin: false, canManagePermissions: isAdmin,
    features: {},
  }
  try {
    const drizzle = (await db()) as unknown as D1
    const access = await resolvePermissions(drizzle, { userId, orgId })
    perms = {
      level: access.level,
      isAdmin: access.isAdmin,
      isSuperAdmin: access.isSuperAdmin,
      canManagePermissions: access.canManagePermissions,
      features: featureMap(access),
    }
  } catch {
    // fail-open
  }

  return (
    <ToastProvider>
    <DisplayCurrencyProvider>
      <PermissionsProvider value={perms}>
      <PrivateModeProvider>
      <SidebarProvider>
        {/* Sidebar collapsed-state persistence script lives in the
            root layout <head> so it runs before body parses. See
            app/layout.tsx. */}
        <SkipToContent />
        <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-cream)' }}>
          {/* AppSidebar handles its own responsive visibility:
              desktop persistent, mobile drawer triggered from top-nav hamburger. */}
          <AppSidebar isAdmin={isAdmin} features={perms.features} />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {isAdmin && <ImpersonationBanner />}
            <AppTopNav isAdmin={isAdmin} />
            <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto dashboard-main">
              <div className="max-w-[90rem] mx-auto w-full dashboard-page-inner">
                {children}
              </div>
            </main>
          </div>
          <MobileBottomNav isAdmin={isAdmin} />
          <ProductTour isAdmin={isAdmin} />
          <KeyboardShortcuts />
        </div>
      </SidebarProvider>
      </PrivateModeProvider>
      </PermissionsProvider>
    </DisplayCurrencyProvider>
    </ToastProvider>
  )
}
