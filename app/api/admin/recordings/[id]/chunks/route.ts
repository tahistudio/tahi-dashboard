import { NextRequest, NextResponse } from 'next/server'
import { reserveChunk, uploadChunk, withRecordingContext } from '@/lib/meeting-recordings-server'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await reserveChunk(context, await req.json().catch(() => null))), { device: 'chunk' })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => {
    await uploadChunk(context, req)
    return NextResponse.json({ success: true, uploaded: true })
  }, { device: 'chunk' })
}
