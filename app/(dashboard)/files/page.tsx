import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { FolderOpen } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'

export const metadata = { title: 'Files - Tahi Dashboard' }

export default async function FilesPage() {
  const { orgId } = await getServerAuth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (isAdmin) redirect('/requests')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]" style={{ letterSpacing: '-0.01em' }}>Files</h1>
        <p className="text-sm text-[var(--color-text-muted)]" style={{ marginTop: '0.25rem' }}>
          Deliverables and files shared by the Tahi team.
        </p>
      </div>
      <Card padding="none">
        <EmptyState
          icon={<FolderOpen className="w-7 h-7" />}
          title="No files yet"
          description="Delivered files will appear here for download."
        />
      </Card>
    </div>
  )
}
