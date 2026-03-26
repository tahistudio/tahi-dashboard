import { auth } from '@clerk/nextjs/server'
import { RequestList } from './request-list'

export const metadata = { title: 'Requests — Tahi Dashboard' }

export default async function RequestsPage() {
  const { orgId } = await auth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  return <RequestList isAdmin={isAdmin} />
}
