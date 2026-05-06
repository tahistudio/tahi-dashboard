import { ScheduleViewer } from './schedule-viewer'

export const metadata = {
  title: 'Project schedule',
  // Keep public schedules out of search engines unless we explicitly opt in.
  robots: { index: false, follow: false },
}

export default async function PublicSchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ScheduleViewer token={token} />
}
