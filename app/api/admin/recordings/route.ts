import { NextRequest, NextResponse } from 'next/server'
import { createRecording, listRecordings, withRecordingContext } from '@/lib/meeting-recordings-server'

export async function GET(req: NextRequest) {
  return withRecordingContext(req, undefined, async context => NextResponse.json({ items: await listRecordings(context) }), { device: 'read' })
}

export async function POST(req: NextRequest) {
  return withRecordingContext(req, undefined, async context => NextResponse.json({
    recording: await createRecording(context, await req.json().catch(() => null)),
  }, { status: 201 }), { device: 'create' })
}
