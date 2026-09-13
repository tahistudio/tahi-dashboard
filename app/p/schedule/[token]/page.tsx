import type { Metadata } from 'next'
import { ScheduleViewer } from './schedule-viewer'
import { resolveScheduleMetadata, toMetadata } from '@/lib/public-viewer-metadata'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const doc = await resolveScheduleMetadata(token)
  return toMetadata(doc)
}

export default async function PublicSchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ScheduleViewer token={token} />
}
