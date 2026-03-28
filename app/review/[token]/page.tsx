export const metadata = { title: 'Share Your Experience - Tahi Studio' }

import { ReviewForm } from './review-form'

export default function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  return <ReviewFormWrapper params={params} />
}

async function ReviewFormWrapper({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ReviewForm token={token} />
}
