import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'
import { ImpersonationBanner } from '@/components/tahi/impersonation-banner'
import { MobileBottomNav } from '@/components/tahi/mobile-bottom-nav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
      <div className="hidden md:flex">
        <AppSidebar isAdmin={isAdmin} />
      </div>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {isAdmin && <ImpersonationBanner />}
        <AppTopNav isAdmin={isAdmin} />
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-10 md:py-8 pb-16 md:pb-8">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  )
}
