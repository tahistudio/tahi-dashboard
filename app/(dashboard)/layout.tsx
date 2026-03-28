import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'

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
      <AppSidebar isAdmin={isAdmin} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AppTopNav isAdmin={isAdmin} />
        <main className="flex-1 overflow-y-auto" style={{ padding: '2rem 2.5rem' }}>
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
