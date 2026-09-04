import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { requirePageFeature } from '@/lib/page-guard'
import { DocsContent } from './docs-content'

export const metadata = { title: 'Docs Hub - Tahi Dashboard' }

export default async function DocsPage() {
  const { orgId } = await getServerAuth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  await requirePageFeature('docs')
  return <DocsContent />
}
