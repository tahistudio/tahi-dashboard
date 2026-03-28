import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { AuditLogContent } from './audit-log-content'

export const metadata = { title: 'Audit Log - Tahi Dashboard' }

export default async function AuditLogPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!isAdmin) redirect('/overview')
  return <AuditLogContent />
}
