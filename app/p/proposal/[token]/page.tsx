import type { Metadata } from 'next'
import { ProposalViewer } from './proposal-viewer'
import { resolveProposalMetadata, toMetadata } from '@/lib/public-viewer-metadata'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const doc = await resolveProposalMetadata(token)
  return toMetadata(doc)
}

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ProposalViewer token={token} />
}
