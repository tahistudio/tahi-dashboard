import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { PortalSidebar } from '@/components/tahi/portal-sidebar'
import { PortalTopNav } from '@/components/tahi/portal-top-nav'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  return (
    <div className="flex h-screen bg-[var(--color-bg-secondary)] overflow-hidden">
      <PortalSidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <PortalTopNav />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
