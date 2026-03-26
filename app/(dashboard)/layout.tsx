import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/tahi/app-sidebar'
import { AppTopNav } from '@/components/tahi/app-top-nav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId } = await auth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return (
    <div className="flex h-screen bg-[var(--color-bg-secondary)] overflow-hidden">
      <AppSidebar isAdmin={isAdmin} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AppTopNav isAdmin={isAdmin} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
