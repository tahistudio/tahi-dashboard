import { NextRequest, NextResponse } from 'next/server'
import { transcribeNextChunk, withRecordingContext } from '@/lib/meeting-recordings-server'
import { RecordingError } from '@/lib/meeting-recordings'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRecordingContext(req, id, async context => {
    const body: unknown = req.body ? await req.json() : {}
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || ('separateSpeakers' in body && body.separateSpeakers !== false)) {
      throw new RecordingError('Separate speakers can only be disabled for this action.')
    }
    return NextResponse.json(await transcribeNextChunk(context, 'separateSpeakers' in body))
  })
}
