import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'
import { ImpersonationBanner } from '@/components/tahi/impersonation-banner'
import { MobileBottomNav } from '@/components/tahi/mobile-bottom-nav'
import { ProductTour } from '@/components/tahi/product-tour'
import { ToastProvider } from '@/components/tahi/toast'
import { KeyboardShortcuts } from '@/components/tahi/keyboard-shortcuts'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
        <div className="hidden md:flex">
          <AppSidebar isAdmin={isAdmin} />
        </div>
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {isAdmin && <ImpersonationBanner />}
          <AppTopNav isAdmin={isAdmin} />
          <main className="flex-1 overflow-y-auto px-4 pt-4 pb-24 md:px-8 md:pt-8 md:pb-8">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
        <MobileBottomNav isAdmin={isAdmin} />
        <ProductTour isAdmin={isAdmin} />
        <KeyboardShortcuts />
      </div>
    </ToastProvider>
  )
}
