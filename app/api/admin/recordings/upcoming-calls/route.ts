import { NextRequest, NextResponse } from 'next/server'
import { withRecordingContext } from '@/lib/meeting-recordings-server'
import { recorderUpcomingCalls } from '@/lib/recorder-upcoming-calls'

export async function GET(req: NextRequest) {
  return withRecordingContext(req, undefined, async context => NextResponse.json({
    items: await recorderUpcomingCalls(context.database, context.auth),
  }), { device: 'read' })
}
