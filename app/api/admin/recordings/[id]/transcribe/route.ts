import { NextRequest, NextResponse } from 'next/server'
import { transcribeNextChunk, withRecordingContext } from '@/lib/meeting-recordings-server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await transcribeNextChunk(context)))
}
