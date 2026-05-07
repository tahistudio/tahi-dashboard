import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'
import { ContractViewer } from '@/app/p/contract/[token]/contract-viewer'

export const metadata = {
  title: 'Contract preview — Tahi Dashboard',
  robots: { index: false, follow: false },
}

export default async function ContractPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) redirect('/requests')
  const { id } = await params
  return <ContractViewer mode="read" previewContractId={id} />
}
