import { NextRequest, NextResponse } from 'next/server'
import { linkRecording, withRecordingContext } from '@/lib/meeting-recordings-server'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await linkRecording(context, await req.json().catch(() => null))))
}
