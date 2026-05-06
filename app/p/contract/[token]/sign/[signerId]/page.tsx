import { ContractViewer } from '../../contract-viewer'

export const metadata = {
  title: 'Sign contract',
  robots: { index: false, follow: false },
}

export default async function PublicContractSignPage({
  params,
}: {
  params: Promise<{ token: string; signerId: string }>
}) {
  const { token, signerId } = await params
  return <ContractViewer token={token} mode="sign" signerId={signerId} />
}
