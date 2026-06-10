import { requirePageManage } from '@/lib/page-guard'
import { PermissionsBuilder } from './permissions-content'

export const metadata = { title: 'Permissions — Tahi Dashboard' }

// Admin+ only. Non-managers are redirected by the guard.
export default async function PermissionsPage() {
  await requirePageManage()
  return <PermissionsBuilder />
}
