import { getViewAudience } from '@/lib/view-audience'
import { redirect } from 'next/navigation'
import { FilesContent } from './files-content'

export const metadata = { title: 'Files - Tahi Dashboard' }

export default async function FilesPage() {
  const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
  if (!userId) redirect('/sign-in')
  // Client-only surface. The team browses files from the client detail page,
  // unless they are previewing the portal as a client: the impersonation cookie
  // makes the portal files route answer for that org, so let the page render.
  // One definition of "previewing" for the whole app: lib/view-audience.ts.
  if (isAdmin && !isPreviewingClient) redirect('/requests')
  return <FilesContent />
}
