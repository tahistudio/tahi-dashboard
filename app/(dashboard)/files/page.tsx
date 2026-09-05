import { cookies } from 'next/headers'
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { FilesContent } from './files-content'

export const metadata = { title: 'Files - Tahi Dashboard' }

export default async function FilesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  // Client-only surface. The team browses files from the client detail page,
  // unless they are previewing the portal as a client: the impersonation cookie
  // makes the portal files route answer for that org, so let the page render.
  const previewing = isAdmin && Boolean((await cookies()).get('tahi-impersonate-org')?.value)
  if (isAdmin && !previewing) redirect('/requests')
  return <FilesContent />
}
