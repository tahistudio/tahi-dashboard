import { NextRequest, NextResponse } from 'next/server'
import { deleteRecordingAudio, scopedRecordingDetail, withRecordingContext } from '@/lib/meeting-recordings-server'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await scopedRecordingDetail(context, id)))
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => {
    const transcriptRetained = await deleteRecordingAudio(context)
    return NextResponse.json({ success: true, transcriptRetained })
  })
}
