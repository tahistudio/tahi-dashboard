import { NextRequest, NextResponse } from 'next/server'
import { recordingSpeakerChoices, renameRecordingSpeakers, withRecordingContext } from '@/lib/meeting-recordings-server'

type Params = { params: Promise<{ id: string }> }

/** Voices in this recording and the names that can be offered for them. */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await recordingSpeakerChoices(context)))
}

/** Body: { speakerNames: { mic?: string | null, "system:0"?: string | null, ... } }. Null resets a voice. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withRecordingContext(req, id, async context => NextResponse.json(await renameRecordingSpeakers(context, await req.json().catch(() => null))))
}
