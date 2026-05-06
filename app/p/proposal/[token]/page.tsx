import { ProposalViewer } from './proposal-viewer'

export const metadata = {
  title: 'Proposal',
  robots: { index: false, follow: false },
}

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ProposalViewer token={token} />
}
