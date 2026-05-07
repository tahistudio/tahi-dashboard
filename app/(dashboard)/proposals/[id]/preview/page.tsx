import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ProposalViewer } from '@/app/p/proposal/[token]/proposal-viewer'

export const metadata = {
  title: 'Proposal preview — Tahi Dashboard',
  robots: { index: false, follow: false },
}

/**
 * Admin-only preview of the public proposal viewer using the LIVE state
 * (not the publishedSnapshot). Lets you see what the next Publish will
 * push to the client before you push it.
 */
export default async function ProposalPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  const { id } = await params
  return <ProposalViewer previewProposalId={id} />
}
