import { ContractViewer } from './contract-viewer'

export const metadata = {
  title: 'Contract',
  robots: { index: false, follow: false },
}

export default async function PublicContractPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ContractViewer token={token} mode="read" />
}
