import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ContractsContent } from './contracts-content'

export const metadata = { title: 'Contracts - Tahi Dashboard' }

export default async function ContractsPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')

  return <ContractsContent />
}
