import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { FolderOpen } from 'lucide-react'
export const metadata = { title: 'Files' }
export default async function FilesPage() {
  const { orgId } = await auth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (isAdmin) redirect('/requests')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Files</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Deliverables and files shared by the Tahi team.</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <FolderOpen className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">No files yet</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">Delivered files will appear here for download.</p>
      </div>
    </div>
  )
}
