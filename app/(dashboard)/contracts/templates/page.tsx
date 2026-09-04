import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { TemplatesContent } from './templates-content'

export const metadata = { title: 'Contract templates — Tahi Dashboard' }

export default async function ContractTemplatesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  await requirePageFeature('contracts')
  return <TemplatesContent />
}
