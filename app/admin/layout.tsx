import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/tahi/admin-sidebar'
import { AdminTopNav } from '@/components/tahi/admin-top-nav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, orgId } = await auth()

  if (!userId) redirect('/sign-in')

  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (tahiOrgId && orgId !== tahiOrgId) {
    redirect('/portal')
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg-secondary)] overflow-hidden">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AdminTopNav />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
